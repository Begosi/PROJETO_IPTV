// Verifica se a aplicação está rodando no ambiente Electron (Desktop) ou Navegador (Web/Vercel)
export const isElectron = typeof window !== 'undefined' && window.require !== undefined;
export const isCapacitor = typeof window !== 'undefined' && window.Capacitor !== undefined;

/**
 * Retorna a URL original no desktop (Electron), ou a URL roteada através de um proxy
 * de CORS e HTTPS caso esteja rodando no navegador (Vercel/Web) para evitar bloqueios de CORS e Conteúdo Misto.
 */
export function getProxiedUrl(url) {
  if (!url) return url;
  if (isElectron || isCapacitor) return url;

  try {
    if (url.includes('/api/proxy')) {
      return url;
    }

    // Em ambiente de desenvolvimento local (Vite), usa o nosso proxy interno (sem limites de tamanho!)
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
      return `/api/proxy?url=${encodeURIComponent(url)}`;
    }

    const isHlsOrSegment = url.includes('.m3u8') || url.includes('.ts') || url.includes('/key/') || url.includes('/live/') || url.includes('stream_type=live');
    if (isHlsOrSegment) {
      return `/api/proxy?url=${encodeURIComponent(url)}`;
    }

    const parsed = new URL(url);
    const hostname = parsed.hostname;
    
    // Verifica se temos uma configuração de conexão salva para este hostname
    const configStr = localStorage.getItem(`proxy_config_${hostname}`);
    if (configStr) {
      const config = JSON.parse(configStr);
      if (config.mode === 'direct-https') {
        // Faz upgrade automático do protocolo para HTTPS para evitar Mixed Content
        parsed.protocol = 'https:';
        if (parsed.port === '80') {
          parsed.port = '';
        }
        return parsed.toString();
      } else if (config.mode === 'proxy') {
        return config.proxyTemplate.replace('{url}', encodeURIComponent(url));
      } else if (config.mode === 'direct') {
        if (window.location.protocol === 'https:' && parsed.protocol === 'http:') {
          parsed.protocol = 'https:';
          if (parsed.port === '80') {
            parsed.port = '';
          }
          return parsed.toString();
        }
        return url;
      }
    }

    // Comportamento fallback padrão se ainda não tiver detectado:
    // Se a página principal está rodando sobre HTTPS, tenta fazer upgrade para HTTPS direto
    if (window.location.protocol === 'https:') {
      if (parsed.protocol === 'http:') {
        const secureUrl = new URL(url);
        secureUrl.protocol = 'https:';
        if (secureUrl.port === '80') secureUrl.port = '';
        return secureUrl.toString();
      }
    }
  } catch (e) {
    console.error('Erro ao processar URL em getProxiedUrl:', e);
  }

  // Fallback padrão se não houver detecção
  return `https://corsproxy.io/?${encodeURIComponent(url)}`;
}

/**
 * Detecta dinamicamente a melhor forma de se conectar ao servidor de IPTV.
 * Testa conexão direta por HTTPS (com upgrade de protocolo) e múltiplos proxies de CORS públicos.
 */
