// Global records: every standing record for Woodhallow, Cursed Isles and Vampire Lairs, with screenshots
// kept in this repository rather than on image hosts.
// Crew-size records sit in one table with a column per record, each with who holds it.
// Everything else goes in one table of other records, with tied holders on one line.
import { CHEST_ICONS, FAMILIARS, VOYAGE_ITEMS, chestIcon, itemImage, tile } from './page';
import { expeditions, type ExpeditionId } from './records';
import { knownRecords } from './known-records';
import { crewSizeRows, oceansFor, otherCategories, sheetFetched, sheetRecords, sheetSources, type SheetRecord } from './shipwide';
import { recordsSwitch } from './switch';

const VOYAGES = Object.keys(expeditions) as ExpeditionId[];
const count = new Intl.NumberFormat();
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
const shortDateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
/** Longer lists of names are tucked away whole, behind one "N pirates" toggle, rather than cut short. */
const NAMES_SHOWN = 12;
/** Crews bigger than this are tucked behind a Show button in the crew-size table, and left out of the headline tiles. */
const BIG_CREW = 12;

const state = { voyage: 'woodhallow' as ExpeditionId, ocean: null as string | null };
let renderPage = () => {};

/** One record as the page shows it, whichever table it came from. */
interface Cell {
  label: string;
  value: string;
  date?: string;
  pirates?: string[];
  pirateScores?: number[];
  everyone?: string[];
  notes?: string;
  screenshot?: string;
  screenshotUrl?: string;
  more?: string[];
  videoUrl?: string;
}

interface Column {
  label: string;
  cells: Map<number, Cell>;
}

/** Shorter headings for the crew-size table, where space is tight. */
const SHORT_LABELS: Record<string, string> = {
  'Best score in one duty report': 'Best duty report',
  'Most cursed chests in one forage': 'Most in one forage',
  'Most cursed chests in one forage, cursed chests only': 'Most in one forage, cursed chests only',
  'Most frays in one entry': 'Frays in one entry',
};
const POINTS_PER_FORAGE = 'Most points in one forage, one pirate';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
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

function oceanName(key: string): string {
  return `${key[0].toUpperCase()}${key.slice(1)}`;
}

function formatDate(date: string | undefined, short = false): string {
  return date ? (short ? shortDateFormat : dateFormat).format(new Date(`${date}T00:00:00Z`)) : '';
}

/** A category name, with the 🎁 the Vampire sheet uses swapped for the three lair chests. */
function labelNode(text: string, voyage: ExpeditionId): Node {
  if (!text.includes('🎁')) return document.createTextNode(text);
  const [before, after] = text.split('🎁');
  const chests = el('span', 'rp-label-chests', ...CHEST_ICONS[voyage].map((name, index) => chestIcon(name, expeditions[voyage].chests[index], 1)));
  return el('span', 'rp-label', before, chests, after);
}

/** A small symbol for each kind of record, so the tables scan at a glance. */
function categoryIcon(label: string, voyage: ExpeditionId): HTMLElement | null {
  const emoji = (symbol: string) => el('span', 'rp-symbol', symbol);
  if (label.includes('🎁')) return null;
  if (/immortal|chest|forage/i.test(label)) return chestIcon(CHEST_ICONS[voyage][0], expeditions[voyage].chests[0], 1);
  if (/fray/i.test(label)) return emoji('⚔️');
  if (/duty report/i.test(label)) return emoji('📜');
  if (/carpentry|holes/i.test(label)) return emoji('🔨');
  if (/proof/i.test(label)) return emoji('🛡️');
  if (/fastest|time/i.test(label)) return emoji('⏱️');
  if (/score/i.test(label)) return emoji('🏆');
  return emoji('🏅');
}

/** A record's heading with its symbol in front. */
function headingNode(label: string, voyage: ExpeditionId): HTMLElement {
  return el('span', 'rp-heading', categoryIcon(label, voyage), labelNode(label, voyage));
}

function outLink(label: string, url: string, className: string): HTMLAnchorElement {
  const link = el('a', className, label);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.title = url;
  return link;
}

let viewer: HTMLDialogElement | null = null;

interface Shot {
  src: string;
  label: string;
}

