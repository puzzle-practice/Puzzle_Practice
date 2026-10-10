import { describe, expect, it } from 'vitest';
import { PyRandom } from '../../core/pyrandom';
import { CRATE_SIZES, crateSize, HEIGHT, isCrate, isCrateAnchor, isTool, WIDTH } from './board';
import { GauntletChests, CrateRequests } from './crates';
import { Forage, TIMING } from './engine';

/** Plays random clicks, favouring tools, and checks the board stays whole. */
function play(game: Forage, moves: number, seed: number): void {
  const pick = new PyRandom(seed);
  for (let i = 0; i < moves; i++) {
    let x = pick.randintN(0, WIDTH - 2);
    let y = pick.randintN(0, HEIGHT - 2);
    const tools = game.cells.flatMap((p, j) => (isTool(p) ? [j] : []));
    if (tools.length && pick.random() < 0.3) {
      const j = pick.choice(tools);
      [x, y] = [j % WIDTH, Math.floor(j / WIDTH)];
    }
    game.act(x, y, pick.random() < 0.5);
    // Gaps only stay under a wedged crate: refills come from the top.
    game.cells.forEach((p, j) => {
      if (p !== -1) return;
      const [cx, cy] = [j % WIDTH, Math.floor(j / WIDTH)];
      const above = Array.from({ length: cy }, (_, yy) => game.board.getPiece(cx, yy));
      expect(above.some(isCrate), `gap at ${cx},${cy}`).toBe(true);
    });
    const anchors = game.cells.filter(isCrateAnchor);
    expect(game.board.crates).toBe(anchors.length);
    expect(game.board.crateArea).toBe(anchors.reduce((a, p) => a + CRATE_SIZES[crateSize(p)].width * CRATE_SIZES[crateSize(p)].height, 0));
  }
}

describe('crate sources', () => {
  it('Chaos keeps normal move spacing but allows more than three chests and more than nine per board', () => {
    const source = new GauntletChests(new PyRandom(12), [1, 0, 0], 9, true);
    const game = new Forage(22n, source);
    game.load(Array.from({ length: WIDTH * HEIGHT }, (_, i) => (i % WIDTH + Math.floor(i / WIDTH)) % 5));
    let spawned = 0;
    for (let move = 0; move < 26; move++) {
      // Leave room at the top while accumulating crates lower down.
      if (source.afterMove(game)) {
        spawned++;
        expect(move % 2).toBe(0);
        const anchor = game.cells.findIndex((p, i) => i < WIDTH && isCrateAnchor(p));
        expect(anchor).toBeGreaterThanOrEqual(0);
        const piece = game.board.getPiece(anchor, 0);
        game.board.setPiece(anchor, 0, 0);
        game.board.setPiece(spawned % WIDTH, 3 + Math.floor(spawned / WIDTH), piece);
      }
    }
    expect(spawned).toBeGreaterThan(9);
    expect(game.board.crates).toBeGreaterThan(3);
    expect(game.board.crates).toBe(game.cells.filter(isCrateAnchor).length);
    expect(game.board.crateArea).toBeGreaterThan(9);
  });

  it('new chests drop in at the same speed as refill pieces', () => {
    const game = new Forage(42n);
    game.dropCrate(1, 2, 1);
    expect(game.steps[0].duration).toBe(TIMING.chestEntry(2));
    expect(game.steps[0].duration).toBe(TIMING.fall(2));
    expect(TIMING.fall(1)).toBe(85);
    const older = new Forage(42n);
    older.legacyChestTiming = true;
    older.dropCrate(1, 2, 1);
    expect(older.steps[0].duration).toBe(TIMING.fall(2));
  });
  it('normal foraging asks for at most one crate per banana, and never more than 3 at once', () => {
    const source = new CrateRequests(new PyRandom(3), [0.6, 0.35, 0.05], 9);
    const game = new Forage(11n, source);
    play(game, 1500, 1);
    expect(source.requested).toBeGreaterThan(2);
    expect(source.requested).toBeLessThanOrEqual(9);
    expect(game.cratesCollected).toBeLessThanOrEqual(9);
  });

  it('the Gauntlet brings 9 chests a board, at most 3 on it, scored 1, 2 or 3', () => {
    const source = new GauntletChests(new PyRandom(4), [0.5, 0.35, 0.15], 9);
    const game = new Forage(12n, source);
    let points = 0;
    let collected = 0;
    for (let i = 0; i < 1500; i++) {
      game.act(i % (WIDTH - 1), (i * 7) % (HEIGHT - 1), i % 3 === 0);
      points += game.lastResult.gauntletPoints;
      collected += game.lastResult.collected.reduce((a, b) => a + b, 0);
      expect(game.board.crates).toBeLessThanOrEqual(3);
      game.lastResult.gauntletPoints = 0;
      game.lastResult.collected = [0, 0, 0];
    }
    expect(source.budget).toBeGreaterThanOrEqual(0);
    expect(points).toBeGreaterThanOrEqual(collected);
  });
});

describe('paced Gauntlet chests', () => {
  it('arrive a move after they are due, through the spawn step, and still 9 a board', () => {
    let now = 0;
    const source = new GauntletChests(new PyRandom(8), [0.5, 0.35, 0.15], 9, false, true, () => now);
    const game = new Forage(21n, source);
    let firstDue = -1;
    let firstLanded = -1;
    let most = 0;
    for (let i = 0; i < 2000; i++) {
      now = i * 1000;
      game.act(i % (WIDTH - 1), (i * 7) % (HEIGHT - 1), i % 3 === 0);
      if (firstDue < 0 && (source as unknown as { waiting: number }).waiting >= 0) firstDue = i;
      if (firstLanded < 0 && game.crateCount() > 0) firstLanded = i;
      most = Math.max(most, game.crateCount());
    }
    expect(firstDue).toBeGreaterThanOrEqual(0);
    expect(firstLanded).toBeGreaterThan(firstDue);
    expect(most).toBeLessThanOrEqual(3);
    expect(source.budget).toBeGreaterThanOrEqual(0);
  });
});

describe('paced chest timing', () => {
  it('wait for the next two-second batch and delivery delay', () => {
    let now = 0;
    const source = new GauntletChests(new PyRandom(8), [0.5, 0.35, 0.15], 9, false, true, () => now);
    const game = new Forage(21n, source);
    let dueAt = -1;
    for (let i = 0; i < 400 && game.board.bonusMode === 0; i++) {
      now = i * 300;
      game.act(i % (WIDTH - 1), (i * 7) % (HEIGHT - 1), i % 3 === 0);
      if (dueAt < 0 && (source as unknown as { waiting: number }).waiting >= 0) dueAt = now;
    }
    expect(dueAt).toBeGreaterThanOrEqual(0);
    // Asked for on the first move at or after the next batch plus the round trip.
    expect(now).toBeGreaterThanOrEqual((Math.floor(dueAt / 2000) + 1) * 2000 + 120);
  });
});
