import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';

export default {
  title: 'Bilging',
  description: 'Swap pieces to line up three or more, pump crabs out above the water and burst puffers and jellies. Choose any difficulty, water level and maneuver token practice.',
  help: 'Arrow keys move the cursor; Space swaps the two pieces under it. You can also point and click. Escape pauses. In Freeplay mode, hold 1-7 to paint a colour, 8 a puffer, 9 a crab or 0 a jellyfish, or select a palette piece and left-click to place it; scroll to cycle pieces. Controls can be changed in Settings.',
  width: 450,
  height: 600,
  order: 5,
  thumbnail,
} satisfies PuzzleMeta;
