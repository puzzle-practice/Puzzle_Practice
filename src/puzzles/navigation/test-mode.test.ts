import { describe, expect, it } from 'vitest';
import fixture from './navigation-test-parity.json';
import { NaviTestBoard, TestWildTargets, type Target, type Run } from './logic';
import { DEFAULT_SETTINGS, NavigationGame, boardSeed, readSettings, settingsKey } from './game';
import { boardCode, boardIssues, load, readBoardCode } from './create';

const settings = { ...DEFAULT_SETTINGS, mode: 'ww-test' as const };
const targets = (rows: (number | boolean)[][]): Target[] => rows.map(r => ({ octant: r[0] as number, ring: r[1] as number, colour: r[2] as number, wild: r[3] as boolean }));
const runs = (rows: number[][]): Run[] => rows.map(r => ({ direction: r[0] as 0 | 1, octant: r[1], ring: r[2], length: r[3] }));
const counts = (ts: Target[], rings: number) => [rings - 1, rings - 2, rings - 3].map(r => ts.filter(t => t.ring === r).length);

describe('WW (Test)', () => {
  it('matches 960 native sequences mixing charts, cascades, empty passes and new actions', () => {
    for (const c of fixture.chains) {
      const b = new NaviTestBoard(c.rings, 4, c.seed), helper = new TestWildTargets(c.enabled, c.rings);
      let current = b.nextConstellation();
      expect(current).toEqual(targets(c.before));
      for (const step of c.steps) {
        if (step.op === 'a') helper.action();
        else if (step.op === 'c') { helper.completed(current); current = b.nextConstellation(); helper.next(current); }
        else helper.runs(runs(step.runs), current);
        expect(current, `seed ${c.seed}, rings ${c.rings}, enabled ${c.enabled}, operation ${step.op}`).toEqual(targets(step.targets));
      }
    }
  });

  it('starts each fresh or dismissed board with 1/2/1, then deals 3/2/1 at every difficulty', () => {
    for (let difficulty = 0; difficulty <= 9; difficulty++) for (const extraRing of [false, true]) for (const wildTargets of [false, true]) {
      const game = new NavigationGame({ ...settings, difficulty, extraRing, wildTargets }, 5);
      const rings = extraRing ? 4 : 3;
      expect(game.board.rings).toBe(rings);
      expect(game.wild.enabled).toBe(wildTargets);
      expect(counts(game.targets, rings)).toEqual([1, 2, 1]);
      for (let i = 0; i < 20; i++) expect(counts(game.board.nextConstellation(), rings)).toEqual([3, 2, 1]);
      expect(counts(new NavigationGame(game.settings, boardSeed(5, 1)).targets, rings)).toEqual([1, 2, 1]);
    }
  });

  it('charges after charting, adds at most one extra target, and resets with a new action', () => {
    const helper = new TestWildTargets(true, 4);
    const current = [{ octant: 0, ring: 3, colour: 1, wild: false }];
    const next = [{ octant: 4, ring: 3, colour: 2, wild: false }];
    const rs: Run[] = [{ direction: 0, octant: 0, ring: 0, length: 3 }];
    helper.completed(current); helper.next(next);
    expect(next[0].wild).toBe(false);
    helper.runs(rs, next); expect(next[0].wild).toBe(true);
    helper.runs(rs, next); expect(next).toHaveLength(2);
    helper.runs(rs, next); expect(next).toHaveLength(2);
    helper.action();
    const later = [{ octant: 4, ring: 3, colour: 2, wild: false }];
    helper.runs(rs, later); expect(later[0].wild).toBe(false);
  });

  it.each([['ww', false], ['ww-test', true]] as const)('%s applies its own charging rules during board evolution', (mode, charged) => {
    const game = new NavigationGame({ ...settings, mode }, 5);
    // The rotation charts the target first, then clears a run away from the new target.
    game.targets = [{ octant: 0, ring: 3, colour: 2, wild: false }];
    game.board.set(1, 3, 2);
    for (const o of [2, 3, 4]) game.board.set(o, 3, 1);
    game.board.nextConstellation = () => [{ octant: 5, ring: 3, colour: 3, wild: false }];
    const scenes = game.rotate(3, true);
    expect(scenes.flatMap(s => s.clear ? [s.clear.kind] : [])).toEqual(['target', 'run']);
    expect(game.constellations).toBe(1);
    expect(game.targets[0].wild).toBe(charged);
    // Charging continues in WW (Test), while the scoring chain resets after charting.
    expect(game.points).toBe(6 + 3);
  });

  it('never exceeds ten targets or duplicates an occupied inner octant', () => {
    for (const inner of [3, 8]) for (const total of [9, 10]) {
      const helper = new TestWildTargets(true, 4);
      const current: Target[] = Array.from({ length: total }, (_, i) => ({ octant: i % 8, ring: i < inner ? 3 : 2, colour: 2, wild: false }));
      const rs: Run[] = [{ direction: 0, octant: 0, ring: 0, length: 3 }];
      helper.completed([]); helper.next(current); helper.runs(rs, current); helper.runs(rs, current);
      expect(current).toHaveLength(inner === 8 || total === 10 ? total : total + 1);
      expect(new Set(current.map(t => `${t.ring}:${t.octant}`)).size).toBe(current.length);
    }
  });

  it('persists a separate mode and history key while retaining legacy keys', () => {
    expect(readSettings(settings)).toEqual(settings);
    expect(readSettings({ ...settings, mode: 'test' })).toBeNull();
    expect(settingsKey(settings)).toBe('ww-test:4:4:1:120000');
    expect(settingsKey(DEFAULT_SETTINGS)).toBe('ww:4:4:1:120000');
    expect(settingsKey({ ...settings, extraRing: false, wildTargets: false })).toBe('ww-test:4:3:0:120000');
  });

  it('accepts both opening and later shared Freeplay constellations', () => {
    const game = new NavigationGame({ ...settings, create: true }, 5);
    for (let i = 0; i < 2; i++) {
      expect(boardIssues(game, true, true)).toEqual([]);
      const copy = new NavigationGame(game.settings, 77);
      load(copy, readBoardCode(boardCode(game))!);
      expect(boardIssues(copy, true, true)).toEqual([]);
      game.targets = game.board.nextConstellation();
    }
    game.targets.pop();
    expect(boardIssues(game, true, true).join(' ')).toContain('WW (Test)');
  });
});
