// Forage's board, ported from the Puzzle Pirates game (build 20260909165753): ForageBoard and the
// shared drop-puzzle engine it sits on (com.threerings.puzzle.drop: DropBoard, the piece dropper and
// the run finder), with Forage's own helpers from duty/forage/a (piece encoding, crate edges, the
// earthquake's sideways drop, crate spawning and crate points). Class names in comments are the
// reference implementation's. Nothing here draws or keeps time; engine.ts plays moves on it.
//
// The board is 7 wide and 10 high, read as (x, y) with y = 0 the top row. A cell holds one int:
//   -1         empty
//   0-4        the five fruit-patch pieces (pieces.png tiles 0-4)
//   5-8        shovel, machete, monkey, earthquake
//   ants       9 | count << 16 | facing << 8, facing 0 left, 1 up, 2 right, 3 down
//   crate      100 | part << 16 | key << 18 | size << 20; part 0 is the bottom-left cell, 1 the rest
//              of the bottom row, 2 the row above; size 0 is 1x1, 1 is 2x2, 2 is 3x2
// Every cell of a crate holds a crate int, so a crate is found from its bottom-left cell.

export const WIDTH = 7;
export const HEIGHT = 10;
export const EMPTY = -1;
export const COLOURS = 5;
export const SHOVEL = 5;
export const MACHETE = 6;
export const MONKEY = 7;
export const EARTHQUAKE = 8;
/** The tools (data/d.C). */
export const TOOLS = [SHOVEL, MACHETE, MONKEY, EARTHQUAKE];
/** Crate sizes by size index (data/d.D). */
export const CRATE_SIZES = [
  { width: 1, height: 1 },
  { width: 2, height: 2 },
  { width: 3, height: 2 },
] as const;
/** At most 3 crates, covering at most 9 cells, are on the board at once (ForageBoard). */
export const MAX_CRATES = 3;
export const MAX_CRATE_AREA = 9;
/** A new set of ants can eat 8 pieces and starts out facing down (ForageBoard.getNextPiece). */
export const ANT_COUNT = 8;
/** Crates collected to fill the meter at each difficulty (data/b.s_). */
export const TARGETS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Chance (%) that a new piece is special, by the move's combo count (ForageBoard). */
const SPECIAL_PIECE_PROBABILITY = [0, 1, 4, 7, 9, 10, 11, 12, 13];
/** Weights of shovel, machete, monkey, earthquake and ants. */
const SPECIAL_PIECE_WEIGHTS = [2, 2, 1, 1, 1];
/** How many of those weights are used at each difficulty (cut with ArrayUtil.splice). */
const SPECIAL_PIECE_DIFFICULTIES = [0, 1, 5, 5, 5, 5, 5, 5, 5];

// ---- Piece encoding (forage/a/f) ----

export const isAnts = (p: number) => (p & 0xff) === 9;
export const isCrate = (p: number) => (p & 0xffff) === 100;
/** The bottom-left cell of a crate. */
export const isCrateAnchor = (p: number) => isCrate(p) && (p & 0x30000) >> 16 === 0;
/** Crate part, from the same bits that hold an ant count's low two bits (see slide()). */
export const partOf = (p: number) => (p & 0x30000) >> 16;
export const antFacing = (p: number) => (p & 0x300) >> 8;
export const antCount = (p: number) => (p & 0xf0000) >> 16;
export const crateKey = (p: number) => (p & 0xc0000) >> 18;
export const crateSize = (p: number) => (p & 0xf00000) >> 20;
export const makeAnts = (count: number, facing: number) => 9 | (count << 16) | (facing << 8);
export const makeCrate = (part: number, key: number, size: number) => 100 | (part << 16) | (key << 18) | (size << 20);
/** Fruit and tools: anything that isn't empty, ants or a crate. */
export const isOrdinary = (p: number) => !isCrate(p) && !isAnts(p) && p !== EMPTY;
export const isTool = (p: number) => TOOLS.includes(p);

/**
 * The game's seeded random (puzzle/data/Board$BoardRandom): java.util.Random's 48-bit generator,
 * so a seed makes the same board and the same refills as in the game. The rules
 * draw from it, in the same order, so every draw here is in the game's order.
 */
export class BoardRandom {
  private seed: bigint;
  private static readonly MULT = 0x5deece66dn;
  private static readonly MASK = (1n << 48n) - 1n;

