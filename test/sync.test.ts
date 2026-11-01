/**
 * Kleine test-runner (geen testframework nodig):
 *   npm test
 */
import { buildSyncPlan, type SyncInput } from '../src/sync.ts';
import { parseHlsPlaylist, latencyFromPosition, pickVariant } from '../src/hls-timeline.ts';
import { parseVariants, pickVariant as pickTwitchVariant } from '../src/twitch-hls.ts';

interface TestResult {
  name: string;
  ok: boolean;
  message?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function close(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 1e-9, `${message} (verwacht ${expected}, kreeg ${actual})`);
}

const tuning = { autoSync: true, safetyMargin: 0, maxLag: 6, anchorSwitchMargin: 3, maxPlausibleGap: 60 };

function input(id: string, latency: number | null, extra: Partial<SyncInput> = {}): SyncInput {
  return {
    id,
    kind: latency === null ? 'twitch' : 'hls',
    latency,
    drift: 0,
    playing: true,
    offset: 0,
    userPaused: false,
    ...extra,
  };
}

test('kiest de stream met de hoogste latency als referentie', () => {
  const plan = buildSyncPlan([input('a', 4), input('b', 9), input('c', 6)], tuning, 100);
  assert(plan.anchorId === 'b', 'referentie moet b zijn');
  assert(plan.anchorLatency === 9, 'referentie-latency moet 9 zijn');
  const b = plan.members.find((m) => m.id === 'b');
  assert(b, 'b ontbreekt');
  assert(b.delta === 0 && b.rate === 1, 'referentie mag niet gecorrigeerd worden');
});

test('vertraagt snellere streams richting de referentie', () => {
  const plan = buildSyncPlan([input('slow', 10), input('fast', 4)], tuning, 100);
  const fast = plan.members.find((m) => m.id === 'fast');
  assert(fast, 'fast ontbreekt');
  assert(fast.delta < 0, 'snelle stream loopt voor');
  assert(fast.rate < 1, 'snelle stream moet langzamer');
  assert(fast.rate >= 0.85, 'rate blijft binnen de bandbreedte');
  assert(!fast.needsRestart, 'kleine afwijking hoeft geen herstart');
});

test('herstart streams die te ver voorlopen', () => {
  const plan = buildSyncPlan([input('slow', 20), input('fast', 2)], tuning, 100);
  const fast = plan.members.find((m) => m.id === 'fast');
  assert(fast, 'fast ontbreekt');
  assert(fast.needsRestart, 'grote afwijking moet herstarten');
});

test('laat embeds de referentie volgen via hun drift', () => {
  const plan = buildSyncPlan([input('slow', 10), input('embed', null, { drift: -1.5 })], tuning, 100);
  const embed = plan.members.find((m) => m.id === 'embed');
  assert(embed, 'embed ontbreekt');
  assert(embed.delta < 0, 'embed loopt voor en moet vertragen');
  assert(embed.rate < 1, 'embed krijgt een lagere rate');
});

test('laat embeds die buiten bereik liggen vrij lopen', () => {
  const plan = buildSyncPlan(
    [input('slow', 120), input('embed', null, { drift: 0 })],
    tuning,
    100,
  );
  const embed = plan.members.find((m) => m.id === 'embed');
  assert(embed, 'embed ontbreekt');
  assert(!embed.needsRestart && !embed.shouldPause, 'buiten bereik: geen herstart of pauze');
});

test('doet niets als autoSync uit staat', () => {
  const plan = buildSyncPlan([input('slow', 10), input('fast', 2)], { ...tuning, autoSync: false }, 100);
  for (const m of plan.members) {
    assert(m.rate === 1 && !m.needsRestart, `${m.id} mag niet gecorrigeerd worden`);
  }
});

