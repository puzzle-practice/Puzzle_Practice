// Puzzle setup from the Forage simulator (board_calc, board_matches, board_movement,
// reserve_top_off, puzzles_randomize and Scramble_keys): colouring, filling and scrambling the
// hand-made puzzles. The order of random draws is unchanged, so with the same seed these
// produce the same puzzle boards as the Python code. Play itself follows the real game's
// rules, in engine.ts.
//
// The board is 10 rows by 7 columns, indexed board[row][column] with row 0 at the top.
// Letters:
//   u v w x y  the five colours (dirt, wood, grass, sand, stone)
//   z          empty
//   s          "any colour" in a puzzle template
//   k          bone box (1x1)
//   g h / i j  jar (2x2, top-left g)
//   a b c / d e f  chest (3x2, top-left a)
//   m machete, n shovel, o earthquake, p monkey, q ants
import type { PyRandom } from '../../core/pyrandom';

export type Board = string[][];

export const ROWS = 10;
export const COLS = 7;

export const COLOURS = ['u', 'v', 'w', 'x', 'y'] as const;
const COLOUR_SET = new Set<string>(COLOURS);
const FALLS_ALONE = new Set(['u', 'v', 'w', 'x', 'y', 'k', 'm', 'n', 'o', 'p', 'q']);
const MULTI_CELL = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
/** CI is cursed isle (Gauntlet) foraging; Normal plays it with normal foraging's scoring and crates. */
export type Mode = 'puzzle' | 'ci' | 'infinite' | 'normal' | 'chaos';

export interface Settings {
  mode: Mode;
  /** Which crate sizes spawn outside puzzle mode. */
  bb: boolean;
  fj: boolean;
  cc: boolean;
  /** Which tools (and ants) can appear in refills. */
  eq: boolean;
  machete: boolean;
  shovel: boolean;
  monkey: boolean;
  ants: boolean;
  /** Puzzle mode: re-roll the colours of the puzzle as well as its "s" cells. */
  scramble: boolean;
  /** Forage level 0–15; sets which crate sizes are likely. */
  forageLevel: number;
  /** Normal mode's chest mix: relative chances of a 1x1, 2x2 and 3x2. */
  normalRatios: [number, number, number];
  /** Session timer in seconds; zero plays until stopped. Optional for older replays. */
  roundSeconds?: number;
  /** Override the level's mix in Gauntlet and Chaos. */
  chestRatios?: [number, number, number];
  /**
   * Gauntlet: a chest that's due arrives on the next move and needs room to land, as it does in the
   * game. Always on in play; replays recorded without it play back with chests dropping straight in.
   */
  pacedChests?: boolean;
}

/** [bone boxes, jars, chests] cleared. */
export type Cleared = [number, number, number];

export function emptyBoard(fill = 's'): Board {
  return Array.from({ length: ROWS }, () => Array<string>(COLS).fill(fill));
}

export function parseBoard(rows: readonly string[]): Board {
  return rows.map((row) => row.split(''));
}

export function copyBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

/** Pieces and weights that drop in from the top. */
function dropPool(settings: Settings, specials: boolean): [string[], number[]] {
  const pieces: string[] = [...COLOURS];
  const weights = [0.196, 0.196, 0.196, 0.196, 0.196];
  if (specials && settings.mode !== 'puzzle') {
    // Order and odds from reserve_top_off.py: earthquake, machete, shovel, monkey (ants never enabled).
    const enabled = [settings.eq, settings.machete, settings.shovel, settings.monkey];
    const specialPieces = ['o', 'm', 'n', 'p'];
    const specialWeights = [0.004, 0.004, 0.004, 0.008];
    enabled.forEach((on, i) => {
      if (on) {
        pieces.push(specialPieces[i]);
        weights.push(specialWeights[i]);
      }
    });
  }
  return [pieces, weights];
}

