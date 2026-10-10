import { HaulBoard, W, H, RUBY, EMERALD } from './logic';
import { PyRandom } from '../../core/pyrandom';

export type ClearPack = 'standard' | 'efficient' | 'emeralds' | 'edges';
export interface Drill {
  board: HaulBoard;
  chest: { x: number; y: number };
  /** A known opening for the efficient pack, useful for validation. */
  opening?: [number, number];
  /** A complete route through a constructed edge drill. */
  solution?: [number, number][];
  edgePattern?: 'horizontal' | 'vertical' | 'single-emerald' | 'double-emerald';
}

/** Practice boards have no automatic matches, and never overwrite another chest. */
export function createDrill(random: () => number, pack: ClearPack, rules: 1 | 2 = 2): Drill {
  if (rules === 1 || pack === 'standard' || pack === 'efficient') return createLegacyDrill(random, pack);
  if (pack === 'edges') return createEdgeDrill(random);
  const x = 2 + Math.floor(random() * 3);
  const y = 3 + Math.floor(random() * 3);
  for (let attempt = 0; attempt < 500; attempt++) {
    const board = new HaulBoard(random);
    board.populate();
    board.placeChest(x, y, Math.floor(random() * 3));
    board.set(0, 7, EMERALD);
    board.set(W - 1, 7, EMERALD);
    if (!board.findRuns().length) return { board, chest: { x, y } };
  }
  const fallback = new PyRandom(0);
  return createDrill(() => fallback.random(), pack);
}

/** Original layouts and random draw order are retained for saved replays. */
function createLegacyDrill(random: () => number, pack: ClearPack): Drill {
  const edge = pack === 'edges';
  const gemEdge = edge && random() < 0.5;
  const x = edge ? (random() < 0.5 ? 0 : W - 2) : 2 + Math.floor(random() * 3);
  // Both chest rows lie inside the middle four rows (2–5).
  const combo = pack === 'efficient' || (edge && !gemEdge);
  const y = combo ? 5 : 3 + Math.floor(random() * 3);
  for (let attempt = 0; attempt < 500; attempt++) {
    const board = new HaulBoard(random);
    board.populate();
    board.placeChest(x, y, Math.floor(random() * 3));
    const outside = x === W - 2 ? x - 1 : x + 2;
    let opening: [number, number] | undefined;
    if (pack === 'efficient') {
      const colour = Math.floor(random() * 4);
      const other = (colour + 1) % 4;
      const mirrored = random() < 0.5;
      const column = mirrored ? x + 1 : x;
      const direction = mirrored ? -1 : 1;
      // Swapping rows 1 and 0 completes a same-colour cross beneath the chest.
      // The vertical three are entirely below it; the horizontal crosses its other column.
      board.set(column, 3, colour);
      board.set(column, 2, colour);
      board.set(column, 1, other);
      board.set(column, 0, colour);
      board.set(column + direction, 1, colour);
      board.set(column + 2 * direction, 1, colour);
      const start = Math.min(column, column + 2 * direction);
      const end = Math.max(column, column + 2 * direction);
      if (start > 0) board.set(start - 1, 1, other);
      if (end < W - 1) board.set(end + 1, 1, other);
      opening = [column, 1];
    } else if (combo) {
      const a = Math.floor(random() * 4);
      const b = (a + 1) % 4;
      const c = (a + 2) % 4;
      // One swap makes a horizontal 3 above the chest and a vertical 3 beside it.
      // The piece at row 3 then rises into a second horizontal 3, hauling the chest.
      board.set(x, 7, a); board.set(x + 1, 7, a);
      board.set(x, 6, c); board.set(x + 1, 6, c);
      board.set(outside, 7, b); board.set(outside, 6, a);
      board.set(outside, 5, b); board.set(outside, 4, b); board.set(outside, 3, c);
      const start = Math.min(x, outside);
      const end = Math.max(x + 1, outside);
      if (start > 0) board.set(start - 1, 7, b);
      if (end < W - 1) board.set(end + 1, 7, b);
      opening = [outside, 7];
    }
    if (pack === 'emeralds') {
      board.set(0, 7, EMERALD);
      board.set(W - 1, 6, EMERALD);
    }
    if (gemEdge) {
      // Chained rubies above both columns clear the otherwise stuck edge pieces.
      board.set(x, 7, RUBY);
      board.set(x + 1, 7, RUBY);
    }
    if (!board.findRuns().length) return { board, chest: { x, y }, ...(opening && { opening }) };
  }
  // A deterministic, validated fallback still carries the pack's promised solution.
  const fallback = new PyRandom(0);
  return createLegacyDrill(() => fallback.random(), pack);
}

/** An emerald reaches a column on up to two diagonals, not just one square. */
export function emeraldRowsInColumn(x: number, y: number, column: number): number[] {
  const distance = Math.abs(x - column);
  if (!distance) return [];
  return [y - distance, y + distance].filter((row) => row >= 0 && row < H);
}

