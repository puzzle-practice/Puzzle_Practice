import { seedFor } from '../../core/seeds';
import definitions from './patterns.json';

export const WOOD = 0, IRON = 1, ROPE = 2, CLOTH = 3, GOLD = 4;
export type Cell = readonly [number, number];
export interface Pattern {
  id: string;
  points: number;
  tier: number;
  /** Material, x, y relative to the pickup square. Patterns cannot be rotated. */
  cells: readonly (readonly [number, number, number])[];
}
export const PATTERNS: readonly Pattern[] = definitions as unknown as Pattern[];
export const STYLES = [
  { counts: [5, 1, 0], gold: 0, intro: true },
  { counts: [4, 2, 0], gold: 0, intro: false },
  { counts: [3, 3, 0], gold: 0, intro: false },
  { counts: [4, 1, 1], gold: 0.04, intro: false },
  { counts: [4, 1, 1], gold: 0.04, intro: false },
  { counts: [3, 2, 1], gold: 0.04, intro: false },
  { counts: [3, 2, 1], gold: 0.04, intro: false },
  { counts: [2, 2, 2], gold: 0.07, intro: false },
  { counts: [2, 2, 2], gold: 0.07, intro: false },
] as const;
export const TIDE_MS = 75_000, OVERTIME_MS = 15_000, FLASH_MS = 300, GROW_MS = 400;
export const SWAP_MS = 150, DIAGONAL_MS = 211, RETREAT_MS = 2000;
export const SCORE_WORDS = ['Fair', 'Good', 'Great', 'Excellent', 'Admirable', 'Superior', 'Magnificent', 'Artisan', 'Paragon', 'Master'];
export const SCORE_CUTOFFS = [0, 3, 6, 12, 18, 24, 30, 36, 48, 60];
export const CHAIN_WORDS = ['', '', 'Double!', 'Triple!', 'Bingo!', 'Donkey!', 'Vegas!'];
export function scoreWord(points: number): string {
  let i = SCORE_CUTOFFS.length - 1;
  while (i > 0 && points < SCORE_CUTOFFS[i]) i--;
  return SCORE_WORDS[i];
}

/** The game's 48-bit random sequence, including nextFloat and bounded integer rejection. */
export class ShipRandom {
  private seed: bigint;
  constructor(seed: number) { this.seed = (BigInt(seed) ^ 0x5deece66dn) & ((1n << 48n) - 1n); }
  next(bits: number): number {
    this.seed = (this.seed * 0x5deece66dn + 11n) & ((1n << 48n) - 1n);
    return Number(this.seed >> BigInt(48 - bits));
  }
  nextFloat(): number { return this.next(24) / (1 << 24); }
  nextInt(n: number): number {
    if (n <= 0) throw new Error('Empty material pile');
    if ((n & -n) === n) return Number((BigInt(n) * BigInt(this.next(31))) >> 31n);
    let bits: number, value: number;
    do { bits = this.next(31); value = bits % n; } while (bits - value + n - 1 > 0x7fffffff);
    return value;
  }
}
const f = Math.fround;
export const inBounds = (x: number, y: number): boolean => x >= 0 && x < 5 && y >= 0 && y < 5;

