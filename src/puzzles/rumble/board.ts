// Rumble's board rules, with incoming punches and sprinkle. A 10x21 hex grid whose rows alternate between
// 10 and 9 cells; balls hang from the top, fists shoot from the bottom.
import type { Random } from '../../core/random';
import type { Glove } from './gloves';
import {
  BLOCKED, EMPTY, FURBALL, ORANGE, ball, colourOf, dark, isBall, isBruise, isCharged, isDark, isLight, light, plain,
} from './pieces';

export const W = 10;
export const H = 21;
/** Ball tiles are 30x30, laid 26 across and 23 down; short rows sit 13 to the right. */
export const BALL = 30;
export const STEP_X = 26;
export const STEP_Y = 23;
export const HALF = 13;
/** The board view (264x536); the walls and ceiling the balls bounce in. */
export const VIEW_W = 264;
export const VIEW_H = 536;
const PIXEL_W = W * STEP_X + 4;
const PIXEL_H = (H + 1) * STEP_Y + 7;
export const LEFT = 15;
export const RIGHT = PIXEL_W - 15;
export const TOP = 15;
export const BOTTOM = PIXEL_H - 15;
/** Angles are in half degrees: 0 is right, 180 straight up. */
export const DIR_PREC = 2;
/** A board drops a row on its eighth shot. */
export const DROP_SHOTS = 7;
/** The most sprinkle one strike can hold, and the most strikes linked to land together. */
export const MAX_LINKED_SPRINKLE = 6 * 8;
export const MAX_LINKED = 4;

export interface Point {
  x: number;
  y: number;
}

const key = (p: Point) => p.y * W + p.x;
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/** A strike on its way to a board. A punch has a height; otherwise it's sprinkle. */
export interface Shaft {
  /** Who sent it. */
  from: number;
  id: number;
  /** Sprinkle balls (ignored on a punch). */
  count: number;
  /** 1: from the left wall, 0: from the right. */
  side: number;
  width: number;
  height: number;
  /** Bruises scattered through a punch. */
  blacks: number;
  /** The id of the next strike linked to this one, 0 if none. */
  next: number;
  /** The punch's drop-off, kept for suppression. */
  dropped?: number;
}

/** Where a fist's shot goes: the path it flies and the cell it ends in. */
export interface Shot {
  flight: Point[];
  rest: Point;
}

/** A ball moving in a punch: from cell `from` of its column's path to cell `to` (negative: from outside). */
export interface PunchMove {
  piece: number;
  from: number;
  to: number;
  /** Steps to wait before this ball starts moving. Incoming balls queue at the entry. */
  wait: number;
}

export interface PunchColumn {
  /** Each cell the punch passed through, in order down its diagonal. */
  cells: Point[];
  moves: PunchMove[];
  /** Balls destroyed to make room, and the step the punch reached them. */
  destroyed: Array<{ piece: number; at: number; step: number }>;
}

export interface PunchResult {
  columns: PunchColumn[];
  /** Row 0 and the rows where the punch's first column hit a wall, for the fists (E.c). */
  bounces: number[];
}

export interface SprinkleBall {
  piece: number;
  cell: Point;
  /** Its place in its column, from the bottom. */
  depth: number;
}

/** A clear: every ball popped, each group in order, and the balls that fell. */
export interface Clear {
  popped: Point[];
  groups: Point[][];
  grapes: Point[];
  /** Pieces as they were, before the clear took them. */
  pieces: Map<number, number>;
  /** Bruises lightened by the pops. */
  lightened: Point[];
}

/** What a clear sends, before suppression and defence change it. */
export interface Sent {
  height: number;
  width: number;
  count: number;
  /** Balls that counted towards it. */
  popped: number;
  dropped: number;
  groups: number;
}

/** Fisher-Yates in place with a board's spare random numbers (ArrayUtil.shuffle). */
function shuffle(values: number[], rng: Random): void {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
}

/**
 * What a clear sends: two or more groups make a punch, one group sprinkle. `minutes`
 * is the time bonus (+20% per minute). `output` is what counts against the bruise counter, before
 * the bonus.
 */
