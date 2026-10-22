import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';

export default {
  title: 'Distilling',
  description: "Swap pieces so whites go into the jug and blacks into the furnace. Standard, Seeded, Freeplay and Practice modes.",
  help: 'Click a piece, then a neighbour to swap them, or drag a piece through several. Arrow keys or the number pad move the cursor, Space swaps, and X (or right-click) burns the column now. Esc pauses. In Freeplay mode, hold 1-5 to paint, or select a palette piece and left-click to place it. Select it again to deselect; scroll to cycle pieces.',
  width: 450,
  height: 600,
  order: 11,
  thumbnail,
} satisfies PuzzleMeta;
