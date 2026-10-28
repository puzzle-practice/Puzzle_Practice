import { describe, expect, it } from 'vitest';
import { addLabel, boardCode, boardIssues, bulbColors, bulbOrder, cycleBottle, cycleBulb, fill, load, makePiece, paint, readBoardCode, removeLabel, setBulbs, shapeOf, SHAPES } from './create';
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

  it('matches the dealt bulb rules', () => {
    for (let seed = 1; seed < 40; seed++) {
      const dealt = new AlchemyBoard(seed % 9, seed), copy = new AlchemyBoard(seed % 9, seed);
      setBulbs(copy, bulbOrder(dealt));
      expect([copy.hardSecondary, copy.missingPrimary, copy.baseColors]).toEqual([dealt.hardSecondary, dealt.missingPrimary, dealt.baseColors]);
    }
  });

  it('cycles each bulb on its own through quicksilver', () => {
    const board = new AlchemyBoard(6, 8);
    setBulbs(board, 0);
    cycleBulb(board, 5); expect(board.colors[10]).toBe(2);
    cycleBulb(board, 5); cycleBulb(board, 5); expect(board.colors[10]).toBe(9);
    expect(board.colors[9]).toBe(4);
    expect(bulbColors(board)[5]).toEqual({ color: 3, quicksilver: true });
    expect(bulbOrder(board)).toBe(-1);
    cycleBulb(board, 3, -1); expect(board.colors.slice(4, 8)).toEqual([3, 3, 2, 4]);
    expect(boardIssues(board).join(' ')).toContain('groups');
    cycleBulb(board, 1, -1); cycleBulb(board, 1, -1);
    expect(board.colors[2]).toBe(9);
    expect(boardIssues(board).join(' ')).toContain('first, third and last');
    const copy = new AlchemyBoard(6, 1);
    load(copy, readBoardCode(boardCode(board))!);
    expect(copy.colors).toEqual(board.colors);
    expect(boardCode(copy)).toBe(boardCode(board));
    cycleBulb(board, 5); expect(bulbColors(board)[5]).toEqual({ color: 4, quicksilver: false });
    cycleBulb(board, 5, -1); expect(bulbColors(board)[5]).toEqual({ color: 4, quicksilver: true });
    board.fill();
    expect(board.colors.filter((c) => c === 9)).toEqual([]);
    const small = new AlchemyBoard(1, 2);
    while (!bulbColors(small)[0].quicksilver) cycleBulb(small, 0);
    expect(boardIssues(small).join(' ')).toContain('Quicksilver bulbs');
  });

  it('breaks a bottle down to set its first label', () => {
    const board = new AlchemyBoard(6, 3);
    while (!board.bottles[5].broken) expect(removeLabel(board, 5)).toBe(true);
    expect(removeLabel(board, 5)).toBe(false);
    addLabel(board, 5, 7); addLabel(board, 5, 2);
    expect(board.bottles[5].broken).toBe(false);
    expect(board.bottles[5].required.slice(0, board.bottles[5].size)).toEqual([7, 2]);
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
