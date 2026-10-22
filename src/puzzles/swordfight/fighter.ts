// One player's board in play: the falling pair, the board settling, clears and incoming attacks.
// Ported from the game's controllers: the drop puzzle loop and the falling pair's moves, turns
// and bounce, the falling sprites, and Swordfight's evolve order, chains, attacks landing and
// the speed-up.
// Times are in milliseconds and every change happens at a time worked out from the game's speeds,
// so the same inputs at the same times always play out the same way.
import { type Attack, addAttack, attackFor, attackSize, emptyAttack } from './attack';
import {
  Board, type Block, colour, EMPTY, fall, findClear, findJoins, H, isBreaker, isStrike, NORTH, SOUTH, W, WEST,
} from './board';
import { isHorizontal, type Shaft, type Strike, StrikePlacer, sprinkleColumns, sprinklePieces, type Sword } from './strikes';

/** Board squares are 27 x 40 pixels (SwordBoardView). Speeds are in pixels per millisecond. */
export const COL_PX = 27;
export const ROW_PX = 40;
/** Holding the drop key (s.b(true)). */
export const FAST_SPEED = 0.8;
/** Pieces settling and attacks coming in move at 1.5 times the fast drop. */
export const SETTLE_SPEED = 1.5 * FAST_SPEED;
/** The fastest the pair ever falls (s.z). */
export const MAX_SPEED = 0.25;
/** Starting speed for a puzzle difficulty (SwordObject.getStartingDropVelocity). */
export const startSpeed = (difficulty: number) => 0.01 * (difficulty + 1);
/** Cells shattering spread out one step every 75ms; each piece's explosion takes 500ms (s.w, SwordBoardView). */
const SHATTER_STEP_MS = 75;
const EXPLODE_MS = 500;
/** A block forming fades in at 0.004 per ms before it fuses (SwordBoardView.a(int, ...)). */
const JOIN_MS = 250;

export type SoundName =
  | 'block_join' | 'block_join_big' | 'block_join_huge' | 'block_explode' | 'block_explode_big' | 'block_explode_huge'
  | 'piece_land' | 'metal_piece_land' | 'piece_explode' | 'chain_double' | 'chain_triple' | 'chain_quadruple' | 'chain_plus'
  | 'hstrike_enter' | 'hstrike_enter_big' | 'hstrike_enter_huge' | 'vstrike_enter' | 'vstrike_enter_big' | 'vstrike_enter_huge'
  | 'strike_blocked' | 'strike_land' | 'strike_land_big' | 'strike_land_huge'
  | 'danger_sprinkle' | 'danger' | 'danger_big' | 'danger_huge';

export interface Pair {
  /** The first piece's column and row; the second sits in the direction of `orient`. */
  col: number;
  row: number;
  orient: number;
  pieces: [number, number];
  /** When it started falling into the next row. */
  start: number;
  speed: number;
  /** Bouncing on landing: still for an eighth of a row's fall before it settles. */
  bounceAt: number;
  /** Turns that may still lift it a row. */
  kicks: number;
  /** Freeplay mode: held where it is, this far into the next row, until the drop key is held. */
  held?: number;
}

/** The second piece's square. */
export function secondOf(p: { col: number; row: number; orient: number }): [number, number] {
  switch (p.orient) {
    case NORTH: return [p.col, p.row - 1];
    case SOUTH: return [p.col, p.row + 1];
    case WEST: return [p.col - 1, p.row];
    default: return [p.col + 1, p.row];
  }
}

/** A piece sliding to a new square while the board settles. */
export interface Mover {
  piece: number;
  x: number;
  from: number;
  to: number;
  start: number;
  end: number;
}

/** Pieces coming in: a column dropping (sprinkles, upright strikes) or a row sliding in from a side. */
export interface Sprite {
  pieces: number[];
  /** Column sprites: the column, and the bottom piece's row moving from `from` to `to`. Row sprites: the row, with the leading piece's column moving. */
  across: boolean;
  line: number;
  from: number;
  to: number;
  start: number;
  stepMs: number;
  /** For row sprites, which way the pieces run from the leading one (1 rightwards, -1 leftwards). */
  dir: number;
}

