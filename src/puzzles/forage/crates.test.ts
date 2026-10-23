import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { CRATE_SIZES, crateSize, HEIGHT, isCrate, isCrateAnchor, isTool, SHOVEL, WIDTH } from './board';
import { GauntletChests, CrateRequests, CURSED_TILES, WEREWOLF_TILES } from './crates';
import { Forage, TIMING } from './engine';

/** Plays random clicks, favouring tools, and checks the board stays whole. */
function play(game: Forage, moves: number, seed: number): void {
  const pick = new Random(seed);
  for (let i = 0; i < moves; i++) {
    let x = pick.integer(0, WIDTH - 2);
    let y = pick.integer(0, HEIGHT - 2);
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
    const source = new GauntletChests(new Random(12), [1, 0, 0], 9, true);
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
    const source = new CrateRequests(new Random(3), [0.6, 0.35, 0.05], 9);
    const game = new Forage(11n, source);
    play(game, 1500, 1);
    expect(source.requested).toBeGreaterThan(2);
    expect(source.requested).toBeLessThanOrEqual(9);
    expect(game.cratesCollected).toBeLessThanOrEqual(9);
  });

  it('the Gauntlet brings 9 chests a board, at most 3 on it, scored 1, 2 or 3', () => {
    const source = new GauntletChests(new Random(4), [0.5, 0.35, 0.15], 9);
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
  it('keeps delivery, crate sizes and scoring the same when only Werewolf art changes', () => {
    let now = 0;
    const normalSource = new GauntletChests(new Random(8), [0.5, 0.35, 0.15], 9, false, true, () => now, true, true);
    const artSource = new GauntletChests(new Random(8), [0.5, 0.35, 0.15], 9, false, true, () => now, true, true);
    const normal = new Forage(21n, normalSource);
    const art = new Forage(21n, artSource, 8, false, true);
    // Exclude monkey throws, whose presentation intentionally differs.
    normal.board.allowed = art.board.allowed = [true, true, false, true, true];
    let collected = 0;
    const clicks = new Random(77);
    for (let i = 0; i < 1500; i++) {
      now = i * 1000;
      let x = clicks.integer(0, WIDTH - 2);
      let y = clicks.integer(0, HEIGHT - 2);
      const tools = normal.cells.flatMap((p, j) => isTool(p) ? [j] : []);
      if (tools.length && clicks.random() < 0.3) {
        const j = clicks.choice(tools);
        [x, y] = [j % WIDTH, Math.floor(j / WIDTH)];
      }
      const ccw = clicks.random() < 0.5;
      for (const game of [normal, art]) game.act(x, y, ccw);
      expect(art.cells).toEqual(normal.cells);
      expect(art.lastResult).toEqual(normal.lastResult);
      expect(artSource.budget).toBe(normalSource.budget);
      collected = normal.cratesCollected;
      for (let size = 0; size < 3; size++) {
        if (normal.crateArt[size] === CURSED_TILES[size]) expect(art.crateArt[size]).toBe(WEREWOLF_TILES[size]);
      }
    }
    expect(collected).toBeGreaterThan(0);
    expect(collected).toBeLessThanOrEqual(9);
  });

  it('arrive a move after they are due, through the spawn step, and still 9 a board', () => {
    let now = 0;
    const source = new GauntletChests(new Random(8), [0.5, 0.35, 0.15], 9, false, true, () => now);
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
  describe.each(['normal', 'gauntlet', 'werewolf'] as const)('overlapping delay: %s', (mode) => {
    function setup(size = 0, delayMs = 1000) {
      let now = 0;
      const weights: [number, number, number] = [0, 0, 0];
      weights[size] = 1;
      const source = mode === 'normal'
        ? new CrateRequests(new Random(8), weights, 9, true, () => now, true, delayMs)
        : new GauntletChests(new Random(8), weights, 9, false, true, () => now, true, true, delayMs);
      const game = new Forage(21n, source, 8, false, mode === 'werewolf');
      game.board.allowed = [false, false, false, false, false];
      game.load(Array.from({ length: WIDTH * HEIGHT }, (_, i) => (i % WIDTH + 2 * Math.floor(i / WIDTH)) % 5));
      let clicks = 0;
      const click = (at: number) => {
        now = at;
        expect(game.act(0, HEIGHT - 2, ++clicks % 2 === 0)).toBe('moved');
      };
      const requested = () => source instanceof CrateRequests ? source.requested : 9 - source.budget;
      return { game, source, click, requested, time: (at: number) => { now = at; } };
    }

    it.each([0, 1, 2])('click, click, wait guarantees the first size %s chest on click three on a clear board', (size) => {
      const { game, click, time, requested } = setup(size);
      click(10000);
      click(10200);
      expect(requested()).toBe(0);
      time(11000);
      expect(game.crateCount()).toBe(0); // Time alone never spawns a chest.
      click(11000);
      expect(requested()).toBe(1);
      expect(game.crateCount()).toBe(1);
    });

    it.each([1000, 2000])('delivers exactly at the %s ms threshold, preserving historical delays', (delayMs) => {
      const { game, click, requested } = setup(0, delayMs);
      click(100);
      click(100 + delayMs - 1);
      expect(requested()).toBe(0);
      click(100 + delayMs);
      expect(requested()).toBe(1);
      expect(game.crateCount()).toBe(1);
    });

    it('starts each later delay on the first fresh click and can spawn chest two on click five', () => {
      const { game, click, requested } = setup();
      click(100);
      click(300);
      click(1100);
      expect(game.crateCount()).toBe(1);
      click(3000); // First fresh click starts the next delay.
      expect(requested()).toBe(1);
      click(4000); // Second fresh click counts and delivers on this same move.
      expect(requested()).toBe(2);
      expect(game.crateCount()).toBe(2);
    });

    it('does not let a long idle period after spawning replace the fresh clicks or their delay', () => {
      const { click, requested } = setup();
      click(100);
      click(2100);
      expect(requested()).toBe(1);
      click(20000);
      click(20100);
      expect(requested()).toBe(1);
      click(22000);
      expect(requested()).toBe(2);
    });

    it('keeps a blocked delivery pending without counting its retry clicks toward the next chest', () => {
      const { game, click, requested } = setup();
      for (let x = 0; x < WIDTH; x++) game.board.setPiece(x, 0, SHOVEL);
      click(100);
      click(2100);
      click(5000);
      expect(requested()).toBe(1);
      expect(game.crateCount()).toBe(0);
      for (let x = 0; x < WIDTH; x++) game.board.setPiece(x, 0, x % 5);
      click(8000);
      expect(game.crateCount()).toBe(1);
      click(10000);
      expect(requested()).toBe(1);
      click(12000);
      expect(requested()).toBe(2);
    });

    it('does not count illegal or identical rotations as fresh clicks', () => {
      const { game, click, time, requested } = setup();
      time(100);
      expect(game.act(-1, -1, false)).toBe('illegal');
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) game.board.setPiece(x, y, 1);
      expect(game.act(0, 0, false)).toBe('same');
      click(5000);
      expect(requested()).toBe(0);
      click(7000);
      expect(requested()).toBe(1);
    });
  });

  it('wait for the next two-second batch and delivery delay', () => {
    let now = 0;
    const source = new GauntletChests(new Random(8), [0.5, 0.35, 0.15], 9, false, true, () => now);
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

describe('paced Normal crates', () => {
  it('asks two moves after the last request, waits for the two-second batch, then arrives with the next move', () => {
    let now = 0;
    const source = new CrateRequests(new Random(3), [1, 0, 0], 9, true, () => now);
    const game = new Forage(5n, source);
    const turn = () => { game.act(0, 8, false); };
    now = 100; turn();
    expect(game.board.bonusMode).toBe(0);
    now = 300; turn();
    // Asked for at 300ms: it goes with the batch at 2s and reaches the board 120ms later.
    expect(game.board.bonusMode & 64).toBe(0);
    now = 2100; source.beforeMove(game);
    expect(game.board.bonusMode).toBe(0);
    now = 2120; source.beforeMove(game);
    expect(game.board.bonusMode & 64).toBe(64);
    expect(source.requested).toBe(1);
  });

  it('unpaced (older replays) asks before every move with room', () => {
    const source = new CrateRequests(new Random(3), [1, 0, 0], 9);
    const game = new Forage(5n, source);
    source.beforeMove(game);
    expect(game.board.bonusMode & 64).toBe(64);
  });
});

describe('Gauntlet chests in a blocked column', () => {
  it('try another column on each later move until one is clear', () => {
    const source = new GauntletChests(new Random(8), [1, 0, 0], 9, true, false, () => 0, true);
    const game = new Forage(9n, source);
    // Every top cell is a tool but one: the chest has to keep looking.
    const free = 4;
    game.load(Array.from({ length: WIDTH * HEIGHT }, (_, i) => i < WIDTH && i !== free ? SHOVEL : (i % WIDTH + Math.floor(i / WIDTH)) % 5));
    const columns = new Set<number>();
    let landed = -1;
    for (let move = 0; move < 60 && landed < 0; move++) {
      columns.add((source as unknown as { column: number }).column);
      if (source.afterMove(game)) landed = game.cells.findIndex((p, i) => i < WIDTH && isCrateAnchor(p));
    }
    expect(landed).toBe(free);
    expect(columns.size).toBeGreaterThan(1);
  });
});
