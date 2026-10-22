import { describe, expect, it } from 'vitest';
import {
  CRATE, DOWN, EMPTY, FIRING, GunneryBoard, HOLE, LEFT, LOADED, MUZZLE, MIDDLE, BREECH, PARTIAL, POWDER, Piece, RIGHT, SHOT, SWAB, UP,
  WAD, WASHING, WIDTH, heightFor,
} from './board';
import { DEFAULT_SETTINGS, FIRE_MS, GunningGame, START_TICK, TICK_STEP, WASH_MS, readSettings, settingsKey } from './game';

/** A game with an empty deck and a barrel that never puts out a piece, so tests can place their own. */
function quiet(settings = {}): GunningGame {
  const g = new GunningGame({ ...DEFAULT_SETTINGS, ...settings }, 7);
  const b = g.board;
  for (let i = 0; i < b.cells.length; i++) if ((b.cells[i] & 0xff) === CRATE || (b.cells[i] & 0xff) === HOLE) b.cells[i] = 0;
  b.barrel.state = 1; b.barrel.target = -1;
  return g;
}
/** Sends a piece down the left edge into the top-left cannon (row 3) with a right arrow at (0, 3). */
function feed(g: GunningGame, type: number): Piece {
  const p = new Piece(type, 0, 1, 2);
  g.board.pieces.push(p);
  return p;
}
const ticks = (g: GunningGame, n: number) => { for (let i = 0; i < n; i++) g.step(g.tickAt + g.interval - g.now); };

describe('Gunning deck', () => {
  it('sizes the deck by cannon count and keeps crates off the lanes', () => {
    for (const n of [2, 4, 6]) {
      const b = new GunneryBoard(n, 99);
      expect(b.height).toBe(heightFor(n));
      expect(b.cells.filter(c => (c & 0xff) === CRATE)).toHaveLength(4 * n);
      expect(b.cells.filter(c => (c & 0xff) === MUZZLE)).toHaveLength(n);
      b.cells.forEach((c, i) => {
        if ((c & 0xff) !== CRATE) return;
        const x = i % WIDTH, y = Math.floor(i / WIDTH);
        expect([5, 6, 7]).not.toContain(y);
        if (b.isCannonRow(y)) expect([0, 4, 8, 12]).not.toContain(x);
        if (b.isCannonRow(y + 1)) expect([0, 12]).not.toContain(x);
      });
    }
    // The left cannon's muzzle is its outer end; the right cannon mirrors it.
    const b = new GunneryBoard(4, 1);
    expect([1, 2, 3].map(x => b.element(x, 3))).toEqual([MUZZLE, MIDDLE, BREECH]);
    expect([11, 10, 9].map(x => b.element(x, 3))).toEqual([MUZZLE, MIDDLE, BREECH]);
    expect(b.cannonId(10, 9)).toBe(3);
  });
  it('deals the same deck for the same seed', () => {
    expect(new GunneryBoard(4, 5).cells).toEqual(new GunneryBoard(4, 5).cells);
    expect(new GunneryBoard(4, 5).cells).not.toEqual(new GunneryBoard(4, 6).cells);
  });
  it('keeps the three newest arrows and moves a re-laid one to the front', () => {
    const g = quiet(), b = g.board;
    g.placeArrow(5, 1, UP); g.placeArrow(6, 1, RIGHT); g.placeArrow(7, 1, DOWN);
    expect(b.arrows).toEqual([7 + WIDTH, 6 + WIDTH, 5 + WIDTH]);
    g.placeArrow(6, 1, LEFT);
    expect(b.arrows).toEqual([6 + WIDTH, 7 + WIDTH, 5 + WIDTH]);
    expect(b.arrow(6, 1)).toBe(LEFT);
    g.placeArrow(8, 1, UP);
    expect(b.arrows).toEqual([8 + WIDTH, 6 + WIDTH, 7 + WIDTH]);
    expect(b.arrow(5, 1)).toBe(0);
    expect(g.placeArrow(1, 3, UP)).toBe(false);
  });
});

