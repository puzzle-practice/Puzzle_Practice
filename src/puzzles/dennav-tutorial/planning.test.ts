import { describe, expect, it, vi } from 'vitest';
import { Random } from '../../core/random';
import { EMPTY, NaviTestBoard, TestWildTargets, type Target } from '../navigation/logic';
import { INNER, MIDDLE, TOP, bestHorizontals, gameAt, innerRun, outcome, positionOf, type Position } from './engine';
import { LESSONS } from './lessons';
import { checkPlan, dealPlanningBoard, paintPlan, planningAnswer, planningOptions, planningSites, type PlanSite } from './planning';

const target = (ring: number, octant: number, colour: number): Target => ({ ring, octant, colour, wild: false });
const targets = [target(INNER, 2, 0), target(INNER, 6, 1), target(MIDDLE, 4, 2), target(MIDDLE, 0, 3), target(TOP, 2, 4)];
const position = (cells: number[], ts = targets): Position => ({ cells, targets: ts, entry: { colour: 0, octant: 0 } });
const site = (start: number, column: number): PlanSite => ({
  horizontal: innerRun(start), vertical: [INNER, MIDDLE, TOP].map((r) => r * 8 + column), top: column, wilded: [],
});

describe('painted vertical-triple plans', () => {
  it('accepts every tied placement, drop-in column and valid pair of colours', () => {
    const options = planningSites(targets);
    expect(new Set(options.map((s) => s.horizontal.join(','))).size).toBeGreaterThan(1);
    expect(new Set(options.map((s) => s.top)).size).toBeGreaterThan(1);
    for (const { site, verticalColour, horizontalColour } of planningOptions(targets)) {
      const cells = paintPlan(site, verticalColour, horizontalColour);
      expect(cells.filter((c) => c !== EMPTY)).toHaveLength(3);
      expect(cells.slice(0, INNER * 8).every((c) => c === EMPTY)).toBe(true);
      const result = checkPlan(position(cells));
      expect(result.accepted).toBe(true);
      expect(result.site?.wilded).toHaveLength(3);
    }
  });

  it('handles a horizontal that wraps across east and a vertical between the pair', () => {
    const ts = targets.map((t) => t.ring === MIDDLE && t.octant === 0 ? { ...t, octant: 7 } : t);
    const option = planningSites(ts).find((s) => s.horizontal.includes(24) && s.horizontal.includes(31) && s.top === 0)!;
    expect(option).toBeDefined();
    expect(checkPlan(position(paintPlan(option, 0, 1), ts)).accepted).toBe(true);
  });

  it('reserves the ring 3 target colour for both combo colours', () => {
    const option = planningSites(targets)[0];
    for (const colours of [[4, 1], [0, 4]]) {
      const result = checkPlan(position(paintPlan(option, colours[0], colours[1])));
      expect(result.accepted).toBe(false);
      expect(result.message).toContain('Save the ring 3');
    }
  });

  it('rejects a horizontal under ring 3 even when its vertical is elsewhere', () => {
    const result = checkPlan(position(paintPlan(site(1, 3), 0, 1)));
    expect(result.accepted).toBe(false);
    expect(result.message).toContain('underneath the ring 3');
  });

  it('rejects a vertical through a target in either inner ring', () => {
    for (const option of [site(3, 4), site(4, 6)]) {
      const result = checkPlan(position(paintPlan(option, 0, 1)));
      expect(result.accepted).toBe(false);
      expect(result.message).toContain('vertical goes through a target');
    }
  });

  it('optimises valid coverage without requiring every wildable target to be wrong', () => {
    const ts = [target(INNER, 2, 0), target(INNER, 1, 1), target(INNER, 7, 2), target(MIDDLE, 2, 3), target(MIDDLE, 4, 0), target(TOP, 2, 4)];
    expect(bestHorizontals(ts).wild).toBe(4);
    // Already matching one target no longer excludes an otherwise safe maximum-coverage plan.
    expect(planningSites(ts)[0].wilded).toHaveLength(3);
    const answer = planningAnswer(position(Array(32).fill(EMPTY), ts), new Random(1));
    expect(checkPlan(answer).accepted).toBe(true);
  });

  it('still rejects lower coverage when its colour choices are valid', () => {
    const ts = [target(INNER, 1, 0), target(INNER, 7, 0), target(MIDDLE, 4, 1), target(TOP, 2, 2)];
    const worse = checkPlan(position(paintPlan(site(3, 3), 3, 4), ts));
    expect(worse.accepted).toBe(false);
    expect(worse.message).toContain('A valid plan can turn 2 wild');
  });

  it('rejects the pair correctly filling every target that the second clear would turn wild', () => {
    // Horizontal wraps SE–E–NE; the vertical is E. Both blue targets would already match a blue pair.
    const ts = [target(INNER, 1, 0), target(INNER, 7, 0), target(MIDDLE, 4, 1), target(TOP, 2, 2)];
    for (const vertical of [3, 4]) {
      const result = checkPlan(position(paintPlan(site(7, 0), vertical, 0), ts));
      expect(result.accepted).toBe(false);
      expect(result.message).toContain('already filled correctly');
    }
    // All three of these explicit, different colour pairs really are acceptable here.
    for (const [vertical, horizontal] of [[0, 3], [3, 4], [4, 3]]) {
      expect(checkPlan(position(paintPlan(site(7, 0), vertical, horizontal), ts)).accepted).toBe(true);
    }
  });

  it('accepts the screenshot: red target already correct, blue vertical, orange ring 2 target waiting to go wild', () => {
    const ts = [target(INNER, 0, 2), target(MIDDLE, 2, 1), target(MIDDLE, 7, 4), target(TOP, 5, 1)];
    const p = position(paintPlan(site(0, 1), 0, 2), ts);
    const result = checkPlan(p);
    expect(result.accepted).toBe(true);
    expect(result.site!.wilded.map((t) => [t.ring, t.octant])).toEqual([[INNER, 0], [MIDDLE, 2]]);
    expect(p.cells[INNER * 8]).toBe(2); // Red target under the pair is already right.
    expect(p.cells[MIDDLE * 8 + 2]).toBe(EMPTY); // Can fill the orange target wrong while building.
    expect(planningOptions(ts).some(({ site: option, verticalColour, horizontalColour }) =>
      option.top === 1 && option.horizontal[0] === INNER * 8 && verticalColour === 0 && horizontalColour === 2)).toBe(true);
  });

  it('plays the screenshot as a real triple when orange stays wrong, and a single if orange is filled correctly', () => {
    const ts = [target(INNER, 0, 2), target(MIDDLE, 2, 1), target(MIDDLE, 7, 4), target(TOP, 5, 1)];
    const E = EMPTY;
    const cells = [
      E, 2, E, E, E, E, E, E,
      E, 0, 4, E, E, 1, E, E,
      3, 0, 3, E, E, 2, E, 4,
      2, 0, 2, 3, 4, 0, 1, 3,
    ];
    const lesson = LESSONS.find((l) => l.id === 'vertical-triple')!;
    const game = gameAt(position(cells, ts));
    expect(lesson.accepts(outcome(game.settle(), positionOf(game)))).toBe(true);
    const early = [...cells]; early[MIDDLE * 8 + 2] = 1;
    const single = gameAt(position(early, ts));
    expect(outcome(single.settle(), positionOf(single)).charted).toBe(1);
  });

  it('prefers absent colours in reveal order without requiring them in an acceptable plan', () => {
    const ts = [target(INNER, 7, 0), target(MIDDLE, 7, 1), target(TOP, 2, 2)];
    const result = checkPlan(position(paintPlan(site(7, 0), 0, 1), ts));
    expect(result.accepted).toBe(true);
    expect(checkPlan(position(paintPlan(site(7, 0), 0, 3), ts)).accepted).toBe(true);
    const options = planningOptions(ts);
    expect([options[0].verticalColour, options[0].horizontalColour].sort()).toEqual([3, 4]);
    expect(options.some(({ site: option, verticalColour, horizontalColour }) => option.top === 0 && verticalColour === 0 && horizontalColour === 1)).toBe(true);
  });

  it('accepts the second screenshot: blue vertical and red pair, although white is absent', () => {
    const ts = [target(INNER, 0, 2), target(INNER, 1, 0), target(INNER, 4, 4), target(MIDDLE, 1, 2), target(MIDDLE, 5, 4), target(TOP, 3, 1)];
    const result = checkPlan(position(paintPlan(site(0, 2), 0, 2), ts));
    expect(result.accepted).toBe(true);
    expect(result.site!.wilded.map((t) => [t.ring, t.octant])).toEqual([[INNER, 0], [INNER, 1], [MIDDLE, 1]]);
    expect(planningOptions(ts).some(({ site: option, verticalColour, horizontalColour }) =>
      option.top === 2 && option.horizontal[0] === INNER * 8 && verticalColour === 0 && horizontalColour === 2)).toBe(true);
    const E = EMPTY;
    const cells = [
      E, E, 2, E, E, E, E, E,
      E, 4, 0, 1, E, E, E, E,
      3, 3, 0, 2, E, 4, E, E,
      2, 2, 0, 3, 4, 0, 1, 3,
    ];
    const game = gameAt(position(cells, ts));
    const lesson = LESSONS.find((l) => l.id === 'vertical-triple')!;
    expect(lesson.accepts(outcome(game.settle(), positionOf(game)))).toBe(true);
  });

  it('rejects a colour still needed by the far side of ring 1 in either combo role', () => {
    const ts = [target(INNER, 1, 0), target(INNER, 7, 0), target(MIDDLE, 4, 1), target(TOP, 2, 2)];
    // W–SW–S wilds the SE blue target, but leaves the NE blue target to fill by colour.
    for (const [vertical, horizontal] of [[3, 0], [0, 3]]) {
      const result = checkPlan(position(paintPlan(site(4, 5), vertical, horizontal), ts));
      expect(result.accepted).toBe(false);
      expect(result.message).toContain('Save blue for targets outside');
    }
    expect(checkPlan(position(paintPlan(site(4, 5), 3, 4), ts)).accepted).toBe(true);
  });

  it('rejects two conflicting combo colours, including ring 2 demand', () => {
    const ts = [target(INNER, 1, 0), target(INNER, 7, 1), target(MIDDLE, 4, 2), target(TOP, 2, 2)];
    const result = checkPlan(position(paintPlan(site(3, 3), 0, 1), ts));
    expect(result.accepted).toBe(false);
    expect(result.message).toContain('Save blue and orange for targets outside');
    const middle = [...ts, target(MIDDLE, 0, 3)];
    const result2 = checkPlan(position(paintPlan(site(4, 5), 3, 4), middle));
    expect(result2.accepted).toBe(false);
    expect(result2.message).toContain('Save white for targets outside');
  });

  it('rules out a vertical through a target in each of rings 1, 2 and 3', () => {
    for (const ring of [INNER, MIDDLE, TOP]) {
      const ts = [target(ring, 0, 0), target(TOP, 3, 2)];
      expect(checkPlan(position(paintPlan(site(7, 0), 3, 4), ts)).accepted).toBe(false);
      expect(planningOptions(ts).some(({ site }) => site.top === 0)).toBe(false);
    }
  });

  it('rejects incomplete, extra, same-colour, mismatched-pair and disconnected blueprints', () => {
    const option = planningSites(targets)[0];
    const cells = paintPlan(option, 0, 1);
    const painted = cells.flatMap((c, i) => c === EMPTY ? [] : [i]);
    const missing = [...cells]; missing[painted[0]] = EMPTY;
    const extra = [...cells]; extra[cells.indexOf(EMPTY)] = 2;
    const wrongPair = [...cells]; wrongPair[option.horizontal.find((cell) => cell !== option.vertical[0])!] = 2;
    const disconnected = [...cells]; disconnected[option.vertical[1]] = disconnected[option.vertical[0]]; disconnected[option.vertical[0]] = EMPTY;
    for (const invalid of [missing, extra, wrongPair, disconnected, paintPlan(option, 0, 0)]) {
      expect(checkPlan(position(invalid)).accepted).toBe(false);
    }
  });

  it('does not require or accept painting the rest of the vertical or the ring 4 star', () => {
    const option = planningSites(targets)[0];
    const cells = paintPlan(option, 0, 1);
    expect(checkPlan(position(cells)).accepted).toBe(true);
    for (const cell of [option.vertical[1], option.vertical[2], option.top]) {
      const extended = [...cells]; extended[cell] = cell === option.top ? 1 : 0;
      expect(checkPlan(position(extended)).accepted).toBe(false);
    }
  });

  it('scores wild targets exactly as the game does for the second clear', () => {
    for (const option of planningSites(targets)) {
      const copied = targets.map((t) => ({ ...t }));
      const wild = new TestWildTargets(true, 4);
      wild.runs([{ direction: 1, ring: INNER, octant: option.top, length: 3 }], copied);
      expect(copied.some((t) => t.wild)).toBe(false);
      wild.runs([{ direction: 0, ring: INNER, octant: option.horizontal[0] % 8, length: 3 }], copied);
      expect(copied.filter((t) => t.wild)).toEqual(option.wilded.map((t) => ({ ...t, wild: true })));
    }
  });

  it('keeps seed 514 unchanged and allows unavoidable extra vertical demand', () => {
    const rng = new Random(1);
    const seed = vi.spyOn(rng, 'integer').mockReturnValue(514);
    const p = dealPlanningBoard(rng, false);
    expect(p.targets).toEqual(new NaviTestBoard(4, 4, 514, false).nextConstellation());
    expect(planningOptions(p.targets).length).toBeGreaterThan(0);
    expect(seed).toHaveBeenCalledTimes(1);
    const candidate = checkPlan({ ...p, cells: paintPlan(site(4, 6), 0, 1) });
    expect(candidate.accepted).toBe(true);
    // The candidate can still make a real triple; it uses four blues (three vertical + NW target).
    const E = EMPTY;
    const game = gameAt({ ...p, cells: [
      E, E, E, E, E, E, 1, E,
      4, E, E, E, E, E, 0, E,
      3, E, 2, 0, 3, 2, 0, E,
      2, 3, 3, 4, 1, 1, 0, 2,
    ] });
    const lesson = LESSONS.find((l) => l.id === 'vertical-triple')!;
    expect(lesson.accepts(outcome(game.settle(), positionOf(game)))).toBe(true);
  });

  it('keeps the available orange for the pair instead of needing three whites in ring 1', () => {
    const ts = new NaviTestBoard(4, 4, 514, false).nextConstellation();
    expect(checkPlan(position(paintPlan(site(4, 6), 0, 3), ts)).accepted).toBe(false); // Blue vertical, white pair.
    expect(checkPlan(position(paintPlan(site(4, 6), 1, 3), ts)).accepted).toBe(false); // Orange vertical still leaves three inner whites.
    for (const vertical of [0, 2, 3]) {
      expect(checkPlan(position(paintPlan(site(4, 6), vertical, 1), ts)).accepted).toBe(true);
    }
    for (const option of planningOptions(ts)) expect(option.horizontalColour).toBe(1);
  });

  it('uses another available vertical colour rather than taking on avoidable blue demand', () => {
    const ts = [target(INNER, 1, 0), target(INNER, 7, 0), target(MIDDLE, 4, 1), target(TOP, 2, 2)];
    expect(checkPlan(position(paintPlan(site(4, 5), 0, 3), ts)).accepted).toBe(false);
    expect(checkPlan(position(paintPlan(site(4, 5), 1, 3), ts)).accepted).toBe(true);
    expect(planningOptions(ts).every((option) => ts.filter((t) => !option.site.wilded.includes(t)).every((t) => t.colour !== option.verticalColour))).toBe(true);
  });

  it('deals natural target boards without filtering and reveals valid answers when available', () => {
    const rng = new Random(83), expectedRng = new Random(83), answerRng = new Random(84), unique = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = dealPlanningBoard(rng, i === 0);
      const natural = new NaviTestBoard(4, 4, expectedRng.integer(1, 0x7fffffff), i === 0).nextConstellation();
      expect(p.targets).toEqual(natural);
      unique.add(JSON.stringify(p.targets));
      expect([INNER, MIDDLE, TOP].map((ring) => p.targets.filter((t) => t.ring === ring).length)).toEqual(i === 0 ? [1, 2, 1] : [3, 2, 1]);
      for (let colour = 0; colour < 5; colour++) expect(p.targets.filter((t) => t.colour === colour).length).toBeLessThanOrEqual(2);
      if (planningOptions(p.targets).length) {
        const answer = planningAnswer(p, answerRng);
        expect(checkPlan(answer).accepted).toBe(true);
        expect(answer.targets).toEqual(p.targets);
      }
      // Check the rules independently of the recogniser and the revealed example.
      for (const { site: option, verticalColour, horizontalColour } of planningOptions(p.targets)) {
        const combo = [verticalColour, horizontalColour];
        const cells = paintPlan(option, verticalColour, horizontalColour);
        expect(p.targets.some((t) => t.octant === option.top)).toBe(false);
        expect(p.targets.filter((t) => t.ring === TOP).some((t) => combo.includes(t.colour))).toBe(false);
        expect(option.wilded.some((t) => cells[t.ring * 8 + t.octant] !== t.colour)).toBe(true);
        for (const t of p.targets.filter((t) => !option.wilded.includes(t))) expect(horizontalColour).not.toBe(t.colour);
      }
      expect(p.cells.every((c) => c === EMPTY)).toBe(true);
    }
    expect(unique.size).toBe(200);
  });
});
