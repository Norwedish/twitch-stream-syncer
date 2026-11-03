/**
 * Adapter: één uniforme interface voor alle spelersoorten.
 *
 * Elke adapter rapporteert:
 *  - `getLatency()`: exacte latency in seconden, of null als die niet meetbaar is.
 *  - `getPosition()`: positie in de gedeelde tijdlijn.
 *
 * En kan:
 *  - `seekTo(position)`: herstarten op een positie.
 *  - `setRate(rate)`: playbackRate instellen (embeds: zo dicht mogelijk).
 *  - `reconnect()`: de embed opnieuw laden (de enige manier om een live embed
 *    later te zetten).
 *
 * De engine hierboven hoeft zo niets te weten van HLS, Twitch of YouTube.
 */
import Hls, {
  type LoaderCallbacks,
  type LoaderConfiguration,
  type LoaderContext,
} from 'hls.js';
import { fetchHlsTimeline, type HlsTimeline } from './hls-timeline';
import type { StreamConfig } from './sources';
import { channelFromRef, isTwitchUrlStale, resolveTwitchPlayback } from './twitch-hls';
import { proxifyTwitch, redactTwitchUrl, unproxifyTwitch } from './twitch-proxy';

export interface AdapterStatus {
  ready: boolean;
  playing: boolean;
  error: string | null;
  /** Korte technische info voor de UI, bv. "1080p60" of "720p". */
  detail: string;
}

export interface StreamAdapter {
  readonly kind: StreamConfig['kind'];
  mount(container: HTMLElement): void;
  dispose(): void;
  play(): Promise<void>;
  pause(): void;
  seekTo(position: number): void;
  setRate(rate: number): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  /** Exacte latency in seconden, of null als niet meetbaar. */
  getLatency(): number | null;
  /**
   * Wandklok (ms) van het beeld dat nu te zien is. Twee spelers met
   * dezelfde waarde tonen hetzelfde moment van de uitzending. Null als de
   * speler niet precies te meten is (embeds).
   */
  getPlayheadWall?(): number | null;
  /** Zet het beeld op een wandkloktijd (ms); alleen voor meetbare spelers. */
  seekToWall?(wall: number): boolean;
  /** Positie in de gedeelde tijdlijn. */
  getPosition(): number;
  /**
   * Relatieve drift (s): hoeveel de positie afwijkt van wat je op basis van de
   * wandklok zou verwachten. Alleen zinvol voor embeds zonder exacte meting.
   */
  getDrift(): number;
  isPlaying(): boolean;
  status(): AdapterStatus;
  /** Herstart de embed (alleen embeds). */
  reconnect?(): void;
  /** Gebeurtenis: de adapter heeft een nieuwe (tijdelijke) playlist-URL. */
  onResolved?: ((url: string, at: number) => void) | null;
  /** De gedeelde tijdlijn is versprongen; schuif de lokale positie mee. */
  onTimelineShift(shift: number): void;
  /** Periodieke taak, bv. de playlist verversen. */
  tick?(now: number): void;
}

/** Hoe vaak we de playlist verversen voor de tijdlijn (ms). */
const TIMELINE_REFRESH_MS = 5000;
/** Hoeveel de live edge maximaal mag doorschuiven sinds de laatste playlist (ms). */
const TIMELINE_MAX_EXTRAPOLATION_MS = 10000;

const MAX_LATENCY = 3600;

/* -------------------------------------------------------------------------- */
/*                                HLS / video                                 */
/* -------------------------------------------------------------------------- */

