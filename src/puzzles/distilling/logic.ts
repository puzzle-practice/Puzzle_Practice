// Distilling's rules, ported from the Puzzle Pirates game (crafting/brew, build 20260909165753):
// BrewBoard (the board, swaps and column scoring), BrewController (the furnace timer, burning
// and the end of the session) and the board's seeded random generator (puzzle/data/Board$BoardRandom).
// Nothing here draws; index.ts is the board view.
//
// The board is 10 columns of hexagonal cells. Even columns start tall (9 pieces) and odd columns
// short (8 pieces, drawn half a cell lower). Every furnace cycle the rightmost column (9) leaves
// the board, up into the jug or down into the furnace, everything moves one column right, and a
// new column comes in on the left.

export const WIDTH = 10;
export const HEIGHT = 9;

/** Piece types, as the game numbers them. */
export const LIGHT = 0;
export const MEDIUM = 1;
export const HEAVY = 2;
export const SPICE = 3;
/** A burnt white: swaps like a white but counts as a black when scored. */
export const BURNT = 4;

/** The first 17 pieces made (the two columns next to the furnace) are never spice (PRE_SPICE_COUNT). */
export const PRE_SPICE_COUNT = 17;

/** The furnace ticks every 306 ms (BrewController.n). */
export const TICK_MS = 306;
/** A column burns when the furnace has ticked 49 times since the last one. */
export const BURN_TICKS = 49;
/** The warning sound plays at tick 40 (49 - 3000 / 306), about three seconds before the burn. */
export const WARNING_TICK = BURN_TICKS - Math.trunc(3000 / TICK_MS);
/** The session ends once 100 pieces have gone into the jug... */
export const JUG_PIECES = 100;
/**...unless the column that got there was the 12th or later Crystal Clear in a row. */
export const ENDLESS_STREAK = 12;

/** Cell directions for neighbours: up-right, up-left, down-left, down-right. */
export const UP_RIGHT = 0;
export const UP_LEFT = 1;
export const DOWN_LEFT = 2;
export const DOWN_RIGHT = 3;

/** How a piece swaps: whites (and burnt whites) 0, browns 1, blacks 2; spice never swaps. */
export function pieceBehavior(piece: number): number {
  if (piece === SPICE) return -128;
  if (piece === BURNT) return LIGHT;
  return piece;
}

/** Whites push a column up, blacks down (more blacks than whites burns it). */
export function pieceWeight(piece: number): number {
  switch (piece) {
    case LIGHT:
    case BURNT:
      return -1;
    case HEAVY:
      return 1;
    default:
      return 0;
  }
}

/** Which count a piece goes in: whites, browns, blacks (burnt whites count here) or spices. */
export function pieceTrack(piece: number): number {
  return piece === BURNT ? HEAVY : piece;
}

/** Points per piece in a column that goes into the jug: spice 3, white 1, brown 0, black -1, burnt white -3. */
export function pieceScore(piece: number): number {
  return [1, 0, -1, 3, -3][piece] ?? 0;
}

/**
 * java.util.Random with the game's tweaks (Board$BoardRandom): the same 48-bit generator, so the
 * same seed gives the same board as the game. Seeds are 48-bit; JS numbers can't multiply those
 * exactly, so this uses BigInt.
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
}

/** What happened to a column as it left the board (BrewBoard.scoreRightColumn). */
export interface ColumnResult {
  /** True if it went up into the jug, false if it burned. */
  distilled: boolean;
  lights: number;
  mediums: number;
  /** Blacks and burnt whites. */
  heavies: number;
  spices: number;
  pieces: number;
  /** Points for the pieces: the sum of pieceScore, or -3 per spice if it burned. */
  score: number;
  /** Crystal Clear bonus: 4 for each Crystal Clear in a row before this one. */
  bonus: number;
  /** For a Crystal Clear, how many in a row this makes (0 for the first, which shows no number). */
  streak: number;
  /** The message the game shows: 'clear', 'smooth', 'blecch', 'burnt' or none. */
  verdict: 'clear' | 'smooth' | 'blecch' | 'burnt' | null;
  /** 'spicy', 'wasted_spice' or none. */
  spice: 'spicy' | 'wasted_spice' | null;
  /** The pieces in the column, top to bottom. */
  column: number[];
}

export class BrewBoard {
  /** Columns left to right, each top to bottom. */
  columns: number[][] = [];
  /** Whites burned since the last burnt white was made: every two make one. */
  discardedLights = 0;
  piecesGenerated = 0;
  consecCrystal = 0;
  readonly rando: BoardRandom;
  /** Practice modes can replace how new pieces are picked, one at a time... */
  pickPiece: (() => number) | null = null;
  /**...or a column at a time (top to bottom, the length asked for). Burnt whites owed still replace whites. */
  makeColumn: ((tall: boolean) => number[]) | null = null;

