// The Voyage Records page: pick chatlogs, see personal bests by voyage type and crew size.
// Logs are read in the browser and never leave it. They stay loaded until the page is reloaded.
import { ICONS, type Icon } from '../core/duty/icons';
import batIcon from './media/bat.png?url';
import cursedChartIcon from './media/cursed_chart.png?url';
import serpentIcon from './media/serpent.png?url';
import squirrelIcon from './media/squirrel.png?url';
import vampireReliquaryIcon from './media/vampire_reliquary.png?url';
import wayfinderIcon from './media/wolf_skull_wayfinder.png?url';
import { againstRecords, type AgainstRecord } from './known-records';
import {
  askToReadLog,
  canReadLog,
  canRememberLogs,
  loadIgnored,
  pickLogHandles,
  saveIgnored,
  saveLogHandles,
  savedLogHandles,
  type LogHandle,
} from './saved';
import {
  cleanIgnoreList,
  expeditions,
  expectedFamiliars,
  mergeRuns,
  parseChatlogFile,
  personalBests,
  recordsByCrewSize,
  topChestShare,
  withoutIgnored,
  type CrewRecord,
  type ExpeditionId,
  type NewBest,
  type Run,
} from './records';

interface LoadedLog {
  id: string;
  name: string;
  runs: Run[];
  error: string | null;
  /** Only logs chosen with the browser's file picker can be reopened on the next visit. */
  handle?: LogHandle;
}

interface LogSource {
  file: File;
  handle?: LogHandle;
}

/** Tier 3 to tier 1, as in Run.loot. */
const CHEST_ICONS: Record<ExpeditionId, [string, string, string]> = {
  woodhallow: ['werewolf-chest-large', 'werewolf-chest-medium', 'werewolf-chest-small'],
  cursedIsles: ['ci-cursed-chest', 'ci-fetish-jar', 'ci-bone-box'],
  vampireLairs: ['vampirate-chest-large', 'vampirate-chest-medium', 'vampirate-chest-small'],
};
/** The familiar each voyage's tier 3 chests can hold. */
const FAMILIARS: Record<ExpeditionId, { name: string; icon: string }> = {
  woodhallow: { name: 'squirrels', icon: squirrelIcon },
  cursedIsles: { name: 'serpents', icon: serpentIcon },
  vampireLairs: { name: 'bats', icon: batIcon },
};
/** The item that leads a crew to each voyage. */
const VOYAGE_ITEMS: Record<ExpeditionId, string> = {
  woodhallow: wayfinderIcon,
  cursedIsles: cursedChartIcon,
  vampireLairs: vampireReliquaryIcon,
};
const EXPEDITION_IDS = Object.keys(expeditions) as ExpeditionId[];
const SHEET_WIDTH = 36;
const SHEET_HEIGHT = 12;
const VOYAGES_PER_PAGE = 20;

// Chatlog times are the ones written in the log, stored as if UTC, so they are shown back as UTC.
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
const count = new Intl.NumberFormat();
const shareFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const familiarFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const state = {
  logs: [] as LoadedLog[],
  reading: 0,
  expedition: null as ExpeditionId | null,
  ocean: null as string | null,
  openCrew: null as number | null,
  sort: 'newest' as 'newest' | 'score',
  voyagePage: 0,
  ignored: loadIgnored(),
  ignoreOpen: false,
  /** Saved logs the browser needs a click to reopen. */
  pendingLogs: [] as LogHandle[],
  restored: false,
};
let renderPage = () => {};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children.filter((child) => child !== null));
  return node;
}

