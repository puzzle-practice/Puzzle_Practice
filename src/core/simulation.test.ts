import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { Match as SwordMatch, type MatchSettings } from '../puzzles/swordfight/match';
import { gameSkillStyle, skillStyle } from '../puzzles/swordfight/npc';
import { Match as RumbleMatch, type MatchSettings as RumbleSettings } from '../puzzles/rumble/match';
import { DEFAULT_STYLE } from '../puzzles/rumble/npc';

const swordSettings: MatchSettings = { cultists: 1, homunculi: 0, opponents: 1, thralls: 0, swabbies: 0, cultistSkill: 60, homunculusSkill: 60, thrallSkill: 50, swabbieSkill: 50, opponentType: 'tally', ai: skillStyle(60), gameAi: gameSkillStyle(60), difficulty: 5, breakers: 12.5, sword: [2, 0, 0] };
const rumbleSettings: RumbleSettings = { enemyRoster: [{ kind: 'Brigand', skill: 60, bludgeon: null }, { kind: 'Barbarian', skill: 60, bludgeon: null }], allyRoster: [{ kind: 'Skilled swabbie', skill: 80, bludgeon: null }], ai: { ...DEFAULT_STYLE }, rules: { timeBonus: true, suppression: true, dropOffToAttackers: true, defence: true, defenceSquares: 90, side: 'random' }, oneFisted: false, werewolf: false, rumless: false, damageLevel: 0, startRows: 3, bludgeon: [127, 0] };

describe('fixed simulation timeline', () => {
  it('retains catch-up debt after a long browser stall', () => {
    const sim = new Simulation(); const seen: number[] = [];
    sim.advance(10000, t => seen.push(t)); expect(sim.time).toBe(4000);
    while (sim.time < 10000) sim.advance(10000, t => seen.push(t));
    expect(seen).toHaveLength(600); expect(seen.at(-1)).toBe(10000);
  });
  it.each(['sword', 'rumble'] as const)('%s preserves boards, scores and end times at different render rates and after stalls', kind => {
    const run = (hz: number, stalls = false) => {
      const sim = new Simulation();
      const m = kind === 'sword' ? new SwordMatch(structuredClone(swordSettings), 11, 0) : new RumbleMatch(structuredClone(rumbleSettings), 99, 0);
      let nextAction = 500, action = 0;
      const step = (at: number) => {
        if (at >= nextAction) {
          nextAction += 500; action++;
          if (m instanceof SwordMatch) {
            m.player.move(action % 2 ? 1 : -1, at);
            if (action % 3 === 0) m.player.rotate(true, at);
            m.player.setFast(action % 2 === 0, at);
          } else {
            m.player.aimAt(45 + action * 13 % 300, 200);
            m.player.press(action % 2, at); m.player.release(action % 2, at);
          }
        }
        m.update(at);
      };
      for (let i = 0; i <= 60 * hz; i++) {
        const wall = i * 1000 / hz;
        if (stalls && wall % 5000 < 1700) continue;
        sim.advance(wall, step);
      }
      while (sim.time < 60000) sim.advance(60000, step);
      return { boards: m.fighters.map(f => Array.from(f.board.cells)), stats: m.fighters.map(f => f.stats), result: m.result, endedAt: m.endedAt };
    };
    const expected = run(60);
    expect(run(30)).toEqual(expected); expect(run(144)).toEqual(expected); expect(run(30, true)).toEqual(expected);
  });
});
