// Verifica se a aplicação está rodando no ambiente Electron (Desktop) ou Navegador (Web/Vercel)
export const isElectron = typeof window !== 'undefined' && window.require !== undefined;

/**
 * Retorna a URL original no desktop (Electron), ou a URL roteada através de um proxy
 * de CORS e HTTPS caso esteja rodando no navegador (Vercel/Web) para evitar bloqueios de CORS e Conteúdo Misto.
 */
export function getProxiedUrl(url) {
  if (!url) return url;
  
  // Se for navegador, redireciona pelo proxy corsproxy.io
  if (!isElectron) {
    return `https://corsproxy.io/?${encodeURIComponent(url)}`;
  }
  return url;
}
