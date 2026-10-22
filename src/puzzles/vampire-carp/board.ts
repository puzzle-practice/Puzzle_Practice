import { seedFor } from '../../core/seeds';
// Carpentry's board, ported from the Puzzle Pirates game (duty/carpentry, build 20260909165753,
// unchanged in test build 20261017062155 apart from renamed internals): CarpentryBoard, Hole and
// the piece class. Class names in comments are the game's (piece letters are the 20260909 build's).
// Nothing here draws or keeps time; game.ts plays moves on it.
//
// The game run the same board from the same seed, so the board's random draws
// happen here in the game's order. Vampire carpentry (the Vampire Lair's carpentry,
// CarpentryMode "_vampirate") is difficulty 8 with every hole size 5. Ship carpentry takes the
// duty's difficulty (0-9) and picks each hole's size from it.
//
// Maneuver tokens: with a token pool switched on, every plank is dealt with a token on it. A token
// is a 2x2 block of quarters, and a plank only carries the quarters that land on its own cells, so
// a whole token is usually pieced together from two or more planks. A finished hole hands over one
// whole token from its cells.
//
// Holes are read as (x, y), x across and y down, with (0, 0) the top-left of the hole's own box.

/** Pieces in the game's order (q.g); '0' is the bucket of putty. */
export const PIECE_LETTERS = ['f', 'i', 'l', 'p', 'n', 't', 'u', 'v', 'w', 'x', 'y', 'z', '0'] as const;
/** How often each piece is dealt, out of 95 (q.h). */
export const PIECE_WEIGHTS = [14, 2, 8, 22, 8, 7, 4, 4, 4, 3, 14, 4, 1] as const;
export const PUTTY = 12;
/** The putty's toolbox byte: piece 12, grain bit 1. */
export const PUTTY_TOOL = (PUTTY << 1) | 1;
/** Holes in play at once and toolbox slots (CarpentryBoard.NUM_HOLES, NUM_TOOLS). */
export const NUM_HOLES = 4;
export const NUM_TOOLS = 3;
/** Holes to fill for a full star meter, by difficulty (carpentry/f.r_). */
export const HOLES_PER_LEVEL = [1, 1, 4, 6, 8, 10, 12, 15, 17, 20];
/** The Vampire Lair's settings (CarpentryConfig.difficultyOverride, holeSizeOverride). */
export const VAMPIRE_DIFFICULTY = 8;
export const VAMPIRE_HOLE_SIZE = 5;
/** The token pools by bonus mode (duty/data/b): off, the four normal shapes, and those with the blade. */
export const BONUS_SETS: readonly (readonly number[])[] = [[], [1, 2, 3, 4], [1, 2, 3, 4, 7]];
/** Token names by type (duty/data/b), 1 circle to 7 blade. */
export const TOKEN_NAMES = ['', 'Circle', 'Diamond', 'Plus', 'Cross', 'Ring', 'Star', 'Blade'];
/** A hole fits in a 10x10 box (Hole.MAX_WIDTH, MAX_HEIGHT). */
export const MAX_HOLE = 10;
/** Moves elsewhere before a neglected hole loses a piece or grows (Hole.MAX_HOLE_NEGLECT). */
export const MAX_NEGLECT = 8;
/** A hole grows at most this many times (Hole.MAX_KNOCKOUTS). */
export const MAX_KNOCKOUTS = 3;

/** The other four cells of each piece around its first cell, in its base orientation (q.i). */
const OFFSETS: readonly (readonly (readonly [number, number])[])[] = [
  [[-1, 0], [0, 1], [0, -1], [1, -1]],
  [[0, -2], [0, -1], [0, 1], [0, 2]],
  [[0, -1], [0, -2], [0, 1], [1, 1]],
  [[0, -1], [0, 1], [1, 0], [1, -1]],
  [[0, 1], [0, 2], [1, 0], [1, -1]],
  [[-1, 0], [1, 0], [0, 1], [0, 2]],
  [[-1, -1], [-1, 0], [1, 0], [1, -1]],
  [[-2, 0], [-1, 0], [0, -1], [0, -2]],
  [[-1, 1], [0, 1], [1, 0], [1, -1]],
  [[-1, 0], [0, -1], [0, 1], [1, 0]],
  [[-1, 0], [0, -1], [0, 1], [0, 2]],
  [[-1, -1], [0, -1], [0, 1], [1, 1]],
];
/**
 * Orientation is 0-7: bit 1 swaps x and y, bit 2 negates y, bit 4 negates x (applied in that
 * order). These tables turn it a quarter clockwise, anticlockwise, and mirror it left to right.
 */
