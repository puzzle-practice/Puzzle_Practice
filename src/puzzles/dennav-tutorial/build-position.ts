import { EMPTY, NaviBoard } from '../navigation/logic';
import { COLOUR_NAMES } from '../navigation/create';
import { EXTRA, INNER, MIDDLE, TOP, clonePosition, type Position } from './engine';
import { besideTop, colourBlocker, paintPlan, planRuleFailure, planningOptions, sites, throughTarget, underTop, type PlanSite, type PlanningOption } from './planning';
import type { Target } from '../navigation/logic';

export interface BuildIssue { message: string; cells: number[] }
/** Hard issues break the combo; soft ones are only suboptimal. */
export interface GradedIssue extends BuildIssue { soft: boolean }
export type BuildCheck = { kind: 'building' } | { kind: 'complete'; plan: PlanningOption; warnings?: BuildIssue[] } | { kind: 'failed'; issue: BuildIssue };

/** How strict Build Ring 1 is.
 * - lenient: any combo that still sets off the vertical triple; everything suboptimal is a note.
 * - standard: Mode 2's planning rules; suboptimal pieces and a vertical away from the ring 3
 *   target are warnings.
 * - strict: all of those fail too. */
export type Strictness = 'lenient' | 'standard' | 'strict';

/** Every piece's issues against a plan, including supports and stars outside the planned combo, in order. */
export function buildIssues(p: Position, plan: PlanningOption): GradedIssue[] {
  const issues: GradedIssue[] = [];
  const wildCells = new Set(plan.site.wilded.map((t) => t.ring * 8 + t.octant));
  for (const t of p.targets) {
    // A future wild target can be filled with another colour, so its support needn't
    // avoid the target's requested colour. Actual stacked pieces are still checked below.
    if (t.wild || t.ring === INNER || wildCells.has(t.ring * 8 + t.octant)) continue;
    const below = (t.ring + 1) * 8 + t.octant;
    if (p.cells[below] === t.colour) {
      // Suboptimal: the target can still be filled; that colour just lines up early.
      const colour = COLOUR_NAMES[t.colour].toLowerCase();
      const article = /^[aeiou]/.test(colour) ? 'an' : 'a';
      issues.push({ soft: true, message: `${COLOUR_NAMES[t.colour]} below ${article} ${colour} target.`, cells: [below, t.ring * 8 + t.octant] });
      break;
    }
  }
  if (plan.site.wilded.every((t) => p.cells[t.ring * 8 + t.octant] === t.colour)) {
    // Hard: the constellation would chart at the first clear.
    issues.push({ soft: false, message: 'Leave one target wrong until the second clear.', cells: plan.site.wilded.map((t) => t.ring * 8 + t.octant) });
  }
  pairs: for (let octant = 0; octant < 8; octant++) for (const upper of [EXTRA, TOP, MIDDLE]) {
    const a = upper * 8 + octant, b = (upper + 1) * 8 + octant;
    if (p.cells[a] === EMPTY || p.cells[a] !== p.cells[b]) continue;
    const intended = plan.site.vertical.includes(a) && plan.site.vertical.includes(b) && p.cells[a] === plan.verticalColour;
    // Suboptimal: a pair doesn't clear by itself, but one more of its colour sets it off early.
    if (!intended) { issues.push({ soft: true, message: 'Unnecessary vertical pair.', cells: [a, b] }); break pairs; }
  }
  for (const t of p.targets) {
    if (t.wild || wildCells.has(t.ring * 8 + t.octant)) continue;
    const cell = t.ring * 8 + t.octant;
    // Hard: a target that never turns wild can't be matched while it holds the wrong star.
    if (p.cells[cell] !== EMPTY && p.cells[cell] !== t.colour) { issues.push({ soft: false, message: 'Wrong colour on a target outside the wild area.', cells: [cell] }); break; }
  }
  const board = new NaviBoard(4, 4, 1, true);
  p.cells.forEach((colour, cell) => { board.cells[cell] = colour; });
  for (const run of board.findRuns()) {
    const cells = Array.from({ length: run.length }, (_, k) => run.direction === 0
      ? run.ring * 8 + (run.octant + k) % 8 : (run.ring - k) * 8 + run.octant);
    if (cells.every((cell) => plan.site.vertical.includes(cell))) continue;
    // Hard: a real clear away from the combo.
    issues.push({ soft: false, message: 'That clears outside the planned vertical.', cells });
    break;
  }
  return issues;
}

/** The first issue of any kind (the strictest reading). */
export const buildIssue = (p: Position, plan: PlanningOption): BuildIssue | null => {
  const first = buildIssues(p, plan)[0];
  return first ? { message: first.message, cells: first.cells } : null;
};

