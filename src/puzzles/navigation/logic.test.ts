import { describe, expect, it } from 'vitest';
import fixture from './navigation-parity.json';
import { NaviBoard, WildTargets, type Target, type Run } from './logic';
import { NavigationGame, DEFAULT_SETTINGS, NO_TOTALS, addBoard, boardSeed, readSettings, readNavigationSeed, runGoal, settingsKey } from './game';

const targets = (rows: (number | boolean)[][]): Target[] => rows.map(r => ({ octant: r[0] as number, ring: r[1] as number, colour: r[2] as number, wild: r[3] as boolean }));
const runs = (rows: number[][]): Run[] => rows.map(r => ({ direction: r[0] as 0 | 1, octant: r[1], ring: r[2], length: r[3] }));

describe('navigation test-build parity', () => {
  it('matches 4,320 incoming stars and constellation generations, across both ring counts and dense Werewolf constellations', () => {
    for (const c of fixture.generation) {
      const b = new NaviBoard(c.rings,c.difficulty,c.seed,c.dense);
      c.entries.forEach((entry,i) => {
        expect(b.nextEntry(), `entry ${c.seed}/${c.difficulty}/${c.rings}/${i}`).toEqual({ octant: entry[0], colour: entry[1] });
        expect(b.nextConstellation(), `target ${c.seed}/${c.difficulty}/${c.rings}/${i}`).toEqual(targets(c.targets[i]));
      });
    }
  });
  it('matches 400 overlapping, radial and wraparound clears and their scores', () => {
    for (const c of fixture.matches) {
      const b = new NaviBoard(c.rings,4,1); b.cells.splice(0,b.cells.length,...c.before);
      const found = b.findRuns();expect(found).toEqual(runs(c.runs));
      expect(b.clearRuns(found,1).reduce((sum,c) => sum+c.points,0)).toBe(c.points);
      expect(b.cells).toEqual(c.after);
    }
  });
  it('matches 480 wild-target chains and carryover cases, including the extra wild target and dense constellations', () => {
    for (const c of fixture.wild) {
      const b = new NaviBoard(c.rings,4,c.seed,c.dense); const current = b.nextConstellation();
      expect(current).toEqual(targets(c.before));
      const helper = new WildTargets(c.enabled,c.rings);
      c.steps.forEach(s => { helper.runs(runs(s.runs),current); expect(current).toEqual(targets(s.targets)); });
      helper.completed(current);expect(current).toEqual(targets(c.completed));
      const next = b.nextConstellation();helper.next(next);expect(next).toEqual(targets(c.next));
    }
  });
  it('matches 200 constellation completions with wildcard substitutions, ring-relative scores and chain multipliers', () => {
    for (const c of fixture.scores) {
      const b = new NaviBoard(c.rings,4,1);const ts=targets(c.targets);
      ts.forEach((t,j) => b.set(t.octant,t.ring,j%2===0?(t.colour+1)%5:t.colour));
      expect(b.matches(ts)).toBe(c.matches);expect(b.clearConstellation(ts,c.chain).points).toBe(c.points);expect(b.cells).toEqual(c.after);
    }
  });
});

