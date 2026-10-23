import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';

export default {
  title: 'Carpentry',
  description: 'Carpentry recreated from the game: patch the Vampire Lair’s coffins before planks rattle loose or holes split wider, or a ship’s hull at any duty difficulty with maneuver tokens.',
  help: 'Click a plank in the toolbox (or press 1, 2, 3) to pick it up, then click a hole to place it, or drag it there. Right-click or Space flips; the wheel, middle-click or X and C rotate. Z places the held plank or takes the selected toolbox piece. Until you take the next plank, click the one you just placed to nudge it a cell or turn it; placing that adjustment makes it final. Choose the Vampire Lair or a ship, then press Start to begin a two-minute session. On a ship, tokens are pieced together from the quarters on each plank, and a finished hole hands one over. Freeplay mode lets you paint the holes and choose the toolbox, and share the board as text.',
  width: 450,
  order: 3,
  thumbnail,
} satisfies PuzzleMeta;
