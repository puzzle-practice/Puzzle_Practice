import { BoardRandom } from '../forage/board';

/**
 * The rigging board: a hexagon of nine rows (5, 6, 7, 8, 9, 8, 7, 6, 5 pieces). Points are
 * { x: column within the row, y: row }. Every straight line of pieces is a rope that slides and wraps.
 */
export const SIZE = 5, ROWS = 2 * SIZE - 1, EMPTY = -1;
export const WILD = 8, TAR = 9, GAFF = 10;
/** Splices: 12 joins NE–W... see LINK_DIRS; the low nibble is the type, as with every piece. */
export const SPLICES = [12, 13, 14] as const;
/** The game's direction numbers: 0 SW, 1 W, 2 NW, 4 NE, 5 E, 6 SE (3 is unused). */
export const DIRS = [4, 5, 6, 0, 1, 2] as const;
export const opposite = (dir: number) => (dir + 4) % 8;
/** The six pulleys, clockwise from the top. Pulls go round them in this order. */
export const PULLEYS: readonly Point[] = [{ x: 2, y: 0 }, { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 2, y: 8 }, { x: 0, y: 6 }, { x: 0, y: 2 }];
/** Shapes that may appear on pieces for each maneuver-token setting (circle, diamond, plus, cross; blade). */
export const BONUS_SETS: readonly (readonly number[])[] = [[], [1, 2, 3, 4], [1, 2, 3, 4, 7]];
export const BONUS_NAMES = ['None', 'Circle', 'Diamond', 'Plus', 'Cross', 'Ring', 'Star', 'Flower'];
const PROB_BONUS = 0.2, MIN_PULL = 3, SKIPS_FOR_PENALTY = 3, LOOPS_FOR_WILD = 20, PENALTY = 5;

export interface Point { x: number; y: number }
/** A pulled piece and the piece it was pulled through, which animations follow back to the pulley. */
export interface Link { at: Point; via: Link | null }

/** One pull: the chain from a pulley, plus a second chain a splice starts. */
export class Pull {
  /** Pieces pulled along the chain (and hooked by gaffs or carried by a splice). */
  readonly pulled = new Map<string, Link>();
  /** Pieces pulled because the chain enclosed them. */
  readonly isolates = new Map<string, Link>();
  /** Tar pulled in this chain: pieces that reappear next to these share one colour. */
  readonly tar: Point[] = [];
  /** Every cleared space in the order the game refills them before shuffling. */
  readonly order: Point[] = [];
  /** Maneuver shapes on the pulled pieces. */
  readonly shapes = new Set<number>();
  /** Shapes completed this pull: they were activated by the last pull and pulled again. */
  readonly maneuvers = new Set<number>();
  /** The chain removed every piece of its colour (at least five pieces): earns tar. */
  tarEarned = false;
  /** The chain reached a pulley two to four steps round from the active one: earns a splice. */
  linked = false;
  colour = 0;
  wilds = 0;
  next: Pull | null = null;

  /** Pieces in this chain and every chain after it. */
  get count(): number { return this.pulled.size + this.isolates.size + (this.next?.count ?? 0); }
  find(at: Point): Link | undefined { return this.pulled.get(key(at)) ?? this.isolates.get(key(at)); }
  /** Points for the pull: count^(0.8 + 0.1 × colours) rounded down, +10 for linking, +25 for tar, +10 per enclosed piece. */
  points(colours: number): number {
    let p = Math.floor(Math.pow(this.count, Math.max(1, 0.8 + 0.1 * colours)));
    if (this.linked) p += 10;
    if (this.tarEarned) p += 25;
    return p + 10 * this.isolates.size;
  }
  *chains(): Generator<Pull> { for (let c: Pull | null = this; c; c = c.next) yield c; }
}

export const key = (p: Point) => `${p.x},${p.y}`;
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const pulleyIndex = (p: Point) => PULLEYS.findIndex(q => same(p, q));
export const isWild = (t: number) => t === WILD || t === TAR || t === GAFF;
export const isLink = (p: number) => p !== EMPTY && (p & 12) === 12;
/** The two directions a splice joins: its ends. */
export function linkDirs(t: number): [number, number] {
  if (t === 12) return [5, 1];
  if (t === 13) return [4, 0];
  return [6, 2];
}
export const rowSize = (y: number) => y <= SIZE - 1 ? SIZE + y : 3 * SIZE - 2 - y;
/** Shape number on a piece (0 for none). */
export const shapeOf = (p: number) => p === EMPTY ? 0 : (p & 4080) >> 4;
export const colourCount = (difficulty: number) => difficulty >= 4 ? 8 : difficulty >= 2 ? 7 : 6;
/** Gaff from difficulty 3, tar from 5 and splices from 6; below that a wild comes instead. */
export function qualifies(special: number, difficulty: number): boolean {
  if (special === TAR) return difficulty >= 5;
  if (special === GAFF) return difficulty >= 3;
  if (special >= 12 && special <= 14) return difficulty >= 6;
  return true;
}

