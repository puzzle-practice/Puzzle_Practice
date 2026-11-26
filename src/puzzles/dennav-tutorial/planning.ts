// A blueprint exercise: stars are deliberately left aligned, without gravity or clears.
// Paint only the ring 1 pair and the first vertical star; the rest of the combo is implied.
import { Random } from '../../core/random';
import { EMPTY, NaviTestBoard, type Target } from '../navigation/logic';
import { COLOUR_NAMES } from '../navigation/create';
import { EXTRA, INNER, MIDDLE, TOP, RINGS, innerRun, wildedBy, type Position } from './engine';

export interface PlanSite {
  horizontal: number[];
  vertical: number[];
  top: number;
  wilded: Target[];
}

/** All three-cell horizontals, with each possible drop-in column, including unsafe sites. */
export function sites(targets: Target[]): PlanSite[] {
  return Array.from({ length: 8 }, (_, start) => {
    const horizontal = innerRun(start);
    return horizontal.map((gap) => ({
      horizontal,
      vertical: [INNER, MIDDLE, TOP].map((ring) => ring * 8 + gap % 8),
      top: EXTRA * 8 + gap % 8,
      wilded: wildedBy(targets, horizontal),
    }));
  }).flat();
}

export const underTop = (targets: Target[], site: PlanSite) => targets.some((t) =>
  t.ring === TOP && site.horizontal.some((c) => c % 8 === t.octant));
export const throughTarget = (targets: Target[], site: PlanSite) => targets.some((t) =>
  site.vertical.includes(t.ring * 8 + t.octant));

export function paintPlan(site: PlanSite, verticalColour: number, horizontalColour: number): number[] {
  const cells = Array<number>(RINGS * 8).fill(EMPTY);
  cells[site.vertical[0]] = verticalColour;
  site.horizontal.filter((cell) => !site.vertical.includes(cell)).forEach((cell) => { cells[cell] = horizontalColour; });
  return cells;
}

export interface PlanCheck {
  accepted: boolean;
  message: string;
  site?: PlanSite;
}

/** By position, so copies of the targets (e.g. on a turned board) still match. */
const turnsWild = (site: PlanSite, t: Target) => site.wilded.some((w) => w.ring === t.ring && w.octant === t.octant);

/** The colour checks that break the combo outright (the rest of colourIssue only wastes stars). */
export function colourBlocker(targets: Target[], site: PlanSite, verticalColour: number, horizontalColour: number): string | null {
  const combo = [verticalColour, horizontalColour];
  if (targets.some((t) => t.ring === TOP && combo.includes(t.colour))) {
    return 'Save the ring 3 target’s colour for filling.';
  }
  const cells = paintPlan(site, verticalColour, horizontalColour);
  // One wrong target is enough to hold charting until the second clear. Other targets,
  // including one already matched by the pair, may be correct. Unpainted wildable targets
  // can be filled wrong during the build, so they can supply that final blocker.
  if (site.wilded.every((t) => cells[t.ring * 8 + t.octant] === t.colour)) {
    return 'Every target that would turn wild is already filled correctly. Leave at least one wrong.';
  }
  return null;
}

/** Colour checks apply to the implied combo as well as the three painted stars. */
export function colourIssue(targets: Target[], site: PlanSite, verticalColour: number, horizontalColour: number): string | null {
  const blocker = colourBlocker(targets, site, verticalColour, horizontalColour);
  if (blocker) return blocker;
  const combo = [verticalColour, horizontalColour];
  const remaining = targets.filter((t) => !t.wild && !turnsWild(site, t));
  const needed = combo.filter((colour) => remaining.some((t) => t.colour === colour));
  // The horizontal already needs three stars of its colour. Keep that colour free of
  // remaining targets; extra demand can only be carried by the vertical, when unavoidable.
  if (remaining.some((t) => t.colour === horizontalColour)) {
    const names = needed.map((colour) => COLOUR_NAMES[colour].toLowerCase()).join(' and ');
    return `Save ${names} for targets outside the wild area.`;
  }
  return null;
}

export interface PlanningOption { site: PlanSite; verticalColour: number; horizontalColour: number }

/** The vertical's column is next to a ring 3 target's. Building there, the stars that come
 * early can finish the combo without building the whole board out. */
export const besideTop = (targets: Target[], site: PlanSite) => targets.some((t) => !t.wild && t.ring === TOP
  && [1, 7].includes(((site.vertical[0] % 8) - t.octant + 8) % 8));

const verticalDemand = (targets: Target[], { site, verticalColour }: PlanningOption): number =>
  targets.filter((t) => !t.wild && !turnsWild(site, t) && t.colour === verticalColour).length;

