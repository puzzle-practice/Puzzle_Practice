import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { AIM_BOARD_SHOTS, AIM_LANDING_MS, AIM_MS, AimTrainer } from './aim';
import { Fighter } from './fighter';
import { Glove } from './gloves';
import { colourOf, isDark } from './pieces';

function trainer(seed = 1, startedAt = 0) {
  const fighter = new Fighter(0, {
    board: new Random(seed), alt: new Random(seed + 1), wobble: new Random(seed + 2),
    fists: [new Random(seed + 3), new Random(seed + 4)],
  }, { gloveOf: () => new Glove(0) }, { startRows: 0 }, startedAt);
  return new AimTrainer(fighter, seed, startedAt);
}

function shoot(t: AimTrainer, hit: boolean, now: number) {
  const f = t.fighter, fist = t.current.fist;
  const [lo, hi] = f.board.ranges[fist];
  const dir = hit ? t.current.angles[0] : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
    .find(d => !t.current.angles.includes(d) && f.board.shoot(f.board.path(fist, d)))!;
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
      .find(d => !current.angles.includes(d) && f.board.shoot(f.board.path(fist, d)))!);
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
  it('generates reachable precision and bounce challenges for both hands across seeds', () => {
    for (let seed = 0; seed < 30; seed++) {
      const t = trainer(seed), b = t.fighter.board;
      expect(t.candidates.filter(c => c.kind === 'Bounce').length).toBeGreaterThan(0);
      expect(t.candidates.filter(c => c.kind === 'Precision').length).toBeGreaterThan(0);
      for (const fist of [0, 1]) expect(t.candidates.some(c => c.fist === fist)).toBe(true);
      expect(b.grapesAfter(new Map())).toEqual([]);
      for (const c of t.candidates) {
        for (const dir of c.angles) {
          const shot = b.shoot(b.path(c.fist, dir))!;
          expect(c.cells.some(p => b.adjacent(shot.rest, p))).toBe(true);
          if (c.kind === 'Bounce') expect(shot.flight.length).toBeGreaterThan(2);
        }
      }
    }
  }, 60000);

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
        for (const dir of next.angles) {
          const landed = b.shoot(b.path(next.fist, dir))!;
          expect(next.cells.some(p => b.adjacent(landed.rest, p))).toBe(true);
          if (next.kind === 'Bounce') expect(landed.flight.length).toBeGreaterThan(2);
        }
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