const ROTATE_CW = [5, 4, 1, 0, 7, 6, 3, 2];
const ROTATE_CCW = [3, 2, 7, 6, 1, 0, 5, 4];
const MIRROR = [4, 5, 6, 7, 0, 1, 2, 3];
/** Every hole's height range by size (Hole.MIN_ROWS, MAX_ROWS). */
const MIN_ROWS = [-1, -1, -1, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 7];
const MAX_ROWS = [-1, -1, -1, 3, 4, 4, 5, 6, 6, 7, 8, 9, 10, 10, 10];
/** Running totals of PIECE_WEIGHTS (CarpentryBoard.PIECE_PICKING). */
const PIECE_PICKING = PIECE_WEIGHTS.reduce<number[]>((acc, w) => [...acc, (acc.at(-1) ?? 0) + w], []);
/** A signed byte, as Java keeps them. */
const byte = (n: number) => (n << 24) >> 24;

/**
 * The game's seeded random (puzzle/data/Board$BoardRandom, a java.util.Random), so a seed deals
 * the same holes and pieces as the game.
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

  nextDouble(): number {
    return (this.next(26) * 2 ** 27 + this.next(27)) / 2 ** 53;
  }
}

/**
 * Where a token's 2x2 block can sit on a piece, as the game packs them (q.b): its top-left
 * corner (x << 8 | y), so that the block covers at least one of the piece's cells in its base
 * orientation. The packing sign-extends a negative y into the x byte, so some corners come out
 * as others; the game draws from what it packs, in order. A P can't take the corner (-1, 0).
 */
const tokenCorners: number[][] = [];
function tokenCornersFor(kind: number): number[] {
  if (!tokenCorners[kind]) {
    const set = new Set<number>();
    for (const [x, y] of [[0, 0], ...OFFSETS[kind]]) {
      set.add((x << 8) | y);
      set.add(((x - 1) << 8) | y);
      set.add((x << 8) | (y - 1));
      set.add(((x - 1) << 8) | (y - 1));
    }
    if (PIECE_LETTERS[kind] === 'p') set.delete(-256);
    tokenCorners[kind] = [...set].sort((a, b) => a - b);
  }
  return tokenCorners[kind];
}

/**
 * A token on a piece (q.a(byte, byte, int)): for each of its 5 cells in its base orientation, 0
 * or the token quarter on it, type << 2 | dy << 1 | dx, dx and dy being the cell's place in the block.
 */
export function tokenOnPiece(kind: number, type: number, corner: number): number[] {
  const cx = byte((corner >> 8) & 0xff);
  const cy = byte(corner & 0xff);
  return [[0, 0], ...OFFSETS[kind]].map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1 ? (type << 2) | (dy << 1) | dx : 0;
  });
}

export type Cell = [number, number];

/** A piece (carpentry/q): its toolbox byte (piece << 1 | grain bit) and its orientation. */
export class Piece {
  /** The putty's cells, relative to where it was poured, once it's placed. */
  puttyCells: Cell[] = [];

  constructor(
    readonly tool: number,
    public orient: number,
    /** Token quarters on its cells in its base orientation (tokenOnPiece), or null. */
    readonly tokens: readonly number[] | null = null,
  ) {}

  get kind(): number {
    return this.tool >> 1;
  }

  get letter(): string {
    return PIECE_LETTERS[this.kind];
  }

  get isPutty(): boolean {
    return this.tool === PUTTY_TOOL;
  }

  /** The grain runs across, as dealt: the swap bit matches the piece's grain bit (q.d). */
  get grainKept(): boolean {
    return this.isPutty || (this.orient & 1) === (this.tool & 1);
  }

