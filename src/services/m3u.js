export const M3uService = {
  parseFile: async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const content = e.target.result;
          const parsed = M3uService.parseContent(content);
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = () => reject(new Error('Erro ao ler o arquivo M3U'));
      reader.readAsText(file);
    });
  },

  parseContent: (content) => {
    const lines = content.split(/\r?\n/);
    const items = [];
    let currentItem = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXTINF:')) {
        currentItem = {
          name: 'Desconhecido',
          logo: '',
          group: 'Geral',
          url: ''
        };

        // Extrair nome (tudo após a última vírgula)
        const nameMatch = line.match(/,(.+)$/);
        if (nameMatch) {
          currentItem.name = nameMatch[1].trim();
        }

        // Extrair logo
        const logoMatch = line.match(/tvg-logo="([^"]+)"/);
        if (logoMatch) {
          currentItem.logo = logoMatch[1];
        }

        // Extrair grupo
        const groupMatch = line.match(/group-title="([^"]+)"/);
        if (groupMatch) {
          currentItem.group = groupMatch[1];
        }

      } else if (line && !line.startsWith('#')) {
        // Se for um link (e não for um comentário/tag)
        if (currentItem) {
          currentItem.url = line;
          currentItem.id = `m3u_${items.length}_${Date.now()}`;
          items.push(currentItem);
          currentItem = null;
        }
      }
    }

    // Organizar por categorias
    const categoriesMap = new Map();
    items.forEach(item => {
      const groupName = item.group || 'Sem Categoria';
      if (!categoriesMap.has(groupName)) {
        categoriesMap.set(groupName, {
          category_id: groupName,
          category_name: groupName,
          items: []
        });
      }
      categoriesMap.get(groupName).items.push({
        num: item.id,
        name: item.name,
        stream_type: item.url.includes('.m3u8') ? 'live' : 'movie',
        stream_id: item.url, // Usamos a URL inteira como ID para tocar direto
        stream_icon: item.logo,
        rating: 5,
        direct_url: item.url // Campo customizado para tocar imediatamente
      });
    });

    return Array.from(categoriesMap.values());
  }
};
