/**
 * Meertaligheid.
 *
 * De taal komt van het besturingssysteem/browser (`navigator.languages`).
 * Kiest de gebruiker in de instellingen een andere taal, dan wordt die keuze
 * in een cookie bewaard en heeft die voorrang. "Automatisch" verwijdert de
 * cookie weer.
 */

export type Lang = 'nl' | 'en' | 'de' | 'fr' | 'es';

export const LANGS: Lang[] = ['nl', 'en', 'de', 'fr', 'es'];

export const LANG_NAMES: Record<Lang, string> = {
  nl: 'Nederlands',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
};

const COOKIE_NAME = 'stream-syncer-lang';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // één jaar

/** Taal van het systeem, of Nederlands als we het niet kennen. */
export function osLanguage(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const candidates = [
    ...(Array.isArray(nav?.languages) ? nav.languages : []),
    nav?.language,
  ];
  for (const tag of candidates) {
    const base = String(tag ?? '').toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'nl';
}

function isLang(value: string): value is Lang {
  return (LANGS as string[]).includes(value);
}

/** Bewaarde keuze uit de cookie, of null als er niets (geldigs) staat. */
export function savedLanguage(): Lang | null {
  const value = readCookie(COOKIE_NAME);
  return value !== null && isLang(value) ? value : null;
}

export function saveLanguage(lang: Lang | null): void {
  if (lang === null) {
    writeCookie(COOKIE_NAME, '', 0);
    return;
  }
  writeCookie(COOKIE_NAME, lang, COOKIE_MAX_AGE);
}

/** De taal die we nu gebruiken: cookie > systeem. */
export function resolveLanguage(): Lang {
  return savedLanguage() ?? osLanguage();
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const jar = typeof document !== 'undefined' ? document.cookie : '';
  for (const part of jar.split(';')) {
    const item = part.trim();
    if (item.startsWith(prefix)) return decodeURIComponent(item.slice(prefix.length));
  }
  return null;
}

function writeCookie(name: string, value: string, maxAge: number): void {
  if (typeof document === 'undefined') return;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

/* -------------------------------------------------------------------------- */
/*                                  Vertalingen                               */
/* -------------------------------------------------------------------------- */

export interface Messages {
  tagline: string;
  statusNoStreams: string;
  statusNoStreamsSub: string;
  statusWaiting: string;
  statusWaitingSub: string;
  statusReference: (name: string, forced: boolean) => string;
  statusSynced: (latency: string, pending: string) => string;
  statusDrift: (delta: string, latency: string, pending: string) => string;
  statusLatencyUnknown: string;
  statusLatency: (value: string) => string;
  statusPending: (name: string, gap: string) => string;
  playAll: string;
  playAllTitle: string;
  pause: string;
  pauseTitle: string;
  resync: string;
  resyncTitle: string;
  resyncToast: string;
  addStreams: string;
  settings: string;
  emptyTitle: string;
  emptyText: string;
  addTitle: string;
  addLabel: string;
  addPlaceholder: string;
  addHint: string;
  addHintEnd: string;
  cancel: string;
  add: string;
  addNoValid: (errors: string) => string;
  addEmpty: string;
  addedToast: (added: number, skipped: number, errors: number) => string;
  close: string;
  settingsTitle: string;
  autoSync: string;
  autoSyncHint: string;
  twitchHls: string;
  twitchHlsHint: string;
  volume: string;
  safetyMargin: string;
  safetyMarginHint: string;
  maxLag: string;
  maxLagHint: string;
  anchorMargin: string;
  anchorMarginHint: string;
  language: string;
  languageHint: string;
  languageAuto: string;
  languageChanged: (name: string) => string;
  languageAutoToast: (name: string) => string;
  chat: string;
  chatEmpty: string;
  skipToStreams: string;
  twitchLogin: string;
  twitchLoginHint: string;
  twitchLogout: string;
  twitchLoggedIn: (name: string) => string;
  loginTitle: string;
  loginIntro: string;
  loginReasonChat: string;
  loginReasonSubs: string;
  loginReasonAds: string;
  loginPrivacy: string;
  loginGo: string;
  loginAnonymous: string;
  loginNotConfigured: string;
  loginRedirectHint: string;
  fatalTitle: string;
  reload: string;
  anchorNew: (name: string) => string;
  anchorForced: (name: string) => string;
  anchorAuto: string;
  remove: string;
  focus: string;
  playPause: string;
  mute: string;
  unmute: string;
  openPage: (where: string) => string;
  openTwitch: (channel: string) => string;
  openYouTube: string;
  openStreamUrl: string;
  offsetTitle: string;
  offsetEarlier: string;
  offsetLater: string;
  statLatency: string;
  statDelta: string;
  statRate: string;
  statLatencyTitle: string;
  statLatencyUnknownTitle: string;
  statDeltaTitle: string;
  statDeltaOutOfRange: string;
  anchorBadge: string;
  anchorBadgeTitle: string;
  anchorToggle: string;
  anchorToggleForced: string;
  anchorToggleHint: string;
  statePaused: string;
  stateBuffering: string;
  stateOffline: string;
  offlineHint: string;
  offlineCheckBack: string;
  twitchHlsBadge: string;
  syncTwitchOn: string;
  syncTwitchOff: string;
}

const nl: Messages = {
  tagline: 'meerdere streams, één tijdlijn',
  statusNoStreams: 'Geen streams',
  statusNoStreamsSub: 'Voeg streams toe om te beginnen',
  statusWaiting: 'Wachten op meting…',
  statusWaitingSub: 'Latency wordt gemeten zodra de streams spelen',
  statusReference: (name, forced) => `Referentie: ${name}${forced ? ' (vastgezet)' : ''}`,
  statusSynced: (latency, pending) => `Alles gesynchroniseerd · ${latency}${pending}`,
  statusDrift: (delta, latency, pending) => `Grootste afwijking ${delta} · ${latency}${pending}`,
  statusLatencyUnknown: 'latency niet meetbaar (embed volgt de referentie)',
  statusLatency: (value) => `referentie-latency ${value}`,
  statusPending: (name, gap) => ` · ${name} is ${gap} trager`,
  playAll: 'Alles afspelen',
  playAllTitle: 'Alles afspelen',
  pause: 'Pauze',
  pauseTitle: 'Alles pauzeren',
  resync: 'Her-sync',
  resyncTitle: 'Herstart alle streams op de referentiepositie',
  resyncToast: 'Streams worden herstart op de referentiepositie',
  addStreams: 'Streams toevoegen',
  settings: 'Instellingen',
  emptyTitle: 'Nog geen streams',
  emptyText:
    'Plak Twitch-kanalen, YouTube-links of HLS-streams. De stream met de hoogste latency wordt de referentie; alle andere streams worden daarop gesynchroniseerd.',
  addTitle: 'Streams toevoegen',
  addLabel: 'Streams',
  addPlaceholder: `https://twitch.tv/shroud
https://twitch.tv/kaicenat
https://www.youtube.com/watch?v=...
https://voorbeeld.nl/live/index.m3u8`,
  addHint: 'Eén per regel. Ook een kale Twitch-channelnaam werkt, zoals ',
  addHintEnd: '.',
  cancel: 'Annuleren',
  add: 'Toevoegen',
  addNoValid: (errors) => `Geen geldige streams gevonden: ${errors}`,
  addEmpty: 'Plak minstens één stream.',
  addedToast: (added, skipped, errors) => {
    const parts = [`${added} stream${added === 1 ? '' : 's'} toegevoegd`];
    if (skipped) parts.push(`${skipped} al aanwezig`);
    if (errors) parts.push(`${errors} niet herkend`);
    return parts.join(' · ');
  },
  close: 'Sluiten',
  settingsTitle: 'Instellingen',
  autoSync: 'Automatische sync',
  autoSyncHint: 'Snellere streams lopen langzamer zodat ze de referentie volgen.',
  twitchHls: 'Twitch via HLS',
  twitchHlsHint:
    'Speel Twitch-kanalen via de HLS-playlist (dezelfde route als Streamlink). Latency is dan exact meetbaar en streams zijn echt te seeken. Werkt niet als Twitch de playlist blokkeert; zet dit dan uit om de officiële embed te gebruiken.',
  volume: 'Volume van de actieve stream',
  safetyMargin: 'Veiligheidsmarge (s)',
  safetyMarginHint: 'Extra vertraging zodat het beeld niet hapert.',
  maxLag: 'Maximale afwijking (s)',
  maxLagHint: 'Groter verschil? Dan wordt de stream herstart in plaats van vertraagd.',
  anchorMargin: 'Referentie wisselen vanaf (s)',
  anchorMarginHint:
    'De referentie blijft staan tot een andere stream zóveel seconden trager is (en dat even volhoudt). 0 = altijd de traagste stream.',
  language: 'Taal',
  languageHint: 'Standaard de taal van je systeem; je keuze wordt in een cookie bewaard.',
  languageAuto: 'Automatisch (systeemtaal)',
  languageChanged: (name) => `Taal ingesteld op ${name}`,
  languageAutoToast: (name) => `Taal volgt weer het systeem (${name})`,
  chat: 'Chat',
  chatEmpty: 'Voeg een Twitch-stream toe om de chat te zien.',
  skipToStreams: 'Ga naar de streams',
  twitchLogin: 'Twitch-account',
  twitchLoginHint: 'Log in met je Twitch-account: de chat en streams worden dan ingelogd (zoals op twitch.tv).',
  twitchLogout: 'Uitloggen',
  twitchLoggedIn: (name) => `Ingelogd als ${name}`,
  loginTitle: 'Inloggen met Twitch',
  loginIntro: 'Log in met je Twitch-account. De app ziet nooit je wachtwoord.',
  loginReasonChat: 'De chat werkt met je eigen account: badges, berichten sturen, moderatie.',
  loginReasonSubs: 'Je abonnementen en Turbo/Prime worden herkend.',
  loginReasonAds: 'Met een abonnement of Turbo speelt de stream zonder advertenties.',
  loginPrivacy: 'Je kunt ook anoniem verder: dan werkt alles, maar zonder je account en met advertenties.',
  loginGo: 'Inloggen met Twitch',
  loginAnonymous: 'Anoniem verder',
  loginNotConfigured: 'Inloggen is hier niet geconfigureerd. Stel een eigen Twitch-app in (VITE_TWITCH_CLIENT_ID).',
  loginRedirectHint: 'Redirect-URI die je bij Twitch moet registreren:',
  fatalTitle: 'Er ging iets mis',
  reload: 'Herladen',
  anchorNew: (name) => `Nieuwe referentie: ${name}`,
  anchorForced: (name) => `Referentie vastgezet op ${name}`,
  anchorAuto: 'Referentie weer automatisch',
  remove: 'Stream verwijderen',
  focus: 'Vergroot / verklein',
  playPause: 'Afspelen / pauzeren',
  mute: 'Geluid aan/uit',
  unmute: 'Deze stream hoorbaar maken',
  openPage: (where) => `Open ${where}`,
  openTwitch: (channel) => `Open twitch.tv/${channel}`,
  openYouTube: 'Open op YouTube',
  openStreamUrl: 'Open de stream-URL',
  offsetTitle: 'Handmatige fijnafstelling: + = later afspelen',
  offsetEarlier: '0,5s eerder',
  offsetLater: '0,5s later',
  statLatency: 'latency',
  statDelta: 'verschil',
  statRate: 'snelheid',
  statLatencyTitle: 'Gemeten latency',
  statLatencyUnknownTitle: 'Niet exact meetbaar; deze stream volgt de referentie op basis van relatieve drift',
  statDeltaTitle: 'Verschil met de referentiepositie',
  statDeltaOutOfRange: 'Deze embed kan niet naar de referentie worden gespoeld; hij loopt vrij mee',
  anchorBadge: 'referentie',
  anchorBadgeTitle: 'Referentiestream: deze stream heeft de hoogste latency en bepaalt de sync',
  anchorToggle: 'referentie',
  anchorToggleForced: 'Deze stream is de referentie (klik om terug te gaan naar automatisch)',
  anchorToggleHint: 'Deze stream als referentie gebruiken, ook als een andere trager is',
  statePaused: 'gepauzeerd',
  stateBuffering: 'bufferen',
  stateOffline: 'offline',
  offlineHint: 'Deze stream is nu niet live',
  offlineCheckBack: 'We kijken het na…',
  twitchHlsBadge: 'TWITCH · HLS',
  syncTwitchOn: 'Twitch-streams spelen nu via HLS (exact meetbaar)',
  syncTwitchOff: 'Twitch-streams spelen nu via de officiële embed',
};

const en: Messages = {
  tagline: 'multiple streams, one timeline',
  statusNoStreams: 'No streams',
  statusNoStreamsSub: 'Add streams to get started',
  statusWaiting: 'Waiting for a measurement…',
  statusWaitingSub: 'Latency is measured as soon as the streams are playing',
  statusReference: (name, forced) => `Reference: ${name}${forced ? ' (locked)' : ''}`,
  statusSynced: (latency, pending) => `Everything in sync · ${latency}${pending}`,
  statusDrift: (delta, latency, pending) => `Largest difference ${delta} · ${latency}${pending}`,
  statusLatencyUnknown: 'latency not measurable (embed follows the reference)',
  statusLatency: (value) => `reference latency ${value}`,
  statusPending: (name, gap) => ` · ${name} is ${gap} slower`,
  playAll: 'Play all',
  playAllTitle: 'Play all',
  pause: 'Pause',
  pauseTitle: 'Pause all',
  resync: 'Re-sync',
  resyncTitle: 'Restart all streams at the reference position',
  resyncToast: 'Streams are being restarted at the reference position',
  addStreams: 'Add streams',
  settings: 'Settings',
  emptyTitle: 'No streams yet',
  emptyText:
    'Paste Twitch channels, YouTube links or HLS streams. The stream with the highest latency becomes the reference; all other streams are synced to it.',
  addTitle: 'Add streams',
  addLabel: 'Streams',
  addPlaceholder: `https://twitch.tv/shroud
https://twitch.tv/kaicenat
https://www.youtube.com/watch?v=...
https://example.com/live/index.m3u8`,
  addHint: 'One per line. A bare Twitch channel name works too, like ',
  addHintEnd: '.',
  cancel: 'Cancel',
  add: 'Add',
  addNoValid: (errors) => `No valid streams found: ${errors}`,
  addEmpty: 'Paste at least one stream.',
  addedToast: (added, skipped, errors) => {
    const parts = [`${added} stream${added === 1 ? '' : 's'} added`];
    if (skipped) parts.push(`${skipped} already present`);
    if (errors) parts.push(`${errors} not recognised`);
    return parts.join(' · ');
  },
  close: 'Close',
  settingsTitle: 'Settings',
  autoSync: 'Automatic sync',
  autoSyncHint: 'Faster streams play slower so they follow the reference.',
  twitchHls: 'Twitch via HLS',
  twitchHlsHint:
    'Play Twitch channels through the HLS playlist (the same route Streamlink uses). Latency is then measured exactly and streams can be seeked. Does not work if Twitch blocks the playlist; turn this off to use the official embed.',
  volume: 'Volume of the active stream',
  safetyMargin: 'Safety margin (s)',
  safetyMarginHint: 'Extra delay so the picture does not stutter.',
  maxLag: 'Maximum difference (s)',
  maxLagHint: 'Larger difference? Then the stream is restarted instead of slowed down.',
  anchorMargin: 'Switch reference from (s)',
  anchorMarginHint:
    'The reference stays until another stream is this many seconds slower (and keeps it up for a moment). 0 = always the slowest stream.',
  language: 'Language',
  languageHint: 'Defaults to your system language; your choice is stored in a cookie.',
  languageAuto: 'Automatic (system language)',
  chat: 'Chat',
  chatEmpty: 'Add a Twitch stream to see the chat.',
  skipToStreams: 'Skip to the streams',
  twitchLogin: 'Twitch account',
  twitchLoginHint: 'Log in with your Twitch account: the chat and streams will be logged in (like on twitch.tv).',
  twitchLogout: 'Log out',
  twitchLoggedIn: (name) => `Logged in as ${name}`,
  loginTitle: 'Log in with Twitch',
  loginIntro: 'Log in with your Twitch account. The app never sees your password.',
  loginReasonChat: 'The chat uses your own account: badges, sending messages, moderation.',
  loginReasonSubs: 'Your subscriptions and Turbo/Prime are recognised.',
  loginReasonAds: 'With a subscription or Turbo the stream plays without ads.',
  loginPrivacy: 'You can also continue anonymously: everything works, but without your account and with ads.',
  loginGo: 'Log in with Twitch',
  loginAnonymous: 'Continue anonymously',
  loginNotConfigured: 'Login is not configured here. Set up your own Twitch app (VITE_TWITCH_CLIENT_ID).',
  loginRedirectHint: 'Redirect URI to register with Twitch:',
  languageChanged: (name) => `Language set to ${name}`,
  languageAutoToast: (name) => `Language follows the system again (${name})`,
  fatalTitle: 'Something went wrong',
  reload: 'Reload',
  anchorNew: (name) => `New reference: ${name}`,
  anchorForced: (name) => `Reference locked to ${name}`,
  anchorAuto: 'Reference automatic again',
  remove: 'Remove stream',
  focus: 'Enlarge / shrink',
  playPause: 'Play / pause',
  mute: 'Sound on/off',
  unmute: 'Make this stream audible',
  openPage: (where) => `Open ${where}`,
  openTwitch: (channel) => `Open twitch.tv/${channel}`,
  openYouTube: 'Open on YouTube',
  openStreamUrl: 'Open the stream URL',
  offsetTitle: 'Manual fine-tuning: + = play later',
  offsetEarlier: '0.5s earlier',
  offsetLater: '0.5s later',
  statLatency: 'latency',
  statDelta: 'difference',
  statRate: 'speed',
  statLatencyTitle: 'Measured latency',
  statLatencyUnknownTitle: 'Not exactly measurable; this stream follows the reference based on relative drift',
  statDeltaTitle: 'Difference from the reference position',
  statDeltaOutOfRange: 'This embed cannot be seeked to the reference; it runs freely',
  anchorBadge: 'reference',
  anchorBadgeTitle: 'Reference stream: this stream has the highest latency and determines the sync',
  anchorToggle: 'reference',
  anchorToggleForced: 'This stream is the reference (click to go back to automatic)',
  anchorToggleHint: 'Use this stream as the reference, even if another one is slower',
  statePaused: 'paused',
  stateBuffering: 'buffering',
  stateOffline: 'offline',
  offlineHint: 'This stream is not live right now',
  offlineCheckBack: 'Checking back soon…',
  twitchHlsBadge: 'TWITCH · HLS',
  syncTwitchOn: 'Twitch streams now play via HLS (exactly measurable)',
  syncTwitchOff: 'Twitch streams now play via the official embed',
};

const de: Messages = {
  tagline: 'mehrere Streams, eine Zeitleiste',
  statusNoStreams: 'Keine Streams',
  statusNoStreamsSub: 'Füge Streams hinzu, um zu beginnen',
  statusWaiting: 'Warte auf Messung…',
  statusWaitingSub: 'Die Latenz wird gemessen, sobald die Streams laufen',
  statusReference: (name, forced) => `Referenz: ${name}${forced ? ' (fixiert)' : ''}`,
  statusSynced: (latency, pending) => `Alles synchron · ${latency}${pending}`,
  statusDrift: (delta, latency, pending) => `Größte Abweichung ${delta} · ${latency}${pending}`,
  statusLatencyUnknown: 'Latenz nicht messbar (Embed folgt der Referenz)',
  statusLatency: (value) => `Referenz-Latenz ${value}`,
  statusPending: (name, gap) => ` · ${name} ist ${gap} langsamer`,
  playAll: 'Alle abspielen',
  playAllTitle: 'Alle abspielen',
  pause: 'Pause',
  pauseTitle: 'Alle pausieren',
  resync: 'Neu synchronisieren',
  resyncTitle: 'Alle Streams an der Referenzposition neu starten',
  resyncToast: 'Die Streams werden an der Referenzposition neu gestartet',
  addStreams: 'Streams hinzufügen',
  settings: 'Einstellungen',
  emptyTitle: 'Noch keine Streams',
  emptyText:
    'Füge Twitch-Kanäle, YouTube-Links oder HLS-Streams ein. Der Stream mit der höchsten Latenz wird zur Referenz; alle anderen Streams werden darauf synchronisiert.',
  addTitle: 'Streams hinzufügen',
  addLabel: 'Streams',
  addPlaceholder: `https://twitch.tv/shroud
https://twitch.tv/kaicenat
https://www.youtube.com/watch?v=...
https://beispiel.de/live/index.m3u8`,
  addHint: 'Einer pro Zeile. Ein reiner Twitch-Kanalname funktioniert auch, wie ',
  addHintEnd: '.',
  cancel: 'Abbrechen',
  add: 'Hinzufügen',
  addNoValid: (errors) => `Keine gültigen Streams gefunden: ${errors}`,
  addEmpty: 'Füge mindestens einen Stream ein.',
  addedToast: (added, skipped, errors) => {
    const parts = [`${added} Stream${added === 1 ? '' : 's'} hinzugefügt`];
    if (skipped) parts.push(`${skipped} bereits vorhanden`);
    if (errors) parts.push(`${errors} nicht erkannt`);
    return parts.join(' · ');
  },
  close: 'Schließen',
  settingsTitle: 'Einstellungen',
  autoSync: 'Automatische Synchronisierung',
  autoSyncHint: 'Schnellere Streams laufen langsamer, damit sie der Referenz folgen.',
  twitchHls: 'Twitch über HLS',
  twitchHlsHint:
    'Spielt Twitch-Kanäle über die HLS-Playlist (derselbe Weg wie Streamlink). Die Latenz ist dann exakt messbar und Streams lassen sich wirklich spulen. Funktioniert nicht, wenn Twitch die Playlist blockiert; schalte es dann aus, um das offizielle Embed zu nutzen.',
  volume: 'Lautstärke des aktiven Streams',
  safetyMargin: 'Sicherheitsabstand (s)',
  safetyMarginHint: 'Zusätzliche Verzögerung, damit das Bild nicht stockt.',
  maxLag: 'Maximale Abweichung (s)',
  maxLagHint: 'Größere Abweichung? Dann wird der Stream neu gestartet statt verlangsamt.',
  anchorMargin: 'Referenz wechseln ab (s)',
  anchorMarginHint:
    'Die Referenz bleibt bestehen, bis ein anderer Stream so viele Sekunden langsamer ist (und das kurz durchhält). 0 = immer der langsamste Stream.',
  language: 'Sprache',
  languageHint: 'Standardmäßig die Systemsprache; deine Wahl wird in einem Cookie gespeichert.',
  languageAuto: 'Automatisch (Systemsprache)',
  chat: 'Chat',
  chatEmpty: 'Füge einen Twitch-Stream hinzu, um den Chat zu sehen.',
  skipToStreams: 'Zu den Streams springen',
  twitchLogin: 'Twitch-Konto',
  twitchLoginHint: 'Melde dich mit deinem Twitch-Konto an: Chat und Streams sind dann angemeldet (wie auf twitch.tv).',
  twitchLogout: 'Abmelden',
  twitchLoggedIn: (name) => `Angemeldet als ${name}`,
  loginTitle: 'Mit Twitch anmelden',
  loginIntro: 'Melde dich mit deinem Twitch-Konto an. Die App sieht dein Passwort nie.',
  loginReasonChat: 'Der Chat nutzt dein eigenes Konto: Badges, Nachrichten senden, Moderation.',
  loginReasonSubs: 'Deine Abos und Turbo/Prime werden erkannt.',
  loginReasonAds: 'Mit einem Abo oder Turbo läuft der Stream ohne Werbung.',
  loginPrivacy: 'Du kannst auch anonym weitermachen: alles funktioniert, aber ohne dein Konto und mit Werbung.',
  loginGo: 'Mit Twitch anmelden',
  loginAnonymous: 'Anonym fortfahren',
  loginNotConfigured: 'Anmeldung ist hier nicht konfiguriert. Eigene Twitch-App einrichten (VITE_TWITCH_CLIENT_ID).',
  loginRedirectHint: 'Redirect-URI, die du bei Twitch registrieren musst:',
  languageChanged: (name) => `Sprache auf ${name} gesetzt`,
  languageAutoToast: (name) => `Sprache folgt wieder dem System (${name})`,
  fatalTitle: 'Etwas ist schiefgelaufen',
  reload: 'Neu laden',
  anchorNew: (name) => `Neue Referenz: ${name}`,
  anchorForced: (name) => `Referenz auf ${name} fixiert`,
  anchorAuto: 'Referenz wieder automatisch',
  remove: 'Stream entfernen',
  focus: 'Vergrößern / verkleinern',
  playPause: 'Abspielen / pausieren',
  mute: 'Ton an/aus',
  unmute: 'Diesen Stream hörbar machen',
  openPage: (where) => `${where} öffnen`,
  openTwitch: (channel) => `twitch.tv/${channel} öffnen`,
  openYouTube: 'Auf YouTube öffnen',
  openStreamUrl: 'Die Stream-URL öffnen',
  offsetTitle: 'Manuelle Feinabstimmung: + = später abspielen',
  offsetEarlier: '0,5 s früher',
  offsetLater: '0,5 s später',
  statLatency: 'latenz',
  statDelta: 'unterschied',
  statRate: 'tempo',
  statLatencyTitle: 'Gemessene Latenz',
  statLatencyUnknownTitle:
    'Nicht exakt messbar; dieser Stream folgt der Referenz anhand der relativen Drift',
  statDeltaTitle: 'Unterschied zur Referenzposition',
  statDeltaOutOfRange: 'Dieses Embed lässt sich nicht zur Referenz spulen; es läuft frei mit',
  anchorBadge: 'referenz',
  anchorBadgeTitle: 'Referenz-Stream: dieser Stream hat die höchste Latenz und bestimmt die Synchronisierung',
  anchorToggle: 'referenz',
  anchorToggleForced: 'Dieser Stream ist die Referenz (klicken, um wieder auf automatisch zu gehen)',
  anchorToggleHint: 'Diesen Stream als Referenz verwenden, auch wenn ein anderer langsamer ist',
  statePaused: 'pausiert',
  stateBuffering: 'puffert',
  stateOffline: 'offline',
  offlineHint: 'Dieser Stream ist gerade nicht live',
  offlineCheckBack: 'Wir schauen gleich wieder vorbei…',
  twitchHlsBadge: 'TWITCH · HLS',
  syncTwitchOn: 'Twitch-Streams laufen jetzt über HLS (exakt messbar)',
  syncTwitchOff: 'Twitch-Streams laufen jetzt über das offizielle Embed',
};

const fr: Messages = {
  tagline: 'plusieurs flux, une seule chronologie',
  statusNoStreams: 'Aucun flux',
  statusNoStreamsSub: 'Ajoutez des flux pour commencer',
  statusWaiting: 'En attente de mesure…',
  statusWaitingSub: 'La latence est mesurée dès que les flux sont lancés',
  statusReference: (name, forced) => `Référence : ${name}${forced ? ' (verrouillée)' : ''}`,
  statusSynced: (latency, pending) => `Tout est synchronisé · ${latency}${pending}`,
  statusDrift: (delta, latency, pending) => `Écart maximal ${delta} · ${latency}${pending}`,
  statusLatencyUnknown: 'latence non mesurable (l’embed suit la référence)',
  statusLatency: (value) => `latence de référence ${value}`,
  statusPending: (name, gap) => ` · ${name} est ${gap} plus lent`,
  playAll: 'Tout lire',
  playAllTitle: 'Tout lire',
  pause: 'Pause',
  pauseTitle: 'Tout mettre en pause',
  resync: 'Resynchroniser',
  resyncTitle: 'Redémarrer tous les flux à la position de référence',
  resyncToast: 'Les flux redémarrent à la position de référence',
  addStreams: 'Ajouter des flux',
  settings: 'Paramètres',
  emptyTitle: 'Aucun flux pour le moment',
  emptyText:
    'Collez des chaînes Twitch, des liens YouTube ou des flux HLS. Le flux avec la latence la plus élevée devient la référence ; tous les autres sont synchronisés dessus.',
  addTitle: 'Ajouter des flux',
  addLabel: 'Flux',
  addPlaceholder: `https://twitch.tv/shroud
https://twitch.tv/kaicenat
https://www.youtube.com/watch?v=...
https://exemple.fr/live/index.m3u8`,
  addHint: 'Un par ligne. Un simple nom de chaîne Twitch fonctionne aussi, comme ',
  addHintEnd: '.',
  cancel: 'Annuler',
  add: 'Ajouter',
  addNoValid: (errors) => `Aucun flux valide trouvé : ${errors}`,
  addEmpty: 'Collez au moins un flux.',
  addedToast: (added, skipped, errors) => {
    const parts = [`${added} flux ajouté${added === 1 ? '' : 's'}`];
    if (skipped) parts.push(`${skipped} déjà présent${skipped === 1 ? '' : 's'}`);
    if (errors) parts.push(`${errors} non reconnu${errors === 1 ? '' : 's'}`);
    return parts.join(' · ');
  },
  close: 'Fermer',
  settingsTitle: 'Paramètres',
  autoSync: 'Synchronisation automatique',
  autoSyncHint: 'Les flux plus rapides ralentissent pour suivre la référence.',
  twitchHls: 'Twitch via HLS',
  twitchHlsHint:
    'Lire les chaînes Twitch via la playlist HLS (la même méthode que Streamlink). La latence est alors mesurable précisément et les flux peuvent vraiment être déplacés. Ne fonctionne pas si Twitch bloque la playlist ; désactivez alors cette option pour utiliser l’embed officiel.',
  volume: 'Volume du flux actif',
  safetyMargin: 'Marge de sécurité (s)',
  safetyMarginHint: 'Délai supplémentaire pour éviter les saccades.',
  maxLag: 'Écart maximal (s)',
  maxLagHint: 'Écart plus grand ? Le flux est alors redémarré au lieu d’être ralenti.',
  anchorMargin: 'Changer de référence à partir de (s)',
  anchorMarginHint:
    'La référence reste en place jusqu’à ce qu’un autre flux soit plus lent de ce nombre de secondes (et le reste un moment). 0 = toujours le flux le plus lent.',
  language: 'Langue',
  languageHint: 'Par défaut la langue du système ; votre choix est conservé dans un cookie.',
  languageAuto: 'Automatique (langue du système)',
  chat: 'Chat',
  chatEmpty: 'Ajoutez un flux Twitch pour voir le chat.',
  skipToStreams: 'Aller aux flux',
  twitchLogin: 'Compte Twitch',
  twitchLoginHint: 'Connectez-vous avec votre compte Twitch : le chat et les flux seront connectés (comme sur twitch.tv).',
  twitchLogout: 'Se déconnecter',
  twitchLoggedIn: (name) => `Connecté en tant que ${name}`,
  loginTitle: 'Se connecter avec Twitch',
  loginIntro: 'Connectez-vous avec votre compte Twitch. L’app ne voit jamais votre mot de passe.',
  loginReasonChat: 'Le chat utilise votre propre compte : badges, envoi de messages, modération.',
  loginReasonSubs: 'Vos abonnements et Turbo/Prime sont reconnus.',
  loginReasonAds: 'Avec un abonnement ou Turbo, le flux se lit sans publicité.',
  loginPrivacy: 'Vous pouvez aussi continuer anonymement : tout fonctionne, mais sans votre compte et avec des publicités.',
  loginGo: 'Se connecter avec Twitch',
  loginAnonymous: 'Continuer anonymement',
  loginNotConfigured: 'La connexion n’est pas configurée ici. Configurez votre propre app Twitch (VITE_TWITCH_CLIENT_ID).',
  loginRedirectHint: 'URI de redirection à enregistrer chez Twitch :',
  languageChanged: (name) => `Langue réglée sur ${name}`,
  languageAutoToast: (name) => `La langue suit à nouveau le système (${name})`,
  fatalTitle: 'Une erreur est survenue',
  reload: 'Recharger',
  anchorNew: (name) => `Nouvelle référence : ${name}`,
  anchorForced: (name) => `Référence verrouillée sur ${name}`,
  anchorAuto: 'Référence de nouveau automatique',
  remove: 'Supprimer le flux',
  focus: 'Agrandir / réduire',
  playPause: 'Lire / mettre en pause',
  mute: 'Son activé/désactivé',
  unmute: 'Rendre ce flux audible',
  openPage: (where) => `Ouvrir ${where}`,
  openTwitch: (channel) => `Ouvrir twitch.tv/${channel}`,
  openYouTube: 'Ouvrir sur YouTube',
  openStreamUrl: 'Ouvrir l’URL du flux',
  offsetTitle: 'Réglage manuel : + = lire plus tard',
  offsetEarlier: '0,5 s plus tôt',
  offsetLater: '0,5 s plus tard',
  statLatency: 'latence',
  statDelta: 'écart',
  statRate: 'vitesse',
  statLatencyTitle: 'Latence mesurée',
  statLatencyUnknownTitle:
    'Non mesurable précisément ; ce flux suit la référence selon sa dérive relative',
  statDeltaTitle: 'Écart avec la position de référence',
  statDeltaOutOfRange: 'Cet embed ne peut pas être déplacé vers la référence ; il suit librement',
  anchorBadge: 'référence',
  anchorBadgeTitle: 'Flux de référence : il a la latence la plus élevée et détermine la synchronisation',
  anchorToggle: 'référence',
  anchorToggleForced: 'Ce flux est la référence (cliquez pour revenir en automatique)',
  anchorToggleHint: 'Utiliser ce flux comme référence, même si un autre est plus lent',
  statePaused: 'en pause',
  stateBuffering: 'chargement',
  stateOffline: 'hors ligne',
  offlineHint: 'Ce flux n’est pas en direct pour le moment',
  offlineCheckBack: 'On repasse bientôt…',
  twitchHlsBadge: 'TWITCH · HLS',
  syncTwitchOn: 'Les flux Twitch passent maintenant par HLS (mesure exacte)',
  syncTwitchOff: 'Les flux Twitch passent maintenant par l’embed officiel',
};

const es: Messages = {
  tagline: 'varios streams, una sola línea de tiempo',
  statusNoStreams: 'Sin streams',
  statusNoStreamsSub: 'Añade streams para empezar',
  statusWaiting: 'Esperando medición…',
  statusWaitingSub: 'La latencia se mide en cuanto los streams se reproducen',
  statusReference: (name, forced) => `Referencia: ${name}${forced ? ' (fijada)' : ''}`,
  statusSynced: (latency, pending) => `Todo sincronizado · ${latency}${pending}`,
  statusDrift: (delta, latency, pending) => `Mayor diferencia ${delta} · ${latency}${pending}`,
  statusLatencyUnknown: 'latencia no medible (el embed sigue a la referencia)',
  statusLatency: (value) => `latencia de referencia ${value}`,
  statusPending: (name, gap) => ` · ${name} es ${gap} más lento`,
  playAll: 'Reproducir todo',
  playAllTitle: 'Reproducir todo',
  pause: 'Pausa',
  pauseTitle: 'Pausar todo',
  resync: 'Resincronizar',
  resyncTitle: 'Reiniciar todos los streams en la posición de referencia',
  resyncToast: 'Los streams se reinician en la posición de referencia',
  addStreams: 'Añadir streams',
  settings: 'Ajustes',
  emptyTitle: 'Todavía no hay streams',
  emptyText:
    'Pega canales de Twitch, enlaces de YouTube o streams HLS. El stream con mayor latencia se convierte en la referencia; el resto se sincroniza con él.',
  addTitle: 'Añadir streams',
  addLabel: 'Streams',
  addPlaceholder: `https://twitch.tv/shroud
https://twitch.tv/kaicenat
https://www.youtube.com/watch?v=...
https://ejemplo.es/live/index.m3u8`,
  addHint: 'Uno por línea. También funciona un nombre de canal de Twitch, como ',
  addHintEnd: '.',
  cancel: 'Cancelar',
  add: 'Añadir',
  addNoValid: (errors) => `No se han encontrado streams válidos: ${errors}`,
  addEmpty: 'Pega al menos un stream.',
  addedToast: (added, skipped, errors) => {
    const parts = [`${added} stream${added === 1 ? '' : 's'} añadido${added === 1 ? '' : 's'}`];
    if (skipped) parts.push(`${skipped} ya presente${skipped === 1 ? '' : 's'}`);
    if (errors) parts.push(`${errors} no reconocido${errors === 1 ? '' : 's'}`);
    return parts.join(' · ');
  },
  close: 'Cerrar',
  settingsTitle: 'Ajustes',
  autoSync: 'Sincronización automática',
  autoSyncHint: 'Los streams más rápidos se reproducen más despacio para seguir a la referencia.',
  twitchHls: 'Twitch vía HLS',
  twitchHlsHint:
    'Reproduce los canales de Twitch mediante la lista HLS (la misma ruta que Streamlink). Así la latencia se mide con exactitud y los streams se pueden adelantar o atrasar de verdad. No funciona si Twitch bloquea la lista; desactívalo para usar el embed oficial.',
  volume: 'Volumen del stream activo',
  safetyMargin: 'Margen de seguridad (s)',
  safetyMarginHint: 'Retraso adicional para que la imagen no se corte.',
  maxLag: 'Diferencia máxima (s)',
  maxLagHint: '¿Diferencia mayor? Entonces el stream se reinicia en vez de ralentizarse.',
  anchorMargin: 'Cambiar referencia a partir de (s)',
  anchorMarginHint:
    'La referencia se mantiene hasta que otro stream sea tantos segundos más lento (y lo mantenga un momento). 0 = siempre el stream más lento.',
  language: 'Idioma',
  languageHint: 'Por defecto el idioma del sistema; tu elección se guarda en una cookie.',
  languageAuto: 'Automático (idioma del sistema)',
  chat: 'Chat',
  chatEmpty: 'Añade un stream de Twitch para ver el chat.',
  skipToStreams: 'Ir a los streams',
  twitchLogin: 'Cuenta de Twitch',
  twitchLoginHint: 'Inicia sesión con tu cuenta de Twitch: el chat y los streams estarán conectados (como en twitch.tv).',
  twitchLogout: 'Cerrar sesión',
  twitchLoggedIn: (name) => `Sesión iniciada como ${name}`,
  loginTitle: 'Iniciar sesión con Twitch',
  loginIntro: 'Inicia sesión con tu cuenta de Twitch. La app nunca ve tu contraseña.',
  loginReasonChat: 'El chat usa tu propia cuenta: insignias, enviar mensajes, moderación.',
  loginReasonSubs: 'Se reconocen tus suscripciones y Turbo/Prime.',
  loginReasonAds: 'Con una suscripción o Turbo el stream se reproduce sin anuncios.',
  loginPrivacy: 'También puedes continuar de forma anónima: todo funciona, pero sin tu cuenta y con anuncios.',
  loginGo: 'Iniciar sesión con Twitch',
  loginAnonymous: 'Continuar de forma anónima',
  loginNotConfigured: 'El inicio de sesión no está configurado aquí. Configura tu propia app de Twitch (VITE_TWITCH_CLIENT_ID).',
  loginRedirectHint: 'URI de redirección que debes registrar en Twitch:',
  languageChanged: (name) => `Idioma establecido en ${name}`,
  languageAutoToast: (name) => `El idioma vuelve a seguir al sistema (${name})`,
  fatalTitle: 'Algo ha salido mal',
  reload: 'Recargar',
  anchorNew: (name) => `Nueva referencia: ${name}`,
  anchorForced: (name) => `Referencia fijada en ${name}`,
  anchorAuto: 'Referencia automática de nuevo',
  remove: 'Eliminar stream',
  focus: 'Ampliar / reducir',
  playPause: 'Reproducir / pausar',
  mute: 'Sonido activado/desactivado',
  unmute: 'Hacer audible este stream',
  openPage: (where) => `Abrir ${where}`,
  openTwitch: (channel) => `Abrir twitch.tv/${channel}`,
  openYouTube: 'Abrir en YouTube',
  openStreamUrl: 'Abrir la URL del stream',
  offsetTitle: 'Ajuste manual: + = reproducir más tarde',
  offsetEarlier: '0,5 s antes',
  offsetLater: '0,5 s después',
  statLatency: 'latencia',
  statDelta: 'diferencia',
  statRate: 'velocidad',
  statLatencyTitle: 'Latencia medida',
  statLatencyUnknownTitle:
    'No medible con exactitud; este stream sigue a la referencia según su deriva relativa',
  statDeltaTitle: 'Diferencia con la posición de referencia',
  statDeltaOutOfRange: 'Este embed no se puede mover a la referencia; se reproduce libremente',
  anchorBadge: 'referencia',
  anchorBadgeTitle: 'Stream de referencia: tiene la latencia más alta y determina la sincronización',
  anchorToggle: 'referencia',
  anchorToggleForced: 'Este stream es la referencia (haz clic para volver a automático)',
  anchorToggleHint: 'Usar este stream como referencia, aunque otro sea más lento',
  statePaused: 'en pausa',
  stateBuffering: 'cargando',
  stateOffline: 'sin conexión',
  offlineHint: 'Este stream no está en directo ahora',
  offlineCheckBack: 'Volvemos enseguida…',
  twitchHlsBadge: 'TWITCH · HLS',
  syncTwitchOn: 'Los streams de Twitch ahora se reproducen vía HLS (medición exacta)',
  syncTwitchOff: 'Los streams de Twitch ahora se reproducen vía el embed oficial',
};

export const MESSAGES: Record<Lang, Messages> = { nl, en, de, fr, es };
