import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { LESSONS, VEGAS_AS_PLAYED } from './lessons';
import { act, gameAt, generate, outcome, play, positionOf, scramble, settled } from './engine';

describe('Dennav tutorial lessons', () => {
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: every board sets off its strategy', (_id, lesson) => {
    for (const m of lesson.moments) {
      expect(settled(m.position), m.label).toBe(true);
      expect(lesson.accepts(play(m.position, m.action)), m.label).toBe(true);
      for (const other of LESSONS) if (other !== lesson && other.id !== 'donkey' && other.id !== 'vegas' && lesson.id !== 'donkey' && lesson.id !== 'vegas') {
        expect(other.accepts(play(m.position, m.action)), `${m.label} is also ${other.id}`).toBe(false);
      }
    }
  });

  it('charts the session 3 board as played a link early, as a donkey', () => {
    expect(play(VEGAS_AS_PLAYED.position, VEGAS_AS_PLAYED.action).charted).toBe(5);
  });

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: generated examples and scrambled stages still work', (_id, lesson) => {
    const rng = new Random(7);
    for (let i = 0; i < 6; i++) {
      const seed = lesson.moments[i % lesson.moments.length];
      const example = generate(seed, lesson.accepts, rng);
      expect(settled(example.position)).toBe(true);
      expect(lesson.accepts(play(example.position, example.action))).toBe(true);
      for (const moves of [1, 2]) {
        const stage = scramble(example, moves, lesson.accepts, rng);
        if (!stage) continue;
        const game = gameAt(stage.position);
        let last = outcome([], positionOf(game));
        for (const step of stage.solution) last = outcome(act(game, step), positionOf(game));
        expect(lesson.accepts(last)).toBe(true);
      }
    }
  });
});

describe('Dennav tutorial mistakes', async () => {
  const { makeMistake, fixes, buildUpAtMost: buildUp, spoilBuild, replayBuild } = await import('./engine');
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: a spoiled board can be fixed by its wrong star', (_id, lesson) => {
    const rng = new Random(11);
    for (let i = 0; i < 5; i++) {
      const example = generate(lesson.moments[i % lesson.moments.length], lesson.accepts, rng);
      const mistake = makeMistake(example, lesson.accepts, rng);
      expect(mistake).not.toBeNull();
      expect(lesson.accepts(play(mistake!.position, mistake!.action))).toBe(false);
      expect(fixes(mistake!, mistake!.cell, lesson.accepts)).toBe(true);
    }
  });

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: builds drop stars in random columns, and a wrong turn spoils them', (_id, lesson) => {
    const rng = new Random(5);
    const kinds = new Set<string>();
    let spoiled = 0;
    for (let i = 0; i < 6; i++) {
      const example = generate(lesson.moments[i % lesson.moments.length], lesson.accepts, rng);
      const build = buildUp(example.position, rng, 8);
      expect(build).not.toBeNull();
      // Played back, the build reaches the example with only its junk clears, and still works.
      const played = replayBuild(build!)!;
      expect(played.boards.at(-1)!.cells).toEqual(example.position.cells);
      played.clears.forEach((c, k) => expect(c.length > 0, `move ${k}`).toBe(build!.junk.includes(k)));
      expect(lesson.accepts(play(played.boards.at(-1)!, example.action))).toBe(true);
      const bad = spoilBuild(build!, example.action, lesson.accepts, rng);
      if (!bad) continue;
      spoiled++; kinds.add(bad.kind);
      expect(lesson.accepts(play(bad.boards.at(-1)!, example.action))).toBe(false);
    }
    expect(spoiled).toBeGreaterThan(2);
  });
});

