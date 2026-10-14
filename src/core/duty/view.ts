// Draws a duty report the way the game lays out a pirate's entry: the station heading with its
// icon and a rule, then the face with the rating's expression, the name, the rating in yellow and
// stacks of what they cleared. The game's totals for the whole crew are left out: it's one pirate.
// Also the pirate settings card: name and face, shown on every puzzle's Settings tab.
import type { Group, Page } from '../panel';
import { drawFaceInto, faceOptions, FACE, type FaceSpec } from './face';
import { ICONS, iconWidth, loadIcon, stationIcon, type Icon } from './icons';
import { loadProfile, NAME_LIMIT, saveProfile, type PirateProfile } from './profile';
import { LEARNING, moodFor, MOODS, performanceWord } from './ratings';
import { SPACE, type ClearedGroup, type DutyReport } from './report';
import { Store } from '../storage';
import { fillStatCell, type StatRows } from '../stat-cell';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** The game's bonus panels wrap their stacks at this width. */
const STACK_WIDTH = 100;
/** Each extra copy in a stack shows this much more of itself. */
const STEP = 2;
/** Rows of a stack drawn; the totals give the exact numbers. */
const STACK_ROWS = 4;

/**
 * How the game's bonus panel splits counts into rows of overlapping tiles no wider than 100px:
 * each row lists how many of each kind it shows. A kind too many to fit on one row is split.
 */
export function stackRows(counts: readonly number[], tile: number): number[][] {
  const rows: number[][] = [];
  let row = counts.map(() => 0);
  rows.push(row);
  let used = 0;
  let i = 0;
  let left = counts[0] ?? 0;
  while (i < counts.length) {
    if (left <= 0) {
      if (++i < counts.length) left = counts[i];
      continue;
    }
    const need = tile + STEP * (left - 1);
    if (need > STACK_WIDTH) {
      const fit = Math.trunc((STACK_WIDTH - tile - used) / STEP) + 1;
      if (fit > 0) {
        row[i] += fit;
        left -= fit;
      }
      row = counts.map(() => 0);
      rows.push(row);
      used = 0;
    } else if (need + used > STACK_WIDTH) {
      row = counts.map(() => 0);
      rows.push(row);
      used = 0;
    } else {
      used += need + STEP;
      row[i] = left;
      if (++i < counts.length) left = counts[i];
    }
  }
  return rows.filter((r, index) => index === 0 || r.some((n) => n > 0));
}

/** One cleared group as the game's overlapping stacks, drawn at 2x. */
function stackCanvas(group: ClearedGroup): HTMLCanvasElement | null {
  const icons = group.items.map((item) => ICONS[item.icon] ?? null);
  if (!group.items.some((item) => item.count > 0) || icons.some((icon) => !icon)) return null;
  const tile = Math.max(...icons.map((icon) => iconWidth(icon!)));
  const height = Math.max(...icons.map((icon) => icon!.height));
  const rows = stackRows(group.items.map((item) => item.count), tile).slice(0, STACK_ROWS);
  const canvas = el('canvas', 'duty-stack');
  canvas.width = STACK_WIDTH;
  canvas.height = (height + 2) * rows.length - 2;
  canvas.title = `${group.label}: ${group.items.filter((i) => i.count).map((i) => `${i.count} ${i.label}`).join(', ')}`;
  void Promise.all(icons.map((icon) => loadIcon(icon!.url))).then((images) => {
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    let y = 0;
    for (const row of rows) {
      let x = 0;
      row.forEach((n, i) => {
        const icon = icons[i]!;
        const img = images[i];
        const w = iconWidth(icon);
        for (let k = 0; k < n; k++) {
          if (img) ctx.drawImage(img, ...icon.area, Math.floor(x), y + height - icon.height, w, icon.height);
          x += STEP;
        }
        if (n > 0) x += w;
      });
      y += height + 2;
    }
  });
  return canvas;
}