/** The plans a strictness level accepts for these targets. */
export function buildOptionsFor(targets: Target[], level: Strictness): PlanningOption[] {
  const best = planningOptions(targets);
  if (level === 'standard') return best;
  if (level === 'strict') {
    const beside = best.filter(({ site }) => besideTop(targets, site));
    return beside.length ? beside : best;
  }
  // Lenient: every combo that isn't broken outright, best plans first.
  const rest: PlanningOption[] = [];
  for (const site of sites(targets)) {
    if (underTop(targets, site) || throughTarget(targets, site)) continue;
    for (let verticalColour = 0; verticalColour < 5; verticalColour++) for (let horizontalColour = 0; horizontalColour < 5; horizontalColour++) {
      if (verticalColour === horizontalColour || colourBlocker(targets, site, verticalColour, horizontalColour)) continue;
      const option = { site, verticalColour, horizontalColour };
      if (!best.some((b) => sameCombo(b, option))) rest.push(option);
    }
  }
  return [...best, ...rest];
}

/** Suboptimal points about an otherwise acceptable plan: Mode 2's rules it misses (lenient)
 * and a vertical away from the ring 3 target when a best plan beside it exists. */
function planNotes(targets: Target[], plan: PlanningOption, level: Strictness): BuildIssue[] {
  const notes: BuildIssue[] = [];
  const comboCells = [...new Set([...plan.site.horizontal, plan.site.vertical[0]])];
  if (level === 'lenient') {
    const missed = planRuleFailure(targets, plan.site, plan.verticalColour, plan.horizontalColour);
    if (missed) notes.push({ message: missed.message, cells: comboCells });
  }
  if (level !== 'strict' && !besideTop(targets, plan.site) && planningOptions(targets).some(({ site }) => besideTop(targets, site))) {
    notes.push({ message: BESIDE_NOTE, cells: [plan.site.vertical[0]] });
  }
  return notes;
}
const BESIDE_NOTE = 'The vertical could go beside the ring 3 target.';
export const BESIDE_FAIL = 'Build the vertical beside the ring 3 target.';

interface Combo { site: PlanSite; verticalColour: number; horizontalColour: number }

const sameCombo = (a: Combo, b: Combo) => a.site.horizontal.join() === b.site.horizontal.join()
  && a.site.vertical[0] === b.site.vertical[0] && a.verticalColour === b.verticalColour && a.horizontalColour === b.horizontalColour;

/** Why a combo breaks the planning lesson's rules: the ring 3 colour first, then Mode 2's rules.
 * `rule` orders failures, so a higher one means the combo got further through the rules. */
function comboFailure(p: Position, { site, verticalColour, horizontalColour }: Combo, level: Strictness = 'standard'): { rule: number; issue: BuildIssue } | null {
  const comboCells = [...new Set([...site.horizontal, ...site.vertical])].filter((cell) => p.cells[cell] !== EMPTY);
  const top = p.targets.find((t) => t.ring === TOP && !t.wild && (t.colour === verticalColour || t.colour === horizontalColour));
  if (top) {
    const colour = COLOUR_NAMES[top.colour].toLowerCase();
    return { rule: -1, issue: {
      message: `Ring 3 colour reused. Save ${colour} for the ring 3 target.`,
      cells: [...comboCells.filter((cell) => p.cells[cell] === top.colour), top.ring * 8 + top.octant],
    } };
  }
  if (level === 'lenient') {
    // Only what breaks the combo outright.
    if (underTop(p.targets, site)) return { rule: 0, issue: { message: 'Move the horizontal away from underneath the ring 3 target.', cells: comboCells } };
    if (throughTarget(p.targets, site)) return { rule: 1, issue: { message: 'The vertical goes through a target. Choose another column.', cells: comboCells } };
    const blocker = colourBlocker(p.targets, site, verticalColour, horizontalColour);
    return blocker ? { rule: 2, issue: { message: blocker, cells: comboCells } } : null;
  }
  const failure = planRuleFailure(p.targets, site, verticalColour, horizontalColour);
  if (failure) return { rule: failure.rule, issue: { message: failure.message, cells: comboCells } };
  if (level === 'strict' && !besideTop(p.targets, site) && planningOptions(p.targets).some((o) => besideTop(p.targets, o.site))) {
    return { rule: 99, issue: { message: BESIDE_FAIL, cells: [site.vertical[0]] } };
  }
  return null;
}

/** The combos the player has built, read from the board rather than from the accepted plans:
 * a ring 1 pair beside a different colour, with at least `minStack` of the vertical stacked
 * (counting its ring 1 star, so 1 accepts just the three ring 1 stars). Most likely intended
 * first: one matching an accepted plan, then the tallest vertical stack, then the combo that
 * gets furthest through the planning rules. */