export class ShipBoard {
  readonly style: typeof STYLES[number];
  /** One sequence for the whole session: initial deal, material refills and replacement patterns. */
  readonly random: ShipRandom;
  readonly patternRandom: ShipRandom;
  /** Column-major, matching the game's material draw order. */
  cells = Array<number>(25).fill(0);
  available: Pattern[] = [];
  numAvailable = 0;
  pile = [0, 0, 0, 0, 0];
  pileTotal = 0;
  combo = 0;
  completed = 0;
  goal: number;
  constructor(readonly difficulty: number, seed: number, goal = 20, independentStreams = false) {
    this.style = STYLES[Math.max(0, Math.min(8, Math.trunc(difficulty)))];
    this.goal = this.style.intro ? 3 : goal;
    this.random = new ShipRandom(seed);
    this.patternRandom = independentStreams ? new ShipRandom(seedFor(seed, 'patterns')) : this.random;
    if (this.style.intro) this.available = ['cannon', 'rigging', 'sail'].map(id => PATTERNS.find(p => p.id === id)!);
    else {
      for (let tier = 0; tier < 3; tier++) {
        for (let i = 0; i < this.style.counts[tier]; i++) {
          this.available.push(this.pickPattern(tier, this.leastRequired(this.available.length, -1)));
        }
      }
    }
    this.numAvailable = this.available.length;
    this.initPile();
    if (this.style.intro) this.cells = [1, 0, 2, 2, 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 3, 0, 3];
    else this.cells = this.cells.map(() => this.draw());
  }
  get endGame(): boolean { return this.completed >= this.goal; }
  get(x: number, y: number): number { return inBounds(x, y) ? this.cells[x * 5 + y] : -1; }
  canSwap(a: Cell, b: Cell): boolean {
    if (this.endGame) return false;
    const [x, y] = a, [u, v] = b;
    const t = this.get(x, y), s = this.get(u, v);
    const dx = Math.abs(x - u), dy = Math.abs(y - v);
    if (t < 0 || s < 0 || t === GOLD || s === GOLD || dx > 1 || dy > 1 || dx + dy === 0) return false;
    return dx === 0 ? t === WOOD || s === WOOD : dy === 0 ? t === IRON || s === IRON : t === ROPE || s === ROPE;
  }
  swap(a: Cell, b: Cell): boolean {
    if (!this.canSwap(a, b)) return false;
    const i = a[0] * 5 + a[1], j = b[0] * 5 + b[1];
    [this.cells[i], this.cells[j]] = [this.cells[j], this.cells[i]];
    this.combo = 0;
    return true;
  }
  canPlace(slot: number, at: Cell): boolean {
    if (slot < 0 || slot >= this.numAvailable) return false;
    return this.available[slot].cells.every(([t, x, y]) => {
      const actual = this.get(at[0] + x, at[1] + y);
      return actual === GOLD || actual === t;
    });
  }
  place(slot: number, at: Cell): number {
    if (!this.canPlace(slot, at)) return 0;
    if (this.combo === 0 && this.numAvailable < this.available.length) this.replacePattern(this.numAvailable++);
    const pattern = this.available[slot];
    this.completed++;
    const score = pattern.points * ++this.combo;
    // All replacements are drawn before any materials are returned. The first pattern square is replaced last.
    const reversed = [...pattern.cells].reverse();
    const replacements = reversed.map(() => this.draw());
    reversed.forEach(([type, x, y], i) => {
      if (type !== GOLD && type !== -1) { this.pile[type]++; this.pileTotal++; }
      this.cells[(at[0] + x) * 5 + at[1] + y] = replacements[i];
    });
    this.replacePattern(slot);
    return score;
  }
  expire(): boolean { if (this.numAvailable > 0) this.numAvailable--; return this.numAvailable > 0; }
  private replacePattern(slot: number): void {
    this.available[slot] = this.pickPattern(this.available[slot].tier, this.leastRequired(this.numAvailable, slot));
  }
  private leastRequired(count: number, excluded: number): number {
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < count; i++) if (i !== excluded) for (const [t] of this.available[i].cells) counts[t]++;
    let choices = [0];
    for (let t = 1; t < 4; t++) {
      if (counts[t] < counts[choices[0]]) choices = [];
      if (!choices.length || counts[t] <= counts[choices[0]]) choices.push(t);
    }
    return choices[this.patternRandom.nextInt(choices.length)];
  }
  private pickPattern(tier: number, material: number): Pattern {
    const all = PATTERNS.filter(p => p.tier === tier);
    const unused = all.filter(p => !this.available.includes(p));
    // The game stores the OR of numeric material IDs, then tests it against a shifted bit.
    // Keep that behavior: replacing it with a conventional material mask changes the deals.
    const preferred = unused.filter(p => (p.cells.reduce((mask, [t]) => mask | t, 0) & (1 << material)) === (1 << material));
    const pool = preferred.length ? preferred : unused.length ? unused : all;
    return pool[this.patternRandom.nextInt(pool.length)];
  }
  private initPile(): void {
    const weights = [0, 0, 0, 0, 0];
    let total = 0;
    for (let tier = 0; tier < 3; tier++) if (this.style.counts[tier] > 0) {
      const patterns = PATTERNS.filter(p => p.tier === tier);
      const tally = [0, 0, 0, 0, 0];
      const unit = f(1 / patterns.length);
      for (const p of patterns) for (const [t] of p.cells) tally[t] = f(tally[t] + unit);
      for (let t = 0; t < 5; t++) { weights[t] = f(weights[t] + tally[t]); total = f(total + tally[t]); }
    }
    this.pile = weights.map(w => Math.ceil(f(f(w / total) * f(37.5))));
    this.pileTotal = this.pile.reduce((a, b) => a + b, 0);
  }
  private draw(): number {
    if (this.random.nextFloat() < f(this.style.gold)) return GOLD;
    let n = this.random.nextInt(this.pileTotal), t = 0;
    while (t < 4 && n >= this.pile[t]) n -= this.pile[t++];
    this.pile[t]--; this.pileTotal--;
    return t;
  }
}