/** A screenshot viewer that steps through every screenshot of a record, with the arrow keys too. */
function openViewer(shots: Shot[], start: number): void {
  viewer?.remove();
  let index = start;
  const img = el('img');
  const caption = el('span');
  const open = el('a', 'panel-button', 'Open full size');
  open.target = '_blank';
  const step = (by: number) => {
    index = (index + by + shots.length) % shots.length;
    show();
  };
  const previous = button('‹', 'panel-button rp-step', () => step(-1));
  const next = button('›', 'panel-button rp-step', () => step(1));
  previous.setAttribute('aria-label', 'Previous screenshot');
  next.setAttribute('aria-label', 'Next screenshot');
  const show = () => {
    const shot = shots[index];
    img.src = shot.src;
    img.alt = shot.label;
    open.href = shot.src;
    caption.textContent = shots.length > 1 ? `${shot.label} · ${index + 1} of ${shots.length}` : shot.label;
  };
  const stepper = shots.length > 1 ? [previous, next] : [];
  const dialog = el('dialog', 'rp-viewer', el('div', 'rp-viewer-bar', caption, ...stepper, open, button('Close', 'panel-button', () => dialog.close())), img);
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
  });
  dialog.addEventListener('close', () => dialog.remove());
  show();
  document.body.append(dialog);
  viewer = dialog;
  dialog.showModal();
}

/** A small picture icon, drawn inline so it follows the text colour. */
function imageIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="5.5" cy="6.5" r="1.3" fill="currentColor"/><path d="M2.5 12l3.8-3.8 2.7 2.7 1.8-1.8 2.7 2.9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>';
  return svg;
}

/**
 * A record's proof: a small image icon, with a count when there are several, which opens a viewer that
 * steps through them. A screenshot not saved here yet links to where it was hosted instead.
 */
function proof(cells: Cell[]): HTMLElement {
  const box = el('div', 'rp-shots');
  const shots: Shot[] = [];
  const links: HTMLElement[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    const label = `${cell.label}: ${cell.value}${cell.pirates?.length ? ` (${cell.pirates.join(', ')})` : ''}`;
    if (cell.videoUrl) {
      if (!seen.has(cell.videoUrl)) links.push(outLink('Video', cell.videoUrl, 'rp-video'));
      seen.add(cell.videoUrl);
    } else if (cell.screenshot) {
      for (const src of [cell.screenshot, ...(cell.more ?? [])]) {
        if (!seen.has(src)) shots.push({ src, label });
        seen.add(src);
      }
    } else if (cell.screenshotUrl) {
      links.push(outLink('Not saved yet', cell.screenshotUrl, 'rp-missing'));
    }
  }
  if (shots.length) {
    const open = button(imageIcon(), 'rp-proof', () => openViewer(shots, 0));
    const what = shots.length > 1 ? `${shots.length} screenshots` : 'Screenshot';
    open.title = what;
    open.setAttribute('aria-label', `${what}: ${shots[0].label}`);
    if (shots.length > 1) open.append(el('span', 'rp-proof-count', String(shots.length)));
    box.append(open);
  }
  box.append(...(shots.length ? links.filter((link) => link.classList.contains('rp-video')) : links));
  if (!box.childElementCount) box.remove();
  return box;
}

/** Names on one line, each with their share where the sheet gives one; a list of more than 12 opens on a click. */
function names(pirates: string[] = [], scores: number[] = [], everyone: string[] = []): HTMLElement {
  const name = (pirate: string, index: number) =>
    el('span', 'rp-name', pirate, scores[index] === undefined ? null : el('span', 'rp-share', ` ${scores[index]}`));
  const list = el('span', 'rp-names', ...pirates.flatMap((pirate, index) => (index ? [', ', name(pirate, index)] : [name(pirate, index)])));
  if (!pirates.length) list.append(el('span', 'rp-none', '—'));
  const line = pirates.length > NAMES_SHOWN ? el('details', 'rp-extra', el('summary', '', `${pirates.length} pirates`), list) : list;
  const others = everyone.filter((pirate) => !pirates.includes(pirate));
  if (!others.length) return line;
  return el('div', 'rp-names-wrap', line, el('details', 'rp-extra', el('summary', '', `Joint record holders (${everyone.length})`), everyone.join(', ')));
}

