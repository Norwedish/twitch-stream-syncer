/**
 * Cloudflare Worker: Twitch-proxy.
 *
 * Twitch stuurt geen CORS-headers op zijn playlists en segmenten, dus de
 * browser mag ze niet lezen. Deze Worker haalt ze server-side op en zet er
 * CORS-headers op. Draait op een eigen domein (bv. worker.norwelab.nl), zodat
 * de statische app (GitHub Pages) hem kan aanroepen.
 *
 * `wrangler.jsonc` serveert daarnaast optioneel `dist/` als statische
 * bestanden; dan draait de app ook direct op de Worker.
 *
 * - `/twitch-hls/<host>/<path>` → Twitch-URL ophalen met CORS.
 * - Alle andere paden → `dist/` (als er assets geconfigureerd zijn).
 */
interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

const ALLOWED = /^https:\/\/[^/]*(ttvnw\.net|twitch\.tv)\//;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname.startsWith('/twitch-hls/')) {
      return proxyTwitch(url);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Stream Syncer proxy. Use /twitch-hls/<twitch-url>.', {
      status: 404,
      headers: corsHeaders(),
    });
  },
};

function corsHeaders(): Headers {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Range, Content-Type');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  return headers;
}

async function proxyTwitch(url: URL): Promise<Response> {
  let target = url.pathname.slice('/twitch-hls/'.length);
  // Restore "https:/host/..." in case "//" was collapsed somewhere.
  target = target.replace(/^https:\/(?!\/)/, 'https://').replace(/^http:\/(?!\/)/, 'http://');
  if (!target.startsWith('http')) target = `https://${target.replace(/^\/+/, '')}`;
  if (!ALLOWED.test(target)) {
    return new Response('Only Twitch URLs are allowed.', { status: 400, headers: corsHeaders() });
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

  const headers = corsHeaders();
  const type = upstream.headers.get('content-type');
  if (type) headers.set('Content-Type', type);
  headers.set('Cache-Control', 'no-store');

  return new Response(upstream.body, { status: upstream.status, headers });
}