export type ShipEvent =
  | { type: 'warning'; level: number }
  | { type: 'expired'; slot: number }
  | { type: 'refill'; slot: number; restored: number }
  | { type: 'finish'; failed: boolean };

/** Session clock and input gates. Presentation reads these times, so replays use the same transitions. */
export class ShipSession {
  readonly board: ShipBoard;
  score = 0;
  swaps = 0;
  bestCombo = 0;
  goldUsed = 0;
  lost = 0;
  finished = false;
  failed = false;
  busyUntil: number;
  timerStart: number;
  timerDuration: number;
  warning = 0;
  overtime = false;
  tideFrom = 0;
  tideResetAt: number;
  private pending: { at: number; slot: number; restored: number } | null = null;
  private pausedTimer = 0;
  readonly events: ShipEvent[] = [];
  /** Freeplay mode: no tide and no goal, so the board stays until stopped. */
  constructor(difficulty: number, seed: number, readonly started: number, readonly create = false, independentStreams = false) {
    this.board = new ShipBoard(difficulty, seed, 20, independentStreams);
    if (create) this.board.goal = Infinity;
    this.busyUntil = started + GROW_MS;
    this.timerStart = this.tideResetAt = started;
    this.timerDuration = this.board.style.intro || create ? Infinity : TIDE_MS;
  }
  get deadline(): number { return this.timerStart + this.timerDuration; }
  get active(): boolean { return !this.finished; }
  progress(now: number): number {
    const clock = this.pending ? this.pausedTimer : now;
    return Math.max(0, Math.min(1, (clock - this.timerStart) / this.timerDuration));
  }
  tide(now: number): number {
    const blend = Math.max(0, 1 - (now - this.tideResetAt) / RETREAT_MS);
    return Math.max(0, Math.min(1, this.progress(now) + this.tideFrom * blend));
  }
  update(now: number): void {
    if (this.finished) return;
    if (this.pending && now >= this.pending.at) {
      const pending = this.pending;
      const tide = this.tide(pending.at);
      this.pending = null;
      if (this.board.endGame) {
        if (this.overtime) this.timerStart += FLASH_MS;
        else {
          this.overtime = true;
          this.resetTimer(pending.at, this.board.style.intro ? 2000 : OVERTIME_MS, tide);
        }
      } else this.resetTimer(pending.at, this.board.style.intro || this.create ? Infinity : TIDE_MS, tide);
      this.events.push({ type: 'refill', slot: pending.slot, restored: pending.restored });
    }
    if (this.pending) return;
    if (!this.overtime) {
      const warning = now >= this.timerStart + this.timerDuration * 0.9 ? 2 : now >= this.timerStart + this.timerDuration * 0.8 ? 1 : 0;
      if (this.warning < warning) this.events.push({ type: 'warning', level: ++this.warning });
    }
    if (!this.finished && now >= this.deadline) {
      if (this.overtime) { if (now >= this.busyUntil) this.finish(false); return; }
      const slot = this.board.numAvailable - 1;
      this.lost++;
      const remains = this.board.expire();
      this.events.push({ type: 'expired', slot });
      if (!remains) this.finish(true);
      else this.resetTimer(now, TIDE_MS);
    }
  }
  canAct(now: number): boolean { return !this.finished && !this.pending && now >= this.busyUntil; }
  swap(a: Cell, b: Cell, now: number): boolean {
    if (!this.canAct(now) || !this.board.swap(a, b)) return false;
    this.swaps++;
    return true;
  }
  place(slot: number, at: Cell, now: number): number {
    if (!this.canAct(now) || !this.board.canPlace(slot, at)) return 0;
    this.goldUsed += this.board.available[slot].cells.filter(([, x, y]) => this.board.get(at[0] + x, at[1] + y) === GOLD).length;
    const previous = this.board.numAvailable;
    const points = this.board.place(slot, at);
    this.score += points;
    this.bestCombo = Math.max(this.bestCombo, this.board.combo);
    this.pausedTimer = now;
    this.pending = { at: now + FLASH_MS, slot, restored: this.board.numAvailable - previous };
    this.busyUntil = now + FLASH_MS + GROW_MS;
    return points;
  }
  finish(failed: boolean): void {
    if (this.finished) return;
    this.finished = true; this.failed = failed;
    this.events.push({ type: 'finish', failed });
  }
  private resetTimer(now: number, duration: number, tide = this.tide(now)): void {
    this.tideFrom = tide;
    this.tideResetAt = this.timerStart = now;
    this.timerDuration = duration;
    this.warning = 0;
  }
}
