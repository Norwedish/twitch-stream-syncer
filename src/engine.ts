import { createAdapter, type AdapterStatus, type StreamAdapter } from './adapters';
import type { Messages } from './i18n';
import { buildSyncPlan, type SyncPlan, type SyncTuning } from './sync';
import type { StreamConfig } from './sources';
import { formatDelta, formatLatency } from './ui-utils';

export interface StreamView {
  config: StreamConfig;
  adapter: StreamAdapter;
  card: HTMLElement;
  stage: HTMLElement;
  status: AdapterStatus;
  /** Laatst gemeten latency (s), of null als niet meetbaar. */
  latency: number | null;
  /** Of de gebruiker deze stream handmatig heeft gepauzeerd. */
  userPaused: boolean;
  /** Of de engine deze stream tijdelijk heeft gepauzeerd om achterstand in te halen. */
  enginePaused: boolean;
  /** Laatste gemeten drift (s) voor streams zonder exacte meting. */
  drift: number;
  /** Tijdstip van de laatste herstart, om te voorkomen dat we blijven herstarten. */
  lastRestart: number;
  restartInFlight: boolean;
  /** Het element dat de adapter in de kaart plaatst (blijft bij een taalwissel). */
  adapterElement: Element | null;
}

export interface EngineCallbacks {
  onStateChange: () => void;
  onTick: (views: StreamView[], plan: SyncPlan) => void;
  onRemove: (id: string) => void;
  onTogglePause: (id: string) => void;
  /** Geluid aan/uit voor één stream; `null` = alleen deze stream hoorbaar maken. */
  onSetMuted: (id: string, muted: boolean) => void;
  /** Alleen deze stream hoorbaar maken (het geluid volgt de "actieve" stream). */
  onMakeMaster: (id: string) => void;
  /** Een adapter heeft een nieuwe tijdelijke playlist-URL opgehaald. */
  onResolved?: (id: string, url: string, at: number) => void;
  /** De referentie is gewisseld (of voor het eerst gekozen). */
  onAnchorChange?: (id: string | null) => void;
  /** Gebruiker vinkt "referentie" aan of uit voor deze stream. */
  onToggleForcedAnchor: (id: string) => void;
  onNudge: (id: string, delta: number) => void;
  /** De gebruiker klikt op een stream (kaart of tabblad). */
  onActivate?: (id: string) => void;
  /** Er is een stream toegevoegd (om die direct actief te maken). */
  onAdded?: (id: string) => void;
}

const TICK_MS = 250;
const MAX_LATENCY_CAP = 3600;
const RESTART_COOLDOWN_MS = 6000;
const EMBED_RECONNECT_COOLDOWN_MS = 20000;
/** Hoe lang een andere stream duidelijk trager moet zijn voor we wisselen. */
const ANCHOR_SWITCH_HOLD_MS = 5000;
/** Een sprong in latency groter dan dit is een meetfout, geen echte verandering. */
const MAX_LATENCY_JUMP_S = 30;

export class SyncEngine {
  private views: StreamView[] = [];
  private timer: number | null = null;
  private lastPlan: SyncPlan | null = null;
  private focusedId: string | null = null;
  private masterId: string | null = null;
  private running = true;
  /** De referentie die we vasthouden (wisselt alleen bij een groot verschil). */
  private anchorId: string | null = null;
  /** Kandidaat-referentie die nog bevestigd moet worden. */
  private anchorCandidate: string | null = null;
  private anchorCandidateSince = 0;

  constructor(
    private readonly grid: HTMLElement,
    private readonly callbacks: EngineCallbacks,
    private readonly tuning: () => SyncTuning,
    /** Vertalingen voor de kaarten (kan bij een taalwissel veranderen). */
    private readonly messages: () => Messages,
  ) {}

  /** Taal is gewisseld: alle kaarten opnieuw opbouwen. */
  relocalize(): void {
    for (const v of this.views) {
      this.renderCard(v);
      this.bindCard(v.card, v.config.id);
      this.refreshCard(v);
    }
  }

  getViews(): StreamView[] {
    return this.views;
  }

  getPlan(): SyncPlan | null {
    return this.lastPlan;
  }