  constructor(seed: number | bigint) {
    this.rando = new BoardRandom(seed);
    this.populate();
  }

  /** A board laid out by hand (practice boards, pasted seeds); new columns still come from the seed. */
  static withColumns(columns: number[][], seed: number | bigint): BrewBoard {
    const board = new BrewBoard(seed);
    board.columns = columns.map((c) => [...c]);
    return board;
  }

  getPiece(x: number, y: number): number {
    return this.columns[x][y];
  }

  isTallColumn(x: number): boolean {
    return this.columns[x].length === HEIGHT;
  }

  isAdjacent(x1: number, y1: number, x2: number, y2: number): boolean {
    return Math.abs(x1 - x2) === 1 && (y1 === y2 || y1 === y2 + (this.isTallColumn(x1) ? 1 : -1));
  }

  /**
   * Two neighbours swap if the lower piece "beats" the upper one: a white rises past a black,
   * a brown past a white and a black past a brown. A swap can't be undone straight away.
   */
  isSwappable(x1: number, y1: number, x2: number, y2: number): boolean {
    if (!this.isAdjacent(x1, y1, x2, y2)) return false;
    // Make (x1, y1) the upper piece.
    if (this.isTallColumn(x1) !== (y1 === y2)) [x1, y1, x2, y2] = [x2, y2, x1, y1];
    const diff = pieceBehavior(this.columns[x1][y1]) - pieceBehavior(this.columns[x2][y2]);
    return diff === -1 || diff === 2;
  }

  swap(x1: number, y1: number, x2: number, y2: number): boolean {
    if (!this.isSwappable(x1, y1, x2, y2)) return false;
    const piece = this.columns[x1][y1];
    this.columns[x1][y1] = this.columns[x2][y2];
    this.columns[x2][y2] = piece;
    return true;
  }

  /** The neighbour in a direction (UP_RIGHT...), or null off the board. */
  neighbour(x: number, y: number, dir: number): [number, number] | null {
    const tall = this.isTallColumn(x);
    const nx = dir === UP_RIGHT || dir === DOWN_RIGHT ? x + 1 : x - 1;
    const ny = dir === UP_RIGHT || dir === UP_LEFT ? y - (tall ? 1 : 0) : y + (tall ? 0 : 1);
    if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT - (tall ? 1 : 0)) return null;
    return [nx, ny];
  }

  /** Bit d is set if the piece can swap in direction d; the piece's art lights that corner. */
  swapMask(x: number, y: number): number {
    if (this.columns[x][y] === SPICE) return 0;
    let mask = 0;
    for (let dir = 0; dir < 4; dir++) {
      const n = this.neighbour(x, y, dir);
      if (n && this.isSwappable(x, y, n[0], n[1])) mask |= 1 << dir;
    }
    return mask;
  }

  /** Every swap that can be made now, each once. */
  allSwaps(): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    for (let x = 0; x < WIDTH - 1; x++) {
      for (let y = 0; y < this.columns[x].length; y++) {
        for (const dir of [UP_RIGHT, DOWN_RIGHT]) {
          const n = this.neighbour(x, y, dir);
          if (n && this.isSwappable(x, y, n[0], n[1])) out.push([x, y, n[0], n[1]]);
        }
      }
    }
    return out;
  }

  /** Scores the rightmost column (BrewBoard.scoreRightColumn plus BrewController's messages). */
  scoreRightColumn(): ColumnResult {
    const column = this.columns[WIDTH - 1];
    const counts = [0, 0, 0, 0];
    let weight = 0;
    let score = 0;
    for (const piece of column) {
      weight += pieceWeight(piece);
      score += pieceScore(piece);
      counts[pieceTrack(piece)]++;
    }
    const [lights, mediums, heavies, spices] = counts;
    const result: ColumnResult = {
      distilled: weight <= 0,
      lights,
      mediums,
      heavies,
      spices,
      pieces: column.length,
      score: 0,
      bonus: 0,
      streak: 0,
      verdict: null,
      spice: null,
      column: [...column],
    };
    if (!result.distilled) {
      this.consecCrystal = 0;
      this.discardedLights += lights;
      result.score = spices ? -spices * pieceScore(SPICE) : 0;
      if (lights > 0) result.verdict = 'burnt';
      if (spices > 0) result.spice = 'wasted_spice';
      return result;
    }
    result.score = score;
    if (mediums === 0 && heavies === 0) {
      result.bonus = 4 * this.consecCrystal;
      result.streak = this.consecCrystal ? this.consecCrystal + 1 : 0;
      this.consecCrystal++;
    } else this.consecCrystal = 0;
    // BrewController.a(boolean, int[]): a column with no blacks is Crystal Clear if it has no browns
    // either, or Smooth if it has more whites than browns; any blacks at least equal to the whites is Blecch.
    if (heavies === 0) {
      if (mediums === 0) result.verdict = 'clear';
      else if (lights / mediums > 1) result.verdict = 'smooth';
    } else if (heavies / lights >= 1) result.verdict = 'blecch';
    if (spices > 0) result.spice = 'spicy';
    return result;
  }

  /** Moves every column right and makes a new one on the left (BrewBoard.addNextColumn). */
  addNextColumn(): void {
    this.columns.pop();
    this.columns.unshift([]);
    this.populateColumn(0, !this.isTallColumn(1), false);
  }

  /** The starting board: the furnace column is all blacks, the rest random (BrewBoard.populate). */
  protected populate(): void {
    this.piecesGenerated = 0;
    this.columns = new Array(WIDTH).fill(null).map(() => []);
    for (let x = WIDTH - 1; x >= 0; x--) this.populateColumn(x, x % 2 === 0, x === WIDTH - 1);
  }

  protected populateColumn(x: number, tall: boolean, allHeavy: boolean): void {
    const n = HEIGHT - (tall ? 0 : 1);
    if (this.makeColumn && !allHeavy) {
      this.columns[x] = this.makeColumn(tall)
        .slice(0, n)
        .map((piece) => this.owe(piece));
      this.piecesGenerated += n;
      return;
    }
    const column: number[] = [];
    for (let y = 0; y < n; y++) column.push(allHeavy ? HEAVY : this.nextPiece());
    this.columns[x] = column;
  }

  /**
   * A new piece: 1 in 31 is spice (none in the first 17), the rest white, brown or black evenly.
   * A white becomes a burnt white while two or more burned whites are owed (BrewBoard.getNextPiece).
   */
  nextPiece(): number {
    if (this.pickPiece) {
      this.piecesGenerated++;
      return this.owe(this.pickPiece());
    }
    const r = this.rando.nextInt(this.piecesGenerated++ < PRE_SPICE_COUNT ? 30 : 31);
    if (r === 30) return SPICE;
    return this.owe(r % 3);
  }

  owe(piece: number): number {
    if (piece === LIGHT && this.discardedLights >= 2) {
      this.discardedLights -= 2;
      return BURNT;
    }
    return piece;
  }
}

