// Weaving's Freeplay mode: painting threads and the shuttle and reading them as text. A loom's text is
// L and the difficulty, then a colon and two characters a cell for the ten board rows from the top
// (.. empty, or the colour 0-3 and its sparkle corners 0-4), then a colon and the shuttle's four
// slots the same way.
import { COLS, colourOf, difficultyInfo, EMPTY, ROWS, sparklesOf, WeaveBoard } from './logic';

export const COLOUR_NAMES = ['Red', 'Yellow', 'Blue', 'Green'];
/** A thread as Freeplay paints it: a colour 0-3, sparkly or not, or EMPTY to clear. */
export const thread = (colour: number, sparkly: boolean): number => (colour < 0 ? EMPTY : colour | (sparkly ? 4 << 4 : 0));
const valid = (p: number) => p === EMPTY || (Number.isInteger(p) && colourOf(p) <= 3 && sparklesOf(p) <= 4 && p >= 0);
const piece = (colour: number, sparkles: number) => colour | (sparkles << 4);

/** Paints a board cell (rows 1-10). Returns false when nothing changed. */
export function paint(board: WeaveBoard, row: number, col: number, p: number): boolean {
  if (row < 1 || row >= ROWS || col < 0 || col >= COLS || !valid(p) || board.pieces[row][col] === p) return false;
  board.pieces[row][col] = p;
  return true;
}

/** Sets one of the shuttle's four slots. */
export function setShuttle(board: WeaveBoard, slot: number, p: number): boolean {
  if (slot < 0 || slot > 3 || !valid(p) || board.shuttle[slot] === p) return false;
  board.shuttle[slot] = p;
  return true;
}

export function fill(board: WeaveBoard, p: number): void {
  if (valid(p)) for (let row = 1; row < ROWS; row++) board.pieces[row].fill(p);
}

const cellCode = (p: number) => (p === EMPTY ? '..' : `${colourOf(p)}${sparklesOf(p)}`);

export function boardCode(board: WeaveBoard): string {
  return `L${board.difficulty}:${board.pieces.slice(1).flat().map(cellCode).join('')}:${board.shuttle.slice(0, 4).map(cellCode).join('')}`;
}

export interface BoardText { difficulty: number; pieces: number[][]; shuttle: number[] }

export function readBoardCode(text: string): BoardText | null {
  const m = /^L([0-8]):((?:\.\.|[0-3][0-4]){100}):((?:\.\.|[0-3][0-4]){4})$/.exec(text.trim());
  if (!m) return null;
  const cell = (s: string) => (s === '..' ? EMPTY : piece(Number(s[0]), Number(s[1])));
  const cells = m[2].match(/../g)!.map(cell);
  return {
    difficulty: Number(m[1]),
    pieces: Array.from({ length: ROWS - 1 }, (_, r) => cells.slice(r * COLS, r * COLS + COLS)),
    shuttle: m[3].match(/../g)!.map(cell),
  };
}

/** Puts a loom read from text onto the board, at the text's difficulty. */
export function load(board: WeaveBoard, read: BoardText): void {
  board.difficulty = read.difficulty;
  read.pieces.forEach((row, r) => { board.pieces[r + 1] = [...row]; });
  board.pieces[0] = [...read.shuttle, ...Array<number>(COLS - 4).fill(EMPTY)];
}

/** The reed would push some threads further: the first row with threads could still move down. */
function unsettled(board: WeaveBoard): boolean {
  for (let row = 1; row < ROWS; row++) if (board.pieces[row].some((p) => p !== EMPTY)) return board.canBatten(row);
  return false;
}

/** Groups of four or more matching threads, which would already have cleared. */
function hasGroup(pieces: number[][]): boolean {
  const seen = new Set<number>();
  for (let row = 1; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (pieces[row][col] === EMPTY || seen.has(row * COLS + col)) continue;
    const colour = colourOf(pieces[row][col]);
    let size = 0;
    const stack: [number, number][] = [[row, col]];
    while (stack.length) {
      const [r, c] = stack.pop()!;
      if (r < 1 || c < 0 || r >= ROWS || c >= COLS || seen.has(r * COLS + c) || pieces[r][c] === EMPTY || colourOf(pieces[r][c]) !== colour) continue;
      seen.add(r * COLS + c); size++;
      stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
    }
    if (size >= 4) return true;
  }
  return false;
}

/** Ways a painted loom differs from one the game could deal at the board's difficulty. */
export function boardIssues(board: WeaveBoard): string[] {
  const issues: string[] = [], d = board.difficulty, info = difficultyInfo(d);
  const threads = board.pieces.flat().filter((p) => p !== EMPTY);
  if (threads.some((p) => colourOf(p) >= info.colours)) issues.push(`Difficulty ${d} has ${info.colours} colours: ${COLOUR_NAMES.slice(0, info.colours).join(', ').toLowerCase()}.`);
  if (!info.special && threads.some((p) => sparklesOf(p) > 0)) issues.push('Sparkly threads only come from difficulty 4.');
  if (unsettled(board)) issues.push('The reed would push the top threads further down.');
  if (hasGroup(board.pieces)) issues.push('Four or more matching threads together would already have cleared.');
  const slots = board.shuttle.slice(0, 4).map((p) => p !== EMPTY), size = slots.filter(Boolean).length;
  if (!slots[0]) issues.push('The shuttle’s first slot is always filled.');
  else if (d === 0 ? size !== 2 || !slots[1] : size < 2) issues.push(d === 0 ? 'At difficulty 0 the shuttle is always a pair.' : 'Shuttles carry two to four threads.');
  else if (!info.gaps && slots.indexOf(false) !== -1 && slots.indexOf(false) < slots.lastIndexOf(true)) issues.push('Shuttles have gaps only from difficulty 3.');
  if (size && board.isBooched()) issues.push('The shuttle fits nowhere, which booches the bolt.');
  return issues;
}
