import { describe, expect, it } from 'vitest';
import { PULLEYS, ROWS, TAR, WILD, rowSize } from './board';
import { DEFAULT_SETTINGS, RiggingGame, STEP, boardCode, cellAt, cellPos, dragAxis, indicatorStep, piecesForLevel, projection, readBoardCode, readSettings, slideFor } from './game';

const settings = (difficulty = 6, tokens = 0) => ({ ...DEFAULT_SETTINGS, difficulty, tokens });
/** A slide that pulls at least three pieces from the current board, found by trying each one on a copy. */
function productive(game: RiggingGame): [number, number, number, number] | null {
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < rowSize(y); x++) for (const dir of [0, 1, 2]) {
    const len = game.board.slidePoints(x, y, dir).length;
    for (let a = 1; a < len; a++) {
      const copy = new RiggingGame(game.settings, game.seed);
      copy.board.pieces = game.board.pieces.map(r => [...r]);
      copy.board.nextPulley = game.board.nextPulley;
      copy.board.slide(x, y, dir, a);
      const at = PULLEYS[copy.board.nextPulley], colour = copy.board.pieces[at.y][at.x] & 15;
      if (colour >= 8) continue;
      // Count the matching chain without disturbing the random sequence.
      const seen = new Set<string>([`${at.x},${at.y}`]), todo = [at];
      while (todo.length) {
        const p = todo.pop()!;
        for (const d of [4, 5, 6, 0, 1, 2]) {
          const n = copy.board.adjacent(p.x, p.y, d, false);
          if (!n || seen.has(`${n.x},${n.y}`)) continue;
          const t = copy.board.pieces[n.y][n.x] & 15;
          if (t === colour || t === 8 || t === 9 || t === 10) { seen.add(`${n.x},${n.y}`); todo.push(n); }
        }
      }
      if (seen.size >= 3) return [x, y, dir, a];
    }
  }
  return null;
}

describe('Rigging layout', () => {
  it('places pieces on the net and finds the piece under the pointer', () => {
    expect(cellPos({ x: 0, y: 0 })).toEqual([138, 143]);
    expect(cellPos({ x: 0, y: 4 })).toEqual([50, 295]);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < rowSize(y); x++) {
      const [px, py] = cellPos({ x, y });
      expect(cellAt(px + 10, py - 10)).toEqual({ x, y });
    }
    expect(cellAt(5, 5)).toBeNull();
  });
  it('turns a drag into whole places along the nearest rope, either way', () => {
    expect(dragAxis(50, 0)).toBe(1);
    expect(dragAxis(-20, 36)).toBe(0);
    expect(slideFor(1, projection(1, 2 * STEP + 10, 0))).toEqual({ dir: 5, amount: 2 });
    expect(slideFor(1, projection(1, -STEP, 0))).toEqual({ dir: 1, amount: 1 });
    expect(slideFor(2, projection(2, 5, 5)).amount).toBe(0);
  });
  it('uses the game’s level sizes and indicator curve', () => {
    expect([0, 1, 6, 9].map(piecesForLevel)).toEqual([20, 54, 189, 270]);
    expect(indicatorStep(0)).toBe(0);
    expect(indicatorStep(7.48)).toBe(19);
    expect(indicatorStep(8)).toBe(20);
  });
});

