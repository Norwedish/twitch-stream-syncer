/**
 * Chatpaneel met tabs per stream.
 *
 * Elke tab is een echte Twitch-chat-embed (`www.twitch.tv/embed/<kanaal>/chat`).
 * Die embed is een iframe van twitch.tv: hoe je daar bent ingelogd (of niet)
 * bepaalt Twitch zelf via de cookies van twitch.tv in je browser. Wij kunnen
 * daar niets aan toevoegen of aan veranderen — precies daarom is dit de echte
 * chat en niet een zelfgebouwde client op het IRC-protocol.
 *
 * Indelingen:
 * - `tabs`:    één chat tegelijk, met tabbladen.
 * - `columns`: alle chats naast elkaar (voor een chatblok dat breder is dan hoog).
 * - `stacked`: alle chats boven elkaar (voor een chatblok dat hoger is dan breed).
 * - `inline`:  een chat onder de bijbehorende streamkaart (max. 3 streams).
 *
 * De embeds worden pas aangemaakt als ze nodig zijn, en blijven daarna bestaan
 * zolang de indeling niet wisselt. Zo blijft de chatgeschiedenis bewaard als je
 * tussen tabs wisselt.
 */

export type ChatMode = 'tabs' | 'columns' | 'stacked' | 'inline';
export type ChatPlacement = 'panel' | 'sidebar';

export interface ChatTab {
  /** Stream-id (stabiel, ook na hernoemen). */
  id: string;
  /** Twitch-kanaal. */
  channel: string;
  /** Weergavenaam in de tab. */
  label: string;
}

export interface ChatAvailability {
  /** Naast elkaar: alleen als het chatblok breder is dan hoog. */
  columns: boolean;
  /** Boven elkaar: alleen als het chatblok hoger is dan breed. */
  stacked: boolean;
  /** Onder de streams: alleen bij maximaal 3 streams. */
  inline: boolean;
}

export interface ChatLabels {
  chat: string;
  layout: string;
  tabs: string;
  columns: string;
  stacked: string;
  inline: string;
  inlineNote: string;
}

interface ChatEntry {
  pane: HTMLElement;
  head: HTMLButtonElement;
  frame: HTMLIFrameElement;
}

/** Hoe vaak we het donkere thema in een embed proberen te zetten. */
const THEME_RETRIES = 12;
const THEME_RETRY_MS = 500;

const MODE_ORDER: ChatMode[] = ['tabs', 'columns', 'stacked', 'inline'];

const MODE_ICONS: Record<ChatMode, string> = {
  tabs: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5h18v3H3V5Zm0 5h18v9H3v-9Zm2 2v5h14v-5H5Z"/></svg>`,
  columns: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5h8v14H3V5Zm2 2v10h4V7H5Zm6-2h8v14h-8V5Zm2 2v10h4V7h-4Z"/></svg>`,
  stacked: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5h18v6H3V5Zm2 2v2h14V7H5Zm-2 6h18v6H3v-6Zm2 2v2h14v-2H5Z"/></svg>`,
  inline: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 4h18v9H3V4Zm2 2v5h14V6H5Zm-2 9h8v5H3v-5Zm2 2v1h4v-1H5Zm6-2h8v5h-8v-5Zm2 2v1h4v-1h-4Z"/></svg>`,
};

const MODE_LABEL_KEY: Record<ChatMode, keyof ChatLabels> = {
  tabs: 'tabs',
  columns: 'columns',
  stacked: 'stacked',
  inline: 'inline',
};