  constructor(seed: number | bigint) {
    this.seed = (BigInt(seed) ^ BoardRandom.MULT) & BoardRandom.MASK;
  }

  next(bits: number): number {
    this.seed = (this.seed * BoardRandom.MULT + 11n) & BoardRandom.MASK;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  }

  nextInt(n: number): number {
    if (n <= 0) throw new Error('n must be positive');
    if ((n & -n) === n) return Number((BigInt(n) * BigInt(this.next(31))) >> 31n);
    let bits: number;
    let val: number;
    do {
      bits = this.next(31);
      val = bits % n;
    } while (bits - val + (n - 1) > 0x7fffffff);
    return val;
  }

  nextFloat(): number {
    return this.next(24) / (1 << 24);
  }
}

/** RandomUtil.getWeightedIndex: -1 if the weights add up to less than 1. */
function weightedIndex(weights: readonly number[], rng: BoardRandom): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total < 1) return -1;
  let pick = rng.nextInt(total);
  for (let i = 0; i < weights.length; i++) {
    pick -= weights[i];
    if (pick < 0) return i;
  }
  return -1;
}

/**
 * A move of one piece, for the view: from (x, sx-or-sy) to its new cell. Pieces coming onto the
 * board start off it (a negative y, or an x past the edge).
 */
export interface Mover {
  (piece: number, sx: number, sy: number, tx: number, ty: number): void;
}

export class ForageBoard {
  readonly cells = new Array<number>(WIDTH * HEIGHT).fill(EMPTY);
  rng: BoardRandom;
  /** The most separate runs cleared in one cascade step of this move, capped at 8. */
  comboCount = 0;
  /** 0-8: which specials appear (ForageBoard._difficulty). */
  difficulty: number;
  /** The game's crate request (bit 64 = spawn one; bits 0-1 size; bits 2-3 key), or 0. */
  bonusMode = 0;
  crates = 0;
  crateArea = 0;
  /**
   * Which specials can appear, in SPECIAL_PIECE_WEIGHTS order (shovel, machete, monkey,
   * earthquake, ants). Not in the game, which always allows all five past difficulty 1; the
   * simulator lets you turn them off.
   */
  allowed: readonly boolean[] = [true, true, true, true, true];

  constructor(seed: number | bigint, difficulty = 8) {
    this.difficulty = difficulty;
    this.rng = new BoardRandom(seed);
    this.populate();
  }

  getPiece(x: number, y: number): number {
    return this.cells[y * WIDTH + x];
  }

  setPiece(x: number, y: number, p: number): void {
    this.cells[y * WIDTH + x] = p;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;
  }

  /** A random board with no three in a row and nothing special (ForageBoard.populate). */
  private populate(): void {
    for (let x = 0; x < WIDTH; x++) {
      for (let y = 0; y < HEIGHT; y++) {
        let p: number;
        do p = this.rng.nextInt(COLOURS);
        while (
          (y > 1 && this.getPiece(x, y - 1) === p && this.getPiece(x, y - 2) === p) ||
          (x > 1 && this.getPiece(x - 1, y) === p && this.getPiece(x - 2, y) === p)
        );
        this.setPiece(x, y, p);
      }
    }
  }

  /** The weights for special pieces, cut to the difficulty (ArrayUtil.splice) and the simulator's on/off settings. */
  private specialWeights(cut: number): number[] {
    const weights = cut >= SPECIAL_PIECE_WEIGHTS.length ? [...SPECIAL_PIECE_WEIGHTS] : SPECIAL_PIECE_WEIGHTS.slice(0, cut);
    return weights.map((w, i) => (this.allowed[i] ? w : 0));
  }

  /**
   * A piece for a refill (ForageBoard.getNextPiece). A special comes up more often the more runs
   * the move has cleared at once. Only one set of ants at a time; the monkey passes allowAnts false.
   * At difficulty 0 there are no specials, but a special roll still comes out as piece 4.
   */
  getNextPiece(allowAnts = true): number {
    if (this.rng.nextInt(100) < SPECIAL_PIECE_PROBABILITY[this.comboCount]) {
      const cut = SPECIAL_PIECE_DIFFICULTIES[this.difficulty];
      let piece = this.pickSpecial(cut);
      if (piece === 9) {
        if (!this.antsOnBoard() && allowAnts) return makeAnts(ANT_COUNT, 3);
        piece = this.pickSpecial(cut - 1);
      }
      return piece;
    }
    return this.rng.nextInt(COLOURS);
  }

