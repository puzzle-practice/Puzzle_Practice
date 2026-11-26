// Donkey "Build Ring 1": the player places the first bag (ten stars, two of each colour) into the
// donkey shape. Ring 1 is three pairs side by side and the two leftover colours next to each other
// (A A B B C C D E). Ring 2 holds the other D and E side by side (either way round), or in the same
// order with one or two gaps between them (D . E or D . . E); how ring 2 is turned doesn't matter.
import { COLOUR_NAMES } from '../navigation/create';
import { EMPTY } from '../navigation/logic';
import { INNER, MIDDLE } from './engine';

/** The first bag: two stars of each colour. */
export const BAG_STARS = 10;

export type RingJudgement =
  | { kind: 'building' }
  | { kind: 'pass' }
  | { kind: 'fail'; message: string; cells: number[] };

const name = (colour: number) => COLOUR_NAMES[colour].toLowerCase();
const plural = (colour: number) => `${name(colour)}s`;
const OCTANTS = [0, 1, 2, 3, 4, 5, 6, 7];
const at = (ring: number, octant: number) => ring * 8 + ((octant % 8) + 8) % 8;

/** How many stars are on the board. */
export const starsDown = (cells: number[]): number => cells.filter((c) => c !== EMPTY).length;

/**
 * Judges the board (all its cells). It is still being built until all ten stars of the bag are down
 * and ring 1 is full: with ten down, turning a ring can still drop a ring 2 star into a ring 1 gap.
 * `final` judges it as it stands: the player submitted, or dropped an eleventh star. A third star of
 * a colour in ring 1, or a second one that isn't beside the first, fails at once.
 */
export function judgeDonkeyRing(cells: number[], final = false): RingJudgement {
  const ring = OCTANTS.map((o) => cells[at(INNER, o)]);
  const counts = new Map<number, number[]>();
  ring.forEach((c, o) => { if (c !== EMPTY) counts.set(c, [...(counts.get(c) ?? []), o]); });
  const next = (o: number) => (o + 1) % 8;
  for (const [colour, os] of counts) {
    if (os.length > 2) return { kind: 'fail', message: `${os.length === 3 ? 'Three' : os.length} ${plural(colour)} in ring 1.`, cells: os.map((o) => at(INNER, o)) };
    // A pair split as soon as its second star lands: ring 1 stars never move closer together.
    if (os.length === 2 && next(os[0]) !== os[1] && next(os[1]) !== os[0]) return { kind: 'fail', message: `The ${plural(colour)} aren’t side by side.`, cells: os.map((o) => at(INNER, o)) };
  }
  const placed = starsDown(cells);
  if (placed < BAG_STARS) {
    return final ? { kind: 'fail', message: `${placed} of the ${BAG_STARS} stars placed.`, cells: [] } : { kind: 'building' };
  }
  if (!final && ring.includes(EMPTY)) return { kind: 'building' };
  const outer = cells.flatMap((c, i) => (c !== EMPTY && Math.floor(i / 8) < MIDDLE ? [i] : []));
  if (outer.length) return { kind: 'fail', message: 'Stars above ring 2.', cells: outer };
  if (ring.includes(EMPTY)) return { kind: 'fail', message: 'Ring 1 isn’t full.', cells: OCTANTS.filter((o) => ring[o] === EMPTY).map((o) => at(INNER, o)) };

  // Ring 1 (pairs already side by side): the two leftover colours next to each other.
  const singles = [...counts].filter(([, os]) => os.length === 1).map(([colour, os]) => ({ colour, o: os[0] }));
  if (singles.length !== 2) return { kind: 'fail', message: 'Four pairs: leave two colours as singles.', cells: [] };
  // D then E going round in direction `step` (1 or -1).
  let [d, e] = singles;
  if (next(e.o) === d.o) [d, e] = [e, d];
  if (next(d.o) !== e.o) return { kind: 'fail', message: `The leftover ${name(d.colour)} and ${name(e.colour)} aren’t next to each other.`, cells: [at(INNER, d.o), at(INNER, e.o)] };

  // Ring 2: the other D and E, the same way round as in ring 1, with one gap between them.
  const middle = OCTANTS.filter((o) => cells[at(MIDDLE, o)] !== EMPTY);
  const colours = middle.map((o) => cells[at(MIDDLE, o)]).sort().join();
  if (middle.length !== 2 || colours !== [d.colour, e.colour].sort().join()) {
    return { kind: 'fail', message: `Ring 2 should hold the other ${name(d.colour)} and ${name(e.colour)}.`, cells: middle.map((o) => at(MIDDLE, o)) };
  }
  const d2 = middle.find((o) => cells[at(MIDDLE, o)] === d.colour)!, e2 = middle.find((o) => cells[at(MIDDLE, o)] === e.colour)!;
  const ring2 = [at(MIDDLE, d2), at(MIDDLE, e2)];
  // E one to three places on from D, the way it is in ring 1: side by side (D E), or with one or two gaps
  // (D . E, D . . E). Four places on is straight across, the same either way round.
  const ahead = (e2 - d2 + 8) % 8;
  // Side by side passes either way round.
  if ((ahead >= 1 && ahead <= 3) || ahead === 7) return { kind: 'pass' };
  if (ahead >= 5) return { kind: 'fail', message: `The ring 2 ${name(d.colour)} and ${name(e.colour)} are the wrong way round.`, cells: ring2 };
  return { kind: 'fail', message: `The ring 2 ${name(d.colour)} and ${name(e.colour)} are opposite each other.`, cells: ring2 };
}