describe('Dennav tutorial build-up stages', async () => {
  const { buildUpAtMost: buildUp } = await import('./engine');
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: playing the build back with its stars in order sets the strategy off', (_id, lesson) => {
    const rng = new Random(5);
    for (let i = 0; i < 4; i++) {
      const example = generate(lesson.moments[i % lesson.moments.length], lesson.accepts, rng);
      const h = buildUp(example.position, rng, 6);
      expect(h).not.toBeNull();
      const game = gameAt(h!.boards[0]);
      h!.moves.forEach((move, j) => {
        game.entry = { ...h!.boards[j].entry };
        expect(act(game, move).some((s) => s.clear)).toBe(h!.junk.includes(j));
      });
      game.entry = { ...example.position.entry };
      expect(lesson.accepts(outcome(act(game, example.action), positionOf(game)))).toBe(true);
    }
  });
});

describe('Dennav tutorial: the vertical triple, step by step', async () => {
  const { verticalPlan, bestHorizontals, wildedBy, planHorizontal, guessBuild, linedUp, INNER } = await import('./engine');
  const lesson = LESSONS.find((l) => l.id === 'vertical-triple')!;
  it('takes every session board and new example apart', () => {
    const rng = new Random(3);
    const examples = [...lesson.moments, ...Array.from({ length: 10 }, (_, i) => generate(lesson.moments[i % lesson.moments.length], lesson.accepts, rng))];
    for (const ex of examples) {
      const plan = verticalPlan(ex)!;
      expect(plan).not.toBeNull();
      expect(plan.vertical).toHaveLength(3);
      expect(plan.pair.length).toBeGreaterThanOrEqual(2);
      expect(Math.floor(plan.gap / 8)).toBe(INNER);
      // The pair is the colour of the star that drops in, and a horizontal at the gap is found.
      expect(plan.pair.every((c) => ex.position.cells[c] === ex.position.cells[plan.top])).toBe(true);
      expect(wildedBy(ex.position.targets, planHorizontal(ex, plan)).length).toBeLessThanOrEqual(bestHorizontals(ex.position.targets).wild);
      // Seen from the board, it looks like a vertical being built over that column.
      const guess = guessBuild(ex.position.cells)!;
      expect(guess).not.toBeNull();
      expect(guess.column).toBe(linedUp(ex.action, plan.gap) % 8);
    }
  });
  it('scores where the horizontal goes like the board in the screenshot', () => {
    // Ring 1 targets north, north-east and south-east; ring 2 targets north and west; ring 3 north.
    const t = (ring: number, octant: number) => ({ ring, octant, colour: 0, wild: false });
    const targets = [t(3, 2), t(3, 1), t(3, 7), t(2, 2), t(2, 4), t(1, 2)];
    // East, north-east, north: both ring 1 targets in it, the south-east one beside it, and ring 2 north above it.
    expect(wildedBy(targets, [24, 25, 26])).toHaveLength(4);
    // Under the west ring 2 target, reaching the north ring 1 target, does as well.
    expect(wildedBy(targets, [26, 27, 28])).toHaveLength(4);
    expect(bestHorizontals(targets)).toEqual({ wild: 4, starts: [0, 2] });
  });
  it('finds ring 1 and ring 2 line-ups, in line and after the saved turn', () => {
    const E = -1;
    // Ring indices: 0 outer (ring 4) … 3 inner (ring 1). A blue (0) vertical over octant 0 with ring 1
    // turned one out, and a red (2) pair beside it in ring 1.
    const cells = Array<number>(32).fill(E);
    const set = (ring: number, octant: number, colour: number) => { cells[ring * 8 + octant] = colour; };
    set(1, 0, 0); set(2, 0, 0); set(3, 1, 0); // ring 1's blue sits one place round: turning ring 1 lines it up
    set(3, 2, 2); set(3, 0, 2); // the red pair, once lined up, sits either side of octant 0
    const clean = guessBuild(cells)!;
    expect(clean).not.toBeNull();
    expect(clean.lineups).toEqual([]);
    set(3, 4, 4); set(2, 4, 4); // yellow above yellow: lined up as the rings sit
    expect(guessBuild(cells)!.lineups).toContainEqual([3 * 8 + 4, 2 * 8 + 4]);
  });
});
