import { BoardRandom } from '../forage/board';
import {
  CANNON_COUNTS, DOWN, FIRING, GunneryBoard, LEFT, LOADED, LOOP, POWDER, SHOT, UP, WAD, WASHING, WIDTH, type Cannon, type Piece,
} from './board';

/**
 * When loaded cannons fire. On a ship the game fires them when the ship shoots, so 'volley' and 'loaded' stand in
 * for that; 'viking' is the viking expedition's own rule: every cannon fires each time all of them have been loaded.
 */
export type Firing = 'volley' | 'loaded' | 'viking';

export interface GunningSettings {
  cannons: number;
  firing: Firing;
  /** Time between the ship's broadsides in 'volley' firing. */
  volleyMs: number;
  /** Cannonballs aboard; 0 for no limit. */
  balls: number;
  /** Holes in the deck at the start. */
  holes: number;
  /** The ship turns now and then, sliding the barrel along its row. */
  shipMoves: boolean;
  timerMs: number;
  /** The speed slider: the slowest a tick may take, in ms (100 fastest to 500). */
  speed: number;
  /** Freeplay paints the deck; Loop drill has independent mirrored circuits. */
  mode: 'normal' | 'create' | 'loop';
}

export const DEFAULT_SETTINGS: GunningSettings = {
  cannons: 4, firing: 'volley', volleyMs: 10000, balls: 0, holes: 0, shipMoves: false, timerMs: 0, speed: 500, mode: 'normal',
};
export const FIRINGS: readonly Firing[] = ['volley', 'loaded', 'viking'];
export const VOLLEYS = [5000, 10000, 20000, 30000];
export const BALLS = [0, 10, 25, 50];
export const HOLES = [0, 1, 2, 4];
export const TIMERS = [0, 120000, 300000, 600000];

export function readSettings(value: unknown): GunningSettings | null {
  if (!value || typeof value !== 'object') return null;
  const s = { ...DEFAULT_SETTINGS, ...(value as Partial<GunningSettings>) };
  return (s.mode === 'normal' || s.mode === 'loop' || s.mode === 'create') && CANNON_COUNTS.includes(s.cannons) && FIRINGS.includes(s.firing) && VOLLEYS.includes(s.volleyMs) && BALLS.includes(s.balls) &&
    HOLES.includes(s.holes) && typeof s.shipMoves === 'boolean' && TIMERS.includes(s.timerMs) &&
    Number.isInteger(s.speed) && s.speed >= MIN_TICK && s.speed <= MAX_TICK ? s : null;
}
/** The speed slider is a preference, so it stays out of the key that groups history. */
export const settingsKey = (s: GunningSettings) =>
  s.mode === 'loop' ? `loop-v4-${s.timerMs}` : `c${s.cannons}-${s.firing}${s.firing === 'volley' ? s.volleyMs : ''}-b${s.balls}-h${s.holes}-${s.shipMoves ? 'm' : 's'}-${s.timerMs}`;

export const MIN_TICK = 100, START_TICK = 250, MAX_TICK = 500;
/** Each correct piece or loaded cannon takes 2 ms off a tick; each mistake adds 2 ms. */
export const TICK_STEP = 2;
/** The wash animation: five frames at five a second. */
export const WASH_MS = 1000;
/** The muzzle blast, then the smoke fading over two seconds; the cannon is fouled once the smoke clears. */
export const BLAST_MS = 333, SMOKE_MS = 2000, FIRE_MS = BLAST_MS + SMOKE_MS;
/** Later cannons in a broadside follow the first 200 ms apart. */
export const FIRE_STAGGER_MS = 200;
/** 'loaded' firing: how long a loaded cannon waits before firing. */
export const LOADED_FIRE_MS = 1000;

const SOUND_FOR: Record<number, string> = { [SHOT]: 'shot_in_correct', [POWDER]: 'powder_in_correct', [WAD]: 'wad_in_correct' };

export interface GunningStats {
  loaded: number;
  fired: number;
  correct: number;
  wrong: number;
  /** Down a hole or off the deck through a gunport. */
  overboard: number;
  /** Turned every way and couldn't move, so deleted. */
  stuck: number;
  washes: number;
  /** Swabs sent into a clean, empty cannon. */
  wastedSwabs: number;
  arrows: number;
}

type TimerKind = 'washed' | 'fire' | 'fired' | 'volley' | 'ship';
interface Timer { at: number; kind: TimerKind; cannon: number; order: number }
export interface CannonAnim { cannon: number; kind: 'wash' | 'fire'; start: number }

