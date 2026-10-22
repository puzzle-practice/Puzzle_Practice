import { describe, it, expect } from 'vitest';
import fixtures from './parity.json';
import gustFixtures from './gust-parity.json';
import bonusFixtures from './bonus-parity.json';
import { PatchingBoard, difficultyInfo, SPOOL, TIE } from './logic';

describe('Patching rule parity', () => {
  for (const f of bonusFixtures) it(`difficulty ${f.difficulty}, maneuver mode ${f.mode}: token generation`, () => {
    const b = new PatchingBoard(f.difficulty, 42, true, f.mode);
    expect(b.snapshot()).toEqual(f.initial);
    expect([...b.bonuses]).toEqual(f.bonuses);
  });
  for (const f of fixtures) it(`difficulty ${f.difficulty}, seed ${f.seed}: generation, 24 moves, gust and score`, () => {
    const board = new PatchingBoard(f.difficulty, f.seed);
    expect(board.snapshot()).toEqual(f.initial);
    for (const step of f.steps) {
      board.rotate(step.i, step.turn); board.swap(step.i, step.j);
      expect(board.snapshot()).toEqual(step.board);
    }
    const result = board.gust();
    expect(result.done).toBe(f.gust.done);
    expect(result.torn).toBe(f.gust.torn);
    expect(result.score).toBe(f.gust.score);
    expect(board.snapshot()).toEqual(f.gust.board);
  });
  it('uses the requested highest-to-highest wind mapping', () => {
    expect(Array.from({ length: 11 }, (_, d) => difficultyInfo(d).wind)).toEqual([75, 75, 75, 75, 70, 65, 60, 55, 50, 45, 45]);
  });
  for (const f of gustFixtures) it(`gust scenario ${f.kind}: completion, grommet consumption or tears, then second gust`, () => {
    const b = new PatchingBoard(5, 42, false);
    f.initial.forEach(([type, orientation, tension, tile], i) => {
      b.pieces.set(i, { type, orientation, tension, distance: 43 }); b.tiles[i] = tile;
      if (type === SPOOL) b.spool = i; if (type === TIE) b.ties.push(i);
    });
    const r = b.gust();
    expect(r).toEqual({ done: f.done, score: f.score, torn: f.torn, used: f.used });
    expect(b.snapshot()).toEqual(f.first);
    b.update();
    expect(b.gust().done).toBe(f.secondDone);
    expect(b.snapshot()).toEqual(f.second);
  });
});
