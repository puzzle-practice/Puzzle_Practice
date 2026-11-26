// Freeplay mode's rules on top of Rumble's board: dealing a starting board, the werewolf swap of
// orange for furballs, editing single cells, undo snapshots and rolling the next punch.
import { Random as RandomImpl, type Random } from '../../core/random';
import { Board, DIR_PREC, H, W, nextInt, shaftSent, type Point, type Shaft } from './board';
import { BLUDGEONS, FISTS_TYPE, Glove, HOOK_TYPE, colourMapping } from './gloves';
import { BLOCKED, EMPTY, FURBALL, ORANGE, ball, charged, colourOf, dark, isBall, isCharged, isDark, isLight, light } from './pieces';

/** The deepest a starting board can reach: the bottom row knocks a board out. */
export const MAX_ROWS = H - 1;
/** The longest punch that fits on an undamaged board, and the widest. */
export const MAX_LENGTH = H - 1;
export const MAX_WIDTH = W - 1;
/** The smallest random punch. */
export const RANDOM_MIN_LENGTH = 3;
export const RANDOM_MIN_WIDTH = 3;
/** The colour byte runs 0-255: it picks one of 120 colour orders, and odd values mirror the pattern. */
export const MAX_COLOURS = 255;

/** Bludgeons the simulator offers: everything a pirate can fight with. */
export const SIM_BLUDGEONS = BLUDGEONS;

const COLOUR_BITS = 14;

/** A piece with its colour swapped, keeping its state. */
export function recolour(piece: number, colour: number): number {
  if (!isBall(piece)) return piece;
  return (piece & ~COLOUR_BITS) | (colour << 1);
}

/** Orange as a furball when `werewolf` is on, and a furball back to orange when it's off. */
export function werewolfPiece(piece: number, werewolf: boolean): number {
  if (!isBall(piece)) return piece;
  const colour = colourOf(piece);
  if (werewolf && colour === ORANGE) return recolour(piece, FURBALL);
  if (!werewolf && colour === FURBALL) return recolour(piece, ORANGE);
  return piece;
}

/** Swaps every orange on a board for a furball, or back. */
export function convertBoard(board: Board, werewolf: boolean): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < board.width(y); x++) {
      const p = { x, y };
      const piece = board.get(p);
      if (isBall(piece)) board.set(p, werewolfPiece(piece, werewolf));
    }
  }
}

/** A bludgeon whose orange balls are furballs in werewolf rumbling. */
export class SimGlove extends Glove {
  constructor(type: number, colours: number, readonly werewolf: boolean) {
    super(type, colours);
  }

  override piece(x: number, y: number, strike: boolean): number {
    return werewolfPiece(super.piece(x, y, strike), this.werewolf);
  }
}

/** A fresh, empty board with nothing dealt. */
export function emptyBoard(rng: Random): Board {
  return new Board(rng, rng, [rng, rng], { startRows: 0 });
}

/**
 * Deals `rows` rows where each cell holds a random ball `density`% of the time. Balls left
 * hanging from nothing fall away, so every ball dealt is attached to the top.
 */
export function dealBoard(rng: Random, rows: number, density: number, werewolf: boolean): Board {
  const board = emptyBoard(rng);
  dealInto(board, rng, rows, density, werewolf);
  return board;
}

/** Deals over a board in play, below its damage rows, emptying the rest of it. */
export function dealInto(board: Board, rng: Random, rows: number, density: number, werewolf: boolean): void {
  const depth = Math.max(0, Math.min(MAX_ROWS - board.damage, Math.trunc(rows)));
  for (let y = board.damage; y < H; y++) {
    for (let x = 0; x < board.width(y); x++) {
      const dealt = y < board.damage + depth && rng.random() * 100 < density;
      board.set({ x, y }, dealt ? werewolfPiece(ball(nextInt(rng, 5)), werewolf) : EMPTY);
    }
  }
  for (const p of board.grapesAfter(new Map())) board.set(p, EMPTY);
  board.sparks = [];
}

/** A verified opening into the first spark of a generated chain. */
export interface ChargedOpening {
  fist: number;
  colour: number;
  dir: number;
  groups: number;
  averageGroupSize: number;
  dropOff: number;
  availableSlots: number;
  filledSlots: number;
}

/**
 * Dense plain rows above a connected, partially filled charged area. Each spark belongs to a
 * group of at least three; the first group touches the dense rows and has a real opening shot.
 * Staging on a copy leaves the live board untouched if its damage leaves too little room.
 */
