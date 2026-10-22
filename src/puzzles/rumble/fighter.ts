// A Rumble board in play: you get control with a
// ball in each fist, fire one, it flies and lands, what pops goes a group every 100ms and what falls
// away drops off the bottom, the board counts the shot (dropping a row on the eighth), and then the
// strikes picked at the start of the turn land one after another: the punch, then its sprinkle.
// Timings are the game's; the animations are only recorded here for index.ts to draw.
import type { Random } from '../../core/random';
import {
  Board, type BoardOptions, BOTTOM, DIR_PREC, H, MAX_LINKED, MAX_LINKED_SPRINKLE, type Point, type PunchResult,
  type Sent, type Shaft, type SprinkleBall, STEP_Y, VIEW_H,
} from './board';
import type { Glove } from './gloves';
import { charged, colourOf, EMPTY, FURBALL, isCharged } from './pieces';

/** Ball flight, px per ms. */
export const FLIGHT_SPEED = 0.8;
/** One group pops every 100ms. */
export const POP_MS = 100;
/** The explosion's five frames at 24 frames a second. */
export const EXPLODE_MS = 5 * 1000 / 24;
/** A drop slides the board down a row over 250ms. */
export const DROP_MS = 250;
/** A punch moves along its diagonal at 0.6px/ms: one 26.4px step every 44ms. */
export const PUNCH_STEP_MS = Math.trunc(Math.hypot(STEP_Y, 13) / 0.6);
/** Sprinkle rises at 0.6px/ms... read as its time per pixel. */
export const SPRINKLE_MS_PER_PX = 0.6;
/** Holding a fire button this long charges the ball. */
export const CHARGE_MS = 1000;
/** Control is warned at 4s and fires itself at 5s. */
export const WARN_MS = 4000;
export const AUTO_FIRE_MS = 5000;
/** The board shakes one or two shots from a drop: nine frames, one every 66ms. */
export const SHAKE_FRAMES = 9;
export const SHAKE_FRAME_MS = 66;
/** Rotation keys turn 2.5 degrees a press, 0.5 with the fine key. */
export const ROTATE_STEP = 5;
export const FINE_STEP = 1;

export type SoundName =
  | 'ball_explode' | 'ball_fire' | 'ball_land' | 'ball_land_charged' | 'ball_soon_fire'
  | 'combo_explode_1' | 'combo_explode_2' | 'combo_explode_3' | 'combo_explode_4' | 'combo_explode_5' | 'combo_explode_6'
  | 'charge_ball_explode' | 'charging' | 'charged' | 'grape_fall' | 'kung_fu_3' | 'kung_fu_4' | 'kung_fu_5' | 'ricochet'
  | 'shaft_warning_small' | 'shaft_warning_medium' | 'shaft_warning_large' | 'shake_1' | 'shake_2';

const COMBO_SOUNDS: SoundName[] = ['combo_explode_3', 'combo_explode_4', 'combo_explode_5', 'combo_explode_6'];
const KUNG_FU: SoundName[] = ['kung_fu_3', 'kung_fu_4', 'kung_fu_5'];

export type Phase = 'control' | 'flight' | 'clear' | 'drop' | 'strike' | 'out';

export interface Flight {
  piece: number;
  points: Point[];
  start: number;
  end: number;
  rest: Point;
  /** When the ball reaches each point of the path after the first. */
  times: number[];
}

/** A popping ball, a falling one, a combo shout. */
export interface Pop { piece: number; cell: Point; at: number }
export interface Grape { piece: number; x: number; y: number; start: number; ms: number; distance: number }
export interface Shout { word: number; colour: number; x: number; y: number; start: number; ms: number }

export interface PunchAnim {
  result: PunchResult;
  side: number;
  start: number;
  /** Steps each column takes, the longest move in it. */
  steps: number[];
  end: number;
}

export interface SprinkleAnim {
  balls: SprinkleBall[];
  start: number;
  end: number;
}

