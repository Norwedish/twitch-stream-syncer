/**
 * Twitch als "gewone" HLS-stream.
 *
 * Twitch levert zijn streams als HLS aan de eigen webplayer. Die playlist
 * krijg je in twee stappen:
 *
 *  1. GraphQL (`gql.twitch.tv`) geeft een PlaybackAccessToken per kanaal.
 *  2. `usher.ttvnw.net` zet dat token om in een master-playlist met alle
 *     kwaliteiten.
 *
 * De media-playlists van Twitch bevatten `EXT-X-PROGRAM-DATE-TIME`, dus met
 * `hls-timeline.ts` is de latency exact te meten en kan de speler echt seeken.
 *
 * Dit is een onofficiële route (dezelfde die Streamlink en de webplayer
 * gebruiken). Twitch kan hem op elk moment wijzigen of blokkeren; de app valt
 * dan terug op de officiële embed (instelling "Twitch via HLS").
 */

import { HAS_TWITCH_PROXY } from './twitch-proxy.ts';

/** Publieke client-ID van de Twitch-webplayer. */
const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

/**
 * Hash van de `PlaybackAccessToken`-persisted-query. Twitch kan die zonder
 * waarschuwing wijzigen; we sturen de query zelf mee, dit is documentatie.
 */
export const ACCESS_TOKEN_HASH = '0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712';

const ACCESS_TOKEN_QUERY = `query PlaybackAccessToken($login: String!, $playerType: String!) {
  streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) {
    value
    signature
    __typename
  }
}`;

export interface TwitchPlayback {
  /** Master-playlist met alle kwaliteiten. */
  masterUrl: string;
  /** Gekozen media-playlist. */
  mediaUrl: string;
  /** Beschikbare kwaliteiten, hoogste eerst. */
  variants: TwitchVariant[];
}

export interface TwitchVariant {
  name: string;
  bandwidth: number;
  url: string;
}

export class TwitchPlaybackError extends Error {
  /** True als de stream offline is of niet bestaat. */
  readonly offline: boolean;

  constructor(message: string, offline = false) {
    super(message);
    this.name = 'TwitchPlaybackError';
    this.offline = offline;
  }
}

async function fetchAccessToken(channel: string, playerType: string): Promise<{ value: string; signature: string }> {
  let response = await requestToken(channel, playerType, true);
  // Verlopen of ongeldig token? Dan anoniem verder, zodat de stream blijft werken.
  if (response.status === 401 || response.status === 403) {
    response = await requestToken(channel, playerType, false);
  }
  if (!response.ok) {
    throw new TwitchPlaybackError(`Twitch GraphQL gaf HTTP ${response.status}.`);
  }
  const json = (await response.json()) as {
    data?: { streamPlaybackAccessToken?: { value: string; signature: string } | null };
    errors?: unknown;
  };
  const token = json.data?.streamPlaybackAccessToken;
  if (!token) {
    throw new TwitchPlaybackError('Kanaal niet gevonden of offline.', true);
  }
  return token;
}

function requestToken(channel: string, playerType: string, withAuth: boolean): Promise<Response> {
  return fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      'Content-Type': 'application/json',
      // Met het OAuth-token van de kijker: Twitch kent dan abonnementen en
      // Turbo/Prime, en levert dan de stream zonder advertenties.
      ...(withAuth ? authHeaders() : {}),
    },
    body: JSON.stringify({
      operationName: 'PlaybackAccessToken',
      query: ACCESS_TOKEN_QUERY,
      variables: { login: channel, playerType },
    }),
  });
}

/**
 * Kop met het OAuth-token van de kijker, als die is ingelogd. Zonder token is
 * de request anoniem (en kan Twitch advertenties invoegen).
 */
function authHeaders(): Record<string, string> {
  const token = currentAccessToken();
  return token ? { Authorization: `OAuth ${token}` } : {};
}

/** Wordt gezet door de app (zie main.ts) zodra de login verandert. */
let accessTokenProvider: () => string | null = () => null;

export function setTwitchTokenProvider(provider: () => string | null): void {
  accessTokenProvider = provider;
}

function currentAccessToken(): string | null {
  try {
    return accessTokenProvider();
  } catch {
    return null;
  }
}

/**
 * Haalt de HLS-playlist van een Twitch-kanaal op.
 * `quality` is een kwaliteitsnaam zoals "1080p60", of "best"/"worst".
 *
 * Twitch levert per kanaal één playlist met een vaste kwaliteit, dus de
 * "master" bevat geen varianten; dan gebruiken we die playlist zelf.
 */
