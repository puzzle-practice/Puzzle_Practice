import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, NavigationGame, boardSeed, playableSettings, readSettings, settingsKey } from './game';

const counts = (game: NavigationGame) => [1, 2, 3].map((r) => game.targets.filter((t) => t.ring === game.board.rings - r).length);

describe('Dennav dense opening setting', () => {
  it.each([false, true])('starts fresh, dismissed, booched and Freeplay boards at 3/2/1, extraRing=%s', (extraRing) => {
    const settings = { ...DEFAULT_SETTINGS, extraRing, startDense: true };
    for (const create of [false, true]) for (const opening of [false, true]) {
      const game = new NavigationGame({ ...settings, create }, boardSeed(42, opening ? 0 : 1), undefined, opening);
      expect(counts(game)).toEqual([3, 2, 1]);
      game.targets = game.board.nextConstellation();
      expect(counts(game)).toEqual([3, 2, 1]);
    }
  });

  it('retains current Dennav charging rules with a dense opening', () => {
    const game = new NavigationGame({ ...DEFAULT_SETTINGS, startDense: true }, 42);
    game.targets = [{ octant: 0, ring: 3, colour: 2, wild: false }];
    game.board.set(1, 3, 2);
    for (const o of [2, 3, 4]) game.board.set(o, 3, 1);
    game.board.nextConstellation = () => [{ octant: 5, ring: 3, colour: 3, wild: false }];
    expect(game.rotate(3, true).flatMap((s) => s.clear ? [s.clear.kind] : [])).toEqual(['target', 'run']);
    expect(game.targets[0].wild).toBe(true);
  });

  it('validates and saves the setting without adding fields to older replay settings', () => {
    expect(readSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ ...DEFAULT_SETTINGS, startDense: false })).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ ...DEFAULT_SETTINGS, startDense: true })).toEqual({ ...DEFAULT_SETTINGS, startDense: true });
    expect(readSettings({ ...DEFAULT_SETTINGS, startDense: 'yes' })).toBeNull();
    expect(counts(new NavigationGame(DEFAULT_SETTINGS, 42))).toEqual([1, 2, 1]);
    expect(counts(new NavigationGame({ ...DEFAULT_SETTINGS, mode: 'normal', startDense: true }, 42)))
      .toEqual(counts(new NavigationGame({ ...DEFAULT_SETTINGS, mode: 'normal' }, 42)));
  });

  it('keeps dense-start scores separate while preserving existing history keys', () => {
    const key = settingsKey(DEFAULT_SETTINGS);
    expect(key).toBe('ww-test:4:4:1:120000');
    expect(settingsKey({ ...DEFAULT_SETTINGS, startDense: true })).toBe(key + ':321');
    expect(settingsKey({ ...DEFAULT_SETTINGS, startDense: false })).toBe(key);
  });

  it('migrates a saved Old Dennav selection while leaving legacy replay rules readable', () => {
    const old = { ...DEFAULT_SETTINGS, mode: 'ww' as const };
    expect(playableSettings(old)).toEqual({ ...old, mode: 'ww-test', startDense: true });
    expect(playableSettings(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS);
    expect(readSettings(old)).toEqual(old);
  });
});
