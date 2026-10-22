import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { BISHOP, IronBoard, KNIGHT, ONE, QUEEN, ROOK, SIZE, TWO, WILD } from './logic';
import { boardCode, boardIssues, fill, load, markLast, paint, readBoardCode } from './create';

const board = (difficulty = 3, seed = 7) => {
  const rng = new Random(seed);
  return new IronBoard(difficulty, () => rng.random());
};

describe('Blacksmithing Create mode', () => {
  it('paints pieces and heat, and counts the strikes from the heat', () => {
    const b = board();
    paint(b, 0, 0, QUEEN, 3);
    expect(b.pieces[0][0]).toMatchObject({ type: QUEEN, condition: 3 });
    expect(paint(b, 0, 0, QUEEN, 3)).toBe(false);
    expect(paint(b, 1, 0, WILD, 1)).toBe(true);
    expect(b.numHits).toBe(2);
    expect(paint(b, 2, 0, ONE, 4)).toBe(false);
    expect(paint(b, SIZE, 0, ONE, 3)).toBe(false);
    expect(fill(b, TWO, 0)).toBe(true);
    expect(b.numHits).toBe(SIZE * SIZE * 3);
    expect(b.pieces.flat().every((p) => p.type === TWO && p.condition === 0)).toBe(true);
  });
  it('marks the last square struck, which decides where the next strike lands', () => {
    const b = board();
    fill(b, ONE, 3);
    expect(markLast(b, { x: 2, y: 2, type: ROOK })).toBe(true);
    // A rook strikes along its row or column to the edge, a bishop along a diagonal to the edge.
    expect(b.isHittable(2, 5)).toBe(true);
    expect(b.isHittable(5, 5)).toBe(false);
    markLast(b, { x: 2, y: 2, type: BISHOP });
    expect(b.isHittable(5, 5)).toBe(true);
    expect(b.isHittable(2, 5)).toBe(false);
    expect(markLast(b, null)).toBe(true);
    expect(b.isHittable(3, 4)).toBe(true);
    expect(markLast(b, null)).toBe(false);
  });
  it('copies and pastes a board with its last strike', () => {
    const a = board(3, 3);
    paint(a, 4, 1, KNIGHT, 2);
    markLast(a, { x: 4, y: 1, type: QUEEN });
    const code = boardCode(a);
    expect(code).toMatch(/^S([1-4BKRQW][0-3]){36}@41Q$/);
    const b = board(3, 4);
    load(b, readBoardCode(`  ${code.toLowerCase()}\n`)!);
    expect(b.pieces).toEqual(a.pieces);
    expect([b.selected?.x, b.selected?.y, b.chain.last(), b.numHits]).toEqual([4, 1, QUEEN, a.numHits]);
    expect(boardCode(b)).toBe(code);
    expect(readBoardCode('S13')).toBeNull();
    expect(readBoardCode(code.replace('@41Q', '@61Q'))).toBeNull();
  });
  it('names what the game could not deal', () => {
    const b = board(0);
    fill(b, ONE, 3);
    expect(boardIssues(b)).toEqual([]);
    paint(b, 0, 0, QUEEN, 3); paint(b, 1, 0, WILD, 3);
    expect(boardIssues(b)[0]).toContain('deals no queens, rum jugs');
    const c = board(1);
    fill(c, ONE, 3); paint(c, 0, 0, BISHOP, 3);
    expect(boardIssues(c)[0]).toContain('keeps bishops off');
    paint(c, 0, 0, ONE, 0);
    expect(boardIssues(c).join(' ')).toContain('no last strike');
    fill(c, ONE, 0); markLast(c, { x: 0, y: 0, type: ONE });
    expect(boardIssues(c).join(' ')).toContain('sword is finished');
  });
});