export function generateChargedBoard(board: Board, rng: Random, normalRows: number, chargedRows: number,
  density: number, werewolf: boolean, hands: readonly number[], averageGroupSize = 3, dropOff = 0): ChargedOpening | null {
  const topRows = Math.max(1, Math.trunc(normalRows));
  const depth = Math.min(Math.max(1, Math.trunc(chargedRows)), MAX_ROWS - board.damage - topRows);
  if (depth < 1) return null;
  const b = board.clone();
  dealInto(b, rng, topRows, 100, werewolf);
  const firstRow = b.damage + topRows, endRow = firstRow + depth;
  const key = (p: Point) => p.y * W + p.x;
  const neighbours = (p: Point) => Array.from({ length: 6 }, (_, d) => b.neighbour(p, d)).filter(p => b.valid(p));
  const available = Array.from({ length: b.fists }, (_, fist) => fist)
    .filter(fist => isBall(hands[fist]) && colourOf(hands[fist]) !== FURBALL);
  const fist = available.length ? available[nextInt(rng, available.length)] : 0;
  const colours = werewolf ? [0, 1, 3, 4] : [0, 1, 2, 3, 4];
  const colour = available.length ? colourOf(hands[fist]) : colours[nextInt(rng, colours.length)];
  const x = b.fists === 1 ? 3 : fist === 0 ? 0 : 6;
  const root = [0, 1, 2].map(dx => ({ x: x + dx, y: firstRow }));
  const trigger = root[0], rootKeys = new Set(root.map(key));
  for (const p of root) b.set(p, ball(colour));
  const [lo, hi] = b.ranges[fist];
  const angles = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
    .sort((a, c) => Math.abs(a - 90 * DIR_PREC) - Math.abs(c - 90 * DIR_PREC));
  const openingDir = angles.find(dir => {
    const shot = b.shoot(b.path(fist, dir));
    return shot && b.valid(shot.rest) && neighbours(shot.rest).some(p => rootKeys.has(key(p)));
  });
  if (openingDir === undefined) return null;
  const openingPath = b.path(fist, openingDir), rest = b.shoot(openingPath)!.rest;
  const corridor = new Set<number>([key(rest)]);
  // Reserve every slot that could block this actual opening ray, including below the charged area.
  // These are unavailable slots, so increasing density never fills the required firing lane.
  for (let y = firstRow; y < H - 1; y++) for (let x = 0; x < b.width(y); x++) {
    const p = { x, y };
    if (rootKeys.has(key(p))) continue;
    b.set(p, ball(colour));
    const shot = b.shoot(openingPath);
    if (!shot || key(shot.rest) !== key(rest)) corridor.add(key(p));
    b.set(p, EMPTY);
  }
  // Tiny pockets cut off by the lane cannot hold a legal group; leave them open as part of it.
  const pockets = new Map<number, Point>();
  for (let y = firstRow; y < endRow; y++) for (let x = 0; x < b.width(y); x++) {
    const p = { x, y };
    if (!corridor.has(key(p)) && !rootKeys.has(key(p))) pockets.set(key(p), p);
  }
  while (pockets.size) {
    const queue = [pockets.values().next().value!]; pockets.delete(key(queue[0]));
    for (let i = 0; i < queue.length; i++) for (const next of neighbours(queue[i])) if (pockets.has(key(next))) {
      queue.push(next); pockets.delete(key(next));
    }
    if (queue.length < 3) for (const p of queue) corridor.add(key(p));
  }
  const cells: Point[] = [];
  for (let y = firstRow; y < endRow; y++) for (let x = 0; x < b.width(y); x++) {
    const p = { x, y };
    if (!corridor.has(key(p))) cells.push(p);
  }
  const count = Math.max(3, Math.round(cells.length * Math.max(0, Math.min(100, density)) / 100));
  for (let n = 3; n < count; n++) {
    const frontier = cells.filter(p => b.get(p) === EMPTY && neighbours(p).some(n => isBall(b.get(n))));
    if (!frontier.length) break;
    b.set(frontier[nextInt(rng, frontier.length)], ball(colour));
  }
  const occupied = cells.filter(p => isBall(b.get(p)));
  const targetSize = Math.max(3, Math.round(averageGroupSize));
  let groups: Point[][] = [];
  let bestError = Infinity;
  // Remove small connected chunks from the edges. Try several partitions to keep the requested
  // average while keeping the three-ball opening group separate.
  for (let attempt = 0; attempt < 16; attempt++) {
    const wantedGroups = Math.max(2, Math.round(occupied.length / targetSize));
    const otherSize = (occupied.length - 3) / (wantedGroups - 1);
    const chunkSize = Math.max(3, Math.round(otherSize + (attempt % 7) - 2));
    const parts = [root.slice()], owner = new Map(root.map(p => [key(p), 0]));
    const remaining = new Map(occupied.filter(p => !owner.has(key(p))).map(p => [key(p), p]));
    while (remaining.size) {
      const candidates = rng.shuffle([...remaining.values()]);
      candidates.sort((a, c) => neighbours(a).filter(p => remaining.has(key(p))).length -
        neighbours(c).filter(p => remaining.has(key(p))).length);
      const queue = [candidates[0]], seen = new Set([key(candidates[0])]), part: Point[] = [];
      for (let i = 0; i < queue.length && part.length < chunkSize; i++) {
        const p = queue[i]; part.push(p);
        for (const next of rng.shuffle(neighbours(p))) if (remaining.has(key(next)) && !seen.has(key(next))) {
          queue.push(next); seen.add(key(next));
        }
      }
      if (part.length < 3) {
        const adjacent = part.flatMap(p => neighbours(p).map(p => owner.get(key(p))).filter((i): i is number => i !== undefined && i > 0));
        const index = adjacent.sort((a, c) => parts[a].length - parts[c].length)[0];
        if (index !== undefined) {
          parts[index].push(...part);
          for (const p of part) owner.set(key(p), index);
        }
      } else {
        for (const p of part) owner.set(key(p), parts.length);
        parts.push(part);
      }
      for (const p of part) remaining.delete(key(p));
    }
    const used = parts.reduce((sum, part) => sum + part.length, 0);
    const error = (occupied.length - used) * 0.3 + Math.abs(used / parts.length - targetSize);
    if (error < bestError) { groups = parts; bestError = error; }
    if (error < 0.05) break;
  }
  const owner = new Map<number, number>();
  const filledSlots = groups.reduce((sum, group) => sum + group.length, 0);
  for (const p of occupied) b.set(p, EMPTY);
  groups.forEach((group, i) => group.forEach(p => owner.set(key(p), i)));
  const adjacent = groups.map((group, i) => new Set(group.flatMap(p => neighbours(p).map(p => owner.get(key(p)))
    .filter((other): other is number => other !== undefined && other !== i))));
  const assigned = groups.map(() => -1); assigned[0] = colour;
  const palette = rng.shuffle(colours.slice());
  const usage = new Map(colours.map(c => [c, c === colour ? root.length : 0]));
  const colourGroups = (): boolean => {
    let next = -1, score = -1;
    for (let i = 0; i < groups.length; i++) if (assigned[i] < 0) {
      const saturation = new Set([...adjacent[i]].map(i => assigned[i]).filter(c => c >= 0)).size;
      const rank = saturation * 100 + adjacent[i].size;
      if (rank > score) { next = i; score = rank; }
    }
    if (next < 0) return true;
    const used = new Set([...adjacent[next]].map(i => assigned[i]));
    const choices = palette.filter(c => !used.has(c)).sort((a, c) => usage.get(a)! - usage.get(c)!);
    for (const c of choices) {
      assigned[next] = c;
      usage.set(c, usage.get(c)! + groups[next].length);
      if (colourGroups()) return true;
      usage.set(c, usage.get(c)! - groups[next].length);
    }
    assigned[next] = -1;
    return false;
  };
  if (!colourGroups()) return null;
  groups.forEach((group, i) => group.forEach(p => b.set(p, ball(assigned[i]))));
  // Dense rows stay plain and do not accidentally merge into the deliberately sized groups.
  for (let x = 0; x < b.width(firstRow - 1); x++) {
    const p = { x, y: firstRow - 1 };
    const used = new Set(neighbours(p).filter(p => p.y === firstRow && isBall(b.get(p))).map(p => colourOf(b.get(p))));
    if (used.has(colourOf(b.get(p)))) {
      const choices = [0, 1, 2, 3, 4].map(c => werewolf && c === ORANGE ? FURBALL : c).filter(c => !used.has(c));
      b.set(p, ball(choices[nextInt(rng, choices.length)]));
    }
  }
  const firstGroup = new Map(groups[0].map(p => [key(p), p]));
  b.sparks = [trigger, ...rng.shuffle(groups.slice(1).map(group => group[nextInt(rng, group.length)]))];
  for (const p of b.sparks) b.set(p, charged(b.get(p)));
  const dropCount = Math.max(0, Math.trunc(dropOff));
  const lowestGroupRow = Math.max(...groups.flat().map(p => p.y));
  let furballs = 0;
  for (let i = 0; i < dropCount; i++) {
    const candidates: Array<{ cell: Point; choices: number[] }> = [];
    for (let y = firstRow + 1; y < H - 1; y++) for (let x = 0; x < b.width(y); x++) {
      const p = { x, y };
      if (b.get(p) !== EMPTY || corridor.has(key(p))) continue;
      const near = neighbours(p);
      if (!near.some(p => isBall(b.get(p)))) continue;
      const used = new Set(near.filter(p => owner.has(key(p))).map(p => colourOf(b.get(p))));
      const choices = (werewolf ? [FURBALL, ...colours] : colours).filter(c => {
        if (used.has(c)) return false;
        const joined = new Set<number>();
        for (const next of near) if (isBall(b.get(next)) && colourOf(b.get(next)) === c) {
          for (const k of b.groupOf(next).keys()) joined.add(k);
        }
        return joined.size < (c === FURBALL ? 4 : 2);
      });
      if (choices.length) candidates.push({ cell: p, choices });
    }
    if (!candidates.length) return null;
    // Hang drop-off below the chain, keeping the shooting corridor clear.
    const wantFurball = werewolf && furballs < Math.ceil(dropCount * 0.85);
    const preferred = candidates.filter(c => wantFurball ? c.choices.includes(FURBALL) : c.choices.some(c => c !== FURBALL));
    const pool = preferred.length ? preferred : candidates;
    const hanging = pool.filter(c => c.cell.y >= lowestGroupRow);
    const row = hanging.length ? hanging : pool, chosen = row[nextInt(rng, row.length)];
    const choices = wantFurball && chosen.choices.includes(FURBALL) ? [FURBALL]
      : chosen.choices.filter(c => c !== FURBALL);
    const c = choices.length ? choices[nextInt(rng, choices.length)] : chosen.choices[0];
    if (c === FURBALL) furballs++;
    b.set(chosen.cell, ball(c));
  }
  // Select the middle of the widest opening so it is practical to aim, not just a single ray.
  let bestStart = lo, bestLength = 0, runStart = lo, runLength = 0;
  for (let dir = lo; dir <= hi; dir++) {
    const shot = b.shoot(b.path(fist, dir));
    const hits = shot && neighbours(shot.rest).some(p => firstGroup.has(key(p)));
    if (hits) {
      if (!runLength) runStart = dir;
      if (++runLength > bestLength) { bestStart = runStart; bestLength = runLength; }
    } else runLength = 0;
  }
  if (!bestLength) return null;
  const dir = bestStart + Math.floor((bestLength - 1) / 2);
  const shot = b.shoot(b.path(fist, dir))!;
  const check = b.clone();
  check.set(shot.rest, ball(colour));
  const clear = check.place(shot.rest);
  if (!clear || clear.groups.length !== b.sparks.length || clear.grapes.length !== dropCount) return null;
  restoreBoard(board, snapshotBoard(b));
  return { fist, colour, dir, groups: b.sparks.length, averageGroupSize: filledSlots / groups.length, dropOff: dropCount, availableSlots: cells.length, filledSlots };
}

