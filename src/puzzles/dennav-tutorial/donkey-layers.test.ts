import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { EMPTY, type Target } from '../navigation/logic';
import { INNER, MIDDLE, TOP } from './engine';
import { donkeyGame } from './donkey-practice';
import { dealBase, judgeBasePosition, judgeLayer2, layer2Warnings, readings, rolesFor, scrambleBase, type DealtBase } from './donkey-layers';

// Colours: 0 blue, 1 orange, 2 red, 3 white, 4 yellow.
// The base: going round from octant 0, D C C B B A A E = white red red orange orange blue blue yellow.
// The combo travels from D (white, octant 0) up the octants, away from E (yellow, octant 7):
// C2 1, C1 2, B2 3, B1 4, A2 5, A1 6.
const RING1 = [3, 2, 2, 1, 1, 0, 0, 4];
const t = (ring: number, octant: number, colour: number): Target => ({ ring, octant, colour, wild: false });
/** 3/2/1 targets with a ring 2 target over A2 (octant 5): it waits for the last clear. */
const TARGETS = [t(INNER, 0, 1), t(INNER, 1, 3), t(INNER, 3, 2), t(MIDDLE, 5, 2), t(MIDDLE, 2, 4), t(TOP, 3, 0)];

/** Ring 2 and ring 1 as given (ring 2 octant 0 first), turned by k1 and k2. */
function board(ring2: number[], k1 = 0, k2 = 0): number[] {
  const cells = Array<number>(32).fill(EMPTY);
  for (let o = 0; o < 8; o++) {
    cells[INNER * 8 + ((o + k1) % 8)] = RING1[o];
    cells[MIDDLE * 8 + ((o + k2) % 8)] = ring2[o];
  }
  return cells;
}
const _ = EMPTY;
/** Ring 2 one turn before the trigger: its white (D) over ring 1's yellow (E), its yellow one place on. */
const BASE2 = [_, _, _, _, _, _, 4, 3];

describe('donkey base roles', () => {
  it('reads either leftover as the one broken', () => {
    const roles = rolesFor(RING1, 0)!;
    expect(roles).toMatchObject({ step: 1, D: 0, E: 7, C2: 1, C1: 2, B2: 3, B1: 4, A2: 5, A1: 6, colours: { A: 0, B: 1, C: 2, D: 3, E: 4 } });
    expect(readings(RING1).map((r) => r.D).sort()).toEqual([0, 7]);
  });
});

describe('lesson 3: position the base', () => {
  it('passes with a target waiting for the last clear and ring 2 one turn before the trigger', () => {
    expect(judgeBasePosition(board(BASE2), TARGETS)).toEqual({ kind: 'pass' });
  });

  it('fails when ring 2’s D isn’t over ring 1’s E', () => {
    expect(judgeBasePosition(board(BASE2, 0, 1), TARGETS)).toMatchObject({ kind: 'fail', message: 'Ring 2’s white goes over ring 1’s yellow.' });
  });

  it('fails when no target waits for the last clear', () => {
    // Nothing in the A columns either way the base is read (A1/A2 at 6/5, or 1/2 with yellow broken):
    // everything has gone wild or is filled by link 3.
    const early = [t(INNER, 0, 1), t(INNER, 3, 3), t(INNER, 4, 2), t(MIDDLE, 3, 2), t(MIDDLE, 4, 4), t(TOP, 7, 0)];
    expect(judgeBasePosition(board(BASE2), early)).toMatchObject({ kind: 'fail', message: 'Nothing waits for the last clear.' });
  });

  it('accepts a ring 1 target on A1 only if it isn’t A’s colour', () => {
    const ring1Wait = [t(INNER, 6, 2), t(INNER, 1, 3), t(INNER, 3, 2), t(MIDDLE, 1, 2), t(MIDDLE, 2, 4), t(TOP, 7, 0)];
    expect(judgeBasePosition(board(BASE2), ring1Wait).kind).toBe('pass');
    const filled = ring1Wait.map((x) => (x.ring === INNER && x.octant === 6 ? { ...x, colour: 0 } : x));
    expect(judgeBasePosition(board(BASE2), filled).kind).toBe('fail');
  });

  it('deals bases from a 3-2-1 or a 1-2-1 start', () => {
    const rng = new Random(8);
    for (const opening of [false, true]) {
      let dealt = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const targets = donkeyGame(seed, opening).targets;
        const base = dealBase(rng, targets);
        if (!base) continue;
        dealt++;
        expect(judgeBasePosition(base.cells, targets).kind).toBe('pass');
      }
      expect(dealt, opening ? '1-2-1' : '3-2-1').toBeGreaterThan(20);
    }
  });

  it('deals bases in position and scrambles them out of it', () => {
    const rng = new Random(5);
    for (let i = 0; i < 30; i++) {
      const dealt = dealBase(rng, TARGETS);
      if (!dealt) continue;
      expect(judgeBasePosition(dealt.cells, TARGETS).kind).toBe('pass');
      const scrambled = scrambleBase(rng, dealt.cells, TARGETS)!;
      expect(judgeBasePosition(scrambled, TARGETS).kind).toBe('fail');
    }
  });
});

