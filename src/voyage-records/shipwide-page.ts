// The Records page: every standing shipwide record for Woodhallow, Cursed Isles and Vampire Lairs,
// with screenshots kept in this repository rather than on image hosts.
import { CHEST_ICONS, chestIcon } from './page';
import { expeditions, type ExpeditionId } from './records';
import { crewSizeRows, oceansFor, otherCategories, sheetFetched, sheetSources, type CrewSizeRow, type SheetRecord } from './shipwide';

const VOYAGES = Object.keys(expeditions) as ExpeditionId[];
const count = new Intl.NumberFormat();
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });

const state = { voyage: 'woodhallow' as ExpeditionId, ocean: null as string | null };
let renderPage = () => {};

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

function formatDate(date: string | undefined): string {
  return date ? dateFormat.format(new Date(`${date}T00:00:00Z`)) : '';
}

/** A thumbnail that opens the full screenshot; a link to the old host when there's no local copy yet. */
function outLink(label: string, url: string, className: string): HTMLAnchorElement {
  const link = el('a', className, label);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.title = url;
  return link;
}

/**
 * A thumbnail that opens the full screenshot. Until the screenshot is saved here, the cell links to where
 * it was hosted instead, so dropping the file into public/voyage-records/screenshots is all it takes.
 */
function screenshotCell(screenshot: string | undefined, url: string | undefined, label: string, video?: string, more: string[] = []): HTMLElement {
  const cell = el('td', 'rp-shot');
  const fallback = () => (url ? outLink('Not saved yet', url, 'rp-missing') : el('span', 'rp-none', '—'));
  if (video) cell.append(outLink('Video', video, 'rp-video'));
  else if (screenshot) {
    const img = el('img');
    img.alt = label;
    img.loading = 'lazy';
    const thumb = button(img, 'rp-thumb', () => openViewer(screenshot, label));
    img.addEventListener('error', () => thumb.replaceWith(fallback()));
    img.src = screenshot;
    const extras = more.map((src, index) => button(`+${index + 1}`, 'rp-more', () => openViewer(src, `${label} (${index + 2})`)));
    cell.append(extras.length ? el('div', 'rp-shots', thumb, ...extras) : thumb);
  } else cell.append(fallback());
  return cell;
}

function piratesCell(pirates: string[] | undefined): HTMLElement {
  if (!pirates?.length) return el('td', 'rp-pirates', el('span', 'rp-none', '—'));
  if (pirates.length <= 12) return el('td', 'rp-pirates', pirates.join(', '));
  const details = el('details', '', el('summary', '', `${pirates.length} pirates`), pirates.join(', '));
  return el('td', 'rp-pirates', details);
}

let viewer: HTMLDialogElement | null = null;
function openViewer(src: string, label: string): void {
  viewer?.remove();
  const img = el('img');
  img.src = src;
  img.alt = label;
  const open = el('a', 'panel-button', 'Open full size');
  open.href = src;
  open.target = '_blank';
  const dialog = el('dialog', 'rp-viewer', el('div', 'rp-viewer-bar', el('span', '', label), open, button('Close', 'panel-button', () => dialog.close())), img);
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  viewer = dialog;
  dialog.showModal();
}

function crewSizeSection(voyage: ExpeditionId, rows: CrewSizeRow[]): HTMLElement {
  const [topChest] = expeditions[voyage].chests;
  const body = rows.map(({ crewSize, score, chests }) => el(
      'tr',
      '',
      el('td', 'rp-crew', String(crewSize)),
      el('td', 'vr-num', score ? count.format(score.value) : '—'),
      el('td', 'rp-date', formatDate(score?.date)),
      piratesCell(score?.pirates),
      screenshotCell(score?.screenshot, score?.screenshotUrl, `${crewSize} pirates, best score ${score?.value ?? ''}`, undefined, score?.more),
      el('td', 'vr-num rp-split', chests ? count.format(chests.value) : '—'),
      el('td', 'rp-date', formatDate(chests?.date)),
      piratesCell(chests?.pirates),
      screenshotCell(chests?.screenshot, chests?.screenshotUrl, `${crewSize} pirates, most ${topChest.toLowerCase()}s ${chests?.value ?? ''}`, undefined, chests?.more),
    ));
  return el(
    'section',
    'vr-section',
    el('header', 'vr-section-head', el('h3', '', 'By crew size')),
    el(
      'div',
      'vr-table-wrap',
      el(
        'table',
        'vr-table rp-table',
        el(
          'thead',
          '',
          el(
            'tr',
            '',
            el('th', '', 'Crew'),
            el('th', 'vr-num', 'Best score'),
            el('th', '', 'Date'),
            el('th', '', 'Pirates'),
            el('th', '', ''),
            el('th', 'vr-num rp-split', `Most ${topChest.toLowerCase()}s`),
            el('th', '', 'Date'),
            el('th', '', 'Pirates'),
            el('th', '', ''),
          ),
        ),
        el('tbody', '', ...body),
      ),
    ),
  );
}

