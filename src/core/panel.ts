// The panel beside a puzzle's canvas: real HTML controls instead of controls drawn on the canvas.
// A puzzle builds it once from `ctx.panel`, binding each control to a getter and a setter; the
// host calls `sync()` after every frame, so controls follow the game's state (values, disabled,
// hidden) without the puzzle pushing updates.
//
// Play, Settings and History are always available.
//
//   Play      Start / Stop, Pause and session actions, the clock and live stats.
//   Settings  everything chosen before a game, in Mode, Controls and Global subtabs: this puzzle's options (the game's
//             own, then gameplay controls and keys), then what applies to every puzzle (pirate, display, sound,
//             replays).
//   History   past games and replays only.
//
//
//   panel.clock(() => (timed ? { label: 'Time left', ms: left, countdown: true } : null));
//   const session = panel.session();
//   session.select('Mode', MODES, () => settings.mode, (m) => (settings.mode = m), { disabled: () => running });
//   session.button('Start', start, { variant: 'primary', label: () => (running ? 'Stop' : 'Start') });
//   panel.score().stats(['', 'Now', 'Best'], () => [['Moves', String(moves), String(best)]]);
//   panel.settings.group('Game').toggle('Ants', () => settings.ants, (on) => (settings.ants = on), { disabled: () => running });

import { getVolume, setVolume, getWarningTimer, setWarningTimer } from './audio';
import { keyFor, keyLabel, resetKeys, setKey, type KeyBinding } from './controls';
import { showsDutyReport, type DutyReport } from './duty/report';
import { foldTable, pirateSettings, renderReport } from './duty/view';
import { Store } from './storage';
import { extraRatings } from './duty/ratings';
import { fillStatCell, type StatRows } from './stat-cell';

type Get<T> = () => T;

export interface Option<T> {
  value: T;
  label: string;
}

export interface GroupOptions extends ControlOptions {
  /** Lays the group's fields out in this many columns, labels above, for runs of short boxes. */
  columns?: number;
  /** The heading folds the card away and opens it again; `true` starts folded. */
  collapsed?: boolean;
}

export interface ControlOptions {
  /** Greys the control out and ignores it while true. */
  disabled?: Get<boolean>;
  /** Hides the control while true. */
  hidden?: Get<boolean>;
  /** Tooltip. */
  title?: string;
}

export interface ButtonOptions extends ControlOptions {
  variant?: 'primary' | 'secondary';
  /** A label that changes with the game, e.g. Start / Stop. */
  label?: Get<string>;
}

export interface NumberOptions extends ControlOptions {
  min?: number;
  max?: number;
  step?: number;
}
export interface RangeOptions extends NumberOptions {
  maxValue?: Get<number>;
  /** Formats the displayed value without changing the range's underlying precision. */
  formatValue?: (value: number) => string;
  /** Reserves a fixed output width so changing digits do not shift the range. */
  outputWidth?: number;
  /** Called once after the user finishes dragging, for expensive updates such as replay seeking. */
  onCommit?: (value: number) => void;
}

export interface TextOptions extends ControlOptions {
  placeholder?: string;
  /** Hint for on-screen keyboards, e.g. 'numeric'. */
  inputMode?: string;
}

/** What a puzzle shows when a session ends. */
export interface SessionResults {
  /** Heading for the plain table, when there's no report. */
  title?: string;
  /** A line above a duty report, e.g. who won. */
  headline?: string;
  /** Sessions so far with these settings: shown below the report, apart from this session's rows. */
  averages?: readonly (readonly string[])[];
  /** The session's duty report; `rows` then become its folded-away details. */
  report?: DutyReport | null;
  rows: StatRows;
}

/** A button at the end of each row of a stats table. */
export interface RowAction {
  label: string;
  title: string;
  onClick: (index: number) => void;
  disabled?: (index: number) => boolean;
}

function rowsTable(rows: StatRows): HTMLElement {
  const table = el('table', 'panel-stats');
  const body = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    row.forEach((cell, i) => {
      const node = el(i === 0 ? 'th' : 'td');
      fillStatCell(node, cell);
      tr.append(node);
    });
    body.append(tr);
  }
  table.append(body);
  return table;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export interface ClockReading {
  /** What the time means, e.g. 'Time' or 'Time left'. */
  label: string;
  ms: number;
  /** A count down, shown as m:ss; otherwise a stopwatch, shown to the hundredth. */
  countdown?: boolean;
  /** A record to beat, in the same format. */
  best?: number | null;
  /** Shows the time in red, e.g. the last ten seconds. */
  warn?: boolean;
}

