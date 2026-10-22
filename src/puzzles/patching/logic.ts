import { BoardRandom } from '../forage/board';

export const WIDTH = 7, HEIGHT = 6;
export const CLOTH = 0, STRAIGHT = 1, ELBOW = 2, TEE = 3, CROSS = 4, GROMMET = 5, TIE = 6, BLOCKER = 7, SPOOL = 8;
export const SLACK = 0, CONNECTED = 1, TAUT = 2, TORN = 3;
const BASE = [[2], [0, 2], [2, 3], [1, 2, 3], [0, 1, 2, 3], [2], [2], [], [2]];
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const opposite = (d: number) => (d + 2) % 4;
export interface Piece { type: number; orientation: number; tension: number; distance: number }
export interface Difficulty { x: number; y: number; width: number; height: number; ties: number; blockers: number; min: number; max: number; wind: number }
export function difficultyInfo(d: number): Difficulty {
  if (!Number.isInteger(d) || d < 0 || d > 10) throw new Error('Difficulty must be 0–10');
  return { x: d < 3 ? 1 : 0, y: d < 3 ? 1 : 0, width: d < 3 ? 5 : d < 5 ? 6 : 7,
    height: d < 3 ? 4 : d < 5 ? 5 : 6, ties: d < 3 ? 1 : d < 7 ? 2 : d < 10 ? 3 : 4,
    blockers: d < 6 ? 0 : d < 8 ? 3 : 5, min: d < 2 ? 2 : 1, max: d < 2 ? 2 : d < 5 ? 3 : 4,
    // YPPedia's timed levels aligned highest to highest; lower practice levels use 75 s.
    wind: [75, 75, 75, 75, 70, 65, 60, 55, 50, 45, 45][d] };
}
export const movable = (p: Piece) => ![CLOTH, TIE, BLOCKER, SPOOL].includes(p.type) && p.tension !== TORN;
export const facing = (p: Piece) => p.tension === TORN ? [] : BASE[p.type].map(d => (d + p.orientation) % 4);
export function neighbour(i: number, d: number): number {
  const x = i % WIDTH + DX[d], y = Math.floor(i / WIDTH) + DY[d];
  return x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT ? -1 : y * WIDTH + x;
}
const makePiece = (type: number, orientation = 0): Piece => ({ type, orientation, tension: type === SPOOL ? CONNECTED : SLACK, distance: 43 });

