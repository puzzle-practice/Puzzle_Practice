import { describe, expect, it } from 'vitest';
import { boardCode, boardIssues, CLEAR, load, paintStar, paintTarget, readBoardCode, setEntry, WILD } from './create';
import { DEFAULT_SETTINGS, NavigationGame, readSettings } from './game';
import { EMPTY } from './logic';

const ww = { ...DEFAULT_SETTINGS, mode: 'ww' as const, create: true };
const normal = { ...DEFAULT_SETTINGS, mode: 'normal' as const, create: true };

describe('navigation create', () => {
  it('round-trips dealt boards through text', () => {
    for (const settings of [ww, normal]) {
      const game = new NavigationGame(settings, 77);
      for (let i = 0; i < 6; i++) game.drop();
      const code = boardCode(game);
      const copy = new NavigationGame(settings, 1);
      load(copy, readBoardCode(code)!);
      expect(boardCode(copy)).toBe(code);
      expect(boardIssues(new NavigationGame(settings, 5), settings.mode === 'ww', settings.mode === 'ww')).toEqual([]);
    }
  });

  it('paints stars where they are put, floating until the next drop', () => {
    const game = new NavigationGame(normal, 3);
    game.board.cells.fill(EMPTY);
    expect(paintStar(game, 2, 0, 4)).toBe(true);
    expect(game.board.get(2, 0)).toBe(4);
    expect(game.board.get(2, 2)).toBe(EMPTY);
    expect(paintStar(game, 2, 0, 4)).toBe(false);
    expect(boardIssues(game, false, false)).toContain('Some stars are floating. They settle inward when you press Drop.');
    expect(paintStar(game, 2, 0, CLEAR)).toBe(true);
    expect(game.board.get(2, 0)).toBe(EMPTY);
    expect(boardIssues(game, false, false)).not.toContain('Some stars are floating. They settle inward when you press Drop.');
  });

  it('settles a painted board on the first Drop without dropping the incoming star', () => {
    const game = new NavigationGame(normal, 3);
    game.board.cells.fill(EMPTY);
    const entry = { ...game.entry };
    paintStar(game, 2, 0, 4);
    expect(game.unsettled).toBe(true);
    game.settle();
    expect(game.board.get(2, 2)).toBe(4);
    expect(game.board.get(2, 0)).toBe(EMPTY);
    expect(game.unsettled).toBe(false);
    expect(game.entry).toEqual(entry); expect(game.stars).toBe(0);
  });

  it('keeps a pasted board’s floating stars', () => {
    const game = new NavigationGame(normal, 3);
    game.board.cells.fill(EMPTY);
    paintStar(game, 1, 0, 2);
    const code = boardCode(game);
    const copy = new NavigationGame(normal, 4);
    load(copy, readBoardCode(code)!);
    expect(copy.board.get(1, 0)).toBe(2);
    expect(boardCode(copy)).toBe(code);
  });

  it('paints targets in the inner three rings', () => {
    const game = new NavigationGame(ww, 3);
    const before = game.targets.length;
    expect(paintTarget(game, 0, 0, 2)).toBe(false);
    const free = [0, 1, 2, 3, 4, 5, 6, 7].find((o) => !game.targets.some((t) => t.ring === 3 && t.octant === o))!;
    expect(paintTarget(game, free, 3, 2)).toBe(true);
    expect(game.targets).toHaveLength(before + 1);
    expect(paintTarget(game, free, 3, WILD)).toBe(true);
    expect(game.targets.find((t) => t.octant === free && t.ring === 3)!.wild).toBe(true);
    expect(paintTarget(game, free, 3, CLEAR)).toBe(true);
    expect(game.targets).toHaveLength(before);
  });

  it('flags boards the game could not deal', () => {
    const game = new NavigationGame(normal, 3);
    for (const o of [0, 1, 2]) paintStar(game, o, 2, 3);
    expect(boardIssues(game, false, false).join(' ')).toContain('in a row');
    const ww4 = new NavigationGame(ww, 4);
    paintTarget(ww4, ww4.targets[0].octant, ww4.targets[0].ring, CLEAR);
    expect(boardIssues(ww4, true, true).join(' ')).toContain('Old Dennav constellations');
    paintTarget(ww4, ww4.targets[0].octant, ww4.targets[0].ring, WILD);
    expect(boardIssues(ww4, true, false).join(' ')).toContain('Wild targets');
    setEntry(ww4, 0, 5);
    ww4.board.set(5, 0, 1);
    expect(boardIssues(ww4, true, true).join(' ')).toContain('nowhere to land');
  });

  it('rejects text that is not a board and reads old settings', () => {
    expect(readBoardCode('N3:...')).toBeNull();
    expect(readBoardCode(`N3:${'.'.repeat(24)}:300,300:00`)).toBeNull();
    expect(readSettings({ ...DEFAULT_SETTINGS, create: undefined })?.create).toBe(false);
  });
});