  getFocusedId(): string | null {
    return this.focusedId;
  }

  getMasterId(): string | null {
    return this.masterId;
  }

  setMaster(id: string | null): void {
    this.masterId = id;
    this.applyAudio();
    this.callbacks.onStateChange();
  }

  setFocused(id: string | null): void {
    this.focusedId = id;
    this.grid.classList.toggle('is-focused', id !== null);
    for (const view of this.views) {
      view.card.classList.toggle('is-focused', view.config.id === id);
      view.card.classList.toggle('is-dimmed', id !== null && view.config.id !== id);
    }
    this.callbacks.onStateChange();
    if (id !== null) this.activate(id);
  }

  add(config: StreamConfig): StreamView {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = config.id;
    const stage = document.createElement('div');
    stage.className = 'card-stage';
    card.appendChild(stage);

    const adapter = createAdapter(config);
    if (adapter.onResolved !== undefined) {
      adapter.onResolved = (url, at) => this.callbacks.onResolved?.(config.id, url, at);
    }
    const view: StreamView = {
      config,
      adapter,
      card,
      stage,
      status: { ready: false, playing: false, error: null, detail: '' },
      latency: null,
      userPaused: false,
      enginePaused: false,
      drift: 0,
      lastRestart: 0,
      restartInFlight: false,
      adapterElement: null,
    };
    this.views.push(view);

    // Eerst de speler in de stage, daarna de bediening eromheen: zo is het
    // eerste kind van de stage altijd het speler-element.
    adapter.mount(stage);
    view.adapterElement = stage.children[0] ?? null;
    this.renderCard(view);
    this.bindCard(card, config.id);
    this.grid.appendChild(card);
    if (this.running) void adapter.play();
    this.applyAudio();
    this.callbacks.onStateChange();
    this.refreshCard(view);
    this.callbacks.onAdded?.(config.id);
    return view;
  }

  /**
   * De gebruiker klikt op een stream: die wordt de actieve stream (geluid en
   * chat). Een stream die de gebruiker zelf had gepauzeerd blijft gepauzeerd.
   */
  activate(id: string): void {
    const v = findView(this.views, id);
    if (!v) return;
    if (this.masterId !== id) {
      this.masterId = id;
      for (const other of this.views) {
        other.config.muted = other.config.id !== id;
      }
      this.applyAudio();
    }
    if (v.userPaused) {
      v.userPaused = false;
      v.enginePaused = false;
      void v.adapter.play();
    }
    this.callbacks.onStateChange();
  }

