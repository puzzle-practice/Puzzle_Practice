// Board construction for Standard, Seeded, Freeplay and Practice. Board/piece-sequence seed
// formats remain readable; new random draws use the native session generator. The game
// rules live in logic.ts; toColumns and fromColumns convert between the piece numberings.
import { Random } from '../../core/random';
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
/** [piece sequence, rng decider] */
export type Seed = [string, string];

/** The session generator for board construction and refill columns. */
export const random = new Random();

export const pieces = [0, 1, 2, 3, 4];

export function emptyBoard(): Board {
  return Array.from({ length: 10 }, () => Array<number>(9).fill(0));
}

export function boardLength(board: Board): number {
  return board[0][8] === -1 ? 9 : 8;
}

/** Generates a column from a given set of pieces (K's distilling counter seed) */
export function generateSeededColumn(
  spawnRates: number[],
  difficulty: number,
  seed: Seed,
  oldColumnHeight: number,
): [number[], Seed] {
  if (seed[0].length >= oldColumnHeight) {
    const newColumn: number[] = [];
    for (let x = 0; x < oldColumnHeight; x++) {
      newColumn.push(parseInt(seed[0][0], 10));
      seed[0] = seed[0].slice(1);
      if (newColumn[x] === 2) newColumn[x] = 4;
    }
    if (oldColumnHeight === 8) newColumn.push(-1);
    return [newColumn, seed];
  }
  return generateColumn(spawnRates, difficulty, seed);
}

export function generateColumn(spawnRates: number[], difficulty: number, seed: Seed): [number[], Seed] {
  const newColumn: number[] = [];
  const currentSpawnRates = [...spawnRates];
  const difficultyAdj = difficulty / 100;
  const chanceLowBlack = 2 * spawnRates[0] * difficultyAdj;
  const chanceHighBlack = 2 * spawnRates[0] - chanceLowBlack;
  const chanceHighBrown = 2 * spawnRates[1] * difficultyAdj;
  const chanceLowBrown = 2 * spawnRates[1] - chanceHighBrown;
  for (let a = 0; a < 9; a++) {
    if (a < 4) {
      currentSpawnRates[0] = chanceHighBlack;
      currentSpawnRates[1] = chanceHighBrown;
    } else if (a === 4) {
      currentSpawnRates[0] = spawnRates[0];
      currentSpawnRates[1] = spawnRates[1];
    } else {
      currentSpawnRates[0] = chanceLowBlack;
      currentSpawnRates[1] = chanceLowBrown;
    }
    newColumn.push(random.choiceWeighted(pieces, currentSpawnRates));
  }
  return [newColumn, seed];
}

/** Fill the supplied board with a fresh deal. */
export function generateBoard(
  board: Board,
  spawnRates: number[],
  furnaceHeight: number,
  difficulty: number,
  seed: Seed,
): [Board, Seed] {
  for (let a = 0; a < board.length - 1; a++) {
    const [output, nextSeed] = generateColumn(spawnRates, difficulty, seed);
    seed = nextSeed;
    board[a] = [...output];
  }
  for (let c = 0; c < furnaceHeight; c++) board[9][c] = 0;
  for (let d = (furnaceHeight + 1) % 2; d < 10; d += 2) board[d][8] = -1;

  return [board, seed];
}