export function shaftSent(groups: number, popped: number, dropped: number, minutes = 0): { sent: Sent; output: number } {
  const sent: Sent = { height: 0, width: 0, count: 0, popped, dropped, groups };
  if (groups <= 0) return { sent, output: 0 };
  const m = (minutes * 2) / 10;
  const length = (g: number) => Math.trunc((g * 3) / 4) + Math.max(0, g - 10) - Math.max(0, g - 20);
  if (groups > 1) {
    let height = length(groups);
    let width = Math.min(Math.trunc((popped + Math.trunc(dropped / 2) * groups) / height), W - 1);
    const output = width * height;
    sent.count = dropped;
    const g = Math.trunc(groups + groups * m);
    const p = Math.trunc(popped + popped * m);
    const d = Math.trunc(dropped + dropped * m);
    height = Math.min(length(g), H);
    width = Math.min(Math.trunc((p + Math.trunc(d / 2) * g) / height), W - 1);
    sent.height = height;
    sent.width = width;
    return { sent, output };
  }
  const output = Math.min(Math.trunc(dropped / 3) + Math.trunc(popped / 2), (W - 1) * 2);
  const p = Math.trunc(popped + popped * m);
  sent.count = Math.trunc(dropped / 3) + Math.trunc(p / 2);
  return { sent, output };
}

export const nextInt = (rng: Random, n: number) => Math.floor(rng.random() * n);

export interface BoardOptions {
  oneFisted?: boolean;
  /** Werewolf rumbling: orange balls are brown furballs. */
  werewolf?: boolean;
  /** 0-100, the damage level: every 6 is a blocked row at the top. */
  damageLevel?: number;
  /** Rows of balls to start with. */
  startRows?: number;
}

export class Board {
  readonly cells = new Array<number>(W * H).fill(EMPTY);
  readonly damage: number;
  readonly fists: number;
  readonly origins: Point[];
  /** Each fist's angle range, in half degrees. */
  readonly ranges: Array<[number, number]>;
  readonly werewolf: boolean;
  /** Which rows are 10 wide: those with y % 2 equal to this. Flips with every drop. */
  topLarge: number;
  shots = 0;
  /** Primed sparks, oldest first. */
  sparks: Point[] = [];
  /** The hidden bruise counter, -100 to 100. */
  bruiseCounter = 0;
  /** Balls each fist is dealt, the one after the current one. */
  private readonly upcoming = [EMPTY, EMPTY];
  private readonly fistRng: Random[];
  private dark = new Map<number, Point>();

  constructor(private readonly rng: Random, readonly alt: Random, fistRngs: [Random, Random], options: BoardOptions = {}) {
    this.fistRng = fistRngs;
    this.werewolf = !!options.werewolf;
    this.damage = Math.floor((options.damageLevel ?? 0) * 5 * (H - 1) / 600);
    this.topLarge = this.damage % 2;
    if (options.oneFisted) {
      this.fists = 1;
      this.origins = [{ x: Math.floor(PIXEL_W / 2), y: BOTTOM }];
      this.ranges = [[DIR_PREC * 10, DIR_PREC * 170]];
    } else {
      this.fists = 2;
      this.origins = [{ x: LEFT + 26, y: BOTTOM }, { x: RIGHT - 26, y: BOTTOM }];
      this.ranges = [[DIR_PREC * 10, DIR_PREC * 150], [DIR_PREC * 30, DIR_PREC * 170]];
    }
    for (let y = 0; y < this.damage; y++) for (let x = 0; x < W; x++) this.cells[y * W + x] = BLOCKED;
    const rows = options.startRows ?? 3;
    for (let y = this.damage; y < Math.min(H - 1, rows + this.damage); y++) {
      for (let x = 0; x < this.width(y); x++) this.set({ x, y }, this.randomBall(this.rng));
    }
  }

  clone(): Board {
    const copy = Object.create(Board.prototype) as Board;
    Object.assign(copy, this);
    (copy as { cells: number[] }).cells = this.cells.slice();
    copy.sparks = this.sparks.map((p) => ({ ...p }));
    copy.dark = new Map();
    (copy as unknown as { upcoming: number[] }).upcoming = this.upcoming.slice();
    return copy;
  }

  largeRow(y: number): boolean {
    return ((y % 2) + 2) % 2 === this.topLarge;
  }

  width(y: number): number {
    return W - (this.largeRow(y) ? 0 : 1);
  }

  valid(p: Point): boolean {
    return p.x >= 0 && p.y >= this.damage && p.x < this.width(p.y) && p.y < H;
  }

  get(p: Point): number {
    if (p.x < 0 || p.x >= W || p.y < 0 || p.y >= H) return -1;
    return this.cells[p.y * W + p.x];
  }

