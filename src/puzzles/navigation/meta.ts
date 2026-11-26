import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';

export default {
  title: 'Navigation',
  description: 'Arrange stars into constellations. Normal and Dennav navigation.',
  help: 'Up/Down select a ring. Left/Right rotate it. Space drops the incoming star. Click or tap a ring to select it; drag around it with a mouse or swipe left/right with a finger to rotate it. Settings → Controls has mobile buttons and the touch gesture setting. Escape pauses. Mode → Freeplay lets you paint the stars, targets and incoming star, and share the board as text.',
  width: 450,
  height: 600,
  order: 8,
  thumbnail,
} satisfies PuzzleMeta;