  /** Cell k (0-4) relative to cell 0 (q.a(int)). */
  cell(k: number): Cell {
    if (this.isPutty) {
      const c = this.puttyCells[k >= this.puttyCells.length ? 0 : k] ?? [0, 0];
      return [c[0], c[1]];
    }
    if (k === 0) return [0, 0];
    const [bx, by] = OFFSETS[this.kind][k - 1];
    let [x, y] = this.orient & 1 ? [by, bx] : [bx, by];
    if (this.orient & 4) x = -x;
    if (this.orient & 2) y = -y;
    return [x + 0, y + 0];
  }

  cells(): Cell[] {
    return [0, 1, 2, 3, 4].map((k) => this.cell(k));
  }

  /** The token quarter on cell k as the piece is turned now, or 0 (q.b(int)). */
  token(k: number): number {
    const t = this.tokens?.[k] ?? 0;
    if (t === 0) return 0;
    let quarter = t & 3;
    if (this.orient & 1 && (quarter === 1 || quarter === 2)) quarter ^= 3;
    if (this.orient & 2) quarter ^= 2;
    if (this.orient & 4) quarter ^= 1;
    return ((t >> 2) << 2) | quarter;
  }

  /** A quarter turn, clockwise or not (q.a(boolean)). */
  rotate(clockwise: boolean): void {
    this.orient = (clockwise ? ROTATE_CW : ROTATE_CCW)[this.orient];
  }

  /** Mirrors left to right (q.e). */
  flip(): void {
    this.orient = MIRROR[this.orient];
  }
}

/** A hole (carpentry/Hole). */
export class Hole {
  /** Size in pieces; 0 for an empty spot. */
  size = 0;
  origSquares = 0;
  /** Cells still open. */
  holeSquares = 0;
  width = 0;
  height = 0;
  piecesUsed = 0;
  /** Placed pieces, last on top. A neglected hole loses the last one. */
  tools: { piece: Piece; at: Cell }[] = [];
  /** The hole as dealt (and grown), [x][y]. */
  origEmpty: boolean[][] = [];
  /** Cells still open, [x][y]. */
  empty: boolean[][] = [];
  badGrains = 0;
  countdown = MAX_NEGLECT;
  knockouts = 0;
  /** Where the hole will grow, picked 3 moves before it does. */
  knock: Cell | null = null;
  /**
   * Token quarters laid in the hole, [x][y] over its 10x10 box and a cell either side, once a
   * plank with a token goes in. Each plank nailed in writes its quarters, or 0s, over its cells;
   * a plank that flies off leaves its quarters behind.
   */
  tokens: number[][] | null = null;
  /** Freeplay mode: where a painted hole's cell (0, 0) sits in its 10x10 box, instead of centred. */
  boxAt: Cell | null = null;

  private constructor(readonly id: number) {}

  /** Where the hole's cell (0, 0) sits in its 10x10 box: centred, as the game lays holes out. */
  get offset(): Cell {
    return this.boxAt ? [this.boxAt[0], this.boxAt[1]] : [Math.trunc((MAX_HOLE - this.width) / 2), Math.trunc((MAX_HOLE - this.height) / 2)];
  }

  /** An empty spot: nothing to fill (Hole(int)). */
  static blank(id: number): Hole {
    return new Hole(id);
  }

  /**
   * A hole of `size` pieces: a block 4 cells narrower than the hole, with the rest of its cells
   * knocked out of the two columns either side (Hole(int, Random, int)).
   */
  static random(size: number, rng: BoardRandom, id: number): Hole {
    const h = new Hole(id);
    h.size = size;
    h.origSquares = size * 5;
    h.height = MIN_ROWS[size];
    const spread = MAX_ROWS[size] - h.height;
    if (spread !== 0) h.height += rng.nextInt(spread + 1);
    do {
      h.width = 4 + Math.trunc(h.origSquares / h.height) - rng.nextInt(2);
      if (h.width > MAX_HOLE) h.height++;
    } while (h.width > MAX_HOLE);
    if (h.height > MAX_HOLE) {
      h.width = MAX_HOLE;
      h.height = MAX_HOLE;
    }
    h.origEmpty = grid(h.width, h.height);
    for (let y = 0; y < h.height; y++) for (let x = 2; x < h.width - 2; x++) h.origEmpty[x][y] = true;
    h.knockOut(h.origSquares - h.height * (h.width - 4), rng, false);
    h.recreateEmpty();
    return h;
  }

