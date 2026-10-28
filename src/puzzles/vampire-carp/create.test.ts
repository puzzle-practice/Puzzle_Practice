import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { BoardRandom, CarpentryBoard, MAX_HOLE, Piece, PUTTY_TOOL } from './board';
import { boardCode, boardIssues, clearHoles, holeGrid, holePlanks, load, paintHole, readBoardCode, setTool, shapeHole, toolFor } from './create';
import { Game, newStats } from './game';

const count = (grid: boolean[][]) => grid.flat().filter(Boolean).length;

describe('carpentry create', () => {
  it('round-trips dealt boards through text, keeping holes where they sit', () => {
    for (const [difficulty, size] of [[8, 5], [4, -1], [9, -1], [0, -1]]) {
      const board = new CarpentryBoard(1234 + difficulty, difficulty, size);
      const code = boardCode(board);
      const copy = new CarpentryBoard(99, difficulty, size);
      load(copy, readBoardCode(code)!);
      expect(boardCode(copy)).toBe(code);
      for (let i = 0; i < 4; i++) {
        expect(copy.holes[i].size).toBe(board.holes[i].size);
        expect(holeGrid(copy.holes[i])).toEqual(holeGrid(board.holes[i]));
      }
      expect(copy.toolbox).toEqual(board.toolbox);
      expect([difficulty, boardIssues(board, size < 0)]).toEqual([difficulty, []]);
    }
  });

  it('paints squares open and shut without moving the rest of the hole', () => {
    const board = new CarpentryBoard(5);
    const before = holeGrid(board.holes[0]);
    const spot = [...Array(100).keys()].map((n) => [Math.floor(n / 10), n % 10] as [number, number]).find(([x, y]) => !before[x][y])!;
    const hole = paintHole(board, 0, spot, true)!;
    expect(hole).not.toBeNull();
    const after = holeGrid(hole);
    expect(count(after)).toBe(count(before) + 1);
    for (let x = 0; x < MAX_HOLE; x++) for (let y = 0; y < MAX_HOLE; y++) if (x !== spot[0] || y !== spot[1]) expect(after[x][y]).toBe(before[x][y]);
    expect(paintHole(board, 0, spot, true)).toBeNull();
    expect(paintHole(board, 0, [10, 0], true)).toBeNull();
    clearHoles(board);
    expect(board.holes.every((h) => h.size === 0)).toBe(true);
  });

  it('keeps planks in a hole while it is painted, and takes out the one painted over', () => {
    const board = new CarpentryBoard(5);
    const hole = board.holes[0];
    // An I down the hole's middle column, which every dealt hole has open top to bottom.
    const x = Math.trunc(hole.width / 2);
    expect(hole.placePiece(new Piece(3, 0), [x, 2])).toBeGreaterThan(0);
    const [ox, oy] = hole.offset;
    const planked = holePlanks(hole);
    // Opening a wood square elsewhere keeps the plank where it sat in the box.
    const grid = holeGrid(hole);
    const spot = [...Array(100).keys()].map((n) => [Math.floor(n / 10), n % 10] as [number, number]).find(([sx, sy]) => !grid[sx][sy])!;
    const reshaped = paintHole(board, 0, spot, true)!;
    expect(holePlanks(reshaped)).toEqual(planked);
    expect(reshaped.holeSquares).toBe(hole.holeSquares + 1);
    // Cutting the plank's square takes it out and leaves the square open.
    const cut = paintHole(board, 0, [x + ox, 2 + oy], true)!;
    expect(cut.tools).toHaveLength(0);
    expect(cut.holeSquares).toBe(cut.origSquares);
    // Filling a square under a plank takes it out too and makes the square wood.
    expect(cut.placePiece(new Piece(3, 0), [x + ox - cut.offset[0], 2 + oy - cut.offset[1]])).toBeGreaterThan(0);
    const filled = paintHole(board, 0, [x + ox, 2 + oy], false)!;
    expect(filled.tools).toHaveLength(0);
    expect(holeGrid(filled)[x + ox][2 + oy]).toBe(false);
  });

  it('shares planks in the holes as text', () => {
    const board = new CarpentryBoard(9);
    const hole = board.holes[3];
    hole.placePiece(new Piece(3, 0), [Math.trunc(hole.width / 2), 2]);
    const code = boardCode(board);
    expect(code).toMatch(/;3i10/);
    const copy = new CarpentryBoard(1);
    load(copy, readBoardCode(code)!);
    expect(boardCode(copy)).toBe(code);
    expect(copy.holes[3].holeSquares).toBe(hole.holeSquares);
    expect(copy.holes[3].piecesUsed).toBe(1);
    // Boards copied before planks were shared still read.
    expect(readBoardCode(code.split(';')[0])!.planks!.flat()).toEqual([]);
  });

  it('sizes painted holes by their squares', () => {
    const grid = Array.from({ length: MAX_HOLE }, (_, x) => Array.from({ length: MAX_HOLE }, (_, y) => x >= 3 && x < 6 && y < 4));
    const hole = shapeHole(grid, 7);
    expect(hole.size).toBe(2);
    expect(hole.holeSquares).toBe(12);
    // A solid block has nowhere to grow.
    expect(hole.knockouts).toBe(3);
    expect(hole.boxAt).toEqual([3, 0]);
    const grown = Array.from({ length: MAX_HOLE }, (_, x) => Array.from({ length: MAX_HOLE }, (_, y) => (x === 2 || x === 3) && y < 5 || x === 1 && y === 0));
    expect(shapeHole(grown, 7).size).toBe(2);
    expect(shapeHole(grown, 7).knockouts).toBe(1);
  });

  it('flags boards the game could not deal', () => {
    const board = new CarpentryBoard(5);
    expect(boardIssues(board, false)).toEqual([]);
    const grid = holeGrid(board.holes[1]);
    for (let x = 0; x < MAX_HOLE; x++) grid[x][9] = true;
    load(board, { holes: [holeGrid(board.holes[0]), grid, holeGrid(board.holes[2]), holeGrid(board.holes[3])], tools: [...board.toolbox] });
    expect(boardIssues(board, false).join(' ')).toContain('Top-right');
    setTool(board, 0, PUTTY_TOOL); setTool(board, 1, PUTTY_TOOL);
    expect(boardIssues(board, false).join(' ')).toContain('two putties');
    const ship = new CarpentryBoard(5, 2, -1);
    setTool(ship, 0, PUTTY_TOOL);
    expect(boardIssues(ship, true).join(' ')).toContain('no putty');
  });

  it('reads toolbox grain', () => {
    expect(toolFor(3, false)).toBe(6);
    expect(toolFor(3, true)).toBe(7);
    // I is always dealt with its grain across.
    expect(toolFor(1, false)).toBe(3);
    expect(readBoardCode('C' + '0'.repeat(100) + ':p0y1b1')!.tools).toEqual([6, 21, PUTTY_TOOL]);
    expect(readBoardCode('C' + '0'.repeat(99) + ':p0y1b1')).toBeNull();
  });

  it('lays out edited holes and toolbox in a game', () => {
    const game = new Game(3, new BoardRandom(3n), newStats(), { sound: () => {}, levelDone: () => {} }, null, new Random(3), 0);
    for (let t = 0; t < 3000; t += 16) game.update(t);
    const grid = holeGrid(game.board.holes[2]);
    grid[0][0] = !grid[0][0];
    expect(game.edit(() => { load(game.board, { holes: [holeGrid(game.board.holes[0]), holeGrid(game.board.holes[1]), grid, holeGrid(game.board.holes[3])], tools: [7, 7, 7] }); return true; })).toBe(true);
    expect(game.holeSprites.map((s) => s.hole)).toEqual(expect.arrayContaining(game.board.holes));
    expect(game.holeSprites).toHaveLength(4);
    expect(game.tools.map((t) => t!.piece.tool)).toEqual([7, 7, 7]);
  });
});
