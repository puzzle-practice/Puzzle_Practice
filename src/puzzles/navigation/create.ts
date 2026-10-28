// Navigation's Freeplay mode: painting stars and targets and reading the board as text. A board's text
// is N and the ring count, then, separated by colons: a character a cell, ring by ring from the
// outside and octant by octant from the east (. empty, 0-4 a star's colour); the targets, each its
// ring, octant and colour (* for wild); and the incoming star's colour and octant.
import { DENSE_DISTRIBUTION, FIRST_TEST_DISTRIBUTION, DISTRIBUTIONS, EMPTY, MAX_TARGETS, type Target } from './logic';
import type { NavigationGame } from './game';

export const COLOUR_NAMES = ['Blue', 'Orange', 'Red', 'White', 'Yellow'];
/** Freeplay paints a colour, clears (-1), or for targets makes one wild (5). */
export const CLEAR = -1, WILD = 5;
export const OCTANT_NAMES = ['East', 'North-east', 'North', 'North-west', 'West', 'South-west', 'South', 'South-east'];

/** Paints a star, or clears one, in the cell given. Stars can float: they settle inward at the next Drop. Returns false when nothing changed. */
export function paintStar(game: NavigationGame, octant: number, ring: number, colour: number): boolean {
  const board = game.board;
  if (ring < 0 || ring >= board.rings || colour < CLEAR || colour > 4) return false;
  const cell = colour === CLEAR ? EMPTY : colour;
  if (board.get(octant, ring) === cell) return false;
  board.set(octant, ring, cell);
  return true;
}

/** Paints a target in one of the three innermost rings, makes it wild, or takes it away. */
export function paintTarget(game: NavigationGame, octant: number, ring: number, colour: number): boolean {
  const rings = game.board.rings;
  if (ring < rings - 3 || ring >= rings || colour < CLEAR || colour > WILD) return false;
  const index = game.targets.findIndex((t) => t.octant === octant && t.ring === ring);
  if (colour === CLEAR) { if (index < 0) return false; game.targets.splice(index, 1); return true; }
  const old = game.targets[index];
  const next: Target = { octant, ring, colour: colour === WILD ? old?.colour ?? 0 : colour, wild: colour === WILD };
  if (old && old.colour === next.colour && old.wild === next.wild) return false;
  if (!old && game.targets.length >= MAX_TARGETS) return false;
  if (old) game.targets[index] = next; else game.targets.push(next);
  return true;
}

export function setEntry(game: NavigationGame, colour: number, octant: number): void {
  game.entry = { colour: Math.max(0, Math.min(4, colour)), octant: ((octant % 8) + 8) % 8 };
}

export function boardCode(game: NavigationGame): string {
  const cells = game.board.cells.map((c) => (c === EMPTY ? '.' : String(c))).join('');
  const targets = game.targets.map((t) => `${t.ring}${t.octant}${t.wild ? '*' : t.colour}`).join(',');
  return `N${game.board.rings}:${cells}:${targets}:${game.entry.colour}${game.entry.octant}`;
}

export interface BoardText { rings: number; cells: number[]; targets: Target[]; entry: { colour: number; octant: number } }

export function readBoardCode(text: string): BoardText | null {
  const m = /^N([34]):([.0-4]+):((?:[0-3][0-7][0-4*],?)*):([0-4])([0-7])$/.exec(text.trim());
  if (!m) return null;
  const rings = Number(m[1]);
  if (m[2].length !== rings * 8) return null;
  const targets = m[3].split(',').filter(Boolean).map((t) => ({ ring: Number(t[0]), octant: Number(t[1]), colour: t[2] === '*' ? 0 : Number(t[2]), wild: t[2] === '*' }));
  if (targets.some((t) => t.ring < rings - 3 || t.ring >= rings) || targets.length > MAX_TARGETS) return null;
  if (new Set(targets.map((t) => t.ring * 8 + t.octant)).size !== targets.length) return null;
  return { rings, cells: [...m[2]].map((c) => (c === '.' ? EMPTY : Number(c))), targets, entry: { colour: Number(m[4]), octant: Number(m[5]) } };
}

/** Puts a board read from text onto a game with the same number of rings. */
export function load(game: NavigationGame, read: BoardText): void {
  read.cells.forEach((c, i) => { game.board.cells[i] = c; });
  game.targets = read.targets.map((t) => ({ ...t }));
  game.entry = { ...read.entry };
}

/** Ways a painted board differs from one the game could deal. `ww` deals dense constellations; `wild` turns wild targets on. */
export function boardIssues(game: NavigationGame, ww: boolean, wild: boolean): string[] {
  const issues: string[] = [], board = game.board, rings = board.rings;
  if (game.floating) issues.push('Some stars are floating. They settle inward when you press Drop.');
  if (board.findRuns().length) issues.push('Three or more stars in a row would already have cleared.');
  if (board.matches(game.targets)) issues.push('The constellation is already charted.');
  if (!game.targets.length) issues.push('There’s no constellation to chart.');
  const counts = [0, 1, 2].map((i) => game.targets.filter((t) => t.ring === rings - 1 - i).length);
  const wilds = game.targets.filter((t) => t.wild);
  if (wilds.length && !wild) issues.push('Wild targets only come with Dennav or Old Dennav’s wild targets on.');
  if (ww) {
    const [inner, middle, outer] = DENSE_DISTRIBUTION;
    const opening = game.settings.mode === 'ww-test' && FIRST_TEST_DISTRIBUTION.every((n, i) => counts[i] === n);
    // A second clear in a row adds one more wild target to the inner ring.
    const extra = wild && counts[0] === inner + 1 && game.targets.filter((t) => t.ring === rings - 1).every((t) => t.wild);
    if (game.targets.length && !opening && ((counts[0] !== inner && !extra) || counts[1] !== middle || counts[2] !== outer)) {
      issues.push(game.settings.mode === 'ww-test' ? 'Dennav constellations start with 1 inner, 2 middle and 1 outer target, then use 3/2/1.' : `Old Dennav constellations have ${inner} inner, ${middle} middle and ${outer} outer targets.`);
    }
  } else if (game.targets.length && !DISTRIBUTIONS.some((d) => d.every((n, i) => n === counts[i]))) {
    issues.push(`No constellation has ${counts[0]} inner, ${counts[1]} middle and ${counts[2]} outer targets.`);
  }
  if (board.get(game.entry.octant, 0) !== EMPTY) issues.push('The incoming star has nowhere to land, which ends the run.');
  return issues;
}
