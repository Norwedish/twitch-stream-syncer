/**
 * Chatpaneel met tabs per stream.
 *
 * Elke tab is een echte Twitch-chat-embed (`www.twitch.tv/embed/<kanaal>/chat`),
 * dus met de ingelogde chat: moderatie, badges, replies, polls enzovoort. Een
 * eigen chatclient op het IRC-protocol kan dat niet.
 *
 * De embeds worden pas aangemaakt als een tab voor het eerst zichtbaar is, en
 * blijven daarna bestaan (verborgen), zodat de chatgeschiedenis bewaard blijft
 * als je tussen tabs wisselt.
 */

export interface ChatTab {
  /** Stream-id (stabiel, ook na hernoemen). */
  id: string;
  /** Twitch-kanaal. */
  channel: string;
  /** Weergavenaam in de tab. */
  label: string;
}

export type ChatLayout = 'panel' | 'sidebar';

export class ChatPanel {
  private tabs: ChatTab[] = [];
  private activeId: string | null = null;
  private layout: ChatLayout = 'sidebar';
  private readonly frames = new Map<string, HTMLIFrameElement>();
  private readonly tabButtons = new Map<string, HTMLButtonElement>();

  constructor(
    private readonly root: HTMLElement,
    private readonly onChange: () => void,
  ) {}

  getLayout(): ChatLayout {
    return this.layout;
  }

  setLayout(layout: ChatLayout): void {
    this.layout = layout;
    this.root.dataset.layout = layout;
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

    // Verwijderde streams: tab + embed opruimen.
    for (const [id, frame] of this.frames) {
      if (ids.has(id)) continue;
      frame.remove();
      this.frames.delete(id);
      this.tabButtons.get(id)?.remove();
      this.tabButtons.delete(id);
    }

    // Nieuwe tabs erbij, in de juiste volgorde.
    const list = this.root.querySelector('.chat-tabs') as HTMLElement;
    for (const tab of tabs) {
      let button = this.tabButtons.get(tab.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'chat-tab';
        button.dataset.id = tab.id;
        button.addEventListener('click', () => this.activate(tab.id));
        this.tabButtons.set(tab.id, button);
      }
      button.textContent = tab.label || tab.channel;
      button.title = tab.channel;
      list.appendChild(button);
    }

    if (this.activeId === null || !ids.has(this.activeId)) {
      this.activeId = tabs[0]?.id ?? null;
    }
    this.render();
  }

  /** Wisselt van tab (bv. bij focus op een stream). */
  activate(id: string): void {
    if (!this.tabs.some((t) => t.id === id)) return;
    if (this.activeId === id && this.frames.has(id)) return;
    this.activeId = id;
    this.render();
    this.onChange();
  }

  private render(): void {
    const body = this.root.querySelector('.chat-body') as HTMLElement;
    const empty = this.root.querySelector('.chat-empty') as HTMLElement;
    const hasTabs = this.tabs.length > 0;
    empty.hidden = hasTabs;
    body.hidden = !hasTabs;

    for (const [id, button] of this.tabButtons) {
      button.classList.toggle('is-active', id === this.activeId);
      button.setAttribute('aria-selected', String(id === this.activeId));
    }

    const active = this.tabs.find((t) => t.id === this.activeId);
    if (!active) return;
    // Embed pas aanmaken als de tab voor het eerst zichtbaar wordt.
    let frame = this.frames.get(active.id);
    if (!frame) {
      frame = this.createFrame(active.channel);
      this.frames.set(active.id, frame);
      body.appendChild(frame);
    }
    for (const [id, f] of this.frames) f.hidden = id !== active.id;
  }

  private createFrame(channel: string): HTMLIFrameElement {
    const frame = document.createElement('iframe');
    const host = window.location.hostname;
    const params = new URLSearchParams({ parent: host });
    frame.src = `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?${params}`;
    frame.className = 'chat-frame';
    frame.title = `Twitch chat: ${channel}`;
    frame.setAttribute('allow', 'clipboard-write');
    frame.setAttribute('scrolling', 'no');
    return frame;
  }
}
