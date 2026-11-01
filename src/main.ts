import './style.css';
import { SyncEngine, type StreamView } from './engine';
import {
  LANGS,
  LANG_NAMES,
  MESSAGES,
  osLanguage,
  resolveLanguage,
  saveLanguage,
  savedLanguage,
  type Lang,
  type Messages,
} from './i18n';
import { parseSourceList } from './import';
import { parseSource, type StreamConfig } from './sources';
import { DEFAULT_SETTINGS, loadState, newStreamId, saveState, type AppSettings } from './store';
import type { SyncPlan } from './sync';
import { formatDelta, formatLatency } from './ui-utils';

const ICON_SETTINGS = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm-1.2-8h2.4l.4 2.3a7.6 7.6 0 0 1 2 .9l2-1.2 1.7 1.7-1.2 2c.4.6.7 1.3.9 2l2.3.4v2.4l-2.3.4a7.6 7.6 0 0 1-.9 2l1.2 2-1.7 1.7-2-1.2c-.6.4-1.3.7-2 .9l-.4 2.3h-2.4l-.4-2.3a7.6 7.6 0 0 1-2-.9l-2 1.2-1.7-1.7 1.2-2a7.6 7.6 0 0 1-.9-2L2 13.2v-2.4l2.3-.4c.2-.7.5-1.4.9-2l-1.2-2 1.7-1.7 2 1.2c.6-.4 1.3-.7 2-.9L10.8 2Z"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z"/></svg>`;
const ICON_GRID = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/></svg>`;

const state = loadState();
const settings: AppSettings = { ...DEFAULT_SETTINGS, ...state.settings };
const streams: StreamConfig[] = [...state.streams];

// Taal: keuze uit de cookie, anders de systeemtaal.
let lang: Lang = resolveLanguage();
let t: Messages = MESSAGES[lang];
document.documentElement.lang = lang;

const app = document.getElementById('app') as HTMLElement;
document.body.classList.remove('app-loading');

// Vang onverwachte fouten op, zodat de pagina nooit leeg blijft.
window.addEventListener('error', (event) => {
  showFatal(event.message || 'Error', event.error);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  showFatal(reason instanceof Error ? reason.message : String(reason), reason);
});

/**
 * Foutscherm. De tekst wordt pas bij het tonen opgehaald, zodat het altijd de
 * taal van dat moment gebruikt (ook als de taal later wisselt).
 */
function showFatal(message: string, error: unknown): void {
  if (document.getElementById('fatal-error')) return;
  const box = document.createElement('div');
  box.id = 'fatal-error';
  box.className = 'fatal-error';
  const details = error instanceof Error && error.stack ? error.stack : '';
  box.innerHTML = `
    <strong></strong>
    <p></p>
    <pre hidden></pre>
    <button type="button" class="btn"></button>
  `;
  (box.querySelector('p') as HTMLElement).textContent = message;
  if (details) {
    const pre = box.querySelector('pre') as HTMLElement;
    pre.textContent = details;
    pre.hidden = false;
  }
  (box.querySelector('button') as HTMLButtonElement).addEventListener('click', () => window.location.reload());
  document.body.appendChild(box);
  localizeFatal();
}

/** Zet de vaste teksten van het foutscherm in de huidige taal. */
function localizeFatal(): void {
  const box = document.getElementById('fatal-error');
  if (!box) return;
  const strong = box.querySelector('strong');
  const button = box.querySelector('button');
  if (strong) strong.textContent = t.fatalTitle;
  if (button) button.textContent = t.reload;
}

const languageOptions = [
  `<option value="auto">${escapeText(t.languageAuto)}</option>`,
  ...LANGS.map((code) => `<option value="${code}">${escapeText(LANG_NAMES[code])}</option>`),
].join('');

