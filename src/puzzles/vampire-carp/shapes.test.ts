import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { THREE_PIECE_HOLES, TWO_PIECE_HOLES, TWO_PIECE_HOLES_WITH_X } from './holes';
import { createSmallHole, holesWith } from './shapes';

function table(size: number, letter: string) {
  if (size === 2) return letter === 'x' ? [...TWO_PIECE_HOLES_WITH_X] : holesWith(TWO_PIECE_HOLES, letter);
  return holesWith(THREE_PIECE_HOLES, letter);
}

describe('native Speed Carpentry holes', () => {
  it.each([1, 2, 3])('deals reproducible holes for %i pieces, independently of previous draws', size => {
    const layouts = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const rng = new Random(seed);
      for (let draw = 0; draw < seed; draw++) rng.random();
      const [hole, next] = createSmallHole(rng, size, [], table(size, ''), seed);
      expect(createSmallHole(new Random(999), size, [], table(size, ''), seed)).toEqual([hole, next]);
      expect(next).toBeGreaterThan(seed);
      expect(hole.grid).toHaveLength(4);
      expect(hole.grid.every(row => row.length === 9)).toBe(true);
      expect(hole.grid.flat().reduce((a, b) => a + b, 0)).toBe(size * 5);
      expect(hole.prob).toEqual(hole.grid);
      expect(hole.edges).toEqual(hole.grid);
      expect(hole.prob).not.toBe(hole.grid);
      expect(hole.needed.length).toBeGreaterThan(0);
      expect(hole.needed.every(combo => combo.length === size)).toBe(true);
      layouts.add(JSON.stringify(hole.grid));
    }
    expect(layouts.size).toBeGreaterThan(1);
  });

  it.each([2, 3])('avoids duplicate %i-piece shapes while supplying the required letter', size => {
    for (const letter of ['f', 'i', 'l', 'x']) {
      const choices = table(size, letter);
      const [first] = createSmallHole(new Random(0), size, [], choices, 42);
      const [second] = createSmallHole(new Random(0), size, [first.code], choices, 42);
      expect(second.code).not.toBe(first.code);
      expect(second.needed.every(combo => combo.includes(letter))).toBe(true);
      expect(second.grid.flat().reduce((a, b) => a + b, 0)).toBe(size * 5);
    }
  });
});