  set(p: Point, piece: number): boolean {
    if (!this.valid(p)) return false;
    this.cells[p.y * W + p.x] = piece;
    return true;
  }

  /** The top-left of a cell's ball in the view. */
  pixel(p: Point): Point {
    return { x: p.x * STEP_X + (this.largeRow(p.y) ? 0 : HALF), y: p.y * STEP_Y };
  }

  /** The cell under a point of the view. */
  cellAt(px: number, py: number): Point {
    const y = Math.trunc(py / STEP_Y);
    return { x: Math.trunc((px - (this.largeRow(y) ? 0 : HALF)) / STEP_X), y };
  }

  private randomBall(rng: Random): number {
    let colour = nextInt(rng, 5);
    if (this.werewolf && colour === ORANGE) colour = FURBALL;
    return ball(colour);
  }

  /** The ball a fist holds next, without taking it. */
  peek(fist: number): number {
    if (this.upcoming[fist] === EMPTY) this.upcoming[fist] = this.randomBall(this.fistRng[fist]);
    return this.upcoming[fist];
  }

  /** Takes the next ball for a fist. */
  take(fist: number): number {
    const piece = this.peek(fist);
    this.upcoming[fist] = this.randomBall(this.fistRng[fist]);
    return piece;
  }

  neighbour(p: Point, direction: number): Point {
    const large = this.largeRow(p.y);
    switch (direction) {
      case 0: return { x: large ? p.x - 1 : p.x, y: p.y - 1 };
      case 1: return { x: large ? p.x : p.x + 1, y: p.y - 1 };
      case 2: return { x: p.x - 1, y: p.y };
      case 3: return { x: p.x + 1, y: p.y };
      case 4: return { x: large ? p.x - 1 : p.x, y: p.y + 1 };
      case 5: return { x: large ? p.x : p.x + 1, y: p.y + 1 };
      default: return p;
    }
  }