  /**
   * Bouwt de binnenkant van een kaart opnieuw op (talenwissel). De video of
   * embed blijft staan: alleen alles eromheen wordt vervangen.
   */
  private renderCard(v: StreamView): void {
    const t = this.messages();
    const { card, stage } = v;
    for (const child of [...stage.children]) {
      if (child !== v.adapterElement) child.remove();
    }
    card.querySelector('.card-footer')?.remove();
    // Oude bediening (overlay, acties, foutmelding) van een eerdere taal.
    for (const el of card.querySelectorAll(':scope > .card-overlay, :scope > .card-actions, :scope > .card-error, :scope > .card-offline')) {
      el.remove();
    }

    // De speler staat als eerste in de stage; `afterend` zet de bediening
    // er direct achter.
    stage.insertAdjacentHTML(
      'afterend',
      `
        <div class="card-overlay">
          <span class="badge badge-kind"></span>
          <span class="badge badge-anchor" hidden title="${this.escapeAttr(t.anchorBadgeTitle)}">${t.anchorBadge}</span>
          <span class="badge badge-state" hidden></span>
        </div>
        <div class="card-actions">
          <button type="button" class="icon-btn" data-action="open-page" aria-label=""></button>
          <button type="button" class="icon-btn" data-action="focus" title="${this.escapeAttr(t.focus)}" aria-label="${this.escapeAttr(t.focus)}">${ICON_FOCUS}</button>
          <button type="button" class="icon-btn icon-btn-danger" data-action="remove" title="${this.escapeAttr(t.remove)}" aria-label="${this.escapeAttr(t.remove)}">${ICON_TRASH}</button>
        </div>
        <div class="card-error" role="alert" hidden></div>
        <div class="card-offline" hidden>
          <div class="card-offline-scene" aria-hidden="true">
            <div class="card-offline-rings">
              <span></span><span></span><span></span>
            </div>
            <div class="card-offline-glow"></div>
            <div class="card-offline-bars">
              <span></span><span></span><span></span><span></span><span></span>
            </div>
            <div class="card-offline-mark">
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v10h16V7H4Zm3.5 12h9v2h-9v-2Z"/></svg>
              <span class="card-offline-slash"></span>
            </div>
          </div>
          <span class="card-offline-title"></span>
          <span class="card-offline-sub"></span>
          <span class="card-offline-hint"></span>
        </div>
      `,
    );

    card.insertAdjacentHTML(
      'beforeend',
      `
      <footer class="card-footer">
        <div class="card-title">
          <span class="kind-icon" aria-hidden="true"></span>
          <span class="title-text"></span>
        </div>
        <div class="card-stats">
          <div class="stat"><span class="stat-label">${t.statLatency}</span><span class="stat-value" data-stat="latency">–</span></div>
          <div class="stat"><span class="stat-label">${t.statDelta}</span><span class="stat-value" data-stat="delta">–</span></div>
          <div class="stat"><span class="stat-label">${t.statRate}</span><span class="stat-value" data-stat="rate">1.00x</span></div>
        </div>
        <div class="card-controls">
          <button type="button" class="icon-btn" data-action="playpause" title="${this.escapeAttr(t.playPause)}" aria-label="${this.escapeAttr(t.playPause)}"></button>
          <button type="button" class="icon-btn" data-action="mute" title="${this.escapeAttr(t.mute)}" aria-label="${this.escapeAttr(t.mute)}"></button>
          <label class="anchor-toggle" title="${this.escapeAttr(t.anchorToggleHint)}">
            <input type="checkbox" data-action="force-anchor" />
            <span>${t.anchorToggle}</span>
          </label>
          <div class="offset-control" role="group" aria-label="${this.escapeAttr(t.offsetTitle)}" title="${this.escapeAttr(t.offsetTitle)}">
            <button type="button" class="icon-btn tiny" data-action="offset-down" title="${this.escapeAttr(t.offsetEarlier)}" aria-label="${this.escapeAttr(t.offsetEarlier)}">−</button>
            <span class="offset-value" aria-live="off">0.0s</span>
            <button type="button" class="icon-btn tiny" data-action="offset-up" title="${this.escapeAttr(t.offsetLater)}" aria-label="${this.escapeAttr(t.offsetLater)}">+</button>
          </div>
          <button type="button" class="icon-btn icon-btn-danger card-remove" data-action="remove" title="${this.escapeAttr(t.remove)}" aria-label="${this.escapeAttr(t.remove)}">${ICON_TRASH}</button>
        </div>
      </footer>
    `,
    );
  }

  /** Maakt tekst veilig voor gebruik in een HTML-attribuut. */
  private escapeAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  remove(id: string): void {
    const index = this.views.findIndex((v) => v.config.id === id);
    if (index === -1) return;
    const [removed] = this.views.splice(index, 1);
    // Eerst uit de lijst, dan pas opruimen: een lopende tick mag deze kaart
    // niet meer aanraken.
    removed.card.remove();
    removed.adapter.dispose();
    if (this.focusedId === id) this.setFocused(null);
    if (this.masterId === id) this.masterId = null;
    this.callbacks.onStateChange();
  }

  updateConfig(id: string, patch: Partial<StreamConfig>): void {
    const v = findView(this.views, id);
    if (!v) return;
    v.config = { ...v.config, ...patch };
    v.adapter.setMuted(v.config.muted);
    v.adapter.setVolume(v.config.volume);
    this.refreshCard(v);
    this.callbacks.onStateChange();
  }