describe('Loading cannons', () => {
  it('loads powder, wad and shot through the muzzle, then fires and needs a wash', () => {
    const g = quiet({ firing: 'loaded', balls: 10 }), b = g.board, cannon = b.cannons[0];
    g.placeArrow(0, 3, RIGHT);
    feed(g, POWDER); ticks(g, 2);
    expect(cannon.state).toBe(PARTIAL); expect(g.stats.correct).toBe(1);
    ticks(g, 4);
    expect(b.resting(3, 3)).toBe(POWDER); expect(b.pieces).toHaveLength(0);
    feed(g, WAD); ticks(g, 6);
    expect(b.resting(2, 3)).toBe(WAD);
    feed(g, SHOT); ticks(g, 2);
    expect(cannon.state).toBe(LOADED); expect(g.stats.loaded).toBe(1); expect(b.balls).toBe(9);
    expect(b.resting(3, 3)).toBe(0);
    // Three correct pieces and a loaded cannon each took 2 ms off the tick.
    expect(g.base).toBe(START_TICK - 4 * TICK_STEP);
    ticks(g, 1);
    expect(b.pieces).toHaveLength(0);
    g.step(1000);
    expect(cannon.state).toBe(FIRING);
    g.step(FIRE_MS);
    expect(cannon.state).toBe(PARTIAL); expect(cannon.fouled).toBe(true); expect(g.stats.fired).toBe(1);
    // A fouled cannon takes nothing correctly until it is swabbed.
    feed(g, POWDER); ticks(g, 2);
    expect(g.stats.wrong).toBe(1); expect(cannon.slots[1]?.type).toBe(POWDER);
    ticks(g, 4);
    feed(g, SWAB); ticks(g, 2);
    expect(g.stats.wastedSwabs).toBe(0);
    ticks(g, 3);
    expect(cannon.state).toBe(WASHING);
    g.step(WASH_MS);
    expect(cannon.state).toBe(EMPTY); expect(cannon.fouled).toBe(false); expect(b.resting(2, 3)).toBe(0);
  });
  it('counts a wrong load as a mistake, refuses more once full, and slows the deck', () => {
    const g = quiet(), b = g.board, cannon = b.cannons[0];
    g.placeArrow(0, 3, RIGHT);
    feed(g, WAD); ticks(g, 6);
    expect(g.stats.wrong).toBe(1); expect(g.base).toBe(START_TICK + TICK_STEP);
    expect(b.resting(3, 3)).toBe(WAD);
    feed(g, POWDER); ticks(g, 6); feed(g, SHOT); ticks(g, 2);
    expect(cannon.state).toBe(PARTIAL); expect(g.stats.loaded).toBe(0);
    // Full: the next piece bounces off the muzzle.
    feed(g, POWDER); ticks(g, 2);
    expect(cannon.slots.map(s => s?.type)).toEqual([WAD, POWDER, SHOT]);
    expect(b.pieces).toHaveLength(1);
  });
  it('counts a swab into a clean, empty cannon as a mistake but still washes', () => {
    const g = quiet(), cannon = g.board.cannons[0];
    g.placeArrow(0, 3, RIGHT);
    feed(g, SWAB); ticks(g, 2);
    expect(g.stats.wastedSwabs).toBe(1); expect(g.base).toBe(START_TICK + TICK_STEP);
    ticks(g, 3);
    expect(cannon.state).toBe(WASHING);
  });
  it('fires every viking gun each time all of them are loaded', () => {
    const g = quiet({ firing: 'viking', cannons: 2 });
    expect(g.board.cannons.every(c => c.fouled)).toBe(true);
    for (const c of g.board.cannons) { c.finishFiring(); c.state = EMPTY; c.fouled = false; }
    g.board.cannons[0].state = LOADED;
    const load = (c: number) => { const cannon = g.board.cannons[c]; cannon.slots = [new Piece(POWDER, 0, 0, 0), new Piece(WAD, 0, 0, 0), new Piece(SHOT, 0, 0, 0)]; cannon.checkLoaded(true); };
    load(0); g.step(1000);
    expect(g.board.cannons[0].state).toBe(LOADED);
    load(1); g.step(250);
    expect(g.board.cannons[0].state).toBe(FIRING);
    g.step(200);
    expect(g.board.cannons[1].state).toBe(FIRING);
  });
  it('fires loaded cannons in a broadside on the ship timer', () => {
    const g = quiet({ firing: 'volley', volleyMs: 5000 }), c = g.board.cannons[1];
    c.slots = [new Piece(POWDER, 0, 0, 0), new Piece(WAD, 0, 0, 0), new Piece(SHOT, 0, 0, 0)]; c.checkLoaded(true);
    g.step(4999); expect(c.state).toBe(LOADED);
    g.step(1); expect(c.state).toBe(FIRING);
  });
});