  private pickSpecial(cut: number): number {
    const weights = this.specialWeights(cut);
    // With every special turned off in the simulator, a special roll gives an ordinary piece
    // rather than always piece 4.
    if (cut > 0 && weights.every((w) => w === 0)) return this.rng.nextInt(COLOURS);
    return weightedIndex(weights, this.rng) + 5;
  }

  setComboCount(runs: number): void {
    this.comboCount = Math.min(Math.max(runs, this.comboCount), SPECIAL_PIECE_PROBABILITY.length - 1);
  }

  /** Empty cells straight below (x, y), up to the next piece (DropBoard.getDropDistance). */
  getDropDistance(x: number, y: number): number {
    let n = 0;
    for (let yy = y + 1; yy < HEIGHT; yy++) {
      if (this.getPiece(x, yy) !== EMPTY) return n;
      n++;
    }
    return n;
  }

  /** Empty cells to the right (or left) of (x, y), up to the next piece. */
  getHorizontalDropDistance(x: number, y: number, right: boolean): number {
    let n = 0;
    if (right) {
      for (let xx = x + 1; xx < WIDTH; xx++) {
        if (this.getPiece(xx, y) !== EMPTY) return n;
        n++;
      }
    } else {
      for (let xx = x - 1; xx >= 0; xx--) {
        if (this.getPiece(xx, y) !== EMPTY) return n;
        n++;
      }
    }
    return n;
  }

  /**
   * Where a crate of the given size would land (ForageBoard.findCratePosition), or -1. The fuller
   * the board is of crates, the less likely a spawn: chance 0.7 x (3 - crates) / 3 + 0.7 x (9 - area)
   * / 9, at most 1. Then any column whose top rows hold no crate, ants or tool, at random.
   */
  findCratePosition(size: number): number {
    const { width, height } = CRATE_SIZES[size];
    const free = MAX_CRATES - this.crates;
    const area = MAX_CRATE_AREA - this.crateArea;
    if (free < 0 || area < 0) return -1;
    // Float arithmetic, as in Java, so the roll comes out the same.
    const f = Math.fround;
    const chance = Math.min(f(f(f(0.7) * f(free / 3)) + f(f(0.7) * f(area / 9))), 1);
    if (!(this.rng.nextFloat() < chance)) return -1;
    const columns: number[] = [];
    for (let x = 0; x < WIDTH - width + 1; x++) {
      let ok = true;
      for (let dx = 0; dx < width && ok; dx++) {
        for (let y = 0; y < height; y++) {
          const p = this.getPiece(x + dx, y);
          if (isCrate(p) || isAnts(p) || isTool(p)) {
            ok = false;
            break;
          }
        }
      }
      if (ok) columns.push(x);
    }
    return columns.length ? columns[this.rng.nextInt(columns.length)] : -1;
  }

  /** A 2x2 turn needs four pieces on the board, none of them a tool, a crate or a gap. */
  isLegalRotate(x: number, y: number): boolean {
    if (!this.inBounds(x, y + 1) || !this.inBounds(x, y) || !this.inBounds(x + 1, y + 1) || !this.inBounds(x + 1, y)) return false;
    const four = [this.getPiece(x, y + 1), this.getPiece(x, y), this.getPiece(x + 1, y + 1), this.getPiece(x + 1, y)];
    return !four.some((p) => isTool(p) || p === EMPTY || isCrate(p));
  }

  /** Ants caught in a turn turn with it: anticlockwise -1, clockwise +1. Returns the (new) piece. */
  possiblyRotateAnts(x: number, y: number, ccw: boolean): number {
    let p = this.getPiece(x, y);
    if (isAnts(p)) {
      p = makeAnts(antCount(p), (antFacing(p) + (ccw ? 3 : 1)) % 4);
      this.setPiece(x, y, p);
    }
    return p;
  }