  /**
   * Start één stream opnieuw op (zelfde plek in de lijst, zelfde instellingen).
   * Gebruikt na in- of uitloggen bij Twitch: de playlist wordt dan opnieuw
   * opgehaald, met of zonder het token van de kijker.
   */
  reload(id: string): void {
    const index = this.views.findIndex((v) => v.config.id === id);
    if (index === -1) return;
    const old = this.views[index];
    const config = { ...old.config };
    const wasMaster = this.masterId === id;
    const focused = this.focusedId === id;
    this.remove(id);
    this.add(config);
    const card = findView(this.views, id)?.card;
    if (card) this.grid.insertBefore(card, this.grid.children[index] ?? null);
    if (wasMaster) this.setMaster(id);
    if (focused) this.setFocused(id);
  }

  playAll(): void {
    this.running = true;
    for (const v of this.views) {
      v.userPaused = false;
      v.enginePaused = false;
      void v.adapter.play();
    }
    this.callbacks.onStateChange();
  }

  pauseAll(): void {
    this.running = false;
    for (const v of this.views) {
      v.userPaused = true;
      v.adapter.pause();
    }
    this.callbacks.onStateChange();
  }

  togglePause(id: string): void {
    const v = findView(this.views, id);
    if (!v) return;
    if (v.adapter.isPlaying()) {
      v.userPaused = true;
      v.adapter.pause();
    } else {
      v.userPaused = false;
      v.enginePaused = false;
      void v.adapter.play();
    }
    this.callbacks.onStateChange();
  }

  /** Herstart alle streams op de referentiepositie. */
  resync(): void {
    const anchor = this.lastPlan?.members.find((m) => m.isAnchor);
    if (!anchor) return;
    for (const v of this.views) {
      if (v.config.id === anchor.id) continue;
      if (v.config.kind === 'twitch' || v.config.kind === 'youtube') {
        this.restartEmbed(v, anchor.position);
      } else {
        this.restart(v, anchor.position);
      }
    }
    this.callbacks.onStateChange();
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    for (const v of this.views) v.adapter.dispose();
    this.views = [];
  }

  /** De laatst toegevoegde stream (of null). */
  lastAddedId(): string | null {
    return this.views[this.views.length - 1]?.config.id ?? null;
  }

