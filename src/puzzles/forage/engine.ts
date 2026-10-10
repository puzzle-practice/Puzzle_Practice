// Forage moves, cascades and animation steps. Each move turns a 2x2 group or uses a tool.
// The board repeats gravity, collection, matching and crate placement until settled,
// then advances the ants and settles again. CrateSource supplies each mode's crates.
import {
  CRATE_SIZES,
  CratePoints,
  crateSize,
  EARTHQUAKE,
  EMPTY,
  ForageBoard,
  HEIGHT,
  isAnts,
  isCrate,
  isCrateAnchor,
  isTool,
  MACHETE,
  makeCrate,
  MONKEY,
  SHOVEL,
  WIDTH,
} from './board';

/** [x, y] in cells; off the board for pieces coming in or leaving. */
export type Cell = [number, number];

/** Cells are 45px (ForageBoardView). */
export const CELL = 45;

/**
 * Randomness that only changes how moves look (slide lengths, wobble, the monkey's side). The
 * view points it at a seeded source so a replayed session animates exactly as it was played.
 */
export const looks = { random: Math.random };

/** Animation timings in milliseconds, from the game. */
export const TIMING = {
  /** A 2x2 turn: each piece slides straight to its new cell. */
  turn: 250,
  /** Gravity: 45px x rows at 0.35 x 1.5 px/ms, truncated per piece. */
  fall: (rows: number) => Math.trunc((CELL * rows) / Math.fround(Math.fround(0.35) * 1.5)),
  /** New chests drop in at the same speed as the pieces that refill the board, 85ms a row. */
  chestEntry: (rows: number) => Math.trunc((CELL * rows) / Math.fround(Math.fround(0.35) * 1.5)),
  /** Earthquake: 45px x columns at 0.1 px/ms, plus up to 20% more at random. */
  slide: (columns: number) => {
    const t = Math.trunc((CELL * columns) / Math.fround(0.1));
    return Math.trunc(t + Math.floor(looks.random() * Math.trunc(t * 0.2)) - 0.1);
  },
  /** The earthquake's pieces bob up and down 9px (a fifth of a cell) at 0.03 rad/ms. */
  wobblePx: CELL / 5,
  wobbleRate: 0.03,
  /** Ants walk 45px at 0.35 px/ms, then twice that. */
  antStep: Math.trunc(CELL / Math.fround(0.35)) * 2,
  /** A cleared piece fades from full to 20% at 0.04 a millisecond, then goes (ForageBoardView.a). */
  clear: 20,
  /** Tool clears go outward from the tool, 50ms a cell. */
  ripple: 50,
  /** The cleared piece's pop: 5 frames at 12-14 fps, not holding up the board (ForageBoardView.a(int)). */
  popFrames: 5,
  /** The monkey drops and leaves at 1 px/ms, dances 17 frames at 10 fps, and throws at 5 ms/px. */
  monkeyDance: 1700,
  monkeyThrow: 5,
  /** Pieces fly on and off the board at 1 ms/px for the intro and outro. */
  introPerPx: 1,
  /** The outro starts a second after the "Great work!". */
  outroDelay: 1000,
};

export type SoundName =
  | 'piece_swap'
  | 'piece_destroy'
  | 'shovel'
  | 'machete'
  | 'monkey'
  | 'earthquake'
  | 'ants'
  | 'intro'
  | 'cursed_intro'
  | 'outro'
  | 'score_small'
  | 'score_medium'
  | 'score_big';

export interface Sprite {
  piece: number;
  from: Cell;
  to: Cell;
  delay: number;
  duration: number;
  /** line: straight (turns, gravity, ants). wobble: the earthquake's bob. arc: the monkey's throws. */
  path: 'line' | 'wobble' | 'arc';
  phase?: number;
  /** A cleared piece: shown until `delay`, fades over `duration`, then gone. */
  clear?: boolean;
  /** Walking ants cycle their frames. */
  walk?: boolean;
}

/** The monkey (3x3 cells big), by the top-left cell of its box; facing 1 is mirrored. */
export interface MonkeyAnim {
  kind: 'drop' | 'dance' | 'leave';
  box: Cell;
  facing: number;
  delay: number;
  duration: number;
}