/** Events from the furnace for the view to show. */
export type FurnaceEvent = { type: 'warning' } | { type: 'burn'; result: ColumnResult; finished: boolean };

/**
 * The furnace and the session (BrewController): the timer that burns a column every 50 ticks,
 * waiting for swaps in flight, burning early on request, and the totals in the jug.
 */
export interface GameOptions {
  /** Milliseconds per furnace tick; 50 ticks burn a column. The game's is 306 (15.3 s a column). */
  tickMs?: number;
  /** No furnace clock: columns burn only when asked (X or right-click). */
  timerless?: boolean;
  /** Never end the session (the simulator's Create mode). */
  endless?: boolean;
}

export class BrewGame {
  board: BrewBoard;
  readonly tickMs: number;
  readonly timerless: boolean;
  readonly endless: boolean;
  /** When the furnace clock was paused, or null. */
  pausedAt: number | null = null;
  /** Furnace ticks since the last burn (BrewController.u); the furnace art shows 49 - furnace. */
  furnace = 0;
  /** Highest the furnace got. */
  maxFurnace = 0;
  /** A burn is due but waiting for swaps to finish (BrewController.p). */
  burnDue = false;
  /** No swap is animating (BrewController.q). */
  settled = true;
  /** Pieces in the jug (BrewController.r): the session ends at 100. */
  distilled = 0;
  /** Whites and blacks (including burnt whites) in the jug, for the vial's colour. */
  jugLights = 0;
  jugHeavies = 0;
  /** Points for each column (128 + score + bonus, less the 128). */
  points = 0;
  /** Longest Crystal Clear chain reached during this session. */
  longestCrystalChain = 0;
  /** Browns, blacks and burnt whites remaining before the first Crystal Clear's replacement enters. */
  junkLeft: number | null = null;
  finished = false;
  columns: ColumnResult[] = [];
  /** The furnace's own clock, so a burn on request restarts the 306 ms rhythm. */
  private nextTick = 0;

