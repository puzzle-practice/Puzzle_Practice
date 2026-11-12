// The Dennav tutorial's lessons: what each kind of clear is, how to recognise it from what a move
// sets off, and the boards it starts from (most of them from real sessions).
import { INNER, TOP, freeEntry, horizontalIn, verticalThroughInner, readPosition, type Action, type Example, type Outcome } from './engine';

export interface Moment extends Example { label: string }

export interface Lesson {
  id: string;
  title: string;
  /** What the strategy is for, then how it works, as short paragraphs. */
  intro: string[];
  /** What to check on a board before making the move. */
  lookFor: string[];
  /** Whether a move set this strategy off. */
  accepts: (o: Outcome) => boolean;
  /** Said when a practice move works. */
  success: string;
  /** Boards to start examples from. */
  moments: Moment[];
}

const rotate = (ring: number, clockwise: boolean): Action => ({ kind: 'rotate', ring, clockwise });
const moment = (label: string, code: string, action: Action): Moment => ({ label, position: freeEntry(readPosition(code)), action });

const first = (o: Outcome) => o.links.find((l) => l.kind === 'target');
const before = (o: Outcome) => o.links.filter((l) => l.kind === 'run' && !l.afterChart);

export const LESSONS: Lesson[] = [
  {
    id: 'cascade-single',
    title: 'Cascade single',
    intro: [
      'The bread-and-butter clear. Chart the constellation as a single, and have a horizontal clear in ring 1 go off straight after it, in the same move.',
      'Charting counts as a clear. A clear that follows it in the same move charges the next constellation: its ring 1 targets are dealt already wild. So you can chain singles while keeping the inner ring wild.',
      'Set it up by fixing ring 1 so that two stars of one colour sit either side of a target, or two in a row on one side of it. When the constellation clears, the target cell empties and a star of that colour drops in to make three, usually from just above it in ring 2.',
    ],
    lookFor: [
      'A pair in ring 1 that a target sits beside or between.',
      'The star directly above that target, in ring 2, is the pair\'s colour.',
      'Everything else in the constellation is filled, so the last move charts it.',
    ],
    accepts: (o) => o.charted === 1 && !before(o).length && o.links.some((l) => l.afterChart && horizontalIn(l, INNER)) && o.nextInnerWild,
    success: 'Charted as a single, and the ring 1 cascade straight after left the next inner ring wild.',
    moments: [
      moment('Session 1 at 7:17', 'N4:.........2.10....324131222100313:32*,34*,36*,202,272,121,33*:42', rotate(1, true)),
      moment('Session 1 at 5:24', 'N4:.........13.....00442..101101011:30*,31*,32*,200,23*,113,33*:21', rotate(1, true)),
      moment('Session 1 at 7:39', 'N4:.........4.......400120342312004:33*,31*,32*,241,273,124:30', rotate(1, false)),
      moment('Session 1 at 7:56', 'N4:.............0..40.3223102423310:35*,31*,32*,263,27*,140:10', rotate(1, true)),
      moment('Session 1 at 8:12', 'N4:.........2.....00102423413232134:35*,37*,33*,220,20*,100:31', rotate(1, false)),
      moment('Session 1 at 8:23', 'N4:............0...4...123.32143341:32*,36*,33*,24*,204,150:34', rotate(1, false)),
      moment('Session 1 at 8:41', 'N4:..........1.....22031.4032113244:34*,31*,30*,270,202,111:21', rotate(1, true)),
    ],
  },
  {
    id: 'top-double',
    title: 'Top ring double',
    intro: [
      'Make a horizontal clear in ring 3 that runs through the ring 3 target. The stars above it in ring 4 drop into the gap, and the one that lands on the target is the colour the target wants.',
      'The ring 3 clear is the first link and charting is the second, so the constellation goes as a double. A double charges the next constellation on its own, with no cascade needed.',
      'Ring 4 is the place to keep the colour you need: turn it so the right star sits over the target, then trigger the ring 3 clear.',
    ],
    lookFor: [
      'Two stars of one colour in ring 3 next to the ring 3 target, with the target holding (or about to hold) a third.',
      'The ring 4 star above the target is the target\'s colour.',
      'Every other target is filled or wild.',
    ],
    accepts: (o) => o.charted === 2 && before(o).length === 1 && horizontalIn(before(o)[0], TOP) && !first(o)!.scene.targets.some((t) => t.ring === TOP && t.wild),
    success: 'Ring 3 cleared through the target and the right colour dropped in: a double.',
    moments: [
      moment('Session 1 at 6:40', 'N4:.301.....33220144011342021144112:31*,30*,36*,270,210,121:44', rotate(0, true)),
      moment('Session 1 at 6:53', 'N4:.20......224....4041134140144122:30*,35*,32*,231,204,110:26', rotate(0, true)),
      moment('Session 1 at 5:00', 'N4:...420..11.441440132100333032211:30*,31*,32*,273,241,142,33*:35', rotate(1, false)),
    ],
  },
  {
    id: 'top-triple',
    title: 'Top ring triple',
    intro: [
      'The same ring 3 idea, but this time the ring 3 clear turns the target next to it wild instead of filling it.',
      'A clear only turns targets wild if it is the second link or later in a move: the first clear after a move never does. So the ring 3 clear has to be set off by something else, here a first ring 3 clear whose drop-in completes a second one beside the target.',
      'Link 1 clears, link 2 (in ring 3, next to the target) turns it wild, and the constellation charts as the third link: a triple.',
    ],
    lookFor: [
      'A ring 3 target filled with the wrong colour, with a pair beside it in ring 3.',
      'A first clear whose drop-in brings the pair\'s colour down next to them.',
      'Every other target is filled or wild.',
    ],
    accepts: (o) => o.charted === 3 && before(o).length === 2 && horizontalIn(before(o)[1], TOP) && before(o)[1].wilded.some((t) => t.ring === TOP),
    success: 'The second clear was in ring 3 beside the target, so it went wild and charted as a triple.',
    moments: [
      moment('Built example', 'N4:.0.1.....001143.2323424341340310:30*,33*,36*,213,264,152:26', rotate(0, true)),
    ],
  },
  {
    id: 'vertical-triple',
    title: 'Vertical triple',
    intro: [
      'A vertical clear through rings 1, 2 and 3 empties a whole column, so the ring 4 star above it drops all the way into ring 1.',
      'Pick that ring 4 star so it lands between or beside a ring 1 pair: it makes a horizontal clear in ring 1 as the second link. Being a second link, it turns every target next to it wild.',
      'With those targets wild the constellation charts as the third link: a triple.',
    ],
    lookFor: [
      'Three of one colour lined up (or one turn away) through rings 1–3 in one column.',
      'The ring 4 star above that column matches a ring 1 pair next to the column.',
      'The targets that are wrong are next to where the ring 1 clear will be.',
    ],
    accepts: (o) => o.charted === 3 && before(o).length === 2 && verticalThroughInner(before(o)[0]) && horizontalIn(before(o)[1], INNER) && before(o)[1].wilded.length > 0,
    success: 'Vertical through rings 1–3, the ring 4 star dropped into ring 1 for a horizontal clear, and the targets beside it went wild: a triple.',
    moments: [
      moment('Session 1 at 0:34', 'N4:104...34022012141033041222404133:300,223,271,122:37', rotate(3, false)),
      moment('Session 1 at 2:58', 'N4:2.......20403.144430321141230422:370,322,311,243,223,120:10', rotate(1, false)),
    ],
  },
  {
    id: 'drop-in-vertical',
    title: 'Ring 3 into a vertical',
    intro: [
      'Turn it round: a horizontal clear in ring 3 drops a star from ring 4 into a column that already has two of its colour in rings 1 and 2.',
      'That makes a vertical clear through rings 1, 2 and 3 as the second link, which turns every target bordering the column wild, even ones filled with the wrong colour.',
      'The constellation then charts as a triple.',
    ],
    lookFor: [
      'A pair of one colour stacked in rings 1 and 2 of one column.',
      'A ring 3 clear you can set off that passes over that column.',
      'A ring 4 star of the pair\'s colour above the column, ready to drop in.',
    ],
    accepts: (o) => o.charted === 3 && before(o).length === 2 && horizontalIn(before(o)[0], TOP) && verticalThroughInner(before(o)[1]) && before(o)[1].wilded.length > 0,
    success: 'The ring 3 clear dropped a star into a vertical through rings 1–3, and the targets around it went wild: a triple.',
    moments: [
      moment('Session 1 at 4:08', 'N4:143.....113202..0404200324030411:32*,34*,35*,234,242,120,33*:05', rotate(1, false)),
    ],
  },
  {
    id: 'donkey',
    title: 'Donkey+ (bag pairs)',
    intro: [
      'Stars come in a mixed bag with two of each colour, so ring 1 can be built as four pairs: two of each colour side by side, with one colour split.',
      'Once a clear removes one ring 1 star, the star dropping in joins a pair and clears it, and the gap that leaves lets the next pair\'s third star drop in, and so on round the ring. Every link after the first turns the targets beside it wild, so most of the board goes wild.',
      'Only the ring 3 star that starts the chain off really matters: get that right and the inner ring runs itself, charting as a donkey (5) or better.',
    ],
    lookFor: [
      'Ring 1 built from pairs, each pair\'s third star waiting above the next gap.',
      'The trigger: one clear (often a vertical) that knocks the first ring 1 star out.',
      'Targets near the ring 1 pairs, so the cascade turns them wild.',
    ],
    accepts: (o) => (o.charted ?? 0) >= 5 && before(o).filter((l) => horizontalIn(l, INNER)).length >= 3,
    success: 'The ring 1 pairs chained round and the constellation charted as a donkey or better.',
    moments: [
      moment('Session 2 at 1:04 (clean board)', 'N4:4.1.1...124002334240230400141122:374,232,242,104:20', rotate(3, true)),
    ],
  },
  {
    id: 'vegas',
    title: 'Vegas',
    intro: [
      'A vegas is the donkey idea taken one link further: the constellation has to wait until the sixth link to chart.',
      'That means no target may complete early. In your session 3 board, the ring 2 star that turns into the orange target was orange, so that target was filled correctly before the chain began. The constellation charted at link 5 as a donkey, and the yellow ring 1 clear came after it.',
      'Make that star any other colour and the target is filled wrong. It only turns wild when the yellow clear goes off next to it, so the constellation charts at link 6: a vegas.',
    ],
    lookFor: [
      'Every target filled with the wrong colour or waiting to go wild, except the ones the chain fills last.',
      'Each ring 1 link turns the next target wild, in order.',
      'Nothing completes the constellation before the last link you planned.',
    ],
    accepts: (o) => (o.charted ?? 0) >= 6,
    success: 'Six links before charting: a vegas.',
    moments: [
      moment('Session 3 at 1:11, fixed', 'N4:..34...1100203243042114244033221:353,272,201,134:26', rotate(2, false)),
    ],
  },
];

/** Your session 3 board as played: the orange target was filled correctly, so it charted a link early. */
export const VEGAS_AS_PLAYED = moment('Session 3 at 1:11, as played', 'N4:..34...1100203243042114144033221:353,272,201,134:26', rotate(2, false));