/** The clock's text: m:ss counting down, seconds to the hundredth (m:ss.cc past a minute) counting up. */
export function formatClock(ms: number, countdown = false): string {
  if (!Number.isFinite(ms) || ms >= 3_600_000) return '-';
  ms = Math.max(0, ms);
  if (countdown) {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const cs = Math.floor(ms / 10);
  const secs = ((cs % 6000) / 100).toFixed(2);
  return cs < 6000 ? secs : `${Math.floor(cs / 6000)}:${secs.padStart(5, '0')}`;
}

/** One tab's column of cards. */
export class Page {
  constructor(
    private readonly panel: Panel,
    readonly element: HTMLElement,
  ) {}

  /** A card of related controls, with an optional heading. */
  group(title?: string, options: GroupOptions = {}): Group {
    if (title && ['Game', 'Look', 'Reset', 'Seed', 'Score', 'Session', 'Board', 'Keys', 'Controls'].includes(title) && options.collapsed === undefined) title = undefined;
    const card = el('section', 'panel-group');
    if (title && options.collapsed !== undefined) {
      // A heading that folds the card: the arrow shows which way it goes.
      const heading = el('h2', 'panel-title is-collapsible');
      const toggle = el('button', 'panel-collapse', title);
      toggle.type = 'button';
      const set = (folded: boolean) => {
        card.classList.toggle('is-collapsed', folded);
        toggle.setAttribute('aria-expanded', String(!folded));
      };
      toggle.addEventListener('click', () => set(!card.classList.contains('is-collapsed')));
      heading.append(toggle);
      card.append(heading);
      set(options.collapsed);
    } else if (title) card.append(el('h2', 'panel-title', title));
    if (options.columns) {
      card.classList.add('is-columns');
      card.style.setProperty('--columns', String(options.columns));
    }
    this.element.insertBefore(card, this.element.querySelector(':scope > .panel-seed-settings'));
    this.panel.watch(card, options);
    return new Group(this.panel, card);
  }
}

export class Panel {
  private readonly syncers: Array<() => void> = [];
  private readonly tabs = el('nav', 'panel-tabs');
  private readonly pages: Array<{ name: string; tab: HTMLButtonElement; page: Page }> = [];
  private readonly clockCard = el('section', 'panel-group panel-clock');
  /** Where the canvas should get focus back after a control is used, so keys reach the game. */
  onUsed: () => void = () => {};
  /** Play controls beneath the shared mode, clock and score. `panel.group()` adds here. */
  readonly play: Page;
  /** What's chosen before a game, for this puzzle only. */
  readonly settings: Page;
  readonly seedSettings: Page;
  readonly controlSettings: Page;
  /** Settings shared by every puzzle, in the Global subtab. */
  readonly globalSettings: Page;
  private readonly preferences = new Store('global');
  private hideTimer = this.preferences.get<boolean>('hideTimer', false);
  private readonly live: Page;
  private readonly sessionPage: Page;
  private readonly sessionElement: HTMLElement;
  private readonly liveElement: HTMLElement;
  private resetSettings: () => void = () => {};
  /** The History tab's one card: past games first, then the replay controls. */
  private historyParts: { games: HTMLElement; replays: HTMLElement } | null = null;
  /**
   * While a game or replay is on, settings can still change: the first change abandons the game
   * unsaved, or closes the replay, before it applies. Set by the replay recorder.
   */
  private lock: { active: () => boolean; abandon: () => void } | null = null;

  constructor(readonly root: HTMLElement, private readonly canvas?: HTMLCanvasElement) {
    this.tabs.setAttribute('role', 'tablist');
    root.append(this.tabs);
    this.play = this.tab('Play');
    const settingsTab = this.tab('Settings').element;
    const settingsTabs = el('nav', 'panel-tabs panel-settings-tabs');
    settingsTabs.setAttribute('role', 'tablist');
    settingsTabs.setAttribute('aria-label', 'Settings scope');
    settingsTab.append(settingsTabs);
    const part = () => {
      const area = el('div', 'panel-settings-part');
      area.setAttribute('role', 'tabpanel');
      settingsTab.append(area);
      return new Page(this, area);
    };
    this.settings = part();
    const seedSettings = el('div', 'panel-seed-settings');
    this.settings.element.append(seedSettings);
    this.seedSettings = new Page(this, seedSettings);
    this.controlSettings = part();
    this.globalSettings = part();
    const scopes = [this.settings, this.controlSettings, this.globalSettings];
    const scopeButtons = ['Mode', 'Controls', 'Global'].map((name, i) => {
      const button = el('button', 'panel-tab', name);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => { selectScope(i); this.used(); });
      settingsTabs.append(button);
      return button;
    });
    const selectScope = (index: number) => {
      scopes.forEach((page, i) => { page.element.hidden = i !== index; });
      scopeButtons.forEach((button, i) => {
        button.classList.toggle('is-active', i === index);
        button.setAttribute('aria-selected', String(i === index));
      });
    };
    this.resetSettings = () => selectScope(0);
    this.resetSettings();
    this.tab('History');
    this.clockCard.hidden = true;
    const session = el('div', 'panel-page panel-session');
    const live = el('div', 'panel-page panel-live');
    this.tabs.after(session, live);
    this.sessionElement = session;
    this.liveElement = live;
    this.sessionPage = new Page(this, session);
    this.live = new Page(this, live);
    live.append(this.clockCard);
    pirateSettings(this.globalSettings);
    this.globalSettings.group('Display').toggle('Extra Ratings', extraRatings, (on) => {
      this.preferences.set('extraRatings', on);
      if (this.viewing) this.showReport(this.viewing, this.viewerAverages);
    }, { title: 'Allow ratings above Frenetic in Foraging and Vampire Carpentry.' }).toggle('Hide timer', () => this.hideTimer, (on) => {
      this.hideTimer = on;
      this.preferences.set('hideTimer', on);
    });
    this.globalSettings.group('Sound').range('Volume', getVolume, setVolume, { min: 0, max: 100 })
      .toggle('Warning timer', getWarningTimer, setWarningTimer, {
        title: 'Play a warning near the end of timed puzzles: 30 seconds for Foraging and Blacksmithing, 15 seconds for Treasure Haul and Vampire Carpentry.',
      });
    this.globalSettings.group('History').toggle('Save games to history',
      () => this.preferences.get<boolean>('saveHistory', true),
      (on) => this.preferences.set('saveHistory', on),
      { title: 'When off, finished games are left out of the History tab, scores and replays. Session stats still count them until the tab is closed.' },
    );
    const replayPreferences = this.globalSettings.group('Replays');
    replayPreferences.toggle('Save replays',
      () => this.preferences.get<boolean>('saveReplays', true),
      (on) => this.preferences.set('saveReplays', on),
      { title: 'When off, new scores are still saved but their replay files are not.' },
    );
    replayPreferences.toggle('Show clicks',
      () => this.preferences.get<boolean>('showReplayClicks', true),
      (on) => this.preferences.set('showReplayClicks', on),
      { title: 'Blue and orange rings where a replay’s left and right clicks land.' },
    );
    replayPreferences.toggle('Exclude unlikely replays',
      () => this.preferences.get<boolean>('excludeUnlikelyReplays', true),
      (on) => this.preferences.set('excludeUnlikelyReplays', on),
      { title: 'Sessions left out of the history as unlikely to matter (a Normal forage too short to rate, a Distilling session that sent nothing up) keep no replay. Turn off to keep their replays.' },
    );
    replayPreferences.toggle('Compress replays',
      () => this.preferences.get<boolean>('compressReplays', true),
      (on) => this.preferences.set('compressReplays', on),
      { title: 'New recordings skip cursor travel that does not affect a move; Distilling keeps held-mouse paths.' },
    );
    replayPreferences.hint(() => 'Saved replays remain available in this browser. Connect a folder on the home page for automatic PC backups.');
    this.show(this.pages[0].name);
  }

  /** The page for a tab, made the first time it's asked for; tabs sit in the order they're made. */
  tab(name: string): Page {
    const existing = this.pages.find((p) => p.name === name);
    if (existing) return existing.page;
    const tab = el('button', 'panel-tab', name);
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => {
      this.show(name);
      this.used();
    });
    this.tabs.append(tab);
    const element = el('div', 'panel-page');
    element.setAttribute('role', 'tabpanel');
    this.root.append(element);
    const page = new Page(this, element);
    this.pages.push({ name, tab, page });
    if (this.pages.length > 1) element.hidden = true;
    return page;
  }

  /** Switches to a tab, e.g. back to Play when a game starts. */
  show(name: string): void {
    if (name === 'Settings') this.resetSettings();
    for (const p of this.pages) {
      const on = p.name === name;
      p.page.element.hidden = !on;
      p.tab.classList.toggle('is-active', on);
      p.tab.setAttribute('aria-selected', String(on));
    }
    // Session choices, Start, the clock and the score belong to Play; History shows only history.
    this.sessionElement.hidden = name !== 'Play';
    this.liveElement.hidden = name !== 'Play';
    this.sync();
  }

  /** A section of the History tab's single History card: `games` for past games, `replays` for the replay controls. */
  historySection(part: 'games' | 'replays', options: ControlOptions = {}): Group {
    if (!this.historyParts) {
      const card = this.tab('History').group('History');
      this.historyParts = { games: el('div', 'panel-history-part'), replays: el('div', 'panel-history-part') };
      card.element.append(this.historyParts.games, this.historyParts.replays);
    }
    const section = el('div', 'panel-history-section');
    this.historyParts[part].append(section);
    this.watch(section, options);
    return new Group(this, section);
  }

  /** What's playing, and how to abandon it when a setting changes (see `lock`). */
  sessionLock(active: () => boolean, abandon: () => void): void {
    this.lock = { active, abandon };
  }

  /** @internal A control is about to change something: a puzzle setting abandons the game or replay first. */
  beforeChange(node: HTMLElement, isButton = false): void {
    if (!this.lock?.active()) return;
    const setting = this.settings.element.contains(node) || (!isButton && this.sessionElement.contains(node));
    if (!setting) return;
    this.lock.abandon();
    this.sync();
  }

  /** Adds this puzzle's editable keyboard bindings to its Settings tab. */
  controls(puzzle: string, bindings: readonly KeyBinding[]): void {
    const group = this.controlSettings.group('Keys');
    for (const binding of bindings) {
      group.text(binding.label, () => keyLabel(keyFor(puzzle, binding.id, binding.defaultKey)), (value) => {
        setKey(puzzle, binding.id, value);
      }, { placeholder: binding.defaultKey, title: `Default: ${binding.defaultKey}` });
    }
    group.button('Restore defaults', () => resetKeys(puzzle));
  }

  /** A card of related controls on the Play tab, with an optional heading. */
  group(title?: string, options: GroupOptions = {}): Group {
    return this.play.group(title, options);
  }

  /** Buttons stay on Play; configuration fields are placed in Settings > Mode. */
  session(title?: string, options: GroupOptions = {}): Group {
    const actions = this.sessionPage.group(undefined, options);
    return new Group(this, actions.element, this.settings.group(title, options));
  }

  /** The main score, on the Play tab. */
  score(title = 'Score', options: GroupOptions = {}): Group {
    return this.live.group(title, options);
  }

  /**
   * The end-of-session screen over the board: a duty report when the puzzle gives one (its rows
   * folded away beneath as details), otherwise a table of the rows.
   */
  results(get: Get<SessionResults | null>): void {
    if (!this.canvas?.parentElement) return;
    const overlay = el('section', 'game-results');
    overlay.setAttribute('aria-label', 'Session results');
    const heading = el('h2', '', 'Session results');
    const content = el('div', 'results-content');
    overlay.append(heading, content);
    this.canvas.parentElement.append(overlay);
    overlay.hidden = true;
    let shown = '';
    this.addSync(() => {
      const result = get();
      overlay.hidden = !result || !!this.viewing;
      if (!result) return;
      heading.textContent = result.report ? result.headline ?? '' : result.title ?? 'Session results';
      heading.hidden = !heading.textContent;
      const key = JSON.stringify([result.report ?? null, result.rows, result.averages ?? [], extraRatings()]);
      if (key === shown) return;
      shown = key;
      content.replaceChildren(result.report ? renderReport(result.report, result.rows, result.averages) : rowsTable(result.rows));
      if (!result.report && result.averages) content.append(foldTable('averages', 'Session averages', result.averages.length ? result.averages : [['Sessions', 'No completed sessions yet']]));
    });
  }

  private viewing: DutyReport | null = null;
  private viewer: HTMLElement | null = null;
  private viewerAverages: readonly (readonly string[])[] | (() => readonly (readonly string[])[]) = [];

  /** Shows a saved report over the board (from History or a replay) until it's closed; null closes it. */
  showReport(report: DutyReport | null, averages: readonly (readonly string[])[] | (() => readonly (readonly string[])[]) = []): void {
    if (report && !showsDutyReport(report)) report = null;
    this.viewing = report;
    this.viewerAverages = averages;
    if (!this.canvas?.parentElement) return;
    if (!this.viewer) {
      this.viewer = el('section', 'game-results duty-viewer');
      this.viewer.setAttribute('aria-label', 'Duty report');
      this.canvas.parentElement.append(this.viewer);
    }
    this.viewer.hidden = !report;
    this.viewer.replaceChildren(...(report ? [renderReport(report, [], typeof averages === 'function' ? averages() : averages,
      () => { this.showReport(null); this.used(); })] : []));
    this.sync();
  }

  /** The saved report being shown, if any. */
  get shownReport(): DutyReport | null { return this.viewing; }

  /**
   * The clock below session controls. Null readings and Hide timer hide the card.
   */
  clock(get: Get<ClockReading | null>): void {
    const label = el('span', 'panel-clock-label');
    const time = el('span', 'panel-clock-time');
    const best = el('span', 'panel-clock-best');
    this.clockCard.replaceChildren(label, time, best);
    this.clockCard.hidden = false;
    this.addSync(() => {
      const reading = get();
      this.clockCard.hidden = this.hideTimer || !reading;
      const labelText = reading?.label ?? 'Time';
      const timeText = reading ? formatClock(reading.ms, reading.countdown) : 'Not timed';
      const bestText = reading?.best != null ? `Best ${formatClock(reading.best, reading.countdown)}` : '';
      if (label.textContent !== labelText) label.textContent = labelText;
      if (time.textContent !== timeText) time.textContent = timeText;
      if (best.textContent !== bestText) best.textContent = bestText;
      time.classList.toggle('is-off', !reading);
      time.classList.toggle('is-warn', !!reading?.warn);
    });
  }

  /** Brings every control in line with the game's state. Cheap when nothing changed. */
  sync(): void {
    for (const sync of this.syncers) sync();
  }

  /** @internal */
  addSync(sync: () => void): void {
    this.syncers.push(sync);
    sync();
  }

  /** @internal Applies the disabled / hidden / title options to a control's element. */
  watch(node: HTMLElement, options: ControlOptions, input?: HTMLInputElement | HTMLSelectElement | HTMLButtonElement): void {
    if (options.title) node.title = options.title;
    const { disabled, hidden } = options;
    if (!disabled && !hidden) return;
    this.addSync(() => {
      if (hidden) {
        const hide = hidden();
        if (node.hidden !== hide) node.hidden = hide;
      }
      if (disabled) {
        const off = disabled();
        node.classList.toggle('is-disabled', off);
        if (input && input.disabled !== off) input.disabled = off;
      }
    });
  }

  /** @internal */
  used(): void {
    this.sync();
    this.onUsed();
  }
}

