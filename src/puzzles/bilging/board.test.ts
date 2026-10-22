import { describe, expect, it } from 'vitest';
import { BilgeBoard, BilgeScore, EMPTY, WIDTH } from './board';
import { BilgingGame, DEFAULT_SETTINGS } from './game';
import fixtures from './fixtures/rules.json';

const decode = (s: string) => Array.from({ length: s.length / 2 }, (_, i) => s.slice(i * 2, i * 2 + 2) === '..' ? EMPTY : parseInt(s.slice(i * 2, i * 2 + 2), 16));

describe('Bilging rule reference cases', () => {
  it('recreates 90 starting boards and their next 60 pieces at every difficulty and token pool', () => {
    for (const f of fixtures.boards) {
      const b = new BilgeBoard(f.seed, f.difficulty, f.mode);
      expect(b.cells, `seed ${f.seed}, difficulty ${f.difficulty}`).toEqual(decode(f.cells));
      expect(Array.from({ length: 60 }, () => b.nextPiece())).toEqual(f.next);
    }
  });
  it('replays 2,400 recorded swaps with cascades, specials, crabs, tokens and scores', () => {
    let checked = 0;
    for (const f of fixtures.games) {
      // A very high level-up target keeps each recorded game on one board.
      const g = new BilgingGame({ ...DEFAULT_SETTINGS, difficulty: f.difficulty, tokens: f.mode, water: f.water }, f.seed);
      expect(g.board.cells).toEqual(decode(f.cells));
      for (const [i, m] of f.moves.entries()) {
        const where = `seed ${f.seed} move ${i}`;
        const moves = g.moves, before = g.board.cells.join();
        g.levelPoints = -1e9;
        const ok = g.swap(m.x, m.y); g.settle();
        if (m.points === -1) { expect(ok, where).toBe('crab'); expect(g.board.cells.join()).toBe(before); continue; }
        if (m.points === -2) { expect(g.moves, where).toBe(moves); expect(g.board.cells.join()).toBe(before); continue; }
        expect(g.moves, where).toBe(moves + 1);
        expect(g.board.cells, where).toEqual(decode(m.cells));
        expect(g.lastMove, where).toEqual({ points: m.points, chain: m.chain, crabs: m.crabs, tokens: m.tokens });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });
});

describe('Bilging scoring', () => {
  const run = (length: number) => ({ horizontal: true, x: 0, y: 0, length });
  it('scores the first clear from the combo table and later steps by piece count', () => {
    const s = new BilgeScore();
    expect(s.runs([run(3)], 5)).toBe(3);
    expect(s.runs([run(3), run(4)], 5)).toBe(7);
    expect(s.chain).toBe(2);
    expect(new BilgeScore().runs([run(3), run(3)], 5)).toBe(10);
    expect(new BilgeScore().runs([run(5), run(4), run(3)], 7)).toBe(128);
    expect(new BilgeScore().runs([run(3), run(3), run(3), run(3)], 6)).toBe(144);
  });
  it('pays five points per water row for each crab', () => {
    const s = new BilgeScore();
    expect(s.crab(7)).toBe(35);
    expect(s.chain).toBe(0);
  });
  it('finds runs only among the seven colours', () => {
    const b = new BilgeBoard(1, 9, 0, false);
    b.cells.fill(EMPTY);
    for (let x = 0; x < 3; x++) b.set(x, 0, 8);
    for (let x = 0; x < 3; x++) b.set(x, 1, 2 | (x === 1 ? 2 << 5 : 0));
    expect(b.runs(false)).toEqual([{ horizontal: true, x: 0, y: 1, length: 3 }]);
    expect(WIDTH).toBe(6);
  });
});
