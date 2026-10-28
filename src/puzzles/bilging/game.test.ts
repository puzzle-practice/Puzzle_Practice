import { describe, expect, it } from 'vitest';
import { BilgeBoard, CRAB, EMPTY, JELLY, LEVEL_POINTS, PUFFER, WIDTH, HEIGHT } from './board';
import {
  BilgingGame, DEFAULT_SETTINGS, Performance, SWAP_DRY_MS, SWAP_WET_MS, boardCode, boardIssues, indicatorStep, readBoardCode, readSettings, riseDuration, withToken,
} from './game';

/** A board with no runs anywhere: colours cycle so no three neighbours match. */
function quiet(g: BilgingGame): void {
  g.board = new BilgeBoard(1, g.settings.difficulty, g.settings.tokens, false);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) g.board.set(x, y, (x + 2 * y) % 4);
}

describe('Bilging swaps and cascades', () => {
  it('refuses to move crabs and lets equal pieces trade places without a move', () => {
    const g = new BilgingGame({ ...DEFAULT_SETTINGS, difficulty: 9 }, 3); quiet(g);
    g.board.set(0, 0, CRAB);
    expect(g.swap(0, 0)).toBe('crab'); expect(g.moves).toBe(0); expect(g.busy).toBe(false);
    g.board.set(2, 0, 1); g.board.set(3, 0, 1);
    expect(g.swap(2, 0)).toBe(true); expect(g.moves).toBe(0); expect(g.busy).toBe(true);
  });
  it('swaps quicker above the water than below it', () => {
    const g = new BilgingGame({ ...DEFAULT_SETTINGS, water: 5 }, 3); quiet(g);
    g.swap(0, 4); expect(g.scenes[0].duration).toBe(SWAP_WET_MS); g.settle();
    g.swap(0, 5); expect(g.scenes[0].duration).toBe(SWAP_DRY_MS);
  });
  it('bursts a puffer through its 3×3 neighbourhood and scores a point per piece', () => {
    const g = new BilgingGame({ ...DEFAULT_SETTINGS, difficulty: 9, tokens: 0 }, 3); quiet(g);
    g.board.set(3, 5, PUFFER);
    g.swap(2, 5);
    expect(g.lastMove!.chain).toBeGreaterThanOrEqual(1);
    expect(g.scenes.find(s => s.kind === 'clear')!.cleared).toHaveLength(8);
    g.settle();
    expect(g.puffers).toBe(1); expect(g.points).toBe(g.lastMove!.points); expect(g.points).toBeGreaterThanOrEqual(8);
  });
  it('lets a jelly clear every piece of the colour it is swapped with', () => {
    const g = new BilgingGame({ ...DEFAULT_SETTINGS, difficulty: 9, tokens: 0 }, 3); quiet(g);
    g.board.set(0, 0, JELLY);
    const colour = g.board.get(1, 0), count = g.board.cells.filter(p => p === colour).length;
    g.swap(0, 0);
    expect(g.scenes[0].kind).toBe('jelly'); expect(g.scenes[0].cleared).toHaveLength(count);
    g.settle(); expect(g.jellies).toBe(1);
  });
  it('lets crabs go once they float above the water and pays five points per flooded row', () => {
    const g = new BilgingGame({ ...DEFAULT_SETTINGS, difficulty: 9, tokens: 0, water: 7 }, 3); quiet(g);
    g.board.set(4, 8, CRAB); g.board.set(4, 2, CRAB);
    g.swap(0, 0);
    expect(g.lastMove).toMatchObject({ crabs: 1, points: 35 });
    g.settle();
    // The lower crab floats up into the gap but stays under water.
    expect(g.crabs).toBe(1); expect(g.board.get(4, 3)).toBe(CRAB);
  });
  it('completes a token when the lower half sits beneath its upper half', () => {
    const g = new BilgingGame({ ...DEFAULT_SETTINGS, tokens: 1 }, 3); quiet(g);
    g.board.set(5, 3, g.board.get(5, 3) | 2 << 5); g.board.set(5, 4, g.board.get(5, 4) | 16 | 2 << 5);
    g.swap(0, 0); g.settle();
    expect(g.tokenCounts[2]).toBe(1); expect(g.board.get(5, 3) & 240).toBe(0);
  });
  it('rises at 85.7 ms a row and banks the move after the last animation', () => {
    expect(riseDuration(1)).toBeCloseTo(85.714, 2);
    const g = new BilgingGame({ ...DEFAULT_SETTINGS, difficulty: 0, tokens: 0 }, 3); quiet(g);
    g.board.set(0, 0, 1); g.board.set(1, 0, 0); g.board.set(2, 0, 0); g.board.set(0, 1, 0);
    expect(g.swap(0, 0)).toBe(true);
    expect(g.points).toBe(0);
    g.settle();
    expect(g.points).toBe(g.lastMove!.points); expect(g.points).toBeGreaterThan(0);
  });
  it('deals a fresh board at the same difficulty after a level-up', () => {
    const g = new BilgingGame({ ...DEFAULT_SETTINGS, difficulty: 2 }, 3); quiet(g);
    g.levelPoints = LEVEL_POINTS[2] - 1;
    g.board.set(0, 0, 1); g.board.set(1, 0, 0); g.board.set(2, 0, 0); g.board.set(0, 1, 0);
    g.swap(0, 0);
    expect(g.scenes.at(-1)!.kind).toBe('level');
    g.settle();
    expect(g.levels).toBe(1); expect(g.levelPoints).toBe(0); expect(g.board.difficulty).toBe(2);
    expect(g.board.cells.every(p => p !== EMPTY)).toBe(true);
  });
  it('repeats a session from the same seed', () => {
    const play = () => {
      const g = new BilgingGame({ ...DEFAULT_SETTINGS, difficulty: 8, tokens: 2 }, 99);
      for (let i = 0; i < 60; i++) { g.swap(i % 5, (i * 7) % 12); g.settle(); }
      return [g.points, g.moves, g.board.cells.join()];
    };
    expect(play()).toEqual(play());
  });
});

