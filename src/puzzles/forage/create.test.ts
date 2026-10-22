import { describe, expect, it } from 'vitest';
import { ForageBoard, HEIGHT, WIDTH, crateSize, isAnts, isCrate, isCrateAnchor, partOf } from './board';
import { EMPTY } from './board';
import { ANTS, EMPTY_PAINT, MOON_PAINT, boardCode, boardIssues, fill, lettersToCells, paint, paintMoon, readBoardCode } from './create';
import { MoonField } from './werewolf';
import { parseBoard } from './logic';
import { PUZZLES } from './puzzles';

const board = (seed = 7) => [...new ForageBoard(seed).cells];
const crates = (cells: number[]) => cells.filter(isCrateAnchor).length;

describe('Forage Create mode', () => {
  it('paints colours and specials, and fills the board', () => {
    const cells = board();
    expect(paint(cells, 0, 0, 6)).toBe(true);
    expect(cells[0]).toBe(6);
    expect(paint(cells, 0, 0, 6)).toBe(false);
    expect(paint(cells, 1, 0, ANTS)).toBe(true);
    expect(isAnts(cells[1])).toBe(true);
    expect(paint(cells, WIDTH, 0, 1)).toBe(false);
    expect(fill(cells, 3)).toBe(true);
    expect(new Set(cells)).toEqual(new Set([3]));
    expect(fill(cells, 11)).toBe(false);
  });
  it('places a crate by its top-left cell, fitted onto the board, over any crate in its way', () => {
    const cells = board();
    // A chest at the bottom-right corner moves to fit: its bottom-left cell is the anchor.
    expect(paint(cells, WIDTH - 1, HEIGHT - 1, 12)).toBe(true);
    const anchor = (HEIGHT - 1) * WIDTH + WIDTH - 3;
    expect(isCrateAnchor(cells[anchor]) && crateSize(cells[anchor])).toBe(2);
    expect(partOf(cells[anchor - WIDTH])).toBe(2);
    expect(paint(cells, WIDTH - 2, HEIGHT - 3, 11)).toBe(true);
    expect(crates(cells)).toBe(1);
    expect(cells.every((p) => p >= 0)).toBe(true);
    // A colour painted on any cell of a crate takes the whole crate away.
    expect(paint(cells, WIDTH - 1, HEIGHT - 3, 0)).toBe(true);
    expect(crates(cells)).toBe(0);
    expect(cells.some(isCrate)).toBe(false);
  });
  it('copies and pastes a board in the simulator letters', () => {
    const cells = board(3);
    paint(cells, 1, 1, 11); paint(cells, 3, 5, 12); paint(cells, 6, 0, 10); paint(cells, 0, 8, ANTS);
    const code = boardCode(cells);
    expect(code).toMatch(new RegExp(`^F[a-y]{${WIDTH * HEIGHT}}$`));
    expect(code.slice(1 + WIDTH + 1, 1 + WIDTH + 3)).toBe('gh');
    expect(readBoardCode(`  ${code}\n`)).toEqual({ cells, moons: [] });
    expect(readBoardCode(code.replace('g', 'u'))).toBeNull();
    expect(readBoardCode('F' + 's'.repeat(WIDTH * HEIGHT))).toBeNull();
    expect(readBoardCode('F' + 'u'.repeat(WIDTH * HEIGHT - 1) + 'k')?.cells).toEqual(lettersToCells(parseBoard(Array.from({ length: HEIGHT }, (_, y) => y === HEIGHT - 1 ? 'uuuuuuk' : 'uuuuuuu'))));
  });
  it('reads every hand-made puzzle once its "any colour" and empty cells are filled', () => {
    for (const rows of Object.values(PUZZLES)) {
      const code = 'F' + rows.join('').replace(/[sz]/g, 'u');
      expect(readBoardCode(code), code).not.toBeNull();
    }
  });
  it('names what the game could not deal', () => {
    const cells = board(5);
    expect(boardIssues(cells)).toEqual([]);
    paint(cells, 0, HEIGHT - 1, 10); paint(cells, 0, 0, 12); paint(cells, 3, 0, 12); paint(cells, 0, 3, ANTS); paint(cells, 4, 4, ANTS);
    const issues = boardIssues(cells).join(' ');
    for (const words of ['bottom row', 'at most 3 crates', 'one set of ants']) expect(issues).toContain(words);
    const runs = board(5);
    paint(runs, 0, 0, 2); paint(runs, 1, 0, 2); paint(runs, 2, 0, 2);
    expect(boardIssues(runs)[0]).toContain('Three of a colour');
  });
  it('empties cells, and copies them as z', () => {
    const cells = board(4);
    expect(paint(cells, 2, 3, EMPTY_PAINT)).toBe(true);
    expect(cells[3 * WIDTH + 2]).toBe(EMPTY);
    expect(paint(cells, 2, 3, EMPTY_PAINT)).toBe(false);
    expect(boardCode(cells)[1 + 3 * WIDTH + 2]).toBe('z');
    expect(readBoardCode(boardCode(cells))?.cells).toEqual(cells);
    expect(boardIssues(cells).join(' ')).toContain('never leaves a cell empty');
    expect(fill(cells, EMPTY_PAINT)).toBe(true);
    expect(cells.every((p) => p === EMPTY)).toBe(true);
    expect(paint(cells, 0, 0, MOON_PAINT)).toBe(false);
    expect(fill(cells, MOON_PAINT)).toBe(false);
  });
  it('places moons by their top-left cell, takes one away when painted again, and copies them', () => {
    const moons = new MoonField();
    expect(paintMoon(moons, WIDTH - 1, HEIGHT - 1, 4, 0)).toBe(true);
    expect(moons.active.map(({ x, y }) => [x, y])).toEqual([[WIDTH - 2, HEIGHT - 2]]);
    // A moon over part of another takes its place.
    paintMoon(moons, WIDTH - 3, HEIGHT - 3, 2, 3);
    expect(moons.active.map(({ x, y, phase, charge }) => [x, y, phase, charge])).toEqual([[WIDTH - 3, HEIGHT - 3, 2, 3]]);
    paintMoon(moons, 0, 0, 4, 0);
    // The same moon again goes; a different phase or claw count changes it instead.
    paintMoon(moons, 0, 0, 3, 1);
    expect(moons.active).toHaveLength(2);
    paintMoon(moons, 0, 0, 3, 1);
    expect(moons.active).toHaveLength(1);
    paintMoon(moons, 0, 0, 4, 0);
    const cells = board(6);
    const code = boardCode(cells, moons.active);
    expect(code.endsWith(`:${WIDTH - 3}${HEIGHT - 3}23` + '0040')).toBe(true);
    expect(readBoardCode(code)).toEqual({ cells, moons: [{ x: WIDTH - 3, y: HEIGHT - 3, phase: 2, charge: 3 }, { x: 0, y: 0, phase: 4, charge: 0 }] });
    expect(readBoardCode(code + '9')).toBeNull();
    expect(readBoardCode(code.slice(0, -4) + `${WIDTH - 1}040`)).toBeNull();
    paintMoon(moons, 3, 3, 4, 0);
    paint(cells, 0, 1, 10);
    const issues = boardIssues(cells, moons.active).join(' ');
    for (const words of ['at most 2 moons', 'moon is over a crate']) expect(issues).toContain(words);
  });
});
