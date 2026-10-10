import { describe, expect, it } from 'vitest';
import { PyRandom } from '../../core/pyrandom';
import { createDrill, emeraldRowsInColumn, type ClearPack } from './training';
import { isChestOrigin, EMERALD, RUBY } from './logic';

describe('Clear Chests packs', () => {
  it('efficient drills make same-colour threes below the chest and across its other column', () => {
    for (let seed = 0; seed < 100; seed++) {
      const rng = new PyRandom(seed);
      const { board, chest, opening } = createDrill(() => rng.random(), 'efficient');
      board.gemRates = [0, 0];
      expect(opening).toBeDefined();
      expect(board.findRuns()).toHaveLength(0);
      expect(board.swap(...opening!).kind).toBe('swap');
      const matches = board.findRuns();
      const horizontal = matches.find((r) => r.dir === 0)!;
      const vertical = matches.find((r) => r.dir === 1)!;
      expect(horizontal.length).toBe(3);
      expect(vertical.length).toBe(3);
      expect([chest.x, chest.x + 1]).toContain(vertical.x);
      expect(vertical.y).toBeLessThan(chest.y - 1);
      const otherColumn = vertical.x === chest.x ? chest.x + 1 : chest.x;
      expect(otherColumn).toBeGreaterThanOrEqual(horizontal.x);
      expect(otherColumn).toBeLessThan(horizontal.x + horizontal.length);
      expect(board.get(horizontal.x, horizontal.y)).toBe(board.get(vertical.x, vertical.y));
    }
  });

  it('every pack is stable, with middle placement or a solvable edge opening', () => {
    for (const pack of ['standard', 'efficient', 'emeralds', 'edges'] as ClearPack[]) {
      for (let seed = 0; seed < 30; seed++) {
        const rng = new PyRandom(seed);
        const drill = createDrill(() => rng.random(), pack);
        const { board, chest, solution } = drill;
        expect(board.findRuns()).toHaveLength(0);
        expect(board.cells.filter(isChestOrigin)).toHaveLength(1);
        expect(chest.y).toBeGreaterThanOrEqual(3);
        expect(chest.y).toBeLessThanOrEqual(5);
        if (pack === 'emeralds') {
          expect(board.get(0, 7)).toBe(EMERALD);
          expect(board.get(7, 7)).toBe(EMERALD);
          expect(chest.x).toBeGreaterThanOrEqual(2);
          expect(chest.x + 1).toBeLessThanOrEqual(5);
        }
        if (pack === 'edges') {
          expect([0, 6]).toContain(chest.x);
          board.gemRates = [0, 0];
          let hauled = 0;
          for (const move of solution!) {
            board.swap(...move);
            for (let i = 0; i < 300; i++) {
              const result = board.step();
              if (!result) break;
              if (result.kind === 'haul') hauled += result.chests.length;
            }
          }
          expect(hauled).toBe(1);
        }
      }
    }
  });

  it('constructs varied edge solutions without rubies or automatic opening matches', () => {
    const patterns = new Set<string>();
    for (let seed = 0; seed < 1000; seed++) {
      const rng = new PyRandom(seed);
      const { board, chest, solution, edgePattern } = createDrill(() => rng.random(), 'edges');
      patterns.add(edgePattern!);
      expect(board.cells).not.toContain(RUBY);
      expect(board.findRuns()).toHaveLength(0);
      expect(solution!.length).toBeGreaterThan(1);
      for (let move = 0; move < solution!.length; move++) {
        // Animation effects also consume the shared random stream between moves.
        for (let effect = 0; effect < 10; effect++) rng.random();
        const result = board.swap(...solution![move]);
        expect(['swap', 'gem']).toContain(result.kind);
        if (edgePattern === 'vertical' && move === 0) {
          expect(board.findRuns()).toContainEqual({ dir: 1, x: solution![0][0], y: 6, length: 3 });
        }
        if (edgePattern === 'single-emerald' && move === solution!.length - 1 && result.kind === 'gem') {
          expect(result.y).toBe(5);
          expect(result.cleared).toContainEqual({ x: chest.x === 0 ? 0 : 7, y: 7, piece: expect.any(Number), delay: 100 });
        }
        if (edgePattern === 'double-emerald' && move === 0 && result.kind === 'gem') {
          const outer = chest.x === 0 ? 0 : 7;
          expect(result.cleared.filter((p) => p.x === outer).map((p) => p.y).sort()).toEqual([5, 7]);
        }
        let hauled = 0;
        let settled = false;
        for (let step = 0; step < 300; step++) {
          const next = board.step();
          rng.random();
          if (!next) { settled = true; break; }
          if (next.kind === 'haul') hauled += next.chests.length;
          expect(board.cells).not.toContain(RUBY);
        }
        expect(settled).toBe(true);
        expect(hauled, `seed ${seed}, ${edgePattern}, move ${move}`).toBe(move === solution!.length - 1 ? 1 : 0);
        board.settle();
      }
    }
    expect([...patterns].sort()).toEqual(['double-emerald', 'horizontal', 'single-emerald', 'vertical']);
  });

  it('counts both emerald diagonals when they intersect the locked column', () => {
    expect(emeraldRowsInColumn(1, 6, 0)).toEqual([5, 7]);
    expect(emeraldRowsInColumn(6, 6, 7)).toEqual([5, 7]);
    expect(emeraldRowsInColumn(2, 5, 0)).toEqual([3, 7]);
    expect(emeraldRowsInColumn(0, 7, 0)).toEqual([]);
  });

  it('retains earlier edge emerald positions for historical replays', () => {
    const rng = new PyRandom(7);
    const { board } = createDrill(() => rng.random(), 'emeralds', 1);
    expect(board.get(7, 6)).toBe(EMERALD);
    expect(board.get(0, 7)).toBe(EMERALD);
  });
});