describe('lesson 4: build layer 2', () => {
  const base: DealtBase = { roles: rolesFor(RING1, 0)!, ring1: RING1, d2: 7, e2: 6 };
  // Drop-ins: over C2 (octant 1) an orange (B), over B2 (octant 3) a blue (A). The yellow at 4 goes over
  // A2 at trigger time, leaving the red target there waiting.
  const GOOD = [4, 1, 0, 0, 3, 1, 4, 3];
  const judge = (ring2: number[], final = false, k1 = 0, k2 = 0) => judgeLayer2(board(ring2, k1, k2), TARGETS, base, { ring1: k1, ring2: k2 }, final);

  it('passes a good layer 2, however the rings are turned', () => {
    expect(judge(GOOD)).toEqual({ kind: 'pass' });
    expect(judge(GOOD, false, 0, 3).kind).toBe('pass');
  });

  it('waits until ring 2 is full, unless submitted', () => {
    const part = [_, 1, _, 0, _, _, 4, 3];
    expect(judge(part).kind).toBe('building');
    expect(judge(part, true)).toMatchObject({ kind: 'fail', message: 'Ring 2 isn’t full.' });
  });

  it('fails a missing or wrong drop-in star', () => {
    expect(judge([_, 1, _, _, _, _, 4, 3], true)).toMatchObject({ kind: 'fail', message: 'The blue that drops in after the oranges is missing.', cells: [16 + 3] });
    expect(judge([_, 0, _, _, _, _, 4, 3])).toMatchObject({ kind: 'fail', message: 'This one drops in after the reds: it must be orange.', cells: [16 + 1, 24 + 2] });
  });

  it('only warns about a star over its own colour at trigger time, or one turn before', () => {
    const warn = (ring2: number[]) => layer2Warnings(board(ring2), base, { ring1: 0, ring2: 0 });
    // At trigger time the star at 0 goes over ring 1's red at 1.
    expect(judge([2, _, _, _, _, _, 4, 3]).kind).toBe('building');
    expect(warn([2, _, _, _, _, _, 4, 3])).toEqual([{ message: 'Careful: red over red when the combo goes off.', cells: [16, 24 + 1] }]);
    // One turn before, the star at 2 sits over ring 1's red at 2.
    expect(judge([_, _, 2, _, _, _, 4, 3]).kind).toBe('building');
    expect(warn([_, _, 2, _, _, _, 4, 3])).toEqual([{ message: 'Careful: red over red one turn before the combo.', cells: [16 + 2, 24 + 2] }]);
    // A full layer with a stack still passes.
    const stacked = [2, 1, 0, 0, 3, 1, 4, 3];
    expect(judge(stacked).kind).toBe('pass');
    expect(warn(stacked)).toHaveLength(1);
    expect(warn(GOOD)).toEqual([]);
  });

  it('fails a layer that fills the waiting target early', () => {
    expect(judge([4, 1, 0, 0, 2, 1, 4, 3])).toMatchObject({ kind: 'fail', message: 'Nothing waits for the last clear now.' });
  });
});
