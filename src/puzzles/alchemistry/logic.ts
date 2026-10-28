import { seedFor } from '../../core/seeds';
import { BoardRandom } from '../forage/board';

export const WIDTH = 11, HEIGHT = 10;
export const OVERLAP = [11, 15, 19, 23, 25, 27, 29, 31, 33] as const;
export const GOALS = [10, 10, 10, 8, 8, 8, 8, 6, 6] as const;
export const MIN_LAYERS = [1, 1, 1, 1, 1, 1, 1, 2, 2] as const;
export const MAX_LAYERS = [1, 1, 1, 2, 3, 3, 4, 4, 4] as const;
export const SECONDARIES = [0, 1, 1, 1, 1, 2, 2, 2, 3] as const;
export const SINGLE_PIECES = [9, 3, 17, 21, 27, 29, 11, 13, 15, 31, 63] as const;
export const SINGLE_WEIGHTS = [5, 2, 37, 8, 5, 7, 11, 19, 3, 2, 1] as const;
export const DOUBLE_PIECES = [393, 2185, 1161, 2181, 2565, 1541] as const;
export const DOUBLE_WEIGHTS = [10, 20, 20, 30, 10, 10] as const;
export const SPECIAL_MIN = [0, 6, 3, 5] as const;
export const COLOR_NAMES = ['Empty', 'Tail', 'Red', 'Yellow', 'Blue', 'Orange', 'Purple', 'Green', 'Brown', 'Quicksilver'] as const;
export type Cell = [number, number];
export interface PathNode { x: number; y: number; tube: number; depth: number; incoming: boolean[] }
export interface FillResult { x: number; y: number; type: number; color: number; extra: number; bottle?: Bottle }
export interface FillGroup { path: PathNode[]; color: number; results: FillResult[] }
export interface Drop { x: number; from: number; to: number; piece: number }
export const valid = (x: number, y: number): boolean => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT - (x % 2 === 0 ? 1 : 0);
export const inlets = (piece: number, tube = 0): number => (piece >>> (tube * 6)) & 63;
export const colorOf = (piece: number, tube = 0): number => (piece >>> (12 + tube * 4)) & 15;
export const specialOf = (piece: number): number => (piece >>> 20) & 15;
export const hasInlet = (piece: number, tube: number, direction: number): boolean => !!(inlets(piece, tube) & (1 << direction));
export function withColor(piece: number, tube: number, color: number): number {
  const shift = 12 + tube * 4;
  return (piece & ~(15 << shift)) | (color << shift);
}
export function rotated(piece: number, clockwise = true): number {
  const turn = (mask: number) => clockwise ? ((mask << 1) | (mask >> 5)) & 63 : ((mask >> 1) | (mask << 5)) & 63;
  return (piece & ~4095) | turn(inlets(piece)) | (turn(inlets(piece, 1)) << 6);
}
export function neighbor(x: number, y: number, direction: number): Cell {
  const even = x % 2 === 0;
  return [[x, y - 1], [x + 1, y - (even ? 0 : 1)], [x + 1, y + (even ? 1 : 0)],
    [x, y + 1], [x - 1, y + (even ? 1 : 0)], [x - 1, y - (even ? 0 : 1)]][direction] as Cell;
}
export function mixColors(a: number, b: number): number {
  if (a > b) [a, b] = [b, a];
  if (a === 0 || a === 1) return b;
  if (b === 9 || b === 8) return b;
  if ((a === 2 || a === 3) && b === 5) return 5;
  if ((a === 2 || a === 4) && b === 6) return 6;
  if ((a === 3 || a === 4) && b === 7) return 7;
  return a + b >= 5 && a + b <= 7 ? a + b : 8;
}

