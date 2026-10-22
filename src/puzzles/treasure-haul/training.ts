import { HaulBoard, W, H, RUBY, EMERALD, EMPTY, isChest, isChestOrigin } from './logic';
import { Random } from '../../core/random';
import { createVariedEdgeDrill } from './edge-training';
import { createColourDrill } from './colour-training';

export type ClearPack = 'standard' | 'efficient' | 'emeralds' | 'edges';
export interface Drill {
  board: HaulBoard;
  chest: { x: number; y: number };
  /** A useful opening move for validation. */
  opening?: [number, number];
  /** A complete route through a constructed edge drill. */
  solution?: [number, number][];
  edgePattern?: 'horizontal' | 'vertical' | 'single-emerald' | 'double-emerald';
  /** Generation metadata; the exercise does not reveal this to the player. */
  impossible?: boolean;
  /** This drill ends when no coin of the chosen colour remains. */
  colourGoal?: number;
}
export interface DrillOptions { impossibleChests?: boolean }

/** Spawn practice: one ruby, or a neighbouring pair, above the bottom opening. */
export function createRubyBoard(random: () => number): HaulBoard {
  const pair = random() < 0.2;
  const column = 1 + Math.floor(random() * (pair ? W - 3 : W - 2));
  const row = 2 + Math.floor(random() * (H - 2));
  const board = new HaulBoard(random);
  board.populate();
  board.gemRates = [0, 0];
  board.set(column, row, RUBY);
  if (pair) board.set(column + 1, row, RUBY);
  return board;
}

/**
 * Check the actual chained blast without changing the board or consuming random
 * draws. A point requires a ruby above that chest column. The outer two columns
 * on each side must have no blockers left above the chest after one ruby click.
 */
export function rubySpawnScore(original: HaulBoard, chestX: number): number {
  const row = Array.from({ length: H }, (_, y) => y).find((y) => isChestOrigin(original.get(chestX, y)));
  if (row === undefined) return 0;
  let score = 0;
  for (const column of [chestX, chestX + 1]) {
    for (let y = row + 1; y < H; y++) {
      if (original.get(column, y) !== RUBY) continue;
      const blast = new HaulBoard(() => 0);
      blast.cells.splice(0, blast.cells.length, ...original.cells);
      const result = blast.swap(column, y);
      if (result.kind !== 'gem') continue;
      const blocked = [chestX, chestX + 1].some((x) => (x < 2 || x >= W - 2) &&
        Array.from({ length: H - row - 1 }, (_, i) => blast.get(x, row + 1 + i)).some((piece) => piece !== EMPTY));
      if (blocked) continue;
      const rubyColumns = new Set(result.cleared.filter((piece) => piece.piece === RUBY && piece.y > row &&
        piece.x >= chestX && piece.x <= chestX + 1).map((piece) => piece.x));
      score = Math.max(score, rubyColumns.size);
    }
  }
  return score;
}

/** Practice boards have no automatic matches, and never overwrite another chest. */
export function createDrill(random: () => number, pack: ClearPack, rules: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 = 8, options: DrillOptions = {}): Drill {
  if (pack === 'efficient' && rules >= 6) return createColourDrill(random);
  if (pack === 'standard' && rules >= 7) return createMiddleDrill(random);
  if (pack === 'emeralds' && rules >= 7) return createEdgeEmeraldsDrill(random);
  if (rules === 1 || pack === 'standard' || pack === 'efficient') return createLegacyDrill(random, pack);
  if (pack === 'edges') {
    if (rules >= 5) {
      if (options.impossibleChests && random() < 0.2) return createDeepEdgeDrill(random, options, {
        impossible: true, left: random() < 0.5, y: 1 + Math.floor(random() * 2), edgePattern: 'horizontal',
      });
      return createVariedEdgeDrill(random);
    }
    return rules >= 4 ? createDeepEdgeDrill(random, options) : createEdgeDrill(random);
  }
  if (rules >= 3) return createEmeraldDrill(random);
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
  const fallback = new Random(0);
  return createDrill(() => fallback.random(), pack, rules);
}

/** A random board with a chest already sitting in the middle four columns, in the middle rows. */
function createMiddleDrill(random: () => number): Drill {
  const x = 2 + Math.floor(random() * 3);
  const y = 3 + Math.floor(random() * 3);
  for (let attempt = 0; attempt < 500; attempt++) {
    const board = new HaulBoard(random);
    board.populate();
    board.placeChest(x, y, Math.floor(random() * 3));
    if (!board.findRuns().length) return { board, chest: { x, y } };
  }
  throw new Error('Unable to generate a middle chest drill');
}

/**
 * An ordinary board with an emerald somewhere on each edge to practise with. The chest sits in
 * the good columns (the middle four, never the outer two on either side), with its top on row 4
 * to 6, so at least 6 pieces sit beneath it.
 */