export interface Blast {
  x: number;
  y: number;
  piece: number;
  start: number;
}

export interface Join {
  block: Block;
  start: number;
}

export interface FighterStats {
  pairs: number;
  shattered: number;
  bestChain: number;
  sent: number;
  received: number;
  largestReceived: number;
  /** Longest run of dealt pieces without each colour breaker, including the current run. */
  breakerDroughts: number[];
  swordsSent: number;
  biggestSword: number;
  /** Pieces shattered by colour: red, green, blue, yellow. */
  shatteredBy: number[];
}

export interface FighterHooks {
  sound?(name: SoundName): void;
  message?(text: string): void;
  /** A finished cascade's attack. */
  attack?(attack: Attack): void;
  /** The pieces for the next pair, and a look at the one after. */
  nextPair(): [number, number];
  peekPair(): [number, number];
  /** The sword of whoever sent an attack. */
  swordOf(from: number): Sword | null;
}

const CHAIN_NAMES = ['', '', 'Double!', 'Triple!', 'Bingo!', 'Donkey!', 'Vegas!'];

export class Fighter {
  board = new Board();
  pair: Pair | null = null;
  next: [number, number] | null = null;
  /** The pair's normal speed, which creeps up as pairs are dealt. */
  speed: number;
  fast = false;
  out = false;
  /** The fight is over: what's moving finishes, but no new pair comes. */
  halted = false;
  /** Freeplay mode: the pair only falls while the drop key is held. */
  hover = false;
  /** Clears since the pair landed (s.B). */
  chain = 0;
  incoming: Shaft[] = [];
  /** The attack announced at this pair, landing after it (s.u, s.v). */
  current: Shaft | null = null;
  landing = false;
  /** Warnings of the strikes about to land (SwordBoardView._shadows). */
  shadows: Strike[] = [];
  movers: Mover[] = [];
  sprites: Sprite[] = [];
  blasts: Blast[] = [];
  joins: Join[] = [];
  /** Where an incoming sword hit something on landing, for the sparks. */
  impacts: Array<{ x: number; y: number; start: number; size: number }> = [];
  stats: FighterStats = { pairs: 0, shattered: 0, bestChain: 0, sent: 0, received: 0, largestReceived: 0, breakerDroughts: [0, 0, 0, 0], swordsSent: 0, biggestSword: 0, shatteredBy: [0, 0, 0, 0] };
  /** The attack built up by the current cascade, sent when the board settles. */
  private currentDroughts = [0, 0, 0, 0];
  private cascade: Attack = emptyAttack();
  private stable = false;
  private busyUntil = 0;
  private timers: Array<{ at: number; seq: number; run: () => void }> = [];
  private seq = 0;
  private bounceStart = 0;
  private bounceMs = 0;
  private bounceKey = '';
  private blocksSeen = 0;
  private lastSpeedUp = 0;
  private speedUpEvery = 10;
  private readonly placer = new StrikePlacer();
  private lastLandSound = -Infinity;
  private lastExplodeSound = -Infinity;
  private lastBlockSound = -Infinity;

  constructor(readonly index: number, difficulty: number, private readonly hooks: FighterHooks, started = 0) {
    this.speed = startSpeed(difficulty);
    this.busyUntil = started;
  }

  private sound(name: SoundName): void {
    this.hooks.sound?.(name);
  }

  private later(at: number, run: () => void): void {
    this.timers.push({ at, seq: this.seq++, run });
    this.busyUntil = Math.max(this.busyUntil, at);
  }

  private busy(now: number): boolean {
    return now < this.busyUntil || this.timers.length > 0;
  }

  /** How far into the next row the pair has fallen, 0 to 1 (i.e). */
  progress(now: number): number {
    const p = this.pair;
    if (!p) return 0;
    if (p.bounceAt) return 0;
    if (p.held !== undefined) return Math.min(1, p.held / ROW_PX);
    return Math.min(1, Math.max(0, now - p.start) * p.speed / ROW_PX);
  }