app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="url(#g)"/><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a970ff"/><stop offset="1" stop-color="#5c16c5"/></linearGradient></defs><path d="M9 23V9l14 7z" fill="#fff"/></svg>
      </span>
      <div class="brand-text">
        <strong>Stream Syncer</strong>
        <span data-i18n="tagline"></span>
      </div>
    </div>

    <div class="sync-status" id="sync-status">
      <span class="status-dot"></span>
      <div class="status-text">
        <span class="status-title"></span>
        <span class="status-sub"></span>
      </div>
    </div>

    <div class="topbar-actions">
      <button type="button" class="btn" id="btn-play"></button>
      <button type="button" class="btn" id="btn-pause"></button>
      <button type="button" class="btn" id="btn-resync"></button>
      <button type="button" class="btn btn-primary" id="btn-add"></button>
      <button type="button" class="icon-btn" id="btn-settings">${ICON_SETTINGS}</button>
    </div>
  </header>

  <main class="workspace">
    <section class="board" id="board">
      <div class="grid" id="grid"></div>
      <div class="empty-state" id="empty-state">
        <div class="empty-icon" aria-hidden="true">${ICON_GRID}</div>
        <h1></h1>
        <p></p>
        <button type="button" class="btn btn-primary" id="empty-add"></button>
      </div>
    </section>
  </main>

  <dialog class="modal" id="add-modal">
    <form method="dialog" class="modal-body" id="add-form">
      <header class="modal-head">
        <h2></h2>
        <button type="button" class="icon-btn" data-close>${ICON_CLOSE}</button>
      </header>
      <label class="field">
        <span class="field-label"></span>
        <textarea id="add-input" rows="6" spellcheck="false"></textarea>
        <span class="field-hint"><span id="add-hint"></span><code>shroud</code><span id="add-hint-end"></span></span>
      </label>
      <p class="form-error" id="add-error" hidden></p>
      <footer class="modal-foot">
        <button type="button" class="btn" data-close data-i18n="cancel"></button>
        <button type="submit" class="btn btn-primary" data-i18n="add"></button>
      </footer>
    </form>
  </dialog>

  <dialog class="modal" id="settings-modal">
    <form method="dialog" class="modal-body" id="settings-form">
      <header class="modal-head">
        <h2></h2>
        <button type="button" class="icon-btn" data-close>${ICON_CLOSE}</button>
      </header>

      <label class="switch-row">
        <span>
          <strong data-i18n="autoSync"></strong>
          <small data-i18n="autoSyncHint"></small>
        </span>
        <input type="checkbox" id="set-autosync" />
      </label>

      <label class="switch-row">
        <span>
          <strong data-i18n="twitchHls"></strong>
          <small data-i18n="twitchHlsHint"></small>
        </span>
        <input type="checkbox" id="set-twitch-hls" />
      </label>

      <label class="field-row">
        <span class="field-label" data-i18n="volume"></span>
        <input type="range" id="set-volume" min="0" max="1" step="0.01" />
        <output id="set-volume-out"></output>
      </label>

      <label class="field-row">
        <span class="field-label" data-i18n="safetyMargin"></span>
        <input type="number" id="set-margin" min="0" max="30" step="0.5" />
        <span class="field-hint" data-i18n="safetyMarginHint"></span>
      </label>

      <label class="field-row">
        <span class="field-label" data-i18n="maxLag"></span>
        <input type="number" id="set-maxlag" min="1" max="60" step="0.5" />
        <span class="field-hint" data-i18n="maxLagHint"></span>
      </label>

      <label class="field-row">
        <span class="field-label" data-i18n="anchorMargin"></span>
        <input type="number" id="set-anchor-margin" min="0" max="60" step="0.5" />
        <span class="field-hint" data-i18n="anchorMarginHint"></span>
      </label>

      <label class="field-row">
        <span class="field-label" data-i18n="language"></span>
        <select id="set-language">${languageOptions}</select>
        <span class="field-hint" data-i18n="languageHint"></span>
      </label>

      <footer class="modal-foot">
        <button type="button" class="btn" data-close data-i18n="close"></button>
      </footer>
    </form>
  </dialog>

  <div class="toast" id="toast" hidden></div>
