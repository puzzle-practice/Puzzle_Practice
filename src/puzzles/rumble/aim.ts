// Rotating bruise scaffolds, with two queued targets. Every target is checked against Rumble's
// real shot solver: it either needs a bounce or has a direct window no wider than four degrees.
import { Random } from '../../core/random';
import { H, W, type Point, type Shot } from './board';
import { FLIGHT_SPEED, type Fighter } from './fighter';
import { ball, dark, EMPTY, isBall } from './pieces';

export const AIM_MS = 120_000;
export const AIM_LIVES = 3;
/** Keep the landed ball and both targets visible before dealing the next shot. */
export const AIM_LANDING_MS = 250;
export const AIM_BOARD_SHOTS = 8;
export const AIM_REPLAY_VERSION = 4;
export const AIM_HISTORY = 'rumble:aim-trainer:v1';

interface Candidate {
  cells: Point[];
  fist: number;
  kind: 'Bounce' | 'Precision';
  /** Half-degree angles that connect; kept for validating the generated challenges. */
  angles: number[];
}
export interface AimTarget extends Candidate { colour: number }
export type AimResult = 'Time up' | 'Out of lives' | 'Stopped';
interface Layout { cells: number[]; candidates: Candidate[] }

const key = (p: Point) => p.y * W + p.x;
const overlaps = (a: Candidate, b: Candidate) => a.cells.some(p => b.cells.some(q => key(p) === key(q)));
const sameTarget = (a: Candidate, b: Candidate) => a.fist === b.fist && a.kind === b.kind &&
  a.cells.every(p => b.cells.some(q => key(p) === key(q)));
const BASE_PROFILES = [
  [7, 6, 5, 10, 13, 13, 10, 5, 6, 7],
  [10, 5, 5, 7, 12, 12, 7, 5, 5, 10],
  [5, 5, 9, 12, 7, 7, 12, 9, 5, 5],
];
// Side wings can grow or shrink independently. Related shapes share useful shot routes,
// allowing the board to change without invalidating the ball already in the preview.
const PROFILES = BASE_PROFILES.flatMap(base => [
  base,
  base.map((height, x) => x < 3 ? Math.max(height, 9) + 2 - x : height),
  base.map((height, x) => x > 6 ? Math.max(height, 9) + x - 7 : height),
]);

export class AimTrainer {
  readonly rng: Random;
  readonly candidates: Candidate[] = [];
  current: AimTarget;
  next: AimTarget;
  lives = AIM_LIVES;
  score = 0;
  shots = 0;
  boardNumber = 1;
  result: AimResult | null = null;
  endedAt: number | null = null;
  feedback = 'Connect the ball to target 1.';
  feedbackAt: number;
  landing: { piece: number; cell: Point; hit: boolean; at: number; until: number } | null = null;
  private bounceIndex = 0;
  private flightHit = false;
  private readonly layouts: Layout[] = [];
  private layoutIndex: number;
  private pendingLayout: number | null = null;

  constructor(readonly fighter: Fighter, seed: number, readonly startedAt: number, private readonly sound: (name: string) => void = () => {}) {
    this.rng = new Random(seed ^ 0x41696d);
    this.feedbackAt = startedAt;
    const b = fighter.board;
    Object.assign(fighter.sandbox, { endless: true, drops: false, shotTimer: false });
    for (const profile of PROFILES) {
      b.cells.fill(EMPTY);
      for (let y = 0; y < H; y++) for (let x = 0; x < b.width(y); x++) {
        if (y < profile[x]) b.set({ x, y }, dark(ball(0)));
      }
      for (const p of b.grapesAfter(new Map())) b.set(p, EMPTY);
      this.candidates.length = 0;
      this.findCandidates();
      if (this.candidates.length < 4) throw new Error('Aim trainer needs more reachable targets');
      this.layouts.push({ cells: b.cells.slice(), candidates: this.candidates.slice() });
    }
    this.layoutIndex = this.rng.integer(0, this.layouts.length - 1);
    this.applyLayout();
    this.current = this.pick();
    this.next = this.pick(this.current);
    this.showTargets();
  }

  remaining(now: number): number {
    return Math.max(0, AIM_MS - ((this.endedAt ?? now) - this.startedAt));
  }

  canFire(fist: number): boolean {
    return !this.result && this.fighter.canFire && fist === this.current.fist;
  }

  fire(fist: number, now: number): boolean {
    this.update(now);
    if (!this.canFire(fist)) return false;
    const f = this.fighter;
    const b = f.board;
    const shot = b.shoot(b.path(fist, f.dir[fist]));
    if (!shot) return false;
    this.flightHit = this.connects(shot, this.current);
    let at = now;
    const times = shot.flight.slice(1).map((p, i) => {
      at += Math.hypot(p.x - shot.flight[i].x, p.y - shot.flight[i].y) / FLIGHT_SPEED;
      return at;
    });
    f.flight = { piece: ball(this.current.colour), points: shot.flight, rest: shot.rest, start: now, end: at, times };
    f.phase = 'flight';
    f.hand[fist] = EMPTY;
    f.lastFist = fist;
    f.stats.shots++;
    this.shots++;
    this.bounceIndex = 0;
    this.sound('ball_fire');
    return true;
  }

