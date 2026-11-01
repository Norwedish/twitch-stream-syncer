import type { StreamConfig } from './sources';

const STORAGE_KEY = 'stream-syncer:state:v2';

export interface AppSettings {
  /** Automatisch corrigeren van drift. */
  autoSync: boolean;
  /** Volume van de actieve (aangeklikte) stream. */
  masterVolume: number;
  /** Extra seconden dat de referentie voorloopt. */
  safetyMargin: number;
  /** Vanaf deze afwijking (s) herstarten we in plaats van vertragen. */
  maxLag: number;
  /** Twitch-kanalen via de HLS-playlist spelen (exact meetbaar en seekbaar). */
  twitchHls: boolean;
  /**
   * Hoeveel seconden een andere stream méér latency moet hebben voordat de
   * referentie wisselt. Zo blijft de referentie stabiel.
   */
  anchorSwitchMargin: number;
  /**
   * Groter verschil dan dit (s) is bijna zeker een meetfout (speler even
   * gepauzeerd, playlist-venster versprongen); dan wisselen we niet.
   */
  maxPlausibleGap: number;
}

export interface AppState {
  version: 2;
  streams: StreamConfig[];
  settings: AppSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoSync: true,
  masterVolume: 0.8,
  safetyMargin: 0,
  maxLag: 6,
  twitchHls: true,
  anchorSwitchMargin: 3,
  /** Bij meer dan dit verschil (s) vertrouwen we een meting niet en wisselen we niet. */
  maxPlausibleGap: 60,
};

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 2, streams: [], settings: { ...DEFAULT_SETTINGS } };
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const streams = Array.isArray(parsed.streams) ? parsed.streams.filter(isStreamConfig) : [];
    return {
      version: 2,
      streams,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
    };
  } catch {
    return { version: 2, streams: [], settings: { ...DEFAULT_SETTINGS } };
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage kan vol of geblokkeerd zijn; niet fataal. */
  }
}

function isStreamConfig(value: unknown): value is StreamConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.ref === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.offset === 'number'
  );
}

export function newStreamId(): string {
  return Math.random().toString(36).slice(2, 10);
}
