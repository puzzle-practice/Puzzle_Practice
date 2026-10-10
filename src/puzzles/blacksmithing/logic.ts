// Blacksmithing's rules, ported from the game (build 20260909165753), package
// com.threerings.piracy.puzzle.crafting.iron: IronBoard, Chain, Piece and the constants class
// iron/a/a. No drawing here, so it can be tested.
//
// The board is 6x6, indexed [x][y] like the game (x is the column). Every square takes three
// strikes; each strike cools it (hot, warm, cool, gone) and restamps it with a new random piece.
// The piece just struck decides which squares may be struck next.

export const SIZE = 6;
/** Strikes on a fresh board: 36 squares, three each. */
export const TOTAL_HITS = SIZE * SIZE * 3;

/** Piece types (iron/a/a.a): '1', '2', '3', '4', 'B', 'K', 'R', 'Q', 'W'. */
export const ONE = 0;
export const TWO = 1;
export const THREE = 2;
export const FOUR = 3;
export const BISHOP = 4;
export const KNIGHT = 5;
export const ROOK = 6;
export const QUEEN = 7;
/** The rum jug: wild. */
export const WILD = 8;
export const PIECE_CHARS = ['1', '2', '3', '4', 'B', 'K', 'R', 'Q', 'W'];
export const PIECE_NAMES = ['1', '2', '3', '4', 'Bishop', 'Knight', 'Rook', 'Queen', 'Rum jug'];

export const isNumeric = (type: number) => type >= ONE && type <= FOUR;
export const asNumber = (type: number) => type + 1;

/**
 * Strike counts at which the blade reaches each done level (data/a.l_): a club, a hefty blade,
 * finely balanced, keen edge, a masterpiece.
 */
export const DONE_THRESHOLDS = [0, 78, 92, 102, 108];

/** The done level (0-4) after this many strikes (IronBoard.getDoneLevel). */
export function doneLevelFor(hits: number): number {
  for (let i = 0; i < DONE_THRESHOLDS.length; i++) if (hits < DONE_THRESHOLDS[i]) return i - 1;
  return DONE_THRESHOLDS.length - 1;
}

// ---- Spawn weights (iron/a/a) ----

/** Which types each board difficulty uses at all (a.c). */
const TYPE_ON: number[][] = [
  [1, 1, 1, 0, 0, 0, 0, 0, 0],
  [1, 1, 1, 0, 1, 1, 1, 0, 0],
  [1, 1, 1, 1, 1, 1, 1, 1, 0],
  [1, 1, 1, 1, 1, 1, 1, 1, 0],
];

const NO_CORNERS = cells((x, y) => (isCorner(x, y) ? 0 : 1));
const FEW_CORNERS = cells((x, y) => (isCorner(x, y) ? 0.3 : 1));
const NO_MIDDLE = cells((x, y) => (x >= 2 && x <= 3 && y >= 2 && y <= 3 ? 0 : 1));

/**
 * Per-square multipliers by difficulty and type (a.d): no bishops in corners from difficulty 1,
 * no rooks in corners at 1 and fewer from 2, no fours in the middle four squares from 2.
 */
const SQUARE_MASK: (number[] | null)[][] = [
  [null, null, null, null, null, null, null, null, null],
  [null, null, null, null, NO_CORNERS, null, NO_CORNERS, null, null],
  [null, null, null, NO_MIDDLE, NO_CORNERS, null, FEW_CORNERS, null, null],
  [null, null, null, NO_MIDDLE, NO_CORNERS, null, FEW_CORNERS, null, null],
];

