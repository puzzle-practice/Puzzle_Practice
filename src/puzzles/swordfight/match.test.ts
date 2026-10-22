import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { GameNpc, gameSkillStyle, Npc, skillStyle } from './npc';
import { attackFor, swordFor } from './attack';
import { Board, BREAKER, findClear } from './board';
import { Match, type MatchSettings } from './match';

const settings: MatchSettings = { cultists: 1, homunculi: 0, opponents: 1, thralls: 0, swabbies: 0, cultistSkill: 60, homunculusSkill: 60, thrallSkill: 50, swabbieSkill: 50, opponentType: 'tally', ai: skillStyle(60), gameAi: gameSkillStyle(60), difficulty: 5, breakers: 12.5, sword: [2, 0, 0] };

describe('attacks (YPPedia)', () => {
  it('turns blocks into swords', () => {
    expect(swordFor(2, 2, 1)).toEqual([1, 4]);
    expect(swordFor(3, 3, 1)).toEqual([2, 4]);
    expect(swordFor(5, 5, 1)).toEqual([3, 7]);
    expect(swordFor(5, 4, 1)).toEqual([6, 3]);
    expect(swordFor(2, 3, 1)).toEqual([2, 3]);
    expect(swordFor(3, 2, 1)).toEqual([3, 2]);
    // A double doubles the longest side, the height when square.
    expect(swordFor(2, 2, 2)).toEqual([2, 4]);
    expect(swordFor(3, 2, 2)).toEqual([6, 2]);
  });

  it('sends a sprinkle for every two loose pieces of each break', () => {
    const board = new Board();
    // Two separate breaks: a red breaker with 4 reds (5 pieces), and a blue breaker with 2 blues (3 pieces).
    for (let y = 8; y < 13; y++) board.set(0, y, y === 8 ? BREAKER : 0);
    for (let y = 10; y < 13; y++) board.set(3, y, y === 10 ? BREAKER | 2 : 2);
    expect(attackFor(findClear(board, 0), 1).sprinkles).toBe(2 + 1);
    expect(attackFor(findClear(board, 0), 3).sprinkles).toBe(9);
  });
});

function play(seed: number, until = 10 * 60_000, opponents = 1) {
  const m = new Match({ ...settings, cultists: opponents, opponents }, seed, 0);
  let now = 0;
  while (!m.result && now < until) {
    now += 16;
    m.update(now);
  }
  return { m, now };
}

describe('the opponents', () => {
  it('stack their pieces on their lowest column, edges first', () => {
    const pairs: Array<[number, number]> = [[0, 1], [2, 3], [0, 0]];
    const npc = new Npc(1, { ...skillStyle(50), pairMs: 100 }, new Random(1), { nextPair: () => pairs.shift()!, attack: () => {} }, 0);
    npc.update(300);
    const tops = [0, 1, 2, 3, 4, 5].map((x) => npc.board.get(x, 12));
    expect(tops).toEqual([0, 2, 0, 0, 3, 1]);
  });

  it('shatter their colour with a breaker and attack with it', () => {
    const attacks: number[] = [];
    const pairs: Array<[number, number]> = [...Array.from({ length: 20 }, (): [number, number] => [0, 0]), [BREAKER, 1]];
    const style = { ...skillStyle(100), pairMs: 100, breakAverage: 100, variation: 0, storeChance: 0 };
    const npc = new Npc(1, style, new Random(2), { nextPair: () => pairs.shift()!, attack: (a) => attacks.push(a.sprinkles + a.swords.reduce((n, [w, h]) => n + w * h, 0)) }, 0);
    npc.update(2100);
    expect(npc.stats.shattered).toBeGreaterThan(20);
    expect(attacks.length).toBe(1);
    expect(npc.board.cells.filter((p) => p === 0).length).toBeLessThan(20);
  });

  it('store breakers and set them off with the next clear as a chain', () => {
    const links: number[] = [];
    const pairs: Array<[number, number]> = [...Array.from({ length: 10 }, (): [number, number] => [0, 1]), [BREAKER | 1, 2], [BREAKER, 3]];
    const style = { ...skillStyle(50), pairMs: 100, breakAverage: 100, variation: 0, storeChance: 100, comboMax: 1, strikeShare: 0 };
    const npc = new Npc(1, style, new Random(3), { nextPair: () => pairs.shift()!, attack: (a) => links.push(a.sprinkles) }, 0);
    npc.update(1100);
    // The green breaker was stored; the red one can't be (one at most), so it goes off and takes the green with it.
    expect(npc.board.cells.some((p) => p === (BREAKER | 1))).toBe(true);
    npc.update(1200);
    expect(links.length).toBe(2);
    expect(npc.stats.bestChain).toBe(2);
    expect(npc.board.cells.some((p) => p === (BREAKER | 1))).toBe(false);
  });

  it('send their style: all sprinkles, or swords', () => {
    for (const share of [0, 100]) {
      const sent: Array<{ swords: number; sprinkles: number }> = [];
      const pairs: Array<[number, number]> = [...Array.from({ length: 30 }, (): [number, number] => [0, 0]), [BREAKER, 1]];
      const style = { ...skillStyle(50), pairMs: 100, breakAverage: 100, variation: 0, storeChance: 0, strikeShare: share };
      const npc = new Npc(1, style, new Random(4), { nextPair: () => pairs.shift()!, attack: (a) => sent.push({ swords: a.swords.length, sprinkles: a.sprinkles }) }, 0);
      npc.update(3100);
      if (share === 0) expect(sent[0].swords).toBe(0);
      else expect(sent[0].swords).toBeGreaterThan(0);
    }
  });
});