class MediaAdapter implements StreamAdapter {
  readonly kind: StreamConfig['kind'];
  protected readonly video: HTMLVideoElement;
  protected hls: Hls | null = null;
  protected timeline: HlsTimeline | null = null;
  protected timelineProblem: string | null = null;
  protected lastFetch = 0;
  protected fetching = false;
  protected error: string | null = null;
  /** Offset (s) zodat de positie nooit negatief wordt. */
  protected base = 0;
  /** Positie waarop we na een (her)start moeten beginnen. */
  protected pendingSeek: number | null = null;
  /** Playlist die daadwerkelijk geladen is (kan verschillen van `config.ref`). */
  protected playlistUrl: string | null = null;
  /** Laatste poging om de playlist op te halen. */
  protected lastLoadAttempt = 0;
  /** Media-tijd die hoort bij startPosition (koppeling media-tijd -> playlistpositie). */
  protected mediaOrigin: number | null = null;
  /** Vorige startPosition, om vensterverschuivingen te detecteren. */
  protected lastStartPosition = 0;
  /** Fragment dat nu speelt (heeft programDateTime = wandklok van het segment). */
  protected currentFrag: { start: number; programDateTime?: number | null } | null = null;
  /** Media-tijd bij de eerste meting; zo kennen we de positie van de speler. */
  protected mediaAnchor: number | null = null;
  private detail = '';
  private rate = 1;

