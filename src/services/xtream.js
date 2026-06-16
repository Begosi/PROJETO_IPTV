import { getProxiedUrl } from '../utils/url';

export class XtreamService {
  constructor(url, username, password) {
    this.baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    this.username = username;
    this.password = password;
  }

  async fetchApi(action, params = {}) {
    const url = new URL(`${this.baseUrl}/player_api.php`);
    url.searchParams.append('username', this.username);
    url.searchParams.append('password', this.password);
    url.searchParams.append('action', action);
    
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.append(key, value);
    }

    try {
      const targetUrl = getProxiedUrl(url.toString());
      const response = await fetch(targetUrl, {
        method: 'GET'
      });
      if (!response.ok) {
        throw new Error(`Erro na API Xtream: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Falha na requisição Xtream (${action}):`, error);
      throw error;
    }
  }

  async authenticate() {
    // Quando action é vazio, retorna o user_info
    const url = new URL(`${this.baseUrl}/player_api.php`);
    url.searchParams.append('username', this.username);
    url.searchParams.append('password', this.password);
    const targetUrl = getProxiedUrl(url.toString());
    const res = await fetch(targetUrl);
    return res.json();
  }

  async getSeriesInfo(seriesId) {
    return this.fetchApi('get_series_info', { series_id: seriesId });
  }

  async getCategories(type) {
    const actionMap = {
      'live': 'get_live_categories',
      'vod': 'get_vod_categories',
      'series': 'get_series_categories'
    };
    return this.fetchApi(actionMap[type]);
  }

  async getStreams(type, categoryId) {
    const actionMap = {
      'live': 'get_live_streams',
      'vod': 'get_vod_streams',
      'series': 'get_series'
    };
    const params = {};
    if (categoryId !== undefined && categoryId !== null) {
      params.category_id = categoryId;
    }
    return this.fetchApi(actionMap[type], params);
  }

  buildStreamUrl(type, streamId, containerExtension) {
    let pathType = type;
    // Default extension fallback se containerExtension não for passado
    let ext = containerExtension;
    
    if (type === 'live') {
      pathType = 'live';
      if (!ext) ext = 'm3u8'; // Usar m3u8 para Live permite que o Hls.js ou o browser toquem o stream sem problemas de formato.
    } else if (type === 'vod') {
      pathType = 'movie';
      if (!ext) ext = 'mp4';
    } else if (type === 'series') {
      pathType = 'series';
      if (!ext) ext = 'mp4';
    }

    return `${this.baseUrl}/${pathType}/${this.username}/${this.password}/${streamId}.${ext}`;
  }
}
