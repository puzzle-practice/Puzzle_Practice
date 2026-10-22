import { describe, expect, it } from 'vitest';
import { addLabel, boardCode, boardIssues, bulbOrder, cycleBottle, fill, load, makePiece, paint, readBoardCode, removeLabel, setBulbs, shapeOf, SHAPES } from './create';
import { AlchemyBoard, specialOf, valid, WIDTH } from './logic';

describe('alchemistry create', () => {
  it('recognises every piece the game deals', () => {
    for (let seed = 1; seed < 20; seed++) {
      const board = new AlchemyBoard(seed % 9, seed);
      for (let x = 0; x < WIDTH; x++) for (let y = 0; valid(x, y); y++) expect(shapeOf(board.get(x, y))).not.toBeNull();
    }
  });

  it('round-trips generated boards through text', () => {
    for (let difficulty = 0; difficulty <= 8; difficulty++) {
      const board = new AlchemyBoard(difficulty, 100 + difficulty);
      const code = boardCode(board);
      const copy = new AlchemyBoard(difficulty, 1);
      load(copy, readBoardCode(code)!);
      expect(boardCode(copy)).toBe(code);
      expect(copy.baseColors).toEqual(board.baseColors);
      expect(copy.hardSecondary).toBe(board.hardSecondary);
      expect(boardIssues(copy)).toEqual([]);
    }
  });

  it('paints pieces keeping their turn', () => {
    const board = new AlchemyBoard(6, 3);
    const turn = shapeOf(board.get(4, 4))![1];
    const other = (shapeOf(board.get(4, 4))![0] + 1) % SHAPES.length;
    expect(paint(board, 4, 4, other, 2)).toBe(true);
    expect(shapeOf(board.get(4, 4))).toEqual([other, turn]);
    expect(specialOf(board.get(4, 4))).toBe(2);
    expect(paint(board, 4, 4, other, 2)).toBe(false);
    expect(paint(board, 0, 9, 0, 0)).toBe(false);
    fill(board, 0, 0);
    expect(board.get(3, 3) & 4095).toBe(makePiece(0, 0, 0));
  });

  it('edits bottles', () => {
    const board = new AlchemyBoard(6, 3);
    const bottle = board.bottles[2];
    while (bottle.size > 1) removeLabel(board, 2);
    expect(removeLabel(board, 2)).toBe(false);
    addLabel(board, 2, 4); addLabel(board, 2, 7);
    expect(bottle.required.slice(0, bottle.size).slice(1)).toEqual([4, 7]);
    cycleBottle(board, 2); cycleBottle(board, 2);
    expect(bottle.count).toBe(2);
    cycleBottle(board, 2);
    expect(bottle.broken).toBe(true);
    cycleBottle(board, 2);
    expect(bottle.broken).toBe(false);
    expect(bottle.count).toBe(0);
    expect(readBoardCode(boardCode(board))).not.toBeNull();
  });

  it('sets the bulbs as the game deals them', () => {
    const board = new AlchemyBoard(5, 8);
    for (let order = 0; order < 6; order++) { setBulbs(board, order); expect(bulbOrder(board)).toBe(order); }
  });

  it('flags boards the game could not deal', () => {
    const board = new AlchemyBoard(2, 4);
    paint(board, 1, 1, 3, 1);
    expect(boardIssues(board).join(' ')).toContain('Quicksilver');
    addLabel(board, 0, 2);
    expect(boardIssues(board).join(' ')).toContain('bottles of 1');
    const all = new AlchemyBoard(0, 4);
    for (let x = 0; x < WIDTH; x++) { all.bottles[x].broken = true; }
    expect(boardIssues(all).join(' ')).toContain('broken');
  });

  it('rejects text that is not a board', () => {
    const code = boardCode(new AlchemyBoard(3, 3));
    expect(readBoardCode(code.slice(0, -2))).toBeNull();
    expect(readBoardCode(code.replace(/^A3/, 'A9'))).toBeNull();
    expect(readBoardCode(`${code.slice(0, 3)}zz${code.slice(5)}`)).toBeNull();
  });
});