export interface FighterStats {
  shots: number;
  popped: number;
  dropped: number;
  /** Squares sent in punches (width x length) and balls in sprinkle, after suppression. */
  punchSquares: number;
  sprinkleSent: number;
  punches: number;
  biggestPunch: number;
  bestChain: number;
  sparks: number;
  received: number;
  largestReceived: number;
  drops: number;
}

export interface FighterHooks {
  sound?(name: SoundName, at: number): void;
  /** A clear sent something (before suppression). */
  sent?(sent: Sent, at: number): void;
  /** Whole minutes of the fight so far, for the time bonus. */
  minutes?(at: number): number;
  /** The bludgeon of whoever sent a strike. */
  gloveOf(from: number): Glove;
  out?(at: number): void;
}

export interface FighterOptions extends BoardOptions {
  /** Rumless: each shot wobbles up to 2.5 degrees either way. */
  rumless?: boolean;
}

export class Fighter {
  readonly board: Board;
  phase: Phase = 'control';
  out = false;
  /** Set when the fight is over: what's moving finishes, but no more shots. */
  halted = false;
  controlAt: number;
  /** Each fist's aim, in half degrees. */
  readonly dir: number[];
  /** The ball each fist holds. */
  readonly hand: number[];
  lastFist = 0;
  charging = -1;
  chargeStart = 0;
  chargedHand = false;
  warned = false;
  flight: Flight | null = null;
  pops: Pop[] = [];
  grapes: Grape[] = [];
  shouts: Shout[] = [];
  punch: PunchAnim | null = null;
  sprinkle: SprinkleAnim | null = null;
  /** The board slides down a row from here after a drop. */
  dropAt = -Infinity;
  /** When the last shot was counted: the shake runs from here. */
  shotAt = 0;
  /** Strikes waiting to land, and those picked to land after this turn's shot. */
  readonly incoming: Shaft[] = [];
  picked: Shaft[] = [];
  /** Which warnings show: 2 left, 4 right, 8 bottom. */
  warnings = 0;
  warnAt = 0;
  /**
   * Freeplay mode's sandbox rules: an endless board isn't knocked out by its bottom row, without the
   * shot timer nothing warns or fires for you, and without drops the board never moves down.
   */
  readonly sandbox = { endless: false, shotTimer: true, drops: true };
  readonly stats: FighterStats = {
    shots: 0, popped: 0, dropped: 0, punchSquares: 0, sprinkleSent: 0, punches: 0, biggestPunch: 0,
    bestChain: 0, sparks: 0, received: 0, largestReceived: 0, drops: 0,
  };
  private busyUntil = 0;
  private sounds: Array<{ at: number; name: SoundName }> = [];
  private comboSound = 0;
  /** Shake sounds played since the last shot was counted. */
  private shakeSounds = 0;
  /** A held press can span turns. -2 waits for release after an automatic shot. */
  private heldFist = -1;
  private readonly wobble: Random | null;

  constructor(
    readonly index: number, rngs: { board: Random; alt: Random; fists: [Random, Random]; wobble: Random },
    private readonly hooks: FighterHooks, options: FighterOptions, started: number,
  ) {
    this.board = new Board(rngs.board, rngs.alt, rngs.fists, options);
    this.wobble = options.rumless ? rngs.wobble : null;
    this.dir = this.board.origins.map(() => 90 * DIR_PREC);
    this.hand = this.board.origins.map((_, f) => this.board.take(f));
    this.controlAt = started;
  }

  get rumless(): boolean {
    return !!this.wobble;
  }

  get fists(): number {
    return this.board.fists;
  }

  // ---- Aiming and firing ----

  /** Aims every fist at a point of the board view, each clamped to its range. */
  aimAt(x: number, y: number): void {
    this.board.origins.forEach((o, f) => {
      const [lo, hi] = this.board.ranges[f];
      if (y > o.y) this.dir[f] = x < o.x ? hi : lo;
      else this.dir[f] = clamp(Math.trunc(DIR_PREC * (Math.atan2(o.y - y, x - o.x) * 180 / Math.PI)), lo, hi);
    });
  }

