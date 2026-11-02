/**
 * URL's omzetten zodat de browser ze kan laden.
 *
 * Twitch levert zijn playlists en segmenten zonder CORS-headers. Ze lopen
 * daarom via een proxy (`/twitch-hls/...`):
 *
 * - in de dev-server: `vite.config.ts`, op dezelfde origin;
 * - op GitHub Pages: de Cloudflare Worker op `VITE_TWITCH_PROXY_ORIGIN`
 *   (bijvoorbeeld `https://worker.norwelab.nl`);
 * - op Cloudflare Workers zelf: `worker/index.ts`, op dezelfde origin.
 *
 * Zonder proxy valt de app terug op de officiële Twitch-embed.
 */

/**
 * Waar de proxy staat. Leeg = zelfde origin (dev-server of de Worker zelf).
 * Zet `VITE_TWITCH_PROXY_ORIGIN=https://worker.norwelab.nl` voor een
 * statische host zoals GitHub Pages.
 */
const PROXY_ORIGIN = String(import.meta.env?.VITE_TWITCH_PROXY_ORIGIN ?? '').replace(/\/+$/, '');

/**
 * Is er een proxy beschikbaar? Altijd, behalve als je hem expliciet uitzet
 * met `VITE_TWITCH_PROXY=off`.
 */
export const HAS_TWITCH_PROXY = import.meta.env?.VITE_TWITCH_PROXY !== 'off';

const TWITCH_CDN = /^https:\/\/[^/]*(ttvnw\.net|twitch\.tv)\//;

/** Het pad waaronder de proxy de Twitch-URL's aanbiedt. */
const PROXY_PATH = '/twitch-hls/';

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
  // Geen "//" in het pad: Vite en de browser voegen die samen tot "/" vóór de
  // proxy ze ziet. Daarom "https:/" + "host/..." en dat in de proxy weer
  // herstellen.
  return `${PROXY_ORIGIN}${PROXY_PATH}${url.replace('://', ':/')}`;
}

/** Maakt van een (al dan niet relatief opgeloste) proxy-URL weer de echte URL. */
export function unproxifyTwitch(url: string): string {
  const index = url.indexOf(PROXY_PATH);
  if (index === -1) return url;
  let rest = url.slice(index + PROXY_PATH.length);
  if (rest.startsWith('https://https:')) rest = rest.slice('https://'.length);
  for (let i = 0; i < 3; i++) {
    rest = rest.replace(/^https:\/(?!\/)/, 'https://').replace(/^http:\/(?!\/)/, 'http://');
  }
  return rest;
}