function categorySection(category: string, records: SheetRecord[]): HTMLElement {
  const hasCrew = records.some((record) => record.crewSize !== undefined);
  const hasNotes = records.some((record) => record.notes);
  const rows = records.map((record) => el(
    'tr',
    '',
    hasCrew ? el('td', 'rp-crew', record.crewSize === undefined ? 'Any' : String(record.crewSize)) : null,
    el('td', 'rp-value', record.value),
    el('td', 'rp-date', formatDate(record.date)),
    piratesCell(record.pirates),
    hasNotes ? el('td', 'rp-notes', record.notes ?? '') : null,
    screenshotCell(record.screenshot, record.screenshotUrl, `${category}: ${record.value}`, record.videoUrl, record.more),
  ));
  return el(
    'section',
    'vr-section',
    el('header', 'vr-section-head', el('h3', '', category)),
    el(
      'div',
      'vr-table-wrap',
      el(
        'table',
        'vr-table rp-table',
        el(
          'thead',
          '',
          el(
            'tr',
            '',
            hasCrew ? el('th', '', 'Crew') : null,
            el('th', '', 'Record'),
            el('th', '', 'Date'),
            el('th', '', 'Pirates'),
            hasNotes ? el('th', '', 'Notes') : null,
            el('th', '', ''),
          ),
        ),
        el('tbody', '', ...rows),
      ),
    ),
  );
}

function voyageTabs(): HTMLElement {
  return el('nav', 'vr-tabs', ...VOYAGES.map((id) => {
    const tab = button(
      el('span', 'vr-tab-inner', chestIcon(CHEST_ICONS[id][0], ''), el('span', 'vr-tab-text', el('strong', '', expeditions[id].name))),
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
  if (!sources.length) return el('p', 'vr-notes', 'Woodhallow records come from crews’ chatlogs. Send a new one in with the Export records button on the Voyage Records page.');
  const links = sources.flatMap((source, index) => {
    const link = el('a', '', source.name);
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    return index ? [', ', link] : [link];
  });
  const when = sheetFetched ? ` Copied ${formatDate(sheetFetched.slice(0, 10))}.` : '';
  return el('p', 'vr-notes', 'From the ', ...links, ' sheet, with the screenshots saved here.', when);
}

export function showShipwideRecords(app: HTMLElement): void {
  document.title = 'Records · Puzzle Practice';
  const content = el('main', 'vr rp');
  renderPage = () => {
    if (!content.isConnected) return;
    const oceans = oceansFor(state.voyage);
    const ocean = state.ocean && oceans.includes(state.ocean) ? state.ocean : oceans.includes('emerald') ? 'emerald' : oceans[0];
    const sections: HTMLElement[] = [];
    if (ocean) {
      const rows = crewSizeRows(state.voyage, ocean);
      if (rows.length) sections.push(crewSizeSection(state.voyage, rows));
      for (const [category, records] of otherCategories(state.voyage, ocean)) sections.push(categorySection(category, records));
    }
    content.replaceChildren(
      voyageTabs(),
      ...(ocean ? [oceanPills(oceans, ocean)].filter((node) => node !== null) : []),
      sourceNote(state.voyage),
      ...(sections.length ? sections : [el('p', 'vr-empty', 'No records yet.')]),
    );
  };
  const back = el('a', 'back', '← All puzzles');
  back.href = '#/';
  const mine = el('a', 'panel-button', 'Your records');
  mine.href = '#/voyage-records';
  app.replaceChildren(
    el('header', 'bar', back, el('h1', '', 'Shipwide Records'), mine),
    content,
    el('footer', 'about', el('p', 'credits', 'Based on Puzzle Pirates, created by Three Rings Design and now operated by Grey Havens.')),
  );
  renderPage();
}
