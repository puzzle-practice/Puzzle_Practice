// Swordfight's Freeplay mode: painting a board that settles as the game's would, and reading boards
// as text. A board's text is S, then two characters a square row by row from the top: `..` empty,
// a colour letter (r red, g green, b blue, y yellow) and its block tile 0-9, the capital letter and
// 0 for a breaker, the letter and d or h for a strike's damage (h shows its colour), or mm for
// metal. The falling pair and the next pair can follow, after colons, a letter each, bottom first.
import type { Random } from '../../core/random';
import {
  BOTTOM, BREAKER, type Board, blockPiece, blockTile, colour, DAMAGE, DAMAGE_HINT, EMPTY, fall, findClear, findJoins, H, isBlock,
  isBreaker, kind, LEFT, METAL, RIGHT, TOP, W,
} from './board';

export const PIECE_NAMES = ['Red', 'Green', 'Blue', 'Yellow'];
const LETTERS = 'rgby';

/** What Freeplay paints: the four colours, their breakers, and clearing. */
export const PAINTS = [
  ...PIECE_NAMES.map((name, c) => ({ name, piece: c })),
  ...PIECE_NAMES.map((name, c) => ({ name: `${name} breaker`, piece: c | BREAKER })),
  { name: 'Clear', piece: EMPTY },
];

/** Plain pieces can be painted as a strike's damage: two pairs before it's a piece again, or one with its colour showing. */
export type Stage = 'piece' | 'damage' | 'hint';
export const staged = (piece: number, stage: Stage): number =>
  piece === EMPTY || isBreaker(piece) || stage === 'piece' ? piece : colour(piece) | (stage === 'damage' ? DAMAGE : DAMAGE_HINT);

/** Pieces a pair can hold: the four colours and their breakers. */
export const PAIR_PIECES = PAINTS.slice(0, 8);
export const pairPiece = (p: number): boolean => PAIR_PIECES.some((paint) => paint.piece === p);

/** isBlock reads an empty square's bits as a block tile. */
const inBlock = (p: number) => p !== EMPTY && isBlock(p);

/** The block (left, top, right, bottom) a block piece belongs to. */
function blockAt(board: Board, x: number, y: number): [number, number, number, number] {
  return [board.edge(x, y, LEFT), board.edge(x, y, TOP), board.edge(x, y, RIGHT), board.edge(x, y, BOTTOM)];
}

/** Breaks the block at (x, y) back into loose pieces; settling fuses what's left again. */
export function unfuse(board: Board, x: number, y: number): void {
  if (!inBlock(board.get(x, y))) return;
  const [left, top, right, bottom] = blockAt(board, x, y);
  for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) {
    const p = board.get(c, r);
    if (inBlock(p)) board.set(c, r, colour(p));
  }
}

/** Every block whose tiles don't make a proper block is broken up (pasted text can hold anything). */
function repairBlocks(board: Board): void {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = board.get(x, y);
    if (!inBlock(p)) continue;
    const [left, top, right, bottom] = blockAt(board, x, y);
    const w = right - left + 1, h = bottom - top + 1;
    let whole = w >= 2 && h >= 2;
    for (let r = top; whole && r <= bottom; r++) for (let c = left; whole && c <= right; c++) {
      whole = board.get(c, r) === blockPiece(colour(p), c - left, r - top, w, h);
    }
    if (!whole) {
      for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) if (inBlock(board.get(c, r)) && colour(board.get(c, r)) === colour(p)) board.set(c, r, colour(board.get(c, r)));
      board.set(x, y, colour(p));
    }
  }
}

/** Falls, fuses and shatters at once until nothing changes, as the board would settle in the game. */
export function settle(board: Board): void {
  for (let guard = 0; guard < 200; guard++) {
    if (fall(board).length) continue;
    const blocks = findJoins(board);
    if (blocks.length) {
      for (const b of blocks) board.setBlock(b.colour, b.x, b.y, b.w, b.h);
      continue;
    }
    const clear = findClear(board, 0);
    if (!clear.cells.length) return;
    for (const cell of clear.cells) board.set(cell.x, cell.y, EMPTY);
  }
}

