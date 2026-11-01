# Stream Syncer

Bekijk meerdere live streams op één pagina. De stream met de **hoogste latency**
wordt de referentie; alle andere streams worden daarop gesynchroniseerd.

```
npm install
npm run dev
```

Open daarna <http://localhost:5173>. Start de app **altijd via `npm run dev`**:
de dev-server bevat een kleine proxy die Twitch-playlists doorlaat (Twitch stuurt
daar geen CORS-headers, dus de browser mag ze anders niet lezen). Bij een
productiebuild moet je hosting hetzelfde doen. Klik op **Streams toevoegen** en plak
Twitch-kanalen, YouTube-links of HLS-URL's (één per regel):

```
shroud
https://twitch.tv/kaicenat
https://www.youtube.com/watch?v=...
https://voorbeeld.nl/live/master.m3u8
```

Je kunt ook direct linken:
`http://localhost:5173/?add=https://twitch.tv/shroud&add=https://twitch.tv/kaicenat`

## Hoe de synchronisatie werkt

Elke stream krijgt een **positie** in een gedeelde tijdlijn. Een lage positie
betekent dat de stream achterloopt: de kijker ziet dan een ouder stukje content.

1. **Latency meten.** Voor HLS-streams lezen we de media-playlist en gebruiken
   we `EXT-X-PROGRAM-DATE-TIME` (of `EXT-X-TIMESTAMP-MAP`) om de wandkloktijd
   van elk segment te kennen. De latency is het verschil tussen het einde van
   het nieuwste segment en de plek waar de speler staat. Voor Twitch gebruikt
   de player-API de gemeten latency naar de streamer (`hlsLatencyBroadcaster`).
   YouTube geeft geen exacte latency; daar gebruiken we de relatieve drift.
2. **Referentie kiezen.** De stream met de grootste latency is de traagste en
   wordt de referentie. Sneller kan niet: je kunt een live stream niet vooruit
   spoelen, dus alles moet wachten op de traagste. De referentie blijft staan
   tot een andere stream minstens *Referentie wisselen vanaf* (standaard 3 s)
   trager is en dat 5 seconden volhoudt. Met het vinkje **referentie** op een
   kaart zet je zelf één stream vast als referentie (alle andere streams volgen
   die dan); uitvinken geeft de keuze weer terug aan de automaat.
3. **Corrigeren.** Er wordt nooit gepauzeerd. Snellere streams lopen rustig
   langzamer (tot 0.85x) tot ze bij de referentie zijn; dat merk je nauwelijks
   en het beeld blijft doorlopen. Is het verschil groter dan *Maximale
   afwijking*, dan wordt de stream één keer opnieuw gestart op de
   referentiepositie (sneller dan 0.85x afspelen klinkt als een kapotte plaat).
   Streams zonder exacte meting (Twitch- en YouTube-embeds) volgen de
   referentie via hun eigen drift; bij te veel drift wordt de embed opnieuw
   geladen.
4. **Handmatig bijsturen.** Met `−` en `+` op een kaart stel je per stream een
   offset in (0,5 s per klik). Positief = later afspelen. Met het **tv-icoontje**
   bovenaan een kaart open je de streampagina (twitch.tv/kanaal of de
   YouTube-video) in een nieuw tabblad.

## Wat is (niet) mogelijk

| Bron | Latency meten | Bijsturen |
| --- | --- | --- |
| HLS (`.m3u8`) | exact, via de playlist | seek + playbackRate |
| MP4/WebM | exact (positie in het bestand) | seek + playbackRate |
| Twitch via HLS | exact, via de Twitch-playlist | seek + playbackRate |
| Twitch embed | via `hlsLatencyBroadcaster` | playbackRate, wachten of herladen |
| YouTube | alleen drift (geen exacte latency) | playbackRate, wachten of herladen |

### Twitch via HLS

Twitch levert zijn streams als HLS aan de eigen webplayer. De app haalt die
playlist op via `gql.twitch.tv` (PlaybackAccessToken) en `usher.ttvnw.net`, en
speelt hem met hls.js in een gewone `<video>`. De playlist bevat
`EXT-X-PROGRAM-DATE-TIME`, dus latency is exact meetbaar en de stream is echt
te seeken. Dit is standaard aan (`Instellingen → Twitch via HLS`).

Omdat `usher.ttvnw.net` en de Twitch-CDN geen CORS-headers sturen, lopen deze
verzoeken in de dev-server via `/twitch-hls/...` (zie `vite.config.ts`). Zonder
die proxy krijg je de melding "Twitch blokkeert directe toegang tot de playlist".

Het is dezelfde onofficiële route die Streamlink gebruikt: Twitch kan hem op elk
moment wijzigen of blokkeren (dan krijg je "Twitch weigert de playlist"). Zet de
instelling dan uit om de officiële embed te gebruiken. Twitch-embeds zijn
iframes van een andere partij: die kun je niet seeken en hun exacte latency is
niet van buitenaf te meten, dus die streams zijn alleen *relatief* te
synchroniseren.

## Instellingen

- **Taal** – Nederlands, Engels, Duits, Frans of Spaans. Standaard de taal van
  je systeem (`navigator.languages`); kies je zelf een taal, dan wordt die in
  de cookie `stream-syncer-lang` bewaard. "Automatisch" verwijdert die cookie
  weer en volgt opnieuw het systeem.
- **Automatische sync** – aan/uit voor de correcties.
- **Twitch via HLS** – Twitch-kanalen via de HLS-playlist spelen (exact meetbaar en seekbaar) in plaats van de embed.
- **Volume van de actieve stream** – alleen de stream waarvan je op het
  luidspreker-icoon klikt is hoorbaar; de rest staat gedempt.
- **Veiligheidsmarge** – extra seconden dat de referentie voorloopt.
- **Maximale afwijking** – groter verschil = herstarten in plaats van vertragen.

## Ontwikkelen

```
npm run dev        # dev-server op http://localhost:5173
npm test           # unit tests voor de sync-engine en de HLS-parser
npm run build      # productiebuild in dist/
```

Bronstructuur:

- `src/sources.ts` – URL's herkennen (Twitch, YouTube, HLS, video).
- `src/twitch-hls.ts` – Twitch-playlist ophalen (GQL + usher) en kwaliteit kiezen.
- `src/hls-timeline.ts` – playlist parsen, latency berekenen.
- `src/adapters.ts` – één interface voor HLS/video, Twitch en YouTube.
- `src/sync.ts` – de sync-engine: referentie kiezen, correcties berekenen.
- `src/engine.ts` – kaarten, audio, herstarten en de tick-loop.
- `src/main.ts` – UI, opslag en instellingen.

Let op: de Twitch-player werkt alleen op `localhost` of een eigen domein
(de player gebruikt de hostnaam van de pagina als `parent`). Een `file://`-pagina
werkt niet; gebruik de dev-server of een build via een statische server.
