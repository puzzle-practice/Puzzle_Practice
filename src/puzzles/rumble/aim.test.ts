import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { AIM_BOARD_SHOTS, AIM_LANDING_MS, AIM_MS, AimTrainer, DIFFICULTIES, routeDifficulty, type AimDifficulty, type AimTarget } from './aim';
import type { Board, Point } from './board';
import { Fighter } from './fighter';
import { Glove } from './gloves';
import { colourOf, isDark } from './pieces';

function trainer(seed = 1, startedAt = 0, difficulty: AimDifficulty = 'Mixed') {
  const fighter = new Fighter(0, {
    board: new Random(seed), alt: new Random(seed + 1), wobble: new Random(seed + 2),
    fists: [new Random(seed + 3), new Random(seed + 4)],
  }, { gloveOf: () => new Glove(0) }, { startRows: 0 }, startedAt);
  return new AimTrainer(fighter, seed, startedAt, undefined, difficulty);
}

/** An aim that lands somewhere other than next to the target. */
function misses(b: Board, fist: number, dir: number, cells: Point[]): boolean {
  const shot = b.shoot(b.path(fist, dir));
  return !!shot && !cells.some(p => b.adjacent(shot.rest, p));
}

/** Every aim in each of a target's routes connects, with that route's number of wall bounces. */
function expectRoutes(b: Board, t: Pick<AimTarget, 'cells' | 'fist' | 'routes' | 'angles'>) {
  for (const route of t.routes) for (let dir = route.lo; dir <= route.hi; dir++) {
    const shot = b.shoot(b.path(t.fist, dir))!;
    expect(t.cells.some(p => b.adjacent(shot.rest, p))).toBe(true);
    expect(shot.flight.length - 2).toBe(route.bounces);
    expect(t.angles).toContain(dir);
  }
}

function shoot(t: AimTrainer, hit: boolean, now: number) {
  const f = t.fighter, fist = t.current.fist;
  const [lo, hi] = f.board.ranges[fist];
  const dir = hit ? t.current.angles[0] : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
    .find(d => misses(f.board, fist, d, t.current.cells))!;
  f.aim(fist, dir);
  expect(t.fire(fist, now)).toBe(true);
  const end = f.flight!.end;
  t.update(end);
  t.update(end + AIM_LANDING_MS);
  return end + AIM_LANDING_MS + 1;
}