  /**
   * The first set of ants, scanning columns left to right and each top to bottom, takes a step
   * (ForageBoard.tickAnts). If the cell ahead holds fruit or a tool they eat it and move in,
   * one fewer in number (gone at zero); otherwise (the edge, a crate, a gap, other ants) they starve.
   */
  tickAnts(onStep?: (x: number, y: number, tx: number, ty: number) => void, onStarve?: (x: number, y: number) => void): void {
    for (let x = 0; x < WIDTH; x++) {
      for (let y = 0; y < HEIGHT; y++) {
        const p = this.getPiece(x, y);
        if (!isAnts(p)) continue;
        let [tx, ty] = [x, y];
        switch (antFacing(p)) {
          case 0:
            tx--;
            break;
          case 1:
            ty--;
            break;
          case 2:
            tx++;
            break;
          case 3:
            ty++;
            break;
        }
        if (this.inBounds(tx, ty) && isOrdinary(this.getPiece(tx, ty))) {
          const count = antCount(p);
          this.setPiece(tx, ty, count > 1 ? makeAnts(count - 1, antFacing(p)) : EMPTY);
          onStep?.(x, y, tx, ty);
        } else onStarve?.(x, y);
        this.setPiece(x, y, EMPTY);
        return;
      }
    }
  }

  antsOnBoard(): boolean {
    return this.cells.some(isAnts);
  }

  canIncreaseCrateArea(area: number): boolean {
    return this.crateArea + area <= MAX_CRATE_AREA;
  }

  /** Counts a crate in; the game warns and doesn't count past 3. */
  unlimitedCrates = false;

  increaseCrates(): void {
    if (this.unlimitedCrates || this.crates < MAX_CRATES) this.crates++;
  }

  decreaseCrates(): void {
    if (this.crates > 0) this.crates--;
  }

  increaseCrateArea(area: number): void {
    if (this.unlimitedCrates || this.crateArea + area <= MAX_CRATE_AREA) this.crateArea += area;
  }

  decreaseCrateArea(area: number): void {
    if (this.crateArea >= area) this.crateArea -= area;
  }

  // ---- Crate edges (forage/a/c.getConstrainedEdge) ----

  /**
   * How far a crate cell's block reaches: 0 left, 1 right, 2 down, 3 up. The left and right edges
   * follow "part 1" cells, read from bits that ants use for their count, so a set of 1 or 5 ants
   * just right of a crate's bottom row counts as part of it. The up and
   * down edges follow any crate cells, up to this crate's height.
   */
  constrainedEdge(x: number, y: number, dir: number): number {
    const p = this.getPiece(x, y);
    const height = CRATE_SIZES[crateSize(p)].height;
    if ((dir === 0 || dir === 1) && partOf(p) === 2) return x;
    if (dir === 0) {
      if (partOf(p) === 0) return x;
      let xx = x - 1;
      while (xx >= 0 && partOf(this.getPiece(xx, y)) === 1) xx--;
      return xx;
    }
    if (dir === 1) {
      let xx = x + 1;
      while (xx < WIDTH && partOf(this.getPiece(xx, y)) === 1) xx++;
      return xx - 1;
    }
    if (dir === 2) {
      let yy = y + 1;
      while (yy < HEIGHT && isCrate(this.getPiece(x, yy)) && yy < y + height) yy++;
      return yy - 1;
    }
    let yy = y - 1;
    while (yy >= 0 && isCrate(this.getPiece(x, yy)) && yy > y - height) yy--;
    return yy + 1;
  }

  // ---- Gravity and refill (drop/a/f) ----

  /**
   * Drops everything as far as it will go, bottom row first and left to right, crates as whole
   * rows, then fills each column from the top with new pieces. Returns how many pieces moved or
   * came in. `move` hears about each one, the lowest new piece of a column first.
   */
  dropPieces(move?: Mover): number {
    let moved = 0;
    for (let y = HEIGHT - 1; y >= 0; y--) for (let x = 0; x < WIDTH; x++) moved += this.dropPiece(x, y, move);
    for (let x = 0; x < WIDTH; x++) {
      const gap = this.getDropDistance(x, -1);
      for (let i = 0; i < gap; i++) {
        const sy = -1 - i;
        const p = this.getNextPiece();
        if (p !== EMPTY) {
          this.place(p, x, sy, x, sy + gap, move);
          moved++;
        }
      }
    }
    return moved;
  }