function button(label: string | Node, className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function plural(amount: number, one: string, many = `${one}s`): string {
  return `${count.format(amount)} ${amount === 1 ? one : many}`;
}

function chestIcon(name: string, title: string, scale = 2): HTMLElement {
  const icon: Icon = ICONS[name];
  const [x, y, w, h] = icon.area;
  const node = el('span', 'vr-chest');
  node.title = title;
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', title);
  node.style.width = `${w * scale}px`;
  node.style.height = `${h * scale}px`;
  node.style.backgroundImage = `url("${icon.url}")`;
  node.style.backgroundSize = `${SHEET_WIDTH * scale}px ${SHEET_HEIGHT * scale}px`;
  node.style.backgroundPosition = `${-x * scale}px ${-y * scale}px`;
  return node;
}

function formatDate(run: Run, withTime = false): string {
  if (run.startedAt === null) return 'Undated';
  return (withTime ? dateTimeFormat : dateFormat).format(run.startedAt);
}

function oceanKey(run: Run): string {
  return run.ocean ?? '';
}

function oceanName(key: string): string {
  return key ? `${key[0].toUpperCase()}${key.slice(1)}` : 'Unknown ocean';
}

function mostCommon<T>(values: T[]): T | null {
  const tally = new Map<T, number>();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function addFiles(sources: LogSource[]): Promise<void> {
  const fresh = sources.filter(({ file }) => !state.logs.some((log) => log.id === fileId(file)));
  if (!fresh.length) return;
  state.reading += fresh.length;
  renderPage();
  const loaded = await Promise.all(fresh.map(async ({ file, handle }): Promise<LoadedLog> => {
    const id = fileId(file);
    try {
      return { id, name: file.name, runs: await parseChatlogFile(file), error: null, handle };
    } catch (error) {
      const unreadable = error instanceof Error && error.message.includes('ocean')
        ? 'This log mixes oceans, so it was skipped.'
        : "This file couldn't be read.";
      return { id, name: file.name, runs: [], error: unreadable, handle };
    }
  }));
  state.reading -= fresh.length;
  state.logs.push(...loaded.filter((log) => !state.logs.some((other) => other.id === log.id)));
  state.expedition = null;
  state.ocean = null;
  state.openCrew = null;
  state.voyagePage = 0;
  rememberLogs();
  renderPage();
}

function rememberLogs(): void {
  const handles = state.logs.flatMap((log) => (log.handle ? [log.handle] : []));
  void saveLogHandles([...handles, ...state.pendingLogs]);
}

/** A saved log that has since been moved or deleted drops out of the list. */
async function addHandles(handles: LogHandle[]): Promise<void> {
  const sources = await Promise.all(handles.map(async (handle): Promise<LogSource | null> => {
    try {
      return { file: await handle.getFile(), handle };
    } catch {
      return null;
    }
  }));
  await addFiles(sources.filter((source) => source !== null));
  rememberLogs();
}

async function restoreLogs(): Promise<void> {
  if (state.restored) return;
  state.restored = true;
  const handles = await savedLogHandles();
  const readable = await Promise.all(handles.map(canReadLog));
  state.pendingLogs = handles.filter((_, index) => !readable[index]);
  await addHandles(handles.filter((_, index) => readable[index]));
  renderPage();
}

async function reopenLogs(): Promise<void> {
  const waiting = state.pendingLogs;
  state.pendingLogs = [];
  const allowed: LogHandle[] = [];
  for (const handle of waiting) {
    if (await askToReadLog(handle)) allowed.push(handle);
    else state.pendingLogs.push(handle);
  }
  await addHandles(allowed);
  renderPage();
}

function forgetPendingLogs(): void {
  state.pendingLogs = [];
  rememberLogs();
  renderPage();
}

function chooseLogs(input: HTMLInputElement): void {
  if (canRememberLogs()) void pickLogHandles().then(addHandles);
  else input.click();
}

function fileId(file: File): string {
  return JSON.stringify([file.name, file.size, file.lastModified]);
}

function chatlogInput(): HTMLInputElement {
  const input = el('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  input.setAttribute('aria-label', 'Puzzle Pirates chatlogs');
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    void addFiles(files.map((file) => ({ file })));
  });
  return input;
}

function acceptDrops(target: HTMLElement): void {
  target.addEventListener('dragover', (event) => {
    event.preventDefault();
    target.classList.add('is-over');
  });
  target.addEventListener('dragleave', () => target.classList.remove('is-over'));
  target.addEventListener('drop', (event) => {
    event.preventDefault();
    target.classList.remove('is-over');
    void addFiles([...(event.dataTransfer?.files ?? [])].map((file) => ({ file })));
  });
}

/** Before any logs are loaded. */
function loadSection(): HTMLElement {
  const input = chatlogInput();
  const saved = state.pendingLogs.length;
  const zone = el(
    'section',
    'vr-drop',
    el('div', 'vr-drop-chests', ...EXPEDITION_IDS.map((id) => chestIcon(CHEST_ICONS[id][0], expeditions[id].chests[0], 3))),
    el('h2', '', 'Add one or more chatlogs to see your records'),
    el(
      'div',
      'vr-drop-buttons',
      saved ? button(reopenLabel(), 'panel-button is-primary vr-choose', () => void reopenLogs()) : null,
      button('Choose chatlogs', `panel-button${saved ? '' : ' is-primary'} vr-choose`, () => chooseLogs(input)),
      saved ? button('Forget them', 'panel-button vr-choose', forgetPendingLogs) : null,
    ),
    input,
  );
  acceptDrops(zone);
  return zone;
}

/** Once logs are loaded, adding more and the list of logs sit in the page's title bar. */
function toolbarContents(): (HTMLElement | null)[] {
  const input = chatlogInput();
  return [
    button('Add chatlogs', 'panel-button is-primary vr-choose', () => chooseLogs(input)),
    input,
    fileList(),
    state.pendingLogs.length ? button(reopenLabel(), 'panel-button vr-choose', () => void reopenLogs()) : null,
    ignorePanel(),
  ];
}

function reopenLabel(): string {
  return `Reopen ${plural(state.pendingLogs.length, 'saved chatlog')}`;
}

function setIgnored(names: string[]): void {
  state.ignored = cleanIgnoreList(names);
  saveIgnored(state.ignored);
  state.openCrew = null;
  state.voyagePage = 0;
  renderPage();
}

/** Tucked behind a small toggle at the end of the title bar, as it is rarely needed. */
function ignorePanel(): HTMLElement {
  const input = el('input', 'vr-ignore-input');
  input.placeholder = 'Pirate name';
  input.setAttribute('aria-label', 'Pirate to ignore');
  const add = el('button', 'panel-button vr-choose', 'Ignore');
  add.type = 'submit';
  const form = el('form', 'vr-ignore-form', input, add);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setIgnored([...state.ignored, ...input.value.split(/[\s,]+/)]);
    document.querySelector<HTMLInputElement>('.vr-ignore-input')?.focus();
  });
  const names = state.ignored.map((name) => {
    const remove = button('×', 'vr-file-remove', () => setIgnored(state.ignored.filter((other) => other !== name)));
    remove.setAttribute('aria-label', `Stop ignoring ${name}`);
    return el('li', 'vr-file', el('span', 'vr-file-name', name), remove);
  });
  const merged = mergeRuns(state.logs.map((log) => log.runs));
  const hidden = merged.length - withoutIgnored(merged, state.ignored).length;
  const details = el(
    'details',
    'vr-ignore',
    el('summary', '', state.ignored.length ? `Ignore list (${state.ignored.length})` : 'Ignore list'),
    el(
      'div',
      'vr-ignore-panel',
      form,
      names.length ? el('ul', 'vr-files', ...names) : null,
      hidden ? el('p', 'vr-ignore-note', `${plural(hidden, 'voyage')} left out of records`) : null,
    ),
  );
  details.open = state.ignoreOpen;
  details.addEventListener('toggle', () => {
    state.ignoreOpen = details.open;
  });
  return details;
}