function toCell(label: string, record: SheetRecord): Cell {
  return { ...record, label };
}

/** A column per record kept by crew size: best score and most top chests, then each sheet category. */
function crewColumns(voyage: ExpeditionId, ocean: string): Column[] {
  const [topChest] = expeditions[voyage].chests;
  const score: Column = { label: 'Best score', cells: new Map() };
  const chests: Column = { label: `Most ${topChest.toLowerCase()}s`, cells: new Map() };
  for (const row of crewSizeRows(voyage, ocean)) {
    for (const [column, record] of [[score, row.score], [chests, row.chests]] as const) {
      if (record) {
        column.cells.set(row.crewSize, {
          label: column.label,
          value: count.format(record.value),
          date: record.date,
          pirates: record.pirates,
          screenshot: record.screenshot,
          screenshotUrl: record.screenshotUrl,
          more: record.more,
        });
      }
    }
  }
  const columns = [score, chests].filter((column) => column.cells.size);
  for (const [category, records] of otherCategories(voyage, ocean)) {
    const byCrew = records.filter((record) => record.crewSize !== undefined);
    if (!byCrew.length || byCrew.length < records.length) continue;
    const label = SHORT_LABELS[category] ?? category;
    columns.push({ label, cells: new Map(byCrew.map((record) => [record.crewSize!, toCell(label, record)])) });
  }
  return columns;
}

function crewTable(voyage: ExpeditionId, columns: Column[]): HTMLElement {
  const sizes = [...new Set(columns.flatMap((column) => [...column.cells.keys()]))].sort((a, b) => a - b);
  const row = (crew: number) => el(
    'tr',
    '',
    el('td', 'rp-crew', el('span', 'rp-crew-size', String(crew)), el('small', '', crew === 1 ? 'pirate' : 'pirates')),
    ...columns.map((column) => {
      const cell = column.cells.get(crew);
      if (!cell) return el('td', 'rp-cell rp-none', '—');
      return el(
        'td',
        'rp-cell',
        el('div', 'rp-cell-head', el('strong', 'rp-cell-value', cell.value), proof([cell]), cell.date ? el('span', 'rp-cell-date', formatDate(cell.date, true)) : null),
        names(cell.pirates, cell.pirateScores, cell.everyone),
        cell.notes ? el('small', 'rp-notes', cell.notes) : null,
      );
    }),
  );
  const big = sizes.filter((crew) => crew > BIG_CREW);
  const bigRows = el('tbody', 'rp-big-crews', ...big.map(row));
  bigRows.hidden = true;
  const toggleLabel = () => `${bigRows.hidden ? 'Show' : 'Hide'} ${big.length} larger crew${big.length === 1 ? '' : 's'} (${BIG_CREW + 1} to ${big[big.length - 1]} pirates)`;
  const toggle = button('', 'vr-pill rp-big-toggle', () => {
    bigRows.hidden = !bigRows.hidden;
    toggle.textContent = toggleLabel();
    toggle.setAttribute('aria-expanded', String(!bigRows.hidden));
  });
  toggle.textContent = toggleLabel();
  toggle.setAttribute('aria-expanded', 'false');
  const toggleRow = el('tbody', '', el('tr', '', Object.assign(el('td', 'rp-big-cell', toggle), { colSpan: columns.length + 1 })));
  const rows = [el('tbody', '', ...sizes.filter((crew) => crew <= BIG_CREW).map(row)), ...(big.length ? [toggleRow, bigRows] : [])];
  return el(
    'section',
    'vr-section',
    el('header', 'vr-section-head', el('h3', '', 'By crew size')),
    el(
      'div',
      'vr-table-wrap',
      el(
        'table',
        `vr-table rp-table rp-crew-table${columns.length < 3 ? ' is-narrow' : ''}`,
        el('thead', '', el('tr', '', el('th', '', 'Crew'), ...columns.map((column) => el('th', 'rp-cell', headingNode(column.label, voyage))))),
        ...rows,
      ),
    ),
  );
}

