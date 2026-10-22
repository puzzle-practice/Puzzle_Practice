import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';
export default {
  title: 'Alchemistry',
  description: 'Rotate glass tubes, mix colors and fill bottles. Practice all nine difficulty levels with bonus, multifill and quicksilver pieces.',
  help: 'Left click: rotate anticlockwise. Right click: clockwise. Mouse wheel or Z/X: rotate. Arrow keys: select a tube. Space or FILL: fill bottles. Escape: pause. Freeplay mode lets you paint any tubes and bottles and share the board as text.',
  width: 450, height: 600, order: 12, thumbnail,
} satisfies PuzzleMeta;
