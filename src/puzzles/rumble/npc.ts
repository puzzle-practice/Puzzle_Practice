// How NPCs rumble. An NPC plays a real board, like yours: each turn it tries every angle of both
// fists and scores where each ball would come to rest by what it would pop, drop and send. It
// charges balls into sparks to build a chain, sets the chain off once it's as long as its skill
// allows or sooner the lower its board gets, and its sparks break like yours when punches land.
// Skill sets how well it judges a shot, how well it aims, how long a chain it builds and how long
// it takes.
import type { Random } from '../../core/random';
import { type Board, DIR_PREC, H, type Point } from './board';
import { CHARGE_MS, type Fighter } from './fighter';
import { charged, colourOf, EMPTY, isBall, isCharged } from './pieces';

export interface NpcStyle {
  /** Time to take a shot at skill 50, before any slowdown. */
  shotMs: number;
  /** How far a shot's time varies, either way, in percent. */
  variation: number;
  /** How much slower it plays for each enemy targeting it, up to 4, in percent. */
  targetedSlowdown: number;
  /** Aim error at skill 0, in degrees; none at skill 100. */
  aimError: number;
  /** Whether NPCs charge balls into sparks for chains. */
  sparks: boolean;
  /** Chance a punch from a skill 100 NPC carries bruises, in percent; it scales down with skill. */
  bruiseChance: number;
  /** When it does, the share of the punch's squares bruised, in percent (at most half). */
  bruiseShare: number;
}

export const DEFAULT_STYLE: NpcStyle = {
  shotMs: 1600, variation: 30, targetedSlowdown: 15, aimError: 3, sparks: true, bruiseChance: 40, bruiseShare: 20,
};

interface Candidate {
  fist: number;
  dir: number;
  charge: boolean;
  value: number;
}

interface Plan extends Candidate {
  /** When to press, and when to let go. */
  pressAt: number;
  fireAt: number;
}

/**
 * Where a fist could put its ball: one entry per resting cell, aimed at the middle of the run of
 * angles that reach it so a small wobble still lands there.
 */
function reachable(board: Board, fist: number): Array<{ rest: Point; dir: number }> {
  const [lo, hi] = board.ranges[fist];
  const runs = new Map<number, number[]>();
  for (let dir = lo; dir <= hi; dir += DIR_PREC) {
    const shot = board.shoot(board.path(fist, dir));
    if (!shot) continue;
    const k = shot.rest.y * 10 + shot.rest.x;
    let list = runs.get(k);
    if (!list) runs.set(k, (list = []));
    list.push(dir);
  }
  return [...runs.entries()].map(([k, dirs]) => ({ rest: { x: k % 10, y: Math.floor(k / 10) }, dir: dirs[Math.floor(dirs.length / 2)] }));
}

/** 0 when the board is empty, 1 when its lowest ball is a row from knocking it out. */
export function danger(board: Board): number {
  const space = H - 2 - board.damage;
  return space <= 0 ? 1 : Math.max(0, Math.min(1, (board.lowest() - board.damage) / space));
}

/** Normal-ish noise from three uniforms, -1 to 1. */
const noise = (rng: Random) => (rng.random() + rng.random() + rng.random() - 1.5) / 1.5;

export class NpcBrain {
  private plan: Plan | null = null;
  private planned = -1;

  constructor(
    readonly fighter: Fighter, readonly skill: number, private readonly style: NpcStyle, private readonly rng: Random,
    private readonly attackers: () => number,
  ) {}

  /** The longest chain it builds before setting it off: none at skill 0 to five sparks at 100. */
  get chainTarget(): number {
    return this.style.sparks ? Math.round(this.skill / 20) : 0;
  }

  /** Plans each turn as it starts, then presses and lets go on time. */
  update(now: number): void {
    const f = this.fighter;
    if (!f.canFire) return;
    if (this.planned !== f.controlAt) {
      this.planned = f.controlAt;
      this.plan = this.choose(f.controlAt);
      f.aim(this.plan.fist, this.plan.dir);
    }
    const p = this.plan!;
    if (p.charge && f.charging < 0 && now >= p.pressAt) f.press(p.fist, p.pressAt);
    if (now >= p.fireAt) {
      f.aim(p.fist, p.dir);
      f.release(p.fist, p.fireAt);
    }
  }