export class GunningGame {
  readonly board: GunneryBoard;
  /** Game time in ms. */
  now = 0;
  /** When the last tick happened and how long until the next. */
  tickAt = 0;
  interval: number;
  /** The tick time the deck has earned: faster with each correct piece, slower with each mistake. */
  base = START_TICK;
  speed: number;
  cursor = { x: 6, y: 4 };
  nextArrow = DOWN;
  stats: GunningStats = { loaded: 0, fired: 0, correct: 0, wrong: 0, overboard: 0, stuck: 0, washes: 0, wastedSwabs: 0, arrows: 0 };
  /** Sounds to play, drained by the page. */
  sounds: string[] = [];
  anims: CannonAnim[] = [];
  /** When time ran out: the deck stopped, though washes and firing may still be finishing. */
  stoppedAt?: number;
  private timers: Timer[] = [];
  private order = 0;
  private vikingLoads = 0;
  private readonly shipRng: BoardRandom;

  constructor(readonly settings: GunningSettings, readonly seed: number) {
    const loop = settings.mode === 'loop';
    this.board = new GunneryBoard(loop ? 4 : settings.cannons, seed, loop ? Number.MAX_SAFE_INTEGER : settings.balls || Number.MAX_SAFE_INTEGER, 3, loop);
    if (!loop) for (let i = 0; i < settings.holes; i++) this.board.addHole();
    if (loop) { this.cursor = { x: LOOP.front, y: LOOP.rows[0] }; this.nextArrow = LEFT; }
    this.speed = settings.speed;
    this.interval = this.tickTime;
    this.shipRng = new BoardRandom((seed ^ 0x5bd1e995) >>> 0);
    this.board.listener = {
      pieceLoaded: (_cannon, correct, type) => {
        if (correct) { this.stats.correct++; this.sounds.push(SOUND_FOR[type]); this.faster(true); }
        else { this.stats.wrong++; this.sounds.push('piece_in_incorrect'); this.faster(false); }
      },
      cannonChanged: cannon => this.cannonChanged(cannon),
      pieceLost: (_piece, overboard) => {
        if (overboard) { this.stats.overboard++; this.sounds.push('piece_overboard'); } else this.stats.wastedSwabs++;
        this.faster(false);
      },
      pieceRemoved: (_piece, stuck) => { if (stuck) this.stats.stuck++; },
    };
    // Viking guns start fired, so each needs a wash first.
    if (!loop && settings.firing === 'viking') for (const c of this.board.cannons) c.foul();
    if (!loop && settings.firing === 'volley') this.schedule(settings.volleyMs, 'volley', -1);
    if (!loop && settings.shipMoves) this.schedule(this.shipPause(), 'ship', 0);
  }

  /** The slider can make the deck faster than it has earned, never slower. */
  get tickTime(): number { return Math.max(MIN_TICK, Math.min(this.speed, this.base)); }
  /** How far the pieces are through their move to the next cell, 0 to 1. */
  get progress(): number { return Math.min(1, Math.max(0, (this.now - this.tickAt) / this.interval)); }
  /** Time the deck ran for, not counting washes and firing finishing after time ran out. */
  get activeTime(): number { return this.stoppedAt ?? this.now; }
  get loadsPerMinute(): number { return this.activeTime ? this.stats.loaded * 60000 / this.activeTime : 0; }

  private faster(yes: boolean): void {
    this.base = yes ? Math.max(MIN_TICK, this.base - TICK_STEP) : Math.min(MAX_TICK, this.base + TICK_STEP);
  }

  private schedule(delay: number, kind: TimerKind, cannon: number): void {
    this.timers.push({ at: this.now + delay, kind, cannon, order: this.order++ });
    this.timers.sort((a, b) => a.at - b.at || a.order - b.order);
  }

  private cannonChanged(cannon: Cannon): void {
    if (cannon.state === LOADED) {
      this.stats.loaded++; this.faster(true);
      if (this.board.loop) { cannon.fire(); return; }
      if (this.settings.firing === 'loaded') this.schedule(LOADED_FIRE_MS, 'fire', cannon.id);
      if (this.settings.firing === 'viking' && ++this.vikingLoads % this.board.numCannons === 0) {
        for (let i = 0; i < this.board.numCannons; i++) this.schedule((i + 1) * FIRE_STAGGER_MS, 'fire', i);
      }
    } else if (cannon.state === WASHING) {
      this.stats.washes++; this.sounds.push('wash_out_cannon');
      this.anims.push({ cannon: cannon.id, kind: 'wash', start: this.now });
      this.schedule(WASH_MS, 'washed', cannon.id);
    } else if (cannon.state === FIRING) {
      this.stats.fired++;
      this.anims.push({ cannon: cannon.id, kind: 'fire', start: this.now });
      this.schedule(FIRE_MS, 'fired', cannon.id);
    }
  }

