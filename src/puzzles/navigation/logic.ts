// Duty navigation, as in test build 20261018210340: ring board, matcher,
// scorer and wild-target helper. Ring 0 is outermost; octant 0 is east.
import { BoardRandom } from '../forage/board';

export const EMPTY = -1;
export const LEVEL_TARGETS = [3, 5, 7, 10, 13, 16, 20, 25, 30, 35];
export const DISTRIBUTIONS = [
  [1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[2,0,0],[0,1,1],[1,1,1],
  [2,1,0],[0,2,0],[2,0,1],[1,2,0],[2,1,1],[3,0,0],[1,2,1],[3,1,0],
  [3,0,1],[2,2,1],[3,0,2],[3,1,1],[1,1,2],[3,2,0],[2,3,0],[2,1,2],
  [3,2,1],[1,2,2],[3,0,2],[2,2,2],[3,3,1],[1,1,3],[3,1,2],[2,1,3],
  [3,2,2],[2,3,2],[2,2,3],[3,3,2],[3,2,3],[2,3,3],[3,3,3],
];
/** Werewolf Isle's dense constellations: three innermost targets, two in the middle ring, one outside. */
export const DENSE_DISTRIBUTION = [3,2,1];
export interface Target { octant: number; ring: number; colour: number; wild: boolean }
export interface Cell { octant: number; ring: number; colour: number }
export interface Run { direction: 0 | 1; octant: number; ring: number; length: number }
export interface Fall extends Cell { from: number }
export interface Clear { kind: 'target' | 'run'; cells: Cell[]; points: number; chain: number }

class NavigationRandom extends BoardRandom {
  private gaussian: number | null = null;
  double(): number { return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992; }
  nextGaussian(): number {
    if (this.gaussian !== null) { const value = this.gaussian; this.gaussian = null; return value; }
    let x: number, y: number, s: number;
    do { x = 2 * this.double() - 1; y = 2 * this.double() - 1; s = x*x + y*y; } while (s >= 1 || s === 0);
    const scale = Math.sqrt(-2 * Math.log(s) / s);
    this.gaussian = y * scale;
    return x * scale;
  }
}

export class NaviBoard {
  readonly cells: number[];
  readonly entryRandom: NavigationRandom;
  readonly targetRandom: NavigationRandom;
  private entryBag: number[] = [];
  private targetBag: number[] = [];
  constellationCount: number;
  /** Dense boards skip the Gaussian draw and always deal {@link DENSE_DISTRIBUTION}. */
  constructor(readonly rings: number, readonly difficulty: number, seed: number, readonly dense = false) {
    this.cells = Array(rings * 8).fill(EMPTY);
    this.entryRandom = new NavigationRandom(seed);
    this.targetRandom = new NavigationRandom(seed);
    this.constellationCount = Math.trunc(3 * difficulty * DISTRIBUTIONS.length / 9);
  }
  get(octant: number, ring: number): number { return this.cells[ring * 8 + ((octant + 8) % 8)]; }
  set(octant: number, ring: number, colour: number): void { this.cells[ring * 8 + ((octant + 8) % 8)] = colour; }
  private bagNext(bag: number[], rng: NavigationRandom): number {
    if (!bag.length) {
      for (let i = 0; i < 10; i++) bag.push(i % 5);
      for (let i = 9; i > 0; i--) { const j = rng.nextInt(i + 1); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    }
    return bag.shift()!;
  }
  nextEntry(): { octant: number; colour: number } {
    return { colour: this.bagNext(this.entryBag, this.entryRandom), octant: this.entryRandom.nextInt(8) };
  }
  nextConstellation(): Target[] {
    let distribution = DENSE_DISTRIBUTION;
    if (!this.dense) {
      const offset = Math.min(3, Math.max(-3, Math.floor(this.targetRandom.nextGaussian() + 0.5)));
      distribution = DISTRIBUTIONS[Math.min(DISTRIBUTIONS.length - 1, Math.max(0, Math.trunc(this.constellationCount / 3) + offset))];
    }
    this.constellationCount++;
    const targets: Target[] = [];
    for (let ring = this.rings - 1; ring >= this.rings - 3; ring--) {
      for (let i = 0; i < distribution[this.rings - ring - 1]; i++) {
        let octant: number;
        do { octant = this.targetRandom.nextInt(8); } while (targets.some(t => t.ring === ring && t.octant === octant));
        targets.push({ octant, ring, colour: this.bagNext(this.targetBag, this.targetRandom), wild: false });
      }
    }
    return targets;
  }
  rotate(ring: number, clockwise: boolean): void {
    const before = this.cells.slice(ring * 8, ring * 8 + 8);
    for (let i = 0; i < 8; i++) this.set(i, ring, before[(i + (clockwise ? 1 : 7)) % 8]);
  }
  gravity(): Fall[] {
    const falls: Fall[] = [];
    for (let octant = 0; octant < 8; octant++) {
      let to = this.rings - 1;
      for (let from = this.rings - 1; from >= 0; from--) {
        const colour = this.get(octant, from);
        if (colour === EMPTY) continue;
        if (from !== to) { this.set(octant, from, EMPTY); this.set(octant, to, colour); falls.push({ octant, ring: to, from, colour }); }
        to--;
      }
    }
    return falls;
  }
  matches(targets: Target[]): boolean { return targets.length > 0 && targets.every(t => t.wild ? this.get(t.octant, t.ring) !== EMPTY : this.get(t.octant, t.ring) === t.colour); }
  findRuns(): Run[] {
    const runs: Run[] = [];
    const segment = (direction: 0 | 1, octant: number, ring: number): number => {
      const colour = this.get(octant, ring);
      if (colour === EMPTY) return 1;
      let length = 1;
      const max = direction === 0 ? 8 : ring + 1;
      while (length < max && this.get(direction === 0 ? octant + length : octant, direction === 0 ? ring : ring - length) === colour) length++;
      if (length >= 3) runs.push({ direction, octant, ring, length });
      return length;
    };
    for (let ring = 0; ring < this.rings; ring++) {
      let start = 0;
      const colour = this.get(0, ring);
      if (colour !== EMPTY) {
        for (let i = 0; i < 8; i++) {
          start = (start + 7) % 8;
          if (this.get(start, ring) !== colour) { start++; break; }
        }
      }
      for (let done = 0; done < 6;) { const size = segment(0, start, ring); start = (start + size) % 8; done += size; }
    }
    for (let octant = 0; octant < 8; octant++) {
      for (let ring = this.rings - 1; ring >= 0;) ring -= segment(1, octant, ring);
    }
    return runs;
  }
  clearRuns(runs: Run[], chain: number): Clear[] {
    return runs.map(run => {
      const cells: Cell[] = [];
      for (let i = 0; i < run.length; i++) {
        const octant = run.direction === 0 ? (run.octant + i) % 8 : run.octant;
        const ring = run.direction === 0 ? run.ring : run.ring - i;
        const colour = this.get(octant, ring);
        if (colour !== EMPTY) { cells.push({ octant, ring, colour }); this.set(octant, ring, EMPTY); }
      }
      // The reference scores only 3–5 newly removed cells, including overlaps.
      const points = cells.length >= 3 && cells.length <= 5 ? [3, 5, 9][cells.length - 3] * chain : 0;
      return { kind: 'run', cells, points, chain };
    });
  }
  /** A constellation completed in a chain is worth its points times the chain count. */
  clearConstellation(targets: Target[], chain = 1): Clear {
    const counts = [0, 0, 0];
    const cells = targets.map(t => { const colour = this.get(t.octant, t.ring); this.set(t.octant, t.ring, EMPTY); counts[t.ring - (this.rings - 3)]++; return { ...t, colour }; });
    const points = counts.reduce((sum, count, i) => sum + Math.trunc([9, 5, 3][i] * (count * 1.5)**2), 0) * chain;
    return { kind: 'target', cells, points, chain };
  }
}

/** The most targets a constellation can have, with the extra wild one. */
export const MAX_TARGETS = 10;

export class WildTargets {
  clears = 0;
  /** Run-clear passes before the last constellation completed, up to two. */
  private carry = 0;
  constructor(readonly enabled: boolean, readonly rings: number) {}
  action(): void { this.clears = 0; }
  runs(runs: Run[], targets: Target[]): void {
    if (!this.enabled || !runs.length) return;
    if (this.clears++ === 0) return;
    for (const run of runs) for (let i = 0; i < run.length; i++) {
      const o = run.direction === 0 ? (run.octant + i) % 8 : run.octant;
      const r = run.direction === 0 ? run.ring : run.ring - i;
      for (const t of targets) {
        if ((t.ring === r && [o, (o+1)%8, (o+7)%8].includes(t.octant)) || (t.octant === o && Math.abs(t.ring-r) === 1)) t.wild = true;
      }
    }
  }
  completed(targets: Target[]): void {
    if (!this.enabled) return;
    targets.forEach(t => t.wild = false);
    this.carry = Math.min(this.clears, 2);
    this.clears = 0;
  }
  /**
   * One pass: the next constellation's inner-ring targets start wild. Two or more: they do, and
   * an extra wild target joins the inner ring at the first free octant, counting round from the
   * first inner target (or octant 0).
   */
  next(targets: Target[]): void {
    const carry = this.carry;
    this.carry = 0;
    if (!carry) return;
    const inner = this.rings - 1;
    targets.filter(t => t.ring === inner).forEach(t => t.wild = true);
    if (carry < 2 || !targets.length || targets.length >= MAX_TARGETS) return;
    const first = targets.find(t => t.ring === inner);
    const start = first?.octant ?? 0, colour = (first ?? targets[0]).colour;
    for (let i = 0; i < 8; i++) {
      const octant = (start + i) % 8;
      if (!targets.some(t => t.ring === inner && t.octant === octant)) {
        targets.push({ octant, ring: inner, colour, wild: true });
        return;
      }
    }
  }
}
