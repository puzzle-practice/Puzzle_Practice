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

  it('keeps crate placement off moons and moon placement off crates', () => {
    const board = new WerewolfForageBoard(1);
    board.moons.active.splice(0);
    board.moons.active.push({ id: 1, x: 0, y: 0, phase: 4, charge: 0 });
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
