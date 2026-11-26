// After a triple: deals a board one ring turn away from a vertical triple and the move that sets it off,
// so the lesson can play the break and let the player play on from the board it leaves behind.
//
// The triple: a vertical through rings 1–3 clears a column (link 1), the ring 4 star above it drops into
// ring 1 next to a pair of its colour and clears it (link 2, turning the targets beside it wild), and the
// constellation charts (link 3). Before the break, ring 3 holds 6–8 stars and ring 4 holds between x and
// 8, where x is the fewest ring 4 stars this board needs for the triple to go off.
import { EMPTY, type Target } from '../navigation/logic';
import type { Random } from '../../core/random';
import type { NavigationGame, Scene } from '../navigation/game';
import { EXTRA, INNER, MIDDLE, TOP, act, clonePosition, gameAt, outcome, positionOf, settled, shuffle, type Action, type Outcome, type Position } from './engine';

const OCTANTS = [0, 1, 2, 3, 4, 5, 6, 7];
const at = (ring: number, octant: number) => ring * 8 + ((octant + 8) % 8);
/** Not filled in yet while dealing (EMPTY is a cell meant to stay empty). */
const UNSET = -2;

export interface AfterTripleDeal {
  /** The board before the move. */
  position: Position;
  /** The ring turn that sets the triple off. */
  action: Action;
  /** The game seed: it deals the constellation that follows the triple. */
  seed: number;
  /** The column the vertical clears. */
  column: number;
  /** x: the fewest ring 4 stars this board needs for the triple to go off. */
  needed: number;
  /** Stars in ring 3 and ring 4 before the move. */
  ring3: number;
  ring4: number;
  /** What the move sets off. */
  result: Outcome;
}

export const ringCount = (cells: number[], ring: number) => OCTANTS.filter((o) => cells[at(ring, o)] !== EMPTY).length;

/**
 * Whether the move sets off exactly the triple: a lone vertical through rings 1–3 in `column`, then a lone
 * ring 1 horizontal that turns targets wild, then the constellation charted as a triple, and nothing after.
 */
export function triple(p: Position, action: Action, seed: number, column: number): Outcome | null {
  if (!settled(p)) return null;
  const game = gameAt(p, seed);
  const o = outcome(act(game, action), positionOf(game));
  if (o.links.length !== 3 || o.charted !== 3) return null;
  const [vertical, horizontal, chart] = o.links;
  if (vertical.kind !== 'run' || vertical.runs.length !== 1) return null;
  const v = vertical.runs[0];
  if (v.direction !== 1 || v.ring !== INNER || v.length !== 3 || v.octant !== column) return null;
  if (horizontal.kind !== 'run' || horizontal.runs.length !== 1) return null;
  const h = horizontal.runs[0];
  if (h.direction !== 0 || h.ring !== INNER || !horizontal.wilded.length) return null;
  if (chart.kind !== 'target' || chart.chain !== 3) return null;
  return o;
}

/** Whether colour `c` at `cell` would line up three of a kind with stars already placed. */
function makesRun(cells: number[], cell: number, c: number): boolean {
  const ring = Math.floor(cell / 8), octant = cell % 8;
  const same = (r: number, o: number) => r >= 0 && r < 4 && cells[at(r, o)] === c;
  for (let s = -2; s <= 0; s++) {
    if ([0, 1, 2].every((i) => s + i === 0 || same(ring, octant + s + i))) return true;
    if ([0, 1, 2].every((i) => s + i === 0 || same(ring + s + i, octant))) return true;
  }
  return false;
}

/** Fills every unset cell with a colour that doesn't line up three, in random order. False if one can't be. */
function fill(rng: Random, cells: number[]): boolean {
  for (const cell of shuffle(rng, cells.map((c, i) => (c === UNSET ? i : -1)).filter((i) => i >= 0))) {
    const options = [0, 1, 2, 3, 4].filter((c) => !makesRun(cells, cell, c));
    if (!options.length) return false;
    cells[cell] = options[rng.integer(0, options.length - 1)];
  }
  return true;
}