function fileList(): HTMLElement | null {
  if (!state.logs.length && !state.reading) return null;
  const rows = state.logs.map((log) => {
    const remove = button('×', 'vr-file-remove', () => {
      state.logs = state.logs.filter((other) => other !== log);
      state.openCrew = null;
      state.voyagePage = 0;
      rememberLogs();
      renderPage();
    });
    remove.setAttribute('aria-label', `Remove ${log.name}`);
    remove.title = 'Remove';
    return el(
      'li',
      `vr-file${log.error ? ' is-error' : ''}`,
      el('span', 'vr-file-name', log.name),
      el('span', 'vr-file-note', log.error ?? (log.runs.length ? plural(log.runs.length, 'voyage') : 'No voyages found')),
      remove,
    );
  });
  const reading = state.reading ? el('li', 'vr-file is-reading', `Reading ${plural(state.reading, 'file')}…`) : null;
  return el('ul', 'vr-files', ...rows, reading);
}

function voyagePicker(runs: Run[], selected: ExpeditionId): HTMLElement {
  return el('nav', 'vr-tabs', ...EXPEDITION_IDS.map((id) => {
    const amount = runs.filter((run) => run.expedition === id).length;
    const tab = button(
      el(
        'span',
        'vr-tab-inner',
        chestIcon(CHEST_ICONS[id][0], ''),
        el('span', 'vr-tab-text', el('strong', '', expeditions[id].name), el('small', '', plural(amount, 'voyage'))),
      ),
      `vr-tab${id === selected ? ' is-active' : ''}`,
      () => {
        state.expedition = id;
        state.ocean = null;
        state.openCrew = null;
        state.voyagePage = 0;
        renderPage();
      },
    );
    tab.setAttribute('aria-pressed', String(id === selected));
    return tab;
  }));
}

