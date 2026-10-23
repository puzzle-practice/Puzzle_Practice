// Crate scheduling for normal and Gauntlet modes. Normal mode requests crates while
// space and banana allowances remain. Gauntlet mode uses its own size and pacing rules.
import type { Random } from '../../core/random';
import { COLOURS, CRATE_SIZES, isAnts, isCrate, isCrateAnchor, isTool, MAX_CRATE_AREA, MAX_CRATES, crateSize, WIDTH } from './board';
import type { CrateSource, Forage } from './engine';

/** Practice delivery delay, measured from the first fresh move. */
export const CHEST_DELAY_MS = 2000;
/** Versions 3–4 evaluated eligibility in globally aligned two-second batches. */
export const MOVE_BATCH_MS = CHEST_DELAY_MS;
/** Versions 3–4 added this delivery delay after each batch. */
export const ROUND_TRIP_MS = 120;

/** Count moves and elapsed time together, then wait for the requested chest to land. */
class ChestPacing {
  private moves = 0;
  private startedAt: number | null = null;
  private inFlight = false;

  beforeMove(now: number): boolean {
    if (this.inFlight) return false;
    this.startedAt ??= now;
    this.moves++;
    return this.moves >= 2 && now - this.startedAt >= CHEST_DELAY_MS;
  }

  requested(): void { this.inFlight = true; }

  afterMove(game: Forage): void {
    if (!this.inFlight || game.board.bonusMode !== 0) return;
    this.moves = 0;
    this.startedAt = null;
    this.inFlight = false;
  }
}

/** Crate art (crate1x1.png etc.): fruit 0-4 for small and medium crates; 3x2 gems 0 or gold 1. */
const FRUIT_TILES = COLOURS;
/** The cursed isle's bone box, fetish jar and cursed chest. */
export const CURSED_TILES = [6, 6, 3];
/** Werewolf Isle's three treasure crates, added in the test build. */
export const WEREWOLF_TILES = [8, 8, 5];

/** Normal foraging: requests crates while board space remains. */
export class CrateRequests implements CrateSource {
  /** Crates asked for so far. */
  requested = 0;
  private nextKey = 0;
  /** Paced: moves since the last request was sent, and when the one on its way reaches the board. */
  private moves = 0;
  private readyAt: number | null = null;
  private readonly delivery = new ChestPacing();

  constructor(
    private readonly rng: Random,
    /** Relative chances of a 1x1, 2x2 and 3x2. */
    private readonly weights: readonly [number, number, number],
    /** How many crates the board brings in all. */
    private readonly budget: number,
    /**
     * Paced delivery. Versions 3–4 asked for a crate after two moves, waited for the next
     * two-second batch, then delivered on a later move. Version 5 uses overlappingDelay below.
     * Unpaced (replays recorded before) asks before every move there's room.
     */
    private readonly paced = false,
    /** Paced: the game clock in milliseconds. */
    private readonly now: () => number = () => 0,
    /** Version 5: the delay overlaps the two fresh moves and resets after landing. */
    private readonly overlappingDelay = false,
  ) {}

  /** Room on the board and in the budget for another crate. */
  private room(game: Forage): boolean {
    const b = game.board;
    return b.bonusMode === 0 && b.crates < MAX_CRATES && b.crateArea < MAX_CRATE_AREA && this.requested < this.budget;
  }

  afterMove(game: Forage): boolean {
    if (!this.paced) return false;
    if (this.overlappingDelay) {
      this.delivery.afterMove(game);
      return false;
    }
    this.moves++;
    if (this.readyAt === null && this.moves >= 2 && this.room(game)) {
      this.readyAt = (Math.floor(this.now() / MOVE_BATCH_MS) + 1) * MOVE_BATCH_MS + ROUND_TRIP_MS;
      this.moves = 0;
    }
    return false;
  }

