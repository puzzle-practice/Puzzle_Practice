import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';

export default {
  title: 'Navigation',
  description: 'Arrange stars into constellations. Normal and Werewolf navigation from the test game.',
  help: 'Up/Down select a ring. Left/Right rotate it. Space drops the incoming star. Click a ring to select it; left/right click to rotate, or use the buttons. Escape pauses. Boards → Freeplay lets you paint the stars, targets and incoming star, and share the board as text.',
  width: 450,
  height: 600,
  order: 8,
  thumbnail,
} satisfies PuzzleMeta;