  /** Turns every fist together (positive is anticlockwise). */
  rotate(delta: number): void {
    this.dir.forEach((d, f) => {
      const [lo, hi] = this.board.ranges[f];
      this.dir[f] = clamp(d + delta, lo, hi);
    });
  }

  /** Sets one fist's aim, as the AI does. */
  aim(fist: number, dir: number): void {
    const [lo, hi] = this.board.ranges[fist];
    this.dir[fist] = clamp(dir, lo, hi);
  }

  get canFire(): boolean {
    return this.phase === 'control' && !this.out && !this.halted;
  }

  /** A fire button pressed: start charging that fist's ball. */
  press(fist: number, now: number): void {
    if (this.out || this.halted || fist < 0 || fist >= this.fists || this.heldFist !== -1) return;
    this.heldFist = fist;
    if (this.canFire) this.startCharge(fist, now);
  }

  private startCharge(fist: number, now: number): void {
    this.charging = fist;
    this.chargeStart = now;
    this.chargedHand = false;
  }

  /** A fire button released: fire that fist, charged if it was held long enough. */
  release(fist: number, now: number): void {
    if (fist < 0 || fist >= this.fists) return;
    if (this.heldFist === -2) { this.heldFist = -1; return; }
    if (this.heldFist >= 0 && this.heldFist !== fist) return;
    this.heldFist = -1;
    if (!this.canFire) return;
    this.fire(fist, now);
  }

  private fire(fist: number, now: number): void {
    let piece = this.hand[fist];
    // Held a second or more: charged, even if the frame that would have shown it hasn't come.
    if (this.charging === fist && (this.chargedHand || now - this.chargeStart >= CHARGE_MS)) piece = charged(piece);
    let dir = this.dir[fist];
    if (this.wobble) {
      const [lo, hi] = this.board.ranges[fist];
      dir = clamp(dir + Math.round((this.wobble.random() * 2 - 1) * 2.5 * DIR_PREC), lo, hi);
    }
    const path = this.board.path(fist, dir);
    const shot = this.board.shoot(path);
    this.charging = -1;
    this.chargedHand = false;
    if (!shot) return;
    this.hand[fist] = EMPTY;
    this.lastFist = fist;
    this.warnings = 0;
    const times: number[] = [];
    let t = now;
    for (let i = 1; i < shot.flight.length; i++) {
      const a = shot.flight[i - 1];
      const b = shot.flight[i];
      t += Math.hypot(b.x - a.x, b.y - a.y) / FLIGHT_SPEED;
      times.push(t);
    }
    // Every turn in the path but the last is a wall.
    for (let i = 0; i < times.length - 1; i++) this.later(times[i], 'ricochet');
    this.flight = { piece, points: shot.flight, start: now, end: t, rest: shot.rest, times };
    this.stats.shots++;
    this.phase = 'flight';
    this.play('ball_fire', now);
  }

  // ---- Strikes ----

  /** A strike sent at this board: it waits until a turn picks it. */
  receive(shaft: Shaft, _at?: number): void {
    if (this.out) return;
    this.incoming.push(shaft);
  }

  /**
   * Picks what lands after this turn's shot: the first strike waiting, except
   * that pure sprinkle is held while the board is one or two shots from a drop; then the ones after
   * it are linked on, up to four, until their sprinkle adds up to 48.
   */
  private pick(now: number): void {
    if (this.picked.length) return;
    const hold = this.board.shots === 5 || this.board.shots === 6;
    let sprinkle = 0;
    for (let i = 0; i < this.incoming.length && this.picked.length < MAX_LINKED && sprinkle < MAX_LINKED_SPRINKLE; i++) {
      const s = this.incoming[i];
      if (hold && s.height <= 0) continue;
      this.picked.push(s);
      this.incoming.splice(i--, 1);
      sprinkle += s.count;
    }
    if (!this.picked.length) return;
    let length = 0;
    this.warnings = 0;
    for (const s of this.picked) {
      if (s.height > 0) {
        length += s.height;
        this.warnings |= s.side === 1 ? 2 : 4;
      } else if (s.count > 0) {
        this.warnings |= 8;
      }
    }
    this.warnAt = now;
    this.play(length > 10 ? 'shaft_warning_large' : length > 5 ? 'shaft_warning_medium' : 'shaft_warning_small', now);
  }