  beforeMove(game: Forage): void {
    const b = game.board;
    if (this.paced && this.overlappingDelay) {
      if (!this.delivery.beforeMove(this.now())) return;
    } else if (this.paced) {
      if (this.readyAt === null || this.now() < this.readyAt || b.bonusMode !== 0) return;
      this.readyAt = null;
    }
    if (!this.room(game)) return;
    const sizes = [0, 1, 2].filter((s) => this.weights[s] > 0);
    if (!sizes.length) return;
    const size = this.rng.choiceWeighted(
      sizes,
      sizes.map((s) => this.weights[s]),
    );
    // The contents go in one of three slots; use one no crate on the board is using.
    const used = new Set(b.cells.filter(isCrateAnchor).map((p) => (p & 0xc0000) >> 18));
    let key = this.nextKey;
    for (let i = 0; i < 3 && used.has(key); i++) key = (key + 1) % 3;
    this.nextKey = (key + 1) % 3;
    game.crateArt[key] = size === 2 ? this.rng.integer(0, 1) : this.rng.integer(0, FRUIT_TILES - 1);
    if (game.werewolf) game.crateArt[key] = WEREWOLF_TILES[size];
    b.bonusMode = 64 | size | (key << 2);
    this.requested++;
    if (this.paced && this.overlappingDelay) this.delivery.requested();
  }
}

/**
 * The simulator's Gauntlet chests. The next chest and its column are picked ahead. After each move:
 * once two moves have passed since the last chest and there are fewer than 3 on the board, a cursed
 * chest waits until no jar or chest is left, a jar until there's no cursed chest and fewer than 2 jars,
 * and a bone box goes whenever. It needs every cell of its spot in the top rows to be fruit; from the
 * third move on it tries every column in a random order instead (keeping the last one it tried).
 */
export class GauntletChests implements CrateSource {
  private next!: number;
  private column!: number;
  private movesSinceLast = -1;
  /** Chests still to come on this board: one per banana. */
  budget: number;
  private readonly delivery = new ChestPacing();

  constructor(
    private readonly rng: Random,
    /** Relative chances of a bone box, fetish jar and cursed chest (0 for those turned off). */
    private readonly weights: readonly [number, number, number],
    budget: number,
    private readonly chaos = false,
    /**
     * Paced: a chest goes through delivery before it can drop. It then has to find room like a
     * Normal crate: each time the board settles it lands with a
     * chance that falls as the board fills, in any column whose top cells are clear.
     */
    private readonly paced = false,
    /** Paced: the game clock in milliseconds, used to schedule delivery. */
    private readonly now: () => number = () => 0,
    /**
     * A chest whose column is blocked tries another column on each later move until it lands.
     * Off (replays recorded before): from the third move it tries every column, keeping the last.
     */
    private readonly retryColumns = false,
    /** Version 5: the delay overlaps the two fresh moves and resets after landing. */
    private readonly overlappingDelay = false,
  ) {
    this.budget = budget;
    this.pick();
  }

  /** Paced: the size of a chest that's due but not asked for yet, and when the ask reaches the board. */
  private waiting = -1;
  private readyAt = 0;

  beforeMove(game: Forage): void {
    if (this.paced && this.overlappingDelay) {
      if (!this.enabled || (!this.chaos && this.budget <= 0) || !this.delivery.beforeMove(this.now())) return;
      if (game.board.bonusMode !== 0) return;
      const onBoard = [0, 0, 0];
      for (const p of game.board.cells) if (isCrateAnchor(p)) onBoard[crateSize(p)]++;
      if (!this.chaos && (onBoard.reduce((a, b) => a + b, 0) >= 3 || !this.fits(onBoard))) return;
      const size = this.next - 1;
      game.crateArt[size] = (game.werewolf ? WEREWOLF_TILES : CURSED_TILES)[size];
      game.board.bonusMode = 64 | size | (size << 2);
      this.budget--;
      this.pick();
      this.delivery.requested();
      return;
    }
    if (!this.paced || this.waiting < 0 || game.board.bonusMode !== 0 || this.now() < this.readyAt) return;
    game.crateArt[this.waiting] = (game.werewolf ? WEREWOLF_TILES : CURSED_TILES)[this.waiting];
    game.board.bonusMode = 64 | this.waiting | (this.waiting << 2);
    this.waiting = -1;
  }

