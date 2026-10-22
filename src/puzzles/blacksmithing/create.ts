// Blacksmithing's Freeplay mode: painting the 6x6 board and reading it as text. A board's text is S
// and two characters a square, top row first: the piece (1-4, B, K, R, Q or W for the rum jug) and
// its strikes left (3 hot, 2 warm, 1 cool, 0 gone). An optional @, column, row and piece at the end
// is the last square struck and the piece it was, which decides where the next strike can land.
import { Chain, IronBoard, PIECE_CHARS, PIECE_NAMES, SIZE, WILD, spawnWeights } from './logic';

/** What a square can be painted: each piece. */
export const PAINTABLE = PIECE_CHARS.map((_, type) => type);
export const HEATS = ['Gone', 'Cool', 'Warm', 'Hot'];

/** Recounts the strikes from the squares' heat, so the blade and its done level follow the board. */
function recount(board: IronBoard): void {
  board.numHits = board.pieces.flat().reduce((n, p) => n + board.strikesPerSquare - p.condition, 0);
}

/** Paints a square's piece and heat. Returns false when nothing changed. */
export function paint(board: IronBoard, x: number, y: number, type: number, condition: number): boolean {
  if (x < 0 || y < 0 || x >= board.size || y >= board.size || !PAINTABLE.includes(type) || !Number.isInteger(condition) || condition < 0 || condition > board.strikesPerSquare) return false;
  const piece = board.pieces[x][y];
  if (piece.type === type && piece.condition === condition) return false;
  piece.type = type;
  piece.condition = condition;
  recount(board);
  return true;
}

/** Every square one piece and heat. */
export function fill(board: IronBoard, type: number, condition: number): boolean {
  if (!PAINTABLE.includes(type) || condition < 0 || condition > board.strikesPerSquare) return false;
  for (const p of board.pieces.flat()) { p.type = type; p.condition = condition; }
  recount(board);
  return true;
}

/** Makes (x, y) the last square struck, as this piece; null clears it, so any square can be struck. */
export function markLast(board: IronBoard, at: { x: number; y: number; type: number } | null): boolean {
  if (at && (at.x < 0 || at.y < 0 || at.x >= board.size || at.y >= board.size || !PAINTABLE.includes(at.type))) return false;
  board.chain = new Chain(board.difficulty);
  if (!at) {
    if (!board.selected) return false;
    board.selected = null;
    return true;
  }
  board.selected = board.pieces[at.x][at.y];
  board.chain.add(at.type);
  return true;
}

export function boardCode(board: IronBoard): string {
  let code = 'S';
  for (let y = 0; y < board.size; y++) for (let x = 0; x < board.size; x++) code += PIECE_CHARS[board.pieces[x][y].type] + board.pieces[x][y].condition;
  const last = board.selected;
  return last ? `${code}@${last.x}${last.y}${PIECE_CHARS[board.chain.last()]}` : code;
}

export interface BoardText {
  /** [x][y] like the board. */
  types: number[][];
  conditions: number[][];
  last: { x: number; y: number; type: number } | null;
}

export function readBoardCode(text: string): BoardText | null {
  const m = new RegExp(`^S((?:[1-4BKRQW][0-3]){${SIZE * SIZE}})(?:@([0-5])([0-5])([1-4BKRQW]))?$`, 'i').exec(text.trim());
  if (!m) return null;
  const pairs = m[1].toUpperCase().match(/../g)!;
  const types = Array.from({ length: SIZE }, (_, x) => Array.from({ length: SIZE }, (_, y) => PIECE_CHARS.indexOf(pairs[y * SIZE + x][0])));
  const conditions = Array.from({ length: SIZE }, (_, x) => Array.from({ length: SIZE }, (_, y) => Number(pairs[y * SIZE + x][1])));
  const last = m[2] ? { x: Number(m[2]), y: Number(m[3]), type: PIECE_CHARS.indexOf(m[4].toUpperCase()) } : null;
  return { types, conditions, last };
}

/** Puts a board read from text onto the board. */
export function load(board: IronBoard, read: BoardText): void {
  for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) {
    board.pieces[x][y].type = read.types[x][y];
    board.pieces[x][y].condition = read.conditions[x][y];
  }
  recount(board);
  markLast(board, read.last);
}

/** Ways a painted board differs from one that could come up in the game at this board difficulty (0-3). */
export function boardIssues(board: IronBoard): string[] {
  const issues: string[] = [];
  const weights = spawnWeights(board.difficulty);
  const level = board.difficulty + 1;
  const never = new Set<string>();
  const misplaced = new Set<string>();
  for (const p of board.pieces.flat()) {
    if (!p.condition) continue;
    if (p.type === WILD) {
      if (board.difficulty !== 3) never.add(PIECE_NAMES[WILD].toLowerCase() + 's');
      continue;
    }
    if (weights[p.x * SIZE + p.y][p.type] > 0) continue;
    const anywhere = weights.some((w) => w[p.type] > 0);
    (anywhere ? misplaced : never).add(p.type < 4 ? `${PIECE_NAMES[p.type]}s` : `${PIECE_NAMES[p.type].toLowerCase()}s`);
  }
  if (never.size) issues.push(`Difficulty ${level} deals no ${[...never].join(', ')}.`);
  if (misplaced.size) issues.push(`Difficulty ${level} keeps ${[...misplaced].join(', ')} off some of the squares they are on.`);
  if (board.selected && board.chain.last() === WILD && board.difficulty !== 3) issues.push('Rum jugs only come up at difficulty 4.');
  if (!board.selected && board.pieces.flat().some((p) => !p.condition)) issues.push('Some squares are gone but no last strike is marked; right-click the square struck last.');
  if (!board.findHittable().length) issues.push('No square can be struck next, so the sword is finished.');
  return issues;
}