  /** A hole of a given shape, [x][y] (Hole(boolean[][])); size is its cells / 5. */
  static shaped(cells: boolean[][], id: number): Hole {
    const h = new Hole(id);
    h.width = cells.length;
    h.height = cells[0].length;
    const count = cells.flat().filter(Boolean).length;
    h.size = Math.trunc(count / 5);
    h.origSquares = count;
    h.origEmpty = cells.map((col) => [...col]);
    h.recreateEmpty();
    return h;
  }

  /**
   * Opens `n` cells beside the hole: a random row, a random side, one cell out from the block (or
   * two, if that one's open already). With `preview`, only picks the next cell to open.
   */
  knockOut(n: number, rng: BoardRandom, preview: boolean): void {
    while (n > 0) {
      const y = rng.nextInt(this.height);
      let x = rng.nextInt(2) === 0 ? 1 : this.width - 2;
      if (this.origEmpty[x][y]) {
        x = x === 1 ? x - 1 : x + 1;
        if (this.origEmpty[x][y]) continue;
      }
      if (preview) this.knock = [x, y];
      else this.origEmpty[x][y] = true;
      n--;
    }
  }

  recreateEmpty(): void {
    this.holeSquares = this.origSquares;
    this.empty = this.origEmpty.map((col) => [...col]);
    for (const t of this.tools) this.cover(t.piece, t.at);
  }

  get filled(): boolean {
    return this.holeSquares === 0 && this.size !== 0;
  }

  get perfect(): boolean {
    return this.piecesUsed === this.size;
  }

  get grainPreserved(): boolean {
    return this.badGrains === 0;
  }

  /** Every piece in the hole is the same shape: "Nice set" (Hole.isHomogenous). */
  get homogenous(): boolean {
    return this.tools.every((t) => t.piece.kind === this.tools[0].piece.kind);
  }

  /**
   * The hole's points (Hole.computeBonus): 2 x size - 4 for a masterpiece and 1 more for a nice
   * set, then size / 2 for keeping the grain.
   */
  computeBonus(): number {
    let points = 0;
    if (this.perfect) {
      points += this.size * 2 - 4;
      if (this.homogenous) points++;
    }
    if (this.grainPreserved) points += Math.trunc(this.size / 2);
    return points;
  }

  /**
   * The token a finished hole hands over (Hole.getBonus): every whole token in it, scanned down
   * each column from the left; the wanted type if there is one, otherwise one at random. After
   * the wanted type turns up the scan still goes on to the next columns, and the last one found is
   * the one given. Returns its type (0 for none) and its top-left in the token grid.
   */
  takeToken(desired: number, rng: BoardRandom): { type: number; at: Cell } | null {
    const t = this.tokens;
    if (!t) return null;
    const found: Cell[] = [];
    let wanted = false;
    for (let x = 0; x < 11; x++) {
      for (let y = 0; y < 11; y++) {
        const v = t[x][y];
        if (v === 0 || (v & 3) !== 0) continue;
        const type = v >> 2;
        const base = type << 2;
        if (t[x + 1][y] === (base | 1) && t[x][y + 1] === (base | 2) && t[x + 1][y + 1] === (base | 3)) {
          found.push([x, y]);
          if (type === desired) {
            wanted = true;
            break;
          }
        }
      }
    }
    if (!found.length) return null;
    const at = found[wanted ? found.length - 1 : rng.nextInt(found.length)];
    return { type: t[at[0]][at[1]] >> 2, at };
  }

  isEmpty(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height && this.empty[x][y];
  }

  /**
   * How many open cells the piece would cover at (x, y), or 0 if it can't go there: it has to
   * cover an open cell at the hole's edge (next to wood or a placed piece). Putty fills an open
   * region of up to 5 cells.
   */
  checkPiece(piece: Piece, x: number, y: number): number {
    if (piece.isPutty) {
      const n = this.puttyList(x, y).length;
      return n > 5 ? 0 : n;
    }
    let count = 0;
    let edge = false;
    for (const [cx, cy] of piece.cells()) {
      const px = cx + x;
      const py = cy + y;
      if (!this.isEmpty(px, py)) continue;
      count++;
      if (!edge && (!this.isEmpty(px - 1, py) || !this.isEmpty(px + 1, py) || !this.isEmpty(px, py - 1) || !this.isEmpty(px, py + 1))) {
        edge = true;
      }
    }
    return edge ? count : 0;
  }