export class Group {
  constructor(
    private readonly panel: Panel,
    readonly element: HTMLElement,
    private readonly choices?: Group,
  ) {}

  private field(label: string, control: HTMLElement, options: ControlOptions, input?: HTMLInputElement | HTMLSelectElement): HTMLElement {
    const heading = this.element.querySelector(':scope > .panel-title');
    if (heading?.textContent === label) heading.remove();
    const row = el('label', 'panel-field');
    row.append(el('span', 'panel-label', label), control);
    this.element.append(row);
    this.panel.watch(row, options, input);
    return row;
  }

  /** A dropdown of exclusive choices. */
  select<T extends string | number>(label: string, options: readonly Option<T>[] | Get<readonly Option<T>[]>, get: Get<T>, set: (value: T) => void, opts: ControlOptions = {}): this {
    if (this.choices) { this.choices.select(label, options, get, set, opts); return this; }
    const select = el('select', 'panel-select');
    const choices = typeof options === 'function' ? options : () => options;
    let current: readonly Option<T>[] | undefined;
    const syncOptions = () => {
      const next = choices();
      if (current === next) return;
      current = next;
      select.replaceChildren(...next.map((option, i) => {
        const node = el('option', '', option.label);
        node.value = String(i);
        return node;
      }));
    };
    syncOptions();
    select.addEventListener('change', () => {
      this.panel.beforeChange(this.element);
      const option = current?.[Number(select.value)];
      if (option) set(option.value);
      this.panel.used();
    });
    this.field(label, select, opts, select);
    this.panel.addSync(() => {
      syncOptions();
      const index = String(current!.findIndex((o) => o.value === get()));
      if (select.value !== index) select.value = index;
    });
    return this;
  }

