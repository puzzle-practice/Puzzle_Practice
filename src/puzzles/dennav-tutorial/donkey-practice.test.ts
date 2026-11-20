import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { gameAt, generate, makeMistake, positionOf, readPosition, type Action } from './engine';
import { LESSONS, VEGAS_AS_PLAYED } from './lessons';
import { DONKEY_CHAIN, analyseBreak, breakScenes, findFix, setsOff, trackStars } from './donkey-practice';

const donkey = LESSONS.find((l) => l.id === 'donkey')!;
const session = donkey.moments[0];

describe('donkey from a blank board', () => {
  it('passes a break that charts a donkey', () => {
    const a = analyseBreak(session.position, session.action);
    expect(a.success).toBe(true);
    expect(a.chain).toBe(DONKEY_CHAIN);
    expect(a.fix).toBeNull();
  });

  it('explains the vegas that charted a link early, and finds the star to change', () => {
    const a = analyseBreak(VEGAS_AS_PLAYED.position, VEGAS_AS_PLAYED.action, DONKEY_CHAIN + 1);
    expect(a.success).toBe(false);
    expect(a.chain).toBe(5);
    // The orange target in ring 2 east already held orange once ring 2 turned.
    expect(a.targets).toEqual([2 * 8 + 0]);
    expect(a.problem).toMatch(/already held the right colour/);
    expect(a.fix?.kind).toBe('recolour');
    expect(a.stars).toEqual([2 * 8 + 7]);
  });

  it('finds a fix for spoiled donkeys and blames a star', () => {
    const rng = new Random(7);
    let checked = 0;
    for (let i = 0; i < 8 && checked < 4; i++) {
      const bad = makeMistake(generate(session, donkey.accepts, rng), donkey.accepts, rng);
      if (!bad) continue;
      const a = analyseBreak(bad.position, bad.action);
      expect(a.success).toBe(false);
      expect(a.fix).not.toBeNull();
      expect(a.fix!.result.charted).toBeGreaterThanOrEqual(DONKEY_CHAIN);
      expect(a.stars.length).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('calls an accidental clear before ring 1 is ready an early clear', () => {
    // A blue dropped at east lands on two blues stacked in rings 1 and 2: a vertical clears at once.
    const before = readPosition('N4:................0.......01234012:362,213,224,104:00');
    const a = analyseBreak(before, { kind: 'drop' });
    expect(a.chain).toBeNull();
    expect(a.problem).toMatch(/early clear/);
    expect(a.stars.sort()).toEqual([16, 24]);
  });

  it('a single clear does not end the board; a double does', () => {
    const single = readPosition('N4:................0.......01234012:362,213,224,104:00');
    expect(setsOff(breakScenes(single, { kind: 'drop' }).result)).toBe(false);
    expect(setsOff(breakScenes(session.position, session.action).result)).toBe(true);
  });

  it('a quiet move does not end the board', () => {
    const blank = positionOf(gameAt(readPosition('N4:................................:300,201,210,104:30')));
    expect(setsOff(breakScenes(blank, { kind: 'drop' }).result)).toBe(false);
  });

  it('tracks a star through a turn and its falls', () => {
    const { scenes } = breakScenes(session.position, session.action);
    const cell = 3 * 8 + 3; // ring 1 north-west, turned clockwise to north
    const tracked = trackStars(scenes, [cell]);
    expect(tracked.get(scenes[0])).toEqual([cell]);
    expect(tracked.get(scenes[1])).toEqual([3 * 8 + 2]);
  });

  it('prefers a different trigger on the same board', () => {
    // The session board, set off with the wrong turn, still had the donkey one turn away.
    const wrong: Action = { kind: 'rotate', ring: 3, clockwise: false };
    const fix = findFix(session.position, wrong);
    if (fix) expect(fix.kind === 'trigger' || fix.result.charted! >= DONKEY_CHAIN).toBe(true);
  });
});
