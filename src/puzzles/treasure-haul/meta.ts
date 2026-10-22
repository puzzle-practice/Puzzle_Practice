import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';

export default {
  title: 'Treasure Haul',
  description: 'Match coins and use gems to haul treasure. Play with 0, 1 or 2 chests, practice Spawn Chests, or clear as many chests as possible across four training packs.',
  help: 'The cursor covers two squares: click, or press Space or Enter, to swap them. Arrow keys move the cursor. Clicking a ruby or emerald sets it off. In Freeplay mode, hold 1-4 to paint a coin, 5 a ruby, 6 an emerald or 7-9 a chest, or select a palette piece and left-click to place it.',
  width: 450,
  height: 600,
  order: 7,
  thumbnail,
} satisfies PuzzleMeta;
