import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';

export default {
  title: 'Sailing',
  description: 'Fill platforms and build cascading chains with joined falling pieces. Freeplay builds boards with platforms, joined pairs, singles and blockers.',
  help: 'Left/Right move. Up rotates counterclockwise; Down clockwise. Hold Space to fall faster. Escape pauses. In Freeplay, click to place and right-click to erase, then Play board to try your layout. Controls can be changed in Settings.',
  width: 450,
  height: 600,
  order: 1,
  thumbnail,
} satisfies PuzzleMeta;