describe('Rigging game', () => {
  it('moves the cursor round its rope, then nudges and lets go of a selected rope', () => {
    const g = new RiggingGame(settings(), 7);
    g.key(1);
    expect(g.cursor).toEqual({ x: 4, y: 0 });
    g.select();
    expect(g.selecting).toBe(true);
    g.key(5); g.key(5);
    g.key(0);
    expect(g.preview?.axis).toBe(1);
    const before = g.board.cells();
    expect(g.select()).toBe(true);
    expect(g.moves).toBe(1);
    expect(g.board.cells()).not.toEqual(before);
    expect(g.selecting).toBe(false);
  });
  it('does not count a slide that comes back to where it started, or a cancelled one', () => {
    const g = new RiggingGame(settings(), 8);
    g.select(); g.key(5); g.key(1);
    expect(g.select()).toBe(false);
    g.select(); g.key(5); g.cancel();
    expect(g.selecting).toBe(false);
    expect(g.slide(0, 0, 5, 5)).toBe(false);
    expect(g.moves).toBe(0);
  });
  it('counts a slide that pulls nothing as a move without points', () => {
    const g = new RiggingGame(settings(), 9);
    const at = PULLEYS[0];
    g.board.pieces[at.y][at.x] = WILD;
    expect(g.slide(4, 8, 5, 1)).toBe(true);
    expect(g.lastMove).toEqual({ pieces: 0, points: 0, skipped: true, specials: [], maneuvers: [] });
    expect([g.moves, g.points, g.board.nextPulley, g.busy]).toEqual([1, 0, 1, false]);
  });
  it('scores a pull, animates it, and refills the board when the animation ends', () => {
    const g = new RiggingGame(settings(), 11);
    const move = productive(g)!;
    expect(g.slide(...move)).toBe(true);
    expect(g.lastMove!.pieces).toBeGreaterThanOrEqual(3);
    expect(g.points).toBe(g.lastMove!.points);
    expect(g.scenes.map(s => s.kind)).toContain('pull');
    expect(g.slide(...move)).toBe(false);
    g.settle();
    expect(g.busy).toBe(false);
    expect(g.board.cells()).not.toContain(-1);
  });
  it('pays 25 points for each wild the coils earn', () => {
    const run = (coils: number) => {
      const g = new RiggingGame(settings(), 12);
      g.board.cache = coils;
      g.slide(...productive(g)!);
      return g;
    };
    const plain = run(0), filled = run(19);
    expect(filled.points - plain.points).toBe(25);
    expect(filled.scenes.some(s => s.kind === 'cache')).toBe(true);
    expect(filled.earned.wild).toBeGreaterThanOrEqual(1);
  });
  it('deals a fresh board once enough pieces are pulled, keeping the difficulty', () => {
    const g = new RiggingGame(settings(0), 13);
    g.levelPieces = 19;
    g.slide(...productive(g)!);
    expect(g.scenes.at(-1)?.kind).toBe('level');
    const before = g.board;
    g.settle();
    expect(g.levels).toBe(1);
    expect(g.levelPieces).toBe(0);
    expect(g.board).not.toBe(before);
    expect(g.board.difficulty).toBe(0);
  });
  it('repeats the same session from the same seed and slides', () => {
    const play = () => {
      const g = new RiggingGame(settings(9, 2), 99);
      for (let i = 0; i < 40; i++) { const m = productive(g); if (!m) break; g.slide(...m); g.settle(); }
      return [g.points, g.moves, g.pieces, g.board.cells().join(), g.maneuvers];
    };
    expect(play()).toEqual(play());
  });
});

describe('Rigging Create mode', () => {
  const create = (seed = 21) => new RiggingGame({ ...DEFAULT_SETTINGS, mode: 'create' }, seed);
  it('paints any piece, shapes only on colours, and fills the board', () => {
    const g = create();
    expect(g.paint({ x: 0, y: 0 }, TAR)).toBe(true);
    expect(g.board.get({ x: 0, y: 0 })).toBe(TAR);
    expect(g.paint({ x: 1, y: 0 }, 3 | 2 << 4)).toBe(true);
    expect(g.paint({ x: 1, y: 0 }, WILD | 2 << 4)).toBe(false);
    expect(g.paint({ x: 5, y: 0 }, 1)).toBe(false);
    expect(g.paint({ x: 0, y: 0 }, 11)).toBe(false);
    g.fill(4);
    expect(new Set(g.board.cells())).toEqual(new Set([4]));
    expect(g.moves).toBe(0);
  });
  it('refuses to paint outside Create', () => {
    const g = new RiggingGame(settings(), 21), before = g.board.cells();
    expect(g.paint({ x: 0, y: 0 }, TAR)).toBe(false);
    g.fill(1);
    expect(g.load(boardCode(create().board))).toBe(false);
    expect(g.board.cells()).toEqual(before);
  });
  it('copies and pastes a board with its active pulley', () => {
    const a = create(3);
    a.paint({ x: 2, y: 4 }, 5 | 7 << 4);
    a.nextPulley(); a.nextPulley();
    const code = boardCode(a.board);
    expect(code).toMatch(/^R2[0-9a-f]{122}$/);
    expect(readBoardCode(code)?.cells).toEqual(a.board.cells());
    expect(readBoardCode('R2zz')).toBeNull();
    const b = create(4);
    expect(b.load(`  ${code}\n`)).toBe(true);
    expect([b.board.cells(), b.board.nextPulley]).toEqual([a.board.cells(), 2]);
  });
  it('deals the next board on Generate and never levels up by itself', () => {
    const g = create(13), first = g.board.cells();
    g.generate();
    expect(g.board.cells()).not.toEqual(first);
    g.levelPieces = 1000;
    g.slide(...productive(g)!);
    g.settle();
    expect(g.levels).toBe(0);
    expect(g.scenes.some(s => s.kind === 'level')).toBe(false);
  });
  it('reads settings saved before Create existed as Normal', () => {
    const { mode: _, ...old } = DEFAULT_SETTINGS;
    expect(readSettings(old)?.mode).toBe('normal');
    expect(readSettings({ ...DEFAULT_SETTINGS, mode: 'sandbox' })).toBeNull();
  });
});