/** What undo puts back: the cells, which rows are long, the sparks and the shot count. */
export interface BoardSnapshot {
  cells: number[];
  topLarge: number;
  sparks: Point[];
  shots: number;
}

export function snapshotBoard(board: Board): BoardSnapshot {
  return { cells: board.cells.slice(), topLarge: board.topLarge, sparks: board.sparks.map((p) => ({ ...p })), shots: board.shots };
}

export function restoreBoard(board: Board, snapshot: BoardSnapshot): void {
  board.cells.splice(0, board.cells.length, ...snapshot.cells);
  board.topLarge = snapshot.topLarge;
  board.sparks = snapshot.sparks.map((p) => ({ ...p }));
  board.shots = snapshot.shots;
}

/** Swaps every orange in a snapshot for a furball, or back. */
export function convertSnapshot(snapshot: BoardSnapshot, werewolf: boolean): void {
  snapshot.cells = snapshot.cells.map((piece) => werewolfPiece(piece, werewolf));
}

/** Charged balls on the board become its sparks, top first, after an edit. */
export function resetSparks(board: Board): void {
  const sparks: Point[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < board.width(y); x++) if (isCharged(board.get({ x, y }))) sparks.push({ x, y });
  }
  board.sparks = sparks;
}

/** Balls on the board left hanging from nothing. */
export function floating(board: Board): Point[] {
  return board.grapesAfter(new Map());
}

