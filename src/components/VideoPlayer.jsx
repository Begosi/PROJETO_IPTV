import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { Play, Pause, Maximize, Minimize, PictureInPicture, ArrowLeft, Loader2, AlertCircle, Copy, Check, Terminal } from 'lucide-react';
import localforage from 'localforage';
import { getProxiedUrl, isElectron, resolveRedirect } from '../utils/url';
import './VideoPlayer.css';

export function VideoPlayer({ url, title, onClose, id, type, stream, listId }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isHovering, setIsHovering] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  let hoverTimeout = useRef(null);

  const handleToggleDevTools = () => {
    if (window.require) {
      try {
        const electron = window.require('electron');
        electron.ipcRenderer.send('toggle-devtools');
      } catch (e) {
        console.error('Failed to toggle DevTools:', e);
      }
    }
  };

  useEffect(() => {

    const video = videoRef.current;
    if (!video) return;

    let hls;
    let flvPlayer;

    const handleLeavePiP = () => {
      console.log('Exited Picture-in-Picture, reloading stream to prevent browser/MSE stalls.');
      if (type !== 'live' && video.currentTime > 0) {
        localforage.setItem(`resume_${id}`, video.currentTime).then(() => {
          setReloadKey(prev => prev + 1);
        });
      } else {
        setReloadKey(prev => prev + 1);
      }
    };

    video.addEventListener('leavepictureinpicture', handleLeavePiP);

    const initPlayer = async () => {
      setError(null);
      setIsLoading(true);
      // Recupera progresso
      const savedTime = await localforage.getItem(`resume_${id}`);
      if (savedTime && savedTime > 5) {
        video.currentTime = savedTime;
      }

      const isHls = url.includes('.m3u8');
      const isTs = url.includes('.ts') || url.includes('stream_type=live') || url.includes('/live/');

      if (isHls && Hls.isSupported()) {
        const hlsConfig = {
          maxMaxBufferLength: 30,
        };
        // Em navegadores (Vercel/Web), interceptamos todas as requisições XHR do HLS.js para passar pela reescrita inteligente de URL
        if (!isElectron) {
          class CustomLoader extends Hls.DefaultConfig.loader {
            constructor(config) {
              super(config);
              const originalLoad = this.load.bind(this);
              this.load = function(context, config, callbacks) {
                if (context && context.url) {
                  context.url = getProxiedUrl(context.url);
                }
                originalLoad(context, config, callbacks);
              };
            }
          }
          hlsConfig.loader = CustomLoader;
        }
        hls = new Hls(hlsConfig);
        hls.loadSource(getProxiedUrl(url));
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setIsLoading(false);
          video.play().catch(() => console.log('Autoplay blocked'));
        });
        let mediaErrorRetries = 0;
        let networkErrorRetries = 0;
        let tokenRefreshRetries = 0;

        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.error('HLS Fatal Error:', data);
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              // Se for 404/403 num segmento ou manifest, o token do provedor expirou
              // Recriamos o player do zero para obter novo token do balanceador
              const is404or403 = data.networkDetails?.status === 404 || data.networkDetails?.status === 403 || data.response?.code === 404;
              const isTokenExpiredError = is404or403 || 
                data.details === 'levelLoadError' || 
                data.details === 'manifestParsingError' ||
                data.details === 'manifestLoadError';
              
              if (isTokenExpiredError && tokenRefreshRetries < 3) {
                tokenRefreshRetries++;
                console.warn(`[HLS] Token expirado detectado (${data.details}). Renovando stream ${tokenRefreshRetries}/3...`);
                setIsLoading(true);
                
                // Destroi instância atual
                hls.destroy();
                
                // Recria com nova URL após breve delay
                setTimeout(() => {
                  // Recria config
                  const newHlsConfig = { maxMaxBufferLength: 30 };
                  if (!isElectron) {
                    class RefreshLoader extends Hls.DefaultConfig.loader {
                      constructor(config) {
                        super(config);
                        const originalLoad = this.load.bind(this);
                        this.load = function(context, cfg, callbacks) {
                          if (context && context.url) {
                            context.url = getProxiedUrl(context.url);
                          }
                          originalLoad(context, cfg, callbacks);
                        };
                      }
                    }
                    newHlsConfig.loader = RefreshLoader;
                  }
                  hls = new Hls(newHlsConfig);
                  // Usa URL original para forçar re-autenticação com novo token
                  hls.loadSource(getProxiedUrl(url));
                  hls.attachMedia(video);
                  hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    setIsLoading(false);
                    setError(null);
                    video.play().catch(() => {});
                  });
                  hls.on(Hls.Events.ERROR, (ev2, d2) => {
                    if (d2.fatal && d2.type === Hls.ErrorTypes.NETWORK_ERROR && tokenRefreshRetries >= 3) {
                      setError('Transmissão indisponível. O provedor bloqueou a conexão de servidor.');
                      setIsLoading(false);
                    }
                  });
                }, 1500);
                return;
              }
              
              // Fallback: tentativa simples de retomar carga
              if (networkErrorRetries < 2) {
                networkErrorRetries++;
                console.warn(`Erro de rede fatal HLS. Tentando recuperar ${networkErrorRetries}/2...`);
                hls.startLoad();
              } else {
                setError(`Erro fatal de rede HLS: ${data.details || 'falha de conexão'}`);
                setIsLoading(false);
                video.pause();
              }
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              if (mediaErrorRetries < 2) {
                mediaErrorRetries++;
                console.warn(`Erro de mídia fatal HLS. Tentando recuperar ${mediaErrorRetries}/2...`);
                hls.recoverMediaError();
              } else {
                setError(`Erro fatal de decodificação HLS: ${data.details || 'formato incompatível'}`);
                setIsLoading(false);
                video.pause();
              }
            } else {
              setError(`Erro fatal de reprodução HLS: ${data.details || 'falha interna'}`);
              setIsLoading(false);
              video.pause();
            }
          }
        });
      } else if (mpegts.isSupported() && isTs) {
        flvPlayer = mpegts.createPlayer({
            type: 'mse',  
            isLive: true,
            url: getProxiedUrl(url)
        });
        flvPlayer.attachMediaElement(video);
        flvPlayer.load();
        flvPlayer.play().catch(()=>console.log('Autoplay block'));
        flvPlayer.on(mpegts.Events.ERROR, (errType, detail, info) => {
          console.error('MPEGTS Error:', errType, detail, info);
          setError(`Erro de reprodução TS: ${detail || 'Falha no fluxo'}`);
          setIsLoading(false);
          video.pause();
        });
        setIsLoading(false);
      } else {
        // Fallback nativo para MP4, WebM ou Safari
        let playUrl = getProxiedUrl(url);
        if (playUrl.startsWith('http://')) {
          try {
            const resolved = await resolveRedirect(playUrl);
            if (resolved) {
              playUrl = resolved;
            }
          } catch (err) {
            console.error('[VideoPlayer] Falha ao resolver redirecionamento:', err);
          }
        }
        video.src = playUrl;
        video.addEventListener('loadedmetadata', () => {
          setIsLoading(false);
          video.play().catch(() => console.log('Autoplay blocked'));
        });
        video.addEventListener('error', (e) => {
          console.error('Erro de mídia nativa:', video.error, e);
          let errorMsg = 'Erro desconhecido ao carregar o vídeo.';
          if (video.error) {
            switch (video.error.code) {
              case 1:
                errorMsg = 'O carregamento do vídeo foi cancelado pelo usuário.';
                break;
              case 2:
                errorMsg = 'Erro de rede: Falha na conexão de internet ou servidor indisponível.';
                break;
              case 3:
                errorMsg = 'Erro de decodificação: O formato do arquivo é inválido ou corrompido.';
                break;
              case 4:
                errorMsg = 'O link do vídeo retornou um erro 404 (Não Encontrado) ou o formato não é suportado.';
                break;
            }
          }
          setError(errorMsg);
          setIsLoading(false);
          video.pause();
        });
      }
    };

    initPlayer();

    // Salvar progresso no banco a cada 5 segundos
    const progressInterval = setInterval(async () => {
      if (video && !video.paused && video.currentTime > 0) {
        localforage.setItem(`resume_${id}`, video.currentTime);
        
        if ((type === 'vod' || type === 'series') && stream && listId) {
          try {
            const key = `continue_watching_${listId}_${type}`;
            let cwList = await localforage.getItem(key) || [];
            const percent = video.duration ? (video.currentTime / video.duration) : 0;
            
            if (percent > 0.95) {
              const newList = cwList.filter(item => item.id !== id);
              if (newList.length !== cwList.length) {
                await localforage.setItem(key, newList);
              }
            } else {
              const idx = cwList.findIndex(item => item.id === id);
              const watchItem = {
                id: id,
                title: title,
                type: type,
                stream_icon: stream.stream_icon || stream.cover || null,
                progress: video.currentTime,
                duration: video.duration,
                lastWatched: Date.now(),
                stream_obj: stream
              };
              
              if (idx >= 0) {
                cwList[idx] = watchItem;
                // Move para o topo
                cwList.splice(idx, 1);
                cwList.unshift(watchItem);
              } else {
                cwList.unshift(watchItem);
              }
              
              if (cwList.length > 50) cwList.length = 50;
              await localforage.setItem(key, cwList);
            }
          } catch (e) {
            console.error('Falha ao salvar progresso do Continue Assistindo', e);
          }
        }
      }
    }, 5000);

    return () => {
      clearInterval(progressInterval);
      video.removeEventListener('leavepictureinpicture', handleLeavePiP);
      if (hls) hls.destroy();
      if (flvPlayer) {
        flvPlayer.pause();
        flvPlayer.unload();
        flvPlayer.detachMediaElement();
        flvPlayer.destroy();
      }
    };
  }, [url, id, type, reloadKey]);

  const togglePlay = () => {
    if (videoRef.current.paused) {
      videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
  };

  const handleTimeUpdate = () => {
    setProgress(videoRef.current.currentTime);
    if (!duration) setDuration(videoRef.current.duration);
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    videoRef.current.currentTime = time;
    setProgress(time);
  };

  const formatTime = (timeInSeconds) => {
    if (isNaN(timeInSeconds)) return "00:00";
    const m = Math.floor(timeInSeconds / 60).toString().padStart(2, '0');
    const s = Math.floor(timeInSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen();
    }
  };

  const togglePiP = async () => {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else if (document.pictureInPictureEnabled) {
      await videoRef.current.requestPictureInPicture();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (error && videoRef.current) {
      try {
        videoRef.current.pause();
      } catch (e) {
        console.error('Failed to pause video on error:', e);
      }
    }
  }, [error]);

  const handleMouseMove = () => {
    setIsHovering(true);
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => setIsHovering(false), 3000);
  };

  return (
    <div 
      className="video-player-container" 
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setIsHovering(false)}
    >
      <video
        ref={videoRef}
        className="video-element"
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
        onClick={togglePlay}
        autoPlay
      />

      {isLoading && (
        <div className="loader-overlay">
          <Loader2 className="spinner" size={64} />
        </div>
      )}

      <div className={`player-controls ${isHovering || !isPlaying ? 'visible' : 'hidden'}`}>
          <div className="top-controls">
            <button className="control-btn" onClick={onClose} title="Voltar">
              <ArrowLeft size={24} />
            </button>
            <h2>{title}</h2>
          </div>

          <div className="bottom-controls">
            {type !== 'live' && (
              <div className="progress-bar-container">
                <input 
                  type="range" 
                  className="progress-bar" 
                  min={0} 
                  max={duration || 100} 
                  value={progress}
                  onChange={handleSeek}
                />
                <div 
                  className="progress-filled"
                  style={{ width: `${(progress / (duration || 1)) * 100}%` }}
                />
              </div>
            )}

            <div className="controls-row">
              <div className="left-controls">
                <button className="control-btn" onClick={togglePlay}>
                  {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                </button>
                {type === 'live' ? (
                  <div className="live-indicator">
                    <span className="live-dot"></span>
                    AO VIVO
                  </div>
                ) : (
                  <span className="time-display">
                    {formatTime(progress)} / {formatTime(duration)}
                  </span>
                )}
              </div>

              <div className="right-controls">
                {window.require && (
                  <button className="control-btn" onClick={handleToggleDevTools} title="Inspecionar Requisições (DevTools)">
                    <Terminal size={20} />
                  </button>
                )}
                {document.pictureInPictureEnabled && (
                  <button className="control-btn" onClick={togglePiP} title="Picture in Picture">
                    <PictureInPicture size={20} />
                  </button>
                )}
                <button className="control-btn" onClick={toggleFullscreen} title="Tela Cheia">
                  {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                </button>
              </div>
            </div>
          </div>
        </div>

      {error && (
        <div className="player-error-overlay">
          <div className="error-card">
            <AlertCircle className="error-icon" size={48} />
            <h3>Falha na Reprodução</h3>
            <p className="error-desc">{error}</p>
            
            <div className="error-details">
              <strong>URL do Vídeo:</strong>
              <div className="url-box">
                <code className="url-code">{url}</code>
                <button className="btn-copy" onClick={() => {
                  navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  <span>{copied ? 'Copiado!' : 'Copiar Link'}</span>
                </button>
              </div>
              <p className="help-text">
                <strong>Por que isso acontece?</strong> Os servidores de IPTV (como o Xtream) frequentemente derrubam links antigos ou limitam o número de acessos simultâneos. Se o link retornar 404, o filme foi removido pelo seu provedor.
              </p>
            </div>

            <div className="error-actions">
              {window.require && (
                <button className="btn-secondary" onClick={handleToggleDevTools}>
                  <Terminal size={16} />
                  Inspecionar Rede (DevTools)
                </button>
              )}
              <button className="btn-primary" onClick={onClose}>
                Voltar ao Catálogo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