  /** Runs everything due by `now`. */
  update(now: number): void {
    if (this.out) return;
    this.runTimers(now);
    this.fallPair(now);
    if (this.pair && this.bounceStart && now - this.bounceStart >= this.bounceMs) this.endBounce(now);
    let guard = 0;
    while (!this.out && !this.stable && !this.busy(now) && guard++ < 64) {
      if (!this.evolve(now)) {
        this.stable = true;
        this.board.ageSpectrals();
        this.settled(now);
      }
    }
    this.movers = this.movers.filter((m) => now < m.end);
    this.sprites = this.sprites.filter((s) => now < s.start + Math.abs(s.to - s.from) * s.stepMs);
    this.blasts = this.blasts.filter((b) => now < b.start + EXPLODE_MS);
    this.joins = this.joins.filter((j) => now < j.start + JOIN_MS);
    this.impacts = this.impacts.filter((i) => now < i.start + 600);
  }

  private runTimers(now: number): void {
    for (;;) {
      let first = -1;
      for (let i = 0; i < this.timers.length; i++) {
        const t = this.timers[i];
        if (t.at > now) continue;
        if (first < 0 || t.at < this.timers[first].at || (t.at === this.timers[first].at && t.seq < this.timers[first].seq)) first = i;
      }
      if (first < 0) return;
      const [timer] = this.timers.splice(first, 1);
      timer.run();
    }
  }

  // ---- The falling pair ----

  private rows(p: Pair): [number, number] {
    return [p.row, secondOf(p)[1]];
  }

  private cols(p: Pair): [number, number] {
    return [p.col, secondOf(p)[0]];
  }

  private fallPair(now: number): void {
    const p = this.pair;
    if (!p || p.bounceAt || p.held !== undefined) return;
    const rowMs = ROW_PX / p.speed;
    while (this.pair === p && !p.bounceAt && now - p.start >= rowMs) {
      p.row++;
      p.start += rowMs;
      // Into a new row: if it can't fall any further it bounces (c.a(i, long, int, int)).
      if (!this.board.canDrop(this.rows(p), this.cols(p))) this.bounce(p.start, 'moved');
    }
  }

  /** Starting a bounce, or landing at once if it already bounced at these rows (c.c(String)). */
  private bounce(now: number, _why: string): void {
    const p = this.pair!;
    const key = this.rows(p).join(',');
    if (!this.bounceStart && this.bounceKey === key) {
      this.land(now);
      return;
    }
    if (this.bounceStart) return;
    delete p.held;
    p.speed = this.speed;
    this.bounceMs = (ROW_PX * 0.125) / this.speed;
    this.bounceStart = now;
    this.bounceKey = key;
    p.bounceAt = now;
    p.start = now;
  }

  private endBounce(now: number): void {
    const p = this.pair!;
    this.bounceStart = 0;
    if (!this.land(now)) {
      p.bounceAt = 0;
      if (this.hover && !this.fast) p.held = 0;
    }
  }

  /** Lands the pair if it can't fall; pieces above the board are lost (c.a(String, boolean, boolean)). */
  private land(now: number): boolean {
    const p = this.pair;
    if (!p) return true;
    if (this.board.canDrop(this.rows(p), this.cols(p))) return false;
    // s.E_: strikes on the board move on a stage, then the pair goes down.
    this.board.ageStrikes();
    this.sound('piece_land');
    const rows = this.rows(p);
    const cols = this.cols(p);
    for (let i = 0; i < 2; i++) {
      if (rows[i] >= 0 && this.board.inBounds(cols[i], rows[i]) && this.board.get(cols[i], rows[i]) === EMPTY) {
        this.board.set(cols[i], rows[i], p.pieces[i]);
      }
    }
    this.pair = null;
    this.bounceStart = 0;
    this.stats.pairs++;
    this.stable = false;
    this.busyUntil = Math.max(this.busyUntil, now);
    return true;
  }

