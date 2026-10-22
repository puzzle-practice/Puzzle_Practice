import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';

export default {
  title: 'Shipwrightery',
  description: 'Arrange ship parts, pack combos and beat the tide. All nine difficulty levels, including gold and overtime.',
  help: 'Click two neighboring materials to swap, or hold and drag. Wood moves vertically, iron horizontally, rope diagonally; cloth needs a neighbor’s movement. Gold cannot move and matches any material. Pick up a pattern below, then click its matching position on the board. Right-click cancels. Swapping breaks the combo. R starts a new game; Esc pauses. Freeplay mode lets you paint any board and choose its pattern cards: hold 1–5 over a square, or pick a material and click; copy and paste boards to share them.',
  width: 450, height: 600, order: 13, thumbnail,
} satisfies PuzzleMeta;