export class Bottle {
  required = [-1, -1, -1, -1, -1];
  filled = [-1, -1, -1, -1, -1];
  broken = false;
  points = 0;
  get size(): number { return this.required.indexOf(-1); }
  get count(): number { return this.filled.indexOf(-1); }
  get next(): number { return this.required[this.count]; }
  get top(): number { return this.required[this.size - 1]; }
  get value(): number { return this.count ? Math.floor(this.points / this.count + 0.5) : 0; }
  get full(): boolean { return !this.broken && this.count >= this.size; }
  clone(): Bottle {
    const bottle = new Bottle();
    bottle.required = [...this.required]; bottle.filled = [...this.filled];
    bottle.broken = this.broken; bottle.points = this.points;
    return bottle;
  }
  fill(color: number): number {
    if (this.broken) return 2;
    if (this.full) return 1;
    const index = this.count;
    this.filled[index] = color;
    if (this.required[index] !== color && this.required[index] !== 9 && color !== 9) return 2;
    return this.full ? 4 : 3;
  }
}

const sameNode = (a: PathNode, b: PathNode) => a.x === b.x && a.y === b.y && a.tube === b.tube;
const nodeKey = (node: PathNode) => `${node.x},${node.y},${node.tube}`;
const makeNode = (x: number, y: number, tube: number, depth: number, direction: number): PathNode => ({
  x, y, tube, depth, incoming: Array.from({ length: 6 }, (_, i) => i === direction),
});
/** Preserve the game's tie order when several completed bottles compete for the last slots. */
function sortCompleted<T extends { bottle: Bottle }>(a: T[], start = 0, end = a.length - 1): void {
  if (end <= start) return;
  const compare = (x: T, y: T) => y.bottle.value - x.bottle.value;
  if (end - start === 1) { if (compare(a[end], a[start]) < 0) [a[start], a[end]] = [a[end], a[start]]; return; }
  const mid = a[(start + end) >>> 1];
  let lo = start - 1, hi = end + 1;
  for (;;) {
    do { lo++; } while (compare(a[lo], mid) < 0);
    do { hi--; } while (compare(mid, a[hi]) < 0);
    if (hi <= lo) break;
    [a[lo], a[hi]] = [a[hi], a[lo]];
  }
  if (start < lo - 1) sortCompleted(a, start, lo - 1);
  if (hi + 1 < end) sortCompleted(a, hi + 1, end);
}

export class AlchemyBoard {
  cells = new Array<number>(WIDTH * HEIGHT).fill(0);
  colors: number[] = [];
  baseColors: number[] = [];
  bottles: Bottle[] = [];
  finished: Bottle[] = [];
  specials = [0, 0, 0, 0];
  paths: PathNode[][] = Array.from({ length: WIDTH }, () => []);
  connected = false;
  done = false;
  moves = 0;
  lastCell: Cell = [-1, -1];
  missingPrimary = -1;
  hardSecondary = 6;
  rng: BoardRandom;
  /** A separate seeded stream makes the otherwise independent color-pool shuffles replayable. */
  readonly shuffleRng: BoardRandom;
  private pathSets: Set<string>[] = Array.from({ length: WIDTH }, () => new Set());
  private quicksilver = new Set<number>();

