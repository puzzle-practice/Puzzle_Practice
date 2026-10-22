// Freeplay mode's rules on top of Rumble's board: dealing a starting board, the werewolf swap of
// orange for furballs, editing single cells, undo snapshots and rolling the next punch.
import { Random as RandomImpl, type Random } from '../../core/random';
import { Board, H, W, nextInt, type Point, type Shaft } from './board';
import { BLUDGEONS, FISTS_TYPE, Glove, HOOK_TYPE, colourMapping } from './gloves';
import { BLOCKED, EMPTY, FURBALL, ORANGE, ball, colourOf, isBall, isCharged } from './pieces';

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

export function shaftOf(spec: PunchSpec): Shaft {
  return { from: 0, id: 1, count: 0, side: spec.side, width: spec.width, height: spec.length, blacks: spec.bruises, next: 0 };
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
