/**
 * URL's omzetten zodat de browser ze kan laden.
 *
 * Twitch levert zijn playlists en segmenten zonder CORS-headers. Ze lopen
 * daarom via de proxy (`/twitch-hls/...`): in de dev-server regelt
 * `vite.config.ts` die, in productie `worker/index.ts` (Cloudflare Workers).
 * Een statische host zonder proxy (zoals GitHub Pages) kan de Twitch-playlist
 * niet lezen; daar valt de app terug op de officiële Twitch-embed.
 */

/**
 * Is er een proxy beschikbaar? Altijd, behalve in een pure statische build
 * (zet `VITE_TWITCH_PROXY=off` als je op GitHub Pages host).
 */
export const HAS_TWITCH_PROXY = import.meta.env?.VITE_TWITCH_PROXY !== 'off';

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
