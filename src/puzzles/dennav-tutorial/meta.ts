import type { PuzzleMeta } from '../../core/puzzle';
import thumbnail from '../navigation/thumbnail.jpg?url';

export default {
  title: 'Navigation',
  description: 'Learn the Dennav chains: cascade singles, top ring doubles and triples, verticals, donkeys and vegas. Watch examples, paint vertical-triple plans, practise boards, build a donkey from scratch and spot mistakes.',
  help: 'R (or Ctrl) starts a new board without judging the one in play. Build normally, then Enter submits. After a fail: Space retries, Enter skips. Correct positions advance automatically. Show controls lists the movement keys.',
  width: 450,
  height: 600,
  order: 8.5,
  thumbnail,
  // A mode of Navigation, chosen from its Mode setting.
  hidden: true,
} satisfies PuzzleMeta;
