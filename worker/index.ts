/**
 * Cloudflare Worker: static files + Twitch proxy.
 *
 * GitHub Pages can only serve static files, and Twitch sends no CORS headers on
 * its playlists. The production build therefore runs on Cloudflare Workers
 * (free tier): `npm run deploy`.
 *
 * - `/twitch-hls/<host>/<path>` fetches the Twitch URL server-side and adds CORS
 *   headers, just like the dev proxy in `vite.config.ts`.
 * - Every other path is served from `dist/` (the Vite build).
 */
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const ALLOWED = /^https:\/\/[^/]*(ttvnw\.net|twitch\.tv)\//;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/twitch-hls/')) {
      return proxyTwitch(url);
    }

    return env.ASSETS.fetch(request);
  },
};

async function proxyTwitch(url: URL): Promise<Response> {
  let target = url.pathname.slice('/twitch-hls/'.length);
  // Restore "https:/host/..." in case "//" was collapsed somewhere.
  target = target.replace(/^https:\/(?!\/)/, 'https://').replace(/^http:\/(?!\/)/, 'http://');
  if (!target.startsWith('http')) target = `https://${target.replace(/^\/+/, '')}`;
  if (!ALLOWED.test(target)) {
    return new Response('Only Twitch URLs are allowed.', { status: 400 });
  }

  const upstream = await fetch(`${target}${url.search}`, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      Accept: '*/*',
      Origin: 'https://www.twitch.tv',
      Referer: 'https://www.twitch.tv/',
    },
  });

  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  const type = upstream.headers.get('content-type');
  if (type) headers.set('Content-Type', type);
  headers.set('Cache-Control', 'no-store');

  return new Response(upstream.body, { status: upstream.status, headers });
}