  /** An on/off switch. Consecutive toggles in a group flow into columns. */
  toggle(label: string, get: Get<boolean>, set: (on: boolean) => void, opts: ControlOptions = {}): this {
    if (this.choices) { this.choices.toggle(label, get, set, opts); return this; }
    const input = el('input', 'panel-switch');
    input.type = 'checkbox';
    input.addEventListener('change', () => {
      this.panel.beforeChange(this.element);
      set(input.checked);
      this.panel.used();
    });
    const row = el('label', 'panel-toggle');
    row.append(input, el('span', '', label));
    this.toggleGrid().append(row);
    this.panel.watch(row, opts, input);
    this.panel.addSync(() => {
      const on = get();
      if (input.checked !== on) input.checked = on;
    });
    return this;
  }

  private toggleGrid(): HTMLElement {
    const last = this.element.lastElementChild;
    if (last?.classList.contains('panel-toggles')) return last as HTMLElement;
    const grid = el('div', 'panel-toggles');
    this.element.append(grid);
    return grid;
  }

  /** A number box; the value is set when it's committed (Enter or leaving the box). */
  range(label: string, get: Get<number>, set: (value: number) => void, opts: RangeOptions = {}): this {
    if (this.choices) { this.choices.range(label, get, set, opts); return this; }
    const input = el('input', 'panel-range');
    input.type = 'range';
    input.min = String(opts.min ?? 0);
    input.max = String(opts.max ?? 100);
    input.step = String(opts.step ?? 1);
    const output = el('output');
    if (opts.outputWidth) output.style.width = `${opts.outputWidth}ch`;
    const control = el('div', 'panel-range-control');
    control.append(input, output);
    input.addEventListener('input', () => {
      this.panel.beforeChange(this.element);
      set(Number(input.value));
      this.panel.sync();
    });
    input.addEventListener('change', () => {
      opts.onCommit?.(Number(input.value));
      this.panel.used();
    });
    this.field(label, control, opts, input);
    this.panel.addSync(() => {
      if (opts.maxValue) input.max = String(opts.maxValue());
      const value = String(get());
      input.value = value;
      output.textContent = opts.formatValue?.(Number(value)) ?? value;
    });
    return this;
  }

