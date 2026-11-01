/**
 * Zelf-gehoste server: de app + de Twitch-proxy in één proces.
 *
 *   npm run build && npm start        → http://localhost:8080
 *
 * Geen dependencies: Node 20+ heeft `http` en `fetch` ingebouwd. De server
 * serveert `dist/` en proxyt `/twitch-hls/...` naar Twitch met CORS-headers
 * (Twitch stuurt die zelf niet, en zonder playlist kunnen we de latency niet
 * meten of de stream afspelen).
 *
 * Instellingen via omgevingsvariabelen:
 *   PORT=8080        poort
 *   HOST=0.0.0.0     interface
 *   ALLOWED_HOSTS=   komma-gescheiden lijst van hostnamen die de proxy mogen
 *                    gebruiken (leeg = alle). Handig als je de proxy op internet
 *                    zet en niet wilt dat anderen hem als open proxy gebruiken.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const TWITCH = /^https:\/\/[^/]*(ttvnw\.net|twitch\.tv)\//;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const hostHeader = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${hostHeader}`);

  if (url.pathname.startsWith('/twitch-hls/')) {
    await proxyTwitch(url, req, res);
    return;
  }

  serveStatic(url.pathname, res);
});

// Segmenten en playlists zijn kort geldig; bij afsluiten gewoon stoppen.
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

server.listen(PORT, HOST, () => {
  console.log(`Stream Syncer draait op http://localhost:${PORT}`);
  if (!existsSync(DIST)) {
    console.warn('Let op: dist/ bestaat nog niet. Draai eerst `npm run build`.');
  }
});

/**
 * `/twitch-hls/https:/usher.ttvnw.net/...` → haalt de echte Twitch-URL op en
 * geeft het antwoord terug met CORS-headers.
 */
async function proxyTwitch(url, req, res) {
  if (ALLOWED_HOSTS.length > 0) {
    // Hostname van de pagina die de proxy gebruikt (Origin-header).
    let origin = '';
    try {
      origin = new URL(req.headers.origin ?? '').hostname.toLowerCase();
    } catch {
      origin = '';
    }
    if (!ALLOWED_HOSTS.includes(origin)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Origin not allowed.');
      return;
    }
  }

  let target = decodeURIComponent(url.pathname.slice('/twitch-hls/'.length));
  // "https:/host/..." (sommige servers voegen "//" samen) herstellen.
  target = target.replace(/^https:\/(?!\/)/, 'https://').replace(/^http:\/(?!\/)/, 'http://');
  if (!target.startsWith('http')) target = `https://${target.replace(/^\/+/, '')}`;
  if (!TWITCH.test(target)) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('Only Twitch URLs are allowed.');
    return;
  }

  try {
    const upstream = await fetch(`${target}${url.search}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        Accept: '*/*',
        Origin: 'https://www.twitch.tv',
        Referer: 'https://www.twitch.tv/',
      },
    });
    res.writeHead(upstream.status, {
      'access-control-allow-origin': '*',
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    if (!upstream.body) {
      res.end();
      return;
    }
    // Streamen, zodat segmenten niet eerst volledig in het geheugen komen.
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (error) {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`Proxy error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Serveert `dist/`; onbekende paden vallen terug op index.html (SPA). */
function serveStatic(pathname, res) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = join(DIST, safe);
  if (!file.startsWith(DIST)) file = join(DIST, 'index.html');
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');

  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found. Run `npm run build` first.');
    return;
  }

  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const immutable = file.includes(`${join(DIST, 'assets')}`);
  res.writeHead(200, {
    'content-type': type,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}
