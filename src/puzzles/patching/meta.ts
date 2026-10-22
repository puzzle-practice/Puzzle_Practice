import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from './thumbnail.jpg?url';
export default {
  title: 'Patching',
  description: 'Swap and rotate tears to connect the spool to every tie-off. Close loose ends with grommets before the wind gusts.',
  help: 'Drag pieces to swap. Mouse wheel or Q/E rotates. A quick left click rotates counterclockwise; right click rotates clockwise. WASD or arrows move the cursor; Space selects pieces to swap. Enter or the spool requests a safe gust. Escape pauses. Freeplay mode lets you paint any board with keys 1–8 or a palette and share it as text.',
  width: 450, height: 600, order: 4, thumbnail,
} satisfies PuzzleMeta;
