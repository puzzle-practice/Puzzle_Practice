import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';

export default {
  title: 'Weaving',
  description: 'Slide the shuttle and batten matching threads into groups of four. Build chains to fill a bolt of cloth.',
  help: 'Move the mouse or press Left/Right to slide the shuttle. Click or press Space to batten. Escape pauses. Difficulty is on the Settings tab. Freeplay mode lets you paint any loom and shuttle to show a setup.',
  width: 450,
  height: 600,
  thumbnail,
  order: 16,
} satisfies PuzzleMeta;