test('past de handmatige offset toe', () => {
  const plan = buildSyncPlan([input('slow', 10), input('fast', 4, { offset: 2 })], tuning, 100);
  const fast = plan.members.find((m) => m.id === 'fast');
  assert(fast, 'fast ontbreekt');
  // Referentie staat op 90, de snelle stream op 98 (96 + 2s offset): 8s voor.
  close(fast.delta, -8, 'offset moet de positie verschuiven');
});

const playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:100
#EXT-X-PROGRAM-DATE-TIME:2026-01-01T12:00:00.000Z
#EXTINF:4.0,
a.ts
#EXT-X-PROGRAM-DATE-TIME:2026-01-01T12:00:04.000Z
#EXTINF:4.0,
b.ts
#EXT-X-PROGRAM-DATE-TIME:2026-01-01T12:00:08.000Z
#EXTINF:4.0,
c.ts
`;

test('berekent de live edge uit PROGRAM-DATE-TIME', () => {
  const { timeline, problem } = parseHlsPlaylist(playlist, 'https://x/y.m3u8');
  assert(problem === null, `onverwacht probleem: ${problem}`);
  assert(timeline, 'timeline ontbreekt');
  assert(timeline.liveEdge === Date.parse('2026-01-01T12:00:12.000Z'), 'live edge klopt niet');
  close(timeline.ends[2], 12, 'totale duur');
});

test('berekent de latency van de spelerpositie', () => {
  const { timeline } = parseHlsPlaylist(playlist, 'https://x/y.m3u8');
  assert(timeline, 'timeline ontbreekt');
  close(latencyFromPosition(timeline, 6) ?? -1, 6, 'midden in segment b');
  close(latencyFromPosition(timeline, 0) ?? -1, 12, 'begin van de playlist');
  close(latencyFromPosition(timeline, 12) ?? -1, 0, 'live edge');
});

test('schat de tijdlijn als PDT ontbreekt', () => {
  const fetchedAt = Date.parse('2026-01-01T12:00:00.000Z');
  const { timeline, problem } = parseHlsPlaylist(
    '#EXTM3U\n#EXTINF:4,\na.ts\n#EXTINF:4,\nb.ts\n',
    'https://x/y.m3u8',
    fetchedAt,
  );
  assert(timeline, 'timeline ontbreekt');
  assert(timeline.estimated, 'moet als geschat gemarkeerd zijn');
  assert(timeline.liveEdge === fetchedAt, 'live edge valt samen met het ophaalmoment');
  assert(/PROGRAM-DATE-TIME/.test(problem ?? ''), 'probleem moet PDT noemen');
});

test('leest Twitch-kwaliteiten en kiest de gevraagde', () => {
  const master = `#EXTM3U
