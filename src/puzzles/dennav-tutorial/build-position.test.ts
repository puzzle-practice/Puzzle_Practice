import { describe, expect, it } from 'vitest';
import { EMPTY } from '../navigation/logic';
import { INNER, MIDDLE, TOP, gameAt, innerRun, outcome, positionOf, wildedBy, type Position } from './engine';
import { LESSONS } from './lessons';
import { paintPlan, planningOptions, type PlanningOption } from './planning';
import { BESIDE_FAIL, buildIssue, buildOptionsFor, builtComboIssue, checkBuildPosition, checkBuildTurned, solutionsFor, unturnedCell } from './build-position';

const targets = [
  { ring: INNER, octant: 0, colour: 2, wild: false },
  { ring: MIDDLE, octant: 2, colour: 1, wild: false },
  { ring: MIDDLE, octant: 7, colour: 4, wild: false },
  { ring: TOP, octant: 5, colour: 1, wild: false },
];
const horizontal = innerRun(0);
const plan: PlanningOption = {
  site: { horizontal, vertical: [25, 17, 9], top: 1, wilded: wildedBy(targets, horizontal) },
  verticalColour: 0, horizontalColour: 2,
};
const position = (): Position => ({ cells: paintPlan(plan.site, 0, 2), targets: targets.map((t) => ({ ...t })), entry: { colour: 0, octant: 0 } });