function oceanPicker(oceans: string[], selected: string): HTMLElement | null {
  if (oceans.length < 2) return null;
  return el('div', 'vr-pills', ...oceans.map((ocean) => {
    const pill = button(oceanName(ocean), `vr-pill${ocean === selected ? ' is-active' : ''}`, () => {
      state.ocean = ocean;
      state.openCrew = null;
      state.voyagePage = 0;
      renderPage();
    });
    pill.setAttribute('aria-pressed', String(ocean === selected));
    return pill;
  }));
}

function itemImage(url: string): HTMLElement {
  const image = el('img', 'vr-familiar');
  image.src = url;
  image.alt = '';
  return image;
}

function tile(label: string, value: string, icon: HTMLElement | null = null): HTMLElement {
  return el(
    'div',
    'vr-tile',
    el('span', 'vr-tile-label', label),
    el('strong', 'vr-tile-value', icon, value),
  );
}

function totalsTile(runs: Run[], id: ExpeditionId): HTMLElement {
  const { chests } = expeditions[id];
  const totals = chests.map((_, tier) => runs.reduce((sum, run) => sum + run.loot[tier], 0));
  return el(
    'div',
    'vr-tile vr-tile-totals',
    el('span', 'vr-tile-label', 'Total chests'),
    el('strong', 'vr-tile-value', ...totals.map((total, tier) =>
      el('span', 'vr-tile-total', chestIcon(CHEST_ICONS[id][tier], chests[tier]), count.format(total)))),
  );
}

function summaryTiles(runs: Run[], id: ExpeditionId): HTMLElement {
  const topChest = expeditions[id].chests[0];
  const share = topChestShare(runs);
  return el(
    'div',
    'vr-tiles',
    totalsTile(runs, id),
    tile(`${topChest} share`, shareFormat.format(share), chestIcon(CHEST_ICONS[id][0], topChest)),
    tile(`Expected ${FAMILIARS[id].name}`, familiarFormat.format(expectedFamiliars(share)), itemImage(FAMILIARS[id].icon)),
    tile('Voyages', count.format(runs.length), itemImage(VOYAGE_ITEMS[id])),
  );
}

function lootRow(run: Run): HTMLElement {
  const { chests } = expeditions[run.expedition];
  return el('span', 'vr-loot', ...run.loot.map((amount, tier) =>
    el(
      'span',
      'vr-loot-item',
      chestIcon(CHEST_ICONS[run.expedition][tier], chests[tier], 1.5),
      count.format(amount),
    )));
}

