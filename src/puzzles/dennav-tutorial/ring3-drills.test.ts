import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { NavigationGame } from '../navigation/game';
import { EMPTY, type Target } from '../navigation/logic';
import { INNER, MIDDLE, SETTINGS, TOP, generate, play, positionOf, settled, type Position } from './engine';
import { LESSONS, noStrayStacks } from './lessons';
import { dealFilled, judgeCombo, judgeFill, judgeStack, stackedColumns, verticalColumns } from './ring3-drills';

const lesson = (id: string) => LESSONS.find((l) => l.id === id)!;
const t = (ring: number, octant: number, colour: number): Target => ({ ring, octant, colour, wild: false });
/** 3/2/1 targets; beside the ring 3 target (octant 2), only octant 1 has no target in its column. */
const TARGETS = [t(INNER, 0, 1), t(INNER, 3, 2), t(INNER, 5, 4), t(MIDDLE, 7, 0), t(MIDDLE, 6, 3), t(TOP, 2, 2)];
const empty = (): Position => ({ cells: Array<number>(32).fill(EMPTY), targets: TARGETS.map((x) => ({ ...x })), entry: { colour: 0, octant: 4 } });

describe('Fill the targets', () => {
  it('waits, fails a wrong colour at once, and passes once every ring 1 and ring 2 target is filled', () => {
    const p = empty();
    expect(judgeFill(p).kind).toBe('building');
    p.cells[INNER * 8 + 0] = 3;
    expect(judgeFill(p)).toEqual({ kind: 'fail', message: 'That target wants an orange.', cells: [24] });
    for (const x of TARGETS) if (x.ring !== TOP) p.cells[x.ring * 8 + x.octant] = x.colour;
    expect(judgeFill(p).kind).toBe('pass'); // the ring 3 target is left for the combo
  });

  it('for the triple, needs only the ring 1 targets', () => {
    const p = empty();
    for (const x of TARGETS) if (x.ring === INNER) p.cells[x.ring * 8 + x.octant] = x.colour;
    expect(judgeFill(p).kind).toBe('building');
    expect(judgeFill(p, false).kind).toBe('pass');
  });
});

describe('Stack the pair', () => {
  it('is judged once ring 2 is full, and needs a pair stacked beside the ring 3 target in a column with no target', () => {
    expect(verticalColumns(TARGETS)).toEqual([1]);
    const p = empty();
    for (let o = 0; o < 8; o++) { p.cells[INNER * 8 + o] = o % 5; p.cells[MIDDLE * 8 + o] = (o + 1) % 5; }
    p.cells[MIDDLE * 8 + 7] = EMPTY;
    expect(judgeStack(p).kind).toBe('building');
    expect(judgeStack(p, true)).toMatchObject({ kind: 'fail', message: 'Ring 2 isn’t full.' });
    // Stacked at 7: not beside the ring 3 target.
    p.cells[MIDDLE * 8 + 7] = p.cells[INNER * 8 + 7];
    expect(stackedColumns(p.cells)).toEqual([7]);
    expect(judgeStack(p)).toMatchObject({ kind: 'fail', message: 'No pair stacked beside the ring 3 target.', cells: [INNER * 8 + 1, MIDDLE * 8 + 1] });
    p.cells[MIDDLE * 8 + 1] = p.cells[INNER * 8 + 1];
    expect(judgeStack(p).kind).toBe('pass');
  });

  it('matches the topic’s examples: the vertical is beside the ring 3 target, with no target in its column', () => {
    const rng = new Random(3);
    const l = lesson('drop-in-vertical');
    for (let i = 0; i < 10; i++) {
      const ex = generate(l.moments[i % l.moments.length], l.accepts, rng, l.keep);
      const vertical = play(ex.position, ex.action).links.find((x) => x.runs.some((r) => r.direction === 1))!.runs.find((r) => r.direction === 1)!;
      expect(verticalColumns(ex.position.targets)).toContain(vertical.octant);
    }
  });
});

describe('Build the combo', () => {
  it.each(['top-double', 'top-triple', 'drop-in-vertical'])('%s: its examples pass, and other combos fail with what they charted', (id) => {
    const l = lesson(id);
    for (const m of l.moments) expect(judgeCombo(play(m.position, m.action), l.accepts, l.title).kind).toBe('pass');
    // A single (the cascade topic's example) charts as something else.
    const other = lesson('cascade-single').moments[0];
    const judged = judgeCombo(play(other.position, other.action), l.accepts, l.title);
    expect(judged.kind).toBe('fail');
  });

  it('says what a move set off when it doesn’t chart', () => {
    const l = lesson('top-double');
    // Two of a colour stacked in rings 1 and 2 under a third dropped in: a vertical with nothing charted.
    const p: Position = { cells: Array<number>(32).fill(EMPTY), targets: TARGETS.map((x) => ({ ...x })), entry: { colour: 3, octant: 4 } };
    p.cells[INNER * 8 + 4] = 3; p.cells[MIDDLE * 8 + 4] = 3;
    const judged = judgeCombo(play(p, { kind: 'drop' }), l.accepts, l.title);
    expect(judged).toMatchObject({ kind: 'fail', message: 'A clear went off, but it didn’t chart.' });
  });

  it('deals filled boards from a 3-2-1 or a 1-2-1 start, with one stacked column for the vertical', () => {
    const rng = new Random(4);
    for (const opening of [false, true]) for (let seed = 1; seed <= 15; seed++) {
      const fresh = positionOf(new NavigationGame(SETTINGS, seed, undefined, opening));
      const p = dealFilled(rng, fresh)!;
      expect(p).not.toBeNull();
      expect(settled(p)).toBe(true);
      expect(judgeFill(p).kind).toBe('pass');
      const v = dealFilled(rng, fresh, true);
      // Only boards with a column beside the ring 3 target free of targets can take the vertical.
      if (!verticalColumns(fresh.targets).length) { expect(v).toBeNull(); continue; }
      expect(v).not.toBeNull();
      expect(stackedColumns(v!.cells).some((o) => verticalColumns(fresh.targets).includes(o))).toBe(true);
      expect([0, 1, 2, 3, 4, 5, 6, 7].every((o) => v!.cells[TOP * 8 + o] === EMPTY)).toBe(true);
    }
  });

  it('deals Ring 3 double boards with no pair stacked in rings 1 and 2 unless the targets force it', () => {
    const rng = new Random(11);
    for (const opening of [false, true]) for (let seed = 1; seed <= 15; seed++) {
      const fresh = positionOf(new NavigationGame(SETTINGS, seed, undefined, opening));
      const p = dealFilled(rng, fresh, false, true)!;
      expect(p).not.toBeNull();
      expect(noStrayStacks(p)).toBe(true);
      expect(judgeFill(p).kind).toBe('pass');
    }
  });

  it('generated double and triple examples have their ring 1 and ring 2 targets filled before the move, as Fill the targets asks', () => {
    const rng = new Random(2);
    for (const id of ['top-double', 'top-triple']) {
      const l = lesson(id);
      for (let i = 0; i < 10; i++) {
        const ex = generate(l.moments[i % l.moments.length], l.accepts, rng, l.keep);
        // The triple's second clear is in ring 3, so it can still turn ring 2 targets under it wild.
        const needed = (x: Target) => (id === 'top-triple' ? x.ring === INNER : x.ring !== TOP);
        const open = ex.position.targets.filter((x) => needed(x) && !x.wild && ex.position.cells[x.ring * 8 + x.octant] !== x.colour);
        expect(open, id).toEqual([]);
      }
    }
  });
});
