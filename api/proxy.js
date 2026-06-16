
export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    // Configura headers para simular requisição de player de mídia legítimo (evita bloqueios de bot do Cloudflare em datacenters)
    const headers = {
      'User-Agent': 'VLC/3.0.16',
    };

    const response = await fetch(url, {
      headers,
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || '';
    
    // Adiciona cabeçalhos CORS para permitir acesso do reprodutor na Vercel
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    // Se for OPTIONS (preflight), responde 200 imediatamente
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const finalUrl = response.url || url;

    // Se for playlist HLS (.m3u8), precisamos reescrever os caminhos internos (chaves e segmentos)
    // para que também passem pelo proxy, evitando bloqueio de Mixed Content no navegador.
    if (url.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('mpegURL')) {
      const bodyText = await response.text();
      
      const hostUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
      const proxyBaseUrl = `${hostUrl}/api/proxy`;
      
      const rewrittenBody = rewritePlaylist(bodyText, finalUrl, proxyBaseUrl);
      
      res.setHeader('Content-Type', 'application/x-mpegURL');
      return res.status(200).send(rewrittenBody);
    }

    // Para outros arquivos (como segmentos .ts, chaves de criptografia, etc.), apenas repassa o stream binário
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const buffer = await response.arrayBuffer();
    return res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    console.error('API Proxy Error:', error);
    return res.status(500).send('API Proxy Error: ' + error.message);
  }
}

function rewritePlaylist(bodyText, finalUrl, proxyBaseUrl) {
  const resolveUrl = (path) => {
    try {
      return new URL(path, finalUrl).toString();
    } catch (e) {
      return path;
    }
  };

  const lines = bodyText.split('\n');
  const rewrittenLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Reescreve a URI da chave de descriptografia (ex: #EXT-X-KEY:METHOD=AES-128,URI="/key/...")
    if (trimmed.startsWith('#EXT-X-KEY:')) {
      return trimmed.replace(/URI="([^"]+)"/, (match, uri) => {
        const absoluteUri = resolveUrl(uri);
        const proxiedUri = `${proxyBaseUrl}?url=${encodeURIComponent(absoluteUri)}`;
        return `URI="${proxiedUri}"`;
      });
    }

    // Reescreve a URL do fragmento de vídeo .ts
    if (!trimmed.startsWith('#')) {
      const absoluteSegmentUrl = resolveUrl(trimmed);
      return `${proxyBaseUrl}?url=${encodeURIComponent(absoluteSegmentUrl)}`;
    }

    return line;
  });

  return rewrittenLines.join('\n');
}