function resultBadge(run: Run): HTMLElement {
  const tone = run.result === 'Won' ? ' is-good' : run.result === 'Lost' ? ' is-bad' : '';
  return el('span', `vr-result${tone}`, run.result ?? 'Unknown');
}

function fraysWon(run: Run): string {
  return run.expedition === 'woodhallow' ? `${run.fraysWon} of 6` : String(run.fraysWon);
}

function fraysRow(run: Run): HTMLElement | null {
  if (!run.frays.length) return null;
  return el('div', 'vr-frays', ...run.frays.map((fray) => {
    const tone = fray.result === 'Won' ? ' is-good' : fray.result === 'Lost' ? ' is-bad' : '';
    const standing = fray.survivors === null ? '' : `, ${plural(fray.survivors, 'pirate')} standing`;
    const deaths = fray.deaths.length ? `. Fell: ${fray.deaths.join(', ')}` : '';
    const pip = el('span', `vr-fray${tone}`, String(fray.number));
    pip.title = `Fray ${fray.number}: ${fray.result ?? 'unknown'}${standing}${deaths}`;
    return pip;
  }));
}

function runCard(title: string, run: Run): HTMLElement {
  return el(
    'article',
    'vr-run',
    el('header', 'vr-run-head', el('h4', '', title), resultBadge(run)),
    el('p', 'vr-run-date', `${formatDate(run, true)} · ${count.format(run.score)} points · ${fraysWon(run)} frays won`),
    lootRow(run),
    run.players.length
      ? el('ul', 'vr-crew', ...run.players.map((name) => el('li', '', name)))
      : null,
    fraysRow(run),
  );
}

function recordCards(record: CrewRecord): HTMLElement {
  const topChest = expeditions[record.expedition].chests[0].toLowerCase();
  const { maxChests, maxScore } = record;
  return el(
    'div',
    'vr-runs',
    ...(maxChests === maxScore
      ? [runCard(`Best score and most ${topChest}s`, maxScore)]
      : [runCard('Best score', maxScore), runCard(`Most ${topChest}s`, maxChests)]),
  );
}

function namesCell(run: Run, label: string): HTMLElement {
  const cell = el('td', 'vr-names', run.players.join(', ') || 'Names not in the log');
  cell.dataset.label = label;
  return cell;
}