  adjacent(a: Point, b: Point): boolean {
    let dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dy === 0) return dx === -1 || dx === 1;
    if (dy !== -1 && dy !== 1) return false;
    if (!this.largeRow(a.y)) dx--;
    return dx === -1 || dx === 0;
  }

  /**
   * Floods out from a ball. Matching: same-coloured balls go in `group`, and
   * bruises it touches are noted to lighten. Otherwise every ball reached goes in `reached`.
   */
  private flood(start: Point, colour: number, matching: boolean, group: Map<number, Point>, reached: Map<number, Point>): void {
    const stack = [start];
    while (stack.length) {
      const p = stack.pop()!;
      if (!this.valid(p) || group.has(key(p)) || reached.has(key(p))) continue;
      const piece = this.get(p);
      if (!isBall(piece)) continue;
      if (matching) {
        if (isBruise(piece)) {
          this.dark.set(key(p), p);
          continue;
        }
        if (colour !== colourOf(piece)) continue;
        group.set(key(p), p);
      } else {
        reached.set(key(p), p);
      }
      for (let d = 0; d < 6; d++) stack.push(this.neighbour(p, d));
    }
  }

  groupOf(p: Point, excluded = new Map<number, Point>()): Map<number, Point> {
    const group = new Map<number, Point>();
    this.flood(p, colourOf(this.get(p)), true, group, excluded);
    return group;
  }

  /** Balls no longer hanging from the top once `popped` are gone. */
  grapesAfter(popped: Map<number, Point>): Point[] {
    const connected = new Map<number, Point>();
    for (let x = 0; x < this.width(0); x++) this.flood({ x, y: this.damage }, 0, false, popped, connected);
    const grapes: Point[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < this.width(y); x++) {
        const piece = this.cells[y * W + x];
        const k = y * W + x;
        if (piece !== EMPTY && piece !== BLOCKED && !popped.has(k) && !connected.has(k)) grapes.push({ x, y });
      }
    }
    return grapes;
  }

  /**
   * A shot ball has landed at `at`. Without three of its colour it just sits there,
   * losing any charge. A charged ball in a group becomes a spark instead of popping. A plain ball
   * in a group pops it, and if the group holds a spark, every spark primed after that one pops
   * its own group in turn. Returns the clear, or null if nothing popped.
   */
  place(at: Point): Clear | null {
    let piece = this.get(at);
    const wasCharged = isCharged(piece);
    this.dark.clear();
    const shotGroup = new Map<number, Point>();
    this.flood(at, colourOf(piece), true, shotGroup, new Map());
    if (shotGroup.size < 3) {
      if (wasCharged) this.set(at, plain(piece));
      return null;
    }
    if (wasCharged) {
      let primes = true;
      if (colourOf(piece) === FURBALL) primes = [...shotGroup.values()].filter((p) => isCharged(this.get(p))).length >= 2;
      if (primes) this.sparks.push({ ...at });
      return null;
    }
    const popped = shotGroup;
    const groups: Point[][] = [[...shotGroup.values()]];
    let i = 0;
    for (; i < this.sparks.length; i++) {
      if (popped.has(key(this.sparks[i]))) break;
    }
    if (i < this.sparks.length) {
      const chained = this.sparks.splice(i);
      chained.shift();
      for (const spark of chained) {
        piece = this.get(spark);
        if (!isCharged(piece)) continue;
        const group = new Map<number, Point>();
        this.flood(spark, colourOf(piece), true, group, popped);
        // The failed spark's bruise goes onto the shot ball, which is popping anyway, as in the game.
        if (group.size < 3) this.set(at, dark(piece));
        else {
          groups.push([...group.values()]);
          for (const [k, p] of group) popped.set(k, p);
        }
      }
    }
    const grapes = this.grapesAfter(popped);
    const gone = new Set([...popped.keys(), ...grapes.map(key)]);
    this.sparks = this.sparks.filter((p) => !gone.has(key(p)));
    const lightened: Point[] = [];
    const grapeKeys = new Set(grapes.map(key));
    for (const [k, p] of this.dark) {
      if (grapeKeys.has(k)) continue;
      const b = this.get(p);
      if (isDark(b)) this.set(p, light(b));
      else if (isLight(b)) this.set(p, plain(b));
      lightened.push(p);
    }
    const pieces = new Map<number, number>();
    for (const p of [...popped.values(), ...grapes]) pieces.set(key(p), this.get(p));
    return { popped: [...popped.values()], groups, grapes, pieces, lightened };
  }

  /** Empties the cleared balls from the board. */
  remove(clear: Clear): void {
    for (const p of clear.popped) this.cells[key(p)] = EMPTY;
    for (const p of clear.grapes) this.cells[key(p)] = EMPTY;
  }

  /** How many groups a clear counts as: one each, or a furball group's charged balls, 1 to 5. */
  groupCount(clear: Clear): number {
    let n = 0;
    for (const group of clear.groups) {
      if (!group.length) continue;
      const first = clear.pieces.get(key(group[0])) ?? this.get(group[0]);
      if (colourOf(first) === FURBALL) {
        const sparks = group.filter((p) => isCharged(clear.pieces.get(key(p)) ?? this.get(p))).length;
        n += Math.max(1, Math.min(5, sparks));
      } else n++;
    }
    return n;
  }

  /**
   * What a clear sends: two or more groups make a punch, one group sprinkle. `minutes`
   * is the time bonus (+20% per minute). Also moves the bruise counter.
   */
  sent(groups: number, popped: number, dropped: number, minutes = 0): Sent {
    const { sent, output } = shaftSent(groups, popped, dropped, minutes);
    if (groups > 0) this.ratio(popped + dropped, output);
    return sent;
  }

  /** The bruise counter: balls cleared count two thirds, what was sent counts against. */
  private ratio(cleared: number, output: number): void {
    this.bruiseCounter = Math.max(-100, Math.min(100, this.bruiseCounter + Math.trunc((cleared * 2) / 3) - output));
  }

  /** A shot was taken: true if the board drops a row now. */
  fired(): boolean {
    this.shots++;
    if (this.shots > DROP_SHOTS) {
      this.drop();
      return true;
    }
    return false;
  }

  /**
   * Pushes everything down a row and deals a new top row, some of it bruised. A short row's
   * tenth cell can keep an old value; nothing reads past a row's width.
   */
  drop(): void {
    this.shots = 0;
    this.topLarge = (this.topLarge + 1) % 2;
    for (let y = H - 1; y > this.damage; y--) {
      this.cells[W * (y + 1) - 1] = EMPTY;
      for (let x = this.width(y) - 1; x >= 0; x--) this.cells[W * y + x] = this.cells[W * (y - 1) + x];
    }
    for (let x = 0; x < this.width(this.damage); x++) {
      let piece = this.randomBall(this.rng);
      const chance = this.bruiseCounter > 0 ? Math.trunc((this.bruiseCounter * 4) / 10) : 0;
      if (nextInt(this.rng, 100) < chance) piece = dark(piece);
      this.set({ x, y: this.damage }, piece);
    }
    this.sparks = this.sparks.filter((p) => ++p.y < H);
  }

  /** At the start of a turn, sparks whose group is now under three turn to bruises. */
  verifySparks(): void {
    this.sparks = this.sparks.filter((p) => {
      const piece = this.get(p);
      if (!isCharged(piece)) return false;
      if (this.groupOf(p).size < 3) {
        this.set(p, dark(piece));
        return false;
      }
      return true;
    });
  }

  isDead(): boolean {
    const y = H - 1;
    for (let x = 0; x < this.width(y); x++) if (this.cells[y * W + x] !== EMPTY) return true;
    return false;
  }

  /** Balls on the board, for the AI. */
  count(): number {
    let n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < this.width(y); x++) if (isBall(this.cells[y * W + x])) n++;
    return n;
  }

  /** The lowest row with a ball in it, or -1. */
  lowest(): number {
    for (let y = H - 1; y >= 0; y--) {
      for (let x = 0; x < this.width(y); x++) if (isBall(this.cells[y * W + x])) return y;
    }
    return -1;
  }

  private updateSpark(from: Point | null, to: Point | null): void {
    if (!from) {
      if (to) this.sparks.unshift({ ...to });
      return;
    }
    const i = this.sparks.findIndex((p) => same(p, from));
    if (i < 0) return;
    if (!to) this.sparks.splice(i, 1);
    else this.sparks[i] = { ...to };
  }

  // ---- Aiming ----

  /** The line a fist's shot flies, bouncing off the walls until it reaches the ceiling. */
  path(fist: number, dir: number): Point[] {
    const origin = this.origins[fist];
    const path: Point[] = [{ ...origin }];
    if (dir === 90 * DIR_PREC) {
      path.push({ x: origin.x, y: TOP });
      return path;
    }
    const p = { ...origin };
    let d = dir;
    do {
      const t = Math.tan(((d / DIR_PREC) * Math.PI) / 180);
      const dx = (d < 90 * DIR_PREC ? RIGHT : LEFT) - p.x;
      const dy = Math.trunc(t * dx);
      p.y -= dy;
      if (p.y > TOP) {
        p.x += dx;
        path.push({ ...p });
        d = 180 * DIR_PREC - d;
      } else {
        const x = Math.trunc((p.y + dy - TOP) / t);
        path.push({ x: p.x + x, y: TOP });
      }
    } while (p.y > TOP);
    return path;
  }

  /**
   * Where a shot along `path` ends: every cell within a ball's width of the line,
   * in order along it; the shot stops at the first filled one and rests in the empty cell next to
   * it nearest where it touched. Null if it has nowhere to go.
   */
  shoot(path: Point[]): Shot | null {
    const hits: Hit[] = [];
    const flight: Point[] = [{ ...path[0] }];
    let from = path[0];
    let along = 0;
    for (let i = 1; i < path.length; i++) {
      const to = path[i];
      if (this.line(from, to, along, hits)) break;
      flight.push({ ...to });
      along += Math.hypot(to.x - from.x, to.y - from.y) + 30;
      from = to;
    }
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      if (this.get(hit.cell) !== EMPTY) {
        const rest = this.restingHit(i, hits);
        if (!rest) return null;
        flight.push(hit.contact);
        return { flight, rest: rest.cell };
      }
      if (i === hits.length - 1) {
        const end = path[path.length - 1];
        const rest = this.restingTop(end, hits);
        if (!rest) return null;
        flight.push({ ...end });
        return { flight, rest: rest.cell };
      }
    }
    return null;
  }

  private line(from: Point, to: Point, along: number, hits: Hit[]): boolean {
    const r2 = 26 * 26;
    const length2 = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
    const lx = to.x - from.x;
    const ly = to.y - from.y;
    let found = false;
    // Only cells near the segment can be within a ball of it; the margin covers the stretch the
    // test below allows behind its start, which is outside the walls.
    const minX = Math.min(from.x, to.x) - MARGIN;
    const maxX = Math.max(from.x, to.x) + MARGIN;
    const minY = Math.min(from.y, to.y) - MARGIN;
    const maxY = Math.max(from.y, to.y) + MARGIN;
    let cy = 15;
    for (let y = 0; y < H; y++, cy += STEP_Y) {
      if (cy < minY || cy > maxY) continue;
      let cx = 15 + (this.largeRow(y) ? 0 : HALF);
      for (let x = 0; x < this.width(y); x++, cx += STEP_X) {
        if (cx < minX || cx > maxX) continue;
        // The nearest point on the line to the cell's centre, as whole pixels.
        const t = length2 ? ((cx - from.x) * lx + (cy - from.y) * ly) / length2 : 0;
        const px = Math.round(from.x + t * lx);
        const py = Math.round(from.y + t * ly);
        const d2 = (cx - px) ** 2 + (cy - py) ** 2;
        const s2 = (px - from.x) ** 2 + (py - from.y) ** 2;
        if (!((s2 < length2 + r2 || to.y === TOP) && d2 < r2)) continue;
        const back = Math.sqrt(r2 - d2);
        const s = Math.sqrt(s2);
        const f = s > 0 ? (s - back) / s : 0;
        const contact = { x: Math.trunc(from.x + (px * f - from.x * f)), y: Math.trunc(from.y + (py * f - from.y * f)) };
        const cell = { x, y };
        if (hits.some((h) => same(h.cell, cell))) continue;
        if (this.get(cell) !== EMPTY) found = true;
        const hit = { at: s + along - back, cell, contact };
        let i = hits.length;
        while (i > 0 && hits[i - 1].at > hit.at) i--;
        hits.splice(i, 0, hit);
      }
    }
    return found;
  }

  private restingHit(index: number, hits: Hit[]): Hit | null {
    const target = hits[index];
    let best: Hit | null = null;
    let bestDistance = PIXEL_W;
    for (let i = index - 1; i >= 0; i--) {
      const h = hits[i];
      if (!this.adjacent(target.cell, h.cell)) continue;
      // Measured to a centre 2px off for the short rows, as the game does.
      const cx = h.cell.x * STEP_X + (this.largeRow(h.cell.y) ? 15 : 26);
      const cy = h.cell.y * STEP_Y + 15;
      const d = Math.hypot(target.contact.x - cx, target.contact.y - cy);
      if (d < bestDistance) {
        bestDistance = d;
        best = h;
      }
    }
    return best;
  }

  private restingTop(end: Point, hits: Hit[]): Hit | null {
    let best: Hit | null = null;
    let bestDistance = PIXEL_W;
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      const d = Math.abs(h.cell.x * STEP_X + (this.largeRow(0) ? 13 : 26) - end.x);
      if (h.cell.y === 0 && d < bestDistance) {
        bestDistance = d;
        best = h;
      }
    }
    return best;
  }

  // ---- Strikes landing ----

  /**
   * A punch: a parallelogram of the attacker's pattern slides in along the top from one
   * wall, down the hex diagonal, bouncing off the far wall. It pushes your balls ahead of it; a
   * column without enough empty cells loses its topmost balls to make room. Nothing is pushed into
   * the bottom row.
   */
  punch(shaft: Shaft, glove: Glove): PunchResult {
    const result: PunchResult = { columns: [], bounces: [] };
    if (shaft.height <= 0 || shaft.width <= 0) return result;
    const bottom = H - 1;
    const length = Math.min(shaft.height, bottom - this.damage);
    const width = Math.min(shaft.width, W - 1);
    const start = { x: shaft.side === 1 ? 0 : this.width(this.damage) - width, y: this.damage };
    const patternStart = shaft.side === 1 ? 0 : W - 1 - width;
    const missing: number[] = [];
    for (let c = 0; c < width; c++) {
      missing[c] = length;
      const p = { x: start.x + c, y: start.y };
      for (let dir = shaft.side; missing[c] > 0 && p.y < bottom; dir = this.step(p, dir, width, c)) {
        if (this.get(p) === EMPTY) missing[c]--;
      }
    }
    if (length === 0) return result;
    const blacks = new Array<number>(length * width).fill(0);
    const bruised = Math.min(shaft.blacks, Math.trunc((length * width) / 2));
    for (let i = 0; i < bruised; i++) blacks[i] = 1;
    shuffle(blacks, this.alt);
    let b = 0;
    const bounces = [0];
    for (let c = 0; c < width; c++) {
      const column: PunchColumn = { cells: [], moves: [], destroyed: [] };
      result.columns.push(column);
      const p = { x: start.x + c, y: start.y };
      const pieces: number[] = [];
      /** Where each queued ball starts, and its delay before moving down the path. */
      const source: number[] = [];
      const waits: number[] = [];
      const sparkAt = new Map<number, Point | null>();
      for (let r = 0; r < length; r++) {
        pieces[r] = glove.piece(patternStart + c, length - r - 1, true);
        if (blacks[b++]) pieces[r] = dark(pieces[r]);
        source[r] = -1;
        waits[r] = length - r - 1;
        if (isCharged(pieces[r])) sparkAt.set(r, null);
      }
      let read = 0;
      let write = 0;
      let dir = shaft.side;
      let step = 0;
      let empty = 0;
      while (pieces[read] !== -1 && p.y < bottom) {
        const existing = this.get(p);
        const cell = { ...p };
        column.cells.push(cell);
        this.set(p, pieces[read]);
        if (pieces[read] !== EMPTY) column.moves.push({ piece: pieces[read], from: source[read], to: step, wait: waits[read] });
        if (isCharged(pieces[read])) this.updateSpark(sparkAt.get(read) ?? null, p);
        read = (read + 1) % length;
        if (existing === EMPTY) {
          pieces[write] = -1;
          empty++;
        } else if (missing[c] === 0) {
          pieces[write] = existing;
          source[write] = step;
          waits[write] = empty;
          if (isCharged(existing)) sparkAt.set(write, { ...p });
          write = (write + 1) % length;
        } else {
          if (isCharged(existing)) this.updateSpark(p, null);
          pieces[write] = -1;
          missing[c]--;
          column.destroyed.push({ piece: existing, at: column.cells.length - 1, step: ++empty });
        }
        const before = dir;
        dir = this.step(p, dir, width, c);
        if (c === 0 && dir !== before) bounces.push(p.y - 1);
        step++;
      }
    }
    result.bounces = bounces;
    return result;
  }

  /** One step down a punch's diagonal, bouncing off a wall. */
  private step(p: Point, dir: number, width: number, c: number): number {
    p.y++;
    if (dir === 0) {
      if (!this.largeRow(p.y)) p.x--;
      if (p.x - c < 0) {
        p.x++;
        return 1;
      }
    } else {
      if (this.largeRow(p.y)) p.x++;
      if (p.x + width - c > this.width(p.y)) {
        p.x--;
        return 0;
      }
    }
    return dir;
  }

  /**
   * Sprinkle: balls rise from the bottom in nine columns and stack under what's there. One
   * per column from 9, plus one in `count mod 9` random columns, so 18 or more lands as just 9.
   */
  sprinkle(shaft: Shaft, glove: Glove): SprinkleBall[] {
    const landed: SprinkleBall[] = [];
    let count = shaft.height > 0 ? 0 : shaft.count;
    const fromLeft = shaft.side > 0;
    const columns = W - 1;
    if (count > columns * 2) count = columns * 2;
    if (count <= 0) return landed;
    const extra = new Array<number>(columns).fill(0);
    for (let i = 0; i < count % columns; i++) extra[i] = 1;
    shuffle(extra, this.alt);
    const bottom = H - 1;
    const x0 = fromLeft ? 0 : this.width(bottom) + 1 - W;
    const placed = new Set<number>();
    for (let i = 0; i < columns; i++) {
      const n = extra[i] + (count >= columns ? 1 : 0);
      const p = { x: x0 + i, y: bottom };
      rise: while (n > 0) {
        for (let d = 0; d < 2; d++) {
          const q = this.neighbour(p, d);
          if (this.valid(q) && this.get(q) !== EMPTY && !placed.has(key(q))) break rise;
        }
        if (p.y === this.damage) break;
        p.y--;
        if (!fromLeft) p.x += this.largeRow(p.y) ? 1 : -1;
      }
      for (let j = 0; j < n && p.y < bottom; j++) {
        const piece = glove.piece(i, j, false);
        this.set(p, piece);
        placed.add(key(p));
        landed.push({ piece, cell: { ...p }, depth: j });
        p.y++;
        if (!fromLeft) p.x += this.largeRow(p.y) ? 1 : -1;
      }
    }
    return landed;
  }

  /** A punch resets the shot count, putting off the next drop. */
  punched(): void {
    this.shots = 0;
  }
}

/** How far from a segment's box a cell's centre can be and still be touched. */
const MARGIN = 60;

interface Hit {
  /** How far along the shot's path it touches this cell. */
  at: number;
  cell: Point;
  /** Where the ball is when it touches. */
  contact: Point;
}

