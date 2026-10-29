import { describe, expect, it } from 'vitest';
import parity from './werewolf-parity.json';
import { EMPTY, ForageBoard, HEIGHT, makeAnts, makeCrate, WIDTH } from './board';
import { Forage } from './engine';
import { MoonField, WerewolfForageBoard } from './werewolf';

describe('Werewolf parity with test build 20261017062155', () => {
  // The Java harness uses the test game's own board, scorer, dropper and moon helpers.
  for (const fixture of parity) {
    it(`seed ${fixture.seed}, difficulty ${fixture.difficulty}: 200 moves`, () => {
      let bonus = 0;
      const game = new Forage(BigInt(fixture.seed), { beforeMove: (g) => { if (bonus) g.board.bonusMode = bonus; } }, fixture.difficulty, true);
      // The test build keeps incoming crates off moons.
      game.moons!.blocksCrates = true;
      const moons = () => game.moons!.active.map((m) => [m.id, m.x, m.y, m.phase, m.charge]);
      expect(game.cells).toEqual(fixture.start);
      expect(moons()).toEqual(fixture.startMoons);
      fixture.moves.forEach((move, i) => {
        game.steps = [];
        bonus = move.bonus;
        const outcome = game.act(move.x, move.y, move.ccw);
        const where = `move ${i} at (${move.x},${move.y})`;
        expect(outcome, where).toBe(move.outcome);
        if (outcome === 'moved') {
          expect(game.lastResult.points, where).toBe(move.points);
          expect(game.lastResult.combo, where).toBe(move.combo);
        }
        expect(moons(), where).toEqual(move.moons);
        expect([game.board.crates, game.board.crateArea, game.board.bonusMode, game.cratesCollected], where).toEqual([
          move.crates, move.area, move.pending, move.collected,
        ]);
        if ('board' in move) expect(game.cells, where).toEqual(move.board);
      });
    });
  }
});

