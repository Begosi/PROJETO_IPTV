import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { getProxiedUrl, detectBestConnectionMode } from '../utils/url';
import './AddListModal.css';

export function AddListModal({ isOpen, onClose, onSave, editList }) {
  const [type, setType] = useState('xtream'); // 'xtream' | 'm3u'
  const [m3uSourceType, setM3uSourceType] = useState('url'); // 'url' | 'file'
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    username: '',
    password: '',
    file: null
  });

  useEffect(() => {
    if (isOpen && editList) {
      setType(editList.type);
      setM3uSourceType(editList.m3uSourceType || 'url');
      setFormData({
        name: editList.name || '',
        url: editList.url || '',
        username: editList.username || '',
        password: editList.password || '',
        file: null
      });
    } else if (isOpen) {
      setType('xtream');
      setM3uSourceType('url');
      setFormData({
        name: '',
        url: '',
        username: '',
        password: '',
        file: null
      });
    }
  }, [isOpen, editList]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    
    let payload = { type, name: formData.name };
    
    if (type === 'xtream') {
      payload.url = formData.url;
      payload.username = formData.username;
      payload.password = formData.password;
    } else {
      // type === 'm3u'
      payload.m3uSourceType = m3uSourceType;
      if (m3uSourceType === 'file') {
        if (!formData.file) {
          if (editList && editList.content) {
            payload.content = editList.content;
          } else {
            alert('Por favor, selecione um arquivo .m3u');
            setIsLoading(false);
            return;
          }
        } else {
          try {
            const text = await formData.file.text();
            payload.content = text;
          } catch (err) {
            alert('Erro ao ler o arquivo selecionado.');
            setIsLoading(false);
            return;
          }
        }
      } else {
        // m3uSourceType === 'url'
        if (!formData.url) {
          alert('Por favor, insira a URL da lista M3U.');
          setIsLoading(false);
          return;
        }
        
        const urlChanged = !editList || editList.url !== formData.url;
        if (urlChanged || !editList.content) {
          try {
            payload.url = formData.url;
            const targetUrl = getProxiedUrl(formData.url);
            const response = await fetch(targetUrl);
            if (!response.ok) {
              throw new Error(`O servidor retornou status ${response.status}`);
            }
            const text = await response.text();
            payload.content = text;
          } catch (err) {
            alert(`Erro ao baixar a lista M3U da URL: ${err.message}`);
            setIsLoading(false);
            return;
          }
        } else {
          payload.url = editList.url;
          payload.content = editList.content;
        }
      }
    }
    
    try {
      if (type === 'xtream' && formData.url) {
        await detectBestConnectionMode(formData.url, formData.username, formData.password);
      }
      await onSave(payload);
      setFormData({ name: '', url: '', username: '', password: '', file: null });
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="glass-panel modal-content">
        <div className="modal-header">
          <h2>{editList ? 'Editar Lista' : 'Adicionar Nova Lista'}</h2>
          <button onClick={onClose} className="close-btn"><X size={24} /></button>
        </div>

        <div className="type-selector">
          <button 
            className={`type-btn ${type === 'xtream' ? 'active' : ''}`}
            onClick={() => setType('xtream')}
          >
            Xtream Codes
          </button>
          <button 
            className={`type-btn ${type === 'm3u' ? 'active' : ''}`}
            onClick={() => setType('m3u')}
          >
            Lista M3U
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label>Nome da Lista</label>
            <input 
              type="text" 
              required
              disabled={isLoading}
              placeholder="Ex: Minha TV Premium"
              value={formData.name || ''}
              onChange={e => setFormData({...formData, name: e.target.value})}
            />
          </div>

          {type === 'm3u' && (
            <div className="m3u-source-selector" style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.5rem', padding: '0.25rem 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: '#e2e8f0' }}>
                <input 
                  type="radio" 
                  name="m3uSource" 
                  checked={m3uSourceType === 'url'} 
                  onChange={() => setM3uSourceType('url')}
                  disabled={isLoading}
                  style={{ width: 'auto', cursor: 'pointer', margin: 0 }}
                />
                Link URL (Fornecedor)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: '#e2e8f0' }}>
                <input 
                  type="radio" 
                  name="m3uSource" 
                  checked={m3uSourceType === 'file'} 
                  onChange={() => setM3uSourceType('file')}
                  disabled={isLoading}
                  style={{ width: 'auto', cursor: 'pointer', margin: 0 }}
                />
                Arquivo Local (.m3u)
              </label>
            </div>
          )}

          <div className="form-group">
            {type === 'xtream' ? (
              <>
                <label>URL do Servidor</label>
                <input 
                  type="url" 
                  required
                  disabled={isLoading}
                  placeholder="http://exemplo.com:8080"
                  value={formData.url || ''}
                  onChange={e => setFormData({...formData, url: e.target.value})}
                />
              </>
            ) : m3uSourceType === 'url' ? (
              <>
                <label>URL da Lista M3U</label>
                <input 
                  type="url" 
                  required
                  disabled={isLoading}
                  placeholder="https://exemplo.com/lista.m3u"
                  value={formData.url || ''}
                  onChange={e => setFormData({...formData, url: e.target.value})}
                />
              </>
            ) : (
              <>
                <label>Arquivo .M3U Local</label>
                <input 
                  type="file" 
                  accept=".m3u,.m3u8"
                  required={!editList}
                  disabled={isLoading}
                  onChange={e => setFormData({...formData, file: e.target.files[0]})}
                  style={{ padding: '0.5rem', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', width: '100%' }}
                />
              </>
            )}
          </div>

          {type === 'xtream' && (
            <div className="form-row">
              <div className="form-group">
                <label>Usuário</label>
                <input 
                  type="text" 
                  required
                  disabled={isLoading}
                  value={formData.username || ''}
                  onChange={e => setFormData({...formData, username: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label>Senha</label>
                <input 
                  type="password" 
                  required
                  disabled={isLoading}
                  value={formData.password || ''}
                  onChange={e => setFormData({...formData, password: e.target.value})}
                />
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={isLoading} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={isLoading} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
              {isLoading && <Loader2 className="spinner" size={18} />}
              {isLoading ? (editList ? 'Salvando...' : 'Baixando...') : (editList ? 'Salvar Alterações' : 'Salvar e Conectar')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