#EXT-X-TWITCH-ELAPSED-SECS:10.0
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.0,NAME="1080p60 (source)"
https://video-weaver.ams02.hls.ttvnw.net/v1/playlist/a.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=60.0,NAME="720p60"
https://video-weaver.ams02.hls.ttvnw.net/v1/playlist/b.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=160000,RESOLUTION=284x160,NAME="160p"
https://video-weaver.ams02.hls.ttvnw.net/v1/playlist/c.m3u8
`;
  const variants = parseVariants(master);
  assert(variants.length === 3, 'drie kwaliteiten');
  assert(variants[0].name === '1080p60 (source)', 'hoogste eerst');
  assert(pickTwitchVariant(variants, 'best').name === '1080p60 (source)', 'best = hoogste');
  assert(pickTwitchVariant(variants, '720p60').name === '720p60', 'exacte naam');
  assert(pickTwitchVariant(variants, '720').name === '720p60', 'op hoogte');
  assert(pickTwitchVariant(variants, 'worst').name === '160p', 'worst = laagste');
});

test('houdt de referentie vast bij kleine verschillen', () => {
  // b is iets trager, maar niet meer dan de marge: a blijft referentie.
  const plan = buildSyncPlan([input('a', 10), input('b', 11)], tuning, 100, 'a');
  assert(plan.anchorId === 'a', `referentie moet a blijven, kreeg ${plan.anchorId}`);
  assert(plan.slowestId === 'b', 'traagste stream moet wel zichtbaar zijn');
  close(plan.slowestGap, 1, 'verschil met de traagste');
});

test('wisselt de referentie bij een groot verschil', () => {
  const plan = buildSyncPlan([input('a', 10), input('b', 20)], tuning, 100, 'a');
  assert(plan.anchorId === 'b', `referentie moet b worden, kreeg ${plan.anchorId}`);
});

test('kiest de traagste stream als er nog geen referentie is', () => {
  const plan = buildSyncPlan([input('a', 10), input('b', 20)], tuning, 100, null);
  assert(plan.anchorId === 'b', 'eerste referentie = traagste');
});

test('wisselt als de oude referentie verdwenen is', () => {
  const plan = buildSyncPlan([input('b', 10), input('c', 12)], tuning, 100, 'a');
  assert(plan.anchorId === 'c', 'zonder oude referentie de traagste nemen');
});

test('een handmatig gekozen referentie wint van de traagste stream', () => {
  const plan = buildSyncPlan(
    [input('slow', 20), input('chosen', 10, { forcedAnchor: true })],
    tuning,
    100,
    null,
  );
  assert(plan.anchorId === 'chosen', `referentie moet chosen zijn, kreeg ${plan.anchorId}`);
  assert(plan.forcedAnchor, 'plan moet als handmatig gemarkeerd zijn');
  assert(plan.slowestId === 'slow', 'traagste stream blijft zichtbaar');
});

test('een handmatig gekozen embed is referentie met zijn eigen drift', () => {
  const plan = buildSyncPlan(
    [input('hls', 30), input('embed', null, { drift: 2, forcedAnchor: true })],
    tuning,
    100,
    null,
  );
  assert(plan.anchorId === 'embed', `referentie moet embed zijn, kreeg ${plan.anchorId}`);
  const hls = plan.members.find((m) => m.id === 'hls');
  assert(hls, 'hls ontbreekt');
  // De embed is referentie met latency 2s; de HLS-stream (30s) loopt 26s voor.
  close(hls.delta, 26, 'verschil met de gekozen referentie');
});

test('een gepauzeerde handmatige referentie telt niet', () => {
  const plan = buildSyncPlan(
    [input('slow', 20), input('chosen', 10, { forcedAnchor: true, userPaused: true })],
    tuning,
    100,
    null,
  );
  assert(plan.anchorId === 'slow', 'pauze overschrijft de handmatige keuze');
  assert(!plan.forcedAnchor, 'niet meer handmatig');
});

test('pauzeert nooit: te ver voorlopen = langzamer afspelen', () => {
  const plan = buildSyncPlan([input('slow', 20), input('fast', 16)], tuning, 100);
  const fast = plan.members.find((m) => m.id === 'fast');
  assert(fast, 'fast ontbreekt');
  assert(fast.rate < 1, `moet langzamer (rate ${fast.rate})`);
  assert(fast.rate >= 0.85, 'niet langzamer dan 0.85x');
  assert(!fast.needsRestart, 'binnen de marge: geen herstart');
  assert(!('shouldPause' in fast) || fast.shouldPause === false, 'nooit pauzeren');
});

test('volgt de hoogste variant van een master-playlist', () => {  const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=500000
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000
high/index.m3u8
`;
  const variant = pickVariant(master, 'https://x/live/master.m3u8');
  assert(variant === 'https://x/live/high/index.m3u8', `verkeerde variant: ${variant}`);
});

let failed = 0;
for (const result of results) {
  if (result.ok) {
    console.log(`  ok   ${result.name}`);
  } else {
    failed++;
    console.log(`  FAIL ${result.name}\n       ${result.message}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} tests geslaagd`);
if (failed > 0) process.exit(1);
