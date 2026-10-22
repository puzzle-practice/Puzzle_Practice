import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';

export default {
  title: 'Swordfight',
  description: 'Swordfighting recreated from the game: drop pairs, shatter them with breakers and fuse blocks into swords to strike your opponents, against training opponents or on your own.',
  help: 'Left and right move the pair, down turns it clockwise and up anticlockwise, and holding Space drops it faster. With several opponents, A and S (or [ and ]) change who you attack, or click their status on the right. In Freeplay mode, hold 1–8 over the board to paint pieces and breakers (0 clears), choose the falling and next pairs, and share boards as text. Keys can be changed on the Settings tab.',
  width: 450,
  order: 9,
  thumbnail,
} satisfies PuzzleMeta;
