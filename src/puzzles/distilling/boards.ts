// Board making for the practice modes (Standard, Seeded, Create and Practice), kept from the
// Distilling Simulator (Distilling_Sim.pyw) function for function so its seeds and practice boards
// still give the same boards. Names and data shapes mirror the Python. The game itself runs on the
// game's rules in logic.ts; toColumns and fromColumns convert between the two piece numberings.
import { PyRandom } from '../../core/pyrandom';
import { contains, deepcopy, eq, range } from '../../core/py';
import { BURNT, HEAVY, HEIGHT, LIGHT, MEDIUM, SPICE } from './logic';
import { practiceSettings, setSeeds } from './practice';

/*
-1 = empty
0 = black
1 = brown
2 = burnt
3 = spice
4 = white
*/
export type Board = number[][];
export type Point = number[];
/** [piece sequence, rng decider] */
export type Seed = [string, string];

/** The module-level `random` the Python code shares between board making and sound picks. */
export const random = new PyRandom();

export const pieces = [0, 1, 2, 3, 4];

export function emptyBoard(): Board {
  return range(10).map(() => range(9).map(() => 0));
}

export function board_length(board: Board): number {
  return board[0][8] === -1 ? 9 : 8;
}

/** Generates a column from a given set of pieces (K's distilling counter seed) */
export function generate_seeded_column(
  spawn_rates: number[],
  difficulty: number,
  seed: Seed,
  old_column_height: number,
): [number[], Seed] {
  if (seed[0].length >= old_column_height) {
    const new_column: number[] = [];
    for (const x of range(old_column_height)) {
      new_column.push(parseInt(seed[0][0], 10));
      seed[0] = seed[0].slice(1);
      if (new_column[x] === 2) new_column[x] = 4;
    }
    if (old_column_height === 8) new_column.push(-1);
    return [new_column, seed];
  }
  return generate_column(spawn_rates, difficulty, seed);
}

export function generate_column(spawn_rates: number[], difficulty: number, seed: Seed): [number[], Seed] {
  const new_column: number[] = [];
  const current_spawn_rates = [...spawn_rates];
  const difficulty_adj = difficulty / 100;
  const chance_low_black = 2 * spawn_rates[0] * difficulty_adj;
  const chance_high_black = 2 * spawn_rates[0] - chance_low_black;
  const chance_high_brown = 2 * spawn_rates[1] * difficulty_adj;
  const chance_low_brown = 2 * spawn_rates[1] - chance_high_brown;
  for (const a of range(9)) {
    if (a < 4) {
      current_spawn_rates[0] = chance_high_black;
      current_spawn_rates[1] = chance_high_brown;
    } else if (a === 4) {
      current_spawn_rates[0] = spawn_rates[0];
      current_spawn_rates[1] = spawn_rates[1];
    } else {
      current_spawn_rates[0] = chance_low_black;
      current_spawn_rates[1] = chance_low_brown;
    }
    new_column.push(random.choiceWeighted(pieces, current_spawn_rates));
  }
  return [new_column, seed];
}

/**
 * The Python version fills a module-level `board`, so the board persists between
 * games; callers pass it in here.
 */
export function generate_board(
  board: Board,
  spawn_rates: number[],
  furnace_height: number,
  difficulty: number,
  seed: Seed,
): [Board, Seed] {
  for (const a of range(board.length - 1)) {
    const [output, nextSeed] = generate_column(spawn_rates, difficulty, seed);
    seed = nextSeed;
    board[a] = deepcopy(output);
  }
  for (const c of range(furnace_height)) board[9][c] = 0;
  for (const d of range((furnace_height + 1) % 2, 10, 2)) board[d][8] = -1;

  return [board, seed];
}

