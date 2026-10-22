import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';

export default {
  title: 'Gunning',
  description: 'Steer powder, wad and shot into the cannons. Practise ordinary gunning, Viking firing, Freeplay, or mirrored loop drills scored in guns per minute.',
  help: 'Point at a cell and click to lay the selected arrow there; drag from the cell to pick its direction, or turn it with the mouse wheel. Arrow keys move the cursor, W A S D select the arrow and Space lays it. Escape pauses. Controls can be changed in Settings. Speed is below the board. Freeplay lets you paint the deck, move its single barrel by dragging or with 9, freeze it, and share it as text.',
  width: 450,
  height: 600,
  order: 6,
  thumbnail,
} satisfies PuzzleMeta;
