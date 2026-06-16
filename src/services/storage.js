import localforage from 'localforage';

// Configura a instância do localforage para nossa aplicação
const store = localforage.createInstance({
  name: 'PortalIPTV',
  storeName: 'iptv_data'
});

export const StorageService = {
  // Salvar uma lista completa
  saveList: async (list) => {
    try {
      const existingLists = await store.getItem('playlists') || [];
      const newList = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...list
      };
      const updatedLists = [...existingLists, newList];
      await store.setItem('playlists', updatedLists);
      return newList;
    } catch (error) {
      console.error('Erro ao salvar lista:', error);
      throw error;
    }
  },

  // Recuperar todas as listas
  getLists: async () => {
    try {
      return await store.getItem('playlists') || [];
    } catch (error) {
      console.error('Erro ao recuperar listas:', error);
      return [];
    }
  },

  // Excluir uma lista
  deleteList: async (id) => {
    try {
      const existingLists = await store.getItem('playlists') || [];
      const updatedLists = existingLists.filter(list => list.id !== id);
      await store.setItem('playlists', updatedLists);
    } catch (error) {
      console.error('Erro ao excluir lista:', error);
      throw error;
    }
  },

  // Atualizar uma lista existente
  updateList: async (id, updatedFields) => {
    try {
      const existingLists = await store.getItem('playlists') || [];
      const updatedLists = existingLists.map(list => {
        if (list.id === id) {
          return { ...list, ...updatedFields };
        }
        return list;
      });
      await store.setItem('playlists', updatedLists);
    } catch (error) {
      console.error('Erro ao atualizar lista:', error);
      throw error;
    }
  }
};
