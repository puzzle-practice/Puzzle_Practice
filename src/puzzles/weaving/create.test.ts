import { describe, expect, it } from 'vitest';
import { boardCode, boardIssues, fill, load, paint, readBoardCode, setShuttle, thread } from './create';
import { COLS, EMPTY, ROWS, WeaveBoard } from './logic';

describe('weaving create', () => {
  it('round-trips dealt looms through text', () => {
    for (let difficulty = 0; difficulty <= 8; difficulty++) for (let seed = 1; seed <= 5; seed++) {
      const board = new WeaveBoard(difficulty, seed);
      const read = readBoardCode(boardCode(board))!;
      expect(read.difficulty).toBe(difficulty);
      const copy = new WeaveBoard(0, 99);
      load(copy, read);
      expect(copy.difficulty).toBe(difficulty);
      expect(copy.pieces).toEqual(board.pieces);
    }
  });

  it('rejects text that is not a loom', () => {
    expect(readBoardCode('W123')).toBeNull();
    expect(readBoardCode(`L9:${'..'.repeat(100)}:${'..'.repeat(4)}`)).toBeNull();
    expect(readBoardCode(`L2:${'..'.repeat(99)}:${'..'.repeat(4)}`)).toBeNull();
    expect(readBoardCode(` L2:${'..'.repeat(100)}:0010.... `)).not.toBeNull();
  });

  it('accepts every loom the game deals and plays', () => {
    for (let difficulty = 0; difficulty <= 8; difficulty++) for (let seed = 1; seed <= 20; seed++) {
      const board = new WeaveBoard(difficulty, seed);
      for (let move = 0; move < 30; move++) {
        expect(boardIssues(board), `difficulty ${difficulty} seed ${seed} move ${move}`).toEqual([]);
        const offset = Array.from({ length: board.maxOffset + 1 }, (_, i) => i).find(i => board.isBattenable(i));
        if (offset === undefined) break;
        const result = board.batten(offset);
        if (result.complete || result.booched) break;
      }
    }
  });

  it('paints threads and the shuttle', () => {
    const board = new WeaveBoard(4, 3);
    expect(paint(board, 10, 0, thread(2, true))).toBe(true);
    expect(board.pieces[10][0]).toBe(2 | (4 << 4));
    expect(paint(board, 10, 0, thread(2, true))).toBe(false);
    expect(paint(board, 0, 0, thread(1, false))).toBe(false);
    expect(paint(board, 10, COLS, thread(1, false))).toBe(false);
    expect(setShuttle(board, 3, thread(0, false))).toBe(true);
    expect(board.shuttle[3]).toBe(0);
    fill(board, EMPTY);
    for (let row = 1; row < ROWS; row++) expect(board.pieces[row].every(p => p === EMPTY)).toBe(true);
  });

  it('explains looms the game could not deal', () => {
    const board = new WeaveBoard(2, 7);
    fill(board, EMPTY);
    board.pieces[0] = [0, 1, EMPTY, EMPTY, ...Array<number>(COLS - 4).fill(EMPTY)];
    expect(boardIssues(board)).toEqual([]);
    paint(board, 10, 0, thread(3, false));
    expect(boardIssues(board).join(' ')).toContain('3 colours');
    paint(board, 10, 0, thread(0, true));
    expect(boardIssues(board).join(' ')).toContain('Sparkly');
    paint(board, 10, 0, thread(0, false));
    paint(board, 5, 0, thread(1, false));
    expect(boardIssues(board).join(' ')).toContain('push');
    paint(board, 5, 0, EMPTY);
    for (let col = 0; col < 4; col++) paint(board, 10, col, thread(1, false));
    expect(boardIssues(board).join(' ')).toContain('already have cleared');
    fill(board, EMPTY);
    setShuttle(board, 0, EMPTY);
    expect(boardIssues(board).join(' ')).toContain('first slot');
    setShuttle(board, 0, 0); setShuttle(board, 1, EMPTY); setShuttle(board, 2, 1);
    expect(boardIssues(board).join(' ')).toContain('gaps');
    const pairs = new WeaveBoard(0, 1);
    fill(pairs, EMPTY);
    pairs.pieces[0] = [0, 1, 0, EMPTY, ...Array<number>(COLS - 4).fill(EMPTY)];
    expect(boardIssues(pairs).join(' ')).toContain('pair');
  });

  it('notices a shuttle that fits nowhere', () => {
    const board = new WeaveBoard(1, 2);
    // A full loom with no matching groups: rows of alternating colours, shifted each row.
    for (let row = 1; row < ROWS; row++) for (let col = 0; col < COLS; col++) paint(board, row, col, thread((row + col) % 2, false));
    board.pieces[0] = [0, 1, EMPTY, EMPTY, ...Array<number>(COLS - 4).fill(EMPTY)];
    expect(boardIssues(board)).toEqual(['The shuttle fits nowhere, which booches the bolt.']);
  });
});
