import { useState, useEffect } from 'react';
import { Tv, Film, Clapperboard, LogOut, RefreshCw } from 'lucide-react';
import { detectBestConnectionMode } from '../utils/url';
import './Dashboard.css';

export function Dashboard({ activeList, onLogout, onSelectType, onRefreshList }) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [counts, setCounts] = useState({ live: null, vod: null, series: null });
  const [isLoadingCounts, setIsLoadingCounts] = useState(true);

  useEffect(() => {
    let active = true;

    const prefetchXtreamData = async (listId, isFirstLoad = false) => {
      try {
        const { XtreamService } = await import('../services/xtream.js');
        const { CacheService } = await import('../services/cache.js');
        
        const xtreamService = new XtreamService(activeList.url, activeList.username, activeList.password);

        const [
          liveStreams, liveCats,
          vodStreams, vodCats,
          seriesStreams, seriesCats
        ] = await Promise.all([
          xtreamService.getStreams('live').catch(() => []),
          xtreamService.getCategories('live').catch(() => []),
          xtreamService.getStreams('vod').catch(() => []),
          xtreamService.getCategories('vod').catch(() => []),
          xtreamService.getStreams('series').catch(() => []),
          xtreamService.getCategories('series').catch(() => [])
        ]);

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
          await detectBestConnectionMode(activeList.url);
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
          <h1 className="brand-title">PORTAL <span>IPTV</span></h1>
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

      <div className="dashboard-grid">
        <div className="dashboard-card live-tv" onClick={() => onSelectType('live')}>
          <div className="card-icon">
            <Tv size={64} />
          </div>
          <h2>TV AO VIVO</h2>
          <span className="card-count-label">
            {isLoadingCounts ? 'Carregando...' : `${counts.live || 0} canais`}
          </span>
          <button className="card-action">Assistir</button>
        </div>

        <div className="dashboard-card movies" onClick={() => onSelectType('vod')}>
          <div className="card-icon">
            <Film size={64} />
          </div>
          <h2>FILMES</h2>
          <span className="card-count-label">
            {isLoadingCounts ? 'Carregando...' : `${counts.vod || 0} títulos`}
          </span>
          <button className="card-action">Assistir</button>
        </div>

        <div className="dashboard-card series" onClick={() => onSelectType('series')}>
          <div className="card-icon">
            <Clapperboard size={64} />
          </div>
          <h2>SÉRIES</h2>
          <span className="card-count-label">
            {isLoadingCounts ? 'Carregando...' : `${counts.series || 0} séries`}
          </span>
          <button className="card-action">Assistir</button>
        </div>
      </div>

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