describe('Werewolf moons', () => {
  it.each([1, 2] as const)('caps automatic moons at %s and replaces expired moons', (limit) => {
    const game = new Forage(42, {}, 8, true, false, false, limit);
    const moons = game.moons!;
    const ids = new Set(moons.active.map((moon) => moon.id));
    let most = moons.active.length;
    let expired = 0;
    for (let move = 0; move < 20; move++) {
      moons.noteCleared(0, 0);
      expired += moons.endMove(game.board).expired.length;
      most = Math.max(most, moons.active.length);
      expect(moons.active.length).toBeLessThanOrEqual(limit);
      for (const moon of moons.active) ids.add(moon.id);
      if (moons.active.length === limit) expect(moons.spawn(game.board)).toBeNull();
    }
    expect(most).toBe(limit);
    expect(expired).toBeGreaterThan(0);
    expect(ids.size).toBeGreaterThan(limit);
  });

  it('allows art without moons, and moons with the original monkey presentation', () => {
    const normal = new Forage(42);
    const artOnly = new Forage(42, {}, 8, false, true);
    expect(artOnly.cells).toEqual(normal.cells);
    expect(artOnly.moons).toBeNull();
    const moonsOnly = new Forage(42, {}, 8, true, false);
    expect(moonsOnly.moons!.active).toHaveLength(1);
    for (const game of [artOnly, moonsOnly]) {
      game.load(Array.from({ length: WIDTH * HEIGHT }, (_, i) => (i % WIDTH + 2 * Math.floor(i / WIDTH)) % 5));
      game.board.setPiece(0, 0, 7);
      game.act(0, 0, true);
    }
    expect(artOnly.steps.some((s) => s.wolf)).toBe(true);
    expect(artOnly.steps.every((s) => !s.monkey.length)).toBe(true);
    expect(moonsOnly.steps.every((s) => !s.wolf)).toBe(true);
    expect(moonsOnly.steps.some((s) => s.monkey.length)).toBe(true);
  });

  it('starts with the same fruit as Normal, then draws the first moon from the board RNG', () => {
    const normal = new ForageBoard(42);
    const wolf = new WerewolfForageBoard(42);
    expect(wolf.cells).toEqual(normal.cells);
    expect(wolf.moons.active).toHaveLength(1);
    expect(wolf.moons.active[0]).toMatchObject({ phase: 4, charge: 0 });
  });

  it('counts repeated clears in the 2x2, while ants do not age moons', () => {
    const board = new ForageBoard(1);
    const moons = new MoonField();
    moons.active.push({ id: 1, x: 2, y: 3, phase: 4, charge: 0 });
    moons.noteEaten(2, 3);
    moons.endMove(board);
    expect(moons.active[0]).toMatchObject({ phase: 4, charge: 1 });
    for (let i = 0; i < 3; i++) moons.noteCleared(2, 3);
    expect(moons.takeCharged()).toMatchObject({ id: 1, charge: 4 });
  });

  it('only ages on moves that clear pieces, and ages once for a whole cascade', () => {
    const board = new ForageBoard(1);
    const moons = new MoonField();
    moons.active.push({ id: 1, x: 2, y: 3, phase: 4, charge: 0 });
    for (let i = 0; i < 8; i++) moons.endMove(board);
    expect(moons.active[0].phase).toBe(4);
    for (let i = 0; i < 10; i++) moons.noteCleared(0, 0);
    moons.endMove(board);
    expect(moons.active[0].phase).toBe(3);
    const snapshot = moons.snapshot();
    moons.noteCleared(0, 0);
    moons.endMove(board);
    expect(snapshot[0].phase).toBe(3);
    expect(moons.active[0].phase).toBe(2);
  });

  it('does not age moons for blast clears, but charges overlapping targets', () => {
    const moons = new MoonField();
    const board = new ForageBoard(1);
    moons.active.push({ id: 1, x: 2, y: 3, phase: 4, charge: 0 });
    moons.firing = true;
    moons.noteCleared(2, 3);
    moons.firing = false;
    moons.endMove(board);
    expect(moons.active[0]).toMatchObject({ phase: 4, charge: 1 });
  });

  it('beams along both rows and down both columns, passing over crates', () => {
    const moons = new MoonField();
    const board = new ForageBoard(1);
    const moon = { id: 1, x: 2, y: 3, phase: 4, charge: 4 };
    board.setPiece(0, 3, makeCrate(0, 0, 0));
    board.setPiece(2, 6, makeCrate(0, 0, 0));
    const blast = moons.blast(moon, board);
    expect(blast.cells.has(3)).toBe(false); // The crate at (0, 3) stays.
    expect(blast.cells.get(4)).toBe(3); // (0, 4), past the crate's row.
    expect(blast.cells.get(203)).toBe(1); // The moon's own block.
    expect(blast.cells.get(304)).toBe(1);
    expect(blast.cells.get(603)).toBe(4);
    expect(blast.cells.has(206)).toBe(false);
    expect(blast.cells.get(209)).toBe(6); // Down to the bottom row, over the crate.
    expect(blast.cells.has(202)).toBe(false); // Nothing goes up.
    expect(blast.cells.has(100)).toBe(false); // Nor diagonally.
    expect(blast.rays).toHaveLength(6);
  });

  it('keeps crate placement off moons only for older replays, and moon placement off crates', () => {
    const board = new WerewolfForageBoard(1);
    board.moons.active.splice(0);
    board.moons.active.push({ id: 1, x: 0, y: 0, phase: 4, charge: 0 });
    board.crates = 0;
    board.crateArea = 0;
    const columns = new Set(Array.from({ length: 200 }, () => board.findCratePosition(0)));
    expect([0, 1].some((x) => columns.has(x))).toBe(true);
    board.moons.blocksCrates = true;
    for (let i = 0; i < 30; i++) expect(board.findCratePosition(0)).toBeGreaterThanOrEqual(2);
    board.cells.fill(makeCrate(0, 0, 0));
    expect(board.moons.spawn(board)).toBeNull();
  });

  it('charges a moon when an ant eats within it', () => {
    const board = new WerewolfForageBoard(1);
    board.moons.active.splice(0);
    board.moons.active.push({ id: 1, x: 2, y: 3, phase: 4, charge: 0 });
    board.setPiece(2, 2, makeAnts(8, 3));
    board.tickAnts();
    board.moons.endMove(board);
    expect(board.moons.active[0]).toMatchObject({ charge: 1, phase: 4 });
  });

  it('uses the wolf animation and clamped throw origin at an edge', () => {
    const game = new Forage(1, {}, 8, true);
    const quiet = Array.from({ length: WIDTH * HEIGHT }, (_, i) => (i % WIDTH + 2 * Math.floor(i / WIDTH)) % 5);
    game.load(quiet);
    game.board.setPiece(0, 0, 7);
    game.act(0, 0, true);
    expect(game.steps[0]).toMatchObject({ wolf: { box: [0, 0], firstFrame: 0, duration: 500 }, duration: 500 });
    expect(game.steps[0].sounds.map((s) => s.name)).toContain('wolf_roar');
    expect(game.steps[1].sprites.filter((s) => s.path === 'arc').every((s) => s.from[0] === 2 && s.from[1] === 2)).toBe(true);
    expect(game.steps.every((s) => !s.monkey.length)).toBe(true);
    expect(game.cells).not.toContain(EMPTY);
  });
});