function iconImage(icon: Icon, scale = 2): HTMLCanvasElement {
  const canvas = el('canvas', 'duty-icon');
  const w = iconWidth(icon);
  canvas.width = w;
  canvas.height = icon.height;
  canvas.style.width = `${w * scale}px`;
  canvas.style.height = `${icon.height * scale}px`;
  void loadIcon(icon.url).then((img) => {
    if (!img) return;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, ...icon.area, 0, 0, w, icon.height);
  });
  return canvas;
}

/** A pirate's face on a canvas, drawn when its layers have loaded. */
export function faceCanvas(face: FaceSpec, mood: Parameters<typeof drawFaceInto>[2] = 'normal', className = 'duty-face'): HTMLCanvasElement {
  const canvas = el('canvas', className);
  canvas.width = FACE;
  canvas.height = FACE;
  void drawFaceInto(canvas, face, mood);
  return canvas;
}

/** Which folds of a report the player last had open, the same for every puzzle. */
const prefs = new Store('global');
type Fold = 'details' | 'averages';
const foldOpen = (fold: Fold) => prefs.get<Partial<Record<Fold, boolean>>>('reportFolds', {})[fold] ?? false;
function setFoldOpen(fold: Fold, open: boolean): void {
  prefs.set('reportFolds', { ...prefs.get<Partial<Record<Fold, boolean>>>('reportFolds', {}), [fold]: open });
}

export function foldTable(fold: Fold, title: string, rows: StatRows): HTMLElement {
  const box = el('details', `duty-fold duty-${fold}`);
  box.open = foldOpen(fold);
  box.addEventListener('toggle', () => { if (box.isConnected) setFoldOpen(fold, box.open); });
  box.append(el('summary', '', title));
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
  box.append(table);
  return box;
}

/** A row-style group: overlapping icons in order, with gaps only where the items say. */
function rowCanvas(group: ClearedGroup): HTMLCanvasElement | null {
  const rowStep = 3;
  const items = group.items.filter((item) => item.count > 0);
  if (!items.some((item) => item.icon !== SPACE)) return null;
  const icons = items.map((item) => (item.icon === SPACE ? null : ICONS[item.icon] ?? null));
  if (items.some((item, i) => item.icon !== SPACE && !icons[i])) return null;
  const height = Math.max(...icons.map((icon) => icon?.height ?? 0));
  const gap = Math.max(3, Math.round(height / 2));
  // Lay out the orbs, wrapping at the stack width.
  const placed: Array<{ icon: Icon; x: number; y: number }> = [];
  let x = 0;
  let y = 0;
  let lastWidth = 0;
  items.forEach((item, i) => {
    const icon = icons[i];
    for (let k = 0; k < item.count; k++) {
      if (!icon) { x += Math.max(0, lastWidth - rowStep) + gap; lastWidth = 0; continue; }
      const w = iconWidth(icon);
      if (x + w > STACK_WIDTH) { x = 0; y += height + 1; }
      placed.push({ icon, x, y });
      x += rowStep;
      lastWidth = w;
    }
  });
  const canvas = el('canvas', 'duty-stack');
  canvas.width = STACK_WIDTH;
  canvas.height = y + height;
  canvas.title = `${group.label}: ${items.filter((i) => i.icon !== SPACE).map((i) => `${i.count} ${i.label}`).join(', ')}`;
  void Promise.all(placed.map((p) => loadIcon(p.icon.url))).then((images) => {
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    placed.forEach((p, i) => { if (images[i]) ctx.drawImage(images[i]!, ...p.icon.area, p.x, p.y + height - p.icon.height, iconWidth(p.icon), p.icon.height); });
  });
  return canvas;
}

const counts = (group: ClearedGroup) => `[${group.items.map((item) => item.count).join(', ')}]`;

/**
 * A report as a card. `details` is the session's full table of numbers and `averages` the
 * sessions so far with these settings, each folded away (and left open if the player opened it).
 */