  /** Left (-1) or right (1), if there's room (c.c(int)). */
  move(dx: number, now: number): void {
    const p = this.pair;
    if (!p || this.out) return;
    const [r0, r1] = this.rows(p);
    const [c0, c1] = this.cols(p);
    const progress = p.row >= H - 1 ? 0 : this.progress(now);
    const x = Math.min(c0, c1);
    const y = Math.max(r0, r1);
    const w = c0 === c1 ? 1 : 2;
    const h = r0 === r1 ? 1 : 2;
    if (!this.board.canMove(x, y, w, h, dx, progress)) return;
    p.col += dx;
    this.fiddled(now);
  }

  /** Turns the pair (c.d(int)). */
  rotate(clockwise: boolean, now: number): void {
    const p = this.pair;
    if (!p || this.out) return;
    const progress = p.row >= H - 1 ? 0 : this.progress(now);
    const turned = this.board.turnPair(p.row, p.col, p.orient, clockwise, progress, p.kicks > 0);
    if (!turned) return;
    [p.orient, p.col, p.row] = turned;
    if (turned[3]) p.kicks--;
    this.fiddled(now);
  }

  private fiddled(now: number): void {
    const p = this.pair!;
    if (!this.board.canDrop(this.rows(p), this.cols(p))) this.bounce(now, 'fiddled');
  }

  /** Holding or letting go of the drop key (c.d(boolean)). */
  setFast(on: boolean, now: number): void {
    this.fast = on;
    const p = this.pair;
    if (!p || this.bounceStart) return;
    if (this.hover) {
      if (!on && p.held === undefined) p.held = Math.min(ROW_PX, Math.max(0, now - p.start) * p.speed);
      if (on && p.held !== undefined) {
        p.start = now - p.held / FAST_SPEED;
        p.speed = FAST_SPEED;
        delete p.held;
      }
      return;
    }
    const speed = on ? FAST_SPEED : this.speed;
    if (speed === p.speed) return;
    // Keep the distance already fallen into the next row (i.a(float)).
    const fallen = Math.max(0, now - p.start) * p.speed;
    p.start = now - fallen / speed;
    p.speed = speed;
  }

  // ---- Settling (s.o) ----

  private evolve(now: number): boolean {
    if (this.current && this.landing) return this.applyShaft(now);
    return this.settle(now) || this.join(now) || this.clear(now) || this.applyShaft(now);
  }

  private settle(now: number): boolean {
    const falls = fall(this.board);
    if (!falls.length) return false;
    for (const f of falls) {
      const end = now + (ROW_PX * Math.abs(f.to - f.from)) / SETTLE_SPEED;
      this.movers.push({ piece: f.piece, x: f.x, from: f.from, to: f.to, start: now, end });
      this.later(end, () => this.landSound(end, f.x, f.to));
    }
    return true;
  }

  private landSound(now: number, x: number, y: number): void {
    // One landing sound per 300ms (SwordBoardView._dropThrottle).
    if (now - this.lastLandSound < 300) return;
    this.lastLandSound = now;
    this.sound(isStrike(this.board.get(x, y)) ? 'metal_piece_land' : 'piece_land');
  }

  private join(now: number): boolean {
    const blocks = findJoins(this.board);
    if (!blocks.length) return false;
    for (const block of blocks) {
      this.joins.push({ block, start: now });
      this.later(now + JOIN_MS, () => this.board.setBlock(block.colour, block.x, block.y, block.w, block.h));
      const area = block.w * block.h;
      this.sound(area <= 6 ? 'block_join' : area < 10 ? 'block_join_big' : 'block_join_huge');
    }
    return true;
  }

