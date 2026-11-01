/**
 * Soorten bronnen die we kunnen afspelen.
 *
 * - `twitch` / `youtube`: officiële embeds. Voor live streams kunnen we de
 *   latency niet exact meten (alleen de richting ervan), dus gebruiken we een
 *   geschatte latency en de relatieve drift van de speler.
 * - `twitch-hls`: de HLS-playlist van Twitch rechtstreeks in een <video>.
 *   Twitch levert die via de (onofficiële) GQL + usher-API, met dezelfde
 *   PROGRAM-DATE-TIME-tags als elke andere HLS-stream. Daarmee is de latency
 *   exact meetbaar en kan de stream echt geseekt worden.
 * - `hls` / `video`: native <video>. Hier kunnen we de echte latency meten:
 *   de HLS-playlist bevat de wandkloktijd van elk segment.
 */
export type SourceKind = 'twitch' | 'twitch-hls' | 'youtube' | 'hls' | 'video';

export interface StreamConfig {
  id: string;
  /** Weergavenaam; leeg = automatisch uit de URL/channelnaam. */
  label: string;
  kind: SourceKind;
  /** Twitch-channel, YouTube-video-ID, of HLS/MP4-URL. */
  ref: string;
  /** Handmatige fijnafstelling in seconden. Positief = later afspelen. */
  offset: number;
  /** Handmatig ingevoerde latency in seconden (alleen Twitch/YouTube). */
  latencyOverride: number | null;
  muted: boolean;
  volume: number;
  /**
   * Alleen voor `twitch-hls`: de playlist-URL die de GQL/usher-API opleverde.
   * Die is tijdelijk geldig; verlopen = opnieuw opvragen.
   */
  resolvedUrl?: string;
  /** Moment (ms) waarop `resolvedUrl` is opgehaald. */
  resolvedAt?: number;
  /**
   * Gebruiker heeft deze stream met de hand als referentie aangewezen.
   * Alleen één stream tegelijk kan dit hebben.
   */
  forcedAnchor?: boolean;
}

export interface ParsedSource {
  kind: SourceKind;
  ref: string;
  label: string;
}

const TWITCH_RESERVED = new Set([
  'directory',
  'videos',
  'settings',
  'subscriptions',
  'inventory',
  'wallet',
  'drops',
  'friends',
  'search',
  'p',
  'downloads',
  'turbo',
  'jobs',
  'download',
  'store',
]);

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

export function isTwitchHost(host: string): boolean {
  return host === 'twitch.tv' || host.endsWith('.twitch.tv') || host === 'twitch.com';
}

export function isYoutubeHost(host: string): boolean {
  return YOUTUBE_HOSTS.has(host);
}

function splitUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

/**
 * Zet een geplakte URL (of kale channelnaam) om naar een bron.
 * Geeft `null` terug als we er niets mee kunnen.
 */
export function parseSource(input: string): ParsedSource | null {
  const raw = input.trim();
  if (!raw) return null;

  const url = splitUrl(raw);
  if (!url) {
    // Kale channelnaam, bv. "shroud" of "@shroud".
    const channel = raw.replace(/^@/, '').replace(/^\/+|\/+$/g, '');
    if (!/^[a-zA-Z0-9_]{1,25}$/.test(channel)) return null;
    return { kind: 'twitch', ref: channel.toLowerCase(), label: channel.toLowerCase() };
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (isTwitchHost(host)) {
    if (host === 'clips.twitch.tv' || host === 'player.twitch.tv') {
      const channel = url.searchParams.get('channel');
      if (channel) return { kind: 'twitch', ref: channel.toLowerCase(), label: channel.toLowerCase() };
      return null;
    }
    if (host === 'dashboard.twitch.tv') return null;
    if (segments[0] === 'videos' || segments[0] === 'clip' || segments[0] === 'clips') return null;
    const first = segments[0];
    if (!first) return null;
    const channel = first.replace(/^@/, '').toLowerCase();
    if (TWITCH_RESERVED.has(channel)) return null;
    return { kind: 'twitch', ref: channel, label: channel };
  }

  if (isYoutubeHost(host)) {
    let videoId: string | null = null;
    if (host === 'youtu.be' || host === 'www.youtu.be') {
      videoId = segments[0] ?? null;
    } else if (segments[0] === 'live' && segments[1]) {
      videoId = segments[1];
    } else if (segments[0] === 'embed' && segments[1]) {
      videoId = segments[1];
    } else {
      videoId = url.searchParams.get('v');
    }
    if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null;
    return { kind: 'youtube', ref: videoId, label: `YouTube ${videoId}` };
  }

  if (/\.m3u8$/i.test(url.pathname) || /\.m3u8\b/i.test(url.search)) {
    return { kind: 'hls', ref: url.href, label: url.pathname.split('/').pop()?.replace(/\.m3u8$/i, '') || url.hostname };
  }

  if (/\.(mp4|webm|ogv|ogg|m4v)$/i.test(url.pathname)) {
    return { kind: 'video', ref: url.href, label: url.pathname.split('/').pop() || url.hostname };
  }

  return null;
}

export function kindLabel(kind: SourceKind): string {
  switch (kind) {
    case 'twitch':
      return 'Twitch';
    case 'twitch-hls':
      return 'Twitch HLS';
    case 'youtube':
      return 'YouTube';
    case 'hls':
      return 'HLS';
    case 'video':
      return 'Video';
  }
}

export function isMeasurable(kind: SourceKind): boolean {
  return kind === 'hls' || kind === 'video' || kind === 'twitch-hls';
}

/** Soorten die via een <video>-element spelen (en dus seekbaar zijn). */
export function isNativeVideo(kind: SourceKind): boolean {
  return kind === 'hls' || kind === 'video' || kind === 'twitch-hls';
}