  private choose(start: number): Plan {
    const f = this.fighter;
    const board = f.board;
    const s = this.skill / 100;
    const target = this.chainTarget;
    const urgency = Math.max(0, Math.min(1, (danger(board) - 0.35) / 0.5));
    const candidates: Candidate[] = [];
    for (let fist = 0; fist < f.fists; fist++) {
      const piece = f.hand[fist];
      if (piece === EMPTY) continue;
      for (const { rest, dir } of reachable(board, fist)) {
        candidates.push({ fist, dir, charge: false, value: this.score(board, rest, piece, target, urgency) });
        if (board.sparks.length < target) candidates.push({ fist, dir, charge: true, value: this.score(board, rest, charged(piece), target, urgency) });
      }
    }
    // Weaker pirates misjudge: each shot's worth is blurred more the lower the skill.
    const blur = (1 - s) * 8;
    let best: Candidate = { fist: f.lastFist, dir: f.dir[f.lastFist], charge: false, value: 0 };
    let bestValue = -Infinity;
    for (const c of candidates) {
      const v = c.value + noise(this.rng) * blur;
      if (v > bestValue) {
        bestValue = v;
        best = c;
      }
    }
    const dir = best.dir + Math.round(noise(this.rng) * this.style.aimError * DIR_PREC * (1 - s));
    const base = this.style.shotMs * (1.5 - s);
    const varied = base * (1 + (this.rng.random() * 2 - 1) * this.style.variation / 100);
    const slowed = varied * (1 + Math.min(4, this.attackers()) * this.style.targetedSlowdown / 100);
    // Never past the auto-fire, and a charge needs its second of holding.
    const fireAt = start + Math.min(4900, Math.max(best.charge ? CHARGE_MS + 100 : 150, slowed));
    return { ...best, dir, pressAt: best.charge ? fireAt - CHARGE_MS - 50 : fireAt, fireAt };
  }

  /** How good it is to put `piece` at `rest`, tried on a copy of the board. */
  private score(board: Board, rest: Point, piece: number, target: number, urgency: number): number {
    const copy = board.clone();
    copy.set(rest, piece);
    const sparksBefore = copy.sparks.length;
    const clear = copy.place(rest);
    let value: number;
    if (clear) {
      const groups = copy.groupCount(clear);
      const sent = copy.sent(groups, clear.popped.length, clear.grapes.length);
      value = clear.popped.length * 0.3 + clear.grapes.length * 0.6;
      const used = sparksBefore - copy.sparks.length;
      if (groups > 1) {
        value += 12 + sent.width * sent.height * 1.5;
        // A chain set off short of its length is worth less, unless the board is getting low.
        const short = Math.max(0, target - sparksBefore);
        value -= short * 6 * (1 - urgency);
      } else {
        value += 2 + sent.count * 0.5;
        // Popping a spark's group on its own wastes the spark.
        if (used > 0) value -= 6 * (1 - urgency);
      }
      copy.remove(clear);
    } else if (isCharged(piece) && copy.sparks.length > sparksBefore) {
      // A new spark, worth less the lower the board gets.
      value = 5 + 2 * copy.sparks.length - urgency * 8;
    } else {
      // Nothing pops: next to its own colour is a start.
      value = 0;
      for (let d = 0; d < 6; d++) {
        const n = copy.neighbour(rest, d);
        const p = copy.get(n);
        if (copy.valid(n) && isBall(p) && colourOf(p) === colourOf(piece)) value += 1.2;
      }
      if (isCharged(piece)) value -= 3;
    }
    // Low on the board is danger, and the bottom row is the end.
    const lowest = copy.lowest();
    if (lowest >= H - 1) return -1000;
    value -= Math.max(0, lowest - (H - 8)) * 3;
    return value;
  }
}