/** Use free colours first; only relax vertical demand when every plan needs extra stars. */
export function planningOptions(targets: Target[]): PlanningOption[] {
  const valid: PlanningOption[] = [];
  for (const site of sites(targets)) {
    if (underTop(targets, site) || throughTarget(targets, site)) continue;
    for (let verticalColour = 0; verticalColour < 5; verticalColour++) for (let horizontalColour = 0; horizontalColour < 5; horizontalColour++) {
      if (verticalColour === horizontalColour || colourIssue(targets, site, verticalColour, horizontalColour)) continue;
      valid.push({ site, verticalColour, horizontalColour });
    }
  }
  const leastDemand = Math.min(...valid.map((option) => verticalDemand(targets, option)));
  const economical = valid.filter((option) => verticalDemand(targets, option) === leastDemand);
  const best = Math.max(0, ...economical.map(({ site }) => site.wilded.length));
  // Absent colours are a useful default, not a requirement: a colour is also free to use
  // when every target needing it will turn wild. Put the defaults first without dropping ties.
  const absent = new Set([0, 1, 2, 3, 4].filter((colour) => !targets.some((t) => !t.wild && t.colour === colour)));
  const preference = ({ verticalColour, horizontalColour }: PlanningOption) => Number(absent.has(verticalColour)) + Number(absent.has(horizontalColour));
  return economical.filter(({ site }) => site.wilded.length === best).sort((a, b) => preference(b) - preference(a));
}

/** Best sites with at least one safe colour pair. Keep every tie. */
export function planningSites(targets: Target[]): PlanSite[] {
  return [...new Set(planningOptions(targets).map(({ site }) => site))];
}

/** Mode 2's planning rules for a recognised combo, in order: the first broken rule (its index in
 * that order, so a later rule means a combo closer to valid) and its message, or null. */
export function planRuleFailure(targets: Target[], site: PlanSite, verticalColour: number, horizontalColour: number): { rule: number; message: string } | null {
  const rules: (() => string | null)[] = [
    () => underTop(targets, site) ? 'Move the horizontal away from underneath the ring 3 target.' : null,
    () => throughTarget(targets, site) ? 'The vertical goes through a target. Choose another column.' : null,
    () => colourIssue(targets, site, verticalColour, horizontalColour),
    () => planningOptions(targets).length ? null : 'No answer under the current rules.',
    () => {
      const demand = verticalDemand(targets, { site, verticalColour, horizontalColour });
      const leastDemand = verticalDemand(targets, planningOptions(targets)[0]);
      if (demand <= leastDemand) return null;
      return leastDemand === 0
        ? `Save ${COLOUR_NAMES[verticalColour].toLowerCase()} for targets outside the wild area.`
        : 'Use a vertical colour needed by fewer remaining targets.';
    },
    () => {
      const best = planningOptions(targets)[0].site.wilded.length;
      return site.wilded.length < best ? `This turns ${site.wilded.length} targets wild. A valid plan can turn ${best} wild.` : null;
    },
  ];
  for (const [rule, check] of rules.entries()) {
    const message = check();
    if (message) return { rule, message };
  }
  return null;
}

/** Mode 2's planning rules for a recognised combo: the first broken rule's message, or null. */
export const planRuleIssue = (targets: Target[], site: PlanSite, verticalColour: number, horizontalColour: number): string | null =>
  planRuleFailure(targets, site, verticalColour, horizontalColour)?.message ?? null;

/** Recognise the painted structure independently of the example used by Show answer. */
export function checkPlan(p: Position): PlanCheck {
  const fail = (message: string, site?: PlanSite): PlanCheck => ({ accepted: false, message, site });
  const count = p.cells.filter((c) => c !== EMPTY).length;
  if (count > 3) return fail('Paint only three stars in ring 1. Erase the extras.');
  if (count < 3) return fail(`${count}/3 stars painted. Add the pair and first vertical star.`);
  const shape = sites(p.targets).find((site) => {
    const verticalColour = p.cells[site.vertical[0]], horizontalColour = p.cells[site.horizontal.find((cell) => cell !== site.vertical[0])!];
    if (verticalColour < 0 || horizontalColour < 0 || verticalColour === horizontalColour) return false;
    const expected = paintPlan(site, verticalColour, horizontalColour);
    return expected.every((colour, i) => colour === p.cells[i]);
  });
  if (!shape) return fail('Use three neighbouring ring 1 cells: a pair and one different colour.');
  const verticalColour = p.cells[shape.vertical[0]];
  const horizontalColour = p.cells[shape.horizontal.find((cell) => cell !== shape.vertical[0])!];
  const issue = planRuleIssue(p.targets, shape, verticalColour, horizontalColour);
  if (issue) return fail(issue, shape);
  const best = planningOptions(p.targets)[0].site.wilded.length;
  return { accepted: true, site: shape, message: `Accepted: ${best} targets turn wild. Next board…` };
}

/** Keep the game's natural deal, including boards the current planning rules cannot accept. */
export function dealPlanningBoard(rng: Random, opening: boolean): Position {
  const board = new NaviTestBoard(RINGS, 4, rng.integer(1, 0x7fffffff), opening);
  return { cells: Array<number>(RINGS * 8).fill(EMPTY), targets: board.nextConstellation(), entry: { colour: 0, octant: 0 } };
}

/** Reveal uses exactly the same placement and colour rules as player answers. */
export function planningAnswer(p: Position, rng: Random): Position {
  const options = planningOptions(p.targets);
  if (!options.length) throw new Error('No valid vertical-triple plan for this constellation');
  const { site, verticalColour, horizontalColour } = options[rng.integer(0, options.length - 1)];
  return { ...p, cells: paintPlan(site, verticalColour, horizontalColour) };
}