/** Things that don't hold up the board: pops, floating text. */
export type Effect =
  | { kind: 'pop'; piece: number; at: Cell; delay: number }
  | { kind: 'text'; text: string; size: number; delay: number };

export interface Step {
  /** What holds still during the step. */
  board: number[];
  sprites: Sprite[];
  monkey: MonkeyAnim[];
  sounds: { name: SoundName; delay: number }[];
  effects: Effect[];
  duration: number;
  /** The ants' step, which comes once the board has settled after a move. */
  ants?: boolean;
}

export interface MoveResult {
  /** The move's points as the game works them out for normal foraging. */
  points: number;
  /** Gauntlet points: 1, 2 or 3 a crate by width (the simulator's cursed isle scoring). */
  gauntletPoints: number;
  /** Crates collected, by size: [1x1, 2x2, 3x2]. */
  collected: [number, number, number];
  /** Cascade steps that collected crates ("Double!", "Triple!"). */
  chained: number;
  /** Runs cleared at once at most: what the refills' special chance came from. */
  combo: number;
}

/**
 * Stands in for the game's crate requests. beforeMove runs as the player moves, afterMove once the move has settled (the simulator's Gauntlet spawning).
 */
export interface CrateSource {
  beforeMove?(game: Forage): void;
  /** Places a crate if it wants to; returns whether it did. */
  afterMove?(game: Forage): boolean;
}

/** The moved piece for a 2x2 turn, in the game's order: bottom-left, top-left, top-right, bottom-right. */
const TURN: Cell[] = [
  [0, 1],
  [0, 0],
  [1, 0],
  [1, 1],
];

export class Forage {
  /** Older replay files used accelerated entry for chests. */
  legacyChestTiming = false;
  board: ForageBoard;
  steps: Step[] = [];
  /** Crates collected this game (ForageController's e). */
  cratesCollected = 0;
  /**
   * What's in each crate slot (ForageObject.crateCommodities), as the art tile for its size; the
   * game fills these in.
   */
  crateArt = [0, 0, 0];
  private points = new CratePoints();
  private result = Forage.emptyResult();

  constructor(
    seed: number | bigint,
    public crateSource: CrateSource = {},
    difficulty = 8,
  ) {
    this.board = new ForageBoard(seed, difficulty);
  }

  static emptyResult(): MoveResult {
    return { points: 0, gauntletPoints: 0, collected: [0, 0, 0], chained: 0, combo: 0 };
  }

  get cells(): number[] {
    return this.board.cells;
  }

  // ---- Recording steps ----

  private current: Step | null = null;

  private begin(): Step {
    this.current = { board: [], sprites: [], monkey: [], sounds: [], effects: [], duration: 0 };
    return this.current;
  }

  /**
   * Finishes a step: everything not moving holds still, and the step lasts until its last
   * blocking animation ends.
   */
  private end(): void {
    const step = this.current!;
    this.current = null;
    const still = this.board.cells.slice();
    for (const s of step.sprites) {
      if (s.clear) continue;
      const [x, y] = s.to;
      if (x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT) still[y * WIDTH + x] = EMPTY;
    }
    step.board = still;
    step.duration = Math.max(
      0,
      ...step.sprites.map((s) => s.delay + s.duration),
      ...step.monkey.map((m) => m.delay + m.duration),
    );
    this.steps.push(step);
  }

  private sound(name: SoundName, delay = 0): void {
    this.current?.sounds.push({ name, delay });
  }

  /** A falling piece: pieces from above the board are made there and drop in. */
  private fall = (piece: number, x: number, sy: number, tx: number, ty: number) => {
    const rows = Math.abs(ty - sy);
    const duration = sy < 0 && isCrate(piece) && !this.legacyChestTiming ? TIMING.chestEntry(rows) : TIMING.fall(rows);
    this.current?.sprites.push({ piece, from: [x, sy], to: [tx, ty], delay: 0, duration, path: 'line' });
  };