function builtCombos(p: Position, minStack: number, options: PlanningOption[] = [], level: Strictness = 'standard'): Combo[] {
  const found: { combo: Combo; accepted: boolean; stack: number; rule: number }[] = [];
  for (const site of sites(p.targets)) {
    const verticalColour = p.cells[site.vertical[0]];
    const rest = site.horizontal.filter((cell) => cell !== site.vertical[0]);
    const horizontalColour = p.cells[rest[0]];
    if (verticalColour === EMPTY || horizontalColour === EMPTY || verticalColour === horizontalColour) continue;
    if (!rest.every((cell) => p.cells[cell] === horizontalColour)) continue;
    const stack = site.vertical.filter((cell) => p.cells[cell] === verticalColour).length;
    if (stack < minStack) continue;
    const combo = { site, verticalColour, horizontalColour };
    found.push({ combo, accepted: options.some((o) => sameCombo(o, combo)), stack, rule: comboFailure(p, combo, level)?.rule ?? Infinity });
  }
  return found.sort((a, b) => Number(b.accepted) - Number(a.accepted) || b.stack - a.stack || b.rule - a.rule).map(({ combo }) => combo);
}

/** Why the player's own combo can't be one of the accepted plans, in the planning lesson's terms. */
export function builtComboIssue(p: Position, minStack = 1, options: PlanningOption[] = [], level: Strictness = 'standard'): BuildIssue | null {
  const built = builtCombos(p, minStack, options, level)[0];
  return built ? comboFailure(p, built, level)?.issue ?? null : null;
}

/** Any accepted layout may finish, but every other piece must pass too. `submitted` (Enter):
 * the build is final, so judge the player's own combo even if only ring 1 is built. `level`
 * decides whether suboptimal issues fail (strict) or only warn; `options` should come from
 * buildOptionsFor at the same level. */
export function checkBuildPosition(p: Position, options: PlanningOption[], submitted = false, level: Strictness = 'strict'): BuildCheck {
  const matches = (plan: PlanningOption) => plan.site.horizontal.every((cell) => p.cells[cell] ===
    (cell === plan.site.vertical[0] ? plan.verticalColour : plan.horizontalColour));
  const matching = options.filter(matches);
  // A built layout determines which stack is intentional and which targets will wild.
  // Don't report a different, unbuilt layout's hazards as faults in the player's combo.
  const candidates = matching.length ? matching : options;
  let viable = false, firstIssue: BuildIssue | null = null, best: { plan: PlanningOption; warnings: BuildIssue[] } | null = null;
  for (const plan of candidates) {
    const issues = buildIssues(p, plan);
    const failing = issues.find((issue) => level === 'strict' || !issue.soft);
    if (failing) { firstIssue ??= { message: failing.message, cells: failing.cells }; continue; }
    viable = true;
    if (!matching.length) continue;
    const warnings = [...issues.map(({ message, cells }) => ({ message, cells })), ...planNotes(p.targets, plan, level)];
    if (!best || warnings.length < best.warnings.length) best = { plan, warnings };
  }
  if (best) return best.warnings.length ? { kind: 'complete', plan: best.plan, warnings: best.warnings } : { kind: 'complete', plan: best.plan };
  if (viable) return { kind: 'building' };
  // No accepted plan matches what was built: say what's wrong with the player's own combo,
  // rather than a hazard measured against a layout they never built. Mid-build, only once
  // the vertical is stacked, so a bare ring 1 combo isn't judged before it's committed to.
  const own = matching.length ? null : builtComboIssue(p, submitted ? 1 : 2, options, level);
  return { kind: 'failed', issue: own ?? firstIssue ?? { message: 'No plan fits this board.', cells: [] } };
}

/** Ring 2 turned `turns` steps anticlockwise (negative: clockwise); octant o moves to o + turns. */
export function turnRing2(p: Position, turns: number): Position {
  const turned = clonePosition(p);
  for (let octant = 0; octant < 8; octant++) turned.cells[MIDDLE * 8 + ((octant + turns) % 8 + 8) % 8] = p.cells[MIDDLE * 8 + octant];
  return turned;
}

/** Every star rests on another star or on ring 1, as it would after the turn settled. */
const supported = (p: Position) => p.cells.every((colour, cell) =>
  colour === EMPTY || cell >= INNER * 8 || p.cells[cell + 8] !== EMPTY);

