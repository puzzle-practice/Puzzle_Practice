import { describe, expect, it } from 'vitest';
import { BilgingGame, DEFAULT_SETTINGS } from './bilging/game';
import { LEVEL_POINTS } from './bilging/board';
import { CarpentryBoard } from './vampire-carp/board';
import { AlchemyBoard } from './alchemistry/logic';
import { ShipBoard } from './shipwrightery/logic';

describe('independent puzzle streams', () => {
  it('Bilging boards diverge through different moves and match again after a level reset', () => {
    const settings = { ...DEFAULT_SETTINGS, difficulty: 2, tokens: 0 };
    const a = new BilgingGame(settings, 99), b = new BilgingGame(settings, 99);
    for (let i = 0; i < 10; i++) { a.swap(i % 5, (i * 7) % 12); a.settle(); }
    expect(a.board.cells).not.toEqual(b.board.cells);
    for (const g of [a, b]) {
      g.levelPoints = LEVEL_POINTS[2] - 1;
      g.board.set(0, 0, 1); g.board.set(1, 0, 0); g.board.set(2, 0, 0); g.board.set(0, 1, 0);
      g.swap(0, 0); g.settle(); expect(g.levels).toBe(1);
    }
    expect(a.board.cells).toEqual(b.board.cells);
    expect(a.board.cells).not.toEqual(new BilgingGame(settings, 99).board.cells);
  });
  it('Carpentry tool draws survive extra hole generation, neglect and token randomness', () => {
    const a = new CarpentryBoard(42, 8, 5, 1, -1, true), b = new CarpentryBoard(42, 8, 5, 1, -1, true);
    for (let i = 0; i < 50; i++) {
      b.getNextHole(true); b.pieceWillApply(i % 4); b.rng.nextInt(100);
      a.populateNextTool(i % 3); b.populateNextTool(i % 3);
      expect(b.toolbox).toEqual(a.toolbox); expect(b.toolTokens).toEqual(a.toolTokens);
    }
  });
  it('Carpentry hole draws survive extra piece draws', () => {
    const a = new CarpentryBoard(42, 5, -1, 1, -1, true), b = new CarpentryBoard(42, 5, -1, 1, -1, true);
    for (let i = 0; i < 30; i++) {
      for (let j = 0; j < i; j++) b.populateNextTool(j % 3);
      expect(b.getNextHole(true).dump()).toEqual(a.getNextHole(true).dump());
    }
  });
  it('Alchemy bottle sequences are independent of piece refills and other columns', () => {
    const a = new AlchemyBoard(6, 42, true), b = new AlchemyBoard(6, 42, true);
    for (let i = 0; i < 30; i++) {
      b.nextPiece(); b.nextBottle(3);
      expect(b.nextBottle(2).required).toEqual(a.nextBottle(2).required);
    }
  });
  it('Shipwrightery pattern randomness is independent of material draws', () => {
    const a = new ShipBoard(5, 42, 20, true), b = new ShipBoard(5, 42, 20, true);
    for (let i = 0; i < 100; i++) b.random.nextInt(5);
    expect(Array.from({ length: 30 }, () => b.patternRandom.nextInt(1000))).toEqual(Array.from({ length: 30 }, () => a.patternRandom.nextInt(1000)));
  });
});