/** Takes an input seed which can be in various forms and transforms it into the form [piece sequence, rng decider] */
export function convert_seed(input: string): Seed {
  let seed: Seed;
  if (input.includes('7')) {
    if (input[0] === '7') return ['', input.slice(1)]; // We have no board, just an rng decider
    // We have both a board and an rng decider. (The Python version discards the
    // result of split() here and then crashes; splitting is what it intended.)
    const split = input.indexOf('7');
    seed = [input.slice(0, split), input.slice(split + 1)];
  } else {
    seed = [input, '']; // There's only a board
  }
  if (seed[0][0] === '8' || seed[0][0] === '9') return seed; // Seed generated through create mode where 8/9 is the furnace height

  // Seed generated through K's Distilling counter which uses different numbers to represent pieces
  seed[0] = seed[0]
    .replaceAll('1', '0')
    .replaceAll('2', '1')
    .replaceAll('5', '2')
    .replaceAll('3', '6') // 6 used as a temporary number
    .replaceAll('4', '3')
    .replaceAll('6', '4');
  return seed;
}

export function import_board(seed: Seed): [Board, Seed] {
  const board: Board = range(10).map(() => range(9).map(() => -1));
  const column_lengths = seed[0][0] === '9' ? [8, 9, 8, 9, 8, 9, 8, 9, 8, 9] : [9, 8, 9, 8, 9, 8, 9, 8, 9, 8];
  if (seed[0][0] === '9' || seed[0][0] === '8') seed[0] = seed[0].slice(1); // The first char just tells us the length of the furnace column, can be ditched now
  for (const x of range(10)) {
    for (const y of range(column_lengths[x])) {
      // A seed that runs out early crashes the Python version; here the gap fills with whites.
      board[x][y] = seed[0].length > 0 ? parseInt(seed[0][0], 10) : 4;
      seed[0] = seed[0].slice(1);
    }
  }
  return [board, seed];
}

/** The board in create-mode seed format (the Python version copies this to the clipboard). */
export function get_create_seed(board: Board): string {
  let seed = String(board_length(board));
  for (const x of range(10)) {
    for (const y of range(9)) {
      if (board[x][y] !== -1) seed += String(board[x][y]);
    }
  }
  return seed;
}

/** "7" followed by a random 20 digit number. */
export function generate_seed(): string {
  return '7' + random.randint(10n ** 19n, 10n ** 20n - 1n).toString();
}

export function next_random_seed(random_seed: string): string {
  return '7' + (BigInt(random_seed.slice(1)) + 1n).toString();
}

export function get_practice_settings(practice_num: number[]): [number[], number, number] {
  const key = practice_num.join(',');
  const preset = practiceSettings[key];
  if (preset) {
    const [furnace_interval, difficulty, spawn_rates] = preset;
    return [[...spawn_rates], furnace_interval, difficulty];
  }
  return [[10, 10, 0, 1, 10], 15000000, 50];
}

function alternate_8_and_9(number: number): number {
  return number === 8 ? 9 : 8;
}

export function create_junk_board(junk: number, spawn_rates: number[], furnace_height: number, seed: Seed): [Board, Seed] {
  let junk_left = junk;
  const board: Board = range(10).map(() => range(9).map(() => 4)); // All white starting board

  // if furnace_height 8 then odd columns have piece removed, if 9 then even columns
  for (const a of range(9 - furnace_height, 10, 2)) board[a][8] = -1; // Remove extra pieces from short columns

  if (junk_left > 0) {
    // I want atleast one good black and brown
    board[0][0] = 0;
    junk_left -= 1;
  }
  if (junk_left > 0) {
    board[0][alternate_8_and_9(furnace_height) - 1] = 1;
    junk_left -= 1;
  }

  let junk_height = furnace_height;
  let column = 9;
  while (junk_left >= junk_height) {
    // Full columns of black junk on the right
    for (const row of range(junk_height)) board[column][row] = 0;
    column -= 1;
    junk_left -= junk_height;
    junk_height = alternate_8_and_9(junk_height);
  }
  if (junk_left === 0 && column < 9) {
    // If it added a full column and ran out of junk I want a bottom right brown.
    board[column + 1][alternate_8_and_9(junk_height) - 1] = 1;
  } else {
    // Else fill the column with black leaving one junk for bottom right
    for (const row of range(junk_left - 1)) board[column][row] = 0;
    board[column][junk_height - 1] = 1;
  }

  // Replace some whites with spices
  let total_odds = 0;
  for (const a of spawn_rates) total_odds += a;
  const whites_and_spice_odds = [spawn_rates[3], total_odds - spawn_rates[3]]; // Odds of spice, odds of white
  for (const c of range(10)) {
    for (const row of range(9)) {
      if (board[c][row] === 4) board[c][row] = random.choiceWeighted([3, 4], whites_and_spice_odds);
    }
  }
  return [board, seed];
}

