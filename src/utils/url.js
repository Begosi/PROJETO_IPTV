// Verifica se a aplicação está rodando no ambiente Electron (Desktop) ou Navegador (Web/Vercel)
export const isElectron = typeof window !== 'undefined' && window.require !== undefined;

/**
 * Retorna a URL original no desktop (Electron), ou a URL roteada através de um proxy
 * de CORS e HTTPS caso esteja rodando no navegador (Vercel/Web) para evitar bloqueios de CORS e Conteúdo Misto.
 */
export function getProxiedUrl(url) {
  if (!url) return url;
  if (isElectron) return url;

  try {
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
  if (!url || isElectron) return { mode: 'direct' };

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const cacheKey = `proxy_config_${hostname}`;

    // Verifica se já detectamos recentemente para evitar requisições redundantes
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsedCache = JSON.parse(cached);
      // TTL de 1 hora
      if (parsedCache.timestamp && Date.now() - parsedCache.timestamp < 3600000) {
        console.log(`[ProxyDetector] Usando configuração cacheada para ${hostname}:`, parsedCache.mode);
        return parsedCache;
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
