import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/parity.json';
import { BoardRandom } from '../forage/board';
import { AlchemyBoard, Bottle, colorOf, rotated, valid, mixColors, inlets, OVERLAP, MIN_LAYERS, MAX_LAYERS, specialOf } from './logic';

function bottle(data: { required: number[]; filled: number[]; broken: boolean; points: number }): Bottle {
  return Object.assign(new Bottle(), { ...data, required: [...data.required], filled: [...data.filled] });
}
describe('Alchemistry game fixtures', () => {
  it.each(fixtures.generation)('matches board and tube draws at difficulty $difficulty, seed $seed', data => {
    const board = new AlchemyBoard(data.difficulty, data.seed);
    expect(board.cells).toEqual(data.cells);
    expect(board.colors).toEqual(data.colors);
    expect(board.bottles.map(b => b.size)).toEqual(data.targets.map(t => t.required.indexOf(-1)));
    expect(Array.from({ length: data.draws.length }, () => board.nextPiece())).toEqual(data.draws);
  });
  it.each(fixtures.fills)('matches mixed paths and fill scores at difficulty $difficulty (#$case)', data => {
    const board = new AlchemyBoard(data.difficulty, 42);
    board.cells = [...data.before]; board.colors = [...data.colors]; board.baseColors = [...data.colors];
    board.bottles = data.targets.map(bottle);
    board.colorBoard();
    expect(board.cells).toEqual(data.before);
    board.rng = new BoardRandom(data.drawSeed);
    board.fill();
    expect(board.score).toBe(data.score);
    expect(board.finished).toEqual(data.finished.map(bottle));
    expect(board.specials).toEqual(data.specials);
    expect(board.colors).toEqual(data.nextColors);
    // New bottle labels have an independent shuffle; surviving bottles match exactly.
    const survivors = data.after.filter(t => t.broken || t.filled[0] !== -1);
    for (const t of survivors) expect(board.bottles).toContainEqual(bottle(t));
    board.refill();
    expect(board.cells).toEqual(data.refilled);
  });
});

describe('Alchemistry rules', () => {
  it('has six positions per rotation, preserving both independent tubes and specials', () => {
    for (let piece = 0; piece < 4096; piece++) {
      let result = piece | (3 << 20);
      for (let i = 0; i < 6; i++) result = rotated(result);
      expect(result).toBe(piece | (3 << 20));
      expect(rotated(rotated(piece), false)).toBe(piece);
    }
  });
  it('uses the staggered 104-piece board', () => {
    expect(Array.from({ length: 110 }, (_, i) => valid(i % 11, Math.floor(i / 11))).filter(Boolean)).toHaveLength(104);
  });
  it('fills from the bottom, breaks on a wrong label and accepts quicksilver', () => {
    const b = new Bottle(); b.required = [2, 3, 4, -1, -1];
    expect(b.fill(9)).toBe(3); expect(b.next).toBe(3);
    expect(b.fill(3)).toBe(3); expect(b.fill(4)).toBe(4);
    const bad = new Bottle(); bad.required = [2, -1, -1, -1, -1]; expect(bad.fill(3)).toBe(2);
  });
  it('mixes the three primary colors into sludge and lets quicksilver dominate', () => {
    expect(mixColors(mixColors(2, 3), 4)).toBe(8);
    expect(mixColors(2, 4)).toBe(6); expect(mixColors(3, 4)).toBe(7);
    expect(mixColors(8, 9)).toBe(9);
  });
  it('keeps the two tubes of a crossing separate', () => {
    const b = new AlchemyBoard(8, 42); b.cells.fill(0);
    b.colors.fill(0); b.colors[0] = 2; b.colors[1] = 4;
    b.set(0, 0, 9 | (36 << 6)); b.set(1, 0, 9);
    b.colorBoard(); expect(colorOf(b.get(0, 0))).toBe(2); expect(colorOf(b.get(0, 0), 1)).toBe(0);
  });
  it.each(Array.from({ length: 9 }, (_, i) => i))('generates the configured rates and bottle sizes at difficulty %i', difficulty => {
    const b = new AlchemyBoard(difficulty, 1234);
    let overlaps = 0;
    for (let i = 0; i < 20000; i++) { const piece = b.nextPiece(); if (inlets(piece, 1)) overlaps++; expect(specialOf(piece)).toBe(0); }
    expect(overlaps / 20000).toBeCloseTo(OVERLAP[difficulty] / 100, 1);
    for (let i = 0; i < 100; i++) {
      const next = b.nextBottle(); expect(next.size).toBeGreaterThanOrEqual(MIN_LAYERS[difficulty]); expect(next.size).toBeLessThanOrEqual(MAX_LAYERS[difficulty]);
    }
  });
  it('removes entire connected pieces, preserves unconnected pieces, and refills all gaps', () => {
    const b = new AlchemyBoard(8, 42); b.cells.fill(17); b.colors.fill(0); b.colors[0] = 2;
    b.set(0, 0, 9); b.set(0, 1, 9); b.set(0, 2, 9 | (36 << 6));
    b.colorBoard(); b.refill();
    expect(b.cells.filter((_, i) => valid(i % 11, Math.floor(i / 11))).every(p => p !== -1)).toBe(true);
    expect(b.get(1, 9) & 4095).toBe(17);
    expect(b.moves).toBe(0);
  });
});
