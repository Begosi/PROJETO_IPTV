import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import https from 'https'
import http from 'http'

const dynamicProxyPlugin = () => ({
  name: 'dynamic-proxy',
  configureServer(server) {
    server.middlewares.use('/api/proxy', (req, res) => {
      const urlParam = req.url.split('url=')[1];
      if (!urlParam) {
        res.statusCode = 400;
        return res.end('Missing url param');
      }
      
      const targetUrl = decodeURIComponent(urlParam);
      const isHttps = targetUrl.startsWith('https');
      const requestLib = isHttps ? https : http;

      // Forward essential request headers
      const requestHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
      };
      if (req.headers.range) {
        requestHeaders['Range'] = req.headers.range;
      }

      const proxyReq = requestLib.get(targetUrl, {
        headers: requestHeaders
      }, (proxyRes) => {
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
        
        // Forward all response headers
        for (const key in proxyRes.headers) {
          const lowerKey = key.toLowerCase();
          if (lowerKey === 'access-control-allow-origin' || lowerKey === 'access-control-allow-methods') continue;
          
          // Rewrite redirects so they also go through our proxy
          if (lowerKey === 'location') {
            let locationUrl = proxyRes.headers[key];
            // Handle relative redirects
            if (locationUrl.startsWith('/')) {
              const urlObj = new URL(targetUrl);
              locationUrl = urlObj.origin + locationUrl;
            } else if (!locationUrl.startsWith('http')) {
              // Path relative
              const urlObj = new URL(targetUrl);
              const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
              locationUrl = urlObj.origin + basePath + locationUrl;
            }
            res.setHeader('Location', `/api/proxy?url=${encodeURIComponent(locationUrl)}`);
            continue;
          }
          
          res.setHeader(key, proxyRes.headers[key]);
        }

        res.writeHead(proxyRes.statusCode);
        proxyRes.pipe(res);
      }).on('error', (err) => {
        res.statusCode = 500;
        res.end(err.message);
      });
      
      req.pipe(proxyReq);
    });
  }
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    dynamicProxyPlugin()
  ],
})