/** How well a ring 2 position suits a plan, compared in order (higher is better):
 * (a) the vertical lines up: its ring 2 cell holds the vertical colour (2), is empty (1), or is
 *     blocked by another colour (0);
 * (b) fewer ring 2 stars blocking targets that won't turn wild: sitting on one in the wrong
 *     colour, or beneath a ring 3 one in its colour;
 * (c) more ring 2 stars on targets of their own colour. */
function ring2Fit(p: Position, plan: Combo): number[] {
  const above = p.cells[plan.site.vertical[1]];
  const lined = above === plan.verticalColour ? 2 : above === EMPTY ? 1 : 0;
  const wild = new Set(plan.site.wilded.map((t) => t.ring * 8 + t.octant));
  let blocking = 0, onTarget = 0;
  for (const t of p.targets) {
    if (t.wild) continue;
    const on = t.ring * 8 + t.octant, below = (t.ring + 1) * 8 + t.octant;
    if (t.ring === MIDDLE && p.cells[on] === t.colour) onTarget++;
    if (wild.has(on)) continue;
    if (t.ring === MIDDLE && p.cells[on] !== EMPTY && p.cells[on] !== t.colour) blocking++;
    if (t.ring === TOP && p.cells[below] === t.colour) blocking++;
  }
  return [lined, -blocking, onTarget];
}

const compareFit = (a: number[], b: number[]) => a.map((x, i) => x - b[i]).find((d) => d !== 0) ?? 0;

export interface TurnedBuildCheck { check: BuildCheck; turns: number; position: Position }

/** Be generous about ring 2 not yet being turned into place: judge the most logical ring 2
 * position (best ring2Fit for any plan, then the fewest turns away). Feedback never mentions the turn. */
export function checkBuildTurned(p: Position, options: PlanningOption[], submitted = false, level: Strictness = 'strict'): TurnedBuildCheck {
  // Plans to fit ring 2 to: accepted ones that ring 1 doesn't contradict, and whatever the
  // player built in ring 1. (Ring 1 doesn't turn, so this holds for every ring 2 position.)
  const fits = (plan: PlanningOption) => plan.site.horizontal.every((cell) => p.cells[cell] === EMPTY
    || p.cells[cell] === (cell === plan.site.vertical[0] ? plan.verticalColour : plan.horizontalColour));
  const plans: Combo[] = [...options.filter(fits), ...builtCombos(p, 1, options, level)];
  const candidates = [0, 1, -1, 2, -2, 3, -3, 4].map((turns) => ({ turns, position: turnRing2(p, turns) }))
    .filter(({ turns, position }) => turns === 0 || supported(position))
    .map((c) => ({ ...c, fit: plans.map((plan) => ring2Fit(c.position, plan)).sort(compareFit).at(-1) ?? [] }));
  // Stable sort: ties keep the fewest-turns order above.
  const ranked = [...candidates].sort((a, b) => compareFit(b.fit, a.fit));
  for (const { turns, position } of ranked) {
    const check = checkBuildPosition(position, options, submitted, level);
    if (check.kind !== 'failed') return { check, turns, position };
  }
  return { check: checkBuildPosition(p, options, submitted, level), turns: 0, position: p };
}

/** Where a cell of the judged (turned) board is on the board as the player left it. */
export const unturnedCell = (cell: number, turns: number) => Math.floor(cell / 8) !== MIDDLE ? cell
  : MIDDLE * 8 + ((cell % 8 - turns) % 8 + 8) % 8;

/** Best plans for Show solution. Once something is built, closest first: the most of the plan's
 * three ring 1 stars already in place, then the same vertical column, then the same colours.
 * Then (or, on an empty board, only) a vertical beside the ring 3 target. Ties keep
 * planningOptions' order (free colours first). */
export function solutionsFor(p: Position, options: PlanningOption[]): PlanningOption[] {
  const built = builtCombos(p, 1, options)[0];
  const closeness = (plan: PlanningOption) => {
    const painted = paintPlan(plan.site, plan.verticalColour, plan.horizontalColour);
    const inPlace = plan.site.horizontal.filter((cell) => p.cells[cell] === painted[cell]).length;
    const column = built ? Number(built.site.vertical[0] === plan.site.vertical[0]) : 0;
    const colours = built ? Number(built.verticalColour === plan.verticalColour) + Number(built.horizontalColour === plan.horizontalColour) : 0;
    const beside = Number(besideTop(p.targets, plan.site));
    return p.cells.some((c) => c !== EMPTY) ? [inPlace, column, colours, beside] : [beside];
  };
  return options.map((plan, order) => ({ plan, order, score: closeness(plan) }))
    .sort((a, b) => compareFit(b.score, a.score) || a.order - b.order).map(({ plan }) => plan);
}