`;

const grid = document.getElementById('grid') as HTMLElement;
const emptyState = document.getElementById('empty-state') as HTMLElement;
const statusEl = document.getElementById('sync-status') as HTMLElement;
const addModal = document.getElementById('add-modal') as HTMLDialogElement;
const settingsModal = document.getElementById('settings-modal') as HTMLDialogElement;
const addInput = document.getElementById('add-input') as HTMLTextAreaElement;
const addError = document.getElementById('add-error') as HTMLElement;
const toastEl = document.getElementById('toast') as HTMLElement;
const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
const btnResync = document.getElementById('btn-resync') as HTMLButtonElement;
const btnAdd = document.getElementById('btn-add') as HTMLButtonElement;
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const emptyTitle = emptyState.querySelector('h1') as HTMLElement;
const emptyText = emptyState.querySelector('p') as HTMLElement;
const emptyAdd = document.getElementById('empty-add') as HTMLButtonElement;
const addTitle = addModal.querySelector('h2') as HTMLElement;
const addLabel = addModal.querySelector('.field-label') as HTMLElement;
const addHint = document.getElementById('add-hint') as HTMLElement;
const addHintEnd = document.getElementById('add-hint-end') as HTMLElement;
const settingsTitle = settingsModal.querySelector('h2') as HTMLElement;
const setLanguage = document.getElementById('set-language') as HTMLSelectElement;

let toastTimer = 0;

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('is-visible');
    window.setTimeout(() => (toastEl.hidden = true), 250);
  }, 3200);
}

function persist(): void {
  saveState({ version: 2, streams, settings });
}

const engine = new SyncEngine(
  grid,
  {
    onStateChange: () => {
      updateEmptyState();
      persist();
    },
    onTick: (views, plan) => renderStatus(views, plan),
    onRemove: (id) => {
      const index = streams.findIndex((s) => s.id === id);
      if (index !== -1) streams.splice(index, 1);
      engine.remove(id);
      persist();
    },
    onTogglePause: (id) => engine.togglePause(id),
    onToggleForcedAnchor: (id) => {
      const stream = streams.find((s) => s.id === id);
      if (!stream) return;
      if (stream.forcedAnchor) {
        stream.forcedAnchor = false;
        engine.updateConfig(id, { forcedAnchor: false });
        toast(t.anchorAuto);
        return;
      }
      for (const other of streams) {
        if (other.id === id || !other.forcedAnchor) continue;
        other.forcedAnchor = false;
        engine.updateConfig(other.id, { forcedAnchor: false });
      }
      stream.forcedAnchor = true;
      engine.updateConfig(id, { forcedAnchor: true });
      toast(t.anchorForced(stream.label || stream.ref));
    },
    onResolved: (id, url, at) => {
      const stream = streams.find((s) => s.id === id);
      if (!stream) return;
      stream.resolvedUrl = url;
      stream.resolvedAt = at;
      persist();
    },
    onAnchorChange: (id) => {
      if (!id) return;
      const stream = streams.find((s) => s.id === id);
      if (!stream) return;
      toast(t.anchorNew(stream.label || stream.ref));
    },
    onSetMuted: (id, muted) => {
      const stream = streams.find((s) => s.id === id);
      if (!stream) return;
      stream.muted = muted;
      engine.updateConfig(id, { muted });
      if (muted && engine.getMasterId() === id) {
        for (const other of streams) {
          other.muted = true;
          engine.updateConfig(other.id, { muted: true });
        }
      }
    },
    onMakeMaster: (id) => {
      const stream = streams.find((s) => s.id === id);
      if (!stream) return;
      stream.muted = false;
      for (const other of streams) {
        if (other.id === id) continue;
        other.muted = true;
        engine.updateConfig(other.id, { muted: true });
      }
      engine.updateConfig(id, { muted: false });
      engine.setMaster(id);
    },
    onNudge: (id, delta) => {
      const stream = streams.find((s) => s.id === id);
      if (!stream) return;
      stream.offset = Math.round((stream.offset + delta) * 10) / 10;
      engine.updateConfig(id, { offset: stream.offset });
    },
  },
  () => ({
    autoSync: settings.autoSync,
    safetyMargin: settings.safetyMargin,
    maxLag: settings.maxLag,
    anchorSwitchMargin: settings.anchorSwitchMargin,
    maxPlausibleGap: settings.maxPlausibleGap,
  }),
  () => t,
);

/* ---------------------------------- taal ---------------------------------- */

/** Alle vaste teksten (en labels) opnieuw zetten in de huidige taal. */
function applyLanguage(): void {
  t = MESSAGES[lang];
  document.documentElement.lang = lang;
  document.title = 'Stream Syncer';

  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n as keyof Messages;
    const value = t[key];
    if (typeof value === 'string') el.textContent = value;
  }

  btnPlay.textContent = t.playAll;
  btnPlay.title = t.playAllTitle;
  btnPause.textContent = t.pause;
  btnPause.title = t.pauseTitle;
  btnResync.textContent = t.resync;
  btnResync.title = t.resyncTitle;
  btnAdd.textContent = t.addStreams;
  btnSettings.title = t.settings;
  emptyTitle.textContent = t.emptyTitle;
  emptyText.textContent = t.emptyText;
  emptyAdd.textContent = t.addStreams;
  addTitle.textContent = t.addTitle;
  addLabel.textContent = t.addLabel;
  addInput.placeholder = t.addPlaceholder;
  addHint.textContent = t.addHint;
  addHintEnd.textContent = t.addHintEnd;
  settingsTitle.textContent = t.settingsTitle;

  // De opties van de taalkeuze hebben ook een vertaalde naam.
  const autoOption = setLanguage.querySelector('option[value="auto"]');
  if (autoOption) autoOption.textContent = t.languageAuto;
  for (const code of LANGS) {
    const option = setLanguage.querySelector(`option[value="${code}"]`);
    if (option) option.textContent = LANG_NAMES[code];
  }

  // Kaarten en statusbalk opnieuw opbouwen met de nieuwe taal.
  engine.relocalize();
  renderStatus(engine.getViews(), engine.getPlan());
  syncSettingsForm();
  localizeFatal();
}

function changeLanguage(next: Lang | null): void {
  saveLanguage(next);
  lang = next ?? osLanguage();
  applyLanguage();
  toast(next === null ? t.languageAutoToast(LANG_NAMES[lang]) : t.languageChanged(LANG_NAMES[lang]));
}

/* ------------------------------ streams toevoegen ------------------------- */

function updateEmptyState(): void {
  const empty = engine.getViews().length === 0;
  emptyState.hidden = !empty;
  grid.hidden = empty;
}

function addSources(text: string): void {
  const { sources, errors } = parseSourceList(text);
  if (sources.length === 0) {
    addError.hidden = false;
    addError.textContent = errors.length ? t.addNoValid(errors.slice(0, 3).join(', ')) : t.addEmpty;
    return;
  }

  // Het eerste toegevoegde kanaal krijgt het geluid; de rest start gedempt.
  const hadStreams = streams.length > 0;
  let added = 0;
  let skipped = 0;
  for (const source of sources) {
    const kind = source.kind === 'twitch' && settings.twitchHls ? 'twitch-hls' : source.kind;
    const duplicate = streams.some((s) => s.kind === kind && s.ref === source.ref);
    if (duplicate) {
      skipped++;
      continue;
    }
    const config: StreamConfig = {
      id: newStreamId(),
      label: source.label,
      kind,
      ref: source.ref,
      offset: 0,
      latencyOverride: null,
      muted: hadStreams || added > 0,
      volume: 1,
    };
    streams.push(config);
    engine.add(config);
    added++;
  }

  persist();
  updateEmptyState();
  addInput.value = '';
  addError.hidden = true;
  addModal.close();
  toast(t.addedToast(added, skipped, errors.length));

  if (!hadStreams && added > 0) {
    const first = engine.getViews()[0];
    if (first) {
      first.config.muted = false;
      engine.updateConfig(first.config.id, { muted: false, volume: settings.masterVolume });
      engine.setMaster(first.config.id);
    }
  }
}

/* --------------------------------- statusbalk ----------------------------- */

function renderStatus(views: StreamView[], plan: SyncPlan | null): void {
  const title = statusEl.querySelector('.status-title') as HTMLElement;
  const sub = statusEl.querySelector('.status-sub') as HTMLElement;

  if (views.length === 0 || !plan) {
    statusEl.dataset.tone = 'idle';
    title.textContent = t.statusNoStreams;
    sub.textContent = t.statusNoStreamsSub;
    return;
  }

  const anchorView = views.find((v) => v.config.id === plan.anchorId);

  if (!anchorView) {
    statusEl.dataset.tone = 'idle';
    title.textContent = t.statusWaiting;
    sub.textContent = t.statusWaitingSub;
    return;
  }

  const maxAbsDelta = Math.max(
    0,
    ...plan.members.filter((m) => !m.isAnchor).map((m) => Math.abs(m.delta)),
  );
  const synced = maxAbsDelta < 0.5;
  statusEl.dataset.tone = synced ? 'good' : 'warn';
  const latency =
    anchorView.latency === null
      ? t.statusLatencyUnknown
      : t.statusLatency(formatLatency(plan.anchorLatency));
  // Is er een trager stream die we (nog) niet als referentie gebruiken?
  const slowestView = views.find((v) => v.config.id === plan.slowestId);
  const pending =
    !plan.forcedAnchor &&
    slowestView &&
    plan.slowestId !== plan.anchorId &&
    plan.slowestGap > settings.anchorSwitchMargin
      ? t.statusPending(slowestView.config.label || slowestView.config.ref, formatLatency(plan.slowestGap))
      : '';
  title.textContent = t.statusReference(
    anchorView.config.label || anchorView.config.ref,
    anchorView.config.forcedAnchor === true,
  );
  sub.textContent = synced
    ? t.statusSynced(latency, pending)
    : t.statusDrift(formatDelta(maxAbsDelta), latency, pending);
}

/* --------------------------------- dialogs -------------------------------- */

function openAdd(): void {
  addError.hidden = true;
  addModal.showModal();
  addInput.focus();
}

btnAdd.addEventListener('click', openAdd);
emptyAdd.addEventListener('click', openAdd);
btnPlay.addEventListener('click', () => engine.playAll());
btnPause.addEventListener('click', () => engine.pauseAll());
btnResync.addEventListener('click', () => {
  engine.resync();
  toast(t.resyncToast);
});

document.getElementById('add-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  addSources(addInput.value);
});

for (const btn of document.querySelectorAll<HTMLElement>('[data-close]')) {
  btn.addEventListener('click', () => {
    (btn.closest('dialog') as HTMLDialogElement | null)?.close();
  });
}

/* -------------------------------- instellingen ---------------------------- */

const setAutoSync = document.getElementById('set-autosync') as HTMLInputElement;
const setTwitchHls = document.getElementById('set-twitch-hls') as HTMLInputElement;
const setVolume = document.getElementById('set-volume') as HTMLInputElement;
const setVolumeOut = document.getElementById('set-volume-out') as HTMLOutputElement;
const setMargin = document.getElementById('set-margin') as HTMLInputElement;
const setMaxLag = document.getElementById('set-maxlag') as HTMLInputElement;
const setAnchorMargin = document.getElementById('set-anchor-margin') as HTMLInputElement;

function syncSettingsForm(): void {
  setAutoSync.checked = settings.autoSync;
  setTwitchHls.checked = settings.twitchHls;
  setVolume.value = String(settings.masterVolume);
  setVolumeOut.textContent = `${Math.round(settings.masterVolume * 100)}%`;
  setMargin.value = String(settings.safetyMargin);
  setMaxLag.value = String(settings.maxLag);
  setAnchorMargin.value = String(settings.anchorSwitchMargin);
  setLanguage.value = savedLanguage() ?? 'auto';
}

btnSettings.addEventListener('click', () => {
  syncSettingsForm();
  settingsModal.showModal();
});

setAutoSync.addEventListener('change', () => {
  settings.autoSync = setAutoSync.checked;
  persist();
});

setTwitchHls.addEventListener('change', () => {
  settings.twitchHls = setTwitchHls.checked;
  persist();
  syncTwitchStreams();
});

setVolume.addEventListener('input', () => {
  settings.masterVolume = Number(setVolume.value);
  setVolumeOut.textContent = `${Math.round(settings.masterVolume * 100)}%`;
  const master = engine.getMasterId();
  if (master) {
    const stream = streams.find((s) => s.id === master);
    if (stream) {
      stream.volume = settings.masterVolume;
      engine.updateConfig(master, { volume: settings.masterVolume });
    }
  }
  persist();
});

setMargin.addEventListener('change', () => {
  settings.safetyMargin = Math.max(0, Number(setMargin.value) || 0);
  persist();
});

setMaxLag.addEventListener('change', () => {
  settings.maxLag = Math.max(1, Number(setMaxLag.value) || 6);
  persist();
});

setAnchorMargin.addEventListener('change', () => {
  settings.anchorSwitchMargin = Math.max(0, Number(setAnchorMargin.value) || 0);
  persist();
});

setLanguage.addEventListener('change', () => {
  const value = setLanguage.value;
  changeLanguage(value === 'auto' ? null : (value as Lang));
});

/* --------------------------------- opstarten ------------------------------ */

/**
 * Zet bestaande Twitch-streams om naar de gewenste modus (HLS of embed).
 * De kaart wordt opnieuw opgebouwd; het geluid en de volgorde blijven gelijk.
 */
function syncTwitchStreams(): void {
  let changed = 0;
  for (const stream of [...streams]) {
    if (stream.kind !== 'twitch' && stream.kind !== 'twitch-hls') continue;
    const wanted = settings.twitchHls ? 'twitch-hls' : 'twitch';
    if (stream.kind === wanted) continue;
    const wasMaster = engine.getMasterId() === stream.id;
    const index = streams.indexOf(stream);
    const next: StreamConfig = {
      ...stream,
      kind: wanted,
      resolvedUrl: undefined,
      resolvedAt: undefined,
    };
    streams[index] = next;
    engine.remove(stream.id);
    engine.add(next);
    // Zet de kaart op dezelfde plek terug.
    const card = engine.getViews().find((v) => v.config.id === next.id)?.card;
    if (card) grid.insertBefore(card, grid.children[index] ?? null);
    if (wasMaster) engine.setMaster(next.id);
    changed++;
  }
  if (changed > 0) {
    persist();
    toast(settings.twitchHls ? t.syncTwitchOn : t.syncTwitchOff);
  }
}

applyLanguage();

for (const config of streams) engine.add(config);
engine.start();
updateEmptyState();
syncSettingsForm();

if (streams.length > 0) {
  const first = engine.getViews()[0];
  if (first) engine.setMaster(first.config.id);
}

// Autoplay is meestal geblokkeerd tot de eerste klik; probeer het daarna opnieuw.
const resumeOnGesture = () => {
  engine.playAll();
  window.removeEventListener('pointerdown', resumeOnGesture);
  window.removeEventListener('keydown', resumeOnGesture);
};
window.addEventListener('pointerdown', resumeOnGesture);
window.addEventListener('keydown', resumeOnGesture);

// URL-import: ?add=<url>&add=<url>
const params = new URLSearchParams(window.location.search);
const fromUrl = params.getAll('add');
if (fromUrl.length > 0) {
  addSources(fromUrl.join('\n'));
  history.replaceState(null, '', window.location.pathname);
}

// Handige debug-hook in de console.
Object.assign(window, {
  streamSyncer: {
    engine,
    settings,
    streams,
    parseSource,
    get lang() {
      return lang;
    },
    changeLanguage,
  },
});

// Tijdens ontwikkeling: ?reset wist de opgeslagen streams.
if (new URLSearchParams(window.location.search).has('reset')) {
  localStorage.removeItem('stream-syncer:state:v2');
  window.location.replace(window.location.pathname);
}