  constructor(
    protected readonly config: StreamConfig,
    kind: StreamConfig['kind'],
  ) {
    this.kind = kind;
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.muted = config.muted;
    this.video.volume = config.volume;
    this.video.addEventListener('error', () => {
      this.error = this.video.error?.message || 'Video kon niet geladen worden.';
    });
    this.video.addEventListener('playing', () => {
      this.error = null;
    });
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.video);
    if (this.usesHls()) this.attachHls();
    else this.video.src = this.config.ref;
  }

  protected usesHls(): boolean {
    return this.kind === 'hls' || this.kind === 'twitch-hls';
  }

  /** URL van de playlist die geladen moet worden. */
  protected async resolvePlaylist(): Promise<string> {
    return this.config.ref;
  }

  protected canMeasure(): boolean {
    return this.usesHls();
  }

  private attachHls(): void {
    if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        enableWorker: true,
        backBufferLength: 30,
        maxBufferLength: 30,
      });
      this.hls = hls;
      if (this.kind === 'twitch-hls') {
        // Twitch-URL's lopen via de proxy; relatieve verwijzingen in de
        // playlist moeten ook weer naar de proxy.
        const DefaultLoader = Hls.DefaultConfig.loader;
        hls.config.loader = class extends DefaultLoader {
          override load(
            context: LoaderContext,
            config: LoaderConfiguration,
            callbacks: LoaderCallbacks<LoaderContext>,
          ): void {
            context.url = proxifyTwitch(unproxifyTwitch(context.url));
            super.load(context, config, callbacks);
          }
        };
      }
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        this.error = `HLS-fout: ${data.details}`;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => this.updateDetail());
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.updateDetail();
        void this.refreshTimeline(true);
      });
      // Houd het fragment bij dat nu speelt: de PDT daarvan is de exacte
      // wandklok van het beeld (betrouwbaarder dan media-tijd omrekenen).
      hls.on(Hls.Events.FRAG_CHANGED, (_event, data) => {
        this.currentFrag = data.frag;
      });
      hls.attachMedia(this.video);
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari: native HLS.
    } else {
      this.error = 'Deze browser ondersteunt geen HLS.';
    }
    void this.loadPlaylist();
  }

  /** Haalt (indien nodig) de playlist-URL op en laadt die in hls.js. */
  protected async loadPlaylist(): Promise<void> {
    this.lastLoadAttempt = Date.now();
    let url: string;
    try {
      url = await this.resolvePlaylist();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      // Een opgeslagen playlist kan verlopen zijn: volgende keer opnieuw ophalen.
      if (this.config.kind === 'twitch-hls') {
        this.config.resolvedUrl = undefined;
        this.config.resolvedAt = undefined;
      }
      return;
    }
    if (url === this.playlistUrl) return;
    this.playlistUrl = url;
    if (this.hls) {
      this.hls.loadSource(proxifyTwitch(url));
    } else {
      this.video.src = proxifyTwitch(url);
    }
    this.updateDetail();
    await this.refreshTimeline(true);
  }

  private updateDetail(): void {
    if (!this.hls) return;
    const level = this.hls.levels[this.hls.currentLevel];
    if (level) {
      const height = level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)}k`;
      this.detail = level.frameRate ? `${height}${Math.round(level.frameRate)}` : height;
    }
    // Twitch levert de playlist zonder resolutie in de stream-inf; lees de
    // kwaliteitsnaam dan uit de URL (bv. "...-1080p60.m3u8").
    if (this.kind === 'twitch-hls') {
      const match = /(\d{3,4}p\d{0,3})/.exec(this.playlistUrl ?? '');
      if (match) this.detail = match[1];
      else if (!this.detail || this.detail.endsWith('k')) this.detail = 'Twitch';
    }
  }

  protected async refreshTimeline(force = false): Promise<void> {
    if (!this.canMeasure() || this.fetching || !this.playlistUrl) return;
    const now = Date.now();
    if (!force && now - this.lastFetch < TIMELINE_REFRESH_MS) return;
    this.fetching = true;
    this.lastFetch = now;
    try {
      // De tijdlijn moet van de echte (Twitch-)URL komen, niet van de proxy.
      // DeFetchedAt is het moment VÓÓR de request; als de server even nodig
      // heeft, is de playlist jonger dan fetchedAt. We meten daarom de
      // round-trip en gebruiken het midden van de request als fetchedAt.
      const startedAt = Date.now();
      const result = await fetchHlsTimeline(unproxifyTwitch(this.playlistUrl));
      const fetchedAt = startedAt + (Date.now() - startedAt) / 2;
      if (result.timeline) {
        result.timeline.fetchedAt = fetchedAt;
        this.timeline = result.timeline;
        this.timelineProblem = result.problem;
      } else {
        this.timelineProblem = result.problem;
        // Geen CORS? Dan via de dev-proxy proberen.
        const proxied = proxifyTwitch(unproxifyTwitch(this.playlistUrl));
        if (proxied !== unproxifyTwitch(this.playlistUrl)) {
          const viaProxy = await fetchHlsTimeline(proxied);
          if (viaProxy.timeline) {
            viaProxy.timeline.fetchedAt = fetchedAt;
            this.timeline = viaProxy.timeline;
            this.timelineProblem = viaProxy.problem;
          }
        }
      }
    } finally {
      this.fetching = false;
    }
  }

  tick(): void {
    this.syncOffset();
    void this.refreshTimeline();
    // Eerder mislukte het laden van de playlist: probeer het af en toe opnieuw.
    if (this.error && !this.playlistUrl && Date.now() - this.lastLoadAttempt > 30_000) {
      this.error = null;
      void this.loadPlaylist();
    }
  }

  private rawPosition(): number {
    if (this.hls && this.timeline) {
      if (this.mediaAnchor === null && this.video.currentTime > 0) this.mediaAnchor = this.video.currentTime;
      return (this.mediaAnchor ?? this.video.currentTime) - this.hls.startPosition;
    }
    return this.video.currentTime;
  }

  /**
   * Latency = hoeveel seconden de speler achterloopt op het einde van de
   * playlist. De playlist hebben we even geleden opgehaald, dus het einde
   * schuift sindsdien op met de wandklok (de server publiceert continu).
   * `cap` begrenst dat: als een stream niet meer publiceert, mag de latency
   * niet eindeloos doorgroeien.
   */
  private liveEdgeNow(): number | null {
    if (!this.timeline) return null;
    const elapsed = Math.max(0, Date.now() - this.timeline.fetchedAt);
    return this.timeline.liveEdge + Math.min(elapsed, TIMELINE_MAX_EXTRAPOLATION_MS);
  }

  /**
   * Houd de koppeling tussen media-tijd (video.currentTime) en playlistpositie
   * bij. hls.js gebruikt een doorlopende media-tijdlijn (bij Twitch loopt die
   * door over de hele uitzending), terwijl `startPosition` de positie in het
   * huidige playlistvenster is. Als het venster doorschuift, schuift
   * startPosition mee; mediaOrigin schuift dan mee zodat de positie gelijk
   * blijft. De latency volgt dan direct uit de playlist-tijden (PDT):
   * latency = liveEdgeNow - wandklok(positie), zonder extra ijking — een
   * extra offset zou de echte achterstand dubbel tellen.
   */
  private syncOffset(): void {
    if (this.mediaAnchor === null && this.video.currentTime > 0) this.mediaAnchor = this.video.currentTime;
    if (!this.hls) return;
    const media = this.video.currentTime;
    if (!Number.isFinite(media) || media <= 0) return;
    if (this.mediaOrigin === null) {
      this.mediaOrigin = media;
      this.lastStartPosition = this.hls.startPosition;
      return;
    }
    const sp = this.hls.startPosition;
    if (Number.isFinite(this.lastStartPosition) && Math.abs(sp - this.lastStartPosition) > 0.001) {
      // Het playlistvenster is verschoven; media-tijd loopt gewoon door.
      this.mediaOrigin += sp - this.lastStartPosition;
    }
    this.lastStartPosition = sp;
  }

  /** Wandkloktijd (ms) van een positie in de playlist. */
  private playerWallAt(position: number): number | null {
    if (!this.timeline || this.timeline.ends.length === 0) return null;
    const index = this.timeline.ends.findIndex((end) => end > position);
    const segmentIndex = index === -1 ? this.timeline.ends.length - 1 : index;
    const wallClock = this.timeline.wallClocks[segmentIndex];
    if (!Number.isFinite(wallClock)) return null;
    const segmentStart = this.timeline.ends[segmentIndex - 1] ?? 0;
    return wallClock + (position - segmentStart) * 1000;
  }

  getPosition(): number {
    return this.base + this.rawPosition();
  }

  getDrift(): number {
    return 0;
  }

  /** Huidige playlistpositie van de speler (media-tijd -> playlistpositie). */
  private currentPosition(): number | null {
    const media = this.video.currentTime;
    if (!Number.isFinite(media) || media <= 0) return null;
    if (!this.hls) return media;
    if (this.mediaOrigin === null) return null;
    return this.hls.startPosition + (media - this.mediaOrigin);
  }

  getLatency(): number | null {
    if (!this.canMeasure() || !this.timeline) return null;
    const edge = this.liveEdgeNow();
    if (edge === null) return null;
    const wall = this.getPlayheadWall();
    if (wall === null) return null;
    // Latency = live edge min de wandklok van het beeld dat nu te zien is.
    const latency = (edge - wall) / 1000;
    return Number.isFinite(latency) ? Math.min(MAX_LATENCY, Math.max(0, latency)) : null;
  }

  /**
   * Wandklok (ms) van het beeld dat nu te zien is, uit de PDT van het fragment
   * dat speelt. Dit is de betrouwbare ground truth: twee spelers met
   * dezelfde waarde tonen hetzelfde moment van de uitzending.
   */
  getPlayheadWall(): number | null {
    const frag = this.currentFrag;
    const media = this.video.currentTime;
    if (!Number.isFinite(media) || media <= 0) return null;
    if (frag && Number.isFinite(frag.programDateTime)) {
      return (frag.programDateTime as number) + (media - frag.start) * 1000;
    }
    // Nog geen fragment met PDT: val terug op de playlist-tijdlijn.
    if (!this.timeline) return null;
    const position = this.currentPosition();
    if (position === null) return null;
    return this.playerWallAt(position);
  }

  /**
   * Zet het beeld op een wandkloktijd (ms), zoals gemeten met
   * `getPlayheadWall`. We zoeken het segment met die PDT in het huidige
   * playlistvenster en zetten currentTime daarop. Geeft true terug als de
   * speler op de nieuwe positie staat.
   */
  seekToWall(wall: number): boolean {
    if (!this.timeline || !this.hls) return false;
    const details = this.hls.latestLevelDetails ?? this.hls.levels[this.hls.currentLevel]?.details;
    if (!details || !details.fragments) return false;
    // Zoek het fragment waarvan de PDT bij de gevraagde wandklok hoort.
    let target: (typeof details.fragments)[number] | null = null;
    for (const frag of details.fragments) {
      const pdt = frag.programDateTime;
      if (pdt === null || pdt === undefined || !Number.isFinite(pdt)) continue;
      const end = pdt + frag.duration * 1000;
      if (wall >= pdt - 500 && wall <= end + 500) {
        target = frag;
        break;
      }
    }
    if (!target || !Number.isFinite(target.programDateTime)) return false;
    const media = target.start + Math.max(0, (wall - (target.programDateTime as number)) / 1000);
    const start = target.start;
    const end = target.start + target.duration;
    if (media < start - 0.5 || media > end + 1) {
      // Buiten het huidige venster: herlaad de playlist op die positie.
      this.hls.stopLoad();
      this.hls.startLoad(media);
      window.setTimeout(() => this.seekToWall(wall), 500);
      return false;
    }
    this.video.currentTime = Math.min(end - 0.1, Math.max(start, media));
    return true;
  }

  onTimelineShift(shift: number): void {
    this.base += shift;
  }

  async play(): Promise<void> {
    try {
      await this.video.play();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        this.error = 'Autoplay geblokkeerd. Klik op de pagina om te starten.';
      }
    }
  }

  pause(): void {
    this.video.pause();
  }

  seekTo(position: number): void {
    this.pendingSeek = position;
    this.applySeek();
  }

  private applySeek(): void {
    if (this.pendingSeek === null) return;
    const target = this.pendingSeek;
    const raw = target - this.base;
    if (this.hls && this.timeline) {
      const start = this.hls.startPosition;
      const end = start + this.timeline.ends[this.timeline.ends.length - 1];
      if (raw < start - 0.5 || raw > end + 1) {
        // Buiten het huidige venster: herlaad de playlist en probeer opnieuw.
        this.hls.stopLoad();
        this.hls.startLoad(Math.max(0, raw));
        window.setTimeout(() => this.applySeek(), 500);
        return;
      }
      this.video.currentTime = Math.min(end - 0.1, Math.max(start, raw));
    } else {
      this.video.currentTime = Math.max(0, raw);
    }
    this.pendingSeek = null;
  }

  setRate(rate: number): void {
    if (Math.abs(rate - this.rate) < 0.005) return;
    this.rate = rate;
    this.video.playbackRate = rate;
  }

  setMuted(muted: boolean): void {
    this.video.muted = muted;
  }

  setVolume(volume: number): void {
    this.video.volume = Math.min(1, Math.max(0, volume));
  }

  isPlaying(): boolean {
    return !this.video.paused && !this.video.ended;
  }

  status(): AdapterStatus {
    let error = this.error;
    if (!error && this.canMeasure() && this.timelineProblem && !this.timeline) {
      error = this.timelineProblem;
    }
    return {
      ready: this.video.readyState >= 2,
      playing: this.isPlaying(),
      error,
      detail: this.detail,
    };
  }

  dispose(): void {
    this.hls?.destroy();
    this.hls = null;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
  }
}

/* -------------------------------------------------------------------------- */
/*                              Twitch via HLS                                */
/* -------------------------------------------------------------------------- */

/**
 * Twitch-kanaal als gewone HLS-stream. De playlist-URL wordt via de
 * GQL/usher-API opgehaald en verloopt na verloop van tijd; dan halen we hem
 * opnieuw op.
 */
class TwitchHlsAdapter extends MediaAdapter {
  private resolvedAt: number | undefined;

  constructor(config: StreamConfig) {
    super(config, 'twitch-hls');
    this.resolvedAt = config.resolvedAt;
  }

  protected override async resolvePlaylist(): Promise<string> {
    const channel = channelFromRef(this.config.ref);
    if (!channel) throw new Error('Ongeldig Twitch-kanaal.');
    const stored = this.config.resolvedUrl;
    if (stored && !isTwitchUrlStale(this.resolvedAt)) return stored;
    const playback = await resolveTwitchPlayback(channel);
    // Alleen de playlist-URL bewaren, zonder het token (dat verloopt toch).
    const clean = redactTwitchUrl(playback.mediaUrl);
    this.config.resolvedUrl = clean;
    this.resolvedAt = Date.now();
    this.config.resolvedAt = this.resolvedAt;
    this.onResolved?.(clean, this.resolvedAt);
    return playback.mediaUrl;
  }

  /** Wordt gebruikt om de verse playlist-URL op te slaan. */
  onResolved: ((url: string, at: number) => void) | null = null;
}

/* -------------------------------------------------------------------------- */
/*                                   Twitch                                   */
/* -------------------------------------------------------------------------- */

interface TwitchPlayer {
  addEventListener(event: string, callback: (payload?: unknown) => void): void;
  play(): void;
  pause(): void;
  isPaused(): boolean;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  getPlaybackStats?(): { hlsLatencyBroadcaster?: number };
  getEnded(): boolean;
}

interface TwitchGlobal {
  Player: {
    new (elementId: string, options: Record<string, unknown>): TwitchPlayer;
    READY: string;
    PLAYING: string;
    PAUSE: string;
    OFFLINE: string;
    ONLINE: string;
  };
}

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getPlayerState(): number;
  getDuration(): number;
  getPlaybackQuality(): string;
  destroy(): void;
}

interface YTGlobal {
  Player: {
    new (elementId: string, options: Record<string, unknown>): YTPlayer;
    State: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
  };
}

declare global {
  interface Window {
    Twitch?: TwitchGlobal;
    YT?: YTGlobal;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let twitchLoader: Promise<TwitchGlobal> | null = null;

function loadTwitch(): Promise<TwitchGlobal> {
  if (window.Twitch) return Promise.resolve(window.Twitch);
  if (twitchLoader) return twitchLoader;
  twitchLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://player.twitch.tv/js/embed/v1.js';
    script.async = true;
    script.onload = () => (window.Twitch ? resolve(window.Twitch) : reject(new Error('Twitch API niet beschikbaar')));
    script.onerror = () => reject(new Error('Twitch player kon niet geladen worden'));
    document.head.appendChild(script);
  });
  return twitchLoader;
}

class TwitchAdapter implements StreamAdapter {
  readonly kind = 'twitch' as const;
  private player: TwitchPlayer | null = null;
  private container: HTMLElement | null = null;
  private ready = false;
  private error: string | null = null;
  private offline = false;
  private elementId = `twitch-${Math.random().toString(36).slice(2, 10)}`;
  private base = 0;
  private lastTick = performance.now();
  private lastLatency: number | null = null;

  constructor(private readonly config: StreamConfig) {}

  mount(container: HTMLElement): void {
    this.container = container;
    this.createPlayer();
  }

  private createPlayer(): void {
    if (!this.container) return;
    this.container.innerHTML = '';
    const holder = document.createElement('div');
    holder.id = this.elementId;
    holder.className = 'embed-holder';
    this.container.appendChild(holder);

    loadTwitch()
      .then((Twitch) => {
        const player = new Twitch.Player(this.elementId, {
          channel: this.config.ref,
          width: '100%',
          height: '100%',
          parent: [window.location.hostname],
          autoplay: false,
          muted: this.config.muted,
        });
        this.player = player;
        player.setVolume(this.config.volume);
        player.setMuted(this.config.muted);
        player.addEventListener(Twitch.Player.READY, () => {
          this.ready = true;
          this.error = null;
        });
        player.addEventListener(Twitch.Player.PLAYING, () => {
          this.error = null;
        });
        player.addEventListener(Twitch.Player.OFFLINE, () => {
          this.offline = true;
        });
        player.addEventListener(Twitch.Player.ONLINE, () => {
          this.offline = false;
        });
      })
      .catch((error: unknown) => {
        this.error = error instanceof Error ? error.message : String(error);
      });
  }

  reconnect(): void {
    this.player?.pause();
    this.player = null;
    this.ready = false;
    this.createPlayer();
    window.setTimeout(() => {
      if (!this.player) return;
      this.player.setVolume(this.config.volume);
      this.player.setMuted(this.config.muted);
      this.player.play();
    }, 2500);
  }

  /** Laat de positie meelopen met de wandklok zolang de speler speelt. */
  private advance(): void {
    const now = performance.now();
    const elapsed = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (this.player && !this.player.isPaused()) this.base += elapsed;
  }

  getPosition(): number {
    this.advance();
    return this.base;
  }

  getDrift(): number {
    return 0;
  }

  getLatency(): number | null {
    const value = this.player?.getPlaybackStats?.().hlsLatencyBroadcaster;
    if (typeof value === 'number' && value > 0 && value < MAX_LATENCY) this.lastLatency = value;
    return this.lastLatency;
  }

  onTimelineShift(shift: number): void {
    this.advance();
    this.base += shift;
  }

  async play(): Promise<void> {
    this.player?.play();
  }

  pause(): void {
    this.advance();
    this.player?.pause();
  }

  seekTo(position: number): void {
    // Live streams kunnen niet seeken; de engine herlaadt de embed als dat nodig is.
    this.advance();
    this.base = position;
  }

  setRate(rate: number): void {
    void rate; // Twitch ondersteunt geen playbackRate.
  }

  setMuted(muted: boolean): void {
    this.player?.setMuted(muted);
  }

  setVolume(volume: number): void {
    this.player?.setVolume(volume);
  }

  isPlaying(): boolean {
    return !!this.player && !this.player.isPaused() && !this.player.getEnded();
  }

  status(): AdapterStatus {
    return {
      ready: this.ready,
      playing: this.isPlaying(),
      error: this.offline ? 'Kanaal is offline.' : this.error,
      detail: '',
    };
  }

  dispose(): void {
    this.player?.pause();
    this.player = null;
    if (this.container) this.container.innerHTML = '';
  }
}

/* -------------------------------------------------------------------------- */
/*                                  YouTube                                   */
/* -------------------------------------------------------------------------- */

let ytLoader: Promise<YTGlobal> | null = null;

function loadYouTube(): Promise<YTGlobal> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytLoader) return ytLoader;
  ytLoader = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
  });
  return ytLoader;
}

class YouTubeAdapter implements StreamAdapter {
  readonly kind = 'youtube' as const;
  private player: YTPlayer | null = null;
  private container: HTMLElement | null = null;
  private ready = false;
  private error: string | null = null;
  private elementId = `yt-${Math.random().toString(36).slice(2, 10)}`;
  private base = 0;
  private lastTick = performance.now();
  /** YouTube-duration op het moment dat we de stream voor het eerst zagen. */
  private durationOrigin: { wall: number; duration: number } | null = null;
  private lastLatency: number | null = null;

  constructor(private readonly config: StreamConfig) {}

  mount(container: HTMLElement): void {
    this.container = container;
    this.createPlayer();
  }

  private createPlayer(): void {
    if (!this.container) return;
    this.container.innerHTML = '';
    const holder = document.createElement('div');
    holder.id = this.elementId;
    holder.className = 'embed-holder';
    this.container.appendChild(holder);

    loadYouTube()
      .then((YT) => {
        const player = new YT.Player(this.elementId, {
          videoId: this.config.ref,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 0,
            mute: this.config.muted ? 1 : 0,
            playsinline: 1,
            controls: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              this.ready = true;
              this.player = player;
              player.setVolume(Math.round(this.config.volume * 100));
              if (this.config.muted) player.mute();
              else player.unMute();
            },
            onError: (event: { data: number }) => {
              this.error = youtubeError(event.data);
            },
          },
        });
      })
      .catch((error: unknown) => {
        this.error = error instanceof Error ? error.message : String(error);
      });
  }

  reconnect(): void {
    this.player?.pauseVideo();
    this.player?.destroy();
    this.player = null;
    this.ready = false;
    this.durationOrigin = null;
    this.createPlayer();
    window.setTimeout(() => {
      if (!this.player) return;
      this.player.setVolume(Math.round(this.config.volume * 100));
      if (this.config.muted) this.player.mute();
      else this.player.unMute();
      this.player.playVideo();
    }, 2500);
  }

  private advance(): void {
    const now = performance.now();
    const elapsed = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (this.isPlaying()) this.base += elapsed;
  }

  getPosition(): number {
    this.advance();
    return this.base;
  }

  getDrift(): number {
    return 0;
  }

  /**
   * YouTube geeft geen exacte latency. De `duration` van een live stream is de
   * tijd sinds de uitzending begon. Loopt die minder hard dan de wandklok, dan
   * loopt de stream achter; dat verschil is een ondergrens voor de latency.
   */
  getLatency(): number | null {
    this.advance();
    if (!this.player) return this.lastLatency;
    const duration = this.player.getDuration();
    const now = performance.now();
    if (!duration || !Number.isFinite(duration) || duration <= 0) return this.lastLatency;
    if (!this.durationOrigin) {
      this.durationOrigin = { wall: now, duration };
      return this.lastLatency;
    }
    const behind = (now - this.durationOrigin.wall) / 1000 - (duration - this.durationOrigin.duration);
    if (behind > 0.5 && behind < MAX_LATENCY) this.lastLatency = behind;
    return this.lastLatency;
  }

  onTimelineShift(shift: number): void {
    this.advance();
    this.base += shift;
  }

  async play(): Promise<void> {
    this.player?.playVideo();
  }

  pause(): void {
    this.advance();
    this.player?.pauseVideo();
  }

  seekTo(position: number): void {
    this.advance();
    this.base = position;
  }

  setRate(rate: number): void {
    if (!this.player) return;
    // YouTube kiest zelf de dichtstbijzijnde ondersteunde snelheid.
    if (Math.abs(this.player.getPlaybackRate() - rate) > 0.02) this.player.setPlaybackRate(rate);
  }

  setMuted(muted: boolean): void {
    if (muted) this.player?.mute();
    else this.player?.unMute();
  }

  setVolume(volume: number): void {
    this.player?.setVolume(Math.round(Math.min(1, Math.max(0, volume)) * 100));
  }

  isPlaying(): boolean {
    const state = this.player?.getPlayerState();
    return state === 1 || state === 3;
  }

  status(): AdapterStatus {
    return {
      ready: this.ready,
      playing: this.isPlaying(),
      error: this.error,
      detail: this.player?.getPlaybackQuality() ?? '',
    };
  }

  dispose(): void {
    this.player?.destroy();
    this.player = null;
    if (this.container) this.container.innerHTML = '';
  }
}

function youtubeError(code: number): string {
  switch (code) {
    case 2:
      return 'Ongeldige YouTube-video-ID.';
    case 5:
      return 'Deze video kan niet in de HTML5-speler.';
    case 100:
      return 'Video niet gevonden of privé.';
    case 101:
    case 150:
      return 'De eigenaar staat insluiten niet toe.';
    case 153:
      return 'YouTube weigert de embed (referer ontbreekt).';
    default:
      return `YouTube-fout ${code}.`;
  }
}

/* -------------------------------------------------------------------------- */

export function createAdapter(config: StreamConfig): StreamAdapter {
  switch (config.kind) {
    case 'twitch':
      return new TwitchAdapter(config);
    case 'twitch-hls':
      return new TwitchHlsAdapter(config);
    case 'youtube':
      return new YouTubeAdapter(config);
    case 'hls':
    case 'video':
      return new MediaAdapter(config, config.kind);
  }
}
