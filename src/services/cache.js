import localforage from 'localforage';

// Instância do localforage para o cache de conteúdos
const cacheStore = localforage.createInstance({
  name: 'PortalIPTV',
  storeName: 'iptv_cache'
});

// Cache em memória para acesso instantâneo síncrono
const memoryCache = new Map();

export const CacheService = {
  // Salvar dados no cache (IndexedDB + Memória)
  set: async (key, data) => {
    try {
      const cacheObj = {
        data,
        timestamp: Date.now()
      };
      memoryCache.set(key, cacheObj);
      await cacheStore.setItem(key, cacheObj);
    } catch (error) {
      console.error(`Erro ao salvar cache [${key}]:`, error);
    }
  },

  // Obter dados do cache (checa memória primeiro, depois IndexedDB)
  get: async (key, maxAgeMs = 2 * 60 * 60 * 1000) => {
    try {
      // 1. Tenta memória (0ms)
      let cacheObj = memoryCache.get(key);

      // 2. Tenta IndexedDB
      if (!cacheObj) {
        cacheObj = await cacheStore.getItem(key);
        if (cacheObj) {
          memoryCache.set(key, cacheObj); // Salva em memória para o próximo acesso
        }
      }

      if (!cacheObj) return null;

      const isExpired = Date.now() - cacheObj.timestamp > maxAgeMs;
      return {
        data: cacheObj.data,
        timestamp: cacheObj.timestamp,
        isExpired
      };
    } catch (error) {
      console.error(`Erro ao ler cache [${key}]:`, error);
      return null;
    }
  },

  // Remover cache associado a uma lista específica (ex: ao atualizar ou deletar)
  clearListCache: async (listId) => {
    try {
      // Limpa em memória
      for (const key of memoryCache.keys()) {
        if (key.includes(listId)) {
          memoryCache.delete(key);
        }
      }

      // Limpa no IndexedDB
      const keys = await cacheStore.keys();
      for (const key of keys) {
        if (key.includes(listId)) {
          await cacheStore.removeItem(key);
        }
      }
      console.log(`Cache da lista ${listId} limpo com sucesso.`);
    } catch (error) {
      console.error(`Erro ao limpar cache da lista [${listId}]:`, error);
    }
  },

  // Limpar todo o cache
  clearAll: async () => {
    memoryCache.clear();
    await cacheStore.clear();
  }
};
