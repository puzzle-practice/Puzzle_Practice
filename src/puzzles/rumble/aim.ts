// Rotating bruise scaffolds, with two queued targets. Every target is checked against Rumble's
// real shot solver, and graded by its easiest working route: how many wall bounces it takes,
// how wide its window of angles is, and how far its last bounce lands from the target.
import { Random } from '../../core/random';
import { type Board, DIR_PREC, H, STEP_X, W, type Point, type Shot } from './board';
import { FLIGHT_SPEED, type Fighter } from './fighter';
import { ball, dark, EMPTY, isBall } from './pieces';

export const AIM_MS = 120_000;
export const AIM_LIVES = 3;
/** Keep the landed ball and both targets visible before dealing the next shot. */
export const AIM_LANDING_MS = 250;
export const AIM_BOARD_SHOTS = 8;
export const AIM_REPLAY_VERSION = 5;
export const AIM_HISTORY = 'rumble:aim-trainer:v1';

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Very hard'] as const;
export type Difficulty = typeof DIFFICULTIES[number];
/** A round deals one difficulty, or Mixed deals each in turn at random. */
export type AimDifficulty = Difficulty | 'Mixed';
export const AIM_DIFFICULTIES: AimDifficulty[] = ['Mixed', ...DIFFICULTIES];

/** Windows are counted in aim steps: the fine aim's half degree. */
const DEGREES = DIR_PREC;
/** A direct window this wide is Easy; a narrower one, a precision shot, is Medium. */
const EASY_WINDOW = 2 * DEGREES;
/** A one-bounce window this wide, or a bounce this close to the target (in ball widths), is Medium. */
const MEDIUM_WINDOW = 3 * DEGREES;
const NEAR_BOUNCE = 2.5;
/** Two or more bounces, a window no wider than this, or a bounce this far from the target is Very hard. */
const TINY_WINDOW = 1 * DEGREES;
const FAR_BOUNCE = 7;

/** One unbroken window of angles that connects with the same number of wall bounces. */
export interface Route {
  bounces: number;
  /** The window's first and last aim, in half degrees. */
  lo: number;
  hi: number;
  /** Ball widths from the last wall bounce to the nearer target ball, along the middle aim; 0 when direct. */
  distance: number;
}

export function routeDifficulty(route: Route): Difficulty {
  const window = route.hi - route.lo + 1;
  if (!route.bounces) return window >= EASY_WINDOW ? 'Easy' : 'Medium';
  if (route.bounces > 1 || window <= TINY_WINDOW || route.distance >= FAR_BOUNCE) return 'Very hard';
  return window >= MEDIUM_WINDOW || route.distance <= NEAR_BOUNCE ? 'Medium' : 'Hard';
}

interface Candidate {
  cells: Point[];
  fist: number;
  /** The easiest route's grade: a player can take whichever route works. */
  difficulty: Difficulty;
  /** Easiest first. */
  routes: Route[];
  /** Half-degree angles that connect; kept for validating the generated challenges. */
  angles: number[];
}
export interface AimTarget extends Candidate { colour: number }
export type AimResult = 'Time up' | 'Out of lives' | 'Stopped';
interface Layout { cells: number[]; candidates: Candidate[] }

const key = (p: Point) => p.y * W + p.x;
const overlaps = (a: Candidate, b: Candidate) => a.cells.some(p => b.cells.some(q => key(p) === key(q)));
const sameTarget = (a: Candidate, b: Candidate) => a.fist === b.fist && a.difficulty === b.difficulty &&
  a.cells.every(p => b.cells.some(q => key(p) === key(q)));