  private clear(now: number): boolean {
    const clear = findClear(this.board, this.chain);
    if (!clear.cells.length) return false;
    // Each step out starts 75ms after the one before, the first 75ms after the clear (s.w's sequence).
    let at = now;
    let depth = -1;
    let last = now;
    for (const cell of clear.cells) {
      if (depth !== cell.depth) at += SHATTER_STEP_MS;
      depth = cell.depth;
      const when = at;
      last = when;
      this.later(when, () => {
        if (this.board.get(cell.x, cell.y) === EMPTY) return;
        this.board.set(cell.x, cell.y, EMPTY);
        this.blasts.push({ x: cell.x, y: cell.y, piece: cell.piece, start: when });
        const block = clear.blocks.find((b) => cell.x >= b.x && cell.x < b.x + b.w && cell.y <= b.y && cell.y > b.y - b.h);
        if (block) {
          if (when - this.lastBlockSound >= 250) {
            this.lastBlockSound = when;
            const area = block.w * block.h;
            this.sound(area <= 6 ? 'block_explode' : area < 10 ? 'block_explode_big' : 'block_explode_huge');
          }
        } else if (when - this.lastExplodeSound >= 250) {
          this.lastExplodeSound = when;
          this.sound('piece_explode');
        }
      });
    }
    this.busyUntil = Math.max(this.busyUntil, last + EXPLODE_MS, now + 150);
    this.stats.shattered += clear.cells.length;
    for (const cell of clear.cells) if (colour(cell.piece) < 4) this.stats.shatteredBy[colour(cell.piece)]++;
    this.chain++;
    this.stats.bestChain = Math.max(this.stats.bestChain, this.chain);
    addAttack(this.cascade, attackFor(clear, this.chain));
    if (this.chain > 1) {
      this.hooks.message?.(CHAIN_NAMES[Math.min(this.chain, 6)]);
      this.sound(this.chain === 2 ? 'chain_double' : this.chain === 3 ? 'chain_triple' : this.chain === 4 ? 'chain_quadruple' : 'chain_plus');
    }
    return true;
  }

  // ---- Attacks landing (s.x, s.a(StrikeInfo, float), s.a(int[][], ...)) ----

  receive(shaft: Shaft): void {
    if (this.out) return;
    const size = shaft.sprinkles + shaft.strikes.reduce((sum, strike) => sum + strike.width * strike.height, 0);
    this.stats.largestReceived = Math.max(this.stats.largestReceived, size);
    this.incoming.push(shaft);
  }

  private applyShaft(now: number): boolean {
    const shaft = this.current;
    if (!shaft) return false;
    const sword = this.hooks.swordOf(shaft.from);
    if (!this.landing) {
      this.placer.replace(this.board, sword, shaft.strikes);
      this.shadows = [];
      this.landing = true;
    }
    if (shaft.strikes.length) {
      const strike = shaft.strikes.shift()!;
      this.stats.received += strike.width * strike.height;
      const size = sizeOf(strike);
      if (!isHorizontal(strike)) {
        if (strike.y >= 0) {
          this.dropStrike(strike, now);
          this.sound(size === 0 ? 'vstrike_enter' : size === 1 ? 'vstrike_enter_big' : 'vstrike_enter_huge');
        } else {
          this.blocked(strike, now);
        }
      } else {
        this.slideStrike(strike, now);
        this.sound(size === 0 ? 'hstrike_enter' : size === 1 ? 'hstrike_enter_big' : 'hstrike_enter_huge');
      }
    } else if (shaft.sprinkles > 0) {
      this.stats.received += shaft.sprinkles;
      const counts = sprinkleColumns(this.board.columnLevels(), shaft.sprinkles, shaft.id);
      const pieces = sprinklePieces(sword, counts);
      for (let x = 0; x < W; x++) {
        const column = pieces[x];
        if (!column) continue;
        const distance = this.board.dropDistance(x, -1);
        if (distance > 0) this.dropColumn(x, column, distance, now, false, null);
      }
      shaft.sprinkles = 0;
    }
    if (!shaft.strikes.length && shaft.sprinkles === 0) {
      this.current = null;
      this.landing = false;
    }
    return true;
  }

  private blocked(strike: Strike, now: number): void {
    this.impacts.push({ x: strike.x + strike.width / 2, y: Math.max(0, strike.y), start: now, size: strike.width * strike.height });
    this.sound('strike_blocked');
  }