  // ---- The turn ----

  update(now: number): void {
    for (let guard = 0; guard < 50; guard++) {
      if (!this.step(now)) break;
    }
    this.shakeSound(now);
    this.flushSounds(now);
    this.pops = this.pops.filter((p) => now < p.at + EXPLODE_MS);
    this.grapes = this.grapes.filter((g) => now < g.start + g.ms);
    this.shouts = this.shouts.filter((s) => now < s.start + s.ms);
    if (this.punch && now >= this.punch.end) this.punch = null;
    if (this.sprinkle && now >= this.sprinkle.end) this.sprinkle = null;
  }

  /** Advances one transition if it's due; false when there's nothing more to do yet. */
  private step(now: number): boolean {
    switch (this.phase) {
      case 'control': {
        if (this.halted) return false;
        const controlNow = this.sandbox.shotTimer ? Math.min(now, this.controlAt + AUTO_FIRE_MS) : now;
        if (this.charging >= 0 && !this.chargedHand && controlNow - this.chargeStart >= CHARGE_MS) {
          this.chargedHand = true;
        }
        if (!this.sandbox.shotTimer) return false;
        if (!this.warned && now - this.controlAt >= WARN_MS) {
          this.warned = true;
        }
        if (now - this.controlAt >= AUTO_FIRE_MS) {
          const fist = this.charging >= 0 ? this.charging : this.lastFist;
          if (this.heldFist >= 0) this.heldFist = -2;
          this.fire(fist, this.controlAt + AUTO_FIRE_MS);
          return this.phase !== 'control';
        }
        return false;
      }
      case 'flight':
        if (now < this.flight!.end) return false;
        this.land(this.flight!.end);
        return true;
      case 'clear':
        if (now < this.busyUntil) return false;
        this.afterShot(this.busyUntil);
        return true;
      case 'drop':
        if (now < this.busyUntil) return false;
        this.nextStrike(this.busyUntil);
        return true;
      case 'strike':
        if (now < this.busyUntil) return false;
        this.nextStrike(this.busyUntil);
        return true;
      default:
        return false;
    }
  }

  private land(t: number): void {
    const f = this.flight!;
    this.flight = null;
    this.board.set(f.rest, f.piece);
    const sparksBefore = this.board.sparks.length;
    const clear = this.board.place(f.rest);
    if (!clear) {
      if (this.board.sparks.length > sparksBefore) this.stats.sparks++;
      this.play(isCharged(this.board.get(f.rest)) ? 'ball_land_charged' : 'ball_land', t);
      this.afterShot(t);
      return;
    }
    const groups = this.board.groupCount(clear);
    const sent = this.board.sent(groups, clear.popped.length, clear.grapes.length, this.hooks.minutes?.(t) ?? 0);
    this.stats.popped += clear.popped.length;
    this.stats.dropped += clear.grapes.length;
    this.stats.bestChain = Math.max(this.stats.bestChain, groups);
    if (sent.height > 0 || sent.count > 0) this.hooks.sent?.(sent, t);
    this.board.remove(clear);
    // One group every 100ms, each with its shout when there are several.
    const n = clear.groups.length;
    let word = 0;
    clear.groups.forEach((group, i) => {
      const at = t + i * POP_MS;
      let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
      let colour = 0;
      let sparks = 0;
      for (const cell of group) {
        const piece = clear.pieces.get(cell.y * 10 + cell.x) ?? EMPTY;
        this.pops.push({ piece, cell, at });
        const p = this.board.pixel(cell);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        colour = colourOf(piece);
        if (isCharged(piece)) sparks++;
      }
      if (n > 1) {
        // A furball group shouts once for each of its charged balls, up to five.
        const shouts = colour === FURBALL ? Math.max(1, Math.min(5, sparks)) : 1;
        for (let s = 0; s < shouts; s++) {
          this.shouts.push({ word: Math.min(word++, 34), colour, x: (x0 + x1 + 30) / 2, y: (y0 + y1 + 30) / 2 + s * 18, start: at, ms: i === n - 1 ? 1200 : 400 });
        }
      }
      const left = n - (i + 1);
      let sound: SoundName = 'ball_explode';
      if (n > 1 && left % 3 === 0) sound = left === 0 ? (i % 2 === 0 ? 'combo_explode_1' : 'combo_explode_2') : COMBO_SOUNDS[this.comboSound++ % COMBO_SOUNDS.length];
      else if (n > 1) sound = 'charge_ball_explode';
      this.later(at, sound);
    });
    // After the last group, what's left hanging falls off the bottom.
    const fallAt = t + (n - 1) * POP_MS;
    let end = fallAt + EXPLODE_MS;
    for (const cell of clear.grapes) {
      const p = this.board.pixel(cell);
      const distance = (H - cell.y + 2) * STEP_Y;
      const ms = 0.8 * distance;
      this.grapes.push({ piece: clear.pieces.get(cell.y * 10 + cell.x) ?? EMPTY, x: p.x, y: p.y, start: fallAt, ms, distance });
      end = Math.max(end, fallAt + ms);
    }
    if (clear.grapes.length) this.later(fallAt, 'grape_fall');
    this.busyUntil = end;
    this.phase = 'clear';
  }

