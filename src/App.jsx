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

  return (
    <div className="container">
      <header className="app-header">
        <h1 className="app-title">Portal IPTV</h1>
        <p className="app-subtitle">Seu reprodutor de mídia premium</p>
      </header>

      <main>
        <section className="glass-panel" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
            <h2>Minhas Listas</h2>
            <button className="btn-primary" onClick={() => setIsModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Plus size={20} />
              Nova Lista
            </button>
          </div>

          <div className="lists-grid">
            {lists.length === 0 ? (
              <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', gridColumn: '1 / -1' }}>
                <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(99, 102, 241, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Tv size={30} color="var(--primary)" />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <h3>Nenhuma Lista Encontrada</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
                    Adicione uma lista M3U ou Xtream Codes para começar a assistir.
                  </p>
                </div>
              </div>
            ) : (
              lists.map((list) => (
                <div 
                  key={list.id} 
                  className="glass-card" 
                  style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}
                  onClick={() => setActiveList(list)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Play size={20} color="var(--primary)" />
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.1rem' }}>{list.name}</h3>
                        <span style={{ fontSize: '0.8rem', color: 'var(--secondary)', textTransform: 'uppercase', fontWeight: 'bold' }}>{list.type}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', zIndex: 2 }}>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingList(list);
                          setIsModalOpen(true);
                        }}
                        style={{ color: 'var(--text-secondary)', padding: '0.25rem' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--primary)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                      >
                        <Pencil size={18} />
                      </button>
                      <button 
                        onClick={(e) => handleDeleteList(e, list.id)}
                        style={{ color: 'var(--text-secondary)', padding: '0.25rem' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--danger)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
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