export class PatchingBoard {
  readonly info: Difficulty;
  readonly rng: BoardRandom;
  pieces = new Map<number, Piece>();
  tiles = new Array<number>(42).fill(SLACK);
  spool = 0;
  ties: number[] = [];
  loose: number[] = [];
  used: number[] = [];
  torn = 0;
  bonuses = new Map<number, number>();
  constructor(readonly difficulty: number, seed: number, generate = true, readonly bonusMode = 0) {
    this.info = difficultyInfo(difficulty); this.rng = new BoardRandom(seed);
    if (generate) this.build();
  }
  inBounds(i: number): boolean {
    if (i < 0 || i >= 42) return false;
    const x = i % 7, y = Math.floor(i / 7), b = this.info;
    return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
  }
  private spawn(i: number, type: number, orientation = 0): Piece {
    const p = makePiece(type, orientation); this.pieces.set(i, p); return p;
  }
  private connections(i: number, dirs: number[]): Piece {
    const ds = [...new Set(dirs)];
    if (ds.length === 0) return this.spawn(i, BLOCKER);
    if (ds.length === 1) return this.spawn(i, GROMMET, opposite(ds[0]));
    if (ds.length === 2) {
      let d = ds[0];
      if (opposite(d) === ds[1]) return this.spawn(i, STRAIGHT, d);
      if ((d + 1) % 4 !== ds[1]) d = ds[1];
      return this.spawn(i, ELBOW, opposite(d));
    }
    if (ds.length === 3) return this.spawn(i, TEE, [0, 1, 2, 3].find(d => !ds.includes(d))!);
    return this.spawn(i, CROSS);
  }
  private segment(i: number, incoming: number, depth: number): boolean {
    const branches = Math.max(depth < 3 ? Math.min(this.info.max - 1, 2) : 0, this.rng.nextInt(this.info.max));
    const next = neighbour(i, opposite(incoming));
    const existing = this.pieces.get(next);
    if (existing) {
      const dirs = facing(existing);
      if (dirs.includes(incoming)) return true;
      if (dirs.length < this.info.max && this.rng.next(1) !== 0) {
        this.pieces.delete(next); dirs.push(incoming); this.connections(next, dirs); return true;
      }
      return false;
    }
    if (branches === 0) { this.connections(next, [incoming]); return true; }
    let dirs = [0, 1, 2, 3].filter(d => d !== incoming);
    if (this.difficulty === 0 && this.pieces.get(this.spool)!.orientation !== incoming)
      dirs = dirs.filter(d => d !== this.pieces.get(this.spool)!.orientation);
    dirs = dirs.filter(d => this.inBounds(neighbour(next, d)));
    while (dirs.length > branches) dirs.splice(this.rng.nextInt(dirs.length), 1);
    const open = dirs.filter(d => !this.pieces.has(neighbour(next, d)));
    const piece = this.connections(next, [...open, incoming]);
    for (const d of [...open]) if (!this.segment(next, opposite(d), depth + 1)) open.splice(open.indexOf(d), 1);
    if (BASE[piece.type].length !== open.length + 1) { this.pieces.delete(next); this.connections(next, [...open, incoming]); }
    return true;
  }
  private size(grommets: number, crosses: number): number {
    let grommet = this.rng.nextFloat() < Math.fround(Math.fround(0.15) + Math.fround(this.info.blockers * Math.fround(0.01)));
    let cross = this.rng.nextFloat() < Math.fround(0.15);
    const min = Math.max(2, this.info.min), max = Math.min(3, this.info.max) + 1;
    const size = this.rng.nextInt(max - min) + min;
    if (grommets < this.minGrommets) grommet = true;
    else if (grommets > 8 + this.minGrommets) grommet = false;
    if (crosses > 6) cross = false;
    return this.info.min <= 1 && grommet ? 1 : this.info.max >= 4 && cross ? 4 : size;
  }
  get minGrommets(): number { return this.info.min >= 2 ? 0 : Math.floor((this.difficulty + 1) / 2); }
  count(type: number): number { return [...this.pieces.values()].filter(p => p.type === type).length; }
  private build(): void {
    for (let retry = 0; retry < 100; retry++) {
      this.pieces.clear(); this.ties = [];
      this.spool = (this.rng.nextInt(this.info.width) + this.info.x) + (this.rng.nextInt(this.info.height) + this.info.y) * 7;
      let dir = this.rng.nextInt(4);
      if (!this.inBounds(neighbour(this.spool, dir))) dir = opposite(dir);
      dir = opposite(dir);
      this.spawn(this.spool, SPOOL, dir); this.segment(this.spool, dir, 0);
      const ends = [...this.pieces.entries()].filter(([, p]) => p.type === GROMMET).sort(([a], [b]) => a - b);
      let failed = false;
      for (let n = 0; n < this.info.ties; n++) {
        if (!ends.length) { failed = true; break; }
        const [i, p] = ends.splice(this.rng.nextInt(ends.length), 1)[0];
        this.pieces.delete(i); this.spawn(i, TIE, p.orientation); this.ties.push(i);
      }
      if (failed) continue;
      this.tiles.fill(SLACK);
      const fill: number[] = [];
      let grommets = ends.length, crosses = this.count(CROSS);
      for (let i = 0; i < 42; i++) {
        if (!this.inBounds(i)) this.spawn(i, BLOCKER);
        else if (!this.pieces.has(i) || this.difficulty < 2 && this.pieces.get(i)!.type === GROMMET) {
          this.pieces.delete(i); fill.push(i);
          const count = this.size(grommets, crosses);
          if (count === 1) grommets++; else if (count === 4) crosses++;
          const dirs = [0, 1, 2, 3];
          while (dirs.length > count) dirs.splice(this.rng.nextInt(dirs.length), 1);
          this.connections(i, dirs);
        }
      }
      for (let n = 0; n < this.info.blockers && fill.length; n++) {
        const i = fill.splice(this.rng.nextInt(fill.length), 1)[0]; this.pieces.delete(i); this.spawn(i, BLOCKER);
      }
      this.distances();
      if (this.difficulty <= 1 && this.pieces.get(this.ties[0])!.distance < 5) continue;
      const first = neighbour(this.spool, facing(this.pieces.get(this.spool)!)[0]);
      const accessible = new Set<number>([first]);
      const visit = (i: number) => { for (let d = 0; d < 4; d++) {
        const n = neighbour(i, d), p = this.pieces.get(n);
        if (p && movable(p) && !accessible.has(n)) { accessible.add(n); visit(n); }
      } };
      visit(first);
      if (accessible.size < this.numMovable || this.count(GROMMET) < this.minGrommets) continue;
      for (let shuffle = 0; shuffle < 100; shuffle++) {
        for (let i = 0; i < 42; i++) this.swap(i, this.rng.nextInt(41), false);
        this.update();
        if (!this.allTiesConnected) break;
      }
      if (this.bonusMode > 0) for (const i of this.pieces.keys()) {
        const cluster = this.cluster(i);
        if (!cluster.every(n => n >= 0 && this.pieces.has(n) && this.pieces.get(n)!.type !== BLOCKER)) continue;
        const random = (this.rng.next(26) * 134217728 + this.rng.next(27)) / 9007199254740992;
        if (random <= 0.2) {
          const types = this.bonusMode === 1 ? [1, 2, 3, 4] : [1, 2, 3, 4, 7];
          this.bonuses.set(i, types[this.rng.nextInt(types.length)]);
        }
      }
      return;
    }
    throw new Error('Unable to create Patching board');
  }
  rotate(i: number, delta: number): boolean {
    const p = this.pieces.get(i); if (!p || !movable(p)) return false;
    p.orientation = (p.orientation + delta + 4) % 4; this.update(); return true;
  }
  swap(a: number, b: number, update = true): boolean {
    const p = this.pieces.get(a), q = this.pieces.get(b);
    if (a === b || !p || !q || !movable(p) || !movable(q)) return false;
    this.pieces.set(b, p); this.pieces.set(a, q); if (update) this.update(); return true;
  }
  update(gust = false): boolean {
    this.loose = [];
    const spool = this.pieces.get(this.spool)!;
    const next = neighbour(this.spool, opposite(spool.orientation));
    const reached = new Set<number>([this.spool]);
    const state = gust ? TAUT : CONNECTED;
    spool.tension = state; this.tiles[this.spool] = state;
    const first = this.pieces.get(next)!;
    const connected = facing(first).includes(spool.orientation);
    const visit = (i: number, incoming: number) => {
      const p = this.pieces.get(i)!; reached.add(i); p.tension = state;
      for (const d of facing(p)) {
        const n = neighbour(i, d), q = this.inBounds(n) ? this.pieces.get(n) : undefined;
        const matches = q !== undefined && facing(q).includes(opposite(d));
        const tears = !matches && incoming !== d && gust;
        if (!matches && incoming !== d && p.tension !== TORN) this.loose.push(i);
        if (matches && !reached.has(n)) visit(n, opposite(d));
        else if (tears) {
          p.tension = TORN;
          if (q) { reached.add(n); q.tension = TORN; this.tiles[n] = TORN; }
        }
      }
      this.tiles[i] = p.tension;
    };
    if (connected) visit(next, spool.orientation);
    if (gust && (!connected || first.tension === TORN)) { spool.tension = TORN; this.tiles[this.spool] = TORN; }
    const detached: number[] = [];
    for (const [i, p] of this.pieces) if (p.type !== BLOCKER && !reached.has(i)) {
      if (p.tension !== TORN) { p.tension = SLACK; this.tiles[i] = SLACK; }
      detached.push(i);
    }
    let done = false;
    if (gust) {
      this.used = [];
      for (const i of detached) { if (this.tiles[i] === TORN) this.pieces.get(i)!.tension = SLACK; this.tiles[i] = SLACK; }
      this.torn = [...reached].filter(i => this.pieces.get(i)!.tension === TORN).length;
      done = this.torn > 0 || this.ties.every(i => this.pieces.get(i)!.tension === TAUT);
    }
    if (gust && !done) {
      for (const [i, p] of [...this.pieces]) if (p.type === GROMMET && p.tension === TAUT) {
        this.pieces.delete(i); this.spawn(i, STRAIGHT, p.orientation); this.used.push(i);
      }
      if (!this.used.length && !this.torn) {
        spool.tension = TORN; this.tiles[this.spool] = TORN; this.torn = 1; done = true;
      }
    }
    return done;
  }
  gust(): { done: boolean; score: number; torn: number; used: number[] } {
    const done = this.update(true), score = this.score(); return { done, score, torn: this.torn, used: [...this.used] };
  }
  get allTiesConnected(): boolean { return this.ties.every(i => [CONNECTED, TAUT].includes(this.pieces.get(i)!.tension)); }
  get numConnected(): number { return [...this.pieces.values()].filter(p => [CONNECTED, TAUT].includes(p.tension)).length; }
  get numGrommets(): number { return [...this.pieces.values()].filter(p => p.type === GROMMET && [CONNECTED, TAUT].includes(p.tension)).length; }
  get numMovable(): number { return [...this.pieces.values()].filter(movable).length; }
  get numMovableConnected(): number { return [...this.pieces.values()].filter(p => movable(p) && [CONNECTED, TAUT].includes(p.tension)).length; }
  get canGust(): boolean { return (this.allTiesConnected || this.numGrommets > 0) && this.loose.length === 0 && this.numConnected > 1; }
  cluster(i: number): number[] { return i % 7 === 0 ? [-1] : [i, i - 1, i - 7, i - 8]; }
  bonusActive(i: number): boolean { return this.cluster(i).every(n => this.pieces.get(n)?.tension === CONNECTED); }
  get activeBonusTypes(): Set<number> { return new Set([...this.bonuses].filter(([i]) => this.bonusActive(i)).map(([, type]) => type)); }
  score(): number {
    let score = 0;
    for (const p of this.pieces.values()) if (p.tension === TAUT) score += p.type === GROMMET ? 10 : p.type === TIE ? 5 : 1;
    const fraction = Math.fround(this.numMovableConnected / this.numMovable);
    if (!(fraction <= 0.5)) score += fraction <= Math.fround(0.8) ? 5 : fraction <= Math.fround(0.99) ? 30 : 50;
    score = Math.trunc(Math.fround(score * Math.fround(1 + Math.fround(this.difficulty / 10))));
    return this.torn > 0 ? Math.trunc(Math.fround(score * Math.fround(0.35))) : score;
  }
  distances(): void {
    for (const p of this.pieces.values()) p.distance = 43;
    const visit = (i: number, distance: number) => {
      const p = this.pieces.get(i)!; p.distance = distance;
      for (const d of facing(p)) {
        const n = neighbour(i, d), q = this.inBounds(n) ? this.pieces.get(n) : undefined;
        if (q && facing(q).includes(opposite(d)) && q.distance > distance + 1) visit(n, distance + 1);
      }
    };
    visit(this.spool, 0);
  }
  snapshot(): number[][] { return Array.from({ length: 42 }, (_, i) => { const p = this.pieces.get(i)!; return [p.type, p.orientation, p.tension, this.tiles[i]]; }); }
}