  /** Clears a cell: it fades after `ripple` cells' delay, with a pop and one destroy sound per kind of piece and delay. */
  private clearCell(x: number, y: number, ripple: number, heard: Map<number, Set<number>>): void {
    const piece = this.board.getPiece(x, y);
    if (piece !== EMPTY) {
      const delay = ripple * TIMING.ripple;
      const kinds = heard.get(delay) ?? new Set<number>();
      heard.set(delay, kinds);
      if (!kinds.has(piece)) {
        this.sound('piece_destroy', delay);
        kinds.add(piece);
      }
      // Crates fade as one image, from their bottom-left cell.
      if (!isCrate(piece) || isCrateAnchor(piece)) {
        this.current?.sprites.push({ piece, from: [x, y], to: [x, y], delay, duration: TIMING.clear, path: 'line', clear: true });
      }
      if (piece < 5) this.current?.effects.push({ kind: 'pop', piece, at: [x, y], delay });
    }
    this.board.setPiece(x, y, EMPTY);
  }

  // ---- Moves ----

  /**
   * The player clicks with the cursor's top-left at (x, y): a tool there is used, otherwise the
   * 2x2 turns, anticlockwise for `ccw`. Four of the same turn
   * but aren't a move. Returns what happened; for a move, the board has then settled.
   */
  act(x: number, y: number, ccw: boolean): 'illegal' | 'same' | 'moved' {
    const b = this.board;
    const at = (xx: number, yy: number) => (b.inBounds(xx, yy) ? b.getPiece(xx, yy) : EMPTY);
    const tool = at(x, y);
    if (!isTool(tool) && !b.isLegalRotate(x, y)) return 'illegal';
    const four = [at(x, y + 1), at(x, y), at(x + 1, y), at(x + 1, y + 1)];
    if (four.every((p) => p === four[0])) {
      this.turn(x, y, ccw);
      return 'same';
    }
    this.crateSource.beforeMove?.(this);
    this.result = Forage.emptyResult();
    if (tool === SHOVEL) this.shovel(x, y);
    else if (tool === MACHETE) this.machete(x, y, ccw);
    else if (tool === MONKEY) this.monkey(x, y);
    else if (tool === EARTHQUAKE) this.earthquake(x, y, ccw);
    else this.turn(x, y, ccw);
    this.points.endStep();
    this.settle(true);
    return 'moved';
  }

  /** The result of the last move. */
  get lastResult(): MoveResult {
    return this.result;
  }

  private turn(x: number, y: number, ccw: boolean): void {
    const step = this.begin();
    this.sound('piece_swap');
    const b = this.board;
    const pieces = TURN.map(([dx, dy]) => b.possiblyRotateAnts(x + dx, y + dy, ccw));
    // Anticlockwise, each piece moves to the corner before it in TURN's order (top-left to
    // bottom-left); clockwise, to the one after.
    TURN.forEach(([dx, dy], i) => {
      const [tx, ty] = TURN[(i + (ccw ? 3 : 1)) % 4];
      b.setPiece(x + tx, y + ty, pieces[i]);
      step.sprites.push({ piece: pieces[i], from: [x + dx, y + dy], to: [x + tx, y + ty], delay: 0, duration: TIMING.turn, path: 'line' });
    });
    this.end();
  }

  /** Shovel: its cell and everything below it, crates skipped. */
  private shovel(x: number, y: number): void {
    this.begin();
    this.sound('shovel');
    const heard = new Map<number, Set<number>>();
    for (let yy = y; yy < HEIGHT; yy++) if (!isCrate(this.board.getPiece(x, yy))) this.clearCell(x, yy, yy - y, heard);
    this.end();
  }

  /** Machete: its cell and the rest of its row to the left (anticlockwise) or right, crates skipped. */
  private machete(x: number, y: number, left: boolean): void {
    this.begin();
    this.sound('machete');
    const heard = new Map<number, Set<number>>();
    for (let xx = 0; xx < WIDTH; xx++) {
      if ((left ? xx <= x : xx >= x) && !isCrate(this.board.getPiece(xx, y))) this.clearCell(xx, y, Math.abs(xx - x), heard);
    }
    this.end();
  }