  update(now: number): void {
    if (this.result) return;
    const deadline = this.startedAt + AIM_MS;
    const f = this.fighter;
    const flight = f.flight;
    if (flight) {
      while (this.bounceIndex < flight.times.length - 1 && flight.times[this.bounceIndex] <= Math.min(now, deadline)) {
        this.sound('ricochet');
        this.bounceIndex++;
      }
      if (flight.end <= Math.min(now, deadline)) {
        if (this.flightHit) this.score++;
        else this.lives--;
        this.feedback = this.flightHit ? 'Hit! +1' : 'Miss! −1 life';
        this.feedbackAt = flight.end;
        this.sound(this.flightHit ? 'ball_explode' : 'ball_land');
        this.landing = { piece: flight.piece, cell: flight.rest, hit: this.flightHit, at: flight.end, until: flight.end + AIM_LANDING_MS };
        f.flight = null;
        f.phase = 'clear';
        if (this.lives === 0) { this.finish('Out of lives', flight.end); return; }
      }
    }
    if (this.landing && now >= this.landing.until && this.landing.until < deadline) {
      f.controlAt = this.landing.until;
      this.landing = null;
      f.phase = 'control';
      // Keep the original target visible during the landing pause, then promote the preview.
      const previous = this.current;
      this.current = this.next;
      if (this.pendingLayout !== null) {
        this.layoutIndex = this.pendingLayout;
        this.pendingLayout = null;
        this.applyLayout();
        this.boardNumber++;
        this.feedback = 'New board!';
        this.feedbackAt = f.controlAt;
      }
      this.next = this.queueNext(previous);
      this.showTargets();
    }
    if (now >= deadline) this.finish('Time up', deadline);
  }

  finish(result: AimResult, now: number): void {
    if (this.result) return;
    this.result = result;
    this.endedAt = Math.min(now, this.startedAt + AIM_MS);
    this.fighter.flight = null;
    this.fighter.halted = true;
    this.fighter.charging = -1;
  }

  private connects(shot: Shot, target: Candidate): boolean {
    return target.cells.some(p => this.fighter.board.adjacent(shot.rest, p));
  }

  private findCandidates(): void {
    const b = this.fighter.board;
    for (let fist = 0; fist < 2; fist++) {
      const [lo, hi] = b.ranges[fist];
      const shots: Array<{ dir: number; shot: Shot }> = [];
      for (let dir = lo; dir <= hi; dir++) {
        const shot = b.shoot(b.path(fist, dir));
        if (shot) shots.push({ dir, shot });
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < b.width(y); x++) {
        const p = { x, y };
        if (!isBall(b.get(p))) continue;
        for (let d = 3; d < 6; d++) {
          const q = b.neighbour(p, d);
          if (!b.valid(q) || !isBall(b.get(q))) continue;
          const cells = [p, q];
          const connected = shots.filter(({ shot }) => cells.some(c => b.adjacent(shot.rest, c)));
          if (connected.length < 2) continue;
          const direct = connected.filter(({ shot }) => shot.flight.length === 2);
          let run = 0, widest = 0, last = -2;
          for (const { dir } of direct) { run = dir === last + 1 ? run + 1 : 1; widest = Math.max(widest, run); last = dir; }
          if (widest > 8) continue;
          this.candidates.push({ cells, fist, kind: direct.length ? 'Precision' : 'Bounce', angles: connected.map(s => s.dir) });
        }
      }
    }
  }

  private pick(avoid?: AimTarget, previous?: AimTarget, candidates = this.candidates): AimTarget {
    const available = candidates.filter(c => (!avoid || !overlaps(c, avoid)) && (!previous || !overlaps(c, previous)));
    const pool = available.length ? available : candidates.filter(c => !avoid || !overlaps(c, avoid));
    // Mix bank shots with precision shots, and let either hand take the next turn.
    const kind = this.rng.random() < 0.5 ? 'Bounce' : 'Precision';
    const preferred = pool.filter(c => c.kind === kind);
    const chosen = this.rng.choice(preferred.length ? preferred : pool);
    const colours = [0, 1, 2, 3, 4].filter(c => c !== avoid?.colour);
    return { ...chosen, colour: this.rng.choice(colours) };
  }

  private applyLayout(): void {
    const layout = this.layouts[this.layoutIndex];
    this.fighter.board.cells.splice(0, this.fighter.board.cells.length, ...layout.cells);
    this.candidates.splice(0, this.candidates.length, ...layout.candidates);
  }

  private queueNext(previous: AimTarget): AimTarget {
    if ((this.shots + 1) % AIM_BOARD_SHOTS === 0) {
      // Plan the change one turn ahead. The preview target must work on both boards, with
      // every previously valid aim still valid, so preparing that shot is never wasted.
      for (const index of this.rng.shuffle(this.layouts.map((_, i) => i).filter(i => i !== this.layoutIndex))) {
        const shared = this.candidates.filter(c => !overlaps(c, this.current) && this.layouts[index].candidates.some(next =>
          sameTarget(c, next) && c.angles.every(angle => next.angles.includes(angle))));
        if (!shared.length) continue;
        this.pendingLayout = index;
        return this.pick(this.current, previous, shared);
      }
    }
    return this.pick(this.current, previous);
  }

  private showTargets(): void {
    const f = this.fighter;
    for (let i = 0; i < f.board.cells.length; i++) if (isBall(f.board.cells[i])) f.board.cells[i] = dark(ball(0));
    for (const target of [this.current, this.next]) for (const p of target.cells) f.board.set(p, ball(target.colour));
    f.hand.fill(dark(ball(0)));
    f.hand[this.current.fist] = ball(this.current.colour);
  }
}
