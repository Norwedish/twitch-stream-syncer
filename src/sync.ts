/**
 * Synchronisatie-engine.
 *
 * Elke stream krijgt een "positie" in de gedeelde tijdlijn (seconden sinds een
 * denkbeeldige start). Een lage positie = de stream loopt achter, de kijker
 * ziet ouder beeld. De stream met de hoogste latency (laagste positie) is de
 * referentie; alle andere streams moeten dezelfde positie volgen.
 *
 * De referentie is "sticky": we houden dezelfde stream vast, ook als een andere
 * stream even iets meer latency meet. Pas als een andere stream duidelijk
 * (meer dan `anchorSwitchMargin` seconden) meer latency heeft, en dat een tijdje
 * volhoudt, wisselen we. Anders zou de referentie bij elke meting verspringen.
 *
 * Correctie gebeurt in twee trappen:
 *  1. Fijn: playbackRate licht aanpassen (bv. 0.97x) zodat een stream rustig
 *     naar de referentie toe kruipt.
 *  2. Grof: herstarten op de juiste positie, alleen als de afwijking zo groot
 *     is dat vertragen te lang zou duren.
 *
 * Streams zonder exacte meting (Twitch/YouTube embeds) krijgen de latency van
 * de referentie toegewezen plus hun eigen drift. Daardoor lopen ze mee met de
 * referentie en corrigeren ze zichzelf relatief.
 */
import type { SourceKind } from './sources';

export interface SyncTuning {
  autoSync: boolean;
  /** Extra seconden dat de referentie voorloopt. */
  safetyMargin: number;
  /** Vanaf deze afwijking (s) herstarten we in plaats van vertragen. */
  maxLag: number;
  /**
   * Hoeveel seconden een andere stream méér latency moet hebben voordat we de
   * referentie wisselen. 0 = altijd de traagste stream (oud gedrag).
   */
  anchorSwitchMargin: number;
  /**
   * Groter verschil dan dit (s) is bijna zeker een meetfout (speler even
   * gepauzeerd, playlist-venster versprongen); dan wisselen we niet.
   */
  maxPlausibleGap: number;
}

export interface SyncInput {
  id: string;
  kind: SourceKind;
  /** Gemeten latency in seconden (alleen voor meetbare streams). */
  latency: number | null;
  /**
   * Beeldmoment in wandklok (ms): het moment van de uitzending dat nu te
   * zien is. Twee spelers met dezelfde waarde tonen hetzelfde moment.
   * Null als de speler niet precies te meten is (embeds).
   */
  playheadWall?: number | null;
  /** Relatieve drift in seconden t.o.v. het moment van aansluiten. */
  drift: number;
  /** Speelt de speler op dit moment? */
  playing: boolean;
  /** Handmatige fijnafstelling in seconden. */
  offset: number;
  /** Gebruiker heeft deze stream handmatig gepauzeerd. */
  userPaused: boolean;
  /** Gebruiker heeft deze stream met de hand als referentie gekozen. */
  forcedAnchor?: boolean;
}

export interface SyncMember extends SyncInput {
  position: number;
  target: number;
  /** target - position. Positief = loopt achter, negatief = loopt voor. */
  delta: number;
  isAnchor: boolean;
  rate: number;
  needsRestart: boolean;
  /** Embed zonder exacte meting die te ver van de referentie zit om te corrigeren. */
  outOfRange: boolean;
  /**
   * Wandkloktijd (ms) waarop deze stream moet staan: het beeld van de
   * referentie (plus de handmatige fijnafstelling). Null als niet meetbaar.
   */
  targetWall: number | null;
}

export interface SyncPlan {
  members: SyncMember[];
  anchorId: string | null;
  anchorLatency: number | null;
  /** True als minstens één stream een exacte meting heeft. */
  hasMeasurement: boolean;
  /** De traagste gemeten stream, ook als we een andere referentie vasthouden. */
  slowestId: string | null;
  /** Hoeveel seconden de traagste stream trager is dan de huidige referentie. */
  slowestGap: number;
  /** De referentie is met de hand gekozen (niet automatisch). */
  forcedAnchor: boolean;
}

/**
 * Snelheden waarmee we corrigeren. Bewust geen 0.5x: zo traag klinkt als een
 * kapotte plaat. 0.85x–1.15x valt nauwelijks op, en grotere verschillen lossen
 * we op door de stream opnieuw te starten op de referentiepositie.
 */
const RATE_MIN = 0.85;
const RATE_MAX = 1.15;
const RATE_GAIN = 0.2;
/** Kleiner verschil dan dit: niets doen. */
const RESTART_DEADBAND = 0.15;
/**
 * Groter verschil dan dit (s) tussen twee spelers is geen echte achterstand
 * maar een meting die nog niet klopt (bv. een speler die net begint). Dan
 * wachten we, in plaats van de stream eindeloos te herstarten.
 */
const MAX_PLAUSIBLE_DELTA = 300;

/**
 * Kiest de referentie. `previousAnchorId` wordt vastgehouden zolang geen andere
 * stream meer dan `switchMargin` seconden trager is.
 */
export function chooseAnchor(
  measured: (SyncInput & { latency: number })[],
  previousAnchorId: string | null,
  switchMargin: number,
): { anchor: (SyncInput & { latency: number }) | null; slowest: (SyncInput & { latency: number }) | null; gap: number } {
  let slowest: (SyncInput & { latency: number }) | null = null;
  for (const s of measured) {
    if (!slowest || s.latency > slowest.latency) slowest = s;
  }

  const previous = previousAnchorId ? measured.find((s) => s.id === previousAnchorId) : undefined;
  if (!previous || !slowest) {
    return { anchor: slowest, slowest, gap: 0 };
  }

  const gap = slowest.latency - previous.latency;
  const anchor = gap > switchMargin ? slowest : previous;
  return { anchor, slowest, gap };
}