  private dropStrike(strike: Strike, now: number): void {
    let first = true;
    for (let x = 0; x < W; x++) {
      const column = strike.pieces[x];
      if (!column) continue;
      this.dropColumn(x, column, strike.y + 1, now, true, () => {
        if (!first) return;
        first = false;
        this.strikeLanded(strike, now + ((strike.y + 1) * ROW_PX) / SETTLE_SPEED);
      });
    }
  }

  /** A column of pieces falling from above the board `distance` rows; a strike crushes what it passes. */
  private dropColumn(x: number, pieces: number[], distance: number, now: number, crush: boolean, onLand: (() => void) | null): void {
    const stepMs = ROW_PX / SETTLE_SPEED;
    this.sprites.push({ pieces, across: false, line: x, from: -1, to: -1 + distance, start: now, stepMs, dir: 0 });
    for (let k = 1; k <= distance; k++) {
      const row = -1 + k;
      const at = now + k * stepMs;
      this.later(at, () => {
        if (crush) this.crush(x, row, at);
        if (k === distance) {
          this.board.setColumn(x, row, pieces);
          onLand?.();
          this.landSound(at, x, row);
        }
      });
    }
  }

  private crush(x: number, y: number, now: number): void {
    const p = this.board.get(x, y);
    if (p === EMPTY || !this.board.inBounds(x, y)) return;
    this.board.set(x, y, EMPTY);
    this.blasts.push({ x, y, piece: p, start: now });
  }

  private slideStrike(strike: Strike, now: number): void {
    const right = strike.orient === 0;
    const distance = right ? Math.min(W - strike.x, W) : Math.min(strike.x + strike.width, W);
    if (distance <= 0) {
      this.blocked(strike, now);
      return;
    }
    if (strike.x >= W || strike.x + strike.width - 1 < 0) return;
    const stepMs = COL_PX / SETTLE_SPEED;
    const startCol = right ? W - distance : 0;
    const top = Math.max(strike.y - strike.height + 1, 0);
    let first = true;
    for (let row = strike.y; row >= top; row--) {
      const i = strike.y - row;
      const pieces: number[] = [];
      for (let c = 0; c < distance; c++) pieces.push(strike.pieces[c + startCol]?.[i] ?? EMPTY);
      // The leading piece runs from just off the board to the strike's near end.
      const from = right ? W : -1;
      const to = right ? W - distance : distance - 1;
      this.sprites.push({ pieces: right ? pieces : [...pieces].reverse(), across: true, line: row, from, to, start: now, stepMs, dir: right ? 1 : -1 });
      for (let k = 1; k <= distance; k++) {
        const col = right ? W - k : k - 1;
        const at = now + k * stepMs;
        this.later(at, () => {
          this.crush(col, row, at);
          if (k === distance) {
            const left = right ? to : 0;
            for (let c = 0; c < pieces.length; c++) this.board.set(left + c, row, pieces[c]);
            if (first) {
              first = false;
              this.strikeLanded(strike, at);
            }
          }
        });
      }
    }
  }

  private strikeLanded(strike: Strike, now: number): void {
    const size = sizeOf(strike);
    const hit = isHorizontal(strike)
      ? strike.orient === 0
        ? strike.x === 0 || !this.board.isAreaEmpty(strike.x - 1, strike.y, 1, strike.height)
        : strike.x === W - 1 || !this.board.isAreaEmpty(strike.x + strike.width, strike.y, 1, strike.height)
      : strike.y === H - 1 || !this.board.isAreaEmpty(strike.x, strike.y + 1, strike.width, 1);
    if (hit) this.impacts.push({ x: strike.x + strike.width / 2, y: strike.y, start: now, size: strike.width * strike.height });
    this.sound(size === 0 ? 'strike_land' : size === 1 ? 'strike_land_big' : 'strike_land_huge');
  }

  // ---- A settled board: send the cascade's attack, then the next pair (c.p, c.F, s.y_, s.z_) ----

  private settled(now: number): void {
    if (attackSize(this.cascade) > 0) {
      const attack = this.cascade;
      this.cascade = emptyAttack();
      this.stats.sent += attackSize(attack);
      this.stats.swordsSent += attack.swords.length;
      for (const [w, h] of attack.swords) this.stats.biggestSword = Math.max(this.stats.biggestSword, w * h);
      this.hooks.attack?.(attack);
    }
    this.spawn(now);
  }

