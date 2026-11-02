import { defineConfig, type Plugin } from 'vite';

/**
 * Twitch serves its HLS playlists without CORS headers, so the browser may not
 * read them. Without the playlist we cannot measure latency or play the stream
 * in a <video>. This dev proxy fetches the playlist (and the segments)
 * server-side and adds CORS headers.
 *
 * In production `worker/index.ts` does the same (Cloudflare Workers).
 */
function twitchProxy(): Plugin {
  return {
    name: 'twitch-hls-proxy',
    configureServer(server) {
      server.middlewares.use('/twitch-hls', async (req, res) => {
        // Vite strips the mount prefix from req.url, so the path starts with "/".
        const rawUrl = req.url ?? '';
        let target = rawUrl.replace(/^\/+/, '');
        // Vite collapses "//" in URLs ("https:/host"); restore it, repeatedly,
        // because an extra "https:/" can sneak in.
        for (let i = 0; i < 3; i++) {
          target = target.replace(/^https:\/(?!\/)/, 'https://').replace(/^http:\/(?!\/)/, 'http://');
          target = target.replace(/^https:\/\/https:\/\//, 'https://').replace(/^https:\/\/https:\//, 'https://');
        }
        if (target.startsWith('https://https:')) target = target.slice('https://'.length);
        if (!target.startsWith('http')) target = `https://${target}`;
        if (!/^https:\/\/[^/]*(ttvnw\.net|twitch\.tv)\//.test(target)) {
          res.statusCode = 400;
          res.end(`Only Twitch URLs are allowed. (${target.slice(0, 120)})`);
          return;
        }
        try {
          const upstream = await fetch(target, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
              Accept: '*/*',
              Origin: 'https://www.twitch.tv',
              Referer: 'https://www.twitch.tv/',
            },
          });
          res.statusCode = upstream.status;
          res.setHeader('Access-Control-Allow-Origin', '*');
          const type = upstream.headers.get('content-type');
          if (type) res.setHeader('Content-Type', type);
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (error) {
          res.statusCode = 502;
          res.end(`Proxy error: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    },
  };
}

export default defineConfig({
  // Relatieve paden, zodat de build ook op een subpad werkt (GitHub Pages).
  base: './',
  plugins: [twitchProxy()],
  server: {
    port: 5173,
    // Set this to true when the dev server runs on a different machine than the browser.
    // Not needed for Twitch: the player uses the page hostname as its parent.
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          hls: ['hls.js'],
        },
      },
    },
  },
});