  /** The shot is counted, dropping a row on the eighth. */
  private afterShot(t: number): void {
    const dropped = this.sandbox.drops && this.board.fired();
    if (dropped) {
      this.stats.drops++;
      this.dropAt = t;
      this.busyUntil = t + DROP_MS;
    } else {
      this.busyUntil = t;
    }
    this.shotAt = t;
    this.shakeSounds = 0;
    this.phase = 'drop';
  }

  /** Lands the next picked strike, or ends the turn. */
  private nextStrike(t: number): void {
    const s = this.picked.shift();
    if (!s) {
      this.endTurn(t);
      return;
    }
    const glove = this.hooks.gloveOf(s.from);
    let end = t;
    let landed = 0;
    if (s.height > 0 && s.width > 0) {
      this.board.punched();
      const result = this.board.punch(s, glove);
      const steps = result.columns.map((c) => c.moves.reduce((m, move) => Math.max(m, move.to - move.from), 0));
      const longest = Math.max(0, ...steps);
      end = t + longest * PUNCH_STEP_MS;
      this.punch = { result, side: s.side, start: t, steps, end };
      // A fist hits at each bounce, alternating sides, with a kung fu sound.
      result.bounces.forEach((row, i) => this.later(t + (row <= 1 ? 1 : PUNCH_STEP_MS * (row - 1)), KUNG_FU[i % 3]));
      landed += Math.min(s.width, 9) * Math.min(s.height, H - 1 - this.board.damage);
    }
    const balls = this.board.sprinkle(s, glove);
    if (balls.length) {
      const start = end;
      let last = start;
      for (const b of balls) {
        const dy = (H + 1 + b.depth - b.cell.y) * STEP_Y;
        last = Math.max(last, start + dy * SPRINKLE_MS_PER_PX);
      }
      this.sprinkle = { balls, start, end: last };
      end = last;
      landed += balls.length;
    }
    this.stats.received += landed;
    this.stats.largestReceived = Math.max(this.stats.largestReceived, landed);
    this.busyUntil = end;
    this.phase = 'strike';
  }

  private endTurn(t: number): void {
    if (this.board.isDead() && !this.sandbox.endless) {
      this.knockOut(t);
      return;
    }
    this.board.verifySparks();
    this.board.origins.forEach((_, f) => {
      if (this.hand[f] === EMPTY) this.hand[f] = this.board.take(f);
    });
    this.phase = 'control';
    this.controlAt = t;
    this.warned = false;
    this.charging = -1;
    this.pick(t);
    if (this.heldFist >= 0) this.startCharge(this.heldFist, t);
  }

