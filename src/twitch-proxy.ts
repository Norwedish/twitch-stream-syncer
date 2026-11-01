/**
 * URL's omzetten zodat de browser ze kan laden.
 *
 * Twitch levert zijn playlists en segmenten zonder CORS-headers. In de
 * dev-server lopen die URL's daarom via de proxy (`/twitch-hls/...`); in een
 * productiebuild moet de hosting hetzelfde doen, of de proxy uit staan.
 */

/** Is de dev-proxy beschikbaar? (alleen bij `npm run dev`) */
export const HAS_TWITCH_PROXY = Boolean(import.meta.env?.DEV);

const TWITCH_CDN = /^https:\/\/[^/]*(ttvnw\.net|twitch\.tv)\//;

/**
 * Twitch-playlists worden met een token in de query opgehaald. Die URL hoort
 * niet in localStorage of in een foutmelding terecht te komen.
 */
export function redactTwitchUrl(url: string): string {
  return url.replace(/([?&](?:token|sig|nauth|nauthsig)=)[^&]*/gi, '$1***');
}

/** Zet een Twitch-URL om naar de proxy-URL (of laat hem staan). */
export function proxifyTwitch(url: string): string {
  if (!HAS_TWITCH_PROXY || !TWITCH_CDN.test(url)) return url;
  // Geen "//" in het pad: Vite voegt die samen tot "/" vóór de middleware ze
  // ziet. Daarom "https:/" + "host/..." en dat in de proxy weer herstellen.
  return `/twitch-hls/${url.replace('://', ':/')}`;
}

/** Maakt van een (al dan niet relatief opgeloste) proxy-URL weer de echte URL. */
export function unproxifyTwitch(url: string): string {
  const marker = '/twitch-hls/';
  const index = url.indexOf(marker);
  if (index === -1) return url;
  let rest = url.slice(index + marker.length);
  if (rest.startsWith('https://https:')) rest = rest.slice('https://'.length);
  for (let i = 0; i < 3; i++) {
    rest = rest.replace(/^https:\/(?!\/)/, 'https://').replace(/^http:\/(?!\/)/, 'http://');
  }
  return rest;
}
