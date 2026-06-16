import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Search, Loader2, Play, Tv } from 'lucide-react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { XtreamService } from '../services/xtream';
import { getProxiedUrl, isElectron } from '../utils/url';
import './Catalog.css';

const BRANDS = [
  { id: 'virtual_netflix', name: 'Netflix', query: 'netflix' },
  { id: 'virtual_prime', name: 'Prime Video', query: 'prime' },
  { id: 'virtual_disney', name: 'Disney+', query: 'disney' },
  { id: 'virtual_hbo', name: 'HBO Max', query: 'hbo' },
  { id: 'virtual_crunchyroll', name: 'Crunchyroll', query: 'crunchyroll' }
];

export function Catalog({ activeList, type, onBack, onPlay }) {
  const [categories, setCategories] = useState([]);
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [streams, setStreams] = useState([]);
  const [isLoadingCats, setIsLoadingCats] = useState(true);
  const [isLoadingStreams, setIsLoadingStreams] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState(null);

  const xtreamService = activeList.type === 'xtream' 
    ? new XtreamService(activeList.url, activeList.username, activeList.password) 
    : null;

  const [selectedStream, setSelectedStream] = useState(null);
  const [visibleCount, setVisibleCount] = useState(100);
  const [activeSeriesInfo, setActiveSeriesInfo] = useState(null);
  const [isLoadingSeriesInfo, setIsLoadingSeriesInfo] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState(null);

  const handleSelectSeries = async (series) => {
    setIsLoadingSeriesInfo(true);
    setError(null);
    try {
      const info = await xtreamService.getSeriesInfo(series.series_id);
      setActiveSeriesInfo(info);
      
      // Achar a primeira temporada disponível
      if (info.seasons && info.seasons.length > 0) {
        setSelectedSeason(info.seasons[0].season_number);
      } else if (info.episodes && Object.keys(info.episodes).length > 0) {
        setSelectedSeason(Object.keys(info.episodes)[0]);
      }
    } catch (err) {
      setError(`Erro ao carregar detalhes da série: ${err.message}`);
    } finally {
      setIsLoadingSeriesInfo(false);
    }
  };

  useEffect(() => {
    let active = true;
    async function fetchCats() {
      try {
        setIsLoadingCats(true);
        const listId = activeList.id;
        const { CacheService } = await import('../services/cache.js');
        let rawCats = [];

        if (activeList.type === 'm3u') {
          let cachedObj = await CacheService.get(`m3u_parsed_${listId}`);
          let cats;
          if (cachedObj) {
            cats = cachedObj.data;
          } else {
            const { M3uService } = await import('../services/m3u.js');
            cats = M3uService.parseContent(activeList.content || '');
            await CacheService.set(`m3u_parsed_${listId}`, cats);
          }
          const targetStreamType = type === 'live' ? 'live' : 'movie';
          rawCats = cats.map(cat => ({
            ...cat,
            items: cat.items.filter(item => item.stream_type === targetStreamType || type === 'series')
          })).filter(cat => cat.items.length > 0);
        } else {
          let cachedObj = await CacheService.get(`categories_${listId}_${type}`);
          if (cachedObj) {
            rawCats = cachedObj.data;
          } else {
            rawCats = await xtreamService.getCategories(type);
            await CacheService.set(`categories_${listId}_${type}`, rawCats);
          }
        }

        if (!active) return;

        // 1. Deduplicar categorias por nome (case-insensitive)
        const seen = new Set();
        let uniqueCats = [];
        rawCats.forEach(cat => {
          if (cat && cat.category_name) {
            const normalized = cat.category_name.trim().toLowerCase();
            if (!seen.has(normalized)) {
              seen.add(normalized);
              uniqueCats.push(cat);
            }
          }
        });

        // 2. Se for VOD ou Séries, adicionar plataformas virtuais e a categoria TODOS
        if (type === 'vod' || type === 'series') {
          const virtualCats = [];
          BRANDS.forEach(brand => {
            let hasContent = false;
            if (activeList.type === 'm3u') {
              hasContent = uniqueCats.some(cat => 
                cat.items.some(item => 
                  item.name?.toLowerCase().includes(brand.query) ||
                  cat.category_name?.toLowerCase().includes(brand.query)
                )
              );
            } else {
              hasContent = uniqueCats.some(cat => 
                cat.category_name?.toLowerCase().includes(brand.query)
              );
            }

            if (hasContent) {
              virtualCats.push({
                category_id: brand.id,
                category_name: `🎬 ${brand.name.toUpperCase()}`,
                isVirtual: true,
                query: brand.query
              });
            }
          });
          
          const allCat = {
            category_id: 'all_contents',
            category_name: '✨ TODOS OS CONTEÚDOS',
            isAll: true
          };

          uniqueCats = [allCat, ...virtualCats, ...uniqueCats];
        }

        setCategories(uniqueCats);
        if (uniqueCats.length > 0) {
          setActiveCategoryId(uniqueCats[0].category_id);
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setIsLoadingCats(false);
      }
    }
    fetchCats();

    return () => {
      active = false;
    };
  }, [type, activeList]);

  useEffect(() => {
    let active = true;
    async function fetchStreamsData() {
      if (!activeCategoryId) return;
      try {
        setIsLoadingStreams(true);
        setSelectedStream(null); // Limpa seleção ao trocar categoria
        const listId = activeList.id;
        const { CacheService } = await import('../services/cache.js');

        if (activeList.type === 'm3u') {
          if (activeCategoryId === 'all_contents') {
            const allItems = [];
            categories.forEach(cat => {
              if (!cat.isVirtual && cat.category_id !== 'all_contents') {
                cat.items.forEach(item => {
                  if (!allItems.some(x => x.stream_id === item.stream_id)) {
                    allItems.push(item);
                  }
                });
              }
            });
            if (active) setStreams(allItems);
          } else if (typeof activeCategoryId === 'string' && activeCategoryId.startsWith('virtual_')) {
            const brandQuery = activeCategoryId.replace('virtual_', '');
            const allItems = [];
            categories.forEach(cat => {
              if (!cat.isVirtual && cat.category_id !== 'all_contents') {
                cat.items.forEach(item => {
                  const nameMatch = item.name?.toLowerCase().includes(brandQuery);
                  const catMatch = cat.category_name?.toLowerCase().includes(brandQuery);
                  if (nameMatch || catMatch) {
                    if (!allItems.some(x => x.stream_id === item.stream_id)) {
                      allItems.push(item);
                    }
                  }
                });
              }
            });
            if (active) setStreams(allItems);
          } else {
            const cat = categories.find(c => c.category_id === activeCategoryId);
            if (active) setStreams(cat ? cat.items : []);
          }
        } else {
          // Xtream Codes: check if we have the full streams list cached
          const cachedStreamsObj = await CacheService.get(`streams_${listId}_${type}`);
          
          if (cachedStreamsObj) {
            const allStreams = cachedStreamsObj.data;
            if (activeCategoryId === 'all_contents') {
              if (active) setStreams(allStreams);
            } else if (typeof activeCategoryId === 'string' && activeCategoryId.startsWith('virtual_')) {
              const brandQuery = activeCategoryId.replace('virtual_', '');
              const matchingCatIds = categories
                .filter(cat => !cat.isVirtual && cat.category_id !== 'all_contents' && cat.category_name?.toLowerCase().includes(brandQuery))
                .map(cat => String(cat.category_id));
              
              const filtered = allStreams.filter(stream => matchingCatIds.includes(String(stream.category_id)));
              if (active) setStreams(filtered);
            } else {
              const filtered = allStreams.filter(stream => String(stream.category_id) === String(activeCategoryId));
              if (active) setStreams(filtered);
            }
          } else {
            // Fallback: no cache, fetch from API
            if (activeCategoryId === 'all_contents') {
              const data = await xtreamService.getStreams(type);
              if (active) setStreams(data || []);
            } else if (typeof activeCategoryId === 'string' && activeCategoryId.startsWith('virtual_')) {
              const brandQuery = activeCategoryId.replace('virtual_', '');
              const matchingCats = categories.filter(cat => 
                !cat.isVirtual && 
                cat.category_id !== 'all_contents' &&
                cat.category_name?.toLowerCase().includes(brandQuery)
              );
              if (matchingCats.length === 0) {
                if (active) setStreams([]);
              } else {
                const promises = matchingCats.map(cat => 
                  xtreamService.getStreams(type, cat.category_id).catch(() => [])
                );
                const results = await Promise.all(promises);
                if (active) setStreams(results.flat());
              }
            } else {
              const data = await xtreamService.getStreams(type, activeCategoryId);
              if (active) setStreams(data || []);
            }
          }
        }
        if (active) setVisibleCount(100); // Reset da paginação
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setIsLoadingStreams(false);
      }
    }
    fetchStreamsData();

    return () => {
      active = false;
    };
  }, [activeCategoryId, type, activeList, categories]);

  useEffect(() => {
    setVisibleCount(100); // Reset paginação ao buscar
  }, [searchQuery]);

  const filteredStreams = streams.filter(s => 
    s.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const slicedStreams = filteredStreams.slice(0, visibleCount);

  const handleScroll = (e) => {
    const target = e.target;
    if (target.scrollHeight - target.scrollTop <= target.clientHeight + 150) {
      if (visibleCount < filteredStreams.length) {
        setVisibleCount(prev => prev + 100);
      }
    }
  };

  const getStreamUrl = (stream) => {
    let streamUrl = stream.direct_url;
    let id = stream.stream_id || stream.series_id || stream.num;

    if (activeList.type === 'xtream') {
      const ext = stream.container_extension;
      streamUrl = xtreamService.buildStreamUrl(type, id, ext);
    }
    return streamUrl;
  };

  const handleFullscreenPlay = (stream) => {
    onPlay({
      id: stream.stream_id || stream.series_id || stream.num,
      title: stream.name,
      url: getStreamUrl(stream),
      type: type
    });
  };

  const getTypeLabel = () => {
    if (type === 'live') return 'TV Ao Vivo';
    if (type === 'vod') return 'Filmes';
    if (type === 'series') return 'Séries';
    return '';
  };

  return (
    <div className="catalog-container">
      <header className="catalog-header">
        <div className="header-left">
          <button className="control-btn" onClick={onBack} title="Voltar para o Dashboard">
            <ArrowLeft size={24} />
          </button>
          <h2>{getTypeLabel()}</h2>
        </div>
        
        <div className="search-bar">
          <Search size={20} />
          <input 
            type="text" 
            placeholder="Pesquisar..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </header>

      {error && (
        <div className="error-message" style={{background: 'rgba(239, 68, 68, 0.2)', padding: '1rem', textAlign: 'center'}}>
          <p>Erro ao carregar dados: {error}</p>
        </div>
      )}

      <div className="catalog-content">
        <aside className="categories-sidebar">
          {isLoadingCats ? (
            <div className="loading-center"><Loader2 className="spinner" size={32} /></div>
          ) : (
            <ul>
              {categories.map(cat => (
                <li 
                  key={cat.category_id}
                  className={`${activeCategoryId === cat.category_id ? 'active' : ''} ${cat.isVirtual ? 'virtual-category' : ''} ${cat.isAll ? 'all-category' : ''}`}
                  onClick={() => setActiveCategoryId(cat.category_id)}
                >
                  {cat.category_name}
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main className="streams-grid-container" onScroll={handleScroll}>
          {isLoadingStreams ? (
            <div className="loading-center"><Loader2 className="spinner" size={48} /></div>
          ) : type === 'live' ? (
            <div className="live-layout-container">
              <div className="live-channels-list">
                <div className="streams-grid list-view">
                  {slicedStreams.map(stream => {
                    const isSelectedLive = selectedStream?.stream_id === stream.stream_id || selectedStream?.num === stream.num;
                    return (
                      <div 
                        key={stream.stream_id || stream.num} 
                        className={`stream-item ${isSelectedLive ? 'selected-live' : ''}`}
                        onClick={() => setSelectedStream(stream)}
                        onDoubleClick={() => handleFullscreenPlay(stream)}
                      >
                        <div className="live-row">
                          <div className="live-number">{stream.num || stream.stream_id}</div>
                          {stream.stream_icon ? (
                            <img src={stream.stream_icon} alt="" className="live-icon" loading="lazy" />
                          ) : (
                            <div className="live-icon-placeholder"><Play size={20} /></div>
                          )}
                          <h3>{stream.name}</h3>
                        </div>
                      </div>
                    );
                  })}
                  {slicedStreams.length === 0 && (
                    <div style={{color: 'var(--text-secondary)', padding: '2rem'}}>Nenhum canal encontrado.</div>
                  )}
                  {visibleCount < filteredStreams.length && (
                    <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      Role para carregar mais canais...
                    </div>
                  )}
                </div>
              </div>

              <div className="live-preview-panel">
                {selectedStream ? (
                  <LivePreviewPlayer 
                    url={getStreamUrl(selectedStream)} 
                    title={selectedStream.name}
                    onExpand={() => handleFullscreenPlay(selectedStream)}
                  />
                ) : (
                  <div className="preview-placeholder">
                    <Tv size={48} style={{ color: 'rgba(255,255,255,0.2)' }} />
                    <p>Selecione um canal para ver a prévia</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="streams-grid card-view">
                {slicedStreams.map(stream => (
                  <div 
                    key={stream.stream_id || stream.series_id || stream.num} 
                    className="stream-item"
                    onClick={() => {
                      if (type === 'series' && activeList.type === 'xtream') {
                        handleSelectSeries(stream);
                      } else {
                        handleFullscreenPlay(stream);
                      }
                    }}
                  >
                    <div className="stream-poster">
                      {(stream.stream_icon || stream.cover) ? (
                        <img src={stream.stream_icon || stream.cover} alt={stream.name} loading="lazy" />
                      ) : (
                        <div className="no-poster"><Play size={32} /></div>
                      )}
                    </div>
                    <div className="stream-info">
                      <h3>{stream.name}</h3>
                    </div>
                  </div>
                ))}
              </div>
              {slicedStreams.length === 0 && (
                <div style={{color: 'var(--text-secondary)', padding: '2rem'}}>Nenhum conteúdo encontrado.</div>
              )}
              {visibleCount < filteredStreams.length && (
                <div style={{ textAlign: 'center', padding: '2rem 1rem 1rem 1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Role para carregar mais conteúdos...
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {activeSeriesInfo && (
        <div className="series-details-container">
          <header className="details-header">
            <button className="control-btn" onClick={() => setActiveSeriesInfo(null)} title="Voltar ao catálogo">
              <ArrowLeft size={24} />
            </button>
            <h2>Detalhes da Série</h2>
          </header>

          <div className="details-body">
            <div className="series-hero">
              <div className="hero-poster">
                {(activeSeriesInfo.info?.cover || activeSeriesInfo.info?.stream_icon) ? (
                  <img src={activeSeriesInfo.info?.cover || activeSeriesInfo.info?.stream_icon} alt="" />
                ) : (
                  <div className="no-poster"><Play size={48} /></div>
                )}
              </div>
              <div className="hero-info">
                <h1>{activeSeriesInfo.info?.name || 'Título Indisponível'}</h1>
                {activeSeriesInfo.info?.genre && <span className="series-genre">{activeSeriesInfo.info?.genre}</span>}
                <div className="meta-row">
                  {activeSeriesInfo.info?.releaseDate && <span>Lançamento: {activeSeriesInfo.info?.releaseDate}</span>}
                  {activeSeriesInfo.info?.rating && <span className="rating-badge">★ {activeSeriesInfo.info?.rating}</span>}
                </div>
                {activeSeriesInfo.info?.plot && (
                  <div className="series-plot">
                    <h3>Sinopse</h3>
                    <p>{activeSeriesInfo.info?.plot}</p>
                  </div>
                )}
                {activeSeriesInfo.info?.cast && (
                  <div className="series-cast">
                    <strong>Elenco:</strong> {activeSeriesInfo.info?.cast}
                  </div>
                )}
              </div>
            </div>

            <div className="series-content-divider"></div>

            <div className="seasons-episodes-section">
              <div className="seasons-selector-row">
                <h3>Temporadas</h3>
                <div className="seasons-tabs">
                  {activeSeriesInfo.seasons && activeSeriesInfo.seasons.length > 0 ? (
                    activeSeriesInfo.seasons.map(season => {
                      const seasonNum = season.season_number;
                      return (
                        <button 
                          key={seasonNum}
                          className={`season-tab-btn ${selectedSeason === seasonNum ? 'active' : ''}`}
                          onClick={() => setSelectedSeason(seasonNum)}
                        >
                          {season.name || `Temporada ${seasonNum}`}
                        </button>
                      );
                    })
                  ) : activeSeriesInfo.episodes ? (
                    Object.keys(activeSeriesInfo.episodes).map(seasonNum => (
                      <button 
                        key={seasonNum}
                        className={`season-tab-btn ${selectedSeason == seasonNum ? 'active' : ''}`}
                        onClick={() => setSelectedSeason(seasonNum)}
                      >
                        Temporada {seasonNum}
                      </button>
                    ))
                  ) : null}
                </div>
              </div>

              <div className="episodes-list">
                {activeSeriesInfo.episodes && activeSeriesInfo.episodes[selectedSeason] && activeSeriesInfo.episodes[selectedSeason].length > 0 ? (
                  activeSeriesInfo.episodes[selectedSeason].map(episode => (
                    <div 
                      key={episode.id} 
                      className="episode-item-card"
                      onClick={() => {
                        onPlay({
                          id: episode.id,
                          title: `${activeSeriesInfo.info?.name} - S${selectedSeason}E${episode.episode_num} - ${episode.title || `Episódio ${episode.episode_num}`}`,
                          url: xtreamService.buildStreamUrl('series', episode.id, episode.container_extension),
                          type: 'series'
                        });
                      }}
                    >
                      <div className="episode-num-circle">{episode.episode_num}</div>
                      <div className="episode-card-info">
                        <h4>{episode.title || `Episódio ${episode.episode_num}`}</h4>
                        {episode.info && episode.info.duration && (
                          <span className="episode-duration">Duração: {episode.info.duration}</span>
                        )}
                      </div>
                      <button className="episode-play-btn">
                        <Play size={16} fill="white" />
                        Assistir
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="no-episodes">Nenhum episódio encontrado para esta temporada.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isLoadingSeriesInfo && (
        <div className="series-loading-overlay">
          <Loader2 className="spinner" size={64} />
          <p>Carregando temporadas e episódios...</p>
        </div>
      )}

      <footer className="catalog-footer">
        <div className="footer-info">
          <span>Categoria ativa: <strong style={{color: 'white'}}>{categories.find(c => c.category_id === activeCategoryId)?.category_name || ''}</strong></span>
        </div>
        <div className="footer-count">
          <span>Total: <strong style={{color: 'var(--primary)'}}>{streams.length}</strong> {type === 'vod' ? 'Filmes' : type === 'series' ? 'Séries' : 'Canais'}</span>
          {searchQuery && (
            <span style={{ marginLeft: '1rem', opacity: 0.7 }}>(Filtrados: <strong>{filteredStreams.length}</strong>)</span>
          )}
        </div>
      </footer>
    </div>
  );
}

function LivePreviewPlayer({ url, title, onExpand }) {
  const videoRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls;
    let flvPlayer;
    setIsLoading(true);
    setError(null);

    const isHls = url.includes('.m3u8');
    const isTs = url.includes('.ts') || url.includes('stream_type=live') || url.includes('/live/');

    const startPlay = async () => {
      try {
        if (isHls && Hls.isSupported()) {
          const hlsConfig = {
            maxMaxBufferLength: 10,
          };
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
            video.play().catch(() => {});
          });
          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
              console.error('Preview HLS Fatal Error:', data);
              setError('Erro de reprodução HLS');
              setIsLoading(false);
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
          flvPlayer.play().catch(() => {});
          flvPlayer.on(mpegts.Events.ERROR, (errType, detail, info) => {
            console.error('Preview TS Error:', errType, detail, info);
            setError('Erro de reprodução TS');
            setIsLoading(false);
          });
          setIsLoading(false);
        } else {
          video.src = getProxiedUrl(url);
          video.addEventListener('loadedmetadata', () => {
            setIsLoading(false);
            video.play().catch(() => {});
          });
          video.addEventListener('error', () => {
            setError('Erro ao carregar canal');
            setIsLoading(false);
          });
        }
      } catch (err) {
        setError('Erro na inicialização do player');
        setIsLoading(false);
      }
    };

    startPlay();

    return () => {
      if (hls) hls.destroy();
      if (flvPlayer) {
        flvPlayer.pause();
        flvPlayer.unload();
        flvPlayer.detachMediaElement();
        flvPlayer.destroy();
      }
    };
  }, [url]);

  return (
    <div className="mini-preview-container">
      <div className="mini-video-wrapper">
        <video 
          ref={videoRef} 
          className="mini-video-element" 
          muted 
          autoPlay 
          playsInline 
        />
        {isLoading && (
          <div className="mini-loader">
            <Loader2 className="spinner" size={24} />
          </div>
        )}
        {error && (
          <div className="mini-error">
            <span>{error}</span>
          </div>
        )}
      </div>
      <div className="mini-preview-info">
        <h4>{title}</h4>
        <button className="btn-primary btn-expand" onClick={onExpand}>
          Assistir em Tela Cheia
        </button>
      </div>
    </div>
  );
}