  /**
   * Freeplay mode: a punch lands now, between shots, as it would after one. The shot timer starts
   * over once it has landed. Returns the punch, or null if a ball or strike is still moving.
   */
  strikeNow(s: Shaft, glove: Glove, now: number): PunchAnim | null {
    if (!this.canFire || this.punch || this.sprinkle || this.flight) return null;
    this.board.punched();
    const result = this.board.punch(s, glove);
    const steps = result.columns.map((c) => c.moves.reduce((m, move) => Math.max(m, move.to - move.from), 0));
    const end = now + Math.max(0, ...steps) * PUNCH_STEP_MS;
    this.punch = { result, side: s.side, start: now, steps, end };
    result.bounces.forEach((row, i) => this.later(now + (row <= 1 ? 1 : PUNCH_STEP_MS * (row - 1)), KUNG_FU[i % 3]));
    const landed = Math.min(s.width, 9) * Math.min(s.height, H - 1 - this.board.damage);
    this.stats.received += landed;
    this.stats.largestReceived = Math.max(this.stats.largestReceived, landed);
    this.controlAt = end;
    this.warned = false;
    if (this.board.isDead() && !this.sandbox.endless) this.knockOut(end);
    return this.punch;
  }

  /** Freeplay mode: the board was edited, so the turn's clock starts over. */
  edited(now: number): void {
    if (this.phase !== 'control') return;
    this.controlAt = Math.max(this.controlAt, now);
    this.warned = false;
  }

  knockOut(t: number): void {
    if (this.out) return;
    this.out = true;
    this.phase = 'out';
    this.flight = null;
    this.charging = -1;
    this.heldFist = -1;
    this.warnings = 0;
    this.incoming.length = 0;
    this.picked = [];
    this.hooks.out?.(t);
  }

  /** Nothing is moving: no flight, pops, falls or strikes. */
  idle(now: number): boolean {
    return !this.flight && !this.punch && !this.sprinkle && !this.grapes.length && !this.pops.length && now >= this.busyUntil;
  }

  /**
   * The shake's frame, from when the last shot was counted. Two shots from a drop the board shakes
   * through its nine frames then rests as long, with a rattle each time; one shot from it, the
   * shake and its rattle never stop.
   */
  shakeFrame(now: number): number {
    const level = this.board.shots;
    if (this.out || level < 6) return 0;
    const frame = Math.floor(Math.max(0, now - this.shotAt) / SHAKE_FRAME_MS) % (SHAKE_FRAMES * (level === 7 ? 1 : 2));
    return frame >= SHAKE_FRAMES ? 0 : frame;
  }

  private shakeSound(now: number): void {
    const level = this.board.shots;
    if (this.out || this.halted || level !== 6) return;
    // The final warning is a continuous loop; only the intermittent rattle is scheduled here.
    const period = SHAKE_FRAMES * SHAKE_FRAME_MS * 2;
    const offset = SHAKE_FRAME_MS;
    for (let at = this.shotAt + offset + this.shakeSounds * period; at <= now; at += period) {
      this.play('shake_1', at);
      this.shakeSounds++;
    }
  }

  /** How far through the drop slide, 0 to 1. */
  dropProgress(now: number): number {
    return Math.min(1, Math.max(0, (now - this.dropAt) / DROP_MS));
  }

  // ---- Sounds, in time order ----

  private play(name: SoundName, at: number): void {
    this.later(at, name);
  }

  private later(at: number, name: SoundName): void {
    this.sounds.push({ at, name });
  }

  private flushSounds(now: number): void {
    if (!this.sounds.length) return;
    const due = this.sounds.filter((s) => s.at <= now);
    if (!due.length) return;
    this.sounds = this.sounds.filter((s) => s.at > now);
    due.sort((a, b) => a.at - b.at);
    for (const s of due) this.hooks.sound?.(s.name, s.at);
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Where a fist's ball sits: 15px behind the shooter's origin along its aim. */
export function ballInFist(origin: Point, dir: number): Point {
  const a = (dir / DIR_PREC) * Math.PI / 180;
  return { x: origin.x - 15 * Math.cos(a), y: origin.y + 15 * Math.sin(a) };
}

export { BOTTOM, VIEW_H };