export function ballCount(board: Board): number {
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < board.width(y); x++) {
      const piece = board.get({ x, y });
      if (piece !== EMPTY && piece !== BLOCKED) n++;
    }
  }
  return n;
}

/** What the next punch is made of. */
export interface PunchSpec {
  bludgeon: number;
  colours: number;
  length: number;
  width: number;
  /** 1: from the left wall, 0: from the right. */
  side: number;
  bruises: number;
  sprinkle?: number;
  allowExcessBruises?: boolean;
}

export interface PunchChoices {
  /** A bludgeon type, or null for a random one. */
  bludgeon: number | null;
  /** A colour byte, or null for random colours. */
  colours: number | null;
  /** Length and width, or null for a random size. */
  size: { length: number; width: number } | null;
  /** 'left', 'right' or 'random'. */
  side: 'left' | 'right' | 'random';
  bruises: number;
}

/** Fills in whatever was left random. */
export function rollPunch(rng: Random, choices: PunchChoices): PunchSpec {
  const bludgeon = choices.bludgeon ?? SIM_BLUDGEONS[nextInt(rng, SIM_BLUDGEONS.length)];
  const colours = choices.colours ?? nextInt(rng, MAX_COLOURS + 1);
  const length = choices.size
    ? clamp(choices.size.length, 1, MAX_LENGTH)
    : RANDOM_MIN_LENGTH + nextInt(rng, MAX_LENGTH - RANDOM_MIN_LENGTH + 1);
  const width = choices.size
    ? clamp(choices.size.width, 1, MAX_WIDTH)
    : RANDOM_MIN_WIDTH + nextInt(rng, MAX_WIDTH - RANDOM_MIN_WIDTH + 1);
  const side = choices.side === 'left' ? 1 : choices.side === 'right' ? 0 : nextInt(rng, 2);
  return { bludgeon, colours, length, width, side, bruises: clamp(choices.bruises, 0, Math.trunc((length * width) / 2)) };
}