describe('navigation sessions', () => {
  it('uses WW toggles independently and keeps normal settings separate', () => {
    for (const extraRing of [false,true]) for (const wildTargets of [false,true]) {
      const g = new NavigationGame({ ...DEFAULT_SETTINGS,extraRing,wildTargets },42);
      expect(g.board.rings).toBe(extraRing?4:3);expect(g.wild.enabled).toBe(wildTargets);
    }
    const normal = new NavigationGame({ ...DEFAULT_SETTINGS, mode: 'normal' },42);
    expect(normal.board.rings).toBe(3);expect(normal.wild.enabled).toBe(false);
    expect(settingsKey(DEFAULT_SETTINGS)).not.toBe(settingsKey(normal.settings));
  });
  it('lets stars fall inward without reversing their order', () => {
    const b = new NaviBoard(4,4,1);b.set(0,0,2);b.set(0,1,3);b.gravity();
    expect([0,1,2,3].map(r=>b.get(0,r))).toEqual([-1,-1,2,3]);
    expect(b.gravity()).toEqual([]);
  });
  it('ends on an occupied entry octant and counts the booched star', () => {
    const g = new NavigationGame(DEFAULT_SETTINGS,42);g.board.set(g.entry.octant,0,1);
    g.drop();expect(g.booched).toBe(true);expect(g.finished).toBe(true);expect(g.stars).toBe(1);
    expect(g.drop()).toEqual([]);expect(g.stars).toBe(1);
  });
  it('ends at the game constellation quota', () => {
    const g = new NavigationGame({ ...DEFAULT_SETTINGS,difficulty:0 },1);
    g.constellations = g.goal-1;
    g.targets = [{ octant:1,ring:3,colour:2,wild:false }];g.board.set(0,3,2);
    g.rotate(3,false);expect(g.finished).toBe(true);expect(g.booched).toBe(false);expect(g.constellations).toBe(g.goal);
  });
  it('keeps charting past the quota with no timer, and ends a quota run at it', () => {
    const chart = (g: NavigationGame) => {
      g.constellations = 12;
      g.targets = [{ octant:1,ring:3,colour:2,wild:false }];g.board.set(0,3,2);
      g.rotate(3,false);
    };
    const endless = new NavigationGame({ ...DEFAULT_SETTINGS,timerMs:0 },1);
    chart(endless);expect(endless.constellations).toBe(13);expect(endless.finished).toBe(false);expect(endless.targets.length).toBeGreaterThan(0);
    const run = new NavigationGame({ ...DEFAULT_SETTINGS,timerMs:0,clears:true },1);
    chart(run);expect(run.constellations).toBe(13);expect(run.finished).toBe(true);
    expect(runGoal({ ...DEFAULT_SETTINGS,timerMs:0 })).toBe(Infinity);
    expect(runGoal({ ...DEFAULT_SETTINGS,timerMs:0,clears:true })).toBe(13);
  });
  it('counts a dismissed board toward the quota run', () => {
    const settings = { ...DEFAULT_SETTINGS,timerMs:0,clears:true };
    // Ten charted on the first board leaves three for the next.
    const next = new NavigationGame(settings, boardSeed(1, 1), runGoal(settings) - 10);
    next.constellations = 2;
    next.targets = [{ octant:1,ring:3,colour:2,wild:false }];next.board.set(0,3,2);
    next.rotate(3,false);expect(next.finished).toBe(true);
  });
  it('resets chain charging for each player action', () => {
    const helper = new WildTargets(true,4), ts = [{ octant:0,ring:1,colour:3,wild:false }];
    const rs: Run[] = [{ direction:0,octant:7,ring:1,length:3 }];
    helper.runs(rs,ts);expect(ts[0].wild).toBe(false);helper.action();helper.runs(rs,ts);expect(ts[0].wild).toBe(false);
    helper.runs(rs,ts);expect(ts[0].wild).toBe(true);
  });
  it('multiplies a constellation completed after a run clear by the chain', () => {
    const g = new NavigationGame({ ...DEFAULT_SETTINGS, wildTargets: false }, 1);
    // Turning the inner ring lines up three stars over the target; they clear, and the star
    // above falls onto the target one pass into the chain.
    g.targets = [{ octant: 0, ring: 3, colour: 4, wild: false }];
    [1, 2, 3].forEach(o => g.board.set(o, 3, 1));
    g.board.set(0, 2, 4);
    g.rotate(3, true);
    expect(g.constellations).toBe(1);
    // The run is 3 points; the one inner-ring target, trunc(3 * 1.5²) = 6, doubles.
    expect(g.points).toBe(3 + 6 * 2);
    // Charted in a double chain: a half moon on the duty report.
    expect(g.moons).toEqual([0, 1, 0]);
  });
  it('adds an extra wild inner target after a constellation charted two passes into a chain', () => {
    const helper = new WildTargets(true, 4), current = [{ octant: 0, ring: 3, colour: 1, wild: false }];
    const rs: Run[] = [{ direction: 0, octant: 0, ring: 0, length: 3 }];
    helper.runs(rs, current); helper.runs(rs, current); helper.completed(current);
    const next = [{ octant: 2, ring: 3, colour: 4, wild: false }, { octant: 5, ring: 2, colour: 0, wild: false }];
    helper.next(next);
    expect(next).toEqual([{ octant: 2, ring: 3, colour: 4, wild: true }, { octant: 5, ring: 2, colour: 0, wild: false }, { octant: 3, ring: 3, colour: 4, wild: true }]);
  });
  it('deals WW boards dense 3/2/1 constellations and Normal boards from the difficulty distribution', () => {
    const perRing = (ts: Target[], rings: number) => [rings - 1, rings - 2, rings - 3].map(r => ts.filter(t => t.ring === r).length);
    for (const extraRing of [false, true]) {
      const g = new NavigationGame({ ...DEFAULT_SETTINGS, extraRing, wildTargets: false }, 5);
      const rings = extraRing ? 4 : 3;
      expect(perRing(g.targets, rings)).toEqual([3, 2, 1]);
      for (let i = 0; i < 20; i++) expect(perRing(g.board.nextConstellation(), rings)).toEqual([3, 2, 1]);
    }
    const normal = new NavigationGame({ ...DEFAULT_SETTINGS, mode: 'normal' }, 5);
    expect(normal.board.dense).toBe(false);
    expect(new Set(Array.from({ length: 20 }, () => normal.board.nextConstellation().length)).size).toBeGreaterThan(1);
  });
  it('banks a dismissed WW board into the run and deals the next board from the run seed', () => {
    const first = new NavigationGame(DEFAULT_SETTINGS, 7);
    Object.assign(first, { points: 40, constellations: 3, stars: 20, moves: 9, longestChain: 2 });
    first.moons.splice(0, 3, 2, 1, 0);
    const banked = addBoard(NO_TOTALS, first);
    const second = new NavigationGame(DEFAULT_SETTINGS, boardSeed(7, 1));
    Object.assign(second, { points: 15, constellations: 1, stars: 6, moves: 4, longestChain: 1 });
    second.moons.splice(0, 3, 0, 0, 1);
    expect(addBoard(banked, second)).toEqual({ points: 55, constellations: 4, stars: 26, moves: 13, longestChain: 2, moons: [2, 1, 1] });
    expect(boardSeed(7, 0)).toBe(7);
    expect(boardSeed(7, 1)).toBe(boardSeed(7, 1));
    expect(new Set([1, 2, 3].map(n => boardSeed(7, n))).size).toBe(3);
    for (const n of [1, 2, 3]) expect(readNavigationSeed(boardSeed(7, n))).not.toBeNull();
  });
  it('rejects invalid replay and stored settings', () => {
    expect(readSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ mode: 'ww', timerMs: 120000 });
    expect(readSettings({ ...DEFAULT_SETTINGS,difficulty:10 })).toBeNull();
    expect(readSettings({ ...DEFAULT_SETTINGS,extraRing:'yes' })).toBeNull();
    expect(readSettings({ ...DEFAULT_SETTINGS,timerMs:Infinity })).toBeNull();
    const { clears: _, dismissDelayMs: __, ...legacy } = DEFAULT_SETTINGS;
    expect(readSettings(legacy)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ ...DEFAULT_SETTINGS,timerMs:0,clears:true })).toMatchObject({ clears: true });
    expect(readSettings({ ...DEFAULT_SETTINGS,clears:true })).toBeNull();
    expect(readSettings({ ...DEFAULT_SETTINGS,dismissDelayMs:0 })).toMatchObject({ dismissDelayMs: 0 });
    expect(readSettings({ ...DEFAULT_SETTINGS,dismissDelayMs:750 })).toBeNull();
    expect(settingsKey({ ...DEFAULT_SETTINGS,timerMs:0 })).not.toBe(settingsKey({ ...DEFAULT_SETTINGS,timerMs:0,clears:true }));
    const { slowDrop: ___, ...beforeSlowDrop } = DEFAULT_SETTINGS;
    expect(readSettings(beforeSlowDrop)).toMatchObject({ slowDrop: false });
    expect(readSettings({ ...DEFAULT_SETTINGS,slowDrop:'yes' })).toBeNull();
    expect(settingsKey(DEFAULT_SETTINGS)).not.toBe(settingsKey({ ...DEFAULT_SETTINGS,slowDrop:true }));
  });
  it('reads legacy replay seeds and validates the timer carried into a new WW board', () => {
    expect(readNavigationSeed(42)).toEqual({ boardSeed: 42, timerElapsedMs: 0 });
    expect(readNavigationSeed({ boardSeed: 42, timerElapsedMs: 60000 })).toEqual({ boardSeed: 42, timerElapsedMs: 60000 });
    for (const value of [null, {}, -1, 0x100000000, { boardSeed: 42, timerElapsedMs: -1 },
      { boardSeed: 42, timerElapsedMs: 300001 }, { boardSeed: 42, timerElapsedMs: '60000' }]) {
      expect(readNavigationSeed(value)).toBeNull();
    }
  });
});
