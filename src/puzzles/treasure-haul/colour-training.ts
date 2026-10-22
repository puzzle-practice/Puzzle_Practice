import { HaulBoard, H } from './logic';
import { Random } from '../../core/random';
import { solveColourDrill } from './edge-training';

export { colourAboveChest } from './edge-training';
import type { Drill } from './training';

/**
 * Three problem coins above the chest in one of its columns, and one to four above it in the
 * other. The rest of the board and its refills are ordinary; the drill is about the coins above
 * the chest, so it ends when none of that colour is left there.
 */
export function createColourDrill(random: () => number): Drill {
  // Each attempt picks a fresh layout, so an unsolvable one doesn't sink the whole drill.
  for (let attempt = 0; attempt < 400; attempt++) {
    const drill = tryColourDrill(random);
    if (drill) return drill;
  }
  throw new Error('Unable to generate a colour cleanup drill');
}

function tryColourDrill(random: () => number): Drill | null {
  const colour = Math.floor(random() * 4);
  const x = 2 + Math.floor(random() * 3);
  const y = 1 + Math.floor(random() * 2);
  const main = x + Math.floor(random() * 2);
  const other = main === x ? x + 1 : x;
  const direction = main === x ? -1 : 1;
  const count = 1 + Math.floor(random() * 4);
  const shuffle = <T>(values: T[]): T[] => {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    let nextPiece = () => random();
    const board = new HaulBoard(() => nextPiece());
    board.populate(); board.placeChest(x, y, Math.floor(random() * 3)); board.gemRates = [0, 0];
    // Above the chest, only the placed coins are the problem colour.
    for (const column of [x, x + 1]) for (let row = y + 1; row < H; row++) {
      if (board.get(column, row) === colour) board.set(column, row, (colour + 1 + Math.floor(random() * 3)) % 4);
    }
    const put = (column: number, coins: number, aboveChest: boolean) => {
      const rows = shuffle(Array.from({ length: aboveChest ? H - y - 1 : H }, (_, i) => aboveChest ? y + 1 + i : i));
      for (const row of rows.slice(0, coins)) board.set(column, row, colour);
    };
    put(main, 3, true); put(other, count, true);
    // Outside coins allow horizontal clears. With one or two adjacent problem
    // coins, clearing the vertical three first can strand that smaller group.
    put(main + direction, 3, false);
    put(main + 2 * direction, Math.max(0, 3 - count), false);
    if (count > 3) { put(other - direction, count - 3, false); put(other - 2 * direction, count - 3, false); }
    if (board.findRuns().length) continue;
    // Only the problem colour may meet the brief: three in one chest column and some in the other.
    const above = (column: number, piece: number) => {
      let n = 0;
      for (let row = y + 1; row < H; row++) if (board.get(column, row) === piece) n++;
      return n;
    };
    const meets = (piece: number) => Math.max(above(x, piece), above(x + 1, piece)) >= 3 && Math.min(above(x, piece), above(x + 1, piece)) >= 1;
    if ([0, 1, 2, 3].some((piece) => piece !== colour && meets(piece))) continue;
    const refillRng = new Random(Math.floor(random() * 0x100000000));
    const refills: number[] = [];
    const draw = (index: number) => {
      while (refills.length <= index) refills.push(refillRng.random());
      return refills[index];
    };
    const solution = solveColourDrill(board, x, colour, draw);
    if (!solution) continue;
    let refill = 0;
    nextPiece = () => draw(refill++);
    return { board, chest: { x, y }, colourGoal: colour, solution };
  }
  return null;
}
