/**
 * HLS-tijdlijn: leest de media-playlist en berekent de latency.
 *
 * Een HLS-server schrijft in de EXT-X-PROGRAM-DATE-TIME-tag de wandkloktijd van
 * een segment. De latency van een speler is dan:
 *
 *   latency = (einde van het nieuwste segment) - (positie van de speler)
 *
 * Dat is precies "hoeveel seconden loopt deze speler achter op wat er nu live
 * is". Heeft een playlist geen PDT, dan vallen we terug op EXT-X-TIMESTAMP-MAP
 * of, als laatste redmiddel, op het moment waarop de playlist is opgehaald.
 */

export interface HlsTimeline {
  url: string;
  /** Unix-tijd (ms) waarop de playlist is opgehaald. */
  fetchedAt: number;
  mediaSequence: number;
  /** Cumulatieve duur (s) aan het einde van elk segment. */
  ends: number[];
  /** Wandkloktijd (ms) per segment. */
  wallClocks: number[];
  /** Einde van het nieuwste segment (ms). */
  liveEdge: number;
  /** Wandkloktijd (ms) van het einde van het nieuwste segment, zonder skew. */
  endWall: number;
  live: boolean;
  /** True als de tijden geschat zijn (geen PDT en geen timestamp-map). */
  estimated: boolean;
}

export interface HlsTimelineResult {
  timeline: HlsTimeline | null;
  /** Waarschuwing over de meting, of null als alles exact is. */
  problem: string | null;
}

interface TimestampMap {
  mpegts: number;
  local: number;
}

/** Grotere afwijking dan dit betekent een VOD of een foutieve playlist. */
const MAX_SKEW_MS = 120_000;
/** Kleinere achterstand dan dit is normale CDN-vertraging, geen oude cache. */
const MIN_SKEW_MS = 15_000;
/** Een live playlist heeft een kort venster; langer = VOD. */
const MAX_LIVE_WINDOW_S = 300;

export function parseHlsPlaylist(text: string, url: string, fetchedAt = Date.now()): HlsTimelineResult {
  const ends: number[] = [];
  const wallClocks: number[] = [];
  let total = 0;
  let mediaSequence = 0;
  let live = true;
  let pendingPdt: number | null = null;
  let lastPdt: number | null = null;
  let timestampMap: TimestampMap | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = Number.parseInt(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length), 10) || 0;
    } else if (line.startsWith('#EXT-X-TIMESTAMP-MAP:')) {
      timestampMap = parseTimestampMap(line);
    } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      const ms = Date.parse(line.slice('#EXT-X-PROGRAM-DATE-TIME:'.length).trim());
      if (Number.isFinite(ms)) {
        pendingPdt = ms;
        lastPdt = ms;
      }
    } else if (line.startsWith('#EXTINF:')) {
      const duration = Number.parseFloat(line.slice('#EXTINF:'.length));
      if (!Number.isFinite(duration) || duration <= 0) continue;
      total += duration;
      ends.push(total);
      wallClocks.push(pendingPdt ?? Number.NaN);
      pendingPdt = null;
    } else if (line === '#EXT-X-ENDLIST') {
      live = false;
    }
  }

  if (ends.length === 0) {
    return { timeline: null, problem: 'Geen segmenten gevonden in de playlist.' };
  }

  let estimated = false;

  // Zonder PDT: gebruik EXT-X-TIMESTAMP-MAP (MPEGTS-klok -> wandklok).
  if (lastPdt === null && timestampMap !== null) {
    wallClocks[0] = timestampMap.local - (timestampMap.mpegts / 90000) * 1000;
    lastPdt = wallClocks[0];
  }

  // Nog steeds niets: de playlist is net opgehaald, dus het laatste segment
  // eindigde ongeveer nu.
  if (lastPdt === null) {
    wallClocks[0] = fetchedAt - total * 1000;
    lastPdt = wallClocks[0];
    estimated = true;
  }

  // Is het een live playlist? Een VOD heeft een ENDLIST of een speelduur van
  // minuten; live playlists hebben een kort venster.
  const liveWindow = total <= MAX_LIVE_WINDOW_S;

  // PDT staat soms alleen op één segment; reken de rest dan door.
  const reference = wallClocks.findIndex((v) => Number.isFinite(v));
  if (reference !== -1) {
    for (let i = 0; i < wallClocks.length; i++) {
      if (Number.isFinite(wallClocks[i])) continue;
      wallClocks[i] = wallClocks[reference] + (ends[i] - ends[reference]) * 1000;
    }
  }

  const lastDuration = ends[ends.length - 1] - (ends[ends.length - 2] ?? 0);
  const lastWall = wallClocks[wallClocks.length - 1];
  const liveEdge = Number.isFinite(lastWall) ? lastWall + lastDuration * 1000 : lastPdt + lastDuration * 1000;

  // Soms is de playlist ouder dan verwacht (CDN-cache, trage server). De live
  // edge kan dan niet voor het ophaalmoment liggen; schuif de tijdlijn op.
  // Grotere afwijkingen betekenen een VOD of een foutieve playlist: dan niet.
  // De skew geldt voor de hele tijdlijn (ook de segmenten), anders zou de
  // spelerpositie niet meer bij het einde van de playlist passen.
  const behind = fetchedAt - liveEdge;
  // Twitch levert geen PDT en publiceert segmenten van 2 seconden; de playlist
  // is dan bijna altijd iets ouder dan het laatste segment. Een kleine
  // afwijking is dan de normale vertraging van de CDN, geen skew. Alleen een
  // flinke achterstand (oude cache) schuiven we op.
  const skew =
    live && liveWindow && !estimated && behind > MIN_SKEW_MS && behind < MAX_SKEW_MS ? behind : 0;
  if (skew > 0) {
    for (let i = 0; i < wallClocks.length; i++) wallClocks[i] += skew;
  }

  // Wandkloktijd van het einde van de playlist. `liveEdge` is de geschatte
  // live edge; `endWall` is het einde van het nieuwste segment zelf en wordt
  // gebruikt om de spelerpositie te ijken.
  const endWall = (Number.isFinite(lastWall) ? lastWall : lastPdt) + lastDuration * 1000 + skew;

  return {
    timeline: {
      url,
      fetchedAt,
      mediaSequence,
      ends,
      wallClocks,
      liveEdge: liveEdge + skew,
      endWall,
      live,
      estimated,
    },
    problem: estimated
      ? 'Geen PROGRAM-DATE-TIME in de playlist; latency is geschat op basis van de playlist.'
      : null,
  };
}
function parseTimestampMap(line: string): TimestampMap | null {
  const body = line.slice('#EXT-X-TIMESTAMP-MAP:'.length);
  const mpegts = /MPEGTS=(\d+)/.exec(body);
  const local = /LOCAL=([^,\s]+)/.exec(body);
  if (!mpegts || !local) return null;
  const localMs = Date.parse(local[1]);
  if (!Number.isFinite(localMs)) return null;
  return { mpegts: Number.parseInt(mpegts[1], 10), local: localMs };
}