/** Records not kept by crew size, one row each; holders who tie share the row. */
function otherTable(voyage: ExpeditionId, categories: [string, SheetRecord[]][]): HTMLElement | null {
  const rows: HTMLElement[] = [];
  for (const [category, records] of categories) {
    const groups = new Map<string, SheetRecord[]>();
    for (const record of records) {
      const key = `${record.value}|${record.notes ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }
    const label = category.replace(/, one pirate$/, '');
    for (const tied of groups.values()) {
      const [first] = tied;
      const pirates = tied.flatMap((record) => record.pirates ?? []);
      rows.push(el(
        'tr',
        '',
        el('td', 'rp-record', headingNode(label, voyage)),
        el('td', 'rp-value', el('strong', '', first.value), tied.length > 1 ? el('span', 'vr-record-badge rp-tie', `${tied.length}-way tie`) : null),
        el('td', 'rp-pirates', names(pirates, tied.length === 1 ? first.pirateScores : [], first.everyone), first.notes ? el('small', 'rp-notes', first.notes) : null),
        el('td', 'rp-date', formatDate(first.date)),
        el('td', 'rp-shot', proof(tied.map((record) => toCell(category, record)))),
      ));
    }
  }
  if (!rows.length) return null;
  return el(
    'section',
    'vr-section',
    el('header', 'vr-section-head', el('h3', '', 'Other records')),
    el(
      'div',
      'vr-table-wrap',
      el(
        'table',
        'vr-table rp-table',
        el('thead', '', el('tr', '', el('th', '', 'Record'), el('th', '', 'Best'), el('th', '', 'Held by'), el('th', '', 'Date'), el('th', '', ''))),
        el('tbody', '', ...rows),
      ),
    ),
  );
}

/** Cursed Isles keeps the best single forage for each forage of the voyage: a small grid reads better than a table. */
function forageGrid(records: SheetRecord[]): HTMLElement {
  const tiles = records
    .map((record) => ({ record, number: Number(record.notes?.replace(/\D/g, '') ?? 0) }))
    .sort((a, b) => a.number - b.number)
    .map(({ record, number }) => el(
      'div',
      'rp-forage',
      el('span', 'rp-forage-number', `Forage ${number}`),
      el('strong', 'rp-forage-value', record.value),
      el('span', 'rp-forage-name', record.pirates?.join(', ') ?? '', proof([toCell(`Forage ${number}`, record)])),
    ));
  return el(
    'section',
    'vr-section',
    el('header', 'vr-section-head', el('h3', '', 'Most points in one forage')),
    el('div', 'rp-forages', ...tiles),
  );
}

function recordCount(voyage: ExpeditionId): number {
  return knownRecords.filter((record) => record.voyage === voyage).length + sheetRecords.filter((record) => record.voyage === voyage).length;
}

function voyageTabs(): HTMLElement {
  return el('nav', 'vr-tabs', ...VOYAGES.map((id) => {
    const amount = recordCount(id);
    const tab = button(
      el(
        'span',
        'vr-tab-inner',
        chestIcon(CHEST_ICONS[id][0], ''),
        el('span', 'vr-tab-text', el('strong', '', expeditions[id].name), el('small', '', `${count.format(amount)} record${amount === 1 ? '' : 's'}`)),
      ),
      `vr-tab${id === state.voyage ? ' is-active' : ''}`,
      () => {
        state.voyage = id;
        state.ocean = null;
        renderPage();
      },
    );
    tab.setAttribute('aria-pressed', String(id === state.voyage));
    return tab;
  }));
}

/** The headline records for a voyage, in the same tiles My records uses. */
function summaryTiles(voyage: ExpeditionId, ocean: string): HTMLElement {
  const rows = crewSizeRows(voyage, ocean).filter((row) => row.crewSize <= BIG_CREW);
  const topChest = expeditions[voyage].chests[0];
  const best = (kind: 'score' | 'chests') => rows.map((row) => row[kind]).filter((record) => record !== undefined).sort((a, b) => b.value - a.value)[0];
  const withNote = (node: HTMLElement, note: string) => {
    if (note) node.append(el('span', 'vr-tile-note', note));
    return node;
  };
  const crewNote = (record?: { crewSize: number }) => (record ? `${record.crewSize} pirate crew` : '');
  const chests = best('chests');
  const score = best('score');
  const holders = new Map<string, number>();
  const sheet = sheetRecords.filter((record) => record.voyage === voyage && record.ocean === ocean);
  for (const record of [...rows.flatMap((row) => [row.score, row.chests]), ...sheet]) {
    for (const pirate of new Set(record?.pirates ?? [])) holders.set(pirate, (holders.get(pirate) ?? 0) + 1);
  }
  const [leader, held] = [...holders].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? ['—', 0];
  return el(
    'div',
    'vr-tiles',
    withNote(tile(`Most ${topChest.toLowerCase()}s`, chests ? count.format(chests.value) : '—', chestIcon(CHEST_ICONS[voyage][0], topChest)), crewNote(chests)),
    withNote(tile('Best score', score ? count.format(score.value) : '—', itemImage(VOYAGE_ITEMS[voyage])), crewNote(score)),
    withNote(tile('Record holders', count.format(holders.size), itemImage(FAMILIARS[voyage].icon)), 'pirates on the board'),
    withNote(tile('Most records held', leader, el('span', 'rp-tile-symbol', '👑')), held ? `${held} records` : ''),
  );
}

function oceanPills(oceans: string[], selected: string): HTMLElement | null {
  if (oceans.length < 2) return null;
  return el('div', 'vr-pills', ...oceans.map((ocean) => {
    const pill = button(oceanName(ocean), `vr-pill${ocean === selected ? ' is-active' : ''}`, () => {
      state.ocean = ocean;
      renderPage();
    });
    pill.setAttribute('aria-pressed', String(ocean === selected));
    return pill;
  }));
}

function sourceNote(voyage: ExpeditionId): HTMLElement {
  const sources = sheetSources.filter((source) => source.voyage === voyage);
  if (!sources.length) return el('p', 'vr-notes', 'Woodhallow records come from crews’ chatlogs. Send yours in with the Export records button under My records.');
  const links = sources.flatMap((source, index) => {
    const link = el('a', '', source.name);
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    return index ? [', ', link] : [link];
  });
  const when = sheetFetched ? ` Copied ${formatDate(sheetFetched.slice(0, 10))}.` : '';
  return el('p', 'vr-notes', 'From the ', ...links, ' sheet.', when);
}

export function showShipwideRecords(app: HTMLElement): void {
  document.title = 'Global records · Voyage Records · Puzzle Practice';
  const content = el('main', 'vr rp');
  renderPage = () => {
    if (!content.isConnected) return;
    const oceans = oceansFor(state.voyage);
    const ocean = state.ocean && oceans.includes(state.ocean) ? state.ocean : oceans.includes('emerald') ? 'emerald' : oceans[0];
    const sections: (HTMLElement | null)[] = [];
    if (ocean) {
      const columns = crewColumns(state.voyage, ocean);
      if (columns.length) sections.push(crewTable(state.voyage, columns));
      const rest = [...otherCategories(state.voyage, ocean)].filter(([, records]) => records.some((record) => record.crewSize === undefined));
      sections.push(otherTable(state.voyage, rest.filter(([category]) => category !== POINTS_PER_FORAGE)));
      const forages = rest.find(([category]) => category === POINTS_PER_FORAGE);
      if (forages) sections.push(forageGrid(forages[1]));
    }
    const shown = sections.filter((section) => section !== null);
    content.replaceChildren(
      el('div', 'vr-pickers', voyageTabs(), ocean ? oceanPills(oceans, ocean) : null),
      ...(ocean ? [summaryTiles(state.voyage, ocean)] : []),
      sourceNote(state.voyage),
      ...(shown.length ? shown : [el('p', 'vr-empty', 'No records yet.')]),
    );
  };
  const back = el('a', 'back', '← All puzzles');
  back.href = '#/';
  app.replaceChildren(
    el('header', 'bar', back, el('h1', '', 'Voyage Records'), recordsSwitch('global'), el('div', 'vr-toolbar')),
    content,
    el('footer', 'about', el('p', 'credits', 'Based on Puzzle Pirates, created by Three Rings Design and now operated by Grey Havens.')),
  );
  renderPage();
}
