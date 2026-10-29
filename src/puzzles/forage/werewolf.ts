// Werewolf Forage: the Werewolf board, its moons and their beams.
// Moons stay at fixed 2x2 board coordinates; falling/rotating pieces do not move them.
import { ForageBoard, HEIGHT, isCrate, WIDTH } from './board';

export interface Moon {
  id: number;
  x: number;
  y: number;
  phase: number;
  charge: number;
}

export interface MoonBlast {
  /** x * 100 + y -> distance from the moon, in insertion order. */
  cells: Map<number, number>;
  /** Ray vertices in half-cell units, including the final edge endpoint. */
  rays: number[][];
}

export class MoonField {
  readonly active: Moon[] = [];
  private nextId = 1;
  private clearingMoves = 0;
  private spawnAfter = 2;
  private cleared = false;
  firing = false;
  /** Freeplay places its own moons, so none come up on their own. */
  spawning = true;
  /** Incoming crates can't land on a moon. Only replays recorded before Den keep this. */
  blocksCrates = false;
  /** Ant bites inside a moon add to its claw count. Only replays recorded before keep this. */
  antsCharge = false;
  /** Den (Exp): a moon wanes on the move's first clear rather than once the move has played out. */
  eagerPhase = false;
  /** Den (Exp): moons come up three times as often over columns holding a crate. */
  chestBias = false;
  /** Den (Exp): a crate coming in with no moon up brings one with it. */
  spawnWithCrate = false;
  /** How long the moon's animations take: 1, or 0.75 for Den (Exp)'s faster moons. */
  pace = 1;

  /** Engine callers and native parity fixtures retain the game's two-moon limit. */
  constructor(readonly maxMoons = 2) {}

  snapshot(): Moon[] { return this.active.map((moon) => ({ ...moon })); }

  overlaps(x: number, y: number, width = 1, height = 1): boolean {
    return this.active.some((m) => x <= m.x + 1 && m.x < x + width && y <= m.y + 1 && m.y < y + height);
  }

  noteCleared(x: number, y: number): void {
    if (!this.firing) {
      if (this.eagerPhase && !this.cleared) for (const moon of this.active) moon.phase = Math.max(0, moon.phase - 1);
      this.cleared = true;
    }
    this.charge(x, y);
  }

  /** Ant bites never age moons or advance the spawn timer, and charge them only in older replays. */
  noteEaten(x: number, y: number): void {
    if (this.antsCharge) this.charge(x, y);
  }

  private charge(x: number, y: number): void {
    for (const moon of this.active) {
      if (x >= moon.x && x <= moon.x + 1 && y >= moon.y && y <= moon.y + 1) moon.charge++;
    }
  }

  spawn(board: ForageBoard): Moon | null {
    if (this.active.length >= this.maxMoons) return null;
    const positions: [number, number][] = [];
    for (let x = 0; x < WIDTH - 1; x++) {
      for (let y = 0; y < HEIGHT - 1; y++) {
        if (this.overlaps(x, y, 2, 2)) continue;
        if ([board.getPiece(x, y), board.getPiece(x + 1, y), board.getPiece(x, y + 1), board.getPiece(x + 1, y + 1)].some(isCrate)) continue;
        positions.push([x, y]);
        if (this.chestBias && [x, x + 1].some((cx) => Array.from({ length: HEIGHT }, (_, cy) => board.getPiece(cx, cy)).some(isCrate))) {
          positions.push([x, y], [x, y]);
        }
      }
    }
    if (!positions.length) return null;
    const [x, y] = positions[board.rng.nextInt(positions.length)];
    const moon = { id: this.nextId++, x, y, phase: 4, charge: 0 };
    this.active.push(moon);
    this.clearingMoves = 0;
    this.spawnAfter = 2 + board.rng.nextInt(2);
    return moon;
  }

  /** Freeplay: a moon with its top-left at (x, y), over any moon in its way. */
  place(x: number, y: number, phase: number, charge: number): Moon {
    this.clear(x, y, 2, 2);
    const moon = { id: this.nextId++, x, y, phase, charge };
    this.active.push(moon);
    return moon;
  }

  /** Freeplay: takes away every moon covering part of the area. */
  clear(x: number, y: number, width = 1, height = 1): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      if (x <= m.x + 1 && m.x < x + width && y <= m.y + 1 && m.y < y + height) this.active.splice(i, 1);
    }
  }

  takeCharged(): Moon | null {
    const index = this.active.findIndex((m) => m.charge >= 4);
    return index < 0 ? null : this.active.splice(index, 1)[0];
  }

  endMove(board: ForageBoard): { expired: Moon[]; spawned: Moon | null } {
    const expired: Moon[] = [];
    if (this.cleared) {
      for (let i = this.active.length - 1; i >= 0; i--) {
        if (!this.eagerPhase) this.active[i].phase--;
        if (this.active[i].phase <= 0) expired.unshift(...this.active.splice(i, 1));
      }
      this.clearingMoves++;
    }
    this.cleared = false;
    const spawned = this.spawning && this.active.length < this.maxMoons && this.clearingMoves >= this.spawnAfter ? this.spawn(board) : null;
    return { expired, spawned };
  }

  /**
   * A firing moon's beams: along both of its rows to each side of the board, and down both of its
   * columns to the bottom. Each beam passes over crates without clearing them.
   */
  blast(moon: Moon, board: ForageBoard): MoonBlast {
    const cells = new Map<number, number>();
    const rays: number[][] = [];
    const beam = (x: number, y: number, dx: number, dy: number): void => {
      const ray = [2 * x + 1, 2 * y + 1];
      let distance = 0;
      while (x + dx >= 0 && x + dx < WIDTH && y + dy >= 0 && y + dy < HEIGHT) {
        x += dx;
        y += dy;
        distance++;
        ray.push(2 * x + 1, 2 * y + 1);
        if (!isCrate(board.getPiece(x, y))) {
          const key = x * 100 + y;
          cells.set(key, Math.min(cells.get(key) ?? Infinity, distance));
        }
      }
      ray.push(2 * x + 1 + dx, 2 * y + 1 + dy);
      rays.push(ray);
    };
    for (let y = moon.y; y <= moon.y + 1; y++) {
      beam(moon.x + 1, y, -1, 0);
      beam(moon.x, y, 1, 0);
    }
    for (let x = moon.x; x <= moon.x + 1; x++) beam(x, moon.y, 0, 1);
    return { cells, rays };
  }
}

export class WerewolfForageBoard extends ForageBoard {
  readonly moons: MoonField;

  /** Freeplay's board starts without a moon, and none come up: they're painted on. */
  constructor(seed: number | bigint, difficulty = 8, spawning = true, maxMoons = 2) {
    super(seed, difficulty);
    this.moons = new MoonField(maxMoons);
    this.moons.spawning = spawning;
    if (spawning) this.moons.spawn(this);
  }

  override noteCleared(x: number, y: number): void { this.moons.noteCleared(x, y); }
  protected override noteEaten(x: number, y: number): void { this.moons.noteEaten(x, y); }
  protected override keepsCratesOff(x: number, y: number): boolean { return this.moons.blocksCrates && this.moons.overlaps(x, y); }
}