function createEdgeEmeraldsDrill(random: () => number): Drill {
  const x = 2 + Math.floor(random() * 3);
  const y = 4 + Math.floor(random() * 3);
  for (let attempt = 0; attempt < 500; attempt++) {
    const board = new HaulBoard(random);
    board.populate();
    board.placeChest(x, y, Math.floor(random() * 3));
    for (const edge of [0, W - 1]) {
      const rows = Array.from({ length: H }, (_, row) => row).filter((row) => !isChest(board.get(edge, row)));
      board.set(edge, rows[Math.floor(random() * rows.length)], EMERALD);
    }
    if (!board.findRuns().length) return { board, chest: { x, y } };
  }
  throw new Error('Unable to generate an edge emeralds drill');
}

/** High chests over random coins; low emeralds offer diagonal clears rather than prepared matches. */
function createEmeraldDrill(random: () => number, fallback = false): Drill {
  const edge = random() < 0.3;
  const left = random() < 0.5;
  const x = edge ? left ? 0 : W - 2 : 2 + Math.floor(random() * 3);
  const y = edge ? H - 2 : H - 3 + Math.floor(random() * 2);
  for (let attempt = 0; attempt < 500; attempt++) {
    const board = new HaulBoard(random);
    board.populate();
    board.placeChest(x, y, Math.floor(random() * 3));
    board.gemRates = [0, 0];
    board.set(0, Math.floor(random() * 2), EMERALD);
    board.set(W - 1, Math.floor(random() * 2), EMERALD);
    let opening: [number, number] | undefined;
    if (edge) {
      const outer = left ? 0 : W - 1;
      const inner = left ? 1 : W - 2;
      const opposite = left ? W - 1 : 0;
      // One coin sits above the outer chest column. The chest blocks a vertical
      // match; a different inner coin prevents it from matching across the top.
      const colour = board.get(outer, H - 1);
      board.set(inner, H - 1, (colour + 1 + Math.floor(random() * 3)) % 4);
      // From the opposite bottom corner the upper diagonal hits the locked coin.
      board.set(opposite, 1, Math.floor(random() * 4));
      board.set(opposite, 0, EMERALD);
      opening = [opposite, 1];
    }
    if (!board.findRuns().length) return { board, chest: { x, y }, ...(opening && { opening }) };
  }
  if (fallback) throw new Error('Unable to construct edge emeralds');
  const fixed = new Random(0);
  return createEmeraldDrill(() => fixed.random(), true);
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
  const fallback = new Random(0);
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
  const fixed = new Random(0);
  return createEdgeDrill(() => fixed.random(), true);
}

/**
 * Six or five blockers are decomposed into vertical groups, horizontal pairs,
 * and one or two diagonal targets. Permuted coin reservoirs vary the required
 * swaps; the complete route and its refill sequence are verified before play.
 */
