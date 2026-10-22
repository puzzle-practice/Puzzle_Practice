import { describe, expect, it } from 'vitest';
import fixtures from './parity.json';
import { copyGrid, difficultyInfo, emptyGrid, WeaveBoard } from './logic';
import { CLEAR_MS, CLOSE_MS, mousePosition, RETURN_MS, ROW_MS } from './timing';

const normalizedGroups = (groups: Array<{ colour: number; cells: number[][] }>) => groups.map(group => ({
  colour: group.colour, cells: group.cells.map(cell => JSON.stringify(cell)).sort(),
})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('Weaving reference games', () => {
  for (const game of fixtures) it(`matches difficulty ${game.difficulty}, seed ${game.seed}`, () => {
    const board = new WeaveBoard(game.difficulty, BigInt(game.seed));
    expect(board.pieces).toEqual(game.start);
    for (const step of game.steps) {
      expect(board.isBattenable(step.offset)).toBe(true);
      const result = board.batten(step.offset);
      expect(board.pieces).toEqual(step.board);
      expect(board.groupsCleared).toBe(step.groups);
      expect(result.complete).toBe(step.complete);
      expect(result.booched).toBe(step.booched);
      expect(result.stages.map(stage => ({ reed: stage.reed, groups: normalizedGroups(stage.groups) })))
        .toEqual(step.stages.map(stage => ({ reed: stage.reed, groups: normalizedGroups(stage.groups) })));
    }
  });
});

describe('Weaving rules and controls', () => {
  it('keeps all nine difficulty choices and their exact bolt targets', () => {
    expect(Array.from({ length: 9 }, (_, n) => difficultyInfo(n).target)).toEqual([5,10,15,15,25,25,25,25,25]);
    expect(Array.from({ length: 9 }, (_, n) => difficultyInfo(n).colours)).toEqual([2,2,3,3,3,4,4,4,4]);
    expect(new WeaveBoard(-5, 1).difficulty).toBe(0);
    expect(new WeaveBoard(15, 1).difficulty).toBe(8);
  });
  it('does not collapse gaps independently when another column blocks the reed', () => {
    const board = new WeaveBoard(5, 1);
    board.pieces = emptyGrid();
    board.pieces[0][0] = 0; board.pieces[0][1] = 1;
    board.pieces[10][0] = 2;
    const result = board.batten(0);
    expect(result.stages[0].reed).toBe(9);
    expect(result.stages[0].compressed[9].slice(0,2)).toEqual([0,1]);
    expect(result.stages[0].compressed[10][1]).toBe(-1);
  });
  it('recognizes a blocked offset without changing the board', () => {
    const board = new WeaveBoard(4, 1);
    board.pieces = emptyGrid(); board.pieces[0][0] = 0; board.pieces[0][2] = 1;
    for (let r = 1; r < 11; r++) board.pieces[r][0] = r % 3;
    const before = copyGrid(board.pieces);
    expect(board.isBattenable(0)).toBe(false);
    expect(board.isBattenable(1)).toBe(true);
    expect(board.isBattenable(-1)).toBe(false);
    expect(board.isBattenable(8)).toBe(false);
    expect(board.isBooched()).toBe(false);
    expect(board.pieces).toEqual(before);
  });
  it('finishes after the entire last cascade, retaining surplus groups', () => {
    const board = new WeaveBoard(0, 1);
    board.pieces = emptyGrid(); board.groupsCleared = 4;
    board.pieces[0][0] = 0;
    for (let c = 0; c < 4; c++) { board.pieces[10][c] = 0; board.pieces[10][c + 5] = 1; }
    const result = board.batten(0);
    expect(result.complete).toBe(true);
    expect(board.groupsCleared).toBe(6);
    expect(board.shuttle.every(p => p === -1)).toBe(true);
  });
  it('deals pairs only at level zero and preserves the 40/40/20 size distribution elsewhere', () => {
    for (const difficulty of [0,1,2,3,4,5,8]) {
      const board = new WeaveBoard(difficulty, 149);
      const sizes = [0,0,0,0,0]; let special = 0, pieces = 0, gaps = 0;
      for (let i = 0; i < 10000; i++) {
        board.fillShuttle();
        const occupied = board.shuttle.filter(p => p !== -1);
        sizes[occupied.length]++;
        pieces += occupied.length; special += occupied.filter(p => p >= 64).length;
        if (board.shuttle.slice(0,10 - board.maxOffset).includes(-1)) gaps++;
      }
      if (difficulty === 0) expect(sizes[2]).toBe(10000);
      else {
        expect(sizes[2] / 10000).toBeCloseTo(0.4,1);
        expect(sizes[3] / 10000).toBeCloseTo(0.4,1);
        expect(sizes[4] / 10000).toBeCloseTo(0.2,1);
      }
      if (difficulty < 3) expect(gaps).toBe(0); else expect(gaps).toBeGreaterThan(0);
      if (difficulty < 4) expect(special).toBe(0); else expect(special / pieces).toBeCloseTo(1 / 16,2);
    }
  });
  it('uses the recovered animation durations and mouse snapping', () => {
    expect([ROW_MS, CLOSE_MS, CLEAR_MS, RETURN_MS]).toEqual([55,90,700,500]);
    expect(mousePosition(-100,4,6)).toEqual({ offset: 0, x: 55 });
    expect(mousePosition(900,4,6)).toEqual({ offset: 6, x: 259 });
    expect(mousePosition(55 + 68 + 3 * 34,4,6)).toEqual({ offset: 3, x: 157 });
  });
});