/** Marks every run of three or more matching colours as empty. Returns whether any matched. */
export function boardMatches(board: Board): boolean {
  let matched = false;
  const marks = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
  for (let r = 0; r < ROWS; r++) {
    let same = 0;
    let check = '';
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] === check) {
        same++;
        if (same === 2) {
          matched = true;
          marks[r][c - 2] = marks[r][c - 1] = marks[r][c] = 1;
        } else if (same > 2) marks[r][c] = 1;
      } else if (COLOUR_SET.has(board[r][c])) {
        check = board[r][c];
        same = 0;
      } else {
        check = '';
        same = 0;
      }
    }
  }
  for (let c = 0; c < COLS; c++) {
    let same = 0;
    let check = '';
    for (let r = 0; r < ROWS; r++) {
      if (board[r][c] === check) {
        same++;
        if (same === 2) {
          matched = true;
          marks[r - 2][c] = marks[r - 1][c] = marks[r][c] = 1;
        } else if (same > 2) marks[r][c] = 1;
      } else if (COLOUR_SET.has(board[r][c])) {
        check = board[r][c];
        same = 0;
      } else {
        check = '';
        same = 0;
      }
    }
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (marks[r][c]) board[r][c] = 'z';
  return matched;
}

/** One step of gravity. Chests that reach the bottom row are cleared and counted. Returns whether anything moved. */
export function boardMovement(board: Board, cleared: Cleared): boolean {
  let moved = false;
  const pieceMove = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
  const chestMove = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));

  // How far the piece above each empty cell should fall; a multi-cell chest resets the count.
  for (let c = 0; c < COLS; c++) {
    let columnMove = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r][c] === 'z') {
        columnMove++;
        pieceMove[r][c] = columnMove;
      } else if (MULTI_CELL.has(board[r][c])) {
        chestMove[r][c] = columnMove;
        columnMove = 0;
      }
    }
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = ROWS - 2; r >= 0; r--) {
      if (FALLS_ALONE.has(board[r][c])) pieceMove[r][c] = pieceMove[r + 1][c];
    }
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (pieceMove[r][c] > 0 && board[r][c] !== 'z') {
        moved = true;
        const target = pieceMove[r][c] + r;
        if (board[r][c] === 'k' && target === 9) {
          board[r][c] = 'z';
          cleared[0]++;
        } else {
          board[target][c] = board[r][c];
          board[r][c] = 'z';
        }
      }
    }
  }
  // Jars (bottom-left i) and chests (bottom-left d) fall as far as their shortest column allows.
  for (let c = 0; c < COLS; c++) {
    for (let r = ROWS - 1; r >= 0; r--) {
      const width = board[r][c] === 'i' ? 2 : board[r][c] === 'd' ? 3 : 0;
      if (!width) continue;
      const fall = Math.min(...Array.from({ length: width }, (_, i) => chestMove[r][c + i]));
      if (fall <= 0) continue;
      moved = true;
      if (fall + r === 9) {
        cleared[width - 1]++;
        for (let i = 0; i < width; i++) board[r][c + i] = board[r - 1][c + i] = 'z';
      } else {
        for (let i = 0; i < width; i++) {
          board[r + fall][c + i] = board[r][c + i];
          board[r][c + i] = 'z';
          board[r + fall - 1][c + i] = board[r - 1][c + i];
          board[r - 1][c + i] = 'z';
        }
      }
    }
  }
  return moved;
}

/** Drops pieces from the reserve into empty cells at the top, and refills the reserve. Returns whether anything dropped. */
export function reserveTopOff(board: Board, reserve: Board, settings: Settings, rng: PyRandom, specials = true): boolean {
  let moved = false;
  const reserveMove = Array<number>(COLS).fill(0);
  for (let c = 0; c < COLS; c++) {
    let r = 0;
    while (r < ROWS && board[r][c] === 'z') {
      moved = true;
      r++;
      reserveMove[c] = r;
    }
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (r + reserveMove[c] > 9) board[reserveMove[c] + r - 10][c] = reserve[r][c];
      else reserve[r + reserveMove[c]][c] = reserve[r][c];
    }
  }
  const [pieces, weights] = dropPool(settings, specials);
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (reserveMove[c] >= r + 1) reserve[r][c] = rng.choiceWeighted(pieces, weights);
    }
  }
  return moved;
}

