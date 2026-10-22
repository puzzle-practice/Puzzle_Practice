import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { EMERALD, H, HaulBoard, RUBY, W, chestPart, chestValue, isChest, isChestOrigin } from './logic';
import { boardCode, boardIssues, fill, paint, readBoardCode } from './create';

function board(seed = 7): HaulBoard {
  const rng = new Random(seed);
  const b = new HaulBoard(() => rng.random());
  b.populate();
  return b;
}
const chests = (b: HaulBoard) => b.cells.filter(isChestOrigin).length;

describe('Treasure Haul Create mode', () => {
  it('paints coins and gems, and fills the board', () => {
    const b = board();
    expect(paint(b, 0, 0, 'R')).toBe(true);
    expect(b.get(0, 0)).toBe(RUBY);
    expect(paint(b, 0, 0, 'R')).toBe(false);
    expect(paint(b, W, 0, '1')).toBe(false);
    expect(paint(b, 0, 0, 'X')).toBe(false);
    expect(fill(b, 'E')).toBe(true);
    expect(new Set(b.cells)).toEqual(new Set([EMERALD]));
    expect(fill(b, 'M')).toBe(false);
  });
  it('places a chest by its top-left square, fitted onto the board, over any chest in its way', () => {
    const b = board();
    expect(paint(b, W - 1, 0, 'H')).toBe(true);
    expect(isChestOrigin(b.get(W - 2, 1))).toBe(true);
    expect(chestValue(b.get(W - 2, 1))).toBe(2);
    expect([b.get(W - 1, 1), b.get(W - 2, 0), b.get(W - 1, 0)].map(chestPart)).toEqual([1, 2, 2]);
    expect(paint(b, W - 3, 2, 'L')).toBe(true);
    expect(chests(b)).toBe(1);
    expect(isChestOrigin(b.get(W - 3, 2))).toBe(true);
    // The old chest's squares that the new one doesn't cover are coins again.
    expect(isChest(b.get(W - 1, 0))).toBe(false);
    expect(b.cells.every((p) => p >= 0)).toBe(true);
    // Painting a coin on any square of a chest takes the whole chest away.
    expect(paint(b, W - 2, 1, '2')).toBe(true);
    expect(chests(b)).toBe(0);
    expect(b.get(W - 2, 1)).toBe(2);
  });
  it('copies and pastes a board with its chests', () => {
    const a = board(3);
    paint(a, 2, 5, 'M'); paint(a, 6, 7, 'R');
    const code = boardCode(a);
    expect(code).toMatch(new RegExp(`^T[0-3REMLH+]{${W * H}}$`));
    expect(readBoardCode(code)).toEqual(a.cells);
    expect(readBoardCode(`  ${code.toLowerCase()}\n`)).toEqual(a.cells);
    // A chest without its other squares, or a + with no chest, isn't a board.
    expect(readBoardCode(code.replace('M', '0'))).toBeNull();
    expect(readBoardCode('T' + '+'.repeat(W * H))).toBeNull();
    expect(readBoardCode('T0')).toBeNull();
  });
  it('names what the game could not deal', () => {
    const b = board(5);
    expect(boardIssues(b)).toEqual([]);
    paint(b, 0, H - 1, 'L'); paint(b, 2, 3, 'L'); paint(b, 5, 3, 'M');
    const issues = boardIssues(b).join(' ');
    expect(issues).toContain('top row');
    expect(issues).toContain('More than two chests');
    const c = board(5);
    c.set(0, 0, 1); c.set(1, 0, 1); c.set(2, 0, 1);
    expect(boardIssues(c)[0]).toContain('Three coins');
  });
});
