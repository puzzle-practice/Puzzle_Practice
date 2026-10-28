import { BoardRandom } from '../forage/board';

/** Rows count up from the bottom of the screen: pieces float upward and new pieces enter from below. */
export const WIDTH = 6, HEIGHT = 12, EMPTY = -1;
export const PUFFER = 7, CRAB = 8, JELLY = 9;
export const CRAB_PROB = [0, 0, 0, 0, 6, 6, 6, 9, 12, 15];
export const PUFFER_PROB = [0, 0, 2, 2, 2, 2, 2, 2, 2, 2];
export const JELLY_PROB = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
export const COLOR_COUNT = [5, 5, 5, 6, 6, 6, 7, 7, 7, 7];
/** Points the stars meter needs before the level-up at each difficulty. */
export const LEVEL_POINTS = [100, 300, 500, 700, 900, 1100, 1300, 1500, 1700, 1900];
export const BONUS_SETS: readonly (readonly number[])[] = [[], [1, 2, 3, 4], [1, 2, 3, 4, 7]];
export const BONUS_NAMES = ['None', 'Circle', 'Diamond', 'Plus', 'Cross', 'Ring', 'Star', 'Flower'];
const FIRST_RUN = [3, 5, 8];
const RUN_MULTIPLIER = [[1, 1, 1.6, 3.5, 9], [1, 1.1, 2.1, 5, 12], [1, 1.2, 3, 8, 20]];

export const type = (p: number) => p === EMPTY ? EMPTY : p & 15;
/** Token type (1–7), or 0 for a plain piece. */
export const token = (p: number) => p === EMPTY ? 0 : (p & 240) >> 5;
/** 0 for a token's lower half, 1 for its upper half. */
export const half = (p: number) => (p & 16) >> 4;
const matches = (a: number, b: number) => (a & 15) === (b & 15) && (a & 15) < 7;

export interface Cell { x: number; y: number; piece: number }
export interface Run { horizontal: boolean; x: number; y: number; length: number }
export interface Rise extends Cell { from: number; to: number }

export class BilgeBoard {
  cells = Array<number>(WIDTH * HEIGHT).fill(EMPTY);
  readonly rng: BoardRandom;

  constructor(seed: number, readonly difficulty: number, public bonusMode = 0, populate = true) {
    this.rng = new BoardRandom(seed);
    if (populate) this.populate();
  }
  get(x: number, y: number): number { return this.cells[y * WIDTH + x]; }
  set(x: number, y: number, p: number): void { this.cells[y * WIDTH + x] = p; }
  get colors(): number { return COLOR_COUNT[this.difficulty]; }
  private populate(): void {
    for (let x = 0; x < WIDTH; x++) for (let y = 0; y < HEIGHT; y++) {
      let p: number;
      do p = this.rng.nextInt(this.colors);
      while (y > 1 && this.get(x, y - 1) === p && this.get(x, y - 2) === p || x > 1 && this.get(x - 1, y) === p && this.get(x - 2, y) === p);
      this.set(x, y, p);
    }
  }
  private nextDouble(): number {
    return (this.rng.next(26) * 2 ** 27 + this.rng.next(27)) / 2 ** 53;
  }
  nextPiece(): number {
    const d = this.difficulty, crab = CRAB_PROB[d], puffer = PUFFER_PROB[d], jelly = JELLY_PROB[d], colors = this.colors;
    let n = this.rng.nextInt(300 + crab + puffer + jelly + colors - 300 % colors);
    if (n < jelly) return JELLY;
    n -= jelly;
    if (n < puffer) return PUFFER;
    n -= puffer;
    if (n < crab) return CRAB;
    n -= crab;
    const pool = BONUS_SETS[this.bonusMode] ?? [];
    if (pool.length && this.nextDouble() < 0.2) {
      const bits = this.rng.nextInt(2) << 4 | pool[this.rng.nextInt(pool.length)] << 5;
      return n % colors | bits;
    }
    return n % colors;
  }
  /** The first lower token half with its matching upper half directly above, scanning from the bottom row. */
  completedToken(): Cell | null {
    for (let y = 0; y < HEIGHT - 1; y++) for (let x = 0; x < WIDTH; x++) {
      const b = this.get(x, y) & 240;
      if (this.get(x, y) !== EMPTY && b && !(b & 16) && (b ^ (this.get(x, y + 1) === EMPTY ? 0 : this.get(x, y + 1) & 240)) === 16)
        return { x, y, piece: b >> 5 };
    }
    return null;
  }
  /** Runs of three or more, horizontal (top row first) then vertical; removes their pieces. */
  runs(remove = true): Run[] {
    const found: Run[] = [];
    const scan = (horizontal: boolean, x: number, y: number) => {
      const start = this.get(x, y);
      if (start === EMPTY) return 1;
      let length = 1;
      for (;;) {
        const nx = horizontal ? x + length : x, ny = horizontal ? y : y - length;
        if (nx >= WIDTH || ny < 0 || !matches(this.get(nx, ny), start)) break;
        length++;
      }
      if (length >= 3) found.push({ horizontal, x, y, length });
      return length;
    };
    for (let y = HEIGHT - 1; y >= 0; y--) for (let x = 0; x < WIDTH - 2;) x += scan(true, x, y);
    for (let x = 0; x < WIDTH; x++) for (let y = HEIGHT - 1; y > 1;) y -= scan(false, x, y);
    if (remove) for (const r of found) for (const c of runCells(r)) this.set(c.x, c.y, EMPTY);
    return found;
  }
  private riseDistance(x: number, y: number): number {
    let n = 0;
    for (let r = y + 1; r < HEIGHT; r++) { if (this.get(x, r) !== EMPTY) return n; n++; }
    return n;
  }
  /** Floats pieces up into gaps, then fills each column from below. */
  rise(): Rise[] {
    const moves: Rise[] = [];
    for (let y = HEIGHT - 1; y >= 0; y--) for (let x = 0; x < WIDTH; x++) {
      const p = this.get(x, y);
      if (p === EMPTY) continue;
      const d = this.riseDistance(x, y);
      if (!d) continue;
      this.set(x, y, EMPTY); this.set(x, y + d, p);
      moves.push({ x, y: y + d, piece: p, from: y, to: y + d });
    }
    for (let x = 0; x < WIDTH; x++) {
      const d = this.riseDistance(x, -1);
      for (let i = 0; i < d; i++) {
        const p = this.nextPiece();
        this.set(x, d - 1 - i, p);
        moves.push({ x, y: d - 1 - i, piece: p, from: -1 - i, to: d - 1 - i });
      }
    }
    return moves;
  }
}

export const runCells = (r: Run): { x: number; y: number }[] =>
  Array.from({ length: r.length }, (_, i) => r.horizontal ? { x: r.x + i, y: r.y } : { x: r.x, y: r.y - i });

/** The move's running score: the first clear uses the combo table, later chain steps score one point per piece. */
export class BilgeScore {
  chain = 0;
  points = 0;
  add(pieces: number): number { this.points += pieces; this.chain++; return pieces; }
  crab(water: number): number { this.points += water * 5; return water * 5; }
  runs(runs: readonly Run[], colors: number): number {
    if (this.chain) return this.add(runs.reduce((n, r) => n + r.length, 0));
    const base = runs.reduce((n, r) => n + FIRST_RUN[Math.min(r.length - 3, 2)], 0);
    const tier = Math.max(0, Math.min(2, colors - 5));
    return this.add(Math.round(Math.fround(base * Math.fround(RUN_MULTIPLIER[tier][Math.min(runs.length, 4)]))));
  }
}