describe('Build Ring 1 submission checks', () => {
  it('allows the planned pair and vertical, including their intentional stack', () => {
    const p = position();
    expect(buildIssue(p, plan)).toBeNull();
    p.cells[17] = 0;
    expect(buildIssue(p, plan)).toBeNull();
    p.cells[9] = 0; p.cells[1] = 2;
    expect(buildIssue(p, plan)).toBeNull();
  });

  it('rejects a blue support beneath a blue target outside the planned wild area', () => {
    for (const ring of [MIDDLE, TOP]) {
      const p = position();
      p.targets.push({ ring, octant: 4, colour: 0, wild: false });
      const below = (ring + 1) * 8 + 4;
      p.cells[below] = 0;
      expect(p.cells[ring * 8 + 4]).toBe(EMPTY);
      expect(buildIssue(p, plan)).toEqual({ message: 'Blue below a blue target.', cells: [below, ring * 8 + 4] });
    }
  });

  it('allows matching supports beneath future wild targets but still rejects actual stacked pieces', () => {
    const p = position(); p.cells[26] = 1;
    expect(buildIssue(p, plan)).toBeNull();
    p.cells[24] = 3; // Keep another target wrong so the separate stack check is reached.
    p.cells[18] = 1;
    expect(buildIssue(p, plan)?.message).toBe('Unnecessary vertical pair.');
  });

  it('accepts the screenshot: the blue support is beneath a target that the blue horizontal will wild', () => {
    const p: Position = {
      cells: Array<number>(32).fill(EMPTY), entry: { colour: 0, octant: 0 },
      targets: [
        { ring: INNER, octant: 3, colour: 0, wild: false },
        { ring: INNER, octant: 2, colour: 2, wild: false },
        { ring: INNER, octant: 5, colour: 4, wild: false },
        { ring: MIDDLE, octant: 5, colour: 0, wild: false },
        { ring: MIDDLE, octant: 7, colour: 2, wild: false },
        { ring: TOP, octant: 6, colour: 3, wild: false },
      ],
    };
    [1, 3, 2, 0, 4, 0, 3, 4].forEach((colour, octant) => { p.cells[INNER * 8 + octant] = colour; });
    p.cells[MIDDLE * 8 + 7] = 2;
    const result = checkBuildPosition(p, planningOptions(p.targets));
    expect(result.kind).toBe('complete');
    if (result.kind === 'complete') {
      expect(result.plan.site.top).toBe(4);
      expect(result.plan.verticalColour).toBe(4);
      expect(result.plan.horizontalColour).toBe(0);
      expect(result.plan.site.wilded).toContainEqual(p.targets[3]);
    }
    // Completing the setup with the blue target filled wrong produces a real triple.
    const complete = { ...p, cells: [...p.cells] };
    complete.cells[4] = 0;
    complete.cells[12] = complete.cells[20] = 4;
    complete.cells[13] = complete.cells[14] = 3;
    complete.cells[19] = complete.cells[21] = complete.cells[22] = 1;
    const game = gameAt(complete);
    const lesson = LESSONS.find((l) => l.id === 'vertical-triple')!;
    expect(lesson.accepts(outcome(game.settle(), positionOf(game)))).toBe(true);
  });

  it('fails unnecessary stacked pairs anywhere outside the planned vertical', () => {
    for (const upper of [0, 1, 2]) {
      const p = position();
      p.cells[upper * 8 + 3] = 3; p.cells[(upper + 1) * 8 + 3] = 3;
      expect(buildIssue(p, plan)?.message).toBe('Unnecessary vertical pair.');
    }
  });

  it('checks wrong target fills and clears away from the combo', () => {
    const wrong = position(); wrong.cells[23] = 2;
    expect(buildIssue(wrong, plan)?.message).toBe('Wrong colour on a target outside the wild area.');
    const run = position(); run.cells[28] = run.cells[29] = run.cells[30] = 3;
    expect(buildIssue(run, plan)?.message).toBe('That clears outside the planned vertical.');
  });

  it('finishes at the three planned ring 1 stars without requiring the upper vertical', () => {
    const p = position();
    expect(p.cells.slice(0, INNER * 8).every((colour) => colour === EMPTY)).toBe(true);
    expect(checkBuildPosition(p, [plan])).toEqual({ kind: 'complete', plan });
    p.cells[25] = EMPTY;
    expect(checkBuildPosition(p, [plan])).toEqual({ kind: 'building' });
  });

  it('does not award the three-star plan while a filler piece elsewhere is wrong', () => {
    const p = position();
    p.targets.push({ ring: MIDDLE, octant: 4, colour: 0, wild: false });
    p.cells[28] = 0;
    const checked = checkBuildPosition(p, [plan]);
    expect(checked.kind).toBe('failed');
    if (checked.kind === 'failed') expect(checked.issue.message).toBe('Blue below a blue target.');
  });

  it('rejects an extra stack even with the correct three-star plan already present', () => {
    const p = position(); p.cells[27] = p.cells[19] = 3;
    const checked = checkBuildPosition(p, [plan]);
    expect(checked.kind).toBe('failed');
    if (checked.kind === 'failed') expect(checked.issue.message).toBe('Unnecessary vertical pair.');
  });

  it('accepts any clean Mode 2 layout rather than only the first option', () => {
    const other: PlanningOption = { ...plan, verticalColour: 3 };
    const p = position(); p.cells[25] = 3;
    expect(checkBuildPosition(p, [plan, other])).toEqual({ kind: 'complete', plan: other });
  });

  it('judges the built red vertical rather than reporting another layout’s stack warning', () => {
    const t = (ring: number, octant: number, colour: number) => ({ ring, octant, colour, wild: false });
    const p: Position = {
      cells: Array<number>(32).fill(EMPTY), entry: { colour: 0, octant: 0 },
      targets: [t(INNER, 1, 4), t(INNER, 6, 2), t(INNER, 7, 1), t(MIDDLE, 4, 3), t(MIDDLE, 2, 4), t(TOP, 2, 1)],
    };
    [2, 4, 3, 1, 3, EMPTY, 0, 0].forEach((colour, octant) => { p.cells[INNER * 8 + octant] = colour; });
    p.cells[MIDDLE * 8] = 2;
    const options = planningOptions(p.targets);
    expect(checkBuildPosition(p, options)).toEqual({ kind: 'failed', issue: { message: 'White below a white target.', cells: [28, 20] } });
    p.cells[28] = 4;
    const accepted = checkBuildPosition(p, options);
    expect(accepted.kind).toBe('complete');
    if (accepted.kind === 'complete') {
      expect(accepted.plan.verticalColour).toBe(2);
      expect(accepted.plan.site.vertical).toEqual([24, 16, 8]);
    }
    p.cells[29] = p.cells[21] = 3;
    expect(checkBuildPosition(p, options)).toEqual({ kind: 'failed', issue: { message: 'Unnecessary vertical pair.', cells: [21, 29] } });
  });

  it('names the reused ring 3 colour when the player builds the vertical in it', () => {
    const t = (ring: number, octant: number, colour: number) => ({ ring, octant, colour, wild: false });
    const p: Position = {
      cells: Array<number>(32).fill(EMPTY), entry: { colour: 1, octant: 1 },
      targets: [t(INNER, 0, 0), t(INNER, 4, 1), t(INNER, 6, 4), t(MIDDLE, 3, 2), t(MIDDLE, 4, 1), t(TOP, 2, 3)],
    };
    [0, 4, 2, 1, 1, 3, 4, 2].forEach((colour, octant) => { p.cells[INNER * 8 + octant] = colour; });
    p.cells[MIDDLE * 8 + 5] = 3; p.cells[MIDDLE * 8 + 6] = 0;
    const checked = checkBuildPosition(p, planningOptions(p.targets));
    expect(checked.kind).toBe('failed');
    if (checked.kind === 'failed') {
      expect(checked.issue.message).toBe('Ring 3 colour reused. Save white for the ring 3 target.');
      expect(checked.issue.cells).toEqual(expect.arrayContaining([29, 21, TOP * 8 + 2]));
    }
  });

  it('on Enter, says the bare ring 1 combo spends white needed outside the wild area', () => {
    const t = (ring: number, octant: number, colour: number) => ({ ring, octant, colour, wild: false });
    const p: Position = {
      cells: Array<number>(32).fill(EMPTY), entry: { colour: 0, octant: 0 },
      targets: [t(3, 6, 0), t(3, 7, 0), t(3, 4, 1), t(2, 3, 3), t(2, 2, 4), t(1, 1, 4)],
    };
    p.cells[25] = 4; p.cells[28] = 1; p.cells[29] = 3; p.cells[30] = 1;
    // Other plans are still open, so it is not a mid-build failure...
    expect(checkBuildPosition(p, planningOptions(p.targets))).toEqual({ kind: 'building' });
    // ...but submitting it explains the built combo's planning fault.
    const issue = builtComboIssue(p);
    expect(issue?.message).toBe('Save white for targets outside the wild area.');
    expect(issue?.cells).toEqual(expect.arrayContaining([28, 29, 30]));
  });

  it('judges ring 2 in its most logical position when it has not been turned into place', () => {
    const t = (ring: number, octant: number, colour: number) => ({ ring, octant, colour, wild: false });
    const p: Position = {
      cells: Array<number>(32).fill(EMPTY), entry: { colour: 0, octant: 2 },
      targets: [t(3, 0, 3), t(3, 6, 4), t(3, 5, 3), t(2, 2, 2), t(2, 5, 0), t(1, 1, 4)],
    };
    p.cells[17] = 2; p.cells[20] = 0;
    [1, 4, 4, 2, 0, 3, 1, 3].forEach((colour, octant) => { p.cells[24 + octant] = colour; });
    const options = planningOptions(p.targets);
    expect(checkBuildPosition(p, options)).toEqual({ kind: 'failed', issue: { message: 'Unnecessary vertical pair.', cells: [20, 28] } });
    const judged = checkBuildTurned(p, options);
    expect(judged.turns).toBe(1);
    expect(judged.check.kind).not.toBe('failed');
    expect(judged.position.cells[18]).toBe(2);
    expect(judged.position.cells[21]).toBe(0);
    expect(p.cells[17]).toBe(2);
    // The combo built is the orange pair (S, E) around a white vertical at SE, not the yellow
    // pair at NE/N. It turns 3 targets wild; SW–S–SE would also wild the ring 2 SW target.
    const issue = builtComboIssue(judged.position, 1, options);
    expect(issue).toEqual({ message: 'This turns 3 targets wild. A valid plan can turn 4 wild.', cells: [30, 31, 24] });
    expect(unturnedCell(18, judged.turns)).toBe(17);
    expect(unturnedCell(30, judged.turns)).toBe(30);
  });

  it('leaves a ring 2 already in place unturned', () => {
    const p = position();
    expect(checkBuildTurned(p, [plan]).turns).toBe(0);
  });

  it('on Enter, judges the ring 1 combo actually built rather than an unbuilt plan’s hazard', () => {
    const t = (ring: number, octant: number, colour: number) => ({ ring, octant, colour, wild: false });
    const p: Position = {
      cells: Array<number>(32).fill(EMPTY), entry: { colour: 4, octant: 3 },
      targets: [t(3, 5, 3), t(3, 0, 3), t(3, 2, 2), t(2, 6, 0), t(2, 0, 4), t(1, 5, 2)],
    };
    p.cells[22] = 0; p.cells[23] = 4;
    [1, 4, 1, 3, 2, 3, 2, 0].forEach((colour, octant) => { p.cells[24 + octant] = colour; });
    const options = planningOptions(p.targets);
    // Mid-build, the hazard against the accepted SE plan stands.
    expect(checkBuildPosition(p, options)).toEqual({ kind: 'failed', issue: { message: 'Wrong colour on a target outside the wild area.', cells: [26] } });
    // Submitted: the orange pair (E, N) around a yellow vertical at NE is what was built. It
    // works, but only turns 3 targets wild; the S–SE–E horizontal turns 4.
    const judged = checkBuildTurned(p, options, true);
    expect(judged.check).toEqual({ kind: 'failed', issue: { message: 'This turns 3 targets wild. A valid plan can turn 4 wild.', cells: expect.arrayContaining([24, 25, 26]) } });
    // The built combo does chart as a vertical triple once finished; the orange on the N red target turns wild.
    const finished = { ...p, cells: [...p.cells] };
    finished.cells[17] = finished.cells[9] = 4; finished.cells[1] = 1;
    finished.cells[21] = 1; finished.cells[13] = 2;
    finished.cells[16] = 3; finished.cells[8] = 2; finished.cells[18] = 3;
    const game = gameAt(finished);
    const result = outcome(game.settle(), positionOf(game));
    expect(result.charted).toBe(3);
    expect(result.links[1].wilded).toContainEqual(expect.objectContaining({ ring: 3, octant: 2 }));
  });

  it('Show solution offers the accepted plan closest to the combo built first', () => {
    const t = (ring: number, octant: number, colour: number) => ({ ring, octant, colour, wild: false });
    const p: Position = {
      cells: Array<number>(32).fill(EMPTY), entry: { colour: 4, octant: 4 },
      targets: [t(3, 7, 0), t(3, 4, 4), t(3, 3, 3), t(2, 5, 4), t(2, 1, 2), t(1, 7, 2)],
    };
    p.cells[22] = 1;
    [2, 4, 2, 3, 3, 0, 1, 0].forEach((colour, octant) => { p.cells[24 + octant] = colour; });
    const options = planningOptions(p.targets);
    // Built: blue pair SW/SE around an orange vertical at S, with the horizontal under the ring 3 SE target.
    expect(builtComboIssue(p, 1, options)?.message).toBe('Move the horizontal away from underneath the ring 3 target.');
    const [first] = solutionsFor(p, options);
    expect(first.site.horizontal).toEqual([28, 29, 30]);
    expect(first.site.vertical[0]).toBe(30);
    expect([first.verticalColour, first.horizontalColour]).toEqual([1, 0]);
    expect(first.site.wilded).toHaveLength(4);
    expect(solutionsFor(p, options)).toHaveLength(options.length);
  });

  describe('strictness', () => {
    const t = (ring: number, octant: number, colour: number) => ({ ring, octant, colour, wild: false });

    it('treats a support of a target’s colour as a warning, except when strict', () => {
      const p = position();
      p.targets.push(t(MIDDLE, 4, 2));
      p.cells[28] = 2;
      expect(checkBuildPosition(p, [plan], true, 'strict')).toEqual({ kind: 'failed', issue: { message: 'Red below a red target.', cells: [28, 20] } });
      for (const level of ['standard', 'lenient'] as const) {
        const result = checkBuildPosition(p, [plan], true, level);
        expect(result.kind).toBe('complete');
        if (result.kind === 'complete') expect(result.warnings).toContainEqual({ message: 'Red below a red target.', cells: [28, 20] });
      }
    });

    it('treats an unnecessary stacked pair as a warning, but a real clear and a blocked target as fails', () => {
      const pair = position(); pair.cells[11] = pair.cells[19] = 3;
      expect(checkBuildPosition(pair, [plan], true, 'strict').kind).toBe('failed');
      expect(checkBuildPosition(pair, [plan], true, 'standard').kind).toBe('complete');
      const run = position(); run.cells[28] = run.cells[29] = run.cells[30] = 3;
      const wrong = position(); wrong.cells[23] = 2;
      for (const level of ['lenient', 'standard', 'strict'] as const) {
        expect(checkBuildPosition(run, [plan], true, level)).toMatchObject({ kind: 'failed', issue: { message: 'That clears outside the planned vertical.' } });
        expect(checkBuildPosition(wrong, [plan], true, level)).toMatchObject({ kind: 'failed', issue: { message: 'Wrong colour on a target outside the wild area.' } });
      }
    });

    // Ring 3 red target at S: the SW column is beside it, NW isn't.
    const besideTargets = [t(3, 6, 0), t(3, 4, 3), t(3, 7, 3), t(2, 7, 1), t(2, 4, 4), t(1, 6, 2)];
    const empty = (): Position => ({ cells: Array<number>(32).fill(EMPTY), targets: besideTargets.map((x) => ({ ...x })), entry: { colour: 0, octant: 0 } });

    it('prefers a vertical beside the ring 3 target: shown first, required when strict, a warning when standard', () => {
      expect(buildOptionsFor(besideTargets, 'strict').every(({ site }) => site.vertical[0] % 8 === 5)).toBe(true);
      expect(buildOptionsFor(besideTargets, 'standard').some(({ site }) => site.vertical[0] % 8 === 3)).toBe(true);
      expect(solutionsFor(empty(), planningOptions(besideTargets))[0].site.vertical[0] % 8).toBe(5);
      // NW vertical: blue at NW, yellow pair at W and SW.
      const p = empty(); p.cells[27] = 0; p.cells[28] = p.cells[29] = 4;
      const standard = checkBuildPosition(p, buildOptionsFor(besideTargets, 'standard'), true, 'standard');
      expect(standard).toMatchObject({ kind: 'complete', warnings: [{ message: 'The vertical could go beside the ring 3 target.' }] });
      const strictOptions = buildOptionsFor(besideTargets, 'strict');
      expect(checkBuildPosition(p, strictOptions, true, 'strict').kind).toBe('building');
      expect(builtComboIssue(p, 1, strictOptions, 'strict')?.message).toBe(BESIDE_FAIL);
      // The SW vertical passes cleanly.
      const sw = empty(); sw.cells[29] = 0; sw.cells[27] = sw.cells[28] = 4;
      expect(checkBuildPosition(sw, strictOptions, true, 'strict')).toMatchObject({ kind: 'complete' });
      expect(checkBuildPosition(sw, buildOptionsFor(besideTargets, 'standard'), true, 'standard')).not.toHaveProperty('warnings');
    });

    it('lenient accepts a working combo that turns fewer targets wild, with a note', () => {
      const p: Position = {
        cells: Array<number>(32).fill(EMPTY), entry: { colour: 4, octant: 3 },
        targets: [t(3, 5, 3), t(3, 0, 3), t(3, 2, 2), t(2, 6, 0), t(2, 0, 4), t(1, 5, 2)],
      };
      p.cells[22] = 0; p.cells[23] = 4;
      [1, 4, 1, 3, 2, 3, 2, 0].forEach((colour, octant) => { p.cells[24 + octant] = colour; });
      const lenient = checkBuildTurned(p, buildOptionsFor(p.targets, 'lenient'), true, 'lenient');
      // Accepted, with a note naming the Mode 2 rule the combo misses.
      expect(lenient.check).toMatchObject({ kind: 'complete', warnings: expect.arrayContaining([{ message: 'This turns 3 targets wild. A valid plan can turn 4 wild.', cells: [24, 25, 26] }]) });
      expect(checkBuildTurned(p, buildOptionsFor(p.targets, 'standard'), true, 'standard').check.kind).toBe('failed');
    });
  });
});
