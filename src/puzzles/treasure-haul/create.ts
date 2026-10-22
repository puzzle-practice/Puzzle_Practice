// Treasure Haul's Freeplay mode: painting a board and reading it as text. A board's text is T and
// one letter a square, top row first: 0-3 for the coins, R and E for the gems, L, M and H for a
// low, medium or high value chest's top-left square, and + for the rest of a chest.
import { COLOURS, EMERALD, H, HaulBoard, RUBY, W, chestPart, chestValue, isChest, isChestOrigin } from './logic';

/** What Freeplay paints: the four coins, ruby, emerald, then a low, medium and high chest. */
export const PAINTABLE = ['0', '1', '2', '3', 'R', 'E', 'L', 'M', 'H'] as const;
export type Paint = typeof PAINTABLE[number];
const CHESTS = 'LMH';

/** A coin or gem as a piece; null for a chest. */
const pieceOf = (paint: string): number | null =>
  paint === 'R' ? RUBY : paint === 'E' ? EMERALD : /^[0-3]$/.test(paint) ? Number(paint) : null;

/** The paint a square shows: + for a chest square other than its top-left. */
export function paintOf(piece: number): string {
  if (isChest(piece)) return isChestOrigin(piece) ? CHESTS[chestValue(piece)] : '+';
  return piece === RUBY ? 'R' : piece === EMERALD ? 'E' : String(piece);
}

/** The top-left square of the chest covering (x, y). */
function chestOrigin(board: HaulBoard, x: number, y: number): [number, number] {
  const part = chestPart(board.get(x, y));
  // A top-row square that isn't the corner sits right of it; a bottom-row square is under the top row.
  let ox = x, oy = part === 2 ? y + 1 : y;
  if (part !== 0 && !isChestOrigin(board.get(ox, oy))) ox--;
  return [ox, oy];
}

/** Takes away the chest covering (x, y), leaving coins in its squares so the board stays full. */
function removeChest(board: HaulBoard, x: number, y: number): void {
  const [ox, oy] = chestOrigin(board, x, y);
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) board.set(ox + dx, oy - dy, (ox + dx + 2 * (oy - dy)) % COLOURS);
}

/**
 * Paints a square. A chest goes in with its top-left square at (x, y), moved left or down to fit,
 * over any chest in its way. Returns false when nothing changed.
 */
export function paint(board: HaulBoard, x: number, y: number, what: string): boolean {
  if (x < 0 || x >= W || y < 0 || y >= H || !(PAINTABLE as readonly string[]).includes(what)) return false;
  const piece = pieceOf(what);
  if (piece !== null) {
    if (board.get(x, y) === piece) return false;
    if (isChest(board.get(x, y))) removeChest(board, x, y);
    board.set(x, y, piece);
    return true;
  }
  const cx = Math.min(x, W - 2), cy = Math.max(y, 1), value = CHESTS.indexOf(what);
  if (isChestOrigin(board.get(cx, cy)) && chestValue(board.get(cx, cy)) === value) return false;
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) if (isChest(board.get(cx + dx, cy - dy))) removeChest(board, cx + dx, cy - dy);
  board.placeChest(cx, cy, value);
  return true;
}

/** Every square one coin or gem. */
export function fill(board: HaulBoard, what: string): boolean {
  const piece = pieceOf(what);
  if (piece === null) return false;
  board.cells.fill(piece);
  return true;
}

export function boardCode(board: HaulBoard): string {
  let code = 'T';
  for (let y = H - 1; y >= 0; y--) for (let x = 0; x < W; x++) code += paintOf(board.get(x, y));
  return code;
}

/** The board's squares from its text (y = 0 at the bottom), or null if it isn't a whole board. */
export function readBoardCode(text: string): number[] | null {
  const m = new RegExp(`^T([0-3REMLH+]{${W * H}})$`, 'i').exec(text.trim());
  if (!m) return null;
  const letters = m[1].toUpperCase();
  const at = (x: number, y: number) => letters[(H - 1 - y) * W + x];
  const board = new HaulBoard(() => 0);
  const covered = new Set<number>();
  for (let y = H - 1; y >= 0; y--) for (let x = 0; x < W; x++) {
    const letter = at(x, y);
    if (letter === '+') continue;
    if (CHESTS.includes(letter)) {
      if (x > W - 2 || y < 1) return null;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) {
        if (at(x + dx, y - dy) !== '+' || covered.has((y - dy) * W + x + dx)) return null;
        covered.add((y - dy) * W + x + dx);
      }
      board.placeChest(x, y, CHESTS.indexOf(letter));
    } else board.set(x, y, pieceOf(letter)!);
  }
  for (let i = 0; i < W * H; i++) if (letters[(H - 1 - Math.floor(i / W)) * W + i % W] === '+' && !covered.has(i)) return null;
  return [...board.cells];
}

/** Ways a painted board differs from one that could come up in the game. */
export function boardIssues(board: HaulBoard): string[] {
  const issues: string[] = [];
  if (board.findRuns().length) issues.push('Three coins in a line are on the board; the game clears those before you can swap.');
  const chests = board.cells.filter(isChestOrigin).length;
  for (let x = 0; x < W; x++) if (isChestOrigin(board.get(x, H - 1))) { issues.push('A chest is in the top row; the game hauls it straight away.'); break; }
  if (chests > 2) issues.push('More than two chests are on the board; the game has at most two in play.');
  return issues;
}