describe("the game-numbers opponents", () => {
  const filled = (n: number): Array<[number, number]> => Array.from({ length: n }, (): [number, number] => [0, 0]);

  it('destroy between the base and maximum of their colour', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const pairs = [...filled(20), [BREAKER, 1] as [number, number]];
      const style = { ...gameSkillStyle(50), pairMs: 100, chainChance: 0 };
      const npc = new GameNpc(1, style, new Random(seed), { nextPair: () => pairs.shift()!, attack: () => {} }, 0);
      npc.update(2100);
      // 40 reds, 30% to 60% of them shattered, plus the breaker.
      expect(npc.stats.shattered).toBeGreaterThanOrEqual(12 + 1);
      expect(npc.stats.shattered).toBeLessThanOrEqual(24 + 1);
    }
  });

  it("clear only the breaker's colour, sending some clears as chained", () => {
    const sent: number[] = [];
    for (const chain of [0, 100]) {
      const pairs: Array<[number, number]> = [...Array.from({ length: 10 }, (): [number, number] => [0, 1]), [BREAKER, 2]];
      const style = { ...gameSkillStyle(50), pairMs: 100, baseDestroy: 100, maxDestroy: 100, chainChance: chain, strikeShare: 0 };
      const npc = new GameNpc(1, style, new Random(1), { nextPair: () => pairs.shift()!, attack: (a) => sent.push(a.sprinkles) }, 0);
      npc.update(1100);
      expect(npc.board.cells.filter((p) => p === 1).length).toBe(10);
      expect(npc.board.cells.filter((p) => p === 0).length).toBe(0);
    }
    expect(sent[1]).toBe(sent[0] * 2);
  });

  it('play more slowly while targeted', () => {
    const npc = new GameNpc(1, { ...gameSkillStyle(50), pairMs: 1000, targetedSlowdown: 100 }, new Random(1), { nextPair: () => [0, 1], attack: () => {} }, 0);
    npc.targeted = () => 1;
    npc.update(10_000);
    expect(npc.stats.pairs).toBe(5);
  });
});

describe('a fight', () => {
  it('uses each NPC’s chosen skill and sword independently of their team or type', () => {
    const m = new Match({ ...settings, opponentType: 'game', opponents: 3,
      allyRoster: [{ kind: 'Cultist', skill: 20, sword: 11 }, { kind: 'Homunculus', skill: 75, sword: 2 }],
      enemyRoster: [{ kind: 'Thrall', skill: 90, sword: 6 }, { kind: 'Skilled swabbie', skill: 30, sword: 16 }, { kind: 'Custom', skill: 65, sword: 17 }],
    }, 9, 0);
    expect(m.kinds).toEqual(['You', 'Cultist', 'Homunculus', 'Thrall', 'Skilled swabbie', 'Custom']);
    expect(m.teams).toEqual([0, 0, 0, 1, 1, 1]);
    expect(m.swords.slice(1).map((sword) => sword.type)).toEqual([11, 2, 6, 16, 17]);
    for (const [i, skill] of [20, 75, 90, 30, 65].entries()) {
      const style = (m.fighters[i + 1] as GameNpc).style;
      expect(style.baseDestroy).toBe(gameSkillStyle(skill).baseDestroy);
      expect(style.maxDestroy).toBe(gameSkillStyle(skill).maxDestroy);
      expect(style.chainChance).toBe(gameSkillStyle(skill).chainChance);
    }
    expect(m.alive()).toEqual([3, 4, 5]);
    for (let i = 1; i < m.targets.length; i++) expect(m.teams[m.targets[i]]).not.toBe(m.teams[i]);
  });

  it('randomises NPC sword colours by fight seed and reproduces them for playback', () => {
    const rosterSettings: MatchSettings = { ...settings,
      enemyRoster: [{ kind: 'Cultist', skill: 60, sword: 11 }, { kind: 'Custom', skill: 40, sword: null }], allyRoster: [], opponents: 2,
    };
    const colours = new Set<string>();
    const randomTypes = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const a = new Match(rosterSettings, seed, 0);
      const b = new Match(rosterSettings, seed, 0);
      expect(a.swords).toEqual(b.swords);
      expect(a.looks).toEqual(b.looks);
      expect(a.names).toEqual(b.names);
      expect(a.swords[1].type).toBe(11);
      colours.add(`${a.swords[1].primary}/${a.swords[1].secondary}`);
      randomTypes.add(a.swords[2].type);
    }
    expect(colours.size).toBeGreaterThan(10);
    expect(randomTypes.size).toBeGreaterThan(5);
  });

  it('has cultists with spears and homunculi with trunks, in random colours', () => {
    const m = new Match({ ...settings, cultists: 2, homunculi: 1, opponents: 3 }, 9, 0);
    expect(m.names[0]).toBe('You');
    expect(m.names.slice(1, 3).every((n) => /^\S+ Cultist$/.test(n))).toBe(true);
    expect(m.names[3]).toMatch(/^\S+ Homunculus$/);
    expect(new Set(m.names).size).toBe(4);
    expect(m.swords.slice(1).map((s) => s.type)).toEqual([16, 16, 17]);
    const colours = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) for (const s of new Match({ ...settings, cultists: 2, homunculi: 1, opponents: 3 }, seed, 0).swords.slice(1)) colours.add(s.primary + '/' + s.secondary);
    expect(colours.size).toBeGreaterThan(10);
  });

  it('knocks out a player who does nothing, after taking attacks', () => {
    const { m, now } = play(3);
    expect(m.result).toBe('lost');
    expect(now).toBeLessThan(120_000);
  });

  it('plays out the same way from the same seed', () => {
    const a = play(11, 40_000, 3);
    const b = play(11, 40_000, 3);
    for (let i = 0; i < 4; i++) expect(Array.from(a.m.fighters[i].board.cells)).toEqual(Array.from(b.m.fighters[i].board.cells));
    expect(a.m.player.stats).toEqual(b.m.player.stats);
  });

  it('opponents send attacks', () => {
    const { m } = play(5, 90_000, 2);
    expect(m.player.stats.received).toBeGreaterThan(0);
  });
});