/** A clear has three balls per group, plus any extra matched balls and drop-off. */
export function punchFromClear(groups: number, extraBalls: number, dropOff: number, minutes: number) {
  const count = Math.max(1, Math.trunc(groups));
  return shaftSent(count, count * 3 + Math.max(0, Math.trunc(extraBalls)),
    Math.max(0, Math.trunc(dropOff)), Math.max(0, minutes)).sent;
}

export function shaftOf(spec: PunchSpec): Shaft {
  return { from: 0, id: 1, count: spec.sprinkle ?? 0, side: spec.side, width: spec.width, height: spec.length, blacks: spec.bruises, next: 0 };
}

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.trunc(value)));

// ---- Bludgeon viewer: werewolf punches by bludgeon, punch type and furball slot ----

/** What the viewer lands on an empty board, all 15 long from the left wall. */
export const VIEWER_KINDS = [
  { label: '9 wide, 15 long', width: 9, length: 15, bruised: false, sprinkle: false },
  { label: '5 wide, 15 long', width: 5, length: 15, bruised: false, sprinkle: false },
  { label: '9 wide, 15 long, 1/3 of max bruises', width: 9, length: 15, bruised: true, sprinkle: false },
  { label: '5 wide, 15 long, 1/3 of max bruises', width: 5, length: 15, bruised: true, sprinkle: false },
  { label: '2 rows of sprinkle', width: 0, length: 0, bruised: false, sprinkle: true },
] as const;

/** Bludgeons that ignore the colour byte: bare fists and the hook. */
export const fixedColours = (type: number): boolean => type === FISTS_TYPE || type === HOOK_TYPE;

/**
 * The colour byte that puts orange (the furball) in pattern colour slot `slot` (0-4), unmirrored.
 * Bare fists and the hook always use their own colours, so they have one slot.
 */
export function furballColours(type: number, slot: number): number {
  if (fixedColours(type)) return 0;
  for (let c = 0; c <= MAX_COLOURS; c += 2) if (colourMapping(c)[slot] === ORANGE) return c;
  return 0;
}

/** Furball slots a bludgeon can show. */
export const furballSlots = (type: number): number => (fixedColours(type) ? 1 : 5);

/** The most bruises a punch can carry, half of it, and the viewer's third of that. */
export const viewerBruises = (length: number, width: number): number => Math.trunc(Math.trunc((length * width) / 2) / 3);