/**
 * Account for every coin above the outer chest column:
 *   locked coins = 3 × vertical threes + horizontal matches + emerald targets.
 * A horizontal match uses the inner chest column and its neighbour. Emerald targets
 * are counted from both diagonals. The remaining inner column has its own final match.
 */
function createEdgeDrill(random: () => number, fallback = false): Drill {
  const left = random() < 0.5;
  const at = (column: number) => left ? column : W - 1 - column;
  const patterns = ['horizontal', 'vertical', 'single-emerald', 'double-emerald'] as const;
  const edgePattern = patterns[Math.floor(random() * patterns.length)];
  const y = edgePattern === 'vertical' ? 3 : edgePattern === 'double-emerald' ? 4 : 3 + Math.floor(random() * 2);
  const x = left ? 0 : W - 2;
  for (let attempt = 0; attempt < 500; attempt++) {
    // Keep the checked refill sequence separate from animation randomness during play.
    const refills: number[] = [];
    let refill = 0;
    const board = new HaulBoard(() => refill < refills.length ? refills[refill++] : random());
    board.populate();
    board.placeChest(x, y, Math.floor(random() * 3));
    board.gemRates = [0, 0];
    const colours = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [colours[i], colours[j]] = [colours[j], colours[i]];
    }
    const [a, b, c, d] = colours;
    const set = (column: number, row: number, piece: number) => board.set(at(column), row, piece);
    let solution: [number, number][];
    if (edgePattern === 'horizontal' || edgePattern === 'single-emerald') {
      const unmatched = edgePattern === 'single-emerald' ? 1 : 0;
      const pairs = 7 - y - unmatched;
      for (let i = 0; i < pairs; i++) {
        const row = y + 1 + unmatched + i;
        const colour = i % 2 ? b : a;
        set(0, row, colour); set(1, row, colour);
        set(2, 6 - (pairs - 1 - i), colour);
      }
      set(2, 7, c); set(3, 7, d);
      solution = Array.from({ length: pairs }, () => [at(2), 7]);
      if (unmatched) {
        set(0, y + 1, d); set(1, y + 1, c);
        set(3, 6, d); set(3, 5, c);
        // Pair clears lift this emerald to row 4; the inner-column match lifts it to 5.
        // From there its upper diagonal reaches the last outer coin at row 7.
        set(2, 4 - pairs, EMERALD);
        solution.push([at(3), 6], [at(3), 7], [at(2), 5]);
      }
    } else if (edgePattern === 'vertical') {
      for (const column of [0, 1]) {
        set(column, 4, a); set(column, 5, a); set(column, 6, b); set(column, 7, a);
      }
      set(2, 7, c); set(2, 6, c); set(2, 5, b); set(3, 7, d);
      solution = [[at(0), 7], [at(1), 7], [at(2), 6], [at(2), 7]];
    } else {
      set(0, 5, c); set(0, 6, a); set(0, 7, c);
      set(1, 5, b); set(1, 6, EMERALD); set(1, 7, a);
      set(2, 7, c); set(2, 6, a); set(2, 5, c); set(2, 4, b);
      set(3, 7, d); set(3, 6, d); set(3, 5, b);
      // The emerald hits outer rows 5 and 7 together. The remaining A forms a
      // horizontal three; a separate B match then opens the inner chest column.
      solution = [[at(1), 6], [at(3), 6], [at(3), 7]];
    }
    if (!board.findRuns().length) {
      const checked = checkSolution(board, solution, random);
      if (checked) {
        refills.push(...checked);
        return { board, chest: { x, y }, solution, edgePattern };
      }
    }
  }
  if (fallback) throw new Error(`Unable to construct ${edgePattern}`);
  const fixed = new PyRandom(0);
  return createEdgeDrill(() => fixed.random(), true);
}

/** Retain the tested refills so the playable board follows the verified route. */
function checkSolution(original: HaulBoard, solution: [number, number][], random: () => number): number[] | null {
  const refills: number[] = [];
  const board = new HaulBoard(() => { const draw = random(); refills.push(draw); return draw; });
  board.cells.splice(0, board.cells.length, ...original.cells);
  board.gemRates = [0, 0];
  for (let move = 0; move < solution.length; move++) {
    const swap = board.swap(...solution[move]);
    if (swap.kind === 'illegal' || swap.kind === 'same') return null;
    let hauled = 0;
    let settled = false;
    for (let step = 0; step < 300; step++) {
      const result = board.step();
      if (!result) { settled = true; break; }
      if (result.kind === 'haul') hauled += result.chests.length;
    }
    if (!settled || hauled !== (move === solution.length - 1 ? 1 : 0)) return null;
    board.settle();
  }
  return refills;
}