/** Paints a square and lets the board settle. Returns false when nothing changed. */
export function paint(board: Board, x: number, y: number, piece: number): boolean {
  const was = board.get(x, y);
  // A colour painted over its own block changes nothing.
  if (!board.inBounds(x, y) || was === piece || (inBlock(was) && piece === colour(was))) return false;
  unfuse(board, x, y);
  board.set(x, y, piece);
  settle(board);
  return true;
}

export function clearBoard(board: Board): void {
  board.cells.fill(EMPTY);
}

/** Random pieces in the bottom rows, settled: some breakers shatter what they touch on the way. */
export function deal(board: Board, rng: Random, breakerChance: number): void {
  clearBoard(board);
  for (let y = H - 6; y < H; y++) for (let x = 0; x < W; x++) {
    if (rng.random() >= 0.8) continue;
    const c = rng.integer(0, 3);
    board.set(x, y, rng.random() * 100 < breakerChance ? c | BREAKER : c);
  }
  settle(board);
}

function cellCode(p: number): string {
  if (p === EMPTY) return '..';
  if (kind(p) === METAL) return 'mm';
  const c = colour(p);
  if (c > 3) return '..';
  if (isBreaker(p)) return `${LETTERS[c].toUpperCase()}0`;
  if (kind(p) === DAMAGE_HINT) return `${LETTERS[c]}h`;
  // Swords on the board are a pair from being damage; they're shared as damage.
  if (kind(p) !== 0) return `${LETTERS[c]}d`;
  return `${LETTERS[c]}${blockTile(p)}`;
}

const pairCode = (pieces: readonly number[]) => pieces.map((p) => (isBreaker(p) ? LETTERS[colour(p)].toUpperCase() : LETTERS[colour(p)])).join('');

export function boardCode(board: Board, pair: readonly number[] | null, next: readonly number[] | null): string {
  let text = `S${Array.from(board.cells, cellCode).join('')}`;
  if (pair && next) text += `:${pairCode(pair)}:${pairCode(next)}`;
  return text;
}

export interface BoardText { cells: number[]; pair: [number, number] | null; next: [number, number] | null }

function readCell(s: string): number {
  if (s === '..') return EMPTY;
  if (s === 'mm') return METAL;
  const c = LETTERS.indexOf(s[0].toLowerCase());
  if (s[0] !== s[0].toLowerCase()) return c | BREAKER;
  if (s[1] === 'd') return c | DAMAGE;
  if (s[1] === 'h') return c | DAMAGE_HINT;
  return c | (Number(s[1]) << 3);
}

const readPair = (s: string): [number, number] =>
  [...s].map((ch) => LETTERS.indexOf(ch.toLowerCase()) | (ch === ch.toLowerCase() ? 0 : BREAKER)) as [number, number];

export function readBoardCode(text: string): BoardText | null {
  const m = /^S((?:\.\.|mm|[rgby][0-9dh]|[RGBY]0){78})(?::([rgbyRGBY]{2}):([rgbyRGBY]{2}))?$/.exec(text.trim());
  if (!m) return null;
  return {
    cells: m[1].match(/../g)!.map(readCell),
    pair: m[2] ? readPair(m[2]) : null,
    next: m[3] ? readPair(m[3]) : null,
  };
}

/** Puts a board read from text on the board, settled. */
export function load(board: Board, read: BoardText): void {
  board.cells.set(read.cells);
  repairBlocks(board);
  settle(board);
}

/** Ways the board and pairs differ from what a fight could show. */
export function boardIssues(board: Board, pairs: ReadonlyArray<readonly number[]>, breakerChance: number): string[] {
  const issues: string[] = [];
  if (board.get(3, 0) !== EMPTY) issues.push('The top of the fourth column is filled, which knocks ye out when the next pair is due.');
  if (breakerChance <= 0 && pairs.some((pair) => pair.some(isBreaker))) issues.push('With a 0% breaker chance no breakers are dealt.');
  if (breakerChance >= 100 && pairs.some((pair) => pair.some((p) => !isBreaker(p)))) issues.push('With a 100% breaker chance every piece dealt is a breaker.');
  return issues;
}