describe('Rumble aim trainer', () => {
  it.each([true, false])('holds a landed ball and its targets for a quarter second (hit: %s)', hit => {
    expect(AIM_LANDING_MS).toBe(250);
    const t = trainer(), f = t.fighter;
    const current = t.current, next = t.next, fist = current.fist;
    const [lo, hi] = f.board.ranges[fist];
    f.aim(fist, hit ? current.angles[0] : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
      .find(d => misses(f.board, fist, d, current.cells))!);
    t.fire(fist, 0);
    const { end, rest, piece } = f.flight!;
    t.update(end);
    expect(t.landing).toMatchObject({ cell: rest, piece, hit, until: end + AIM_LANDING_MS });
    expect(t.score).toBe(hit ? 1 : 0);
    expect(t.lives).toBe(hit ? 3 : 2);
    t.update(end + AIM_LANDING_MS - 1);
    expect(t.current).toBe(current);
    expect(t.next).toBe(next);
    expect(t.fire(fist, end + AIM_LANDING_MS - 1)).toBe(false);
    expect(t.shots).toBe(1);
    t.update(end + AIM_LANDING_MS);
    expect(t.landing).toBeNull();
    expect(t.current).toBe(next);
    expect(f.canFire).toBe(true);
    expect(t.score).toBe(hit ? 1 : 0);
    expect(t.lives).toBe(hit ? 3 : 2);
  });
  it('grades a route by its bounces, window and how far the last bounce is from the target', () => {
    const route = (bounces: number, width: number, distance: number) => routeDifficulty({ bounces, lo: 100, hi: 99 + width, distance });
    // Window widths are in half-degree aim steps.
    expect(route(0, 4, 0)).toBe('Easy');
    expect(route(0, 3, 0)).toBe('Medium');
    expect(route(1, 6, 5)).toBe('Medium');
    expect(route(1, 4, 2)).toBe('Medium');
    expect(route(1, 4, 4)).toBe('Hard');
    expect(route(1, 5, 6.9)).toBe('Hard');
    expect(route(1, 12, 7)).toBe('Very hard');
    expect(route(1, 2, 1)).toBe('Very hard');
    expect(route(2, 20, 2)).toBe('Very hard');
  });

  it('generates reachable targets of every difficulty for both hands, graded by their easiest route', () => {
    const t = trainer(), b = t.fighter.board;
    const layouts = (t as unknown as { layouts: Array<{ cells: number[]; candidates: AimTarget[] }> }).layouts;
    for (const d of DIFFICULTIES) for (const fist of [0, 1]) {
      expect(layouts.flatMap(l => l.candidates).filter(c => c.difficulty === d && c.fist === fist).length, `${d}, fist ${fist}`).toBeGreaterThan(20);
    }
    for (const layout of layouts) {
      b.cells.splice(0, b.cells.length, ...layout.cells);
      expect(b.grapesAfter(new Map())).toEqual([]);
      for (const c of layout.candidates) {
        expectRoutes(b, c);
        expect(c.routes.reduce((n, r) => n + r.hi - r.lo + 1, 0)).toBe(c.angles.length);
        expect(c.difficulty).toBe(routeDifficulty(c.routes[0]));
        for (const r of c.routes) expect(DIFFICULTIES.indexOf(routeDifficulty(r))).toBeGreaterThanOrEqual(DIFFICULTIES.indexOf(c.difficulty));
      }
    }
  }, 60000);

  it.each(DIFFICULTIES)('deals only %s targets when that difficulty is chosen', difficulty => {
    for (let seed = 0; seed < 6; seed++) {
      const t = trainer(seed, 0, difficulty);
      let now = 0;
      for (let shot = 0; shot < AIM_BOARD_SHOTS * 3; shot++) {
        expect(t.current.difficulty, `seed ${seed}, shot ${shot}`).toBe(difficulty);
        now = shoot(t, true, now);
      }
      // A fixed difficulty can wait up to another eight shots for a board change that keeps its grade.
      expect(t.boardNumber).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps new targets clear of the last few', () => {
    const t = trainer(7);
    let now = 0, clear = 0;
    const dealt: AimTarget[] = [t.current];
    for (let shot = 0; shot < 40; shot++) {
      now = shoot(t, true, now);
      const earlier = dealt.slice(-3);
      if (!earlier.some(e => e.cells.some(p => t.current.cells.some(q => q.x === p.x && q.y === p.y)))) clear++;
      dealt.push(t.current);
    }
    expect(clear).toBeGreaterThan(30);
  });

  it('deals every difficulty in Mixed', () => {
    const t = trainer(5), seen = new Set<string>();
    let now = 0;
    for (let shot = 0; shot < 40; shot++) { seen.add(t.current.difficulty); now = shoot(t, true, now); }
    expect([...seen].sort()).toEqual([...DIFFICULTIES].sort());
  });

  it('scores one per connection, preserves the preview, and changes the board every eight shots', () => {
    const t = trainer(), b = t.fighter.board;
    let occupied = b.cells.map(c => c !== 0);
    let now = 0;
    for (let i = 0; i < 30; i++) {
      const next = structuredClone(t.next);
      expect(t.current.colour).not.toBe(next.colour);
      expect(t.current.cells.some(p => next.cells.some(q => q.x === p.x && q.y === p.y))).toBe(false);
      now = shoot(t, true, now);
      expect(t.current).toEqual(next);
      expect(t.score).toBe(i + 1);
      expect(t.lives).toBe(3);
      const after = b.cells.map(c => c !== 0);
      if ((i + 1) % AIM_BOARD_SHOTS === 0) expect(after).not.toEqual(occupied);
      else expect(after).toEqual(occupied);
      occupied = after;
      expect(t.boardNumber).toBe(1 + Math.floor((i + 1) / AIM_BOARD_SHOTS));
      expect(colourOf(t.fighter.hand[t.current.fist])).toBe(t.current.colour);
      expect(isDark(t.fighter.hand[1 - t.current.fist])).toBe(true);
    }
    expect(b.shots).toBe(0);
  });

  it('ignores the disabled hand and inputs during flight; three misses end the run', () => {
    const t = trainer();
    expect(t.fire(1 - t.current.fist, 0)).toBe(false);
    expect(t.shots).toBe(0);
    let now = 0;
    for (let i = 0; i < 3; i++) now = shoot(t, false, now);
    expect(t.lives).toBe(0);
    expect(t.score).toBe(0);
    expect(t.result).toBe('Out of lives');
    expect(t.fire(t.current.fist, now)).toBe(false);
    t.update(now + 10000);
    expect(t.lives).toBe(0);
  });

  it('changes shapes across seeds without invalidating any previewed shot', () => {
    for (let seed = 0; seed < 12; seed++) {
      const t = trainer(seed), b = t.fighter.board;
      let now = 0;
      for (let shot = 1; shot <= AIM_BOARD_SHOTS * 3; shot++) {
        const next = t.next;
        const before = b.cells.map(c => c !== 0);
        now = shoot(t, true, now);
        expect(t.current).toBe(next);
        expect(t.boardNumber, `seed ${seed}, shot ${shot}`).toBe(1 + Math.floor(shot / AIM_BOARD_SHOTS));
        if (shot % AIM_BOARD_SHOTS !== 0) continue;
        expect(b.cells.map(c => c !== 0)).not.toEqual(before);
        expect(b.grapesAfter(new Map())).toEqual([]);
        // A player could have prepared any valid angle while target 2 was on the old board.
        expectRoutes(b, next);
      }
      expect(t.score).toBe(AIM_BOARD_SHOTS * 3);
      expect(t.lives).toBe(3);
    }
  });

  it('ends at exactly two minutes, credits only flights that landed before the deadline', () => {
    const t = trainer(1, 2000);
    shoot(t, true, 2000);
    t.fighter.aim(t.current.fist, t.current.angles[0]);
    expect(t.fire(t.current.fist, 2000 + AIM_MS - 1)).toBe(true);
    expect(t.fire(t.current.fist, 2000 + AIM_MS - 0.5)).toBe(false);
    // The ball still in the air flies on to where it rests, uncounted, before the board settles.
    t.update(2000 + AIM_MS);
    expect(t.result).toBe('Time up');
    expect(t.fighter.flight).not.toBeNull();
    expect(t.settledAt).toBe(t.fighter.flight!.end);
    t.update(2000 + AIM_MS + 10000);
    expect(t.score).toBe(1);
    expect(t.result).toBe('Time up');
    expect(t.endedAt).toBe(2000 + AIM_MS);
    expect(t.remaining(1e9)).toBe(0);
    expect(t.fighter.flight).toBeNull();

    const delayed = trainer();
    delayed.fighter.aim(delayed.current.fist, delayed.current.angles[0]);
    delayed.fire(delayed.current.fist, 0);
    delayed.update(AIM_MS + 5000);
    expect(delayed.score).toBe(1);
    expect(delayed.result).toBe('Time up');
  });

  it('repeats a seed and leaves the final score unchanged when stopped', () => {
    const a = trainer(34), b = trainer(34);
    expect(a.current).toEqual(b.current);
    expect(a.next).toEqual(b.next);
    expect(a.fighter.board.cells).toEqual(b.fighter.board.cells);
    const now = shoot(a, true, 0);
    a.finish('Stopped', now);
    a.update(AIM_MS + 1000);
    expect(a.score).toBe(1);
    expect(a.result).toBe('Stopped');
  });
});
