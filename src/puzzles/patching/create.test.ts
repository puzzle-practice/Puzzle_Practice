import { describe, expect, it } from 'vitest';
import { boardCode, boardIssues, fill, load, paint, readBoardCode, rotate } from './create';
import { BLOCKER, CROSS, GROMMET, PatchingBoard, SPOOL, STRAIGHT, TIE } from './logic';
import { readSettings } from './index';

describe('patching create', () => {
  it('round-trips generated boards through text', () => {
    for (const difficulty of [0, 4, 7, 10]) {
      const board = new PatchingBoard(difficulty, 1234 + difficulty);
      const code = boardCode(board);
      const copy = load(readBoardCode(code)!, 1);
      expect(boardCode(copy)).toBe(code);
      expect(copy.spool).toBe(board.spool);
      expect([...copy.ties].sort()).toEqual([...board.ties].sort());
      expect(boardIssues(copy)).toEqual([]);
    }
  });

  it('paints pieces, keeps one spool and tracks tie-offs', () => {
    const board = new PatchingBoard(4, 77);
    const free = [...Array(42).keys()].find((i) => board.inBounds(i) && i !== board.spool && !board.ties.includes(i))!;
    expect(paint(board, free, TIE)).toBe(true);
    expect(board.ties).toContain(free);
    expect(paint(board, free, CROSS)).toBe(true);
    expect(board.ties).not.toContain(free);
    expect(paint(board, board.spool, STRAIGHT)).toBe(false);
    const old = board.spool;
    expect(paint(board, free, SPOOL)).toBe(true);
    expect(board.spool).toBe(free);
    expect(board.pieces.get(old)!.type).toBe(CROSS);
    expect([...board.pieces.values()].filter((p) => p.type === SPOOL)).toHaveLength(1);
  });

  it('never paints outside the board for its difficulty', () => {
    const board = new PatchingBoard(0, 5);
    expect(paint(board, 0, STRAIGHT)).toBe(false);
    expect(board.pieces.get(0)!.type).toBe(BLOCKER);
  });

  it('turns the spool only toward the grid', () => {
    const board = new PatchingBoard(10, 3);
    paint(board, 0, SPOOL);
    for (let n = 0; n < 4; n++) {
      rotate(board, 0, 1);
      const o = board.pieces.get(0)!.orientation;
      // Facing up (2) or left (1) from the corner would point off the grid.
      expect([0, 3]).toContain(o);
    }
  });

  it('fills every square but the spool and tie-offs', () => {
    const board = new PatchingBoard(6, 9);
    fill(board, GROMMET);
    for (const [i, p] of board.pieces) if (board.inBounds(i) && i !== board.spool && !board.ties.includes(i)) expect(p.type).toBe(GROMMET);
    expect(fill(board, SPOOL)).toBe(false);
  });

  it('flags boards the game could not deal', () => {
    const board = new PatchingBoard(1, 9);
    const free = [...Array(42).keys()].find((i) => board.inBounds(i) && i !== board.spool && !board.ties.includes(i))!;
    paint(board, free, GROMMET);
    expect(boardIssues(board).join(' ')).toContain('no grommets');
    paint(board, free, TIE);
    expect(boardIssues(board).join(' ')).toContain('tie-off');
    paint(board, free, BLOCKER);
    expect(boardIssues(board).join(' ')).toContain('no blockers');
  });

  it('rejects text that is not a board', () => {
    expect(readBoardCode('P0')).toBeNull();
    const code = boardCode(new PatchingBoard(0, 4));
    expect(readBoardCode(code.replace('U', 'S'))).toBeNull();
    expect(readBoardCode(`P0S0${code.slice(4)}`)).toBeNull();
  });

  it('reads old settings as Normal', () => {
    expect(readSettings({ difficulty: 3, wind: null, bonusMode: 0 })?.mode).toBe('normal');
    expect(readSettings({ difficulty: 3, wind: null, bonusMode: 0, mode: 'create' })?.mode).toBe('create');
    expect(readSettings({ difficulty: 3, wind: null, bonusMode: 0, mode: 'other' })).toBeNull();
  });
});