describe('Lost pieces', () => {
  it('sends a piece overboard off the side of a cannon row', () => {
    const g = quiet(), b = g.board;
    g.placeArrow(0, 3, LEFT);
    feed(g, POWDER); ticks(g, 5);
    expect(g.stats.overboard).toBe(1); expect(b.pieces).toHaveLength(0); expect(g.sounds).toContain('piece_overboard');
  });
  it('drops a piece down a hole', () => {
    const g = quiet(), b = g.board;
    b.cells[4 * WIDTH] = HOLE;
    feed(g, WAD); ticks(g, 4);
    expect(g.stats.overboard).toBe(1);
  });
  it('turns right, then left, then back when blocked', () => {
    const g = quiet(), b = g.board;
    b.cells[2 * WIDTH + 6] = CRATE;
    const p = new Piece(POWDER, 6, 0, 2);
    b.pieces.push(p);
    ticks(g, 1);
    expect(p.dir).toBe(3);
    expect([p.nx, p.ny]).toEqual([5, 1]);
  });
});

describe('The barrel', () => {
  it('turns a quarter between pieces and keeps to the fewest-type rule', () => {
    const g = new GunningGame({ ...DEFAULT_SETTINGS, cannons: 4 }, 3), b = g.board;
    const dirs: number[] = [];
    for (let i = 0; i < 40 && b.pieces.length < 8; i++) {
      const before = b.pieces.length;
      b.tick();
      if (b.pieces.length > before) {
        dirs.push(b.pieces.at(-1)!.dir);
        const counts = [SWAB, SHOT, POWDER, WAD].map(t => b.pieces.filter(p => p.type === t).length);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      }
    }
    expect(b.pieces).toHaveLength(8);
    expect(dirs.slice(0, 4).sort()).toEqual([0, 1, 2, 3]);
    // Never more than two of a type with four cannons, so no more pieces join.
    b.tick(); expect(b.pieces.length).toBeLessThanOrEqual(8);
  });
  it('stops putting out shot when the ship is out of cannonballs', () => {
    const b = new GunneryBoard(4, 3, 0);
    for (let i = 0; i < 60; i++) b.tick();
    expect(b.pieces.some(p => p.type === SHOT)).toBe(false);
    expect(b.pieces.length).toBeGreaterThan(0);
  });
  it('slides along its row while the ship moves', () => {
    const b = new GunneryBoard(4, 3);
    b.barrel.setMoving(true);
    for (let i = 0; i < 30; i++) b.tick();
    expect(b.barrel.col).toBeGreaterThan(6);
    b.barrel.stop();
    for (let i = 0; i < 30; i++) b.tick();
    const col = b.barrel.col;
    for (let i = 0; i < 10; i++) b.tick();
    expect(b.barrel.col).toBe(col);
  });
});

describe('Settings', () => {
  it('reads saved settings and keeps the speed out of the history key', () => {
    expect(readSettings({ ...DEFAULT_SETTINGS, cannons: 5 })).toBeNull();
    expect(readSettings({ cannons: 6 })).toMatchObject({ cannons: 6, firing: 'volley' });
    expect(settingsKey({ ...DEFAULT_SETTINGS, speed: 200 })).toBe(settingsKey(DEFAULT_SETTINGS));
  });
  it('plays the same session from the same seed', () => {
    const run = () => { const g = new GunningGame(DEFAULT_SETTINGS, 11); g.placeArrow(0, 3, RIGHT); g.step(30000); return [g.stats, g.board.cells]; };
    expect(run()).toEqual(run());
  });
});