  private shipPause(): number { return 3000 + this.shipRng.nextInt(5001); }

  private runTimer(t: Timer): void {
    const cannon = this.board.cannons[t.cannon];
    switch (t.kind) {
      case 'washed':
        cannon.finishWash();
        this.anims = this.anims.filter(a => !(a.cannon === t.cannon && a.kind === 'wash'));
        break;
      case 'fire': cannon.fire(); break;
      case 'fired':
        if (this.board.loop) cannon.reset(); else cannon.finishFiring();
        this.anims = this.anims.filter(a => !(a.cannon === t.cannon && a.kind === 'fire'));
        break;
      case 'volley': {
        // Like a ship's broadside: the first loaded cannon fires at once, the rest 200 ms apart.
        const loaded = this.board.cannons.filter(c => c.state === LOADED);
        loaded.forEach((c, i) => i ? this.schedule(i * FIRE_STAGGER_MS, 'fire', c.id) : c.fire());
        this.schedule(this.settings.volleyMs, 'volley', -1);
        break;
      }
      case 'ship':
        if (t.cannon === 0) {
          this.board.barrel.setMoving(this.shipRng.nextInt(2) === 1);
          this.schedule(1500 + this.shipRng.nextInt(3501), 'ship', 1);
        } else {
          this.board.barrel.stop();
          this.schedule(this.shipPause(), 'ship', 0);
        }
    }
  }

  private tick(): void {
    this.interval = Math.max(20, this.tickTime);
    this.tickAt = this.now;
    this.board.tick(this.now);
  }

  /** Runs the deck forward: ticks at the current speed, with washes and firing on their own clocks. */
  step(delta: number): void {
    const end = this.now + delta;
    for (;;) {
      const nextTick = this.tickAt + this.interval, timer = this.timers[0];
      const at = Math.min(nextTick, timer?.at ?? Infinity);
      if (at > end) break;
      this.now = at;
      if (timer && timer.at <= nextTick) { this.timers.shift(); this.runTimer(timer); } else this.tick();
    }
    this.now = end;
  }

  /** A wash or a firing is still animating. */
  get busy(): boolean { return this.anims.length > 0; }
  /** After time's up: lets washes and firing finish while the deck holds still. */
  playOut(delta: number): void {
    this.stoppedAt ??= this.now;
    const end = this.now + delta;
    for (;;) {
      const timer = this.timers.find(t => t.kind === 'washed' || t.kind === 'fired');
      if (!timer || timer.at > end) break;
      this.timers.splice(this.timers.indexOf(timer), 1);
      this.now = timer.at;
      this.runTimer(timer);
    }
    this.now = end;
  }

  setSpeed(speed: number): void { this.speed = Math.max(MIN_TICK, Math.min(MAX_TICK, Math.round(speed))); }

  moveCursor(dx: number, dy: number): void {
    this.pointAt(this.cursor.x + dx, this.cursor.y + dy);
  }
  pointAt(x: number, y: number): void {
    this.cursor = { x: Math.max(0, Math.min(WIDTH - 1, x)), y: Math.max(0, Math.min(this.board.height - 1, y)) };
  }
  selectArrow(arrow: number): void {
    if (arrow >= UP && arrow <= LEFT) this.nextArrow = arrow;
  }
  /** The mouse wheel turns the arrow a quarter a notch. */
  turnArrow(steps: number): void {
    this.nextArrow = UP + (((this.nextArrow - UP + steps) % 4) + 4) % 4;
  }

  /** Lays the selected arrow at (x, y); false where the deck has a crate, hole or cannon. */
  placeArrow(x = this.cursor.x, y = this.cursor.y, arrow = this.nextArrow): boolean {
    if (!this.board.canPlaceArrow(x, y)) return false;
    this.board.setArrow(x, y, arrow);
    this.stats.arrows++;
    this.sounds.push('place_arrow');
    return true;
  }

  /** Pieces drawn above the cannons: travelling inside one without loading it. */
  piecesInCannons(): Piece[] { return this.board.pieces.filter(p => p.inCannon); }
}
