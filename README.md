# Stream Syncer

Watch several live streams on one page, synced to the stream with the **highest
latency**. The slowest stream becomes the reference; every other stream follows
it, so nothing runs ahead of what you can actually see.

Supported sources: **Twitch** (as a plain HLS stream), **YouTube** and any
**HLS (`.m3u8`) or MP4/WebM** URL.

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:5173>, click **Add streams** and paste Twitch channels,
YouTube links or HLS URLs (one per line):

```
shroud
https://twitch.tv/kaicenat
https://www.youtube.com/watch?v=...
https://example.com/live/master.m3u8
```

You can also link straight to a setup:

```
https://streamsyncer.norwelab.nl/addstreams?noanoella+altijdmelvin+ljoeb
```

Separate channels with `+`, commas or spaces. This also works with URLs:

```
https://streamsyncer.norwelab.nl/addstreams?add=https://twitch.tv/shroud&add=https://www.youtube.com/watch?v=...
```

The `/addstreams` link adds the channels to the current setup (duplicates are
skipped) and then cleans the address bar.

The UI is available in English, Dutch, German, French and Spanish. It follows
your system language unless you pick one in the settings (stored in a cookie).

## How the sync works

Every stream gets a **position** on a shared timeline. A low position means the
stream is behind: the viewer sees an older moment of the broadcast.

1. **Measure latency.** For HLS streams we read the media playlist and use
   `EXT-X-PROGRAM-DATE-TIME` (or `EXT-X-TIMESTAMP-MAP`) to know the wall-clock
   time of every segment. Latency is the difference between the end of the
   newest segment and where the player is. Twitch's embed reports
   `hlsLatencyBroadcaster`; YouTube only gives us relative drift.
2. **Pick a reference.** The stream with the highest latency is the slowest and
   becomes the reference. You cannot speed a live stream up, so everything has
   to wait for the slowest one. The reference is *sticky*: it only switches when
   another stream is at least *Switch reference from* seconds slower (default 3)
   and stays that way for 5 seconds. The **reference** checkbox on a card pins
   one stream manually; unticking hands the choice back to the automatic mode.
3. **Correct.** Nothing is ever paused. Faster streams play slightly slower
   (down to 0.85x) until they match the reference, which is barely noticeable
   and keeps the picture running. If the gap exceeds *Maximum difference*, the
   stream is restarted once at the reference position (playing slower than 0.85x
   sounds like a broken record). Streams without an exact measurement (Twitch
   and YouTube embeds) follow the reference through their own drift.
4. **Fine-tune by hand.** Use `−` and `+` on a card for a per-stream offset
   (0.5 s per click, positive = play later). The **TV icon** on a card opens the
   stream page (twitch.tv/channel or the YouTube video) in a new tab.

## Chat

Every Twitch stream gets a tab in the chat panel, in the order you added the
streams. Each tab is Twitch's own chat embed, so you are logged in exactly when
your browser is logged in on twitch.tv — the app uses Twitch's own login (see
below) or the session you already have there.

**Login and theme.** The first time you open the app without being logged in,
a dialog offers to log in with Twitch and explains why (your own chat account,
subscriptions/Turbo, no ads). You can close it and continue anonymously; it is
shown once per browser. You can always log in later via **Settings → Twitch
account**. The app never sees your password: Twitch redirects back with a token
in the URL fragment, which is stored in your browser only.

For the login you need your own Twitch application (the redirect URI of your
site must be registered there, otherwise Twitch returns `redirect_mismatch`):

1. Go to <https://dev.twitch.tv/console/apps> → **Register Your Application**.
2. Add your production site as an OAuth redirect URL, exactly as the app shows
   it in the login dialog (with trailing slash), e.g.
   `https://streamsyncer.norwelab.nl/`. No localhost URL is needed for
   production. Add `http://localhost:5173/` only if you also want to test the
   login on a local dev server.
3. Copy the Client ID and set it as the GitHub **variable** `TWITCH_CLIENT_ID`
   (Settings → Secrets and variables → Actions → Variables). The build picks it
   up as `VITE_TWITCH_CLIENT_ID`.

The chat embed is opened with Twitch's `darkpopout` option, so it uses Twitch's
dark theme regardless of your Twitch site setting.

The layout adapts to the number of streams:

- **Even number of streams** – the chat sits in a sidebar next to the streams,
  like on Twitch itself.
- **Odd number of streams** – the chat becomes a block in the grid, filling the
  empty spot next to the streams.

Clicking a stream (or its chat tab) makes it the active stream: it gets the
sound and its chat is shown. Tabs keep their history while you switch between
them.

## What is (not) possible

| Source | Latency measurement | Correction |
| --- | --- | --- |
| HLS (`.m3u8`) | exact, from the playlist | seek + playbackRate |
| MP4/WebM | exact (position in the file) | seek + playbackRate |
| Twitch via HLS | exact, from the Twitch playlist | seek + playbackRate |
| Twitch embed | via `hlsLatencyBroadcaster` | playbackRate, wait or reload |
| YouTube | drift only (no exact latency) | playbackRate, wait or reload |

### Twitch via HLS

Twitch delivers its streams as HLS to its own web player. The app fetches that
playlist through `gql.twitch.tv` (`PlaybackAccessToken`) and
`usher.ttvnw.net`, then plays it with hls.js in a regular `<video>`. The playlist
contains `EXT-X-PROGRAM-DATE-TIME`, so latency is measured exactly and the stream
can really be seeked. This is on by default (*Settings → Twitch via HLS*).