const rank = (d: Difficulty) => DIFFICULTIES.indexOf(d);
/** Targets dealt recently that the next ones keep clear of. */
const RECENT = 4;
/** What a shot feels like: its hand, bounces, and which side of the board its target is on. */
const style = (c: Candidate) => `${c.fist}|${c.routes[0].bounces}|${c.cells[0].x < W / 2 ? 'left' : 'right'}`;
// Column heights. The later shapes add caves and overhangs, whose targets need long bank shots.
const BASE_PROFILES = [
  [7, 6, 5, 10, 13, 13, 10, 5, 6, 7],
  [10, 5, 5, 7, 12, 12, 7, 5, 5, 10],
  [5, 5, 9, 12, 7, 7, 12, 9, 5, 5],
  [12, 5, 2, 4, 11, 11, 4, 2, 5, 12],
  [4, 2, 3, 9, 9, 9, 9, 3, 2, 4],
  [13, 13, 7, 2, 2, 2, 2, 7, 13, 13],
  [2, 3, 8, 9, 4, 4, 9, 8, 3, 2],
  [8, 9, 5, 11, 12, 7, 10, 2, 4, 11],
  [11, 4, 2, 10, 7, 12, 11, 5, 9, 8],
  [3, 9, 6, 14, 14, 14, 14, 6, 9, 3],
  [6, 2, 2, 11, 11, 11, 11, 2, 2, 6],
  [2, 4, 13, 14, 6, 6, 14, 13, 4, 2],
  [6, 2, 2, 2, 6, 6, 2, 2, 2, 6],
  [5, 3, 9, 11, 11, 13, 2, 6, 3, 5],
  [10, 11, 2, 2, 6, 6, 2, 2, 11, 10],
  [15, 12, 3, 11, 8, 4, 4, 3, 6, 10],
  [5, 8, 6, 6, 5, 2, 12, 9, 13, 11],
  [8, 6, 7, 4, 3, 3, 4, 7, 6, 8],
  [11, 8, 3, 8, 7, 8, 13, 7, 10, 9],
  [12, 5, 10, 15, 12, 13, 8, 3, 2, 12],
  [7, 10, 12, 14, 6, 4, 4, 3, 5, 12],
];
/** Layouts in a fixed difficulty need at least this many of its targets. */
const MIN_TARGETS = 6;
// Side wings can grow or shrink independently. Related shapes share useful shot routes,
// allowing the board to change without invalidating the ball already in the preview.
const PROFILES = BASE_PROFILES.flatMap(base => [
  base,
  base.map((height, x) => x < 3 ? Math.max(height, 9) + 2 - x : height),
  base.map((height, x) => x > 6 ? Math.max(height, 9) + x - 7 : height),
]);

/** Fills each column down to its profile height with bruises, dropping anything left hanging. */
export function scaffold(b: Board, profile: number[]): void {
  b.cells.fill(EMPTY);
  for (let y = 0; y < H; y++) for (let x = 0; x < b.width(y); x++) {
    if (y < profile[x]) b.set({ x, y }, dark(ball(0)));
  }
  for (const p of b.grapesAfter(new Map())) b.set(p, EMPTY);
}

/** Every pair of touching scaffold balls either fist can connect with at two or more aims, graded. */
export function gradeTargets(b: Board): Candidate[] {
  const candidates: Candidate[] = [];
  for (let fist = 0; fist < b.fists; fist++) {
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
        const runs: Array<{ bounces: number; lo: number; hi: number; shots: Shot[] }> = [];
        for (const { dir, shot } of connected) {
          const bounces = shot.flight.length - 2, last = runs[runs.length - 1];
          if (last && last.bounces === bounces && last.hi === dir - 1) { last.hi = dir; last.shots.push(shot); }
          else runs.push({ bounces, lo: dir, hi: dir, shots: [shot] });
        }
        const routes = runs.map(({ bounces, lo, hi, shots: run }): Route => {
          const flight = run[run.length >> 1].flight, from = flight[flight.length - 2];
          const distance = bounces ? Math.min(...cells.map(c => {
            const at = b.pixel(c);
            return Math.hypot(at.x + 15 - from.x, at.y + 15 - from.y);
          })) / STEP_X : 0;
          return { bounces, lo, hi, distance: Math.round(distance * 10) / 10 };
        }).sort((r, s) => rank(routeDifficulty(r)) - rank(routeDifficulty(s)) || (s.hi - s.lo) - (r.hi - r.lo));
        candidates.push({ cells, fist, difficulty: routeDifficulty(routes[0]), routes, angles: connected.map(s => s.dir) });
      }
    }
  }
  return candidates;
}

/**
 * Whether a target on one board can carry over to another: the same grade, with every aim still
 * working along the same number of bounces, so the hints shown for it stay true.
 */