  constructor(seed: number | bigint | BrewBoard, now = 0, options: GameOptions = {}) {
    this.board = seed instanceof BrewBoard ? seed : new BrewBoard(seed);
    this.tickMs = options.tickMs ?? TICK_MS;
    this.timerless = !!options.timerless;
    this.endless = !!options.endless;
    this.nextTick = now + this.tickMs;
  }

  /** Runs the furnace up to time `now`; returns what happened. */
  update(now: number): FurnaceEvent[] {
    const events: FurnaceEvent[] = [];
    if (this.timerless || this.pausedAt !== null) return events;
    while (!this.finished && now >= this.nextTick) {
      this.nextTick += this.tickMs;
      this.tick(events);
    }
    return events;
  }

  /** Stops the furnace clock (a practice extra: the real puzzle can't be paused). */
  timeUntilBurn(now: number): number {
    if (this.timerless || this.finished) return 0;
    const at = this.pausedAt ?? now;
    return Math.max(0, this.nextTick - at + Math.max(0, BURN_TICKS - this.furnace) * this.tickMs);
  }

  pause(now: number): void {
    if (this.pausedAt === null) this.pausedAt = now;
  }

  resume(now: number): void {
    if (this.pausedAt === null) return;
    this.nextTick += now - this.pausedAt;
    this.pausedAt = null;
  }

  /** One furnace tick (BrewController.q). */
  private tick(events: FurnaceEvent[]): void {
    if (this.furnace === WARNING_TICK) events.push({ type: 'warning' });
    if (this.furnace >= BURN_TICKS) {
      this.burnDue = true;
      this.tryBurn(events);
    }
    this.furnace++;
    this.maxFurnace = Math.max(this.maxFurnace, this.furnace);
  }

  /** Swaps started or finished animating; a due burn waits for them (BrewController.b). */
  setSettled(settled: boolean, events: FurnaceEvent[] = []): FurnaceEvent[] {
    this.settled = settled;
    this.tryBurn(events);
    return events;
  }

  /** Burn the column now: the X key, or right-click if that's turned on (BrewController "endCol"). */
  burnNow(now: number): FurnaceEvent[] {
    const events: FurnaceEvent[] = [];
    if (this.finished) return events;
    this.nextTick = now + this.tickMs;
    this.furnace = Number.MAX_SAFE_INTEGER;
    this.tick(events);
    return events;
  }

  /** BrewController.r: burn if one is due and nothing is moving. */
  private tryBurn(events: FurnaceEvent[]): void {
    if (!this.burnDue || !this.settled || this.finished) return;
    this.burnDue = false;
    this.furnace = -1;
    const result = this.board.scoreRightColumn();
    this.longestCrystalChain = Math.max(this.longestCrystalChain, this.board.consecCrystal);
    if (this.junkLeft === null && result.verdict === 'clear') {
      this.junkLeft = this.board.columns.slice(0, WIDTH - 1).reduce(
        (sum, column) => sum + column.filter((piece) => piece !== LIGHT && piece !== SPICE).length, 0,
      );
    }
    this.board.addNextColumn();
    this.columns.push(result);
    if (result.distilled) {
      this.distilled += result.pieces;
      this.jugLights += result.lights;
      this.jugHeavies += result.heavies;
    }
    this.points += result.score + result.bonus;
    // The streak number the game checks is 1 + bonus / 4, or 0 with no bonus.
    const level = result.bonus === 0 ? 0 : 1 + result.bonus / 4;
    const finished = !this.endless && this.distilled >= JUG_PIECES && level < ENDLESS_STREAK;
    if (finished) this.finished = true;
    events.push({ type: 'burn', result, finished });
  }

  /** How full the furnace art is: the hot part's top edge, 10 (hottest) to 59 (BrewBoardView.a(int)). */
  furnaceLevel(): number {
    return 10 + Math.max(0, BURN_TICKS - this.furnace);
  }
}

/** The vial's liquid (BrewIndicator.a): its level 0-1, and an HSB colour and opacity from the jug's mix. */
export function vialLiquid(pieces: number, lights: number, heavies: number): { level: number; hue: number; sat: number; bri: number; alpha: number } {
  const level = Math.min(1, pieces / 100);
  const lightShare = lights / pieces;
  const heavyShare = heavies / pieces;
  const purity = Math.min(1, Math.max(0, (lightShare * (1 - heavyShare) - 0.25) / 0.75));
  let sat = 1;
  let bri = 1;
  let alpha: number;
  if (purity >= 0.5) {
    sat = 1 - ((purity - 0.5) / 0.5) * 0.75;
    alpha = 1 - purity;
  } else {
    bri = 1 - ((0.5 - purity) / 0.5) * 0.75;
    alpha = 0.5;
  }
  return { level, hue: 0.13611111, sat, bri, alpha };
}