describe('knocked-out pirates', () => {
  it('move to the bottom of their side and cannot be targeted', () => {
    const m = new Match({ ...settings, cultists: 3, opponents: 3 }, 4, 0);
    expect(m.rows).toEqual([[0], [1, 2, 3]]);
    m.fighters[1].out = true;
    m.update(50);
    expect(m.rows[1]).toEqual([2, 3, 1]);
    m.setTarget(1);
    expect(m.target).not.toBe(1);
    m.fighters[3].out = true;
    m.update(100);
    expect(m.rows[1]).toEqual([2, 1, 3]);
    m.cycleTarget(1);
    expect(m.target).toBe(2);
  });

  it('are named and look the same from the same seed', () => {
    const a = new Match({ ...settings, cultists: 2, homunculi: 1, opponents: 3, swabbies: 2 }, 77, 0);
    const b = new Match({ ...settings, cultists: 2, homunculi: 1, opponents: 3, swabbies: 2 }, 77, 0);
    expect(a.names).toEqual(b.names);
    expect(a.looks).toEqual(b.looks);
  });
});

describe('attack queues', () => {
  it('count the attacks waiting to land on an enemy and their pieces', () => {
    const m = new Match({ ...settings, cultists: 1, opponents: 1 }, 5, 0);
    const enemy = m.fighters[1] as GameNpc;
    expect(enemy.queue).toEqual({ attacks: 0, blocks: 0 });
    enemy.receive({ from: 0, id: 1, strikes: [{ id: 1, width: 2, height: 4, x: 0, y: 0, orient: 0, pieces: [] }], sprinkles: 3 });
    enemy.receive({ from: 0, id: 2, strikes: [], sprinkles: 4 });
    expect(enemy.queue).toEqual({ attacks: 2, blocks: 15 });
  });
});

describe('AI skill from 0 to 100', () => {
  it("uses the game's destruction table at every 10 and blends in between", () => {
    expect(gameSkillStyle(60)).toMatchObject({ baseDestroy: 38, maxDestroy: 63, chainChance: 24 });
    expect(gameSkillStyle(70)).toMatchObject({ baseDestroy: 43, maxDestroy: 65, chainChance: 28 });
    expect(gameSkillStyle(65)).toMatchObject({ baseDestroy: 41, maxDestroy: 64, chainChance: 26 });
    expect(gameSkillStyle(100)).toMatchObject({ baseDestroy: 60, maxDestroy: 70, chainChance: 40 });
  });
});

describe('allies', () => {
  it('fight on your side, attack the enemies and can win without you', () => {
    const m = new Match({ ...settings, cultists: 1, opponents: 1, thralls: 2, swabbies: 1, opponentType: 'game' }, 21, 0);
    expect(m.kinds).toEqual(['You', 'Thrall', 'Thrall', 'Skilled swabbie', 'Cultist']);
    expect(m.names[1]).toMatch(/^\S+ Zombie$/);
    expect(m.names[3]).toMatch(/^\S+ \S+$/);
    expect(m.names[3]).not.toMatch(/Zombie|Cultist|Homunculus/);
    expect(m.teams).toEqual([0, 0, 0, 0, 1]);
    // Every ally targets the cultist; the cultist targets someone on your side.
    expect(m.targets.slice(1, 4)).toEqual([4, 4, 4]);
    expect(m.teams[m.targets[4]]).toBe(0);
    let now = 0;
    while (!m.result && now < 20 * 60_000) { now += 50; m.update(now); }
    expect(m.result).not.toBeNull();
    expect(m.fighters[4].stats.received).toBeGreaterThan(0);
  });
});