/** Cascades the board until nothing matches or moves. Returns the chests cleared. */
export function boardCalc(board: Board, reserve: Board, settings: Settings, rng: PyRandom, specials = true): Cleared {
  const cleared: Cleared = [0, 0, 0];
  let moved = true;
  let matched = false;
  while (moved || matched) {
    matched = boardMatches(board);
    if (matched) moved = true;
    while (moved) {
      moved = boardMovement(board, cleared);
      if (moved) matched = true;
    }
    if (reserveTopOff(board, reserve, settings, rng, specials)) {
      moved = true;
      matched = true;
    }
  }
  return cleared;
}

/** puzzles_randomize.py: swaps the five colours of a puzzle for a random permutation. */
export function randomizeColours(puzzle: Board, rng: PyRandom): Board {
  const order: string[] = [];
  while (order.length < 5) {
    const pick = rng.choice(COLOURS);
    if (!order.includes(pick)) order.push(pick);
  }
  return puzzle.map((row) => row.map((p) => (COLOUR_SET.has(p) ? order[COLOURS.indexOf(p as (typeof COLOURS)[number])] : p)));
}

/**
 * Fills a puzzle's "s" cells with random colours, retrying until the board is stable:
 * nothing matches and every fixed cell is as the author placed it.
 */
export function fillPuzzle(puzzle: Board, reserve: Board, settings: Settings, rng: PyRandom): Board {
  for (;;) {
    const board = puzzle.map((row) => row.map((p) => (p === 's' ? rng.choice(COLOURS) : p)));
    boardCalc(board, reserve, settings, rng);
    let ok = true;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (puzzle[r][c] !== 's' ? board[r][c] !== puzzle[r][c] : board[r][c] === 'z') ok = false;
      }
    }
    if (ok) return board;
  }
}

/** Scramble_keys.py: cells marked 0 keep their colour when a puzzle is scrambled. */
const SCRAMBLE_KEYS: Record<number, readonly string[]> = {
  1: ['1111111', '1111111', '1111111', '1111111', '1111111', '1111111', '1111100', '1111100', '1111100', '1111000'],
  3: ['1111111', '1111111', '1111111', '1111111', '1111111', '1111111', '1111111', '1111111', '1111111', '1111100'],
  10: ['1111111', '1111111', '1111111', '1111111', '1111111', '1111111', '1111111', '1111111', '1111101', '1111010'],
  23: ['1111111', '1111111', '1111111', '1111111', '1111111', '1111111', '1111111', '1111111', '1111100', '1111000'],
  27: ['1111111', '1111111', '1111111', '1111111', '1111111', '1101111', '1001111', '1001111', '0001111', '1001111'],
};

/** Re-rolls every colour of a puzzle (except its key cells), retrying until the result is stable. */
export function scramblePuzzle(id: number, puzzle: Board, reserve: Board, settings: Settings, rng: PyRandom): Board {
  const key = SCRAMBLE_KEYS[id];
  const scrambled = (r: number, c: number) => (!key || key[r][c] === '1') && (COLOUR_SET.has(puzzle[r][c]) || puzzle[r][c] === 's');
  for (;;) {
    const board = puzzle.map((row, r) => row.map((p, c) => (scrambled(r, c) ? rng.choice(COLOURS) : p)));
    boardCalc(board, reserve, settings, rng);
    let ok = true;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!scrambled(r, c)) {
          if (board[r][c] !== puzzle[r][c]) ok = false;
        } else if (board[r][c] === 'z' && puzzle[r][c] !== 'z') ok = false;
      }
    }
    if (ok) return board;
  }
}

/** Chance of a bone box, jar or chest at each forage level: the desktop simulator's estimates. */
export const CHEST_WEIGHTINGS: readonly (readonly [number, number, number])[] = [
  [0.33, 0.33, 0.33],
  [0.91, 0.09, 0],
  [0.71, 0.218, 0.072],
  [0.6, 0.291, 0.109],
  [0.523, 0.343, 0.134],
  [0.463, 0.382, 0.155],
  [0.414, 0.415, 0.171],
  [0.373, 0.443, 0.184],
  [0.337, 0.467, 0.196],
  [0.305, 0.488, 0.207],
  [0.277, 0.507, 0.216],
  [0.251, 0.524, 0.225],
  [0.228, 0.539, 0.233],
  [0.206, 0.554, 0.24],
  [0.186, 0.567, 0.247],
  [0.168, 0.579, 0.253],
];
