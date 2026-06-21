import { useState, useEffect } from 'react';
import { Tv, Plus, Trash2, Play, Pencil } from 'lucide-react';
import { getProxiedUrl } from './utils/url';
import { AddListModal } from './components/AddListModal';
import { Dashboard } from './components/Dashboard';
import { Catalog } from './components/Catalog';
import { VideoPlayer } from './components/VideoPlayer';
import { StorageService } from './services/storage';
import './App.css';

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [lists, setLists] = useState([]);
  const [activeList, setActiveList] = useState(null);
  const [activeCatalogType, setActiveCatalogType] = useState(null); // 'live' | 'vod' | 'series'
  const [activeVideo, setActiveVideo] = useState(null);
  const [editingList, setEditingList] = useState(null);

  const loadLists = async () => {
    const savedLists = await StorageService.getLists();
    setLists(savedLists);
  };

  useEffect(() => {
    loadLists();
  }, []);

  const handleSaveList = async (listData) => {
    if (editingList) {
      await StorageService.updateList(editingList.id, listData);
      if (activeList?.id === editingList.id) {
        setActiveList({ ...activeList, ...listData });
      }
    } else {
      await StorageService.saveList(listData);
    }
    await loadLists();
    setIsModalOpen(false);
    setEditingList(null);
  };

  const handleDeleteList = async (e, id) => {
    e.stopPropagation(); // Previne o click no card
    if (confirm('Tem certeza que deseja excluir esta lista?')) {
      await StorageService.deleteList(id);
      await loadLists();
      if (activeList?.id === id) setActiveList(null);
    }
  };

  const handleRefreshList = async (list) => {
    if (list.type !== 'm3u' || !list.url) return;
    const targetUrl = getProxiedUrl(list.url);
    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(`Servidor respondeu com status ${response.status}`);
    }
    const text = await response.text();
    await StorageService.updateList(list.id, { content: text });
    // Atualiza o estado local da lista ativa
    const updatedList = { ...list, content: text };
    setActiveList(updatedList);
    await loadLists();
  };

  if (activeVideo) {
    return (
      <VideoPlayer 
        url={activeVideo.url} 
        title={activeVideo.title} 
        id={activeVideo.id}
        type={activeVideo.type}
        stream={activeVideo.stream}
        listId={activeVideo.listId}
        activeList={activeList}
        onPlay={(videoObj) => setActiveVideo(videoObj)}
        onClose={() => setActiveVideo(null)} 
      />
    );
  }

  if (activeCatalogType) {
    return (
      <Catalog 
        activeList={activeList} 
        type={activeCatalogType} 
        onBack={() => setActiveCatalogType(null)} 
        onPlay={(videoObj) => setActiveVideo(videoObj)}
      />
    );
  }

  if (activeList) {
    return (
      <Dashboard 
        activeList={activeList} 
        onLogout={() => setActiveList(null)} 
        onSelectType={setActiveCatalogType} 
        onRefreshList={handleRefreshList}
        onPlay={(videoObj) => setActiveVideo(videoObj)}
      />
    );
  }

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  return (
    <div className="container">
      <header className="app-header">
        <span className="greeting-text">{getGreeting()}!</span>
        <img src="/orbita-logo.png" alt="ÓRBITA IPTV" style={{ height: '80px', objectFit: 'contain', marginBottom: '1rem' }} />
        <p className="app-subtitle">Seu reprodutor de mídia premium</p>
      </header>

      <main>
        <div className="info-banner">
          <strong>Dica:</strong> Toque em uma de suas listas abaixo para carregar o conteúdo ou adicione uma nova lista para começar.
        </div>

        <section className="glass-panel" style={{ padding: '2rem' }}>
          <div className="lists-header">
            <h2 style={{ margin: 0 }}>Minhas Listas</h2>
            <button className="btn-primary" onClick={() => setIsModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Plus size={20} />
              Adicionar Lista
            </button>
          </div>

          <div className="lists-grid">
            {lists.length === 0 ? (
              <div className="glass-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', gridColumn: '1 / -1', border: '1px dashed var(--primary)' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(99, 102, 241, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Tv size={32} color="var(--primary)" />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <h3>Nenhuma Lista Encontrada</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginTop: '0.5rem', maxWidth: '400px' }}>
                    Sua biblioteca está vazia. Adicione uma nova lista no formato M3U ou Xtream Codes para explorar seus canais, filmes e séries.
                  </p>
                </div>
                <button className="btn-primary" onClick={() => setIsModalOpen(true)} style={{ marginTop: '1rem' }}>
                  Adicionar Agora
                </button>
              </div>
            ) : (
              lists.map((list) => (
                <div 
                  key={list.id} 
                  className="glass-card" 
                  style={{ 
                    padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                    background: 'linear-gradient(145deg, rgba(30, 34, 45, 0.6) 0%, rgba(20, 22, 30, 0.8) 100%)' 
                  }}
                  onClick={() => setActiveList(list)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', overflow: 'hidden' }}>
                    <div style={{ 
                      width: '48px', height: '48px', borderRadius: '12px', flexShrink: 0,
                      background: list.type === 'xtream' ? 'linear-gradient(135deg, var(--primary) 0%, #a855f7 100%)' : 'linear-gradient(135deg, var(--secondary) 0%, #3b82f6 100%)', 
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
                    }}>
                      <Play size={24} color="#fff" fill="#fff" />
                    </div>
                    <div style={{ overflow: 'hidden' }}>
                      <h3 style={{ fontSize: '1.1rem', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{list.name}</h3>
                      <span style={{ 
                        fontSize: '0.75rem', 
                        color: list.type === 'xtream' ? '#c084fc' : '#6ee7b7', 
                        fontWeight: '700', letterSpacing: '0.5px'
                      }}>
                        {list.type === 'xtream' ? 'XTREAM CODES' : 'M3U PLAYLIST'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.25rem', zIndex: 2, flexShrink: 0 }}>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingList(list);
                        setIsModalOpen(true);
                      }}
                      style={{ color: 'var(--text-secondary)', padding: '0.5rem', borderRadius: '8px', background: 'rgba(255,255,255,0.05)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--primary)'; e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                    >
                      <Pencil size={18} />
                    </button>
                    <button 
                      onClick={(e) => handleDeleteList(e, list.id)}
                      style={{ color: 'var(--text-secondary)', padding: '0.5rem', borderRadius: '8px', background: 'rgba(255,255,255,0.05)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      <AddListModal 
        isOpen={isModalOpen} 
        editList={editingList}
        onClose={() => {
          setIsModalOpen(false);
          setEditingList(null);
        }} 
        onSave={handleSaveList} 
      />
    </div>
  );
}

export default App;
