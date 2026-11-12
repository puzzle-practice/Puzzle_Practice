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
  const { makeMistake, fixes, buildHistory } = await import('./engine');
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: a spoiled board can be fixed by its wrong star, and its build-up found', (_id, lesson) => {
    const rng = new Random(11);
    let built = 0;
    for (let i = 0; i < 5; i++) {
      const example = generate(lesson.moments[i % lesson.moments.length], lesson.accepts, rng);
      const mistake = makeMistake(example, lesson.accepts, rng);
      expect(mistake).not.toBeNull();
      expect(lesson.accepts(play(mistake!.position, mistake!.action))).toBe(false);
      expect(fixes(mistake!, mistake!.cell, lesson.accepts)).toBe(true);
      const history = buildHistory(mistake!.position, mistake!.cell, rng);
      if (!history) continue;
      built++;
      expect(history.moves[history.culprit].kind).toBe('drop');
      const dropped = history.boards[history.culprit].entry.colour;
      expect(dropped).toBe(mistake!.position.cells[mistake!.cell]);
    }
    expect(built).toBeGreaterThan(2);
  });
});

describe('Dennav tutorial build-up stages', async () => {
  const { buildHistory } = await import('./engine');
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: playing the build back with its stars in order sets the strategy off', (_id, lesson) => {
    const rng = new Random(5);
    for (let i = 0; i < 4; i++) {
      const example = generate(lesson.moments[i % lesson.moments.length], lesson.accepts, rng);
      const h = buildHistory(example.position, -1, rng, 10);
      expect(h).not.toBeNull();
      const game = gameAt(h!.boards[0]);
      h!.moves.forEach((move, j) => {
        game.entry = { ...h!.boards[j].entry };
        expect(act(game, move).some((s) => s.clear)).toBe(false);
      });
      game.entry = { ...example.position.entry };
      expect(lesson.accepts(outcome(act(game, example.action), positionOf(game)))).toBe(true);
    }
  });
});
