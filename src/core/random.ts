import { freshSeed, seedFor } from './seeds';

export type RandomState = { algorithm: 'xoshiro128ss-v1'; words: number[]; session?: { seed: number; board: number } };

/** Portable random streams using integer operations and explicit snapshots. */
export class Random {
  private words = [0, 0, 0, 0];
  private session: { seed: number; board: number } | undefined;
  constructor(value?: string | number | bigint | null) { this.seed(value ?? null); }
  seed(value: string | number | bigint | null): void {
    this.session = undefined;
    this.words = [0, 1, 2, 3].map(i => seedFor(value ?? freshSeed(), 'random', i));
    if (!this.words.some(Boolean)) this.words[0] = 1;
  }
  beginSession(seed: number): void { this.seed(seed); this.session = { seed, board: 0 }; }
  /** A new board has its own stream, independent of draws on previous boards. */
  nextBoard(): void {
    if (!this.session) return;
    const session = this.session;
    this.seed(seedFor(session.seed, 'board', session.board++)); this.session = session;
  }
  snapshot(): RandomState {
    return { algorithm: 'xoshiro128ss-v1', words: [...this.words], ...(this.session ? { session: { ...this.session } } : {}) };
  }
  restore(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const s = value as { algorithm?: unknown; words?: unknown; session?: { seed: number; board: number } };
    if (s.algorithm !== 'xoshiro128ss-v1' || !Array.isArray(s.words) || s.words.length !== 4 || !s.words.some(Boolean) ||
      !s.words.every(n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff) ||
      (s.session !== undefined && (!s.session || !Number.isSafeInteger(s.session.seed) || s.session.seed < 0 || s.session.seed > 0xffffffff || !Number.isSafeInteger(s.session.board) || s.session.board < 0))) return false;
    this.words = [...s.words]; this.session = s.session ? { ...s.session } : undefined; return true;
  }
  toJSON(): RandomState { return this.snapshot(); }
  private uint32(): number {
    const s = this.words;
    const five = Math.imul(s[1], 5), result = Math.imul((five << 7) | (five >>> 25), 9);
    const t = s[1] << 9;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t;
    s[3] = (s[3] << 11) | (s[3] >>> 21);
    for (let i = 0; i < 4; i++) s[i] >>>= 0;
    return result >>> 0;
  }
  random(): number { return this.uint32() / 0x100000000; }
  private bits(bits: number): bigint {
    if (!Number.isInteger(bits) || bits < 0) throw new Error('Invalid bit count');
    let value = 0n;
    for (let left = bits; left > 0; left -= 32) { const count = Math.min(left, 32); value = (value << BigInt(count)) | BigInt(this.uint32() >>> (32 - count)); }
    return value;
  }
  private below(n: bigint): bigint {
    if (n <= 0n) throw new Error('Empty random range');
    const bits = n.toString(2).length;
    let r: bigint; do { r = this.bits(bits); } while (r >= n); return r;
  }
  bigInteger(a: bigint, b: bigint): bigint { return a + this.below(b - a + 1n); }
  integer(a: number, b: number): number { return Number(this.bigInteger(BigInt(a), BigInt(b))); }
  choice<T>(values: readonly T[]): T { return values[Number(this.below(BigInt(values.length)))]; }
  pick<T>(values: readonly T[]): T { return values[Math.floor(this.random() * values.length)]; }
  choiceWeighted<T>(values: readonly T[], weights: readonly number[]): T {
    let left = this.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < values.length - 1; i++) { left -= weights[i]; if (left < 0) return values[i]; }
    return values[values.length - 1];
  }
  shuffle<T>(values: T[]): T[] {
    for (let i = values.length - 1; i > 0; i--) { const j = this.integer(0, i); [values[i], values[j]] = [values[j], values[i]]; }
    return values;
  }
}