  /** The open region at (x, y), searched left, right, up, down; it stops growing past 5 cells. */
  puttyList(x: number, y: number): Cell[] {
    const list: Cell[] = [];
    const find = (px: number, py: number) => {
      if (list.some(([a, b]) => a === px && b === py) || !this.isEmpty(px, py)) return;
      list.push([px, py]);
      if (list.length <= 5) {
        find(px - 1, py);
        find(px + 1, py);
        find(px, py - 1);
        find(px, py + 1);
      }
    };
    find(x, y);
    return list;
  }

  /** The piece at (x, y) would close the hole. */
  wouldFinish(piece: Piece, x: number, y: number): boolean {
    let count = 0;
    if (piece.isPutty) count = this.puttyList(x, y).length;
    else for (const [cx, cy] of piece.cells()) if (this.isEmpty(cx + x, cy + y)) count++;
    return this.holeSquares === count;
  }

  /** A piece is going into this hole: its neglect count starts over. */
  pieceWillApply(): void {
    this.countdown = MAX_NEGLECT;
  }

  /**
   * A piece went into another hole. An empty hole picks where it'll grow 3 moves ahead and grows
   * after 8 (at most 3 times); a hole with pieces loses its last piece after 8. Returns the cells
   * that opened: 2 for a growth (counted as a penalty), or the cells the lost piece covered.
   */
  pieceNotApplied(rng: BoardRandom): number {
    if (this.holeSquares === 0) return 0;
    if (this.tools.length === 0) {
      if (this.knockouts < MAX_KNOCKOUTS) {
        if (--this.countdown === 3) {
          this.knockOut(1, rng, true);
        } else if (this.countdown === 0) {
          this.origSquares++;
          const [kx, ky] = this.knock!;
          this.origEmpty[kx][ky] = true;
          this.recreateEmpty();
          this.knockouts++;
          this.countdown = MAX_NEGLECT;
          return 2;
        }
      } else {
        this.knock = null;
      }
      return 0;
    }
    if (--this.countdown === 0) {
      this.countdown = MAX_NEGLECT;
      const lost = this.tools.pop()!;
      if (!lost.piece.grainKept) this.badGrains--;
      const before = this.holeSquares;
      this.recreateEmpty();
      return this.holeSquares - before;
    }
    return 0;
  }

  /** Nails the piece in at (x, y); returns the cells it covered (0 if it can't go there). */
  placePiece(piece: Piece, at: Cell): number {
    if (piece.isPutty) {
      const list = this.puttyList(at[0], at[1]);
      if (list.length === 0 || list.length > 5) return 0;
      piece.puttyCells = list.map(([x, y]) => [x - at[0], y - at[1]]);
    } else if (this.checkPiece(piece, at[0], at[1]) === 0) {
      return 0;
    }
    this.piecesUsed++;
    if (!piece.grainKept) this.badGrains++;
    this.tools.push({ piece, at: [at[0], at[1]] });
    return this.cover(piece, at);
  }

  private cover(piece: Piece, at: Cell): number {
    let count = 0;
    const cells = piece.cells();
    for (const [cx, cy] of cells) {
      const x = cx + at[0];
      const y = cy + at[1];
      if (this.isEmpty(x, y)) {
        this.empty[x][y] = false;
        this.holeSquares--;
        count++;
      }
    }
    if (count > 0) {
      cells.forEach(([cx, cy], k) => {
        const token = piece.token(k);
        if (token === 0 && !this.tokens) return;
        this.tokens ??= Array.from({ length: 12 }, () => Array<number>(12).fill(0));
        const x = cx + at[0] + this.offset[0] + 1;
        const y = cy + at[1] + this.offset[1] + 1;
        if (x >= 0 && x < 12 && y >= 0 && y < 12) this.tokens[x][y] = token;
      });
    }
    return count;
  }

