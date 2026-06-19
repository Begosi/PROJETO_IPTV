import { getProxiedUrl, isCapacitor } from '../utils/url';

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
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
      
      const headers = {};
      if (isCapacitor) {
        headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      }
      
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Erro na API Xtream: ${response.status}`);
      }
      const data = await response.json();
      console.log(`[Xtream Response - ${action}]:`, data);
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('A conexão com o servidor está muito lenta (Timeout). Verifique sua internet.');
      }
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
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const headers = {};
    if (isCapacitor) {
      headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }
    
    try {
      const res = await fetch(targetUrl, { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      return await res.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('A conexão com o servidor está muito lenta (Timeout). Verifique sua internet.');
      }
      throw error;
    }
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
    const data = await this.fetchApi(actionMap[type]);
    return this.normalizeData(data);
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
    const data = await this.fetchApi(actionMap[type], params);
    return this.normalizeData(data);
  }

  normalizeData(data) {
    if (!data) return [];
    if (typeof data === 'object' && !Array.isArray(data)) {
      // Detecta erro de autenticação se o servidor devolver só o user_info
      if (data.user_info && data.user_info.auth === 0) {
        throw new Error("Usuário ou senha inválidos para este servidor.");
      }
      // Alguns painéis retornam os dados como um objeto { "0": {...}, "1": {...} } em vez de array
      // Se tiver stream_info ou server_info no meio da resposta, ignoramos, pois não é lista
      if (data.server_info || data.user_info) {
        // Se tem server_info e não tem array, é provável que não tenha conteúdo ou a action falhou
        return [];
      }
      return Object.values(data);
    }
    return Array.isArray(data) ? data : [];
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