  get enabled(): boolean {
    return this.weights.some((w) => w > 0);
  }

  /** Pick a weighted enabled chest, then its column. */
  private pick(): void {
    const kinds = [1, 2, 3].filter((k) => this.weights[k - 1] > 0);
    if (!kinds.length) return;
    this.next = this.rng.choiceWeighted(
      kinds,
      kinds.map((k) => this.weights[k - 1]),
    );
    this.column = this.rng.choice(Array.from({ length: WIDTH + 1 - this.next }, (_, i) => i));
  }

  /** cells_check: any cell of the spot that isn't fruit blocks it. */
  private blocked(game: Forage, column: number): boolean {
    const { width, height } = CRATE_SIZES[this.next - 1];
    for (let y = 0; y < height; y++) {
      for (let x = column; x < column + width; x++) {
        const p = game.board.getPiece(x, y);
        if (p < 0 || p >= COLOURS || isTool(p) || isAnts(p) || isCrate(p)) return true;
      }
    }
    return false;
  }

  afterMove(game: Forage): boolean {
    game.board.unlimitedCrates = this.chaos;
    if (this.paced && this.overlappingDelay) {
      this.delivery.afterMove(game);
      return false;
    }
    if (!this.enabled || (!this.chaos && this.budget <= 0)) return false;
    const onBoard = [0, 0, 0];
    for (const p of game.board.cells) if (isCrateAnchor(p)) onBoard[crateSize(p)]++;
    // A paced chest still on its way counts as on the board.
    const coming = this.waiting >= 0 ? this.waiting : (game.board.bonusMode & 64) !== 0 ? game.board.bonusMode & 3 : -1;
    if (coming >= 0) onBoard[coming]++;
    const total = onBoard[0] + onBoard[1] + onBoard[2];
    this.movesSinceLast++;
    if (this.paced && coming >= 0) {
      if (total === 3) this.movesSinceLast = -1;
      return false;
    }
    let placed = false;
    if (this.movesSinceLast >= 2 && (this.chaos || total < 3)) {
      if (this.chaos || this.fits(onBoard)) placed = this.trySpawn(game);
    }
    // Check the count from before the spawn.
    if (!this.chaos && total === 3) this.movesSinceLast = -1;
    return placed;
  }

  private fits(onBoard: number[]): boolean {
    return (this.next === 3 && onBoard[1] === 0 && onBoard[2] < 1) || (this.next === 2 && onBoard[2] === 0 && onBoard[1] < 2) || this.next === 1;
  }

  private trySpawn(game: Forage): boolean {
    if (this.paced) {
      // Eligible chests wait for the next two-second batch and an additional delivery delay.
      this.waiting = this.next - 1;
      this.readyAt = (Math.floor(this.now() / MOVE_BATCH_MS) + 1) * MOVE_BATCH_MS + ROUND_TRIP_MS;
      this.budget--;
      this.pick();
      this.movesSinceLast = 0;
      return false;
    }
    let blocked = this.blocked(game, this.column);
    if (blocked && this.retryColumns) {
      // Next move, another column.
      const others = Array.from({ length: WIDTH + 1 - this.next }, (_, i) => i).filter((x) => x !== this.column);
      if (others.length) this.column = this.rng.choice(others);
      return false;
    }
    if (blocked && this.movesSinceLast >= 3) {
      for (const x of this.rng.shuffle(Array.from({ length: WIDTH + 1 - this.next }, (_, i) => i))) {
        this.column = x;
        blocked = this.blocked(game, x);
        if (this.chaos && !blocked) break;
      }
    }
    if (blocked) return false;
    // Each size keeps its own contents slot, so the three kinds of chest show their own art.
    game.crateArt[this.next - 1] = (game.werewolf ? WEREWOLF_TILES : CURSED_TILES)[this.next - 1];
    game.dropCrate(this.next - 1, this.column, this.next - 1);
    this.budget--;
    this.pick();
    this.movesSinceLast = 0;
    return true;
  }
}