/** Relative frequency of each type on each square, at every difficulty (a.e), indexed x * 6 + y. */
const SQUARE_WEIGHT: number[][] = [
  [3, 5, 5, 5, 5, 3, 5, 8, 8, 8, 8, 5, 5, 8, 8, 8, 8, 5, 5, 8, 8, 8, 8, 5, 5, 8, 8, 8, 8, 5, 3, 5, 5, 5, 5, 3],
  [3, 3, 5, 5, 3, 3, 3, 3, 5, 5, 3, 3, 5, 5, 8, 8, 5, 5, 5, 5, 8, 8, 5, 5, 3, 3, 5, 5, 3, 3, 3, 3, 5, 5, 3, 3],
  Array(36).fill(3),
  [3, 3, 1, 1, 3, 3, 3, 3, 1, 1, 3, 3, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 3, 3, 1, 1, 3, 3, 3, 3, 1, 1, 3, 3],
  [1, 2, 2, 2, 2, 1, 2, 4, 4, 4, 4, 2, 2, 4, 4, 4, 4, 2, 2, 4, 4, 4, 4, 2, 2, 4, 4, 4, 4, 2, 1, 2, 2, 2, 2, 1],
  [2, 3, 4, 4, 3, 2, 3, 4, 6, 6, 4, 3, 4, 6, 8, 8, 6, 4, 4, 6, 8, 8, 6, 4, 3, 4, 6, 6, 4, 3, 2, 3, 4, 4, 3, 2],
  [2, 3, 3, 3, 3, 2, 3, 4, 4, 4, 4, 3, 3, 4, 4, 4, 4, 3, 3, 4, 4, 4, 4, 3, 3, 4, 4, 4, 4, 3, 2, 3, 3, 3, 3, 2],
  [3, 5, 5, 5, 5, 3, 5, 8, 8, 8, 8, 5, 5, 8, 8, 8, 8, 5, 5, 8, 8, 8, 8, 5, 5, 8, 8, 8, 8, 5, 3, 5, 5, 5, 5, 3],
  Array(36).fill(0),
];

function isCorner(x: number, y: number): boolean {
  return (x === 0 || x === SIZE - 1) && (y === 0 || y === SIZE - 1);
}

function cells(f: (x: number, y: number) => number): number[] {
  const out: number[] = [];
  for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) out.push(f(x, y));
  return out;
}

/** The weight of every type on every square, indexed [x * 6 + y][type] (a.a(int, true)). */
export function spawnWeights(difficulty: number): number[][] {
  const out: number[][] = [];
  for (let cell = 0; cell < SIZE * SIZE; cell++) {
    out.push(PIECE_CHARS.map((_, type) => TYPE_ON[difficulty][type] * (SQUARE_MASK[difficulty][type]?.[cell] ?? 1) * SQUARE_WEIGHT[type][cell]));
  }
  return out;
}