  private bottleNumbers = Array<number>(WIDTH).fill(0);
  constructor(readonly difficulty: number, readonly seed: number, readonly independentStreams = false) {
    if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 8) throw new Error('Difficulty must be 0–8');
    this.rng = new BoardRandom(seed);
    this.shuffleRng = new BoardRandom(seed ^ 0x51a7c4);
    for (let x = 0; x < WIDTH; x++) for (let y = 0; valid(x, y); y++) this.set(x, y, this.nextPiece());
    const permutation = this.rng.nextInt(6);
    const bases = [[2, 3, 4], [2, 4, 3], [3, 4, 2], [3, 2, 4], [4, 2, 3], [4, 3, 2]][permutation];
    this.hardSecondary = [6, 5, 5, 7, 7, 6][permutation];
    this.baseColors = Array.from({ length: WIDTH }, (_, x) => bases[difficulty < 2 ? (x < 6 ? 0 : 1) : x < 4 ? 0 : x < 7 ? 1 : 2]);
    this.colors = [...this.baseColors];
    if (difficulty < 2) this.missingPrimary = 9 - this.baseColors[0] - this.baseColors[10];
    this.bottles = Array.from({ length: WIDTH }, (_, column) => this.nextBottle(column));
    this.colorBoard();
  }
  get goal(): number { return GOALS[this.difficulty]; }
  get score(): number { return Math.floor(this.finished.reduce((sum, b) => sum + b.value, 0) * 100 / this.goal + 0.5); }
  get booched(): boolean { return this.bottles.every(b => b.broken); }
  get(x: number, y: number): number { return valid(x, y) ? this.cells[y * WIDTH + x] : 0; }
  set(x: number, y: number, piece: number): void { this.cells[y * WIDTH + x] = piece; }
  rotate(x: number, y: number, clockwise: boolean): boolean {
    if (!valid(x, y) || this.done || this.booched) return false;
    this.set(x, y, rotated(this.get(x, y), clockwise));
    if (this.lastCell[0] !== x || this.lastCell[1] !== y) { this.moves++; this.lastCell = [x, y]; }
    this.colorBoard();
    return true;
  }
  nextPiece(): number {
    const overlap = this.rng.nextInt(100) < OVERLAP[this.difficulty];
    const pieces = overlap ? DOUBLE_PIECES : SINGLE_PIECES, weights = overlap ? DOUBLE_WEIGHTS : SINGLE_WEIGHTS;
    let roll = this.rng.nextInt(100), piece: number = pieces[0];
    for (let i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll < 0) { piece = pieces[i]; break; } }
    const turns = this.rng.nextInt(6);
    for (let i = 0; i < turns; i++) piece = rotated(piece);
    for (let special = 1; special <= 3; special++) {
      if (this.difficulty >= SPECIAL_MIN[special] && this.specials[special] > 0 && this.rng.nextInt(1000) < this.specials[special]) {
        this.specials[special] = 0;
        return piece | (special << 20);
      }
    }
    return piece;
  }
  nextBottle(column = 0): Bottle {
    const rng = this.independentStreams ? new BoardRandom(seedFor(this.seed, `bottle:${column}`, this.bottleNumbers[column]++)) : this.rng;
    const shuffle = this.independentStreams ? rng : this.shuffleRng;
    let pool = [2, 3, 4];
    if (SECONDARIES[this.difficulty]) {
      pool.push(...[5, 6, 7].filter(c => c !== this.hardSecondary || SECONDARIES[this.difficulty] > 1));
    }
    if (this.missingPrimary > 0) pool = pool.filter(c => c !== this.missingPrimary &&
      !({ 2: [5, 6], 3: [5, 7], 4: [6, 7] } as Record<number, number[]>)[this.missingPrimary].includes(c));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = shuffle.nextInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const size = MIN_LAYERS[this.difficulty] + (MAX_LAYERS[this.difficulty] === MIN_LAYERS[this.difficulty] ? 0 :
      rng.nextInt(MAX_LAYERS[this.difficulty] - MIN_LAYERS[this.difficulty] + 1));
    const bottle = new Bottle();
    for (let i = 0; i < size; i++) bottle.required[i] = pool[rng.nextInt(pool.length)];
    return bottle;
  }
  private neighbors(node: PathNode): PathNode[] {
    const found: PathNode[] = [];
    for (let direction = 0; direction < 6; direction++) {
      if (!hasInlet(this.get(node.x, node.y), node.tube, direction)) continue;
      const [x, y] = neighbor(node.x, node.y, direction), opposite = (direction + 3) % 6;
      if (!valid(x, y)) continue;
      const piece = this.get(x, y);
      const tube = hasInlet(piece, 0, opposite) ? 0 : hasInlet(piece, 1, opposite) ? 1 : -1;
      if (tube >= 0) found.push(makeNode(x, y, tube, node.depth + 1, opposite));
    }
    // The six neighbors use the game's hash-bucket order, retaining ties in insertion order.
    return found.sort((a, b) => ((a.x ^ a.y ^ a.tube) & 15) - ((b.x ^ b.y ^ b.tube) & 15));
  }
  colorBoard(): void {
    this.connected = false;
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) this.set(x, y, withColor(withColor(this.get(x, y), 0, 0), 1, 0));
    for (let column = 0; column < WIDTH; column++) {
      let color = this.colors[column];
      this.paths[column] = [];
      const queue: PathNode[] = [], visited = new Set<string>();
      const top = this.get(column, 0);
      if (hasInlet(top, 0, 0)) queue.push(makeNode(column, 0, 0, 0, 0));
      else if (hasInlet(top, 1, 0)) queue.push(makeNode(column, 0, 1, 0, 0));
      while (queue.length) {
        const node = queue.shift()!;
        const previous = colorOf(this.get(node.x, node.y), node.tube);
        if (previous === color) break;
        const mixed = mixColors(previous, color);
        if (mixed !== color || mixed === 9) {
          color = mixed;
          let merged = false;
          for (let earlier = 0; earlier < column; earlier++) {
            if (this.pathSets[earlier].has(nodeKey(node))) {
              for (const p of this.paths[earlier]) this.set(p.x, p.y, withColor(this.get(p.x, p.y), p.tube, color));
              visited.clear(); merged = true; break;
            }
          }
          if (merged) break;
        }
        this.set(node.x, node.y, withColor(this.get(node.x, node.y), node.tube, color));
        for (const next of this.neighbors(node)) {
          if (visited.has(nodeKey(next))) continue;
          const queued = queue.find(p => sameNode(p, next));
          if (queued) queued.incoming = queued.incoming.map((v, i) => v || next.incoming[i]);
          else queue.push(next);
        }
        if (!visited.has(nodeKey(node))) {
          this.paths[column].push(node);
          if (this.bottom(node) && hasInlet(this.get(node.x, node.y), node.tube, 3) && colorOf(this.get(node.x, node.y), node.tube) && !this.bottles[node.x].broken) this.connected = true;
        }
        visited.add(nodeKey(node));
      }
      this.pathSets[column] = visited;
    }
  }
  private bottom(node: PathNode): boolean { return node.y === (node.x % 2 === 0 ? 8 : 9); }
  spouts(): number[] {
    return Array.from({ length: WIDTH }, (_, x) => {
      const piece = this.get(x, x % 2 === 0 ? 8 : 9);
      return hasInlet(piece, 0, 3) ? colorOf(piece) : hasInlet(piece, 1, 3) ? colorOf(piece, 1) : 0;
    });
  }
  colorPoints(color: number): number {
    if ([2, 3, 4, 9].includes(color)) return 5;
    if ([5, 6, 7].includes(color)) return mixColors(this.colors[0], this.colors[10]) === color ? 10 : 8;
    return 0;
  }
  fill(): FillGroup[] {
    const groups: FillGroup[] = [], completed: { x: number; bottle: Bottle; group: FillGroup }[] = [], results: FillResult[] = [];
    for (const path of this.paths) {
      const first = path[0];
      const color = first ? colorOf(this.get(first.x, first.y), first.tube) : 0;
      const group: FillGroup = { path, color, results: [] };
      const ends = path.filter(n => this.bottom(n) && hasInlet(this.get(n.x, n.y), n.tube, 3) && colorOf(this.get(n.x, n.y), n.tube));
      if (!ends.length) continue;
      let multifill = false;
      const add = (x: number, y: number, type: number, c: number, extra = 0, bottle?: Bottle) => {
        const result = { x, y, type, color: c, extra, bottle }; group.results.push(result); results.push(result);
      };
      for (const node of path) {
        const piece = this.get(node.x, node.y), special = specialOf(piece), c = colorOf(piece, node.tube);
        if (special === 1) {
          this.quicksilver.clear();
          const bases: Record<number, number[]> = { 2: [2], 3: [3], 4: [4], 5: [2, 3], 6: [2, 4], 7: [3, 4] };
          for (const primary of bases[c] ?? []) this.quicksilver.add(primary);
          add(node.x, node.y, 5, c);
        } else if (special === 2) add(node.x, node.y, 6, c);
        else if (special === 3) multifill = true;
      }
      for (const node of ends) {
        const bottle = this.bottles[node.x];
        if (bottle.broken) continue;
        const c = colorOf(this.get(node.x, node.y), node.tube);
        const type = bottle.fill(c);
        if (type === 2) bottle.broken = true;
        if (type === 4) completed.push({ x: node.x, bottle, group });
        if (type === 3 && multifill) {
          const repeated = c === 9 ? bottle.required[bottle.count - 1] : c;
          let extra = 0;
          while (bottle.next === repeated) {
            const result = bottle.fill(c); extra++;
            if (result === 4) completed.push({ x: node.x, bottle, group });
            else add(node.x, -1, result, c, 0, bottle);
          }
          if (extra) add(node.x, node.y, 7, c, extra, bottle);
        }
        if (type !== 4) add(node.x, -1, type, c, 0, bottle);
      }
      groups.push(group);
    }
    sortCompleted(completed);
    for (const entry of completed) {
      const accepted = this.finished.length < this.goal;
      if (accepted) this.finished.push(entry.bottle);
      const result = { x: entry.x, y: -1, type: 4, color: entry.bottle.top, extra: accepted ? 1 : 0, bottle: entry.bottle };
      results.push(result); entry.group.results.push(result);
    }
    this.scoreResults(results);
    const completedXs = new Set(completed.map(e => e.x));
    const next: Array<Bottle | null> = this.bottles.map((b, x) => completedXs.has(x) ? null : b);
    this.done = this.finished.length >= this.goal;
    for (let x = WIDTH - 1; x >= 0; x--) if (!next[x]) {
      for (let source = x - 1; source >= 0; source--) if (next[source]) { next[x] = next[source]; next[source] = null; break; }
    }
    this.bottles = next.map((b, column) => b ?? this.nextBottle(column));
    for (const x of [0, 4, 10]) {
      const base = this.baseColors[x];
      this.colors[x] = this.quicksilver.delete(base) ? 9 : base;
    }
    // Freeplay can make any bulb quicksilver; it wears off after a fill too.
    for (let x = 0; x < WIDTH; x++) if (![0, 4, 10].includes(x)) this.colors[x] = this.baseColors[x];
    this.lastCell = [-1, -1];
    return groups;
  }
  private scoreResults(results: FillResult[]): void {
    const affected = new Set<number>(), sequence = new Map<number, number>(), points = new Array<number>(10).fill(0);
    for (const result of results) {
      if (result.type === 2) affected.add(result.x);
      if (result.type === 3 || result.type === 4) { affected.add(result.x); points[result.color] += this.colorPoints(result.color); }
      if (result.type === 6) points[result.color] += 6;
      if (result.type === 7) sequence.set(result.x, result.extra);
    }
    let score = 0, colors = 0;
    for (let color = 0; color < 10; color++) {
      const value = this.colorPoints(color);
      if (!points[color] || !value) continue;
      const count = Math.floor(points[color] / value), base = value === 5 ? 2 : value === 8 ? 3 : 4;
      for (let i = 0; i < count; i++) score = Math.fround(score + i + base);
      if (count > 3) this.specials[3] += 2;
      score = Math.fround(score + value * count); colors++;
    }
    if (colors >= 2) { score = Math.fround(score * Math.fround(3.5 * Math.fround(colors / 6))); this.specials[1] += 3; }
    const average = affected.size ? Math.fround(score / affected.size) : 0;
    for (const x of affected) {
      const bottle = this.bottles[x];
      if (bottle.broken) continue;
      const value = Math.floor(Math.fround(average * (bottle.size > 1 ? Math.fround(1.1) : 1)) + 0.5);
      bottle.points += value;
      if (sequence.has(x)) bottle.points += sequence.get(x)! * value + 3;
    }
    if (score > 45) this.specials[2] += 3;
  }
  /** Remove every tube connected to a bulb, then let whole pieces fall down their columns. */
  refill(): Drop[] {
    for (const path of this.paths) for (const node of path) this.set(node.x, node.y, -1);
    const drops: Drop[] = [];
    for (let x = 0; x < WIDTH; x++) {
      const height = x % 2 === 0 ? 9 : 10;
      let to = height - 1;
      for (let from = height - 1; from >= 0; from--) {
        const piece = this.get(x, from);
        if (piece === -1) continue;
        this.set(x, to, piece); if (from !== to) drops.push({ x, from, to, piece }); to--;
      }
      for (let y = to; y >= 0; y--) {
        const piece = this.nextPiece(); this.set(x, y, piece); drops.push({ x, from: y - to - 1, to: y, piece });
      }
    }
    this.moves = 0;
    this.colorBoard();
    return drops;
  }
}
