/**
 * Twitch-login: één keer inloggen met je Twitch-account.
 *
 * Waarom: de Twitch-embeds (chat én speler) werken met de cookies van
 * twitch.tv in jouw browser. Log je via de app in, dan zet Twitch die cookies
 * op twitch.tv — en zijn de chat en de streams dus ingelogd, precies zoals op
 * twitch.tv zelf. De app krijgt geen wachtwoord: Twitch stuurt je terug met een
 * token in de URL-fragment (#access_token=...), dat we direct uit de adresbalk
 * halen en alleen in deze browser bewaren.
 *
 * De client-ID is van JOUW eigen Twitch-app (dev.twitch.tv/console/apps).
 * Zet hem als `VITE_TWITCH_CLIENT_ID` (bijv. via een GitHub-variable) en voeg
 * de redirect-URI van je site toe in de Twitch-console — anders krijg je
 * `redirect_mismatch`. Zonder eigen app werkt login alleen op twitch.tv zelf.
 */

const CLIENT_ID = String(import.meta.env?.VITE_TWITCH_CLIENT_ID ?? '');
const STORAGE_KEY = 'stream-syncer:twitch-auth';
const SCOPES = ['chat:read', 'chat:edit', 'user:read:email'];

/** Is er een client-ID geconfigureerd? Zonder kan inloggen niet werken. */
export function hasClientId(): boolean {
  return CLIENT_ID.length > 0;
}

export interface TwitchAuth {
  accessToken: string;
  login: string;
  userId: string;
  expires: number;
}

/** Redirect-URI: dezelfde pagina, zonder query/hash. */
export function redirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export function loginUrl(): string | null {
  if (!hasClientId()) return null;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPES.join(' '),
    force_verify: 'false',
  });
  return `https://id.twitch.tv/oauth2/authorize?${params}`;
}

/** Leest de bewaarde login uit deze browser. */
export function loadAuth(): TwitchAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const auth = JSON.parse(raw) as TwitchAuth;
    if (!auth.accessToken || auth.expires < Date.now()) return null;
    return auth;
  } catch {
    return null;
  }
}

export function saveAuth(auth: TwitchAuth | null): void {
  try {
    if (auth) localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage kan geblokkeerd zijn; niet fataal. */
  }
}

/**
 * Haalt `#access_token=...` uit de URL (na een Twitch-login), bewaart het en
 * ruimt de adresbalk op. Geeft true terug als er iets opgehaald is.
 */
export async function consumeTokenFromUrl(): Promise<boolean> {
  const hash = window.location.hash;
  if (!hash.includes('access_token=')) return false;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  const state = params.get('state');
  // Ruim de adresbalk op voordat we verder gaan; het token mag niet blijven staan.
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (!accessToken) return false;
  const auth = await fetchIdentity(accessToken);
  if (!auth) return false;
  saveAuth(auth);
  void state;
  return true;
}

/** Vraagt bij Twitch wie er ingelogd is (naam + id + geldigheid). */
export async function fetchIdentity(accessToken: string): Promise<TwitchAuth | null> {
  try {
    const response = await fetch('https://api.twitch.tv/helix/users', {
      headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': CLIENT_ID },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      data?: Array<{ id: string; login: string }>;
    };
    const user = json.data?.[0];
    if (!user) return null;
    // Tokens leven ongeveer 60 dagen; we bewaren de vervaltijd ruim korter.
    return {
      accessToken,
      login: user.login,
      userId: user.id,
      expires: Date.now() + 50 * 24 * 60 * 60 * 1000,
    };
  } catch {
    return null;
  }
}

/**
 * Logt uit: wist onze eigen token én de Twitch-sessie in deze browser, zodat
 * de embeds ook weer anoniem zijn.
 */
export function logout(): void {
  saveAuth(null);
  // Twitch zet deze cookies op twitch.tv; alleen Twitch zelf kan ze wissen.
  // Wat we hier kunnen doen: de gebruiker naar de uitlogpagina sturen.
  window.open('https://www.twitch.tv/logout', '_blank', 'noopener,noreferrer');
}