export class ChatPanel {
  private tabs: ChatTab[] = [];
  private activeId: string | null = null;
  private placement: ChatPlacement = 'sidebar';
  private mode: ChatMode = 'tabs';
  private availability: ChatAvailability = { columns: true, stacked: true, inline: false };
  private readonly panelEntries = new Map<string, ChatEntry>();
  private readonly inlineEntries = new Map<string, ChatEntry>();
  private readonly tabButtons = new Map<string, HTMLButtonElement>();
  private readonly modeButtons = new Map<ChatMode, HTMLButtonElement>();
  private inlineHosts = new Map<string, HTMLElement>();
  private readonly toolbar: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly inlineNote: HTMLElement;
  private readonly tabsList: HTMLElement;
  private readonly body: HTMLElement;
  private readonly empty: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly onChange: () => void,
    private readonly labels: () => ChatLabels,
    private readonly onModeChange: (mode: ChatMode) => void,
  ) {
    this.tabsList = root.querySelector('.chat-tabs') as HTMLElement;
    this.body = root.querySelector('.chat-body') as HTMLElement;
    this.empty = root.querySelector('.chat-empty') as HTMLElement;

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'chat-head';

    this.heading = document.createElement('span');
    this.heading.className = 'chat-heading';

    this.inlineNote = document.createElement('span');
    this.inlineNote.className = 'chat-inline-note';
    this.inlineNote.hidden = true;

    const modes = document.createElement('div');
    modes.className = 'chat-modes';
    modes.setAttribute('role', 'group');

    this.toolbar.append(this.heading, this.inlineNote, modes);
    root.insertBefore(this.toolbar, this.tabsList);

    for (const mode of MODE_ORDER) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'icon-btn chat-mode-btn';
      button.dataset.mode = mode;
      button.innerHTML = MODE_ICONS[mode];
      button.addEventListener('click', () => this.onModeChange(mode));
      modes.appendChild(button);
      this.modeButtons.set(mode, button);
    }

    this.root.dataset.layout = this.placement;
    this.root.dataset.mode = this.mode;
    this.refreshLabels();
    this.updateModeButtons();
  }

  getPlacement(): ChatPlacement {
    return this.placement;
  }

  setPlacement(placement: ChatPlacement): void {
    this.placement = placement;
    this.root.dataset.layout = placement;
  }

  getMode(): ChatMode {
    return this.mode;
  }

  setMode(mode: ChatMode): void {
    const next = this.isModeAvailable(mode) ? mode : 'tabs';
    if (next === this.mode) {
      this.updateModeButtons();
      return;
    }
    this.mode = next;
    this.root.dataset.mode = next;
    // De andere set embeds opruimen: dan draaien er nooit onnodig twee
    // chatsets voor dezelfde streams tegelijk.
    if (next === 'inline') this.clearPanelEntries();
    else this.clearInlineEntries();
    this.updateModeButtons();
    this.render();
  }

  setAvailability(availability: ChatAvailability): void {
    this.availability = availability;
    this.updateModeButtons();
    if (!this.isModeAvailable(this.mode)) {
      this.mode = 'tabs';
      this.root.dataset.mode = this.mode;
      this.clearInlineEntries();
      this.render();
    }
  }

  /** De chatbuttons in de toolbar hebben vertaalde labels nodig. */
  refreshLabels(): void {
    const labels = this.labels();
    this.heading.textContent = labels.chat;
    this.toolbar.setAttribute('aria-label', labels.layout);
    this.tabsList.setAttribute('aria-label', labels.chat);
    this.inlineNote.textContent = labels.inlineNote;
    for (const [mode, button] of this.modeButtons) {
      const label = labels[MODE_LABEL_KEY[mode]];
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(mode === this.mode));
    }
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  /**
   * Werkt de tabs bij. De volgorde is de toevoegvolgorde van de streams.
   * Bestaande tabs (en hun embeds) blijven staan.
   */
  setTabs(tabs: ChatTab[]): void {
    this.tabs = tabs;
    const ids = new Set(tabs.map((t) => t.id));

    // Verwijderde streams: tab + embeds opruimen.
    for (const [id, entry] of this.panelEntries) {
      if (ids.has(id)) continue;
      entry.pane.remove();
      this.panelEntries.delete(id);
    }
    for (const [id, entry] of this.inlineEntries) {
      if (ids.has(id)) continue;
      entry.pane.remove();
      this.inlineEntries.delete(id);
    }
    for (const [id, button] of this.tabButtons) {
      if (ids.has(id)) continue;
      button.remove();
      this.tabButtons.delete(id);
    }

    // Nieuwe tabs erbij, in de juiste volgorde.
    for (const tab of tabs) {
      let button = this.tabButtons.get(tab.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'chat-tab';
        button.dataset.id = tab.id;
        button.setAttribute('role', 'tab');
        button.addEventListener('click', () => this.activate(tab.id));
        // Pijltjestoetsen wisselen van tab (zoals een echte tablist).
        button.addEventListener('keydown', (event) => this.onTabKey(event, tab.id));
        this.tabButtons.set(tab.id, button);
      }
      button.textContent = tab.label || tab.channel;
      button.title = tab.channel;
      this.tabsList.appendChild(button);
    }

    if (this.activeId === null || !ids.has(this.activeId)) {
      this.activeId = tabs[0]?.id ?? null;
    }
    this.render();
  }

  /** Waar de inline-chats moeten komen (onder de streamkaarten). */
  setInlineHosts(hosts: Map<string, HTMLElement>): void {
    this.inlineHosts = hosts;
    this.render();
  }

  /** Toetsenbordnavigatie tussen de tabs (← → Home End). */
  private onTabKey(event: KeyboardEvent, id: string): void {
    const order = this.tabs.map((t) => t.id);
    const index = order.indexOf(id);
    if (index === -1) return;
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % order.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + order.length) % order.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = order.length - 1;
    else return;
    event.preventDefault();
    this.activate(order[next]);
    this.tabButtons.get(order[next])?.focus();
  }

  /** Wisselt van actieve stream (bv. bij focus op een stream). */
  activate(id: string): void {
    if (!this.tabs.some((t) => t.id === id)) return;
    if (this.activeId === id) return;
    this.activeId = id;
    this.render();
    this.onChange();
  }

  /**
   * Bouwt alle embeds opnieuw op. Nodig na het inloggen: de embeds lezen de
   * Twitch-sessie bij het laden.
   */
  reload(): void {
    this.clearPanelEntries();
    this.clearInlineEntries();
    this.render();
  }

  private isModeAvailable(mode: ChatMode): boolean {
    if (mode === 'tabs') return true;
    if (mode === 'columns') return this.availability.columns;
    if (mode === 'stacked') return this.availability.stacked;
    return this.availability.inline;
  }

  private updateModeButtons(): void {
    for (const [mode, button] of this.modeButtons) {
      button.hidden = !this.isModeAvailable(mode);
      button.classList.toggle('is-active', mode === this.mode);
      button.setAttribute('aria-pressed', String(mode === this.mode));
    }
  }

  private render(): void {
    const hasTabs = this.tabs.length > 0;
    const inline = this.mode === 'inline' && hasTabs;

    this.root.dataset.mode = this.mode;
    this.body.dataset.mode = this.mode;
    this.tabsList.hidden = !hasTabs || this.mode !== 'tabs';
    this.body.hidden = !hasTabs || inline;
    this.empty.hidden = hasTabs;
    this.inlineNote.hidden = !inline;
    this.updateModeButtons();

    for (const [id, button] of this.tabButtons) {
      button.classList.toggle('is-active', id === this.activeId);
      button.setAttribute('aria-selected', String(id === this.activeId));
      button.tabIndex = id === this.activeId ? 0 : -1;
      button.setAttribute('aria-controls', `chat-panel-${id}`);
    }

    if (!hasTabs) {
      this.clearPanelEntries();
      this.clearInlineEntries();
      return;
    }

    if (inline) {
      this.renderInline();
      return;
    }

    this.clearInlineEntries();
    this.renderPanel();
  }

  private renderPanel(): void {
    const active = this.tabs.find((t) => t.id === this.activeId) ?? this.tabs[0];
    if (!active) return;
    if (this.activeId !== active.id) this.activeId = active.id;

    const split = this.mode === 'columns' || this.mode === 'stacked';

    // In tabs-modus maken we alleen de actieve embed aan. In de splitmodi
    // moeten alle chats zichtbaar zijn, dus maken we ze allemaal aan.
    if (split) {
      for (const tab of this.tabs) this.ensurePanelEntry(tab);
    } else {
      this.ensurePanelEntry(active);
    }

    for (const [id, entry] of this.panelEntries) {
      entry.pane.hidden = !split && id !== active.id;
      entry.pane.classList.toggle('is-active', id === active.id);
      const tab = this.tabs.find((t) => t.id === id);
      if (tab) entry.head.textContent = tab.label || tab.channel;
    }
  }

  private renderInline(): void {
    const ids = new Set(this.tabs.map((t) => t.id));
    for (const [id, entry] of this.inlineEntries) {
      if (ids.has(id) && this.inlineHosts.has(id)) continue;
      entry.pane.remove();
      this.inlineEntries.delete(id);
    }

    for (const tab of this.tabs) {
      const host = this.inlineHosts.get(tab.id);
      if (!host) continue;
      let entry = this.inlineEntries.get(tab.id);
      if (!entry) {
        entry = this.createEntry(tab, 'inline');
        this.inlineEntries.set(tab.id, entry);
      }
      if (entry.pane.parentElement !== host) host.appendChild(entry.pane);
      entry.head.textContent = tab.label || tab.channel;
      entry.pane.classList.toggle('is-active', tab.id === this.activeId);
    }
  }

  private ensurePanelEntry(tab: ChatTab): ChatEntry {
    let entry = this.panelEntries.get(tab.id);
    if (!entry) {
      entry = this.createEntry(tab, 'panel');
      this.panelEntries.set(tab.id, entry);
      this.body.appendChild(entry.pane);
    }
    entry.head.textContent = tab.label || tab.channel;
    return entry;
  }

  private createEntry(tab: ChatTab, scope: 'panel' | 'inline'): ChatEntry {
    const pane = document.createElement('div');
    pane.className = `chat-pane chat-pane-${scope}`;
    pane.dataset.id = tab.id;

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'chat-pane-head';
    head.title = tab.channel;
    head.addEventListener('click', () => this.activate(tab.id));

    const frame = this.createFrame(tab.channel, `${scope}-${tab.id}`);
    pane.append(head, frame);
    this.applyDarkTheme(frame);
    return { pane, head, frame };
  }

  private createFrame(channel: string, key: string): HTMLIFrameElement {
    const frame = document.createElement('iframe');
    const host = window.location.hostname;
    // `darkpopout` laat Twitch het donkere thema gebruiken (zoals de Twitch-popout).
    const params = new URLSearchParams({ parent: host, darkpopout: '' });
    frame.src = `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?${params}`;
    frame.className = 'chat-frame';
    frame.title = `Twitch chat: ${channel}`;
    frame.id = `chat-${key}`;
    frame.setAttribute('role', key.startsWith('panel-') ? 'tabpanel' : 'region');
    frame.setAttribute('aria-label', `Twitch chat: ${channel}`);
    frame.setAttribute('allow', 'clipboard-write');
    frame.setAttribute('scrolling', 'no');
    return frame;
  }

  private clearPanelEntries(): void {
    for (const entry of this.panelEntries.values()) entry.pane.remove();
    this.panelEntries.clear();
  }

  private clearInlineEntries(): void {
    for (const entry of this.inlineEntries.values()) entry.pane.remove();
    this.inlineEntries.clear();
  }

  /**
   * Probeert het donkere thema in de Twitch-embed te zetten. Twitch gebruikt de
   * klassen `tw-root--theme-light` / `tw-root--theme-dark` op het <html>-element.
   *
   * De embed is een iframe van twitch.tv: dat mag alleen als de pagina op
   * twitch.tv draait. Op je eigen domein blokkeert de browser dit, en dan
   * bepaalt de Twitch-embed zelf het thema (`darkpopout`). We proberen het wel,
   * zodat het werkt zodra dat wél kan.
   */
  private applyDarkTheme(frame: HTMLIFrameElement): void {
    let attempts = 0;
    const apply = () => {
      attempts++;
      let doc: Document | null = null;
      try {
        doc = frame.contentDocument;
      } catch {
        return; // Andere origin: niet toegestaan.
      }
      const root = doc?.documentElement;
      if (!root) return;
      root.classList.remove('tw-root--theme-light');
      root.classList.add('tw-root--theme-dark');
      if (attempts < THEME_RETRIES) window.setTimeout(apply, THEME_RETRY_MS);
    };
    frame.addEventListener('load', () => {
      attempts = 0;
      apply();
    });
    window.setTimeout(apply, THEME_RETRY_MS);
  }
}
