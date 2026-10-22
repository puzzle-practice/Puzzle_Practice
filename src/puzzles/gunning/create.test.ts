import { describe, expect, it } from 'vitest';
import { CRATE, EMPTY, GunneryBoard, HOLE, LOADED, PARTIAL, POWDER, SHOT, WAD, WIDTH } from './board';
import { barrelFacing, boardCode, boardIssues, faceBarrel, load, paint, readBoardCode } from './create';
import { DEFAULT_SETTINGS, GunningGame, readSettings } from './game';

const open = (board: GunneryBoard) => [...board.cells.keys()].find((i) => board.cells[i] === 0 && Math.floor(i / WIDTH) === 1)!;

describe('gunning create', () => {
  it('round-trips dealt decks through text', () => {
    for (const cannons of [2, 4, 6]) {
      const game = new GunningGame({ ...DEFAULT_SETTINGS, cannons }, 7 + cannons);
      for (let t = 0; t < 4000; t += 50) game.step(50);
      game.placeArrow(6, 1, 12);
      const code = boardCode(game.board);
      const copy = new GunneryBoard(cannons, 1);
      load(copy, readBoardCode(code)!);
      expect(boardCode(copy)).toBe(code);
      expect(boardIssues(new GunneryBoard(cannons, 3))).toEqual([]);
    }
  });

  it('paints crates, holes and pieces', () => {
    const board = new GunneryBoard(4, 5);
    const i = open(board), x = i % WIDTH, y = Math.floor(i / WIDTH);
    expect(paint(board, x, y, 'crate', 0)).toBe(true);
    expect(board.cells[i]).toBe(CRATE);
    expect(paint(board, x, y, 'hole', 0)).toBe(true);
    expect(board.cells[i]).toBe(HOLE);
    expect(paint(board, x, y, 'powder', 2)).toBe(false);
    paint(board, x, y, 'clear', 0);
    expect(paint(board, x, y, 'powder', 2)).toBe(true);
    expect(board.pieces).toHaveLength(1);
    expect(paint(board, x, y, 'shot', 2)).toBe(true);
    expect(board.pieces.map((p) => p.type)).toEqual([SHOT]);
    expect(board.ballsOut).toBe(1);
    expect(paint(board, 6, 6, 'crate', 0)).toBe(false);
  });

  it('loads and clears cannons', () => {
    const board = new GunneryBoard(2, 5);
    const cannon = board.cannons[0];
    paint(board, 2, 3, 'powder', 0);
    paint(board, 1, 3, 'wad', 0);
    expect(cannon.state).toBe(PARTIAL);
    expect(board.resting(3, 3)).toBe(POWDER);
    expect(board.resting(2, 3)).toBe(WAD);
    paint(board, 1, 3, 'shot', 0);
    expect(cannon.state).toBe(LOADED);
    expect(paint(board, 1, 3, 'powder', 0)).toBe(false);
    paint(board, 1, 3, 'clear', 0);
    expect(cannon.state).toBe(EMPTY);
    paint(board, 1, 3, 'fouled', 0);
    expect(cannon.fouled).toBe(true);
    paint(board, 1, 3, 'powder', 0);
    // A fouled cannon fills from its middle slot.
    expect(cannon.slots[1]?.type).toBe(POWDER);
    const copy = new GunneryBoard(2, 9);
    load(copy, readBoardCode(boardCode(board))!);
    expect(copy.cannons[0].fouled).toBe(true);
    expect(copy.cannons[0].slots[1]?.type).toBe(POWDER);
  });

  it('turns the barrel', () => {
    const board = new GunneryBoard(4, 5);
    faceBarrel(board, 3);
    expect(barrelFacing(board)).toBe(3);
    expect(board.barrel.exit()).toBe(3);
  });

  it('moves the single barrel, uses its new row for spawning and blocking, and shares its position', () => {
    const board = new GunneryBoard(4, 5), barrel = board.barrel;
    paint(board, 7, 4, 'clear', 0);
    paint(board, 7, 3, 'clear', 0);
    expect(paint(board, 7, 4, 'barrel', 0)).toBe(true);
    expect(board.barrel).toBe(barrel);
    faceBarrel(board, 0);
    expect([barrel.col, barrel.row]).toEqual([7, 4]);
    expect(barrel.blocks(7, 5, 7, 4)).toBe(true);
    expect(barrel.blocks(6, 5, 6, 6)).toBe(false);
    expect(paint(board, 7, 4, 'crate', 0)).toBe(false);
    expect(paint(board, 7, 4, 'clear', 0)).toBe(false);
    expect(paint(board, 1, 3, 'barrel', 0)).toBe(false);
    expect(paint(board, 6, 6, 'crate', 0)).toBe(true);
    const code = boardCode(board), read = readBoardCode(code)!;
    expect(read.barrel).toEqual([7, 4]);
    const copy = new GunneryBoard(4, 99); load(copy, read);
    expect(boardCode(copy)).toBe(code);
    board.tick();
    expect(board.pieces[0]).toMatchObject({ x: 7, y: 4, nx: 7, ny: 3 });
    expect(readBoardCode(code.replace('@74', '@13'))).toBeNull();
    expect(readBoardCode(code.replace('@74', '@7f'))).toBeNull();
  });

  it('flags decks the game could not deal', () => {
    const board = new GunneryBoard(2, 5);
    paint(board, 6, 5, 'crate', 0);
    const issues = boardIssues(board).join(' ');
    expect(issues).toContain('8 crates, not 9');
    expect(issues).toContain('barrel’s rows');
    for (const x of [0, 2, 4, 6]) paint(board, x, 1, 'shot', 1);
    expect(boardIssues(board).join(' ')).toContain('at most 1 of each');
  });

  it('rejects text that is not a deck', () => {
    const code = boardCode(new GunneryBoard(4, 5));
    expect(readBoardCode(code.replace(/^G4/, 'G6'))).toBeNull();
    expect(readBoardCode(code.slice(0, 10))).toBeNull();
    expect(readSettings({ ...DEFAULT_SETTINGS, mode: 'create' })?.mode).toBe('create');
    expect(readSettings({ cannons: 4 })?.mode).toBe('normal');
  });
});