/** Takes an input seed which can be in various forms and transforms it into the form [piece sequence, rng decider] */
export function convertSeed(input: string): Seed {
  let seed: Seed;
  if (input.includes('7')) {
    if (input[0] === '7') return ['', input.slice(1)]; // We have no board, just an rng decider
    // Split the explicit board from its refill sequence seed.
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

export function importBoard(seed: Seed): [Board, Seed] {
  const board: Board = Array.from({ length: 10 }, () => Array<number>(9).fill(-1));
  const columnLengths = seed[0][0] === '9' ? [8, 9, 8, 9, 8, 9, 8, 9, 8, 9] : [9, 8, 9, 8, 9, 8, 9, 8, 9, 8];
  if (seed[0][0] === '9' || seed[0][0] === '8') seed[0] = seed[0].slice(1); // The first char just tells us the length of the furnace column, can be ditched now
  for (let x = 0; x < 10; x++) {
    for (let y = 0; y < columnLengths[x]; y++) {
      // Fill missing pieces with whites when an explicit board runs out.
      board[x][y] = seed[0].length > 0 ? parseInt(seed[0][0], 10) : 4;
      seed[0] = seed[0].slice(1);
    }
  }
  return [board, seed];
}

/** The board in create-mode seed format. */
export function getCreateSeed(board: Board): string {
  let seed = String(boardLength(board));
  for (let x = 0; x < 10; x++) {
    for (let y = 0; y < 9; y++) {
      if (board[x][y] !== -1) seed += String(board[x][y]);
    }
  }
  return seed;
}

/** "7" followed by a random 20 digit number. */
export function generateSeed(): string {
  return '7' + random.bigInteger(10n ** 19n, 10n ** 20n - 1n).toString();
}

export function nextRandomSeed(randomSeed: string): string {
  return '7' + (BigInt(randomSeed.slice(1)) + 1n).toString();
}

export function getPracticeSettings(practiceNum: number[]): [number[], number, number] {
  const key = practiceNum.join(',');
  const preset = practiceSettings[key];
  if (preset) {
    const [furnaceInterval, difficulty, spawnRates] = preset;
    return [[...spawnRates], furnaceInterval, difficulty];
  }
  return [[10, 10, 0, 1, 10], 15000000, 50];
}

function alternate8And9(number: number): number {
  return number === 8 ? 9 : 8;
}

export function createJunkBoard(junk: number, spawnRates: number[], furnaceHeight: number, seed: Seed): [Board, Seed] {
  let junkLeft = junk;
  const board: Board = Array.from({ length: 10 }, () => Array<number>(9).fill(4)); // All white starting board

  // if furnaceHeight 8 then odd columns have piece removed, if 9 then even columns
  for (let a = 9 - furnaceHeight; a < 10; a += 2) board[a][8] = -1; // Remove extra pieces from short columns

  if (junkLeft > 0) {
    // I want atleast one good black and brown
    board[0][0] = 0;
    junkLeft -= 1;
  }
  if (junkLeft > 0) {
    board[0][alternate8And9(furnaceHeight) - 1] = 1;
    junkLeft -= 1;
  }

  let junkHeight = furnaceHeight;
  let column = 9;
  while (junkLeft >= junkHeight) {
    // Full columns of black junk on the right
    for (let row = 0; row < junkHeight; row++) board[column][row] = 0;
    column -= 1;
    junkLeft -= junkHeight;
    junkHeight = alternate8And9(junkHeight);
  }
  if (junkLeft === 0 && column < 9) {
    // If it added a full column and ran out of junk I want a bottom right brown.
    board[column + 1][alternate8And9(junkHeight) - 1] = 1;
  } else {
    // Else fill the column with black leaving one junk for bottom right
    for (let row = 0; row < junkLeft - 1; row++) board[column][row] = 0;
    board[column][junkHeight - 1] = 1;
  }

  // Replace some whites with spices
  let totalOdds = 0;
  for (const a of spawnRates) totalOdds += a;
  const whitesAndSpiceOdds = [spawnRates[3], totalOdds - spawnRates[3]]; // Odds of spice, odds of white
  for (let c = 0; c < 10; c++) {
    for (let row = 0; row < 9; row++) {
      if (board[c][row] === 4) board[c][row] = random.choiceWeighted([3, 4], whitesAndSpiceOdds);
    }
  }
  return [board, seed];
}

function createTrapBoard(junk: number, spawnRates: number[], furnaceHeight: number, seed: Seed): [Board, Seed] {
  const [board, nextSeed] = createJunkBoard(junk - 9, spawnRates, furnaceHeight, seed);
  seed = nextSeed;
  const trapAtTop = random.choice([false, true]);
  board[0] = generateColumn([1, 1, 0, 0, 0], 50, seed)[0];
  board[0][8] = -1;
  if (trapAtTop) {
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

export function getPracticeBoard(
  board: Board,
  practiceNum: number[],
  spawnRates: number[],
  difficulty: number,
  seed: Seed,
): [Board, Seed] {
  const furnaceHeight = 8;
  const requiresGenerateBoard = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 6], [2, 9], [3, 5], [3, 6], [4, 5], [5, 4]];
  const requiresJunkBoard = [[7, 0], [7, 1], [8, 0], [8, 1], [9, 0], [9, 1], [9, 2]];
  const junkAmounts = [36, 36, 19, 19, 19, 19, 19];
  const spiceTrappedBoards = [[9, 17], [9, 18], [9, 19], [9, 20], [9, 21]];
  const spiceTrappedJunks = [30, 27, 23, 18, 13];

  if (requiresGenerateBoard.some(p => p[0] === practiceNum[0] && p[1] === practiceNum[1])) return generateBoard(board, spawnRates, furnaceHeight, difficulty, seed);
  if (requiresJunkBoard.some(p => p[0] === practiceNum[0] && p[1] === practiceNum[1])) {
    const junk = junkAmounts[requiresJunkBoard.findIndex((p) => p[0] === practiceNum[0] && p[1] === practiceNum[1])];
    return createJunkBoard(junk, spawnRates, furnaceHeight, seed);
  }
  const seeds = setSeeds[practiceNum.join(',')];
  if (seeds) {
    seed[0] = random.choice(seeds);
    return importBoard(seed);
  }
  if (spiceTrappedBoards.some(p => p[0] === practiceNum[0] && p[1] === practiceNum[1])) {
    const junk = spiceTrappedJunks[spiceTrappedBoards.findIndex((p) => p[0] === practiceNum[0] && p[1] === practiceNum[1])];
    return createTrapBoard(junk, spawnRates, 9, seed);
  }
  // Use a standard deal for unrecognized practice levels.
  return generateBoard(board, spawnRates, furnaceHeight, difficulty, seed);
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
