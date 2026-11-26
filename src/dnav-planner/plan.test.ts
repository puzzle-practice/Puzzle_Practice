import { describe, expect, it } from 'vitest';
import { lineName, mostWithin, plan, wave, type Times } from './plan';

const DEFAULTS: Times = { booch: 9, single: 12, cascade: -1, double: -1, triple: 40, bingo: -1, donkey: 51, vegas: -1 };

describe('Solo Dnav Planner', () => {
  it('sizes waves from the crew, with a minimum pack of four', () => {
    const w = wave(1, 2);
    expect(w.wolves).toBeCloseTo(4 * 1.3 * 0.6);
    expect(w.need).toBeCloseTo(w.total - 100);
    expect(w.time).toBe(120);
    expect(wave(1, 3).time).toBe(300);
    expect(wave(1, 2)).toEqual(wave(4, 2));
    // 2:00 plus 3:00 shared by the survivors; fray 2 always gets 2:00.
    expect(wave(4, 3, 1).time).toBe(120 + 135);
    expect(wave(4, 2, 3).time).toBe(120);
  });

  it('finds the three fastest lines, fastest first', () => {
    const lines = plan(wave(4, 2).need, DEFAULTS);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.pts).toBeGreaterThanOrEqual(wave(4, 2).need);
    expect(lines.map((l) => l.t)).toEqual([...lines.map((l) => l.t)].sort((a, b) => a - b));
  });

  it('scores a Booch-donkey off a Booch board, adding the Booch time', () => {
    const [line] = plan(600, { ...DEFAULTS, triple: -1, single: -1 });
    expect(line.steps).toEqual([{ what: 'Booch-donkey', move: 'Booch-donkey', t: 60, pts: 625 }]);
  });

  it('names lines the way Gizmo names its strategies', () => {
    const [line] = plan(1000, { ...DEFAULTS, donkey: -1, single: -1 });
    expect(lineName(line)).toMatch(/^(Booch, )?\d Triples?$/);
  });

  it('clears with singles alone', () => {
    const singles: Times = { booch: 9, single: 12, cascade: 20, double: -1, triple: -1, bingo: -1, donkey: -1, vegas: -1 };
    for (let fray = 2; fray <= 4; fray++) {
      const w = wave(4, fray);
      const [line] = plan(w.need, singles);
      expect(line.t).toBeLessThanOrEqual(w.time);
      expect(line.steps.every((s) => ['Single', 'Cascade single', 'Booch'].includes(s.move))).toBe(true);
      expect(line.steps.slice(0, -1).some((s) => s.move === 'Single')).toBe(false);
    }
  });

  it('finds the most points in the time when a wave cannot be cleared', () => {
    const slow: Times = { booch: -1, single: -1, cascade: 100, double: -1, triple: -1, bingo: -1, donkey: -1, vegas: -1 };
    const line = mostWithin(300, slow)!;
    expect(line.steps.map((s) => s.t)).toEqual([100, 200, 300]);
    expect(line.pts).toBe(71 + 125 + 125);
    expect(mostWithin(50, slow)).toBeNull();
    // A finishing single can end the time, but nothing comes after it.
    expect(mostWithin(300, { ...slow, cascade: -1, single: 100 })!.steps.map((s) => s.t)).toEqual([100]);
  });

  it('leaves out a line that only adds a Booch to a faster one', () => {
    const singles: Times = { booch: 9, single: 12, cascade: 25, double: -1, triple: -1, bingo: -1, donkey: -1, vegas: -1 };
    const names = plan(wave(4, 3).need, singles).map(lineName);
    const scoring = names.map((name) => name.replace(/^Booch, /, ''));
    expect(new Set(scoring).size).toBe(names.length);
  });

  it('counts a cascade single and a finishing single as the same clear', () => {
    const times: Times = { ...DEFAULTS, cascade: 25, triple: -1 };
    const lines = plan(wave(4, 3).need, times);
    const singlesAndDonkeys = lines.filter((l) => l.steps.every((s) => ['Booch-donkey', 'Single', 'Cascade single'].includes(s.move)));
    const keys = singlesAndDonkeys.map((l) => l.steps.filter((s) => s.move !== 'Booch').map((s) => (s.move === 'Cascade single' ? 'Single' : s.move)).sort().join());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has nothing to offer when no move is timed', () => {
    expect(plan(1000, { booch: -1, single: -1, cascade: -1, double: -1, triple: -1, bingo: -1, donkey: -1, vegas: -1 })).toEqual([]);
  });
});
