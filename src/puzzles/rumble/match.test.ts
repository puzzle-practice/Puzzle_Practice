import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE } from './npc';
import type { Shaft } from './board';
import { Match, type MatchSettings } from './match';

const settings = (over: Partial<MatchSettings> = {}): MatchSettings => ({
  enemyRoster: [{ kind: 'Brigand', skill: 60, bludgeon: null }, { kind: 'Barbarian', skill: 60, bludgeon: null }],
  allyRoster: [{ kind: 'Skilled swabbie', skill: 80, bludgeon: null }],
  ai: { ...DEFAULT_STYLE },
  rules: { timeBonus: true, suppression: true, dropOffToAttackers: true, defence: true, defenceSquares: 90, side: 'random' },
  oneFisted: false, werewolf: false, rumless: false, damageLevel: 0, startRows: 3, bludgeon: [127, 0],
  ...over,
});

function run(m: Match, ms: number, step = 16): void {
  for (let t = 0; t <= ms && !m.settledAt; t += step) m.update(t);
}

describe('a rumble', () => {
  it('plays out to a result with NPCs shooting and strikes landing', { timeout: 60_000 }, () => {
    const m = new Match(settings(), 12345, 0);
    run(m, 30 * 60_000, 20);
    expect(m.result).not.toBeNull();
    const shots = m.fighters.map((f) => f.stats.shots);
    expect(shots.every((n) => n > 5)).toBe(true);
    expect(m.fighters.some((f) => f.stats.received > 0)).toBe(true);
  });

  it('plays the same fight from the same seed', { timeout: 60_000 }, () => {
    const a = new Match(settings(), 99, 0);
    const b = new Match(settings(), 99, 0);
    run(a, 120_000);
    run(b, 120_000);
    const state = (m: Match) => m.fighters.map((f) => f.board.cells.join());
    expect(state(a)).toEqual(state(b));
  });

  it('lets you defend a teammate, and their bar soaks a punch', () => {
    const m = new Match(settings(), 7, 0);
    expect(m.canTarget(0, 1)).toBe(true);
    m.setTarget(1);
    expect(m.defender(1)).toBe(0);
    m.defence[1] = 45;
    expect(m.halo(1)).toBe(50);
  });

  it('runs practice on your own until you are knocked out', { timeout: 60_000 }, () => {
    const m = new Match(settings({ enemyRoster: [], allyRoster: [] }), 3, 0);
    run(m, 30 * 60_000, 20);
    expect(m.result).toBe('lost');
    expect(m.player.out).toBe(true);
  });

  it('suppresses a punch by a row for each enemy on you but your target, up to half, and sends them the drop-off', () => {
    const m = new Match(settings({ allyRoster: [], enemyRoster: [
      { kind: 'Brigand', skill: 0, bludgeon: null }, { kind: 'Brigand', skill: 0, bludgeon: null }, { kind: 'Brigand', skill: 0, bludgeon: null },
    ] }), 11, 0);
    for (const i of [1, 2, 3]) m.targets[i] = 0;
    m.targets[0] = 1;
    const got: Array<{ to: number; height: number; count: number }> = [];
    m.fighters.forEach((f, to) => { f.receive = (s: Shaft) => { got.push({ to, height: s.height, count: s.count }); }; });
    (m as unknown as { send(from: number, sent: object, at: number): void }).send(0, { height: 3, width: 8, count: 6, popped: 12, dropped: 6, groups: 4 }, 0);
    // Two suppressors, but only a row (half of 3, rounded down) comes off.
    expect(got).toContainEqual({ to: 1, height: 2, count: 0 });
    expect(got.filter((g) => g.count === 6).map((g) => g.to).sort()).toEqual([2, 3]);
  });

  it('sends no drop-off in a 1v1', () => {
    const m = new Match(settings({ allyRoster: [], enemyRoster: [{ kind: 'Brigand', skill: 0, bludgeon: null }] }), 11, 0);
    m.targets[1] = 0;
    const got: number[] = [];
    m.fighters[1].receive = (s: Shaft) => { got.push(s.height); };
    (m as unknown as { send(from: number, sent: object, at: number): void }).send(0, { height: 3, width: 8, count: 6, popped: 12, dropped: 6, groups: 4 }, 0);
    expect(got).toEqual([3]);
  });

  it('has NPCs play real boards: building sparks, punching, and getting knocked out', { timeout: 60_000 }, () => {
    const m = new Match(settings({ allyRoster: [], enemyRoster: [
      { kind: 'Skilled swabbie', skill: 100, bludgeon: null }, { kind: 'Brigand', skill: 20, bludgeon: null },
    ] }), 21, 0);
    run(m, 30 * 60_000, 20);
    const npcs = m.fighters.slice(1);
    expect(npcs.some((f) => f.stats.sparks > 0)).toBe(true);
    expect(npcs.some((f) => f.stats.punches > 0)).toBe(true);
    expect(m.fighters.some((f) => f.out && f.index > 0) || m.player.out).toBe(true);
  });
});
