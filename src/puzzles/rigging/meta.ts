import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';

export default {
  title: 'Rigging',
  description: 'Slide the ropes of a hexagonal rigging net so three or more matching pieces touch the active pulley. Wilds, gaffs, tar and splices, with any difficulty and maneuver token practice.',
  help: 'Drag a piece along any of its three ropes and let go to slide. Or press W E A D Z X to move the cursor, S to select, the same keys to slide and S again to let go; Space cancels. Escape pauses. Controls can be changed in Settings.',
  width: 450,
  height: 600,
  order: 2,
  thumbnail,
} satisfies PuzzleMeta;