  /** 0 for exactly `size` pieces, 1 for one more, 2 for two more, 3 under double, 4 beyond (Hole.getHoleRank). */
  get rank(): number {
    if (this.piecesUsed === this.size) return 0;
    if (this.piecesUsed === this.size + 1) return 1;
    if (this.piecesUsed === this.size + 2) return 2;
    return this.piecesUsed < this.size * 2 ? 3 : 4;
  }

  /** The hole as the game logs it (Hole.dumpHole): '0' open, 'X' covered, '_' wood. */
  dump(): string {
    let s = '';
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) s += this.origEmpty[x][y] ? (this.empty[x][y] ? '0' : 'X') : '_';
      s += '\n';
    }
    return s;
  }
}

function grid(w: number, h: number): boolean[][] {
  return Array.from({ length: w }, () => Array<boolean>(h).fill(false));
}

/** The board (CarpentryBoard): three toolbox pieces and four holes. */
export class CarpentryBoard {
  readonly rng: BoardRandom;
  private toolRng: BoardRandom;
  private toolsGenerated = 0;
  private readonly seed: number | bigint;
  /** Toolbox bytes: piece << 1 | grain bit. */
  readonly toolbox = [0, 0, 0];
  /** The token on each toolbox piece (tokenOnPiece), or null. */
  readonly toolTokens: (number[] | null)[] = [null, null, null];
  /** Holes 0-3: top-left, top-right, bottom-left, bottom-right. */
  holes: Hole[] = [];
  holesGenerated = 0;
  /** Masterpieces in a row, broken by any other rating or by a neglected hole opening up. */
  consecPerfects = 0;

  constructor(
    seed: number | bigint,
    readonly difficulty = VAMPIRE_DIFFICULTY,
    readonly holeSizeOverride = VAMPIRE_HOLE_SIZE,
    /** Index into BONUS_SETS. */
    readonly bonusMode = 0,
    /** The token type the ship wants, or -1. */
    readonly desiredBonus = -1,
    readonly independentStreams = false,
  ) {
    this.seed = seed;
    this.rng = new BoardRandom(seed);
    this.toolRng = this.rng;
    for (let i = 0; i < NUM_TOOLS; i++) this.populateNextTool(i);
    for (let i = 0; i < NUM_HOLES; i++) this.holes[i] = this.getNextHole(i < HOLES_PER_LEVEL[difficulty]);
  }

  toolIndex(tool: number): number {
    return this.toolbox.indexOf(tool);
  }

  holeIndex(id: number): number {
    return this.holes.findIndex((h) => h.id === id);
  }

  getNextHole(real: boolean): Hole {
    this.holesGenerated++;
    if (!real) return Hole.blank(this.holesGenerated);
    // The game leaves the tutorial holes' id at 0.
    if (this.difficulty === 0) return Hole.shaped(tutorialHole(TUTORIAL_0), 0);
    if (this.difficulty === 1) return Hole.shaped(tutorialHole(TUTORIAL_1), 0);
    const rng = this.independentStreams ? new BoardRandom(seedFor(this.seed, 'hole', this.holesGenerated)) : this.rng;
    let size = this.holeSizeOverride;
    if (size < 0) {
      const min = Math.max(4, 6 - this.difficulty);
      const max = Math.min(14, 6 + this.difficulty);
      size = rng.nextInt(max - min + 1) + min;
    }
    return Hole.random(size, rng, this.holesGenerated);
  }

  /**
   * Deals a new piece into a toolbox slot by weight. A putty is drawn again unless the difficulty
   * is 3 or more and there's no putty in the toolbox; the slot being refilled still holds the piece
   * that was just used, so a used putty can't be followed straight away by another. With a token
   * pool, every plank then gets a token: a corner from tokenCornersFor and a type from the pool.
   */
  populateNextTool(slot: number): void {
    if (this.independentStreams) this.toolRng = new BoardRandom(seedFor(this.seed, 'tool', this.toolsGenerated++));
    let piece: number;
    if (this.difficulty !== 0 && this.difficulty !== 1) {
      for (;;) {
        const pick = this.toolRng.nextInt(PIECE_PICKING[12]);
        piece = PIECE_PICKING.findIndex((total) => pick < total);
        if (piece !== PUTTY || (this.difficulty >= 3 && this.toolIndex(PUTTY_TOOL) === -1)) break;
      }
    } else {
      piece = slot === 1 ? 10 : slot === 2 ? 1 : 3;
    }
    this.toolbox[slot] = (piece << 1) | this.grainBit(piece);
    const pool = BONUS_SETS[this.bonusMode] ?? [];
    // The game's chance of a token is 1, but it still draws for it.
    if (pool.length > 0 && this.toolRng.nextDouble() <= 1) {
      if (piece === PUTTY) this.toolTokens[slot] = null;
      else {
        const corners = tokenCornersFor(piece);
        const corner = corners[this.toolRng.nextInt(corners.length)];
        this.toolTokens[slot] = tokenOnPiece(piece, pool[this.toolRng.nextInt(pool.length)], corner);
      }
    } else this.toolTokens[slot] = null;
  }