/**
 * Latency (s) van een speler die op `position` seconden in de playlist staat.
 * `position` = hls.currentTime - hls.startPosition (seconden sinds de eerste
 * media in de playlist).
 */
export function latencyFromPosition(
  timeline: HlsTimeline,
  position: number,
  liveEdge = timeline.liveEdge,
): number | null {
  if (timeline.ends.length === 0) return null;
  const index = timeline.ends.findIndex((end) => end > position);
  const segmentIndex = index === -1 ? timeline.ends.length - 1 : index;
  const wallClock = timeline.wallClocks[segmentIndex];
  if (!Number.isFinite(wallClock)) return null;
  const segmentStart = timeline.ends[segmentIndex - 1] ?? 0;
  const playerWall = wallClock + (position - segmentStart) * 1000;
  return (liveEdge - playerWall) / 1000;
}

/**
 * Haalt een playlist op. Is het een master-playlist, dan volgt de variant met
 * de hoogste bandbreedte.
 */
export async function fetchHlsTimeline(url: string, signal?: AbortSignal): Promise<HlsTimelineResult> {
  const fetchedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', signal });
  } catch (error) {
    return { timeline: null, problem: `Playlist niet bereikbaar (${describeError(error)}).` };
  }
  if (!response.ok) {
    return { timeline: null, problem: `Playlist gaf HTTP ${response.status}.` };
  }
  const text = await response.text();
  const variant = pickVariant(text, url);
  if (variant) return fetchHlsTimeline(variant, signal);
  return parseHlsPlaylist(text, url, fetchedAt);
}

/** Kiest de variant met de hoogste bandbreedte uit een master-playlist. */
export function pickVariant(masterText: string, baseUrl: string): string | null {
  if (!masterText.includes('#EXT-X-STREAM-INF')) return null;
  const lines = masterText.split(/\r?\n/);
  let best: { bandwidth: number; uri: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const match = /BANDWIDTH=(\d+)/.exec(line);
    const bandwidth = match ? Number.parseInt(match[1], 10) : 0;
    for (let j = i + 1; j < lines.length; j++) {
      const uri = lines[j].trim();
      if (!uri || uri.startsWith('#')) continue;
      if (!best || bandwidth > best.bandwidth) best = { bandwidth, uri };
      break;
    }
  }
  return best ? new URL(best.uri, baseUrl).href : null;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.name === 'AbortError' ? 'afgebroken' : error.message;
  return String(error);
}