  private bindCard(card: HTMLElement, id: string): void {
    card.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!target) {
        // Klik naast de knoppen: deze stream wordt de actieve stream.
        this.callbacks.onActivate?.(id);
        return;
      }
      // Het vinkje heeft een eigen change-handler.
      if (target.dataset.action === 'force-anchor') return;
      switch (target.dataset.action) {
        case 'remove':
          this.callbacks.onRemove(id);
          break;
        case 'playpause':
          this.callbacks.onTogglePause(id);
          break;
        case 'open-page':
          this.openStreamPage(id);
          break;
        case 'force-anchor':
          this.callbacks.onToggleForcedAnchor(id);
          break;
        case 'mute': {
          const view = findView(this.views, id);
          if (!view) break;
          if (this.masterId === id && !view.config.muted) {
            // De actieve stream dempen: alle streams stil.
            this.callbacks.onSetMuted(id, true);
          } else {
            // Anders: deze stream wordt de actieve (hoorbare) stream.
            this.callbacks.onMakeMaster(id);
          }
          break;
        }
        case 'focus':
          this.setFocused(this.focusedId === id ? null : id);
          break;
        case 'offset-up':
          this.callbacks.onNudge(id, 0.5);
          break;
        case 'offset-down':
          this.callbacks.onNudge(id, -0.5);
          break;
      }
    });

    const checkbox = card.querySelector<HTMLInputElement>('[data-action="force-anchor"]');
    checkbox?.addEventListener('change', () => {
      this.callbacks.onToggleForcedAnchor(id);
    });
  }

  /**
   * Opent de streampagina van deze stream (Twitch-kanaal of YouTube-video) in
   * een nieuw tabblad.
   */
  private openStreamPage(id: string): void {
    const v = findView(this.views, id);
    if (!v) return;
    const url = streamPageUrl(v.config);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  private tick(): void {
    const now = performance.now();
    // Bewaar de volgorde van dit moment: callbacks kunnen kaarten toevoegen of
    // verwijderen terwijl we bezig zijn.
    const views = [...this.views];

    if (views.length === 0) {
      this.lastPlan = null;
      this.callbacks.onTick([], {
        members: [],
        anchorId: null,
        anchorLatency: null,
        hasMeasurement: false,
        slowestId: null,
        slowestGap: 0,
        forcedAnchor: false,
      });
      return;
    }

    for (const v of views) {
      v.adapter.tick?.(now);
      v.status = v.adapter.status();
      const measured = v.adapter.getLatency();
      // Onwaarschijnlijke metingen (speler even gepauzeerd, playlist-venster
      // versprongen) negeren we, anders springt de referentie mee.
      const previous = v.latency;
      const jump = previous !== null && measured !== null ? Math.abs(measured - previous) : 0;
      v.latency = measured !== null && jump > MAX_LATENCY_JUMP_S ? previous : measured;
    }

    const tuning = this.tuning();
    for (const v of views) {
      // Embeds zonder exacte meting: de drift (hoeveel ze achterlopen op de
      // wandklok) telt op bij de latency van de referentie.
      if (v.latency === null) v.drift = v.adapter.getDrift();
    }

    // De referentie moet blijven bestaan en (meestal) nog spelen. Anders
    // kunnen we hem niet vasthouden en kiezen we opnieuw.
    const previousView = this.anchorId ? views.find((v) => v.config.id === this.anchorId) : undefined;
    const previousAnchorValid =
      previousView !== undefined &&
      previousView.latency !== null &&
      !previousView.userPaused &&
      (!this.running || previousView.adapter.isPlaying() || previousView.enginePaused);
    if (!previousAnchorValid) this.anchorId = null;

    // Referentie vasthouden: alleen wisselen als een andere stream duidelijk
    // trager is, en dat een tijdje volhoudt.
    const previousAnchor = this.anchorId;
    const inputs = views.map((v) => ({
      id: v.config.id,
      kind: v.config.kind,
      latency: v.latency,
      playhead: v.adapter.getPlayheadPosition?.() ?? null,
      drift: v.drift,
      playing: v.adapter.isPlaying(),
      offset: v.config.offset,
      userPaused: v.userPaused,
      forcedAnchor: v.config.forcedAnchor === true,
    }));
    const plan = buildSyncPlan(inputs, tuning, MAX_LATENCY_CAP, previousAnchor);

    if (plan.forcedAnchor && plan.anchorId !== null) {
      // Met de hand gekozen: meteen overnemen, geen wachttijd.
      if (this.anchorId !== plan.anchorId) {
        this.anchorId = plan.anchorId;
        this.anchorCandidate = null;
        this.callbacks.onAnchorChange?.(plan.anchorId);
      }
      this.lastPlan = plan;
    } else if (plan.anchorId !== previousAnchor) {
      // Wisselen? Alleen als de traagste stream echt duidelijk trager is, dat
      // al `ANCHOR_SWITCH_HOLD_MS` lang zo is, en het verschil geloofwaardig is
      // (een sprong van minuten is bijna altijd een meetfout).
      const candidate = plan.anchorId;
      const plausible = plan.slowestGap <= tuning.maxPlausibleGap;
      if (candidate === null) {
        this.anchorId = null;
        this.anchorCandidate = null;
        this.lastPlan = plan;
      } else if (previousAnchor === null) {
        // Eerste referentie: meteen nemen.
        this.anchorId = candidate;
        this.anchorCandidate = null;
        this.lastPlan = plan;
        this.callbacks.onAnchorChange?.(candidate);
      } else if (this.anchorCandidate !== candidate) {
        // Nieuwe kandidaat: eerst een tijdje aanzien.
        this.anchorCandidate = candidate;
        this.anchorCandidateSince = now;
        this.lastPlan = buildSyncPlan(inputs, tuning, MAX_LATENCY_CAP, previousAnchor);
      } else if (plan.slowestGap > tuning.anchorSwitchMargin && plausible) {
        if (now - this.anchorCandidateSince >= ANCHOR_SWITCH_HOLD_MS) {
          this.anchorId = candidate;
          this.anchorCandidate = null;
          this.lastPlan = plan;
          this.callbacks.onAnchorChange?.(candidate);
        } else {
          this.lastPlan = buildSyncPlan(inputs, tuning, MAX_LATENCY_CAP, previousAnchor);
        }
      } else {
        // De oude referentie bestaat niet meer (verwijderd of stilgevallen).
        this.anchorId = candidate;
        this.anchorCandidate = null;
        this.lastPlan = plan;
        this.callbacks.onAnchorChange?.(candidate);
      }
    } else {
      this.anchorCandidate = null;
      this.lastPlan = plan;
    }
    const activePlan = this.lastPlan ?? plan;

    for (const member of activePlan.members) {
      const v = findView(this.views, member.id);
      if (!v) continue;
      if (v.userPaused) continue;

      // Nooit pauzeren: te ver voorlopen lossen we op met een lagere snelheid.
      if (v.enginePaused) {
        v.enginePaused = false;
        void v.adapter.play();
      }
      const isEmbed = v.config.kind === 'twitch' || v.config.kind === 'youtube';

      if (member.needsRestart) {
        const cooldown = isEmbed ? EMBED_RECONNECT_COOLDOWN_MS : RESTART_COOLDOWN_MS;
        if (now - v.lastRestart > cooldown) {
          if (isEmbed) this.restartEmbed(v, member.target);
          else this.restart(v, member.target, member.targetPlayhead);
        }
        continue;
      }

      // Embeds zonder exacte meting: een te grote drift lossen we op door de
      // embed opnieuw te laden (dat is de enige manier om hem later te zetten).
      if (isEmbed && member.latency === null && !member.outOfRange) {
        const drift = v.adapter.getDrift();
        if (Math.abs(drift) > tuning.maxLag && now - v.lastRestart > EMBED_RECONNECT_COOLDOWN_MS) {
          this.restartEmbed(v, member.target);
          continue;
        }
      }

      v.adapter.setRate(member.rate);
    }

    for (const v of views) this.refreshCard(v);
    this.callbacks.onTick(views, plan);
  }

  /**
   * Zet een meetbare stream op het beeld van de referentie. Met
   * `targetPlayhead` (beeldmoment) zoeken we hetzelfde moment in de playlist;
   * zonder die tijd vallen we terug op de gedeelde positie.
   */
  private restart(v: StreamView, position: number, targetPlayhead: number | null = null): void {
    if (v.restartInFlight) return;
    v.lastRestart = performance.now();
    v.enginePaused = false;
    let moved = false;
    if (targetPlayhead !== null && v.adapter.seekToPlayhead) {
      moved = v.adapter.seekToPlayhead(targetPlayhead);
    } else {
      v.adapter.seekTo(position);
      moved = true;
    }
    // Buiten het venster van de playlist: de speler herlaadt en probeert het
    // zelf opnieuw. Dan niet meteen als "bezig" markeren, zodat de volgende
    // tick het opnieuw kan proberen.
    if (!moved) return;
    v.restartInFlight = true;
    window.setTimeout(() => {
      v.restartInFlight = false;
      if (!v.userPaused) void v.adapter.play();
    }, 800);
  }

  /**
   * Embeds kunnen niet seeken. We zetten de lokale positie op de referentie,
   * herladen de embed en laten de drift daarna vanaf nul opnieuw lopen.
   */
  private restartEmbed(v: StreamView, target: number): void {
    if (v.restartInFlight || !v.adapter.reconnect) return;
    v.restartInFlight = true;
    v.lastRestart = performance.now();
    v.enginePaused = false;
    v.adapter.seekTo(target);
    v.adapter.reconnect();
    window.setTimeout(() => {
      v.restartInFlight = false;
    }, 4000);
  }

  private applyAudio(): void {
    const master = this.masterId ? findView(this.views, this.masterId) : null;
    for (const v of this.views) {
      const isMaster = master !== null && v.config.id === master.config.id;
      v.adapter.setMuted(isMaster ? false : true);
      v.adapter.setVolume(isMaster ? v.config.volume : 0);
    }
  }

  private refreshCard(v: StreamView): void {
    const t = this.messages();
    const card = v.card;
    // Tijdens het opbouwen van een kaart (add) staat de kaart nog niet in de
    // DOM; dan is er niets om bij te werken.
    if (!card.isConnected) return;
    const kindIcon = card.querySelector<HTMLElement>('.kind-icon');
    const title = card.querySelector<HTMLElement>('.title-text');
    const kindBadge = card.querySelector<HTMLElement>('.badge-kind');
    const anchorBadge = card.querySelector<HTMLElement>('.badge-anchor');
    const stateBadge = card.querySelector<HTMLElement>('.badge-state');
    const errorBox = card.querySelector<HTMLElement>('.card-error');
    const playBtn = card.querySelector<HTMLElement>('[data-action="playpause"]');
    const muteBtn = card.querySelector<HTMLElement>('[data-action="mute"]');
    const offsetValue = card.querySelector<HTMLElement>('.offset-value');
    if (!kindIcon || !title || !kindBadge || !anchorBadge || !stateBadge || !errorBox) return;

    kindIcon.innerHTML = kindSvg(v.config.kind);
    kindIcon.className = `kind-icon kind-${v.config.kind}`;
    title.textContent = v.config.label || v.config.ref;
    title.title = v.config.ref;
    kindBadge.textContent = v.config.kind === 'twitch-hls' ? t.twitchHlsBadge : v.config.kind.toUpperCase();

    const member = this.lastPlan?.members.find((m) => m.id === v.config.id);
    anchorBadge.hidden = !member?.isAnchor;
    card.classList.toggle('is-anchor', !!member?.isAnchor);

    // Het vinkje "referentie": aangevinkt = deze stream is (met de hand) de
    // referentie. Uitvinken geeft de keuze weer terug aan de automaat.
    const anchorToggle = card.querySelector<HTMLInputElement>('[data-action="force-anchor"]');
    if (anchorToggle) {
      const forced = v.config.forcedAnchor === true;
      anchorToggle.checked = forced;
      anchorToggle.title = forced ? t.anchorToggleForced : t.anchorToggleHint;
    }
    card.classList.toggle('is-forced-anchor', v.config.forcedAnchor === true);

    const playing = v.adapter.isPlaying();
    const failed = v.status.error !== null;
    const state = v.userPaused ? t.statePaused : failed ? t.stateOffline : !playing ? t.stateBuffering : '';
    stateBadge.hidden = state === '';
    stateBadge.textContent = state;

    card.dataset.playing = playing ? 'yes' : 'no';
    card.dataset.failed = failed ? 'yes' : 'no';
    card.dataset.measured = v.latency !== null ? 'yes' : 'no';

    const latencyEl = card.querySelector<HTMLElement>('[data-stat="latency"]');
    if (latencyEl) {
      latencyEl.textContent = v.latency !== null ? formatLatency(v.latency) : '≈';
      latencyEl.title = v.latency !== null ? t.statLatencyTitle : t.statLatencyUnknownTitle;
    }

    const deltaEl = card.querySelector<HTMLElement>('[data-stat="delta"]');
    if (deltaEl) {
      if (member) {
        deltaEl.textContent = formatDelta(member.delta);
        deltaEl.dataset.tone = Math.abs(member.delta) < 0.3 ? 'good' : Math.abs(member.delta) < 1.5 ? 'warn' : 'bad';
        deltaEl.title = member.outOfRange ? t.statDeltaOutOfRange : t.statDeltaTitle;
      } else {
        deltaEl.textContent = '–';
        delete deltaEl.dataset.tone;
      }
    }

    const rateEl = card.querySelector<HTMLElement>('[data-stat="rate"]');
    if (rateEl) {
      rateEl.textContent = `${(member?.rate ?? 1).toFixed(2)}x`;
      rateEl.dataset.tone = member && Math.abs(member.rate - 1) > 0.005 ? 'warn' : 'good';
    }

    if (playBtn) {
      playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
      playBtn.setAttribute('aria-label', t.playPause);
      playBtn.setAttribute('aria-pressed', String(playing));
    }
    // Het tv-icoontje opent de streampagina; bij HLS staat er geen pagina,
    // dan is het gewoon de stream-URL.
    const pageBtn = card.querySelector<HTMLElement>('[data-action="open-page"]');
    if (pageBtn) {
      pageBtn.innerHTML = ICON_TV;
      const url = streamPageUrl(v.config);
      pageBtn.hidden = !url;
      const label =
        v.config.kind === 'twitch' || v.config.kind === 'twitch-hls'
          ? t.openTwitch(v.config.ref)
          : v.config.kind === 'youtube'
            ? t.openYouTube
            : t.openStreamUrl;
      pageBtn.title = label;
      pageBtn.setAttribute('aria-label', label);
    }
    const isMaster = this.masterId === v.config.id;
    if (muteBtn) {
      const audible = isMaster && !v.config.muted;
      muteBtn.innerHTML = audible ? ICON_VOLUME : ICON_MUTE;
      muteBtn.classList.toggle('is-active', audible);
      muteBtn.title = audible ? t.mute : t.unmute;
      muteBtn.setAttribute('aria-label', audible ? t.mute : t.unmute);
      muteBtn.setAttribute('aria-pressed', String(audible));
    }
    if (offsetValue) {
      offsetValue.textContent = `${v.config.offset > 0 ? '+' : ''}${v.config.offset.toFixed(1)}s`;
    }

    // Offline: een rustig "offline"-vlak in plaats van een technische fout.
    // De fout zelf blijft beschikbaar als tooltip (en in de console).
    const offline = card.querySelector<HTMLElement>('.card-offline');
    if (offline) {
      offline.hidden = !failed;
      const title = offline.querySelector<HTMLElement>('.card-offline-title');
      const sub = offline.querySelector<HTMLElement>('.card-offline-sub');
      const hint = offline.querySelector<HTMLElement>('.card-offline-hint');
      if (title) title.textContent = v.config.label || v.config.ref;
      if (sub) sub.textContent = t.offlineHint;
      if (hint) hint.textContent = t.offlineCheckBack;
      offline.title = v.status.error ?? '';
    }
    errorBox.hidden = true;
    if (v.status.error) errorBox.dataset.message = v.status.error;
  }
}