function rotated(cells: number[], ring: number, clockwise: boolean): number[] {
  const out = [...cells];
  // As NaviBoard.rotate: clockwise takes each cell from the next octant.
  for (let i = 0; i < 8; i++) out[at(ring, i)] = cells[at(ring, i + (clockwise ? 1 : 7))];
  return out;
}

/**
 * The fewest ring 4 stars the triple needs (x), and a board with only those: tries every subset of the
 * ring 4 stars, smallest first, keeping the rest of the board as it is.
 */
export function ring4Needed(p: Position, action: Action, seed: number, column: number): { needed: number; cells: number[] } | null {
  const stars = OCTANTS.filter((o) => p.cells[at(EXTRA, o)] !== EMPTY);
  const subsets = Array.from({ length: 1 << stars.length }, (_, mask) => mask)
    .sort((m, n) => bits(m) - bits(n) || m - n);
  for (const mask of subsets) {
    const q = clonePosition(p);
    stars.forEach((o, i) => { if (!(mask & (1 << i))) q.cells[at(EXTRA, o)] = EMPTY; });
    if (triple(q, action, seed, column)) return { needed: bits(mask), cells: q.cells };
  }
  return null;
}
const bits = (n: number): number => (n ? (n & 1) + bits(n >> 1) : 0);

/** One try at a deal; null if this layout didn't work out. */
function attempt(rng: Random): AfterTripleDeal | null {
  const column = rng.integer(0, 7);
  const a = rng.integer(0, 4);
  let b = rng.integer(0, 3); if (b >= a) b++;
  // The ring 1 pair the dropped star joins: both on one side of the column, or one either side.
  const pair = [[1, 2], [-1, -2], [-1, 1]][rng.integer(0, 2)].map((d) => (column + d + 8) % 8);
  const ring3 = rng.integer(6, 8);
  const tall = new Set([column, ...shuffle(rng, OCTANTS.filter((o) => o !== column)).slice(0, ring3 - 1)]);

  // The board once the trigger turn has been made: every column filled from ring 1 out, ring 4 over every
  // ring 3 star for now (the ones the triple doesn't need come off later).
  const cells = Array<number>(32).fill(EMPTY);
  for (const o of OCTANTS) {
    const height = tall.has(o) ? 4 : rng.integer(0, 2) ? 2 : 1;
    for (let h = 0; h < height; h++) cells[at(INNER - h, o)] = UNSET;
  }
  for (const ring of [INNER, MIDDLE, TOP]) cells[at(ring, column)] = a;
  cells[at(EXTRA, column)] = b;
  for (const o of pair) cells[at(INNER, o)] = b;
  if (!fill(rng, cells)) return null;

  // Before the move: one ring 1–3 turn away.
  const ring = [INNER, MIDDLE, TOP][rng.integer(0, 2)], clockwise = rng.integer(0, 1) === 1;
  const action: Action = { kind: 'rotate', ring, clockwise };
  const before = rotated(cells, ring, !clockwise);
  const seed = rng.integer(1, 0x7fffffff);

  // A 3-2-1 constellation. Play the move with targets nothing can fill to see where the stars are once the
  // ring 1 clear has dropped them in, then give each target the colour it will hold there.
  const targets: Target[] = [];
  for (const [r, n] of [[INNER, 3], [MIDDLE, 2], [TOP, 1]] as const) {
    for (const octant of shuffle(rng, OCTANTS).slice(0, n)) targets.push({ ring: r, octant, colour: UNSET, wild: false });
  }
  const probe = gameAt({ cells: before, targets, entry: { colour: 0, octant: 0 } }, seed);
  if (probe.floating) return null;
  const scenes = act(probe, action);
  const clears = scenes.map((s, i) => (s.clear?.kind === 'run' ? i : -1)).filter((i) => i >= 0);
  if (clears.length < 2) return null;
  const landed = scenes.slice(clears[1] + 1).find((s) => !s.falls);
  if (!landed) return null;
  const wild = scenes[clears[1]].targets;
  for (const t of targets) {
    const star = landed.cells[at(t.ring, t.octant)];
    if (star === EMPTY) return null;
    if (!wild.find((w) => w.ring === t.ring && w.octant === t.octant)!.wild) t.colour = star;
    else t.colour = rng.integer(0, 4);
  }

  const position: Position = { cells: before, targets, entry: { colour: 0, octant: 0 } };
  if (!triple(position, action, seed, column)) return null;

  // x, then a ring 4 count from x to 8, with ring 3 grown to hold it if need be.
  const minimal = ring4Needed(position, action, seed, column);
  if (!minimal) return null;
  const { needed } = minimal;
  const ring4 = rng.integer(needed, 8);
  for (let tries = 0; tries < 30; tries++) {
    // Start from the stars the triple needs, then add the rest.
    const p = clonePosition(position);
    p.cells = [...minimal.cells];
    const short = Math.max(0, ring4 - ringCount(p.cells, TOP));
    const low = shuffle(rng, OCTANTS.filter((o) => p.cells[at(TOP, o)] === EMPTY));
    if (low.length < short) return null;
    for (const o of low.slice(0, short)) for (const r of [MIDDLE, TOP]) if (p.cells[at(r, o)] === EMPTY) p.cells[at(r, o)] = UNSET;
    const free = shuffle(rng, OCTANTS.filter((o) => p.cells[at(TOP, o)] !== EMPTY && p.cells[at(EXTRA, o)] === EMPTY));
    for (const o of free.slice(0, ring4 - ringCount(p.cells, EXTRA))) p.cells[at(EXTRA, o)] = UNSET;
    if (!fill(rng, p.cells)) continue;
    const r3 = ringCount(p.cells, TOP), r4 = ringCount(p.cells, EXTRA);
    if (r4 !== ring4 || r3 < 6 || r3 > 8) continue;
    const result = triple(p, action, seed, column);
    if (!result) continue;
    // Adding stars mustn't change how many the triple needs.
    if (ring4Needed(p, action, seed, column)?.needed !== needed) continue;
    // The next star waits over a column the break leaves open, and one open before it too where there is one.
    const after = OCTANTS.filter((o) => result.after.cells[at(EXTRA, o)] === EMPTY);
    const both = after.filter((o) => p.cells[at(EXTRA, o)] === EMPTY);
    const open = both.length ? both : after;
    p.entry = { colour: rng.integer(0, 4), octant: open[rng.integer(0, open.length - 1)] };
    return { position: p, action, seed, column, needed, ring3: r3, ring4: r4, result: triple(p, action, seed, column)! };
  }
  return null;
}

