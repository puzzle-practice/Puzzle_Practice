import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';

export default {
  title: 'Foraging',
  description: "Rotate 2×2 blocks to drop crates off the bottom. Puzzles, Gauntlet, Chaos, Normal and Werewolf foraging, with optional timers.",
  help: 'Move the mouse or the arrow keys to place the cursor. Left-click (or X) turns the 2×2 anticlockwise, right-click (or C) clockwise. Over a tool the cursor shrinks to it: click to use it, and the machete and earthquake go left or right with the button. In Werewolf, clear four pieces inside a moon to fire it: its beams clear along its two rows and down its two columns, passing over crates. Moons fade after four moves that clear pieces. The wolf refills a 5×5 area. In Freeplay mode, hold 1-0 to paint colours, tools and ants, or select a palette piece (crates too) and left-click to place it.',
  width: 450,
  height: 600,
  order: 15,
  thumbnail,
} satisfies PuzzleMeta;
