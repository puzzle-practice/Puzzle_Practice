import { describe, expect, it } from 'vitest';
import { boardCode, boardIssues, cardChoices, fill, load, paint, readBoardCode, setCard, slotTier } from './create';
import { GOLD, PATTERNS, ShipBoard, ShipSession } from './logic';

describe('shipwrightery create', () => {
  it('paints and fills squares', () => {
    const board = new ShipBoard(3, 7);
    expect(paint(board, 2, 3, GOLD)).toBe(true);
    expect(board.get(2, 3)).toBe(GOLD);
    expect(paint(board, 2, 3, GOLD)).toBe(false);
    expect(paint(board, 5, 0, 0)).toBe(false);
    expect(paint(board, 0, 0, 5)).toBe(false);
    fill(board, 2);
    expect(board.cells.every((c) => c === 2)).toBe(true);
  });

  it('round-trips a board and its cards through text', () => {
    const board = new ShipBoard(5, 11);
    paint(board, 4, 0, 3);
    const code = boardCode(board);
    expect(code).toMatch(/^W[0-4]{25}:/);
    const copy = new ShipBoard(1, 2);
    load(copy, readBoardCode(code)!);
    expect(copy.cells).toEqual(board.cells);
    expect(copy.available.slice(0, copy.numAvailable)).toEqual(board.available.slice(0, board.numAvailable));
    expect(boardCode(copy)).toBe(code);
  });

  it('rejects text that is not a board', () => {
    expect(readBoardCode('W123')).toBeNull();
    expect(readBoardCode(`W${'0'.repeat(25)}:nothing`)).toBeNull();
    expect(readBoardCode(`W${'0'.repeat(25)}:cannon,cannon`)).toBeNull();
    expect(readBoardCode(`W${'0'.repeat(24)}5:cannon`)).toBeNull();
  });

  it('keeps cards distinct', () => {
    const board = new ShipBoard(2, 3);
    const other = board.available[1].id;
    expect(setCard(board, 0, other)).toBe(false);
    const unused = PATTERNS.find((p) => !board.available.includes(p))!;
    expect(setCard(board, 0, unused.id)).toBe(true);
    expect(board.available[0]).toBe(unused);
  });

  it('flags boards the game could not deal', () => {
    const board = new ShipBoard(3, 3);
    fill(board, 0);
    expect(boardIssues(board, 3)).toEqual([]);
    paint(board, 0, 0, GOLD);
    expect(boardIssues(board, 2).join(' ')).toContain('no gold');
    expect(boardIssues(board, 3)).toEqual([]);
    const big = PATTERNS.filter((p) => p.tier === 2 && !board.available.includes(p));
    setCard(board, board.available.findIndex((p) => p.tier === 0), big[0].id);
    expect(boardIssues(board, 3).join(' ')).toContain('at most');
  });

  it('offers each card only the patterns the game deals there', () => {
    expect(cardChoices(0, 4).map((p) => p.id).sort()).toEqual(['cannon', 'rigging', 'sail']);
    // Difficulty 1 deals four 3-piece cards, then two 4-piece cards.
    expect([0, 1, 2, 3, 4, 5].map((slot) => slotTier(1, slot))).toEqual([0, 0, 0, 0, 1, 1]);
    expect(cardChoices(1, 0).every((p) => p.tier === 0)).toBe(true);
    expect(cardChoices(1, 5)).toEqual(PATTERNS.filter((p) => p.tier === 1));
    expect([0, 1, 2, 3, 4, 5].map((slot) => slotTier(7, slot))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(cardChoices(7, 0).some((p) => p.id === 'nest')).toBe(false);
    expect(cardChoices(7, 4).some((p) => p.id === 'nest')).toBe(true);
    // Every dealt board fits the choices.
    for (let difficulty = 1; difficulty <= 8; difficulty++) {
      const board = new ShipBoard(difficulty, difficulty * 13);
      board.available.slice(0, board.numAvailable).forEach((p, slot) => expect(cardChoices(difficulty, slot)).toContain(p));
    }
  });

  it('gives Create sessions no tide or goal', () => {
    const session = new ShipSession(4, 9, 0, true);
    expect(session.board.goal).toBe(Infinity);
    expect(new ShipSession(4, 9, 0).board.goal).toBe(20);
  });
});