function findView(views: StreamView[], id: string): StreamView | null {
  return views.find((v) => v.config.id === id) ?? null;
}

/** De publieke streampagina van een stream (of de HLS-URL zelf). */
export function streamPageUrl(config: StreamConfig): string | null {
  switch (config.kind) {
    case 'twitch':
    case 'twitch-hls':
      return `https://www.twitch.tv/${encodeURIComponent(config.ref)}`;
    case 'youtube':
      return `https://www.youtube.com/watch?v=${encodeURIComponent(config.ref)}`;
    case 'hls':
    case 'video':
      return config.ref;
  }
}

function kindSvg(kind: StreamConfig['kind']): string {
  switch (kind) {
    case 'twitch':
    case 'twitch-hls':
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 3 2.5 6.5V20h4v2.5h2.5L11.5 20H15l5-5V3H4Zm15 11-3 3h-4.5L8.5 20v-3H5V5h14v9Z"/><path fill="currentColor" d="M11 8h2v5h-2zM15 8h2v5h-2z"/></svg>`;
    case 'youtube':
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 7.2a2.5 2.5 0 0 0-1.76-1.77C18.25 5 12 5 12 5s-6.25 0-7.84.43A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.76 1.77C5.75 19 12 19 12 19s6.25 0 7.84-.43a2.5 2.5 0 0 0 1.76-1.77A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3-5.2 3Z"/></svg>`;
    case 'hls':
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5h18v2H3zM3 9h12v2H3zM3 13h18v2H3zM3 17h8v2H3z"/></svg>`;
    case 'video':
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 5h12v14H4zM17 9l4-2v10l-4-2z"/></svg>`;
  }
}

const ICON_FOCUS = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 3h7v2H5v5H3V3Zm11 0h7v7h-2V5h-5V3ZM3 14h2v5h5v2H3v-7Zm16 0h2v7h-7v-2h5v-5Z"/></svg>`;
const ICON_TV = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v10h16V7H4Zm3.5 12h9v2h-9v-2Z"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Z"/></svg>`;
const ICON_PLAY = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`;
const ICON_VOLUME = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4V9Zm12.5-2.1a7 7 0 0 1 0 10.2l-1.4-1.4a5 5 0 0 0 0-7.4l1.4-1.4Z"/></svg>`;
const ICON_MUTE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4V9Zm11 1.6 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1-2.1-2.1Z"/></svg>`;