/** A werewolf punch or sprinkle of this bludgeon landed on an empty board; `seed` places the bruises. */
export function viewerBoard(type: number, kind: number, slot: number, seed = 1): Board {
  const rng = new RandomImpl(seed);
  const board = emptyBoard(rng);
  const k = VIEWER_KINDS[kind];
  const glove = new SimGlove(type, furballColours(type, slot), true);
  if (k.sprinkle) {
    // Both sprinkle rows of the pattern in every column, as from the left wall: the first row lands
    // highest. (One strike never carries both in full: 18 or more lands as a single row.)
    for (let x = 0; x < W - 1; x++) for (let j = 0; j < 2; j++) board.set({ x, y: j }, glove.piece(x, j, false));
  } else {
    const bruises = k.bruised ? viewerBruises(k.length, k.width) : 0;
    board.punch({ from: 0, id: 1, count: 0, side: 1, width: k.width, height: k.length, blacks: bruises, next: 0 }, glove);
  }
  return board;
}

// ---- Board codes: Copy and Paste ----

/** One character per ball: plain, charged, dark bruise and light bruise, by colour (furball last). */
const CODE_CHARS = ['ryocbf', 'RYOCBF', '123456', '!@#$%^'] as const;
const STATES = [(p: number) => p, charged, dark, light] as const;

function codeChar(piece: number): string {
  if (!isBall(piece)) return '.';
  const state = isCharged(piece) ? 1 : isDark(piece) ? 2 : isLight(piece) ? 3 : 0;
  return CODE_CHARS[state][colourOf(piece)] ?? '.';
}

function codePiece(c: string): number | null {
  if (c === '.') return EMPTY;
  for (let s = 0; s < CODE_CHARS.length; s++) {
    const i = CODE_CHARS[s].indexOf(c);
    if (i >= 0) return STATES[s](ball(i));
  }
  return null;
}

/**
 * A board as text: `R:` then which rows are long (0 or 1) and its rows below the damage rows, top
 * first, split by `/`. Each ball is a letter by colour (r y o c b, f a furball), upper case when
 * charged; 1-6 and !@#$%^ are dark and light bruises in the same order; `.` is empty, and a
 * row's empty cells at its end are left off.
 */
export function boardCode(board: Board): string {
  const rows: string[] = [];
  for (let y = board.damage; y < H; y++) {
    let row = '';
    for (let x = 0; x < board.width(y); x++) row += codeChar(board.get({ x, y }));
    rows.push(row.replace(/\.+$/, ''));
  }
  while (rows.length && !rows[rows.length - 1]) rows.pop();
  return `R:${(board.topLarge + board.damage) % 2}:${rows.join('/')}`;
}

export interface BoardCode {
  /** Whether the code's first row is a long one. */
  firstLong: boolean;
  rows: number[][];
}

export function readBoardCode(text: string): BoardCode | null {
  const m = /^R:([01]):([^\s]*)$/.exec(text.trim());
  if (!m) return null;
  const firstLong = m[1] === '0';
  const lines = m[2] ? m[2].split('/') : [];
  if (lines.length > H) return null;
  const rows: number[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const width = (i % 2 === 0) === firstLong ? W : W - 1;
    if (lines[i].length > width) return null;
    const row: number[] = [];
    for (const c of lines[i]) {
      const piece = codePiece(c);
      if (piece === null) return null;
      row.push(piece);
    }
    rows.push(row);
  }
  return { firstLong, rows };
}

/**
 * Lays a board code over a board in play, below its damage rows. Rows that don't fit are left
 * out, and a code whose long rows don't line up with the board's shifts its rows by flipping which
 * rows are long. Returns whether every ball fitted.
 */
export function applyBoardCode(board: Board, code: BoardCode, werewolf: boolean): boolean {
  board.topLarge = ((board.damage % 2) + (code.firstLong ? 0 : 1)) % 2;
  let fitted = true;
  for (let y = board.damage; y < H; y++) {
    const row = code.rows[y - board.damage] ?? [];
    for (let x = 0; x < board.width(y); x++) board.set({ x, y }, werewolfPiece(row[x] ?? EMPTY, werewolf));
    if (row.length > board.width(y)) fitted = false;
  }
  if (code.rows.length > H - board.damage && code.rows.slice(H - board.damage).some((r) => r.some(isBall))) fitted = false;
  resetSparks(board);
  return fitted;
}