export async function resolveTwitchPlayback(channel: string, quality = 'best'): Promise<TwitchPlayback> {
  const login = channel.toLowerCase();
  let token: { value: string; signature: string };
  try {
    token = await fetchAccessToken(login, 'site');
  } catch (error) {
    if (error instanceof TwitchPlaybackError) throw error;
    throw new TwitchPlaybackError(`Twitch is niet bereikbaar (${describe(error)}).`);
  }

  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    token: token.value,
    sig: token.signature,
    allow_source: 'true',
    allow_audio_only: 'false',
    player: 'twitchweb',
    p: String(Math.floor(Math.random() * 1_000_000)),
    type: 'any',
    allow_spectre: 'false',
  });
  const masterUrl = `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?${params}`;
  // In de dev-server loopt dit via de proxy (Twitch stuurt geen CORS-headers).
  const fetchUrl = HAS_TWITCH_PROXY ? `/twitch-hls/${masterUrl.replace('://', ':/')}` : masterUrl;

  let masterText: string;
  try {
    const response = await fetch(fetchUrl);
    masterText = await response.text();
    if (!response.ok || !masterText.includes('#EXTM3U')) {
      throw new TwitchPlaybackError(
        response.status === 404
          ? 'Twitch weigert de playlist (kanaal offline of playlist geblokkeerd).'
          : `Twitch-playlist gaf HTTP ${response.status}.`,
        response.status === 404,
      );
    }
  } catch (error) {
    if (error instanceof TwitchPlaybackError) throw error;
    // Geen CORS-headers op usher.ttvnw.net: de browser mag deze playlist niet
    // lezen. Een proxy (npm run dev) lost dat op.
    const viaProxy = HAS_TWITCH_PROXY;
    throw new TwitchPlaybackError(
      viaProxy
        ? 'Twitch-playlist niet bereikbaar via de proxy. Controleer of `npm run dev` draait en herstart de server na een wijziging in vite.config.ts.'
        : 'Twitch blokkeert directe toegang tot de playlist (CORS). Start de app via `npm run dev` zodat de proxy gebruikt wordt.',
    );
  }

  const variants = parseVariants(masterText);
  if (variants.length === 0) {
    // Geen varianten: de playlist is zelf de media-playlist.
    return { masterUrl, mediaUrl: masterUrl, variants: [] };
  }

  const chosen = pickVariant(variants, quality);
  return { masterUrl, mediaUrl: chosen.url, variants };
}

export function parseVariants(masterText: string): TwitchVariant[] {
  const lines = masterText.split(/\r?\n/);
  const variants: TwitchVariant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(line)?.[1] ?? 0);
    const name = /NAME="([^"]+)"/.exec(line)?.[1] ?? `${Math.round(bandwidth / 1000)}k`;
    for (let j = i + 1; j < lines.length; j++) {
      const uri = lines[j].trim();
      if (!uri || uri.startsWith('#')) continue;
      variants.push({ name, bandwidth, url: uri });
      break;
    }
  }
  return variants.sort((a, b) => b.bandwidth - a.bandwidth);
}

/** "best", "1080p60", "720", "source" of "worst". */
export function pickVariant(variants: TwitchVariant[], quality: string): TwitchVariant {
  const wanted = quality.trim().toLowerCase();
  if (wanted === 'best' || wanted === 'source' || wanted === '') return variants[0];
  if (wanted === 'worst') return variants[variants.length - 1];
  const exact = variants.find((v) => v.name.toLowerCase() === wanted);
  if (exact) return exact;
  const digits = /(\d{3,4})/.exec(wanted)?.[1];
  if (digits) {
    const byHeight = variants.find((v) => v.name.includes(digits));
    if (byHeight) return byHeight;
  }
  return variants[0];
}

/** Heeft een opgeloste playlist zijn geldigheid verlopen? */
export function isTwitchUrlStale(resolvedAt: number | undefined, now = Date.now()): boolean {
  // Tokens leven ongeveer een dag; ruim daarvoor verversen we al.
  return !resolvedAt || now - resolvedAt > 6 * 60 * 60 * 1000;
}

/** Kanaalnaam uit een kale naam, of null als het geen geldige naam is. */
export function channelFromRef(ref: string): string | null {
  const match = /^[a-zA-Z0-9_]{1,25}$/.exec(ref.trim());
  return match ? ref.trim().toLowerCase() : null;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.name === 'TypeError' ? 'netwerkfout of CORS' : error.message;
  return String(error);
}