function recordsTable(records: CrewRecord[], id: ExpeditionId): HTMLElement {
  const topChest = expeditions[id].chests[0];
  const head = el(
    'tr',
    '',
    el('th', '', 'Crew size'),
    el('th', 'vr-num', 'Voyages'),
    el('th', 'vr-num', `Most ${topChest.toLowerCase()}s`),
    el('th', 'vr-names-col', 'Pirates'),
    el('th', 'vr-num', 'Best score'),
    el('th', 'vr-names-col', 'Pirates'),
    el('th', 'vr-action'),
  );
  const body = el('tbody');
  for (const record of records) {
    const open = state.openCrew === record.crewSize;
    const toggle = () => {
      state.openCrew = open ? null : record.crewSize;
      renderPage();
    };
    const expand = button(open ? 'Hide' : 'Details', 'vr-expand', toggle);
    expand.setAttribute('aria-expanded', String(open));
    expand.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} details for a crew of ${record.crewSize}`);
    const sameVoyage = record.maxChests === record.maxScore;
    const chestsLabel = `Most ${topChest.toLowerCase()}s`;
    const row = el(
      'tr',
      `vr-row${open ? ' is-open' : ''}`,
      el('td', 'vr-crew-size', String(record.crewSize)),
      el('td', 'vr-num', count.format(record.runs)),
      el(
        'td',
        'vr-num',
        el('strong', 'vr-chest-value', chestIcon(CHEST_ICONS[id][0], topChest, 1.5), count.format(record.maxChests.loot[0])),
        el('small', '', formatDate(record.maxChests)),
      ),
      namesCell(record.maxChests, sameVoyage ? `Best score and ${chestsLabel.toLowerCase()}` : chestsLabel),
      el(
        'td',
        'vr-num',
        el('span', 'vr-score-value', lootRow(record.maxScore), el('strong', '', count.format(record.maxScore.score))),
        el('small', '', formatDate(record.maxScore)),
      ),
      sameVoyage ? el('td', 'vr-names is-same', 'Same voyage') : namesCell(record.maxScore, 'Best score'),
      el('td', 'vr-action', expand),
    );
    row.addEventListener('click', (event) => {
      if (event.target !== expand) toggle();
    });
    body.append(row);
    if (open) {
      const cell = el('td', '', recordCards(record));
      cell.colSpan = 7;
      body.append(el('tr', 'vr-detail', cell));
    }
  }
  return el('div', 'vr-table-wrap', el('table', 'vr-table vr-records', el('thead', '', head), body));
}

/** Red beats a standing shipwide record, yellow ties one. */
function recordClass(against: AgainstRecord | undefined): string {
  if (!against) return '';
  return against.score === 'beat' || against.chests === 'beat' ? 'beats-record' : 'ties-record';
}

function newBestMarks(run: Run, best: NewBest | undefined): HTMLElement | null {
  if (!best) return null;
  const topChest = expeditions[run.expedition].chests[0];
  const star = el('span', 'vr-star', '★');
  star.title = 'New best score';
  star.setAttribute('role', 'img');
  star.setAttribute('aria-label', star.title);
  return el(
    'span',
    'vr-marks',
    best.score ? star : null,
    best.chests ? chestIcon(CHEST_ICONS[run.expedition][0], `New most ${topChest.toLowerCase()}s`, 1.5) : null,
  );
}

function allVoyages(runs: Run[], bests: Map<Run, NewBest>, records: Map<Run, AgainstRecord>): HTMLElement {
  const sorted = [...runs].sort(state.sort === 'score'
    ? (a, b) => b.score - a.score
    : (a, b) => (b.startedAt ?? -Infinity) - (a.startedAt ?? -Infinity));
  const sortPill = (sort: typeof state.sort, label: string) => {
    const pill = button(label, `vr-pill${state.sort === sort ? ' is-active' : ''}`, () => {
      state.sort = sort;
      state.voyagePage = 0;
      renderPage();
    });
    pill.setAttribute('aria-pressed', String(state.sort === sort));
    return pill;
  };
  const pages = Math.ceil(sorted.length / VOYAGES_PER_PAGE);
  const page = Math.min(state.voyagePage, pages - 1);
  const first = page * VOYAGES_PER_PAGE;
  const shown = sorted.slice(first, first + VOYAGES_PER_PAGE);
  const turnPage = (label: string, target: number) => {
    const turn = button(label, 'vr-pill', () => {
      state.voyagePage = target;
      renderPage();
    });
    turn.disabled = target < 0 || target >= pages;
    return turn;
  };
  const pager = pages > 1
    ? el(
        'div',
        'vr-pager',
        turnPage('Previous', page - 1),
        el('span', 'vr-page-label', `${count.format(first + 1)}–${count.format(first + shown.length)} of ${count.format(sorted.length)}`),
        turnPage('Next', page + 1),
      )
    : null;
  const rows = shown.map((run) => el(
    'tr',
    recordClass(records.get(run)),
    el('td', 'vr-date', formatDate(run), newBestMarks(run, bests.get(run))),
    el('td', 'vr-num', run.crewSize === null ? '?' : String(run.crewSize)),
    el('td', 'vr-loot-cell', lootRow(run)),
    el('td', 'vr-num', count.format(run.score)),
    el('td', 'vr-num vr-wide-only', fraysWon(run)),
    el('td', 'vr-num', resultBadge(run)),
    namesCell(run, 'Pirates'),
  ));
  return el(
    'section',
    'vr-section',
    el(
      'header',
      'vr-section-head',
      el('h3', '', 'Every voyage'),
      el('div', 'vr-section-tools', el('div', 'vr-pills', sortPill('newest', 'Newest'), sortPill('score', 'Best score')), pager),
    ),
    el(
      'div',
      'vr-table-wrap',
      el(
        'table',
        'vr-table vr-all',
        el(
          'thead',
          '',
          el(
            'tr',
            '',
            el('th', '', 'Date'),
            el('th', 'vr-num', 'Crew'),
            el('th', 'vr-loot-col', 'Chests aboard'),
            el('th', 'vr-num', 'Score'),
            el('th', 'vr-num vr-wide-only', 'Frays won'),
            el('th', 'vr-num', 'Result'),
            el('th', 'vr-names-col', 'Pirates'),
          ),
        ),
        el('tbody', '', ...rows),
      ),
    ),
  );
}

function resultsSection(): HTMLElement {
  const parsed = state.logs.flatMap((log) => log.runs);
  const runs = mergeRuns(state.logs.map((log) => log.runs));
  if (!runs.length) {
    return el(
      'div',
      'vr-results',
      state.logs.length && !state.reading
        ? el('p', 'vr-empty', 'No voyages found yet. Records come from Woodhallow, Cursed Isles and Vampire Lairs voyages in your logs.')
        : null,
    );
  }

  const id = state.expedition ?? mostCommon(runs.map((run) => run.expedition)) ?? EXPEDITION_IDS[0];
  const voyageRuns = runs.filter((run) => run.expedition === id);
  const oceans = [...new Set(voyageRuns.map(oceanKey))].sort();
  const ocean = state.ocean !== null && oceans.includes(state.ocean)
    ? state.ocean
    : mostCommon(voyageRuns.map(oceanKey)) ?? '';
  const scoped = voyageRuns.filter((run) => oceanKey(run) === ocean);
  // The ignore list only keeps a voyage out of the records: totals and history still count it.
  const counted = withoutIgnored(scoped, state.ignored);
  const records = recordsByCrewSize(counted);
  const noCrew = scoped.filter((run) => run.crewSize === null).length;
  const repeated = parsed.length - runs.length;

  const notes = [
    ...(repeated ? [`${plural(repeated, 'voyage')} seen in more than one log ${repeated === 1 ? 'was' : 'were'} counted once.`] : []),
    ...(noCrew ? [`${plural(noCrew, 'voyage')} without a known crew size ${noCrew === 1 ? 'is' : 'are'} left out of the table.`] : []),
  ];

  return el(
    'div',
    'vr-results',
    el('div', 'vr-pickers', voyagePicker(runs, id), oceanPicker(oceans, ocean)),
    ...(scoped.length
      ? [
          summaryTiles(scoped, id),
          el(
            'section',
            'vr-section',
            el('header', 'vr-section-head', el('h3', '', 'Records by crew size')),
            records.length ? recordsTable(records, id) : null,
            notes.length ? el('p', 'vr-notes', notes.join(' ')) : null,
          ),
          allVoyages(scoped, personalBests(counted), againstRecords(scoped)),
        ]
      : [el('p', 'vr-empty', `No ${expeditions[id].name} voyages in these logs. If you've sailed one, add the log from the folder the game saves to now, as older logs may stop before it.`)]),
  );
}

export function showVoyageRecords(app: HTMLElement): void {
  document.title = 'Voyage Records · Puzzle Practice';
  const content = el('main', 'vr');
  const toolbar = el('div', 'vr-toolbar');
  acceptDrops(toolbar);
  renderPage = () => {
    if (!content.isConnected) return;
    const loaded = state.logs.length > 0 || state.reading > 0;
    toolbar.replaceChildren(...(loaded ? toolbarContents() : []).filter((node) => node !== null));
    content.replaceChildren(loaded ? resultsSection() : loadSection());
  };
  void restoreLogs();
  const back = el('a', 'back', '← All puzzles');
  back.href = '#/';
  app.replaceChildren(
    el('header', 'bar', back, el('h1', '', 'Voyage Records'), toolbar),
    content,
    el('footer', 'about', el('p', 'credits', 'Based on Puzzle Pirates, created by Three Rings Design and now operated by Grey Havens.')),
  );
  renderPage();
}