export function renderReport(report: DutyReport, details: StatRows = [],
  averages: readonly (readonly string[])[] = [], onClose?: () => void): HTMLElement {
  const card = el('div', 'duty-report');
  card.dataset.puzzle = report.puzzle;

  const station = el('div', 'duty-station');
  const icon = stationIcon(report.puzzle);
  if (icon) station.append(iconImage(icon, 1));
  const heading = el('div', 'duty-station-text');
  heading.append(el('span', 'duty-station-name', report.mode ? `${report.station} · ${report.mode}` : report.station), el('hr', 'duty-rule'));
  station.append(heading);
  card.append(station);

  const entry = el('div', 'duty-entry');
  entry.append(faceCanvas(report.pirate.face, moodFor(report.performance)));
  const who = el('div', 'duty-who');
  who.append(el('div', 'duty-name', report.pirate.name));
  // A practice session with no rating scale gets no rating word.
  const rating = el('div', 'duty-rating', report.unrated ? 'Unrated' : report.performance === LEARNING ? '' : performanceWord(report.performance));
  rating.classList.toggle('is-learning', report.performance === LEARNING);
  const showCounts = report.puzzle !== 'treasure-haul';
  const inScore = showCounts ? report.cleared.filter((group) => group.inScore).map(counts) : [];
  who.append(rating, el('div', 'duty-score', `${report.score.label}: ${[report.score.value, ...inScore].join(' ')}`));
  for (const group of report.cleared) {
    const art = group.style === 'row' ? rowCanvas(group) : stackCanvas(group);
    if (!art) continue;
    const line = el('div', 'duty-tally');
    line.append(art);
    if (showCounts && !group.inScore && group.style !== 'row') line.append(el('span', 'duty-tally-counts', counts(group)));
    who.append(line);
  }
  entry.append(who);
  card.append(entry);

  if (details.length) card.append(foldTable('details', 'This session', details));
  card.append(foldTable('averages', 'Session averages', averages.length ? averages : [['Sessions', 'No session averages available']]));
  if (onClose) {
    const close = el('button', 'panel-button duty-close', 'Close');
    close.type = 'button';
    close.addEventListener('click', onClose);
    card.append(close);
  }
  return card;
}

const LABELS: Record<string, string> = {
  darkBrown: 'Dark brown', lightBrown: 'Light brown', strawberryBlonde: 'Strawberry blonde', navyBlue: 'Navy blue',
  messy_short: 'Messy short', princevaliant: 'Prince Valiant', swept_forward: 'Swept forward', curls_medium: 'Medium curls',
  curly_long: 'Long curls', princessleia: 'Side buns', straight_long: 'Long straight', up_do: 'Up-do',
  beard_long: 'Long beard', beard_short: 'Short beard', braided_goatee: 'Braided goatee', dastardly_stache: 'Dastardly moustache',
  handlebar_moustache: 'Handlebar moustache', mutton_chops: 'Mutton chops', captains: "Captain's hat",
  captains_bandana: "Captain's bandana", feathered: 'Feathered hat', feathered_small: 'Feathered hat',
  sleepinghat: 'Sleeping cap', savvy: 'Savvy hat', top_hat: 'Top hat', picaroon_hat: 'Picaroon hat', wizard_hat: 'Wizard hat',
  santa: 'Festive hat', rogue_hat: 'Rogue hat', widebrimmed: 'Wide-brimmed hat',
};
const label = (value: string) => LABELS[value] ?? (value.charAt(0).toUpperCase() + value.slice(1))
  .replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
const options = (values: string[], none?: string) => [...(none ? [{ value: '', label: none }] : []), ...values.map((value) => ({ value, label: label(value) }))];

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** A random face, for the Random button. */
export function randomFace(): FaceSpec {
  const female = Math.random() < 0.5;
  const o = faceOptions(female);
  return {
    female, skin: pick(o.skin), hair: pick(o.hair), hairColour: pick(o.hairColour),
    beard: !female && Math.random() < 0.5 ? pick(o.beard) : '', eyepatch: Math.random() < 0.15,
    hat: Math.random() < 0.8 ? pick(o.hat) : '', hatColour: pick(o.cloth), trimColour: pick(o.trimCloth),
  };
}