  /** I, L, N, Y and putty always have their grain across as dealt; the rest at random. */
  private grainBit(piece: number): number {
    return 'ilny0'.includes(PIECE_LETTERS[piece]) ? 1 : this.toolRng.nextInt(2);
  }

  /**
   * A piece is going into hole `target`: every other hole counts a move of neglect. Returns the
   * cells reopened elsewhere.
   */
  pieceWillApply(target: number): number {
    let reopened = 0;
    for (let i = 0; i < NUM_HOLES; i++) {
      if (i === target) this.holes[i].pieceWillApply();
      else reopened += this.holes[i].pieceNotApplied(this.rng);
    }
    if (reopened !== 0) this.consecPerfects = 0;
    return reopened;
  }

  /** A hole just finished: the masterpieces before it in a row, or 0 (CarpentryBoard.checkPerfectBonus). */
  checkPerfectBonus(index: number): number {
    if (this.holes[index].perfect) return this.consecPerfects++;
    this.consecPerfects = 0;
    return 0;
  }

  /**
   * After a hole is finished: if more holes are still needed than are open on the board, a filled
   * row or column of holes (or both) is replaced. The holes that stay slide over and new ones come
   * in behind them; empty spots fill the board once enough holes have been dealt. Returns the
   * direction the board scrolls: x -1 when the left column was filled, 1 the right; y -1 the top
   * row, 1 the bottom; [0, 0] for no scroll (CarpentryBoard.checkForNewHoles).
   */
  checkForNewHoles(needed: number): Cell {
    const filled = this.holes.map((h) => h.filled);
    for (const f of filled) if (!f) needed--;
    if (needed <= 0) return [0, 0];
    const holes: (Hole | null)[] = [...this.holes];
    let dy = 0;
    if (filled[0] && filled[1]) {
      dy = -1;
      holes[0] = holes[1] = null;
    } else if (filled[2] && filled[3]) {
      dy = 1;
      holes[2] = holes[3] = null;
    }
    let dx = 0;
    if (filled[0] && filled[2]) {
      dx = -1;
      holes[0] = holes[2] = null;
    } else if (filled[1] && filled[3]) {
      dx = 1;
      holes[1] = holes[3] = null;
    }
    const shift = dx + 2 * dy;
    if (shift !== 0) {
      const [from, to, step] = shift < 0 ? [0, 4, 1] : [3, -1, -1];
      for (let i = from; i !== to; i += step) {
        const src = i - shift;
        if (src >= 0 && src < 4 && holes[src] !== null) holes[i] = holes[src];
        else holes[i] = this.getNextHole(needed-- > 0);
      }
    }
    this.holes = holes as Hole[];
    return [dx, dy];
  }
}

// The tutorial holes for difficulties 0 and 1 (CarpentryBoard.getNextHole): one string per
// column x, one character per row y, 'X' open.
const TUTORIAL_0 = ['XX_X', 'XXXX', 'X__X', '__XX', '__X_', '__X_', '__X_', '__X_'];
const TUTORIAL_1 = ['X____', 'XX__X', 'X__XX', 'X__XX', 'XXXXX'];

function tutorialHole(columns: string[]): boolean[][] {
  return columns.map((col) => col.split('').map((c) => c === 'X'));
}

/** The tutorial hole the game deals at difficulty 0 or 1, [x][y]. */
export function tutorialCells(difficulty: number): boolean[][] {
  return tutorialHole(difficulty === 0 ? TUTORIAL_0 : TUTORIAL_1);
}