  private dropPiece(x: number, y: number, move?: Mover): number {
    const p = this.getPiece(x, y);
    if (p === EMPTY) return 0;
    if (isCrate(p)) {
      const start = Math.max(this.constrainedEdge(x, y, 0), 0);
      const end = Math.min(this.constrainedEdge(x, y, 1), WIDTH);
      let fall = HEIGHT - 1;
      for (let xx = start; xx <= end; xx++) fall = Math.min(fall, this.getDropDistance(xx, y));
      if (fall === 0) return 0;
      for (let xx = start; xx <= end; xx++) this.place(this.getPiece(xx, y), xx, y, xx, y + fall, move);
      return end - start + 1;
    }
    const fall = this.getDropDistance(x, y);
    if (fall === 0) return 0;
    this.place(p, x, y, x, y + fall, move);
    return 1;
  }

  /** Moves a piece down a column; pieces from above the board (sy < 0) only arrive. */
  private place(p: number, x: number, sy: number, tx: number, ty: number, move?: Mover): void {
    if (sy >= 0) this.setPiece(x, sy, EMPTY);
    this.setPiece(tx, ty, p);
    move?.(p, x, sy, tx, ty);
  }

  // ---- The earthquake's sideways drop (forage/a/b) ----

  /**
   * Slides everything right (or left) as far as it goes, crates as whole columns, then fills each
   * row from the far edge. Columns go nearest the edge first, each top to bottom. Returns how many
   * pieces moved or came in.
   */
  slidePieces(right: boolean, move?: Mover): number {
    let moved = 0;
    if (right) {
      for (let x = WIDTH - 1; x >= 0; x--) for (let y = 0; y < HEIGHT; y++) moved += this.slidePiece(x, y, right, move);
    } else {
      for (let x = 0; x < WIDTH; x++) for (let y = 0; y < HEIGHT; y++) moved += this.slidePiece(x, y, right, move);
    }
    for (let y = 0; y < HEIGHT; y++) {
      const gap = this.getHorizontalDropDistance(right ? -1 : WIDTH, y, right);
      for (let i = 0; i < gap; i++) {
        const sx = right ? -1 - i : WIDTH + i;
        const p = this.getNextPiece();
        if (p !== EMPTY) {
          this.shift(p, sx, y, right ? sx + gap : sx - gap, right, move);
          moved++;
        }
      }
    }
    return moved;
  }

  private slidePiece(x: number, y: number, right: boolean, move?: Mover): number {
    const p = this.getPiece(x, y);
    if (p === EMPTY) return 0;
    if (isCrate(p)) {
      let start = this.constrainedEdge(x, y, 3);
      let end = this.constrainedEdge(x, y, 2);
      start = Math.max(start, 0);
      end = Math.min(end, HEIGHT - 1);
      let dist = WIDTH - 1;
      for (let yy = start; yy <= end; yy++) dist = Math.min(dist, this.getHorizontalDropDistance(x, yy, right));
      if (dist === 0) return 0;
      for (let yy = start; yy <= end; yy++) this.shift(this.getPiece(x, yy), x, yy, right ? x + dist : x - dist, right, move);
      return end - start + 1;
    }
    const dist = this.getHorizontalDropDistance(x, y, right);
    if (dist === 0) return 0;
    this.shift(p, x, y, right ? x + dist : x - dist, right, move);
    return 1;
  }

  private shift(p: number, sx: number, y: number, tx: number, right: boolean, move?: Mover): void {
    if ((right && sx >= 0) || (!right && sx < WIDTH)) this.setPiece(sx, y, EMPTY);
    this.setPiece(tx, y, p);
    move?.(p, sx, y, tx, y);
  }

  // ---- Runs (drop/a/b with forage/a/a) ----

  /**
   * Every run of three or more of the same fruit, across (rows from the bottom) or down (columns
   * from the bottom up), found before any is cleared. Overlapping runs each count. Tools, ants and
   * crates never match. Returns the runs as [vertical?, x, y, length] with (x, y) the run's first
   * cell: its left end, or its bottom end for a column.
   */
  findRuns(): [boolean, number, number, number][] {
    const runs: [boolean, number, number, number][] = [];
    const runAt = (vertical: boolean, x: number, y: number) => {
      const first = this.getPiece(x, y);
      let length = 1;
      if (first !== EMPTY) {
        if (vertical) {
          for (let yy = y - 1; yy >= 0 && this.getPiece(x, yy) === first && first < COLOURS; yy--) length++;
        } else {
          for (let xx = x + 1; xx < WIDTH && this.getPiece(xx, y) === first && first < COLOURS; xx++) length++;
        }
      }
      if (length >= 3) runs.push([vertical, x, y, length]);
      return length;
    };
    for (let y = HEIGHT - 1; y >= 0; y--) for (let x = 0; x < WIDTH - 3 + 1; ) x += runAt(false, x, y);
    for (let x = 0; x < WIDTH; x++) for (let y = HEIGHT - 1; y > 1; ) y -= runAt(true, x, y);
    return runs;
  }