/** The Pirate card on a Settings tab: name and face, saved site-wide for every puzzle's reports. */
export function pirateSettings(page: Page): Group {
  let profile: PirateProfile = loadProfile();
  const group = page.group('Pirate', { title: 'Your name and face on duty reports, for every puzzle' });
  const preview = el('div', 'duty-preview');
  const faces = MOODS.map((mood) => faceCanvas(profile.face, mood, mood === 'normal' ? 'duty-face' : 'duty-face is-small'));
  const moodRow = el('div', 'duty-moods');
  moodRow.append(...faces.filter((_, i) => MOODS[i] !== 'normal'));
  preview.append(faces[MOODS.indexOf('normal')], moodRow);
  group.append(preview);
  let drawn = JSON.stringify(profile.face);
  let saving = false;
  const redraw = () => {
    const key = JSON.stringify(profile.face);
    if (key !== drawn) {
      drawn = key;
      MOODS.forEach((mood, i) => void drawFaceInto(faces[i], profile.face, mood));
    }
  };
  const update = (change: (p: PirateProfile) => PirateProfile) => {
    saving = true;
    try { profile = saveProfile(change(profile)); } finally { saving = false; }
    redraw();
  };
  const face = (patch: Partial<FaceSpec>) => update((p) => ({ ...p, face: { ...p.face, ...patch } }));
  // Another tab or a restored backup may change the profile; follow it.
  const follow = () => {
    // Gone with its puzzle page: stop listening.
    if (!preview.isConnected) return window.removeEventListener('puzzle-practice-data-changed', follow);
    if (saving) return;
    profile = loadProfile();
    redraw();
  };
  window.addEventListener('puzzle-practice-data-changed', follow);

  group.text('Name', () => profile.name, (name) => update((p) => ({ ...p, name })), { placeholder: 'Pirate', title: `Up to ${NAME_LIMIT} letters` });
  group.select('Look', [{ value: 'm', label: 'Man' }, { value: 'f', label: 'Woman' }], () => (profile.face.female ? 'f' : 'm'),
    (v) => face({ female: v === 'f' }));
  const male = faceOptions(false);
  const female = faceOptions(true);
  group.select('Skin', options(male.skin), () => profile.face.skin, (skin) => face({ skin }));
  group.select('Hair', options(male.hair, 'Bald'), () => profile.face.hair, (hair) => face({ hair }), { hidden: () => profile.face.female });
  group.select('Hair', options(female.hair, 'Bald'), () => profile.face.hair, (hair) => face({ hair }), { hidden: () => !profile.face.female });
  group.select('Hair colour', options(male.hairColour), () => profile.face.hairColour, (hairColour) => face({ hairColour }));
  group.select('Beard', options(male.beard, 'None'), () => profile.face.beard, (beard) => face({ beard }), { hidden: () => profile.face.female });
  group.select('Beard', options(female.beard, 'None'), () => profile.face.beard, (beard) => face({ beard }), { hidden: () => !profile.face.female });
  group.select('Hat', options(male.hat, 'None'), () => profile.face.hat, (hat) => face({ hat }), { hidden: () => profile.face.female });
  group.select('Hat', options(female.hat, 'None'), () => profile.face.hat, (hat) => face({ hat }), { hidden: () => !profile.face.female });
  group.select('Hat colour', options(male.cloth), () => profile.face.hatColour, (hatColour) => face({ hatColour }), { hidden: () => !profile.face.hat });
  group.select('Trim colour', options(male.trimCloth), () => profile.face.trimColour, (trimColour) => face({ trimColour }), { hidden: () => !profile.face.hat });
  group.toggle('Eyepatch', () => profile.face.eyepatch, (eyepatch) => face({ eyepatch }));
  group.button('Random face', () => face(randomFace()));
  return group;
}
