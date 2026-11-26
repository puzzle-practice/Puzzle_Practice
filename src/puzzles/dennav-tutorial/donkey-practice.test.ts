import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { EMPTY } from '../navigation/logic';
import { gameAt, generate, innerCounts, makeMistake, positionOf, readPosition, type Action } from './engine';
import { LESSONS, VEGAS_AS_PLAYED } from './lessons';
import { DONKEY_CHAIN, analyseBreak, breakFrames, breakScenes, donkeyGame, findFix, setsOff, targetsBeforeClears, trackStars } from './donkey-practice';

const donkey = LESSONS.find((l) => l.id === 'donkey')!;
const session = donkey.moments[0];
/** Jared's session 2 donkey (ring 1 not laid out from one bag), kept for the star-tracking and trigger checks. */
const session2 = { position: readPosition('N4:4.1.1...124002334240230400141122:374,232,242,104:20'), action: { kind: 'rotate', ring: 3, clockwise: true } as Action };

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

  it('blames the yellow refill clearing beside the inner chain, even after three inner clears', () => {
    const before = readPosition('N4:2.33..4.100244014132141312443322:324,351,373,224,260,133:31');
    const action: Action = { kind: 'rotate', ring: 2, clockwise: true };
    const analysis = analyseBreak(before, action);
    expect(analysis.success).toBe(false);
    expect(analysis.problem).toMatch(/yellow clear in ring 3 at link 3 broke the combo/);
    expect(analysis.problem).toMatch(/turned wild, but was left empty/);
    expect(analysis.problem).not.toMatch(/never filled or turned wild/);
    expect(analysis.stars.sort((a, b) => a - b)).toEqual([6, 12, 13]);
    expect(analysis.targets).toEqual([22]);
    const { frames } = breakFrames([], before, action, analysis);
    const yellowClear = frames.find((f) => f.scene?.clear?.chain === 3)!;
    expect(yellowClear.position.cells).toEqual(readPosition('N4:..33......02444..0214101.3443334:32*,35*,37*,224,26*,13*:31').cells);
    expect(yellowClear.blame.sort((a, b) => a - b)).toEqual([12, 13, 14]);
    expect(yellowClear.blame.every((cell) => yellowClear.clearing.includes(cell))).toBe(true);
  });

  it('finds a fix for spoiled donkeys and blames a star', () => {
    const rng = new Random(7);
    let checked = 0;
    for (let i = 0; i < 8 && checked < 4; i++) {
      const bad = makeMistake(generate(session, donkey.accepts, rng, donkey.keep), donkey.accepts, rng, donkey.keep);
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

  it('shows newly wild targets after their clear, in playback and when stepping either way', () => {
    const before = readPosition('N4:2.33..4.100244014132141312443322:324,351,373,224,260,133:31');
    const action: Action = { kind: 'rotate', ring: 2, clockwise: true };
    const { scenes, result } = breakScenes(before, action);
    const displayed = targetsBeforeClears(scenes, before.targets);
    const { frames } = breakFrames([], before, action, analyseBreak(before, action));
    const wild = (targets: typeof before.targets) => targets.filter((t) => t.wild).map((t) => t.ring * 8 + t.octant);
    for (const link of result.links.filter((l) => l.wilded.length)) {
      const index = scenes.indexOf(link.scene);
      const previous = index ? scenes[index - 1].targets : before.targets;
      expect(wild(displayed.get(link.scene)!)).toEqual(wild(previous));
      expect(wild(displayed.get(scenes[index + 1])!)).toEqual(wild(link.scene.targets));
      const frameAt = frames.findIndex((f) => f.scene?.clear?.kind === link.kind && f.scene.clear.chain === link.chain);
      expect(wild(frames[frameAt].position.targets)).toEqual(wild(previous));
      expect(wild(frames[frameAt + 1].position.targets)).toEqual(wild(link.scene.targets));
      // Reviewing a later step must not mutate the previous step or the engine's result.
      expect(wild(frames[frameAt].position.targets)).toEqual(wild(previous));
      expect(link.wilded.every((t) => link.scene.targets.some((a) => a.ring === t.ring && a.octant === t.octant && a.wild))).toBe(true);
    }
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

  it('a fresh board deals 3/2/1 constellations from the start, and after charting', () => {
    const perRing = (targets: { ring: number }[]) => [0, 1, 2, 3].map((ring) => targets.filter((t) => t.ring === ring).length).join();
    for (const seed of [1, 2, 3, 99, 12345]) {
      const g = donkeyGame(seed);
      expect(perRing(g.targets), `seed ${seed}`).toBe('0,1,2,3');
      // The constellations the board deals after charting.
      for (let i = 0; i < 3; i++) expect(perRing(g.board.nextConstellation()), `seed ${seed}, constellation ${i + 2}`).toBe('0,1,2,3');
    }
  });

  it('lists the stills of a broken board: the build, then the break link by link', () => {
    const { position: before, action } = session;
    const history = [
      { before: readPosition('N4:................................:300,201,210,104:30'), action: { kind: 'drop' } as Action },
      { before, action: { kind: 'rotate', ring: 1, clockwise: true } as Action },
    ];
    const analysis = analyseBreak(before, action);
    const { frames, start, result } = breakFrames(history, before, action, analysis);
    expect(start).toBe(2);
    expect(frames.slice(0, 2).map((f) => f.move)).toEqual([1, 2]);
    expect(frames[start].kind).toBe('before');
    expect(frames[start].position).toBe(before);
    expect(frames.at(-1)!.kind).toBe('end');
    expect(frames.at(-1)!.position).toEqual(result.after);
    // One still per clear of the move, in order, each with the stars it takes.
    const clears = frames.filter((f) => f.kind === 'clear');
    expect(clears.length).toBe(result.links.length);
    expect(clears.map((f) => f.link)).toEqual(clears.map((_, i) => i));
    for (const f of clears) expect(f.clearing.length).toBeGreaterThan(0);
    // No two stills in a row look the same, except a clear (its stars are ringed on the board before it goes).
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].kind === 'clear' || frames[i].kind === 'move' || frames[i - 1].kind === 'move') continue;
      expect(frames[i].position.cells.join(), `still ${i}`).not.toBe(frames[i - 1].position.cells.join());
    }
  });

  it('a quiet move does not end the board', () => {
    const blank = positionOf(gameAt(readPosition('N4:................................:300,201,210,104:30')));
    expect(setsOff(breakScenes(blank, { kind: 'drop' }).result)).toBe(false);
  });

  it('tracks a star through a turn and its falls', () => {
    const { scenes } = breakScenes(session2.position, session2.action);
    const cell = 3 * 8 + 3; // ring 1 north-west, turned clockwise to north
    const tracked = trackStars(scenes, [cell]);
    expect(tracked.get(scenes[0])).toEqual([cell]);
    expect(tracked.get(scenes[1])).toEqual([3 * 8 + 2]);
  });

  it('prefers a different trigger on the same board', () => {
    // The session board, set off with the wrong turn, still had the donkey one turn away.
    const wrong: Action = { kind: 'rotate', ring: 3, clockwise: false };
    const fix = findFix(session2.position, wrong);
    if (fix) expect(fix.kind === 'trigger' || fix.result.charted! >= DONKEY_CHAIN).toBe(true);
  });

  it('never suggests a fix that leaves three of one colour in ring 1', () => {
    const rng = new Random(11);
    for (let i = 0; i < 8; i++) {
      const bad = makeMistake(generate(session, donkey.accepts, rng, donkey.keep), donkey.accepts, rng, donkey.keep);
      const fix = bad && findFix(bad.position, bad.action);
      if (fix) expect(Math.max(...innerCounts(fix.position.cells).values())).toBeLessThanOrEqual(2);
    }
  });
});

describe('carrying on a failed attempt', () => {
  it('replaying the moves on the same seed gives the same board and the same stars to come', () => {
    const rng = new Random(7);
    for (const seed of [3, 41, 977]) {
      const live = donkeyGame(seed);
      const history: { before: string; action: Action }[] = [];
      for (let i = 0; i < 30; i++) {
        const action: Action = rng.integer(0, 2) === 0 ? { kind: 'drop' } : { kind: 'rotate', ring: rng.integer(0, 3), clockwise: rng.integer(0, 1) === 1 };
        if (action.kind === 'drop' && live.board.get(live.entry.octant, 0) !== EMPTY) continue;
        history.push({ before: JSON.stringify(positionOf(live)), action });
        (action.kind === 'drop' ? live.drop() : live.rotate(action.ring, action.clockwise));
        if (live.booched || live.finished) break;
      }
      for (let k = 0; k < history.length; k++) {
        const again = donkeyGame(seed);
        for (const h of history.slice(0, k)) (h.action.kind === 'drop' ? again.drop() : again.rotate(h.action.ring, h.action.clockwise));
        expect(JSON.stringify(positionOf(again))).toBe(history[k].before);
      }
    }
  });
});
