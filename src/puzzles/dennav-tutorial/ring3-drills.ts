// Lessons for the ring 3 topics (Ring 3 double, Ring 3 triple, Ring 3 into a vertical):
// - Fill the targets: build from a fresh board until the ring 1 and ring 2 targets hold their colours.
// - Stack the pair (into a vertical): build rings 1 and 2 with a pair of one colour stacked in a column.
// - Build the combo: from a board with that done, build on and set the combo off; the first clear is judged.
import { COLOUR_NAMES } from '../navigation/create';
import { EMPTY, type Target } from '../navigation/logic';
import type { Random } from '../../core/random';
import { INNER, MIDDLE, TOP, chainName, settled, type Outcome, type Position } from './engine';
import type { RingJudgement } from './donkey-ring';

const name = (colour: number) => COLOUR_NAMES[colour].toLowerCase();
const OCTANTS = [0, 1, 2, 3, 4, 5, 6, 7];
const key = (t: Target) => t.ring * 8 + t.octant;
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** The targets the ring 3 combos need filled before they go off: every ring 1 and ring 2 target. */
const preFilled = (targets: Target[]) => targets.filter((t) => (t.ring === INNER || t.ring === MIDDLE) && !t.wild);

/**
 * Fill the targets: still building until the targets the combo can't turn wild hold their colours:
 * every ring 1 and ring 2 target for the double (its only clear is the first link, which never turns
 * targets wild), and the ring 1 targets for the triple (its second clear, in ring 3, can still turn the
 * ring 2 targets under it wild). A target filled with the wrong colour can't be changed without a clear,
 * so it fails at once.
 */
export function judgeFill(p: Position, ring2Too = true): RingJudgement {
  const needed = preFilled(p.targets).filter((t) => ring2Too || t.ring === INNER);
  const wrong = needed.filter((t) => p.cells[key(t)] !== EMPTY && p.cells[key(t)] !== t.colour);
  if (wrong.length) {
    const t = wrong[0];
    return { kind: 'fail', message: `That target wants ${article(name(t.colour))} ${name(t.colour)}.`, cells: wrong.map(key) };
  }
  return needed.every((t) => p.cells[key(t)] === t.colour) ? { kind: 'pass' } : { kind: 'building' };
}

/** Columns with one colour stacked in rings 1 and 2. */
export const stackedColumns = (cells: number[]): number[] =>
  OCTANTS.filter((o) => cells[INNER * 8 + o] !== EMPTY && cells[INNER * 8 + o] === cells[MIDDLE * 8 + o]);

/**
 * The columns a ring 3 into a vertical can use: beside the ring 3 target, so the vertical turns it wild
 * (with the ring 1 and ring 2 targets filled, that target is what the combo waits for), and with no
 * target in the column itself: the vertical empties it, and with ring 4's star already dropped in,
 * nothing is left to refill it.
 */
export function verticalColumns(targets: Target[]): number[] {
  const top = targets.find((t) => t.ring === TOP && !t.wild);
  if (!top) return [];
  return [(top.octant + 7) % 8, (top.octant + 1) % 8].filter((o) => !targets.some((t) => t.octant === o));
}

/**
 * Stack the pair: judged once ring 2 is full (or when `final`). It needs a pair of one colour stacked
 * in rings 1 and 2 in a column beside the ring 3 target with no target in it.
 */
export function judgeStack(p: Position, final = false): RingJudgement {
  const ring2Full = OCTANTS.every((o) => p.cells[MIDDLE * 8 + o] !== EMPTY);
  if (!ring2Full && !final) return { kind: 'building' };
  if (!ring2Full) return { kind: 'fail', message: 'Ring 2 isn’t full.', cells: OCTANTS.filter((o) => p.cells[MIDDLE * 8 + o] === EMPTY).map((o) => MIDDLE * 8 + o) };
  const good = verticalColumns(p.targets);
  if (stackedColumns(p.cells).some((o) => good.includes(o))) return { kind: 'pass' };
  return { kind: 'fail', message: 'No pair stacked beside the ring 3 target.', cells: good.flatMap((o) => [INNER * 8 + o, MIDDLE * 8 + o]) };
}

/**
 * Build the combo: the first move that sets anything off is judged against the topic. Passes if it
 * set the combo off; otherwise says what happened, ringing the targets that held it up.
 */
export function judgeCombo(o: Outcome, accepts: (o: Outcome) => boolean, title: string): RingJudgement {
  if (accepts(o)) return { kind: 'pass' };
  const goal = title.replace(/^Ring 3 /, '').toLowerCase();
  if (o.charted) return { kind: 'fail', message: `It charted as ${article(chainName(o.charted))} ${chainName(o.charted).toLowerCase()}, not ${article(goal)} ${goal}.`, cells: [] };
  const last = o.links.at(-1)?.scene;
  const targets = last?.targets ?? o.after.targets;
  const cells = o.after.cells;
  const open = targets.filter((t) => cells[key(t)] === EMPTY || (!t.wild && cells[key(t)] !== t.colour));
  return { kind: 'fail', message: `${o.links.length === 1 ? 'A clear' : `${o.links.length} clears`} went off, but it didn’t chart.`, cells: open.map(key) };
}

/**
 * A board for Build the combo: rings 1 and 2 full, every ring 1 and ring 2 target holding its colour,
 * nothing that would clear, and nothing above. With `stack`, a column beside the ring 3 target also has a
 * pair of one colour in rings 1 and 2 (for Ring 3 into a vertical), and no other column does unless its
 * targets force it.
 */
export function dealFilled(rng: Random, p: Position, stack = false): Position | null {
  for (let tries = 0; tries < 200; tries++) {
    const cells = Array<number>(32).fill(EMPTY);
    for (const t of preFilled(p.targets)) cells[key(t)] = t.colour;
    const columns = verticalColumns(p.targets);
    if (stack && !columns.length) return null;
    const column = stack ? columns[rng.integer(0, columns.length - 1)] : -1;
    for (const ring of [INNER, MIDDLE]) for (const o of OCTANTS) {
      const at = ring * 8 + o;
      if (cells[at] !== EMPTY) continue;
      if (stack && ring === MIDDLE && o === column) { cells[at] = cells[INNER * 8 + o]; continue; }
      cells[at] = rng.integer(0, 4);
    }
    const stacks = stackedColumns(cells);
    // Other stacks only where the targets force them (a ring 1 and a ring 2 target of one colour in a column).
    const forced = OCTANTS.filter((o) => preFilled(p.targets).some((t) => t.ring === INNER && t.octant === o && preFilled(p.targets).some((u) => u.ring === MIDDLE && u.octant === o && u.colour === t.colour)));
    if (stack && (!stacks.includes(column) || stacks.some((o) => o !== column && !forced.includes(o)))) continue;
    const position: Position = { cells, targets: p.targets.map((t) => ({ ...t })), entry: { ...p.entry } };
    // No runs already on the board, and the constellation not charted.
    if (settled(position)) return position;
  }
  return null;
}

/** Whether a board still holds a target in ring 3 to build towards (every ring 3 topic needs one). */
export const hasRing3Target = (targets: Target[]) => targets.some((t) => t.ring === TOP);