function create_trap_board(junk: number, spawn_rates: number[], furnace_height: number, seed: Seed): [Board, Seed] {
  const [board, nextSeed] = create_junk_board(junk - 9, spawn_rates, furnace_height, seed);
  seed = nextSeed;
  const trap_at_top = random.choice([false, true]);
  board[0] = generate_column([1, 1, 0, 0, 0], 50, seed)[0];
  board[0][8] = -1;
  if (trap_at_top) {
    board[0][0] = 3;
    board[1][0] = 0;
    board[2][0] = 3;
    board[1][1] = 0;
    board[1][8] = 1;
  } else {
    board[0][7] = 3;
    board[1][8] = 0;
    board[2][7] = 3;
    board[1][0] = 0;
    board[1][7] = 1;
  }
  return [board, seed];
}

export function get_practice_board(
  board: Board,
  practice_num: number[],
  spawn_rates: number[],
  difficulty: number,
  seed: Seed,
): [Board, Seed] {
  const furnace_height = 8;
  const requires_generate_board = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 6], [2, 9], [3, 5], [3, 6], [4, 5], [5, 4]];
  const requires_junk_board = [[7, 0], [7, 1], [8, 0], [8, 1], [9, 0], [9, 1], [9, 2]];
  const junk_amounts = [36, 36, 19, 19, 19, 19, 19];
  const spice_trapped_boards = [[9, 17], [9, 18], [9, 19], [9, 20], [9, 21]];
  const spice_trapped_junks = [30, 27, 23, 18, 13];

  if (contains(requires_generate_board, practice_num)) return generate_board(board, spawn_rates, furnace_height, difficulty, seed);
  if (contains(requires_junk_board, practice_num)) {
    const junk = junk_amounts[requires_junk_board.findIndex((p) => eq(p, practice_num))];
    return create_junk_board(junk, spawn_rates, furnace_height, seed);
  }
  const seeds = setSeeds[practice_num.join(',')];
  if (seeds) {
    seed[0] = random.choice(seeds);
    return import_board(seed);
  }
  if (contains(spice_trapped_boards, practice_num)) {
    const junk = spice_trapped_junks[spice_trapped_boards.findIndex((p) => eq(p, practice_num))];
    return create_trap_board(junk, spawn_rates, 9, seed);
  }
  // Every practice level is covered above; the Python version would return None here.
  return generate_board(board, spawn_rates, furnace_height, difficulty, seed);
}

/** Simulator piece numbers (0 black, 1 brown, 2 burnt, 3 spice, 4 white) to the game's (logic.ts). */
const TO_BREW: Record<number, number> = { 0: HEAVY, 1: MEDIUM, 2: BURNT, 3: SPICE, 4: LIGHT };
const TO_SIM: Record<number, number> = { [HEAVY]: 0, [MEDIUM]: 1, [BURNT]: 2, [SPICE]: 3, [LIGHT]: 4 };

export function toBrewPiece(piece: number): number {
  return TO_BREW[piece];
}

export function toSimPiece(piece: number): number {
  return TO_SIM[piece];
}

/** A simulator board (9 rows, -1 below short columns) as the game's columns. */
export function toColumns(board: Board): number[][] {
  return board.map((column) => column.filter((p) => p !== -1).map(toBrewPiece));
}

/** The game's columns as a simulator board. */
export function fromColumns(columns: number[][]): Board {
  return columns.map((column) => {
    const out = column.map(toSimPiece);
    while (out.length < HEIGHT) out.push(-1);
    return out;
  });
}