  /** The cells of a run. */
  static runCells([vertical, x, y, length]: [boolean, number, number, number]): [number, number][] {
    return Array.from({ length }, (_, i) => (vertical ? [x, y - i] : [x + i, y]));
  }

  // ---- Crate spawning (forage/a/d) ----

  /** A crate size that didn't fit last time, tried again before the request's own size. */
  private waitingSize = -1;
  /** Practice mode: no crates spawn. */
  practice = false;

  /**
   * If the game has asked for a crate, tries to drop one in at the top (overwriting what's there).
   * `overwritten` hears about each top cell it replaces, `move` about each crate cell coming in.
   * Returns how many crate cells came in.
   */
  spawnCrate(move?: Mover, overwritten?: (x: number, y: number) => void): number {
    if ((this.bonusMode & 64) === 0) return 0;
    const size = this.waitingSize === -1 ? this.bonusMode & 3 : this.waitingSize;
    const { width, height } = CRATE_SIZES[size];
    const key = (this.bonusMode & 12) >> 2;
    if (!this.canIncreaseCrateArea(width * height) || this.practice) {
      this.waitingSize = size;
      return 0;
    }
    const column = this.findCratePosition(size);
    if (column === -1) {
      this.waitingSize = size;
      return 0;
    }
    this.increaseCrates();
    this.increaseCrateArea(width * height);
    this.waitingSize = -1;
    this.bonusMode = 0;
    for (let x = column; x < column + width; x++) {
      for (let y = this.getDropDistance(x, -1); y < height; y++) overwritten?.(x, y);
    }
    let placed = 0;
    for (let dx = 0; dx < width; dx++) {
      for (let dy = 0; dy < height; dy++) {
        const part = dx === 0 && dy === 0 ? 0 : dy === 0 ? 1 : 2;
        const sy = -1 - dy;
        this.place(makeCrate(part, key, size), column + dx, sy, column + dx, height + sy, move);
        placed++;
      }
    }
    return placed;
  }

  /** Forgets a crate size waiting to fit (forage/a/d.a(), at the start of a game). */
  resetSpawner(): void {
    this.waitingSize = -1;
  }
}

/**
 * Crate points for normal foraging (forage/a/g): width² x a bonus for each earlier cascade step of
 * the move that collected crates (1, 1.5, 2) x a bonus for each crate already collected in this step
 * (1, 2, 4). The game indexes those tables up to 3, past their end, so a fourth step of a move
 * that collects crates would throw; with at most 3 crates on the board it would need a crate to
 * spawn and land within one move. Here the bonuses stop at the last entry instead.
 */
export class CratePoints {
  private static readonly CRATE_BONUS = [1, 2, 4];
  private static readonly STEP_BONUS = [1, 1.5, 2];
  /** Points for the move so far. */
  total = 0;
  private stepPoints = 0;
  private cratesThisStep = 0;
  private stepsWithCrates = 0;

  reset(): void {
    this.stepsWithCrates = 0;
    this.total = 0;
    this.stepPoints = 0;
    this.cratesThisStep = 0;
  }

  /** A crate of this width collected; returns its points. */
  crate(width: number): number {
    const f = Math.fround;
    const step = CratePoints.STEP_BONUS[Math.min(this.stepsWithCrates, 2)];
    const bonus = CratePoints.CRATE_BONUS[Math.min(this.cratesThisStep, 2)];
    this.cratesThisStep++;
    const points = Math.trunc(f(f(width * width) * step) * bonus);
    this.stepPoints += points;
    return points;
  }

  /** The end of a cascade step. Returns the step's points. */
  endStep(): number {
    const points = this.stepPoints;
    this.total += points;
    if (this.cratesThisStep > 0) this.stepsWithCrates++;
    this.stepPoints = 0;
    this.cratesThisStep = 0;
    return points;
  }

  /** How many steps of this move collected crates (for "Double!" and "Triple!"). */
  get chained(): number {
    return this.stepsWithCrates;
  }
}