  private spawn(now: number): void {
    if (this.pair || this.out || this.halted) return;
    // Knocked out when the top of the fourth column is filled as the next pair is due.
    if (this.board.get(3, 0) !== EMPTY) {
      this.out = true;
      return;
    }
    this.speedUp();
    this.announceShaft();
    this.chain = 0;
    const pieces = this.hooks.nextPair();
    for (const piece of pieces) for (let c = 0; c < 4; c++) {
      this.currentDroughts[c] = isBreaker(piece) && colour(piece) === c ? 0 : this.currentDroughts[c] + 1;
      this.stats.breakerDroughts[c] = Math.max(this.stats.breakerDroughts[c], this.currentDroughts[c]);
    }
    this.next = this.hooks.peekPair();
    this.blocksSeen++;
    this.deal(pieces, now);
  }

  private deal(pieces: [number, number], now: number): void {
    // Each pair starts at the normal speed, even with the drop key still held (s.v).
    this.fast = false;
    this.pair = {
      col: 3,
      row: this.board.isRowEmpty(1) ? 0 : -1,
      orient: NORTH,
      pieces,
      start: now,
      speed: this.speed,
      bounceAt: 0,
      kicks: 2,
      ...(this.hover ? { held: 0 } : {}),
    };
    this.bounceStart = 0;
    this.bounceKey = '';
    // A pair that starts with nothing below it can still be blocked straight away.
    if (!this.board.canDrop(this.rows(this.pair), this.cols(this.pair))) this.bounce(now, 'spawned');
  }

  /** Freeplay mode: the board was changed by hand. It settles again and deals on, even after a knock-out. */
  edited(now: number): void {
    this.out = false;
    this.stable = false;
    this.busyUntil = Math.max(this.busyUntil, now);
  }

  /** Freeplay mode: these pieces as a pair just dealt, at the top. */
  redeal(pieces: [number, number], now: number): void {
    this.out = false;
    this.chain = 0;
    this.deal(pieces, now);
  }

  /** Every 10 pairs, then every 13, 16 and so on, the pair falls a little faster (s.z). */
  private speedUp(): void {
    if (this.blocksSeen >= this.lastSpeedUp + this.speedUpEvery) {
      this.speed = Math.min(this.speed + 1 / 300, MAX_SPEED);
      this.speedUpEvery = Math.trunc(this.speedUpEvery + 10 / 3);
      this.lastSpeedUp = this.blocksSeen;
    }
  }

  /** The next attack is placed now so its warning shows while this pair falls (s.z_). */
  private announceShaft(): void {
    const shaft = this.incoming.shift();
    if (!shaft) {
      this.current = null;
      this.landing = false;
      return;
    }
    const sword = this.hooks.swordOf(shaft.from);
    shaft.strikes = this.placer.place(this.board, sword, shaft.strikes);
    this.current = shaft;
    this.landing = false;
    this.shadows = [...shaft.strikes];
    const strikes = shaft.strikes.length;
    const area = shaft.strikes.reduce((n, s) => n + s.width * s.height, 0);
    if (strikes === 0 && area === 0) {
      if (shaft.sprinkles >= 4) this.sound('danger_sprinkle');
    } else if (strikes < 2 && area < 10) this.sound('danger');
    else if (strikes < 3 && area < 20) this.sound('danger_big');
    else this.sound('danger_huge');
  }

  /** True while nothing on this board is still moving. */
  idle(now: number): boolean {
    return this.stable && !this.busy(now);
  }
}

/** 0 small, 1 big, 2 huge, for the sounds (s.b(StrikeInfo)). */
function sizeOf(s: Strike): number {
  const area = s.width * s.height;
  if (s.orient === 0) return area === 6 ? 0 : area < 10 ? 1 : 2;
  return area === 4 ? 0 : area < 10 ? 1 : 2;
}