const carries = (c: Candidate, after: Layout) => after.candidates.some(next => sameTarget(c, next) &&
  c.routes.every(r => next.routes.some(n => n.bounces === r.bounces && n.lo <= r.lo && n.hi >= r.hi)));

const layoutCache = new Map<string, Layout[]>();
/**
 * The scaffolds with their graded targets, for a difficulty. They depend only on the board's shape,
 * so are worked out once. A fixed difficulty keeps the boards with plenty of its targets that can
 * change to another such board on one of them.
 */
function layoutsFor(b: Board, difficulty: AimDifficulty): Layout[] {
  const shape = JSON.stringify([b.topLarge, b.origins, b.ranges]);
  const id = `${shape}|${difficulty}`;
  const cached = layoutCache.get(id);
  if (cached) return cached;
  let layouts: Layout[];
  if (difficulty === 'Mixed') {
    layouts = PROFILES.map(profile => {
      scaffold(b, profile);
      const candidates = gradeTargets(b);
      if (candidates.length < 4) throw new Error('Aim trainer needs more reachable targets');
      return { cells: b.cells.slice(), candidates };
    });
  } else {
    layouts = layoutsFor(b, 'Mixed').filter(l => l.candidates.filter(c => c.difficulty === difficulty).length >= MIN_TARGETS);
    for (let before = -1; before !== layouts.length;) {
      before = layouts.length;
      const kept = layouts;
      layouts = kept.filter(l => kept.some(other => other !== l &&
        l.candidates.some(c => c.difficulty === difficulty && carries(c, other))));
    }
    if (!layouts.length) throw new Error(`Aim trainer has no ${difficulty} boards`);
  }
  layoutCache.set(id, layouts);
  return layouts;
}

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
  /** When the board came to rest after the end: a ball in the air when time ran out still flies on, uncounted. */
  settledAt?: number;
  feedback = 'Connect the ball to target 1.';
  feedbackAt: number;
  landing: { piece: number; cell: Point; hit: boolean; at: number; until: number } | null = null;
  private bounceIndex = 0;
  private flightHit = false;
  private readonly layouts: Layout[];
  private layoutIndex: number;
  private pendingLayout: number | null = null;
  /** The last few targets dealt, newest last, so the next ones go somewhere else. */
  private readonly recent: Candidate[] = [];
  /** Shots fired since the board last changed. */
  private boardShots = 0;

  constructor(readonly fighter: Fighter, seed: number, readonly startedAt: number, private readonly sound: (name: string) => void = () => {},
    readonly difficulty: AimDifficulty = 'Mixed') {
    this.rng = new Random(seed ^ 0x41696d);
    this.feedbackAt = startedAt;
    Object.assign(fighter.sandbox, { endless: true, drops: false, shotTimer: false });
    this.layouts = layoutsFor(fighter.board, difficulty);
    this.layoutIndex = this.rng.integer(0, this.layouts.length - 1);
    this.applyLayout();
    this.current = this.pick();
    this.next = this.pick(this.current);
    this.showTargets();
  }

  /** Replay fingerprints skip the layouts: they are fixed by the board's shape, and layoutIndex says which is up. */
  toJSON(): object {
    const { layouts: _layouts, ...state } = this;
    return state;
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
    this.boardShots++;
    this.bounceIndex = 0;
    this.sound('ball_fire');
    return true;
  }

  update(now: number): void {
    if (this.result) { this.flyOn(now); return; }
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
        this.boardShots = 0;
        this.boardNumber++;
        this.feedback = 'New board!';
        this.feedbackAt = f.controlAt;
      }
      this.next = this.queueNext(previous);
      this.showTargets();
    }
    if (now >= deadline) { this.finish('Time up', deadline, true); this.flyOn(now); }
  }

  /** `flyOn` keeps a ball that's still in the air on screen until it comes to rest; it doesn't count. */
  finish(result: AimResult, now: number, flyOn = false): void {
    if (this.result) return;
    this.result = result;
    this.endedAt = Math.min(now, this.startedAt + AIM_MS);
    if (!flyOn) this.fighter.flight = null;
    this.settledAt = this.fighter.flight?.end ?? this.endedAt;
    this.fighter.halted = true;
    this.fighter.charging = -1;
  }

  /** After the end: the ball in the air bounces on to where it rests, then goes. */
  private flyOn(now: number): void {
    const flight = this.fighter.flight;
    if (!flight) return;
    while (this.bounceIndex < flight.times.length - 1 && flight.times[this.bounceIndex] <= now) {
      this.sound('ricochet');
      this.bounceIndex++;
    }
    if (flight.end <= now) this.fighter.flight = null;
  }

  private connects(shot: Shot, target: Candidate): boolean {
    return target.cells.some(p => this.fighter.board.adjacent(shot.rest, p));
  }

  /** The grade to deal next: the round's, or in Mixed any grade at random. */
  private want(): Difficulty {
    return this.difficulty === 'Mixed' ? this.rng.choice([...DIFFICULTIES]) : this.difficulty;
  }

  private pick(avoid?: AimTarget, previous?: AimTarget, candidates = this.candidates, want = this.want()): AimTarget {
    // The wanted grade, or the nearest one this board has, away from target 1. Among those, prefer
    // targets clear of the last few dealt, then a different hand, bounce count or wall from the last.
    const pool = candidates.filter(c => !avoid || !overlaps(c, avoid));
    const off = (c: Candidate) => Math.abs(rank(c.difficulty) - rank(want));
    const nearest = Math.min(...pool.map(off));
    let choices = pool.filter(c => off(c) === nearest);
    const narrow = (keep: (c: Candidate) => boolean) => {
      const kept = choices.filter(keep);
      if (kept.length) choices = kept;
    };
    if (previous) narrow(c => !overlaps(c, previous));
    narrow(c => !this.recent.some(r => overlaps(c, r)));
    const last = this.recent[this.recent.length - 1];
    if (last) narrow(c => style(c) !== style(last));
    const chosen = this.rng.choice(choices);
    this.recent.push(chosen);
    if (this.recent.length > RECENT) this.recent.shift();
    const colours = [0, 1, 2, 3, 4].filter(c => c !== avoid?.colour);
    return { ...chosen, colour: this.rng.choice(colours) };
  }

  private applyLayout(): void {
    const layout = this.layouts[this.layoutIndex];
    this.fighter.board.cells.splice(0, this.fighter.board.cells.length, ...layout.cells);
    this.candidates.splice(0, this.candidates.length, ...layout.candidates);
  }

  private queueNext(previous: AimTarget): AimTarget {
    const want = this.want();
    if (this.boardShots + 1 >= AIM_BOARD_SHOTS) {
      // Plan the change one turn ahead. The preview target must work on both boards, at the same
      // grade, with every previously valid aim still valid, so preparing that shot is never wasted.
      // A fixed difficulty waits up to another board's worth of shots for a target of its grade.
      let fallback: { index: number; shared: Candidate[] } | null = null;
      let ready: { index: number; shared: Candidate[] } | null = null;
      for (const index of this.rng.shuffle(this.layouts.map((_, i) => i).filter(i => i !== this.layoutIndex))) {
        const after = this.layouts[index].candidates;
        const shared = this.candidates.filter(c => !overlaps(c, this.current) && carries(c, this.layouts[index]));
        if (!shared.length) continue;
        fallback ??= { index, shared };
        // The new board also needs a target of the grade to follow this one.
        const graded = shared.filter(c => c.difficulty === want && after.some(n => n.difficulty === want && !overlaps(n, c)));
        if (graded.length) { ready = { index, shared: graded }; break; }
      }
      const waiting = this.difficulty !== 'Mixed' && this.boardShots + 1 < 2 * AIM_BOARD_SHOTS;
      const change = ready ?? (waiting ? null : fallback);
      if (change) {
        this.pendingLayout = change.index;
        return this.pick(this.current, previous, change.shared, want);
      }
    }
    return this.pick(this.current, previous, this.candidates, want);
  }

  private showTargets(): void {
    const f = this.fighter;
    for (let i = 0; i < f.board.cells.length; i++) if (isBall(f.board.cells[i])) f.board.cells[i] = dark(ball(0));
    for (const target of [this.current, this.next]) for (const p of target.cells) f.board.set(p, ball(target.colour));
    f.hand.fill(dark(ball(0)));
    f.hand[this.current.fist] = ball(this.current.colour);
  }
}