/** A board a ring turn away from a vertical triple, with ring 3 at 6–8 stars and ring 4 at x–8. */
export function dealAfterTriple(rng: Random): AfterTripleDeal {
  for (let tries = 0; tries < 5000; tries++) {
    const deal = attempt(rng);
    if (deal) return deal;
  }
  throw new Error('No vertical triple board found');
}

/**
 * A board in play: the board before the break, then the break, then free play on what it leaves, as normal
 * Den navigation (new constellations, charting, booching), until the player asks for a new board.
 */
export class AfterTriplePlay {
  readonly game: NavigationGame;
  /** ready: the board before the break; play: the break and free play after it; booched: the board ended. */
  phase: 'ready' | 'play' | 'booched' = 'ready';
  constructor(readonly deal: AfterTripleDeal, private readonly perform: (g: NavigationGame, a: Action) => Scene[] = act) {
    this.game = gameAt(deal.position, deal.seed);
  }
  /** Sets the triple off; play goes on from here. */
  break(): Scene[] {
    if (this.phase !== 'ready') return [];
    this.phase = 'play';
    return this.perform(this.game, this.deal.action);
  }
  /** A move in free play: what it sets off, or nothing if it isn't one (a ring with no stars, or after a booch). */
  move(action: Action): Scene[] {
    if (this.phase !== 'play') return [];
    const scenes = this.perform(this.game, action);
    if (this.game.booched) this.phase = 'booched';
    return scenes;
  }
}