  number(label: string, get: Get<number>, set: (value: number) => void, opts: NumberOptions = {}): this {
    if (this.choices) { this.choices.number(label, get, set, opts); return this; }
    const input = el('input', 'panel-input');
    input.type = 'number';
    input.inputMode = 'numeric';
    if (opts.min !== undefined) input.min = String(opts.min);
    if (opts.max !== undefined) input.max = String(opts.max);
    input.step = String(opts.step ?? 1);
    input.addEventListener('change', () => {
      this.panel.beforeChange(this.element);
      let value = Number(input.value);
      if (input.value === '' || Number.isNaN(value)) value = get();
      if (opts.min !== undefined) value = Math.max(opts.min, value);
      if (opts.max !== undefined) value = Math.min(opts.max, value);
      set(value);
      input.value = String(get());
      this.panel.used();
    });
    enterCommits(input);
    this.field(label, input, opts, input);
    this.panel.addSync(() => {
      const value = String(get());
      if (document.activeElement !== input && input.value !== value) input.value = value;
    });
    return this;
  }

  /** A text box; the value is set when it's committed (Enter or leaving the box). */
  text(label: string, get: Get<string>, set: (value: string) => void, opts: TextOptions = {}): this {
    if (this.choices) { this.choices.text(label, get, set, opts); return this; }
    const input = el('input', 'panel-input');
    input.type = 'text';
    input.spellcheck = false;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.inputMode) input.inputMode = opts.inputMode;
    input.addEventListener('change', () => {
      this.panel.beforeChange(this.element);
      set(input.value);
      input.value = get();
      this.panel.used();
    });
    enterCommits(input);
    this.field(label, input, opts, input);
    this.panel.addSync(() => {
      const value = get();
      if (document.activeElement !== input && input.value !== value) input.value = value;
    });
    return this;
  }

  /** A button. Consecutive buttons in a group sit side by side. */
  button(label: string, onClick: () => void, opts: ButtonOptions = {}): this {
    const button = el('button', `panel-button ${opts.variant === 'primary' ? 'is-primary' : ''}`, label);
    button.type = 'button';
    button.addEventListener('click', () => {
      this.panel.beforeChange(this.element, true);
      onClick();
      this.panel.used();
    });
    const last = this.element.lastElementChild;
    const row = last?.classList.contains('panel-buttons') ? (last as HTMLElement) : el('div', 'panel-buttons');
    row.append(button);
    this.element.append(row);
    this.panel.watch(button, opts, button);
    if (opts.label) {
      const get = opts.label;
      this.panel.addSync(() => {
        const text = get();
        if (button.textContent !== text) button.textContent = text;
      });
    }
    return this;
  }

  /**
   * A small table, e.g. Now / Best per stat. `rows` returns [label, ...cells];
   * the first header cell sits over the labels and is usually ''.
   */
  stats(
    header: readonly string[],
    rows: Get<readonly (readonly string[])[]>,
    opts: ControlOptions = {},
    rowAction?: RowAction | readonly RowAction[],
  ): this {
    const actions: readonly RowAction[] = !rowAction ? [] : Array.isArray(rowAction) ? rowAction : [rowAction as RowAction];
    const table = el('table', 'panel-stats');
    if (header.some(Boolean)) {
      const head = el('tr');
      for (const cell of header) head.append(el('th', '', cell));
      for (const _ of actions) head.append(el('th', '', ''));
      table.append(el('thead'));
      table.tHead!.append(head);
    }
    const body = el('tbody');
    table.append(body);
    this.element.append(table);
    this.panel.watch(table, opts);
    let rowButtons: HTMLButtonElement[][] = [];
    let last = '';
    this.panel.addSync(() => {
      const data = rows();
      const key = JSON.stringify(data);
      if (key !== last) {
        last = key;
        rowButtons = actions.map(() => []);
        body.replaceChildren(
          ...data.map((row, index) => {
            const tr = el('tr');
            row.forEach((cell, i) => tr.append(el(i === 0 ? 'th' : 'td', '', cell)));
            actions.forEach((action, a) => {
              const td = el('td', 'panel-stats-action-cell');
              const button = el('button', 'panel-stats-action', action.label);
              button.type = 'button';
              button.title = action.title;
              button.setAttribute('aria-label', action.title);
              button.addEventListener('click', () => {
                action.onClick(index);
                this.panel.used();
              });
              td.append(button);
              tr.append(td);
              rowButtons[a].push(button);
            });
            return tr;
          }),
        );
      }
      actions.forEach((action, a) => rowButtons[a].forEach((button, index) => { button.disabled = action.disabled?.(index) ?? false; }));
    });
    return this;
  }

  /** A line of text that follows the game, e.g. a hint or a result. */
  note(get: Get<string>, opts: ControlOptions = {}): this {
    if (this.choices) { this.choices.hint(get, opts); return this; }
    const p = el('p', 'panel-note');
    this.element.append(p);
    this.panel.watch(p, opts);
    this.panel.addSync(() => {
      const text = get();
      if (p.textContent !== text) p.textContent = text;
      p.hidden = !text || (opts.hidden?.() ?? false);
    });
    return this;
  }

  /** Contextual help without adding a paragraph to the panel. */
  hint(get: Get<string>, opts: ControlOptions = {}): this {
    if (this.choices) { this.choices.hint(get, opts); return this; }
    this.panel.addSync(() => { this.element.title = opts.hidden?.() ? '' : get(); });
    return this;
  }

  /** Any other element, for controls the kit doesn't cover. */
  append(node: HTMLElement, opts: ControlOptions = {}): this {
    this.element.append(node);
    this.panel.watch(node, opts);
    return this;
  }
}

/** Enter commits a text or number box the way leaving it does. */
function enterCommits(input: HTMLInputElement): void {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
}

/** True for elements that take typing, whose keys the game shouldn't see. */
export function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}