describe('Den (Exp) moons', () => {
  const quiet = () => Array.from({ length: WIDTH * HEIGHT }, (_, i) => (i % WIDTH + 2 * Math.floor(i / WIDTH)) % 5);

  it.each([1, 5])('keeps Den to at most %s moons at a time', (limit) => {
    const board = new WerewolfForageBoard(3, 8, true, limit);
    let most = 0;
    for (let i = 0; i < 60; i++) {
      board.moons.noteCleared(0, 0);
      board.moons.endMove(board);
      for (const moon of board.moons.active) moon.phase = 4;
      most = Math.max(most, board.moons.active.length);
    }
    expect(most).toBe(limit);
  });

  it('wanes a moon on the first clear of a move, once', () => {
    const board = new WerewolfForageBoard(1);
    board.moons.eagerPhase = true;
    const moon = board.moons.active[0];
    board.moons.noteCleared(6, 9);
    expect(moon.phase).toBe(3);
    board.moons.noteCleared(6, 9);
    board.moons.endMove(board);
    expect(moon.phase).toBe(3);
  });

  /** The first move from a seeded board that clears inside a charged moon set over the turn. */
  const firstFiring = (setup: (game: Forage) => void): Forage => {
    for (let seed = 1; seed < 50; seed++) {
      for (let x = 0; x < WIDTH - 1; x++) {
        for (let y = 0; y < HEIGHT - 1; y++) {
          const game = new Forage(seed, {}, 8, true);
          setup(game);
          game.moons!.active.splice(0, 1, { id: 1, x, y, phase: 4, charge: 3 });
          if (game.act(x, y, true) === 'moved' && game.steps.some((s) => s.effects.some((e) => e.kind === 'moon' && e.blast))) return game;
        }
      }
    }
    throw new Error('no firing move');
  };

  it('shows the waned moon in the step that clears', () => {
    const other = new Forage(1, {}, 8, true);
    other.moons!.eagerPhase = true;
    const moon = other.moons!.active[0];
    for (let x = 0; x < WIDTH - 1 && moon.phase === 4; x++) {
      for (let y = 0; y < HEIGHT - 1 && moon.phase === 4; y++) {
        const before = other.steps.length;
        if (other.act(x, y, true) !== 'moved' || !other.steps.slice(before).some((s) => s.sprites.some((p) => p.clear))) continue;
        const first = other.steps.slice(before).find((s) => s.sprites.some((p) => p.clear))!;
        expect(first.moons?.find((m) => m.id === moon.id)?.phase).toBe(3);
      }
    }
    expect(moon.phase).toBeLessThan(4);
  });

  it('favours spots over a column with a crate', () => {
    const counts = [0, 0];
    for (let seed = 1; seed <= 300; seed++) {
      const board = new WerewolfForageBoard(seed);
      board.moons.active.splice(0);
      board.moons.chestBias = true;
      board.setPiece(0, HEIGHT - 1, makeCrate(0, 0, 0));
      const moon = board.moons.spawn(board)!;
      counts[moon.x <= 0 ? 0 : 1]++;
    }
    // One spot in six over column 0, weighted three times, comes up about 3/8 of the time.
    expect(counts[0] / 300).toBeGreaterThan(0.25);
  });

  it('brings a moon in with a crate when none is up', () => {
    const game = new Forage(1, { beforeMove: (g) => { g.board.bonusMode = 64; } }, 8, true);
    game.moons!.spawnWithCrate = true;
    game.moons!.active.splice(0);
    game.board.rng.nextFloat = () => 0;
    game.load(quiet());
    game.act(0, 0, true);
    expect(game.crateCount()).toBe(1);
    expect(game.moons!.active).toHaveLength(1);
  });

  it('fires faster at Den (Exp) pace', () => {
    const firing = (game: Forage) => game.steps.find((s) => s.effects.some((e) => e.kind === 'moon' && e.blast))!.duration;
    expect(firing(firstFiring((g) => { g.moons!.pace = 0.75; }))).toBeCloseTo(firing(firstFiring(() => {})) * 0.75);
  });
});