export async function detectBestConnectionMode(url, username = '', password = '') {
  if (!url || isElectron || isCapacitor) return { mode: 'direct' };

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const cacheKey = `proxy_config_${hostname}`;

    // Força o uso do proxy local se estiver em desenvolvimento (Vite)
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
      return { mode: 'proxy', proxyTemplate: '/api/proxy?url={url}', timestamp: Date.now() };
    }

    // Verifica se já detectamos recentemente para evitar requisições redundantes
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsedCache = JSON.parse(cached);
      // TTL de 1 hora
      if (parsedCache.timestamp && Date.now() - parsedCache.timestamp < 3600000) {
        // Ignora cache 'direct' se estivermos em HTTPS (pois 'direct' causará Mixed Content)
        if (parsedCache.mode === 'direct' && window.location.protocol === 'https:') {
          console.log(`[ProxyDetector] Ignorando cache 'direct' para ${hostname} pois a página está em HTTPS`);
        } else {
          console.log(`[ProxyDetector] Usando configuração cacheada para ${hostname}:`, parsedCache.mode);
          return parsedCache;
        }
      }
    }

    console.log(`[ProxyDetector] Detectando melhor modo de conexão para ${hostname}...`);

    // Opção 1: Upgrade direto para HTTPS
    const directHttpsUrl = new URL(url);
    directHttpsUrl.protocol = 'https:';
    if (directHttpsUrl.port === '80') directHttpsUrl.port = '';

    // Endpoint de teste no Xtream Codes com credenciais (caso existam) para garantir CORS correto de 200 OK
    let testUrlDirect = `${directHttpsUrl.origin}/player_api.php`;
    if (username && password) {
      testUrlDirect += `?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    }

    try {
      console.log(`[ProxyDetector] Testando conexão HTTPS direta: ${testUrlDirect}`);
      // Usamos GET. Mesmo que dê erro de credenciais (como 400 ou 200 de boas-vindas), se não der erro de CORS/Rede, funciona!
      const res = await fetch(testUrlDirect, { method: 'GET', mode: 'cors' });
      console.log(`[ProxyDetector] Conexão HTTPS direta funcionou com status: ${res.status}`);
      const config = { mode: 'direct-https', timestamp: Date.now() };
      localStorage.setItem(cacheKey, JSON.stringify(config));
      return config;
    } catch (e) {
      console.warn(`[ProxyDetector] Conexão HTTPS direta falhou para ${hostname}:`, e.message);
    }

    // Opção 2: Testar proxies de CORS públicos alternativos
    const proxies = [
      { name: 'allorigins', template: 'https://api.allorigins.win/raw?url={url}' },
      { name: 'corsproxy.io', template: 'https://corsproxy.io/?{url}' },
      { name: 'codetabs', template: 'https://api.codetabs.com/v1/proxy?quest={url}' }
    ];

    for (const proxy of proxies) {
      // Usamos a URL de teste Xtream (em HTTP ou HTTPS conforme original) com credenciais para evitar 404/erros do provedor
      let targetTestUrl = `${parsed.origin}/player_api.php`;
      if (username && password) {
        targetTestUrl += `?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
      }
      const testUrlProxied = proxy.template.replace('{url}', encodeURIComponent(targetTestUrl));
      try {
        console.log(`[ProxyDetector] Testando proxy ${proxy.name}: ${testUrlProxied}`);
        const res = await fetch(testUrlProxied, { method: 'GET' });
        if (res.ok) {
          console.log(`[ProxyDetector] Proxy ${proxy.name} funcionou com sucesso!`);
          const config = {
            mode: 'proxy',
            proxyTemplate: proxy.template,
            proxyName: proxy.name,
            timestamp: Date.now()
          };
          localStorage.setItem(cacheKey, JSON.stringify(config));
          return config;
        }
      } catch (e) {
        console.warn(`[ProxyDetector] Proxy ${proxy.name} falhou:`, e.message);
      }
    }

    // Opção 3: Conexão direta HTTP (se estiver em HTTP ou se tudo falhar)
    console.warn(`[ProxyDetector] Nenhum método seguro ou proxy funcionou. Utilizando conexão direta padrão.`);
    const config = { mode: 'direct', timestamp: Date.now() };
    localStorage.setItem(cacheKey, JSON.stringify(config));
    return config;
  } catch (e) {
    console.error('[ProxyDetector] Erro no processo de detecção:', e);
    return { mode: 'direct' };
  }
}

/**
 * Resolve o redirecionamento de uma URL HTTP de vídeo para obter o destino final.
 * Útil para evitar erros de Mixed Content no WebView (Capacitor) quando o servidor IPTV
 * faz redirecionamento de uma URL HTTP para um CDN ou worker HTTPS (como Cloudflare Workers).
 */
export async function resolveRedirect(url) {
  if (!url) return url;

  // Apenas precisamos resolver se a página principal estiver rodando em HTTPS (ex: https://localhost no Capacitor)
  // e a URL informada for HTTP, pois isso causaria bloqueio de Mixed Content.
  const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isHttpUrl = url.startsWith('http://');

  if (!isHttpsPage || !isHttpUrl) {
    return url;
  }

  try {
    console.log('[UrlResolver] Resolvendo redirecionamento HTTP para evitar Mixed Content:', url);
    
    // Em Capacitor, se o plugin CapacitorHttp estiver ativo, o fetch global é interceptado nativamente,
    // o que permite fazer requisições HTTP a partir de HTTPS (contornando Mixed Content/CORS).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    // Tenta primeiro com HEAD para economizar banda/tempo
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow'
      });
      clearTimeout(timeoutId);
      
      if (response.url && response.url !== url) {
        console.log('[UrlResolver] Redirecionamento resolvido via HEAD:', response.url);
        return response.url;
      }
    } catch (err) {
      console.warn('[UrlResolver] Método HEAD falhou ou foi bloqueado, tentando com GET abortado:', err);
    }

    // Se o HEAD falhar, tentamos com GET e abortamos a transferência do corpo de mídia imediatamente
    const getController = new AbortController();
    const getTimeoutId = setTimeout(() => getController.abort(), 4000);

    const response = await fetch(url, {
      method: 'GET',
      signal: getController.signal,
      redirect: 'follow'
    });

    clearTimeout(getTimeoutId);
    const resolvedUrl = response.url;

    // Aborta o download imediatamente para economizar dados
    getController.abort();

    if (resolvedUrl && resolvedUrl !== url) {
      console.log('[UrlResolver] Redirecionamento resolvido via GET:', resolvedUrl);
      return resolvedUrl;
    }
  } catch (error) {
    console.error('[UrlResolver] Erro ao resolver redirecionamento do vídeo:', error);
  }

  return url;
}