export class RiggingBoard {
  pieces: number[][];
  readonly rng: BoardRandom;
  nextPulley = 0;
  /** Loops on the rope coils; every 20 earns a wild. */
  cache = 0;
  skipped = 0;
  /** Shapes activated by the last pull. */
  potential = new Set<number>();
  pendingSpecials: number[] = [];

  constructor(seed: number, readonly difficulty: number, public bonusMode = 0) {
    this.rng = new BoardRandom(seed);
    this.pieces = Array.from({ length: ROWS }, (_, y) => Array<number>(rowSize(y)).fill(EMPTY));
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < rowSize(y); x++) this.pieces[y][x] = this.generate(pulleyIndex({ x, y }) >= 0);
  }
  get colours(): number { return colourCount(this.difficulty); }
  get skipsRemaining(): number { return SKIPS_FOR_PENALTY - this.skipped; }
  get(p: Point): number { return this.piece(p.y, p.x); }
  /** getPiece(row, column): -1 off the board. */
  piece(y: number, x: number): number { return y < ROWS && x < (this.pieces[y]?.length ?? 0) ? this.pieces[y][x] : EMPTY; }
  set(p: Point, v: number): void { this.pieces[p.y][p.x] = v; }
  cells(): number[] { return this.pieces.flat(); }

  private nextDouble(): number { return (this.rng.next(26) * 2 ** 27 + this.rng.next(27)) / 2 ** 53; }
  private withShape(colour: number): number {
    const pool = BONUS_SETS[this.bonusMode] ?? [];
    if (pool.length && colour < 8 && this.nextDouble() <= PROB_BONUS) return colour | pool[this.rng.nextInt(pool.length)] << 4;
    return colour;
  }
  /** New piece: pulley spaces always get a colour; others take a waiting special first. */
  private generate(pulley: boolean): number {
    if (pulley) return this.withShape(this.rng.nextInt(this.colours));
    const special = this.pendingSpecials.shift();
    if (special === undefined) return this.withShape(this.rng.nextInt(this.colours));
    if (isLink(special) && this.pieces.some(r => r.some(isLink))) return WILD;
    return qualifies(special, this.difficulty) ? special : WILD;
  }

  /** The neighbour in a direction; with wrap, a step off the end of a rope returns to its other end. */
  adjacent(x: number, y: number, dir: number, wrap: boolean): Point | null {
    const s = SIZE;
    switch (dir) {
      case 0:
        if (y >= 2 * s - 2) return wrap ? { x: rowSize(x) - 1, y: x } : null;
        if (y >= s - 1) {
          if (x <= 0) return wrap ? { x: y - (s - 1), y: 0 } : null;
          return { x: x - 1, y: y + 1 };
        }
        return { x, y: y + 1 };
      case 1:
        if (x <= 0) return wrap ? { x: rowSize(y) - 1, y } : null;
        return { x: x - 1, y };
      case 2:
        if (y <= 0) {
          if (!wrap) return null;
          const r = ROWS - x - 1;
          return { x: rowSize(r) - 1, y: r };
        }
        if (y <= s - 1) {
          if (x <= 0) return wrap ? { x: rowSize(ROWS - 1) - 1 - y, y: ROWS - 1 } : null;
          return { x: x - 1, y: y - 1 };
        }
        return { x, y: y - 1 };
      case 4:
        if (y <= 0) return wrap ? { x: 0, y: s - 1 + x } : null;
        if (y <= s - 1) {
          if (x >= rowSize(y) - 1) return wrap ? { x: y, y: ROWS - 1 } : null;
          return { x, y: y - 1 };
        }
        return { x: x + 1, y: y - 1 };
      case 5:
        if (x >= rowSize(y) - 1) return wrap ? { x: 0, y } : null;
        return { x: x + 1, y };
      case 6:
        if (y >= 2 * s - 2) return wrap ? { x: 0, y: s - 1 - x } : null;
        if (y >= s - 1) {
          if (x >= rowSize(y) - 1) return wrap ? { x: 2 * s - 2 - y, y: 0 } : null;
          return { x, y: y + 1 };
        }
        return { x: x + 1, y: y + 1 };
      default:
        return null;
    }
  }
  isAdjacent(a: Point, b: Point): boolean {
    if (a.y === b.y) return Math.abs(a.x - b.x) === 1;
    if (Math.abs(a.y - b.y) !== 1) return false;
    return a.y >= SIZE - 1 && b.y >= SIZE - 1
      ? a.x === b.x || a.y < b.y && a.x === b.x + 1 || a.y > b.y && b.x === a.x + 1
      : a.x === b.x || a.y > b.y && a.x === b.x + 1 || a.y < b.y && b.x === a.x + 1;
  }
  /** The rope through a piece, in the order a slide in that direction moves along it. */
  slidePoints(x: number, y: number, dir: number): Point[] {
    const start = { x, y }, out = [start];
    for (let p = this.adjacent(x, y, dir, true)!; !same(p, start); p = this.adjacent(p.x, p.y, dir, true)!) out.push(p);
    return out;
  }
  /** Moves every piece on the rope `amount` places in `dir`. Returns the rope, or null for no movement. */
  slide(x: number, y: number, dir: number, amount: number): Point[] | null {
    const pts = this.slidePoints(x, y, dir);
    amount %= pts.length;
    if (amount <= 0) return null;
    const old = pts.map(p => this.get(p));
    old.forEach((v, i) => this.set(pts[(i + amount) % pts.length], v));
    return pts;
  }

  /** Pulls at the active pulley, then moves on to the next pulley whatever happened. */
  pullNext(): Pull | null {
    const at = PULLEYS[this.nextPulley];
    const result = this.pull(at.x, at.y, true);
    this.nextPulley = (this.nextPulley + 1) % PULLEYS.length;
    return result;
  }
  private pulleySkipped(): void {
    if (++this.skipped >= SKIPS_FOR_PENALTY) { this.cache = Math.max(0, this.cache - PENALTY); this.skipped = 0; }
    this.potential.clear();
  }

  private pull(x: number, y: number, primary: boolean): Pull | null {
    const colour = this.pieces[y][x] & 15;
    if (colour >= 8) { if (primary) this.pulleySkipped(); return null; }
    const result = new Pull();
    result.colour = colour;
    const queue: Link[] = [{ at: { x, y }, via: null }];
    while (queue.length) this.step(queue, result, colour);
    if (primary) {
      if (result.pulled.size < MIN_PULL) { this.pulleySkipped(); return null; }
      this.skipped = 0;
    }
    for (const n of result.pulled.values()) {
      if (this.get(n.at) === TAR) result.tar.push(n.at);
      if (this.get(n.at) === WILD) result.wilds++;
    }
    for (const n of result.pulled.values()) this.set(n.at, EMPTY);
    this.pullSplice(result);
    if (primary) {
      this.findIsolates(result);
      for (const n of result.isolates.values()) if (this.get(n.at) === TAR) result.tar.push(n.at);
      result.tarEarned = result.count >= 5 && !this.pieces.some(r => r.some(v => (v & 15) === colour));
      const from = pulleyIndex({ x, y });
      for (const c of result.chains()) for (const n of c.pulled.values()) {
        const i = pulleyIndex(n.at);
        if (i === -1) continue;
        const d = Math.abs(from - i);
        if (d >= 2 && d <= 4) { result.linked = true; break; }
      }
    }
    this.cache += result.pulled.size + result.isolates.size;
    if (primary) this.refill(result);
    return result;
  }

  /** One step of the chain: take the next piece, hook its neighbours if it is a gaff, then queue matching neighbours. */
  private step(queue: Link[], result: Pull, colour: number): void {
    const node = queue.shift()!, at = node.at;
    result.pulled.set(key(at), node); result.order.push(at);
    const shape = shapeOf(this.get(at));
    if (shape) result.shapes.add(shape);
    if (this.piece(at.y, at.x) === GAFF) for (const dir of DIRS) {
      const n = this.adjacent(at.x, at.y, dir, false);
      if (!n || result.pulled.has(key(n))) continue;
      const v = this.piece(n.y, n.x), t = v & 15;
      if (t !== colour && !isWild(t) && !isLink(t)) {
        result.pulled.set(key(n), { at: n, via: node }); result.order.push(n);
        if (shapeOf(v)) result.shapes.add(shapeOf(v));
      }
    }
    for (const dir of DIRS) {
      const n = this.adjacent(at.x, at.y, dir, false);
      if (!n || result.pulled.has(key(n)) || queue.some(q => same(q.at, n))) continue;
      const t = this.piece(n.y, n.x) & 15;
      if (t === colour || isWild(t)) queue.push({ at: n, via: node });
    }
  }

  /** A splice next to a cleared space is pulled too, and starts a second chain from its other end. */
  private pullSplice(result: Pull): void {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < this.pieces[y].length; x++) {
      const v = this.pieces[y][x];
      if (!isLink(v)) continue;
      const [a, b] = linkDirs(v & 15).map(d => this.adjacent(x, y, d, false));
      const from = a && this.get(a) === EMPTY ? a : b && this.get(b) === EMPTY ? b : null;
      if (from) {
        const other = from === a ? b : a;
        const node: Link = { at: { x, y }, via: result.find(from) ?? null };
        result.pulled.set(key(node.at), node); result.order.push(node.at);
        if (shapeOf(v)) result.shapes.add(shapeOf(v));
        this.pieces[y][x] = EMPTY;
        if (other && this.get(other) !== EMPTY) {
          result.next = this.pull(other.x, other.y, false);
          const start = result.next?.find(other);
          if (start) start.via = node;
        }
      }
      return;
    }
  }

  /** Pieces the pull cut off from the edge of the board are pulled as well. */
  private findIsolates(result: Pull): void {
    const seen = new Set<string>();
    const flood = (p: Point) => {
      const stack = [p];
      while (stack.length) {
        const q = stack.pop()!;
        if (this.get(q) === EMPTY || seen.has(key(q))) continue;
        seen.add(key(q));
        for (const dir of DIRS) { const n = this.adjacent(q.x, q.y, dir, false); if (n) stack.push(n); }
      }
    };
    for (let x = 0; x < this.pieces[0].length; x++) { flood({ x, y: 0 }); flood({ x, y: ROWS - 1 }); }
    for (let y = 1; y < ROWS - 1; y++) { flood({ x: 0, y }); flood({ x: this.pieces[y].length - 1, y }); }
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < this.pieces[y].length - 1; x++) {
      const at = { x, y };
      if (this.get(at) === EMPTY || seen.has(key(at))) continue;
      result.isolates.set(key(at), { at, via: null }); result.order.push(at);
      if (shapeOf(this.get(at))) result.shapes.add(shapeOf(this.get(at)));
    }
  }

  /** Earned specials join the queue; cleared spaces refill in shuffled order, tar-touched spaces in one colour. */
  private refill(result: Pull): void {
    if (this.cache >= LOOPS_FOR_WILD) {
      for (let i = 0; i < Math.floor(this.cache / LOOPS_FOR_WILD); i++) this.pendingSpecials.push(WILD);
      this.cache %= LOOPS_FOR_WILD;
    }
    if (result.isolates.size > 0) this.pendingSpecials.push(GAFF);
    if (result.tarEarned) this.pendingSpecials.push(TAR);
    if (result.linked) this.pendingSpecials.push(12 + this.rng.nextInt(3));
    const spaces = [...result.chains()].flatMap(c => c.order);
    for (let i = spaces.length - 1; i > 0; i--) {
      const j = this.rng.nextInt(i + 1);
      [spaces[i], spaces[j]] = [spaces[j], spaces[i]];
    }
    let tarColour = this.rng.nextInt(this.colours - 1);
    if (tarColour >= result.colour) tarColour++;
    const tarred: Point[] = [];
    for (const p of spaces) {
      const nearTar = [...result.chains()].some(c => c.tar.some(t => same(t, p) || this.isAdjacent(p, t)));
      if (nearTar) {
        this.set(p, this.withShape(tarColour));
        if (pulleyIndex(p) === -1) tarred.push(p);
      } else this.set(p, this.generate(pulleyIndex(p) >= 0));
    }
    while (this.pendingSpecials.length && tarred.length) {
      const p = tarred.shift()!;
      this.set(p, this.generate(false));
    }
    for (const c of result.chains()) if (c !== result) { for (const s of c.shapes) result.shapes.add(s); c.shapes.clear(); }
    for (const s of this.potential) if (result.shapes.has(s)) result.maneuvers.add(s);
    this.potential = new Set([...result.shapes].filter(s => !result.maneuvers.has(s)));
  }
}
