import { expect, it } from 'vitest';
import { stateHash, stateText } from '../../core/replay';
import { DEFAULT_SETTINGS, NavigationGame } from './game';

// Generated with origin/main 04d5742 before WW (Test). Existing replay checks hash all
// enumerable game state, so even adding an unused field to an old mode would cause drift.
it.each([
  ['normal', false, false, 2656969811, 3597063641],
  ['normal', false, true, 2722441832, 3219714616],
  ['normal', true, false, 1343942910, 2123248990],
  ['normal', true, true, 623226339, 1741686217],
  ['ww', false, false, 514638574, 1355428442],
  ['ww', false, true, 4236706538, 3229514544],
  ['ww', true, false, 1307563427, 519487721],
  ['ww', true, true, 940347113, 455033445],
] as const)('preserves public %s replay fingerprints, extraRing=%s wildTargets=%s', (mode, extraRing, wildTargets, initial, final) => {
  const game = new NavigationGame({ ...DEFAULT_SETTINGS, mode, extraRing, wildTargets }, 42);
  expect(stateHash(stateText(game))).toBe(initial);
  for (let i = 0; i < 24; i++) {
    if (i % 3 === 0) game.rotate(game.board.rings - 1, true);
    else game.drop();
  }
  expect(stateHash(stateText(game))).toBe(final);
});
