import { useState, useEffect } from 'react';
import { Tv, Film, Clapperboard, LogOut, RefreshCw, Play } from 'lucide-react';
import localforage from 'localforage';
import { detectBestConnectionMode } from '../utils/url';
import './Dashboard.css';

export function Dashboard({ activeList, onLogout, onSelectType, onRefreshList, onPlay }) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [counts, setCounts] = useState({ live: null, vod: null, series: null });
  const [isLoadingCounts, setIsLoadingCounts] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [continueWatching, setContinueWatching] = useState([]);

  useEffect(() => {
    let active = true;

    const prefetchXtreamData = async (listId, isFirstLoad = false) => {
      try {
        const { XtreamService } = await import('../services/xtream.js');
        const { CacheService } = await import('../services/cache.js');
        
        const xtreamService = new XtreamService(activeList.url, activeList.username, activeList.password);

        let errors = [];
        const safeFetch = (promise) => promise.catch(e => {
          errors.push(e.message);
          return [];
        });

        const [
          liveStreams, liveCats,
          vodStreams, vodCats,
          seriesStreams, seriesCats
        ] = await Promise.all([
          safeFetch(xtreamService.getStreams('live')),
          safeFetch(xtreamService.getCategories('live')),
          safeFetch(xtreamService.getStreams('vod')),
          safeFetch(xtreamService.getCategories('vod')),
          safeFetch(xtreamService.getStreams('series')),
          safeFetch(xtreamService.getCategories('series'))
        ]);
        
        if (errors.length > 0 && active) {
          setFetchError(errors[0]); // Mostra apenas o primeiro erro para não poluir muito
        } else if (active) {
          setFetchError(null);
        }

        await Promise.all([
          CacheService.set(`streams_${listId}_live`, liveStreams),
          CacheService.set(`categories_${listId}_live`, liveCats),
          CacheService.set(`streams_${listId}_vod`, vodStreams),
          CacheService.set(`categories_${listId}_vod`, vodCats),
          CacheService.set(`streams_${listId}_series`, seriesStreams),
          CacheService.set(`categories_${listId}_series`, seriesCats)
        ]);

        if (active) {
          setCounts({
            live: liveStreams.length,
            vod: vodStreams.length,
            series: seriesStreams.length
          });
        }
      } catch (err) {
        console.error('Prefetch error:', err);
      } finally {
        if (active && isFirstLoad) {
          setIsLoadingCounts(false);
        }
      }
    };

    const loadCounts = async (forceRefresh = false) => {
      if (active) setIsLoadingCounts(true);
      const listId = activeList.id;
      try {
        if (activeList.type === 'xtream' && activeList.url) {
          await detectBestConnectionMode(activeList.url, activeList.username, activeList.password);
        }
        const { CacheService } = await import('../services/cache.js');

        if (activeList.type === 'm3u') {
          const { M3uService } = await import('../services/m3u.js');
          
          let catsObj = await CacheService.get(`m3u_parsed_${listId}`);
          let cats;
          if (catsObj && !forceRefresh) {
            cats = catsObj.data;
          } else {
            cats = M3uService.parseContent(activeList.content || '');
            await CacheService.set(`m3u_parsed_${listId}`, cats);
          }
          
          let live = 0;
          let vod = 0;
          cats.forEach(cat => {
            cat.items.forEach(item => {
              if (item.stream_type === 'live') {
                live++;
              } else {
                vod++;
              }
            });
          });
          
          if (active) {
            setCounts({ live, vod, series: vod });
            setIsLoadingCounts(false);
          }
        } else {
          const [cachedLive, cachedVod, cachedSeries] = await Promise.all([
            CacheService.get(`streams_${listId}_live`),
            CacheService.get(`streams_${listId}_vod`),
            CacheService.get(`streams_${listId}_series`)
          ]);

          const hasCache = cachedLive && cachedVod && cachedSeries;
          
          if (hasCache && !forceRefresh) {
            if (active) {
              setCounts({
                live: cachedLive.data.length,
                vod: cachedVod.data.length,
                series: cachedSeries.data.length
              });
              setIsLoadingCounts(false);
            }
            
            const anyExpired = cachedLive.isExpired || cachedVod.isExpired || cachedSeries.isExpired;
            if (anyExpired) {
              prefetchXtreamData(listId, false);
            }
          } else {
            await prefetchXtreamData(listId, true);
          }
        }
      } catch (err) {
        console.error('Failed to load counts:', err);
        if (active) setIsLoadingCounts(false);
      }
    };

    loadCounts();
    window.__loadCounts = loadCounts;

    return () => {
      active = false;
      delete window.__loadCounts;
    };
  }, [activeList]);

  useEffect(() => {
    let active = true;
    const loadContinueWatching = async () => {
      const listId = activeList.id;
      let cwVod = [];
      let cwSeries = [];
      try {
        cwVod = await localforage.getItem(`continue_watching_${listId}_vod`) || [];
        cwSeries = await localforage.getItem(`continue_watching_${listId}_series`) || [];
      } catch (e) {}
      
      const combined = [...cwVod, ...cwSeries].sort((a, b) => (b.lastWatched || 0) - (a.lastWatched || 0)).slice(0, 15);
      if (active) {
        setContinueWatching(combined);
      }
    };
    loadContinueWatching();
    return () => { active = false; };
  }, [activeList]);

  const handlePlayCW = async (item) => {
    if (!onPlay) return;
    
    try {
      if (activeList.type === 'xtream') {
        const { XtreamService } = await import('../services/xtream.js');
        const service = new XtreamService(activeList.url, activeList.username, activeList.password);
        let streamUrl = '';
        if (item.type === 'vod') {
          streamUrl = await service.getVodStreamUrl(item.id, item.stream_obj?.container_extension);
        } else if (item.type === 'series') {
          streamUrl = await service.getSeriesStreamUrl(item.id, item.stream_obj?.container_extension);
        }
        onPlay({ 
          url: streamUrl, 
          title: item.title, 
          id: item.id, 
          type: item.type, 
          stream: item.stream_obj, 
          listId: activeList.id 
        });
      } else if (activeList.type === 'm3u') {
        onPlay({
          url: item.stream_obj.url,
          title: item.title,
          id: item.id,
          type: item.type,
          stream: item.stream_obj,
          listId: activeList.id
        });
      }
    } catch (err) {
      alert('Erro ao carregar o vídeo: ' + err.message);
    }
  };
  
  const currentDate = new Date().toLocaleDateString('pt-BR', { 
    month: 'long', 
    day: 'numeric', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (activeList.type === 'm3u') {
        if (onRefreshList) {
          await onRefreshList(activeList);
        }
      }
      
      const { CacheService } = await import('../services/cache.js');
      await CacheService.clearListCache(activeList.id);
      
      if (window.__loadCounts) {
        await window.__loadCounts(true);
      }
      alert('Lista atualizada com sucesso!');
    } catch (err) {
      alert(`Erro ao sincronizar a lista: ${err.message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-brand">
          <img src="/orbita-logo.png" alt="ÓRBITA IPTV" style={{ height: '40px', objectFit: 'contain' }} />
          <span className="current-date">{currentDate}</span>
        </div>
        <div className="header-actions" style={{ display: 'flex', gap: '1rem' }}>
          {((activeList.type === 'm3u' && activeList.url) || activeList.type === 'xtream') && (
            <button 
              className="btn-secondary" 
              onClick={handleRefresh} 
              disabled={isRefreshing}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <RefreshCw size={18} className={isRefreshing ? 'spinner' : ''} />
              {isRefreshing ? 'Atualizando...' : 'Atualizar Lista'}
            </button>
          )}
          <button className="btn-secondary" onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <LogOut size={18} /> Sair da Lista
          </button>
        </div>
      </header>

      {fetchError && (
        <div style={{ background: 'rgba(239, 68, 68, 0.2)', padding: '1rem', margin: '0 2rem', borderRadius: '8px', border: '1px solid #ef4444', color: '#fff' }}>
          <strong>Erro de Conexão:</strong> {fetchError}
        </div>
      )}

      <div className="dashboard-grid">
        <div className="dashboard-card live-tv" onClick={() => onSelectType('live')}>
          <div className="card-icon">
            <Tv size={64} />
          </div>
          <div>
            <h2>TV AO VIVO</h2>
            <span className="card-count-label">
              {isLoadingCounts ? 'Carregando...' : `${counts.live || 0} canais`}
            </span>
          </div>
          <button className="card-action">Assistir</button>
        </div>

        <div className="dashboard-card movies" onClick={() => onSelectType('vod')}>
          <div className="card-icon">
            <Film size={64} />
          </div>
          <div>
            <h2>FILMES</h2>
            <span className="card-count-label">
              {isLoadingCounts ? 'Carregando...' : `${counts.vod || 0} títulos`}
            </span>
          </div>
          <button className="card-action">Assistir</button>
        </div>

        <div className="dashboard-card series" onClick={() => onSelectType('series')}>
          <div className="card-icon">
            <Clapperboard size={64} />
          </div>
          <div>
            <h2>SÉRIES</h2>
            <span className="card-count-label">
              {isLoadingCounts ? 'Carregando...' : `${counts.series || 0} séries`}
            </span>
          </div>
          <button className="card-action">Assistir</button>
        </div>
      </div>

      {continueWatching.length > 0 && (
        <div className="continue-watching-section" style={{ padding: '0 2rem', marginTop: '2rem' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem', color: '#fff' }}>Continue Assistindo</h2>
          <div className="continue-watching-row" style={{ 
            display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem',
            scrollbarWidth: 'thin', scrollbarColor: 'var(--primary) transparent' 
          }}>
            {continueWatching.map(item => {
              const progressPct = item.duration ? (item.progress / item.duration) * 100 : 0;
              return (
                <div 
                  key={`${item.type}_${item.id}`} 
                  className="cw-card" 
                  onClick={() => handlePlayCW(item)}
                  style={{
                    flex: '0 0 auto',
                    width: '200px',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    transition: 'transform 0.2s',
                    position: 'relative'
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <div style={{ position: 'relative', aspectRatio: '16/9', background: '#111' }}>
                    {item.stream_icon ? (
                      <img src={item.stream_icon} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.target.src = 'https://via.placeholder.com/300x169?text=Sem+Imagem'; }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#222' }}>
                        <Play size={32} color="rgba(255,255,255,0.2)" />
                      </div>
                    )}
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '4px', background: 'rgba(255,255,255,0.2)' }}>
                      <div style={{ width: `${progressPct}%`, height: '100%', background: '#e50914' }} />
                    </div>
                  </div>
                  <div style={{ padding: '0.75rem' }}>
                    <h3 style={{ fontSize: '0.9rem', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</h3>
                    <span style={{ fontSize: '0.75rem', color: '#aaa', textTransform: 'capitalize' }}>{item.type === 'vod' ? 'Filme' : 'Série'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <footer className="dashboard-footer">
        <div className="footer-info">
          <span>Lista: <strong style={{color: 'white'}}>{activeList.name}</strong> ({activeList.type.toUpperCase()})</span>
        </div>
        <div className="footer-status">
          Conectado: <span className="status-ok">OK</span>
        </div>
      </footer>
    </div>
  );
}