describe('Bilging settings and indicator', () => {
  it('validates stored settings', () => {
    expect(readSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ ...DEFAULT_SETTINGS, water: 10 })).toBeNull();
    expect(readSettings({ ...DEFAULT_SETTINGS, tokens: 3 })).toBeNull();
  });
  it('uses the game default threshold curve', () => {
    expect(indicatorStep(0)).toBe(0); expect(indicatorStep(2.4)).toBe(1); expect(indicatorStep(8.5)).toBe(20);
    expect(indicatorStep(4.2, 16.8)).toBe(1);
    const p = new Performance(); p.add(30, 5); expect(p.value).toBe(6); p.advance(180000); expect(p.value).toBe(0);
  });
});

describe('Bilging Create mode', () => {
  const create = (seed = 21, extra = {}) => new BilgingGame({ ...DEFAULT_SETTINGS, mode: 'create', ...extra }, seed);
  it('paints any piece, token halves only on colours, and fills the board', () => {
    const g = create();
    expect(g.paint(0, 0, CRAB)).toBe(true);
    expect(g.board.get(0, 0)).toBe(CRAB);
    expect(g.paint(1, 0, withToken(3, 2, 1))).toBe(true);
    expect(g.board.get(1, 0)).toBe(3 | 1 << 4 | 2 << 5);
    expect(withToken(PUFFER, 2, 1)).toBe(PUFFER);
    expect(g.paint(1, 0, PUFFER | 2 << 5)).toBe(false);
    expect(g.paint(WIDTH, 0, 1)).toBe(false);
    expect(g.paint(0, 0, EMPTY)).toBe(false);
    g.fill(JELLY);
    expect(new Set(g.board.cells)).toEqual(new Set([JELLY]));
    expect(g.moves).toBe(0);
  });
  it('refuses to paint outside Create', () => {
    const g = new BilgingGame(DEFAULT_SETTINGS, 21), before = [...g.board.cells];
    expect(g.paint(0, 0, CRAB)).toBe(false);
    g.fill(1);
    expect(g.load(boardCode(create().board))).toBe(false);
    g.generate();
    expect(g.board.cells).toEqual(before);
  });
  it('changes the water level in Freeplay only', () => {
    const g = create(), normal = new BilgingGame({ ...DEFAULT_SETTINGS }, 21);
    expect(g.setWater(7)).toBe(true);
    expect(g.settings.water).toBe(7);
    expect(g.dry).toBe(true);
    expect(g.setWater(7)).toBe(false);
    expect(g.setWater(10)).toBe(false);
    expect(normal.setWater(7)).toBe(false);
    expect(normal.settings.water).toBe(3);
  });
  it('copies and pastes a board', () => {
    const a = create(3);
    a.paint(2, 4, withToken(5, 7, 0));
    const code = boardCode(a.board);
    expect(code).toMatch(new RegExp(`^B[0-9a-f]{${WIDTH * HEIGHT * 2}}$`));
    expect(readBoardCode(code)).toEqual(a.board.cells);
    expect(readBoardCode('Bzz')).toBeNull();
    expect(readBoardCode('B' + 'ff'.repeat(WIDTH * HEIGHT))).toBeNull();
    const b = create(4);
    expect(b.load(`  ${code}\n`)).toBe(true);
    expect(b.board.cells).toEqual(a.board.cells);
  });
  it('deals the next board on Generate and never levels up by itself', () => {
    const g = create(13), first = [...g.board.cells];
    g.generate();
    expect(g.board.cells).not.toEqual(first);
    quiet(g);
    g.levelPoints = LEVEL_POINTS[g.settings.difficulty];
    g.board.set(3, 5, PUFFER);
    g.swap(2, 5); g.settle();
    expect(g.points).toBeGreaterThan(0);
    expect(g.levels).toBe(0);
  });
  it('names what the game could not deal', () => {
    const g = create(5, { difficulty: 1, tokens: 0, water: 3 });
    quiet(g);
    expect(boardIssues(g.board, g.settings)).toEqual([]);
    g.board.set(0, 0, 6); g.board.set(1, 0, PUFFER); g.board.set(2, 5, CRAB); g.board.set(3, 0, JELLY); g.board.set(4, 0, withToken(1, 1, 0));
    const issues = boardIssues(g.board, g.settings).join(' ');
    for (const words of ['first 5 colours', 'Puffers', 'Crabs', 'Jellyfish', 'above the water', 'Tokens on']) expect(issues).toContain(words);
    quiet(g);
    g.board.set(0, 0, 1); g.board.set(1, 0, 1); g.board.set(2, 0, 1);
    expect(boardIssues(g.board, g.settings)[0]).toContain('line of three');
  });
  it('reads settings saved before Create existed as Normal', () => {
    const { mode: _, ...old } = DEFAULT_SETTINGS;
    expect(readSettings(old)?.mode).toBe('normal');
    expect(readSettings({ ...DEFAULT_SETTINGS, mode: 'sandbox' })).toBeNull();
  });
});