export function buildSyncPlan(
  inputs: SyncInput[],
  tuning: SyncTuning,
  maxLatencyCap: number,
  previousAnchorId: string | null = null,
): SyncPlan {
  const measured = inputs.filter(
    (s): s is SyncInput & { latency: number } => s.latency !== null && Number.isFinite(s.latency),
  );

  // Handmatig aangewezen referentie gaat vóór alles.
  const forced = inputs.find((s) => s.forcedAnchor && !s.userPaused);
  const chosen = chooseAnchor(measured, previousAnchorId, tuning.anchorSwitchMargin);
  const anchor = forced ?? chosen.anchor;
  const { slowest } = chosen;
  const gap = chosen.gap;

  // Latency van een stream zonder exacte meting: de referentie-latency plus
  // de eigen drift. Zonder referentie (bv. een handmatig gekozen embed) is de
  // drift de latency.
  const anchorLatency = anchor?.latency ?? null;
  const fallbackLatency = anchorLatency ?? 0;
  // Een handmatig gekozen embed heeft geen exacte latency; zijn eigen drift is
  // dan de beste schatting.
  const forcedDrift = forced && forced.latency === null ? forced.drift : 0;

  const positions = new Map<string, number>();
  for (const s of inputs) {
    const latency = s.latency ?? fallbackLatency + s.drift + forcedDrift;
    // De fijnafstelling zit in de positie: een positieve waarde betekent
    // "deze stream later" (dus minder latency). Verderop rekenen we alleen
    // nog met deze positie, zodat de offset niet dubbel telt.
    const position = maxLatencyCap - latency - s.offset + tuning.safetyMargin;
    positions.set(s.id, position);
  }
  const anchorPosition = anchor ? (positions.get(anchor.id) as number) : null;

  // Het beeldmoment van de referentie (wandklok): hier moeten alle meetbare
  // streams staan. Dat is precieser dan de latency, want twee spelers met
  // dezelfde latency kunnen toch een ander moment van de uitzending tonen.
  const anchorWall = anchor?.playheadWall ?? null;

  // Embeds zonder exacte meting kunnen niet seeken. Ze zijn alleen bruikbaar
  // als hun geschatte latency dicht bij de referentie zit; anders zouden ze
  // eindeloos herladen worden. In dat geval laten we ze vrij lopen.
  const embedTolerance = Math.max(tuning.maxLag, 3);

  const members: SyncMember[] = inputs.map((s) => {
    const position = positions.get(s.id) as number;
    const target = anchorPosition ?? position;
    const isAnchor = anchor?.id === s.id;
    const isEmbed = s.kind === 'twitch' || s.kind === 'youtube';
    // Het doelbeeldmoment van de referentie. De fijnafstelling zit al in de
    // positie van deze stream, dus niet nog eens toepassen.
    const targetWall = anchorWall !== null && !isAnchor ? anchorWall : null;

    // Het echte verschil: het beeld van deze stream tegenover dat van de
    // referentie, in seconden (positief = deze stream loopt achter). Alleen
    // als beide spelers precies te meten zijn; anders het verschil in latency.
    const measuredDelta =
      s.playheadWall !== null && s.playheadWall !== undefined && targetWall !== null
        ? (targetWall - s.playheadWall) / 1000
        : target - position;
    // Een onwaarschijnlijk groot verschil is een meting die nog niet klopt
    // (speler net gestart, playlist nog niet geladen): dan niets doen.
    let delta = isAnchor || !Number.isFinite(measuredDelta) ? 0 : measuredDelta;
    // Binnen de dode zone (afronding van de playlist, kleine klokverschillen)
    // telt het verschil als nul: anders blijven de snelheden eeuwig wiebelen.
    if (Math.abs(delta) <= RESTART_DEADBAND) delta = 0;
    const outOfRange =
      (isEmbed && anchor !== null && Math.abs(delta) > embedTolerance) || Math.abs(delta) > MAX_PLAUSIBLE_DELTA;

    let rate = 1;
    let needsRestart = false;

    if (tuning.autoSync && anchor && !isAnchor && !outOfRange && s.playing && !s.userPaused) {
      if (Math.abs(delta) > RESTART_DEADBAND) {
        if (Math.abs(delta) > tuning.maxLag) {
          needsRestart = true;
        } else {
          // Nooit pauzeren: een stream die voorloopt loopt rustig langzamer
          // (tot 0.85x) tot hij bij de referentie is. Dat is veel minder
          // storend dan steeds pauzeren en weer starten.
          rate = Math.min(RATE_MAX, Math.max(RATE_MIN, 1 + delta * RATE_GAIN));
        }
      }
    }

    return { ...s, position, target, delta, targetWall, isAnchor, rate, needsRestart, outOfRange };
  });

  return {
    members,
    anchorId: anchor?.id ?? null,
    anchorLatency,
    hasMeasurement: measured.length > 0,
    slowestId: slowest?.id ?? null,
    slowestGap: gap,
    forcedAnchor: forced !== undefined,
  };
}

/** Formatteert een playbackRate voor de UI. */
export function rateLabel(rate: number): string {
  return `${rate.toFixed(2)}x`;
}