/** samskivert's RandomUtil.getWeightedIndex: picks an index in proportion to its weight. */
export function weightedIndex(weights: readonly number[], random: () => number): number {
  const sum = weights.reduce((a, b) => a + b, 0);
  let pick = random() * sum;
  for (let i = 0; i < weights.length; i++) {
    pick -= weights[i];
    if (pick < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Maps the puzzle difficulty the game is played at (1-4, as on YPPedia) to the board's
 * difficulty. 1: numbers 1-3. 2: adds rook, bishop and knight. 3: adds the four and the
 * queen. 4: as 3, plus rum jugs.
 */
export function boardDifficulty(level: number): number {
  return Math.max(0, Math.min(3, level - 1));
}

// ---- Chain (data/Chain) ----

/** Wilds match anything (Chain.equivalent). */
const equivalent = (a: number, b: number) => a === b || a === WILD || b === WILD;

/**
 * The run of recent strikes that counts toward a combo: either a chain of one type ("Double!",
 * "Triple!",...) or alternating complete sets of numbers and chess pieces.
 */
export class Chain {
  readonly piecesPerSet: number;
  inChessSet = false;
  inNumericSet = false;
  identicalType = -1;
  chain: number[] = [];
  private readonly ascending: number[];
  private readonly descending: number[];

  constructor(readonly difficulty: number) {
    this.piecesPerSet = difficulty === 0 || difficulty === 1 ? 3 : 4;
    this.ascending = Array.from({ length: this.piecesPerSet }, (_, i) => i);
    this.descending = [...this.ascending].reverse();
  }

  /**
   * The chain that starts when `type` can't extend `prev`: the longest tail of prev's unfinished
   * set that `type` can still follow, or just `type`.
   */
  static after(prev: Chain, type: number): Chain {
    const next = new Chain(prev.difficulty);
    if (!prev.isIdentical()) {
      const size = prev.size();
      for (let start = size - (size % next.piecesPerSet); start < size; start++) {
        let ok = true;
        for (let i = start; i < size && ok; i++) ok = next.add(prev.chain[i]);
        if (ok && next.add(type)) return next;
        next.chain = [];
        next.inChessSet = false;
        next.inNumericSet = false;
      }
    }
    next.add(type);
    return next;
  }

  size(): number {
    return this.chain.length;
  }

  last(): number {
    return this.chain[this.chain.length - 1];
  }

  isIdentical(): boolean {
    return this.identicalType !== -1;
  }

  numSets(): number {
    return Math.floor(this.chain.length / this.piecesPerSet);
  }

  justCompletedSet(): boolean {
    return (this.inNumericSet || this.inChessSet) && this.chain.length > 0 && this.chain.length % this.piecesPerSet === 0;
  }

  /** The set being built (or the one just finished): what the anvil shows. */
  activeSet(): number[] {
    if (!this.chain.length) return [];
    const n = this.chain.length % this.piecesPerSet || this.piecesPerSet;
    return this.chain.slice(-n);
  }

  /** 1-2-3(-4) or the reverse, wilds filling gaps: "By the Numbers!". */
  isActiveSetOrdered(): boolean {
    const set = this.activeSet();
    const same = (target: number[]) => set.length === target.length && set.every((t, i) => equivalent(t, target[i]));
    return same(this.ascending) || same(this.descending);
  }

  /** Adds a strike if it continues this chain; false (and unchanged) if it doesn't. */
  add(type: number): boolean {
    if (this.isIdentical()) {
      if (!equivalent(type, this.identicalType)) return false;
    } else if (this.inChessSet || this.inNumericSet) {
      const setDone = this.chain.length % this.piecesPerSet === 0;
      // A finished set must be followed by a set of the other kind.
      if (setDone) this.flipKind();
      if (type !== WILD) {
        if (!setDone && this.activeSet().includes(type)) return false;
        if (isNumeric(type) !== this.inNumericSet) {
          if (setDone) this.flipKind();
          return false;
        }
      }
    } else if (type !== WILD) {
      const first = this.chain.find((t) => t !== WILD);
      if (first !== undefined) {
        if (first === type) this.identicalType = type;
        else {
          if (isNumeric(type) !== isNumeric(first)) return false;
          this.inNumericSet = isNumeric(first);
          this.inChessSet = !this.inNumericSet;
        }
      }
    }
    this.chain.push(type);
    return true;
  }

  private flipKind(): void {
    this.inNumericSet = !this.inNumericSet;
    this.inChessSet = !this.inChessSet;
  }
}

// ---- Board (data/IronBoard) ----

export interface Piece {
  x: number;
  y: number;
  type: number;
  /** Strikes left: 3 hot, 2 warm, 1 cool, 0 gone. */
  condition: number;
}

/** What one strike did, for messages, sounds and the session tally. */
export interface Strike {
  piece: Piece;
  /** The type struck (the piece now shows its replacement). */
  struck: number;
  chain: Chain;
  /** The blade's done level went up with this strike. */
  doneLevelUp: boolean;
  /** No square can be struck next: the sword is finished. */
  finished: boolean;
}

/**
 * The real game's board is 6x6 with three strikes a square and random restamps. A layout (from
 * perfectBoard) instead gives a smaller board whose squares take one strike each.
 */
export interface Layout {
  size: number;
  /** The piece on each square, [x][y]. */
  types: number[][];
}

export class IronBoard {
  readonly weights: number[][];
  readonly size: number;
  /** Strikes each square takes: 3 in the real game, 1 on a layout. */
  readonly strikesPerSquare: number;
  pieces: Piece[][] = [];
  selected: Piece | null = null;
  chain: Chain;
  numHits = 0;

  constructor(
    readonly difficulty: number,
    private readonly random: () => number,
    private readonly layout?: Layout,
  ) {
    this.weights = spawnWeights(difficulty);
    this.size = layout?.size ?? SIZE;
    this.strikesPerSquare = layout ? 1 : 3;
    this.chain = new Chain(difficulty);
    this.populate();
  }

  populate(): void {
    this.selected = null;
    this.numHits = 0;
    this.pieces = [];
    for (let x = 0; x < this.size; x++) {
      this.pieces.push([]);
      for (let y = 0; y < this.size; y++) {
        this.pieces[x].push({ x, y, type: this.layout ? this.layout.types[x][y] : this.draw(x, y), condition: this.strikesPerSquare });
      }
    }
    this.chain = new Chain(this.difficulty);
  }

  /** Squares still standing. */
  remaining(): number {
    return this.pieces.flat().filter((p) => p.condition > 0).length;
  }

  private draw(x: number, y: number): number {
    return weightedIndex(this.weights[x * SIZE + y], this.random);
  }

  doneLevel(): number {
    return doneLevelFor(this.numHits);
  }

  /** Strikes the square at (x, y), or returns null if it can't be struck now. */
  hit(x: number, y: number): Strike | null {
    if (!this.isHittable(x, y)) return null;
    const level = this.doneLevel();
    const piece = this.pieces[x][y];
    const struck = piece.type;
    this.selected = piece;
    if (!this.chain.add(struck)) this.chain = Chain.after(this.chain, struck);
    const condition = --piece.condition;
    if (!this.layout) {
      // The last square of a layer to be struck comes back as a rum jug, at the top difficulty.
      const lastOfLayer = this.pieces.every((col) => col.every((p) => p.condition <= condition));
      piece.type = lastOfLayer && this.difficulty === 3 ? WILD : this.draw(x, y);
    }
    this.numHits++;
    return { piece, struck, chain: this.chain, doneLevelUp: this.doneLevel() !== level, finished: this.findHittable().length === 0 };
  }

  findHittable(): Piece[] {
    const out: Piece[] = [];
    for (let x = 0; x < this.size; x++) for (let y = 0; y < this.size; y++) if (this.isHittable(x, y)) out.push(this.pieces[x][y]);
    return out;
  }

  isHittable(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return false;
    const from = this.selected;
    if (!from) return true;
    if (this.pieces[x][y].condition === 0) return false;
    return canMove(this.chain.last(), from.x, from.y, x, y, this.size);
  }
}

/**
 * Whether a piece of this type at (fx, fy) lets the next strike land on (tx, ty), on a board
 * `size` squares wide (IronBoard.isHittable, where the board is always 6).
 */
export function canMove(type: number, fx: number, fy: number, tx: number, ty: number, size = SIZE): boolean {
  const dx = Math.abs(tx - fx);
  const dy = Math.abs(ty - fy);
  if (dx === 0 && dy === 0) return false;
  const edgeColumn = tx === 0 || tx === size - 1;
  const edgeRow = ty === 0 || ty === size - 1;
  const bishop = dx === dy && (edgeColumn || edgeRow);
  const rook = (dx > 0 && dy === 0 && edgeColumn) || (dy > 0 && dx === 0 && edgeRow);
  switch (type) {
    case WILD:
      return true;
    case KNIGHT:
      return (dx === 2 && dy === 1) || (dx === 1 && dy === 2);
    case BISHOP:
      return bishop;
    case ROOK:
      return rook;
    case QUEEN:
      return rook || bishop;
    default: {
      const n = asNumber(type);
      return (dx === n && dy === n) || (dx === n && dy === 0) || (dx === 0 && dy === n);
    }
  }
}

// ---- Perfect boards (a practice mode; not in the game) ----

export const MIN_PERFECT_SIZE = 1;
export const MAX_PERFECT_SIZE = 5;

/** The pieces a difficulty uses (never the rum jug, which only appears as a reward). */
export function piecesFor(difficulty: number): number[] {
  return TYPE_ON[difficulty].flatMap((on, type) => (on && type !== WILD ? [type] : []));
}

/**
 * A board, `size` squares wide with one strike per square, that can be cleared completely.
 * Picks a random order to strike every square in, each step reachable from the last by some
 * piece the difficulty uses, then stamps each square with a random piece that makes its step.
 * The last square gets any piece. Also returns the order, as one solution.
 */
export function perfectBoard(size: number, difficulty: number, random: () => number): Layout & { solution: [number, number][] } {
  const pieces = piecesFor(difficulty);
  const squares: [number, number][] = [];
  for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) squares.push([x, y]);
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const shuffle = <T>(items: T[]) => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const movers = (from: [number, number], to: [number, number]) => pieces.filter((t) => canMove(t, from[0], from[1], to[0], to[1], size));

  // Depth-first over orders, trying squares in random order. Boards up to 5x5 solve quickly;
  // the step budget only guards against a slow start square, which is then retried.
  for (;;) {
    const path: [number, number][] = [pick(squares)];
    const used = new Set([path[0].join()]);
    let steps = 0;
    const extend = (): boolean => {
      if (path.length === squares.length) return true;
      if (++steps > 20000) return false;
      const here = path[path.length - 1];
      for (const next of shuffle(squares)) {
        if (used.has(next.join()) || !movers(here, next).length) continue;
        path.push(next);
        used.add(next.join());
        if (extend()) return true;
        path.pop();
        used.delete(next.join());
      }
      return false;
    };
    if (!extend()) continue;
    const types = Array.from({ length: size }, () => Array<number>(size).fill(0));
    path.forEach((sq, i) => (types[sq[0]][sq[1]] = i + 1 < path.length ? pick(movers(sq, path[i + 1])) : pick(pieces)));
    return { size, types, solution: path };
  }
}

/** Points for a perfect board: 3 for clearing it, 1 for leaving one square, otherwise none. */
export function perfectPoints(remaining: number): number {
  return remaining === 0 ? 3 : remaining === 1 ? 1 : 0;
}

// ---- Messages (rsrc/en/i18n/puzzle/iron.properties) ----

export const CHAIN_OF_KIND: Record<number, string> = { 2: 'Double!', 3: 'Triple!', 4: 'Bingo!', 5: 'Donkey!', 6: 'Vegas!' };
export const SET_MESSAGES = { numbers: 'In the Rhythm!', ordered: 'By the Numbers!', chess: "Fancy Hammerin'!" };
/** Alternating sets, by how many in a row (m.long_chain_all2-27). */
export const LONG_CHAIN = [
  '', '', 'Ferrous!', 'Finely honed!', 'Well tempered!', 'Cleanly struck!', 'Sharp work!', 'Great cannon balls of fire!',
  'Get stoked!', 'Forge ahead!', 'A kraken-slayer!', 'Go hammer and tongs!', 'Saber Dance!', 'Anvil Chorus!',
  'Excellent Caliber!', 'Steel yourself!', 'Happy Hrunting!', 'Vorpal!', 'Master Stoke!', 'Snicker-snack!',
  'Is Mjollnir your hammer?', 'Skill of Wayland!', 'Craftsmanship of Eitri!', 'Envy of Hephaestus!', 'Weld done!',
  'Oh, the irony!', 'Hammer Time!', "I'm smelting!  Smelllltiiing!",
];
export const BOARD_DONE = ['Maybe use that one as a club.', 'A hefty blade!', 'Finely Balanced!', 'Keen Edge!', 'A Masterpiece!'];
export const FINISHED = 'Finished!';
export const WILD_REVEALED = 'Molten!';