function createDeepEdgeDrill(random: () => number, options: DrillOptions,
  fallback?: { impossible: boolean; left: boolean; y: number; edgePattern: NonNullable<Drill['edgePattern']> }): Drill {
  const impossible = fallback?.impossible ?? (!!options.impossibleChests && random() < 0.2);
  const left = fallback?.left ?? random() < 0.5;
  const at = (column: number) => left ? column : W - 1 - column;
  const x = left ? 0 : W - 2;
  const y = fallback?.y ?? 1 + Math.floor(random() * 2);
  const depth = H - 1 - y;
  const patterns = ['horizontal', 'vertical', 'single-emerald', 'double-emerald'] as const;
  const edgePattern = fallback?.edgePattern ?? patterns[Math.floor(random() * patterns.length)];
  const shuffle = <T>(values: T[]): T[] => {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  };
  for (let attempt = 0; attempt < 500; attempt++) {
    const refills: number[] = [];
    let refill = 0;
    const board = new HaulBoard(() => refill < refills.length ? refills[refill++] : random());
    board.populate();
    board.placeChest(x, y, Math.floor(random() * 3));
    board.gemRates = [0, 0];
    const set = (column: number, row: number, piece: number) => board.set(at(column), row, piece);
    const [a, b, c, d] = shuffle([0, 1, 2, 3]);
    const solution: [number, number][] = [];
    if (impossible) {
      // Each outer colour occurs at most twice, so no vertical three is possible.
      // Only the fourth colour can occupy the inner segment. Clearing those coins
      // leaves gaps above the anchored chest, which cannot be refilled from below.
      const outer = shuffle([a, a, b, b, c, c].slice(0, depth));
      for (let i = 0; i < depth; i++) {
        set(0, y + 1 + i, outer[i]);
        set(1, y + 1 + i, EMPTY);
      }
      const inner = 1 + Math.floor(random() * 2);
      for (let i = 0; i < inner; i++) set(1, H - 1 - i, d);
      if (!board.findRuns().length) return { board, chest: { x, y }, impossible: true };
      continue;
    }
    if (edgePattern === 'horizontal' || edgePattern === 'vertical') {
      const tail = edgePattern === 'vertical'
        ? shuffle([b, c, d]).slice(0, depth - 3)
        : shuffle([a, a, b, b, c, d]).slice(0, depth);
      const blockers = edgePattern === 'vertical' ? [a, a, a, ...tail] : tail;
      const outer = Array<number>(H).fill(-1);
      const inner = Array<number>(H).fill(-1);
      const reservoir = edgePattern === 'horizontal'
        ? shuffle([...tail, c, d].slice(0, H))
        : shuffle([...tail, ...Array.from({ length: H - tail.length }, () => [b, c, d][Math.floor(random() * 3)])]);
      // With five blockers, fill the remaining reservoir square with a spare colour.
      while (reservoir.length < H) reservoir.unshift(Math.floor(random() * 4));
      for (const [column, values] of [[0, outer], [1, inner]] as const) {
        shuffle([...blockers]).forEach((piece, i) => { values[y + 1 + i] = piece; set(column, y + 1 + i, piece); });
      }
      reservoir.forEach((piece, row) => set(2, row, piece));
      const bubble = (column: number, values: number[], colour: number, target: number): boolean => {
        let source = values.lastIndexOf(colour, target);
        if (source < 0) return false;
        while (source < target) {
          [values[source], values[source + 1]] = [values[source + 1], values[source]];
          solution.push([at(column), ++source]);
        }
        return true;
      };
      if (edgePattern === 'vertical') {
        for (const [column, values] of [[0, outer], [1, inner]] as const) {
          for (let row = H - 1; row >= H - 3; row--) bubble(column, values, a, row);
          values.splice(H - 3, 3);
          values.unshift(-1, -1, -1);
        }
      }
      const pairs = edgePattern === 'vertical' ? depth - 3 : depth;
      for (let i = 0; i < pairs; i++) {
        const colour = outer[H - 1];
        bubble(1, inner, colour, H - 1);
        bubble(2, reservoir, colour, H - 1);
        outer.pop(); outer.unshift(-1);
        inner.pop(); inner.unshift(-1);
        reservoir.pop(); reservoir.unshift(-1);
      }
    } else {
      const remaining = edgePattern === 'single-emerald' ? 1 : 3;
      const pairs = depth - remaining;
      // C and D cap the final matches; prefix colours must differ from both.
      const colours = shuffle(edgePattern === 'double-emerald'
        ? Array.from({ length: pairs }, (_, i) => i % 2 ? b : a)
        : [a, a, b, b, a].slice(0, pairs));
      for (let i = 0; i < pairs; i++) {
        set(0, y + 1 + remaining + i, colours[i]);
        set(1, y + 1 + remaining + i, colours[i]);
        set(2, H - 2 - (pairs - 1 - i), colours[i]);
      }
      solution.push(...Array.from({ length: pairs }, (): [number, number] => [at(2), H - 1]));
      if (edgePattern === 'single-emerald') {
        set(0, y + 1, d); set(1, y + 1, c);
        set(2, H - 1, c); set(2, 5 - pairs, EMERALD);
        set(3, 7, d); set(3, 6, d); set(3, 5, c);
        // Prefix clears lift the emerald to row 5. Its diagonal removes the last
        // outer coin; the resulting gap lifts the inner-column match into place.
        solution.push([at(2), 5], [at(3), 7]);
      } else {
        set(0, y + 1, c); set(0, y + 2, a); set(0, y + 3, c);
        set(1, y + 1, b); set(1, y + 2, EMERALD); set(1, y + 3, a);
        // The three remaining rows end at 5, 6 and 7 after the prefix clears.
        // One emerald reaches both outer rows 5 and 7 before the A and B matches.
        set(2, 7, c); set(2, 6 - pairs, a); set(2, 5 - pairs, c); set(2, 4 - pairs, b);
        set(3, 7, d); set(3, 6, d); set(3, 5, b);
        solution.push([at(1), 6], [at(3), 6], [at(3), 7]);
      }
    }
    if (board.findRuns().length || !solution.length) continue;
    const checked = checkSolution(board, solution, random);
    if (checked) {
      refills.push(...checked);
      return { board, chest: { x, y }, solution, edgePattern, impossible: false };
    }
  }
  if (fallback) throw new Error(`Unable to construct deep ${edgePattern}`);
  const fixed = new Random(0);
  // A fallback retains the requested family and the solvable/impossible decision.
  return createDeepEdgeDrill(() => fixed.random(), options, { impossible, left, y, edgePattern });
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
