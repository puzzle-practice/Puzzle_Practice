// Speed carp's small holes, from hole_calculator.py and HoleCreator.py in the Vampire Carp
// simulator. Normal holes are the game's now (board.ts).
//
// A hole is a 4×9 grid of numbers: 0 wood, 1 an empty cell, and +2 for every piece
// covering a cell (so 3 is filled once, 5 overlapped). Edges mark the empty cells
// that touch wood: +1 left, +10 right, +100 top, +1000 bottom.
import type { PyRandom } from '../../core/pyrandom';
import type { HoleEntry } from './holes';

export type Grid = number[][];

export const HOLE_ROWS = 4;
export const HOLE_COLS = 9;

/** Each piece as a 5×5 matrix around its centre cell. "b" is the putty bucket and has no shape. */
const SHAPES: Record<string, string[]> = {
  f: ['00000', '00100', '01100', '00110', '00000'],
  i: ['00000', '00000', '11111', '00000', '00000'],
  l: ['00000', '01000', '01111', '00000', '00000'],
  n: ['00000', '00000', '00111', '01100', '00000'],
  p: ['00000', '00110', '00110', '00100', '00000'],
  t: ['00000', '00000', '01110', '00100', '00100'],
  u: ['00000', '01010', '01110', '00000', '00000'],
  v: ['00100', '00100', '11100', '00000', '00000'],
  w: ['00000', '00010', '00110', '01100', '00000'],
  x: ['00000', '00100', '01110', '00100', '00000'],
  y: ['00000', '00100', '11110', '00000', '00000'],
  z: ['00000', '01000', '01110', '00010', '00000'],
};

/** A piece in hand, in the toolbox or in a hole: its letter, anticlockwise rotation (0–360) and mirror flag. */
export interface Piece {
  letter: string;
  rotation: number;
  flip: number;
}

export function emptyGrid(fill = 0, rows = HOLE_ROWS, cols = HOLE_COLS): Grid {
  return Array.from({ length: rows }, () => Array<number>(cols).fill(fill));
}

export function copyGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

/** flip_hole: mirrors a grid left to right. */
export function flipGrid<T>(grid: T[][]): T[][] {
  return grid.map((row) => [...row].reverse());
}

/** rotate_hole / rotate_piece: a quarter turn anticlockwise. */
export function rotateGrid<T>(grid: T[][]): T[][] {
  const h = grid.length;
  const w = grid[0].length;
  return Array.from({ length: w }, (_, r) => Array.from({ length: h }, (_, c) => grid[c][w - 1 - r]));
}

export function pieceMatrix(piece: Piece): number[][] {
  let matrix = SHAPES[piece.letter].map((row) => row.split('').map(Number));
  if (piece.flip === 1) matrix = flipGrid(matrix);
  for (let i = 0; i < Math.floor(piece.rotation / 90); i++) matrix = rotateGrid(matrix);
  return matrix;
}

/** Top-left pixel of hole 0–3 (0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right). */
export function holeOrigin(hole: number): [number, number] {
  return [hole === 0 || hole === 2 ? 53 : 251, hole === 0 || hole === 1 ? 105 : 447];
}

function coveredCells(piece: Piece, x: number, y: number, hole: number): [number, number][] {
  const [hx, hy] = holeOrigin(hole);
  // The -2s centre the 5×5 matrix on the piece's position.
  const offsetX = Math.floor((x - hx) / 18) - 2;
  const offsetY = Math.floor((y - hy) / 18) - 2;
  const matrix = pieceMatrix(piece);
  const cells: [number, number][] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const row = r + offsetY;
      const col = c + offsetX;
      if (matrix[r][c] === 1 && row >= 0 && row < HOLE_ROWS && col >= 0 && col < HOLE_COLS) cells.push([row, col]);
    }
  }
  return cells;
}

export function computeEdges(grid: Grid): Grid {
  const edges = emptyGrid();
  for (let r = 0; r < HOLE_ROWS; r++) {
    for (let c = 0; c < HOLE_COLS; c++) {
      if (grid[r][c] !== 1) continue;
      if (c === 0 || grid[r][c - 1] !== 1) edges[r][c] += 1;
      if (c === HOLE_COLS - 1 || grid[r][c + 1] !== 1) edges[r][c] += 10;
      if (r === 0 || grid[r - 1][c] !== 1) edges[r][c] += 100;
      if (r === HOLE_ROWS - 1 || grid[r + 1][c] !== 1) edges[r][c] += 1000;
    }
  }
  return edges;
}

/** hole_calculator: adds (or removes) a piece at pixel (x, y) and returns the new edges. */
export function applyPiece(grid: Grid, piece: Piece, x: number, y: number, hole: number, add: boolean): Grid {
  for (const [r, c] of coveredCells(piece, x, y, hole)) grid[r][c] += add ? 2 : -2;
  return computeEdges(grid);
}