`usher.ttvnw.net` and the Twitch CDN send no CORS headers, so these requests go
through `/twitch-hls/...`: the dev server proxies them in development, the
Cloudflare Worker does it in production. Without that proxy you get
"Twitch blocks direct access to the playlist (CORS)".

It is the same unofficial route Streamlink uses: Twitch can change or block it
at any time. Turn the setting off to use the official embed. Embeds are
third-party iframes: they cannot be seeked and their exact latency is not
observable, so those streams can only be synced *relatively*.

**Ads.** When you are logged in (*Settings → Twitch account*), the HLS playlist
is requested with your Twitch token. Twitch then knows about your subscriptions
and Turbo/Prime, so it serves the stream without ad breaks. Without a login the
request is anonymous and Twitch may insert ads. If the token is rejected, the
app falls back to an anonymous request so the stream keeps working.

## Settings

- **Language** – English, Dutch, German, French or Spanish. Defaults to your
  system language (`navigator.languages`); your choice is stored in the
  `stream-syncer-lang` cookie. *Automatic* removes the cookie again.
- **Automatic sync** – turn the corrections on or off.
- **Twitch via HLS** – play Twitch channels through the HLS playlist (exact and
  seekable) instead of the embed.
- **Volume of the active stream** – only the stream whose speaker icon you click
  is audible; the others are muted.
- **Safety margin** – extra seconds the reference runs ahead.
- **Maximum difference** – a larger gap means restart instead of slow down.
- **Switch reference from** – how much slower another stream must be before the
  reference changes (0 = always the slowest stream).

## Hosting

The app needs a tiny server-side proxy for Twitch (no CORS headers), so a plain
static host is not enough. Pick one of these:

### Self-hosted (Node)

```bash
npm install
npm run build
npm start              # http://localhost:8080
```

`server/index.mjs` serves `dist/` and proxies `/twitch-hls/...`. No extra
dependencies (Node 20+). Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | port to listen on |
| `HOST` | `0.0.0.0` | interface to bind |
| `ALLOWED_HOSTS` | empty (all) | comma-separated hostnames allowed to use the proxy, e.g. `streams.example.com` |

Put it behind a reverse proxy (Caddy, nginx) with HTTPS if it is public.

### Docker

```bash
docker build -t stream-syncer .
docker run -p 8080:8080 stream-syncer
```

### Cloudflare Workers (free tier)

`worker/index.ts` serves the build from `dist/` and proxies `/twitch-hls/...`.

```bash
npx wrangler login     # once
npm run deploy         # build + deploy to https://twitch-stream-syncer.<account>.workers.dev
```

On every push to `master`, `.github/workflows/deploy.yml` runs the tests, builds
and deploys. Add the repository secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` to enable that.

### GitHub Pages (app) + Cloudflare Worker (proxy)

De app is statisch te hosten; de Twitch-proxy draait apart op een Worker met een
eigen domein (bijvoorbeeld `https://worker.norwelab.nl`). Zo kan de app op
GitHub Pages staan en blijft de proxy werken.

1. Zet in `wrangler.jsonc` je eigen domein onder `routes` (custom domain).
2. Deploy de Worker: `npm run deploy`.
3. Bouw de app met de proxy-URL:

   ```bash
   VITE_TWITCH_PROXY_ORIGIN=https://worker.norwelab.nl npm run build
   ```

4. Publiceer `dist/` op GitHub Pages. De workflow
   `.github/workflows/deploy.yml` doet dit automatisch: hij zet
   `VITE_TWITCH_PROXY_ORIGIN`, publiceert naar Pages en deployt de Worker
   (als de secrets `CLOUDFLARE_API_TOKEN` en `CLOUDFLARE_ACCOUNT_ID` bestaan).

Zonder `VITE_TWITCH_PROXY_ORIGIN` gebruikt de app de proxy op dezelfde origin
(dev-server of de Worker zelf).

## Development

```bash
npm run dev        # dev server on http://localhost:5173
npm test           # sync engine, HLS parser and translation tests
npm run build      # production build in dist/
npm start          # serve dist/ + Twitch proxy on http://localhost:8080
npm run deploy     # build + deploy to Cloudflare Workers
```

Source layout:

- `src/sources.ts` – recognise URLs (Twitch, YouTube, HLS, video).
- `src/twitch-hls.ts` – fetch the Twitch playlist (GQL + usher), pick a quality.
- `src/hls-timeline.ts` – parse playlists, compute latency.
- `src/adapters.ts` – one interface for HLS/video, Twitch and YouTube.
- `src/sync.ts` – the sync engine: pick the reference, compute corrections.
- `src/engine.ts` – cards, audio, restarts and the tick loop.
- `src/i18n.ts` – languages, cookie and all translations.
- `src/chat.ts` – chat panel with a Twitch chat embed per stream.
- `src/main.ts` – UI, storage and settings.
- `server/index.mjs` – self-hosted server (static files + Twitch proxy).
- `worker/index.ts` – Cloudflare Worker (static files + Twitch proxy).

Note: the Twitch player only works on `localhost` or your own domain (it uses
the page hostname as its `parent`). A `file://` page will not work; use the dev
server or a build behind a server.
