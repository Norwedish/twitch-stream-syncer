import { defineConfig, type Plugin } from 'vite';

/**
 * Twitch levert zijn HLS-playlists zonder CORS-headers. De browser mag ze dus
 * niet lezen, en zonder playlist kunnen we de latency niet meten en de stream
 * niet in een <video> spelen. Deze dev-proxy haalt de playlist (en de
 * segmenten) server-side op en zet er CORS-headers op.
 *
 * Alleen voor `npm run dev`; een productiebuild heeft een eigen proxy nodig.
 */
function twitchProxy(): Plugin {
  return {
    name: 'twitch-hls-proxy',
    configureServer(server) {
      server.middlewares.use('/twitch-hls', async (req, res) => {
        // Vite haalt de mount-prefix uit req.url; het pad begint dus met "/".
        const rawUrl = req.url ?? '';
        let target = rawUrl.replace(/^\/+/, '');
        // Vite voegt "//" samen ("https:/host"). Herstel herhaald, want er kan
        // ook een extra "https:/" in terechtkomen.
        for (let i = 0; i < 3; i++) {
          target = target.replace(/^https:\/(?!\/)/, 'https://').replace(/^http:\/(?!\/)/, 'http://');
          target = target.replace(/^https:\/\/https:\/\//, 'https://').replace(/^https:\/\/https:\//, 'https://');
        }
        if (target.startsWith('https://https:')) target = target.slice('https://'.length);
        if (!target.startsWith('http')) target = `https://${target}`;
        if (!/^https:\/\/[^/]*(ttvnw\.net|twitch\.tv)\//.test(target)) {
          res.statusCode = 400;
          res.end(`Alleen Twitch-URLs zijn toegestaan. (${target.slice(0, 120)})`);
          return;
        }
        try {          const upstream = await fetch(target, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
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
          res.end(`Proxy-fout: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [twitchProxy()],
  server: {
    port: 5173,
    // Zet dit op true als je de dev-server op een andere machine dan de browser draait.
    // Niet nodig voor Twitch: de player gebruikt de hostname van de pagina als parent.
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