  /**
   * Earthquake: clears itself and the whole left (anticlockwise) or right column, crates skipped,
   * and at once slides the board that way like sideways gravity, refilling from the other side.
   */
  private earthquake(x: number, y: number, left: boolean): void {
    this.begin();
    this.sound('earthquake');
    const heard = new Map<number, Set<number>>();
    this.clearCell(x, y, 0, heard);
    const edge = left ? 0 : WIDTH - 1;
    for (let yy = 0; yy < HEIGHT; yy++) if (!isCrate(this.board.getPiece(edge, yy))) this.clearCell(edge, yy, 0, heard);
    this.board.slidePieces(!left, (piece, sx, sy, tx, ty) => {
      this.current?.sprites.push({
        piece,
        from: [sx, sy],
        to: [tx, ty],
        delay: 0,
        duration: TIMING.slide(Math.abs(tx - sx)),
        path: 'wobble',
        phase: looks.random() * Math.PI * 2,
      });
    });
    this.end();
  }

  /**
   * Monkey: drops in over a 3x3 around itself, dances while it throws a new piece into every cell
   * of the 5x5 around it (crates skipped), then climbs away.
   * The new pieces come from getNextPiece without ants, and since nothing has matched yet this
   * move, they are always fruit.
   */
  private monkey(x: number, y: number): void {
    const b = this.board;
    const facing = x < Math.trunc(WIDTH / 2) ? 1 : x > Math.trunc(WIDTH / 2) ? 0 : looks.random() < 0.5 ? 0 : 1;
    const box: Cell = [Math.min(Math.max(0, x - 1), WIDTH - 3), Math.min(Math.max(0, y - 1), HEIGHT - 3)];
    const travel = (box[1] + 3) * CELL;
    let step = this.begin();
    this.sound('monkey');
    step.monkey.push({ kind: 'drop', box, facing, delay: 0, duration: travel });
    this.end();

    step = this.begin();
    step.monkey.push({ kind: 'dance', box, facing, delay: 0, duration: TIMING.monkeyDance });
    step.monkey.push({ kind: 'leave', box, facing, delay: TIMING.monkeyDance, duration: travel });
    const centre: Cell = [Math.min(Math.max(1, x), WIDTH - 2), Math.min(Math.max(1, y), HEIGHT - 2)];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const [tx, ty] = [x + dx, y + dy];
        if (!b.inBounds(tx, ty) || isCrate(b.getPiece(tx, ty))) continue;
        const piece = b.getNextPiece(false);
        const old = b.getPiece(tx, ty);
        b.setPiece(tx, ty, piece);
        if (tx === centre[0] && ty === centre[1]) continue;
        const duration = CELL * (Math.abs(tx - centre[0]) + Math.abs(ty - centre[1])) * TIMING.monkeyThrow;
        step.sprites.push({ piece, from: centre, to: [tx, ty], delay: 0, duration, path: 'arc' });
        // The old piece stays until the new one lands on it.
        if (old !== EMPTY) step.sprites.push({ piece: old, from: [tx, ty], to: [tx, ty], delay: duration, duration: 0, path: 'line', clear: true });
      }
    }
    this.end();
  }

  // ---- Settling ----

  /**
   * Settles the board: gravity, crates, runs, spawns, until nothing happens;
   * then the ants step and it settles again; then the move ends.
   */
  private settle(moved: boolean): void {
    let antsToTick = moved;
    for (;;) {
      if (this.gravity() || this.collectCrates() || this.clearRuns() || this.spawnCrate()) continue;
      if (antsToTick) {
        antsToTick = false;
        this.tickAnts();
        continue;
      }
      break;
    }
    if (!moved) return;
    // The end of the move.
    this.result.points = this.points.total;
    this.result.chained = this.points.chained;
    this.result.combo = this.board.comboCount;
    if (this.result.chained > 1) this.textEffect(this.result.chained < 4 ? ['', '', 'Double!', 'Triple!'][this.result.chained] : 'Triple!', this.result.points);
    this.board.comboCount = 0;
    this.points.reset();
    // The simulator's Gauntlet chests come in once the move has played out.
    if (this.crateSource.afterMove?.(this)) this.settle(false);
  }

  private textEffect(text: string, size: number): void {
    const last = this.steps[this.steps.length - 1];
    last?.effects.push({ kind: 'text', text, size, delay: last.duration });
  }

  private gravity(): boolean {
    this.begin();
    const moved = this.board.dropPieces(this.fall) > 0;
    if (moved) this.end();
    else this.current = null;
    return moved;
  }

  /**
   * Crates whose bottom-left cell reaches the bottom row are collected. Normal
   * foraging scores them with CratePoints; the Gauntlet's flat points are worked out alongside.
   */
  private collectCrates(): boolean {
    const b = this.board;
    let any = false;
    let count = 0;
    let stepPoints = 0;
    const step = this.begin();
    const heard = new Map<number, Set<number>>();
    for (let x = 0; x < WIDTH; x++) {
      const p = b.getPiece(x, HEIGHT - 1);
      if (!isCrateAnchor(p)) continue;
      any = true;
      const { width, height } = CRATE_SIZES[crateSize(p)];
      b.decreaseCrates();
      b.decreaseCrateArea(width * height);
      for (let dx = 0; dx < width; dx++) for (let dy = 0; dy < height; dy++) this.clearCell(x + dx, HEIGHT - 1 - dy, 0, heard);
      stepPoints += this.points.crate(width);
      this.result.gauntletPoints += width;
      this.result.collected[crateSize(p)]++;
      this.cratesCollected++;
      count++;
    }
    if (count > 0) step.effects.push({ kind: 'text', text: count === 1 ? 'Crate cleared!' : `${count} crates cleared!`, size: stepPoints * 2, delay: 0 });
    if (any) {
      this.points.endStep();
      this.end();
    } else this.current = null;
    return any;
  }

  /** Every run of three or more fruit goes at once. */
  private clearRuns(): boolean {
    const runs = this.board.findRuns();
    if (!runs.length) return false;
    this.begin();
    const heard = new Map<number, Set<number>>();
    for (const run of runs) for (const [x, y] of ForageBoard.runCells(run)) this.clearCell(x, y, 0, heard);
    this.board.setComboCount(runs.length);
    this.points.endStep();
    this.end();
    return true;
  }

  /** A crate the game asked for. */
  private spawnCrate(): boolean {
    this.begin();
    const placed = this.board.spawnCrate(this.fall) > 0;
    if (placed) this.end();
    else this.current = null;
    return placed;
  }

  /** The ants step once a move. */
  private tickAnts(): void {
    if (!this.board.antsOnBoard()) return;
    const step = this.begin();
    step.ants = true;
    let ants = EMPTY;
    for (let x = 0; x < WIDTH && ants === EMPTY; x++) for (let y = 0; y < HEIGHT && ants === EMPTY; y++) if (isAnts(this.board.getPiece(x, y))) ants = this.board.getPiece(x, y);
    this.board.tickAnts(
      (x, y, tx, ty) => {
        this.sound('ants');
        // The ants walk into the cell they ate, still showing their old count; after their last
        // bite they're gone once they get there.
        step.sprites.push({ piece: ants, from: [x, y], to: [tx, ty], delay: 0, duration: TIMING.antStep, path: 'line', walk: true });
      },
      // Starving ants just disappear.
      () => {},
    );
    this.end();
  }

  // ---- Crates from outside the board ----

  /** Puts a crate of `size` in at column `x` of the top rows, as the simulator's Gauntlet does, dropping in. */
  dropCrate(size: number, x: number, key = 0): void {
    const b = this.board;
    const { width, height } = CRATE_SIZES[size];
    this.begin();
    b.increaseCrates();
    b.increaseCrateArea(width * height);
    for (let dx = 0; dx < width; dx++) {
      for (let dy = 0; dy < height; dy++) {
        const part = dx === 0 && dy === 0 ? 0 : dy === 0 ? 1 : 2;
        const piece = makeCrate(part, key, size);
        b.setPiece(x + dx, height - 1 - dy, piece);
        this.fall(piece, x + dx, -1 - dy, x + dx, height - 1 - dy);
      }
    }
    this.end();
  }

  /** Loads a board, counting its crates in. */
  load(cells: readonly number[]): void {
    const b = this.board;
    cells.forEach((p, i) => (b.cells[i] = p));
    b.crates = 0;
    b.crateArea = 0;
    for (const p of cells) {
      if (isCrateAnchor(p)) {
        const { width, height } = CRATE_SIZES[crateSize(p)];
        b.increaseCrates();
        b.increaseCrateArea(width * height);
      }
    }
  }

  /** How many crates are on the board. */
  crateCount(): number {
    return this.board.cells.filter(isCrateAnchor).length;
  }
}