/**
 * legal_calculator: a placement is legal if it covers at least one empty cell and touches
 * an edge. Also returns how many empty cells it covers (5 is a perfect fit).
 */
export function checkPlacement(grid: Grid, edges: Grid, piece: Piece, x: number, y: number, hole: number): [boolean, number] {
  let empty = 0;
  let touches = false;
  for (const [r, c] of coveredCells(piece, x, y, hole)) {
    if (grid[r][c] === 1) empty++;
    if (edges[r][c] >= 1) touches = true;
  }
  return [empty > 0 && touches, empty];
}

// ---- Hole generation ----

export const PIECES_NO_PUTTY = ['f', 'i', 'l', 'n', 'p', 't', 'u', 'v', 'w', 'x', 'y', 'z'];
export const PIECE_WEIGHTS_NO_PUTTY = [14, 2, 8, 8, 22, 7, 4, 4, 4, 3, 14, 4];
const ROTATIONS = [0, 90, 180, 270];
const FLIPS = [0, 1];

/** Decodes a speed-carp shape string: rows of 0/1, each ended by a 2. */
function decodeShape(code: string): string[][] {
  return code
    .split('2')
    .slice(0, -1)
    .map((row) => row.split(''));
}

export interface NewHole {
  grid: Grid;
  prob: Grid;
  edges: Grid;
}

export interface SmallHole extends NewHole {
  /** Every combination of pieces that fills it exactly. */
  needed: string[];
  code: string;
}

/**
 * hole_creation_small: a hole for speed carp that `size` pieces fill exactly. Size 1 is the
 * shape of a single random piece; sizes 2 and 3 come from the tables in holes.ts, never
 * repeating a shape already on the board, filtered to `letter` when one is required.
 */
export function createSmallHole(
  rng: PyRandom,
  size: number,
  codesInUse: readonly string[],
  table: readonly HoleEntry[],
  seed: number,
): [SmallHole, number] {
  rng.seed(null);
  if (size === 1) {
    rng.seed(seed);
    seed++;
    const letter = rng.choiceWeighted(PIECES_NO_PUTTY, PIECE_WEIGHTS_NO_PUTTY);
    let rotation = rng.choice(ROTATIONS);
    const flip = rng.choice(FLIPS);
    // The I is five long, so it only fits lying down.
    if (letter === 'i') rotation = 0;
    const piece = { letter, rotation, flip };
    const full = emptyGrid(1);
    let x: number;
    let y: number;
    do {
      x = rng.randintN(53, 197);
      y = rng.randintN(105, 159);
    } while (checkPlacement(full, full, piece, x, y, 0)[1] !== 5);
    applyPiece(full, piece, x, y, 0, true);
    const grid = full.map((row) => row.map((v) => (v === 3 ? 1 : 0)));
    return [{ grid, prob: copyGrid(grid), edges: copyGrid(grid), needed: [letter], code: '' }, seed];
  }
  let picked: HoleEntry;
  do {
    rng.seed(seed);
    seed++;
    picked = rng.choiceWeighted(
      table,
      table.map((entry) => entry[2]),
    );
  } while (codesInUse.includes(picked[0]));
  let shape = decodeShape(picked[0]);
  let rotateTimes: number;
  let flipTimes: number;
  if (shape[0].length < 5 && shape.length < 5) {
    rotateTimes = rng.choicesUniform([0, 1, 2, 3]);
    flipTimes = rng.choicesUniform([0, 1]);
  } else {
    // Long shapes only turn half-way, ending up lying down.
    flipTimes = rng.choicesUniform([0, 1]);
    rotateTimes = rng.choicesUniform([0, 2]);
    if (shape.length > shape[0].length) rotateTimes++;
  }
  for (let i = 0; i < rotateTimes; i++) shape = rotateGrid(shape);
  if (flipTimes > 0) shape = flipGrid(shape);
  const grid = emptyGrid();
  shape.forEach((row, r) => row.forEach((cell, c) => cell === '1' && (grid[r][c] += 1)));
  return [{ grid, prob: copyGrid(grid), edges: copyGrid(grid), needed: [...picked[1]], code: picked[0] }, seed];
}

/** The speed-carp table for `size`, narrowed to holes whose fills use `letter` (if given). */
export function holesWith(table: readonly HoleEntry[], letter: string): HoleEntry[] {
  if (!letter) return [...table];
  return table
    .map(([code, combos, weight]) => [code, combos.filter((c) => c.includes(letter)), weight] as const)
    .filter(([, combos]) => combos.length > 0);
}
