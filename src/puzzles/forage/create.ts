// Forage's Freeplay mode: painting a board and reading it as text. A board's text is F and the
// Forage Simulator's letters, one a cell, top row first (see logic.ts): u-y the colours, m n o p
// the machete, shovel, earthquake and monkey, q ants, k a bone box, g h / i j a jar and
// a b c / d e f a chest, and z an empty cell. Moons can follow after a colon, four digits each: the
// column and row of the moon's top-left cell, its phase (4 new to 1 nearly gone) and its claws (0-3).
import {
  ANT_COUNT, COLOURS, CRATE_SIZES, EMPTY, HEIGHT, MAX_CRATE_AREA, MAX_CRATES, WIDTH, ForageBoard, crateSize, isAnts, isCrate, isCrateAnchor,
  makeAnts, makeCrate,
} from './board';
import type { Moon, MoonField } from './werewolf';

/** The simulator's letters as game pieces. Colours u-y are dirt, wood, grass, sand and stone. */
const LETTER_PIECES: Record<string, number> = { u: 0, v: 4, w: 1, x: 2, y: 3, n: 5, m: 6, p: 7, o: 8, z: EMPTY };

/** A board in the simulator's letters, as game cells (crates as cursed ones). */
export function lettersToCells(board: string[][]): number[] {
  const cells: number[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const ch = board[y][x];
      if (ch in LETTER_PIECES) cells.push(LETTER_PIECES[ch]);
      else if (ch === 'q') cells.push(makeAnts(8, 3));
      // Crates: k bone box; g h / i j jar (bottom-left i); a b c / d e f chest (bottom-left d).
      else if (ch === 'k') cells.push(makeCrate(0, 0, 0));
      else if (ch === 'i') cells.push(makeCrate(0, 1, 1));
      else if (ch === 'j') cells.push(makeCrate(1, 1, 1));
      else if (ch === 'g' || ch === 'h') cells.push(makeCrate(2, 1, 1));
      else if (ch === 'd') cells.push(makeCrate(0, 2, 2));
      else if (ch === 'e' || ch === 'f') cells.push(makeCrate(1, 2, 2));
      else cells.push(makeCrate(2, 2, 2));
    }
  }
  return cells;
}

/**
 * What Freeplay paints: the five colours, shovel, machete, monkey, earthquake, ants, the three crates,
 * an empty cell and a moon.
 */
export const PAINTABLE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
export const ANTS = 9;
/** The paint for a bone box, a jar and a chest. */
export const CRATE_PAINT = [10, 11, 12];
/** An empty cell: pieces fall into it from above once a move plays out. */
export const EMPTY_PAINT = 13;
/** A moon over a 2x2, as on Werewolf boards. */
export const MOON_PAINT = 14;
export const PIECE_NAMES = ['Dirt', 'Grass', 'Sand', 'Stone', 'Wood', 'Shovel', 'Machete', 'Monkey', 'Earthquake', 'Ants', 'Bone box', 'Fetish jar', 'Cursed chest', 'Empty', 'Moon'];

/** The paint a cell shows (a crate cell shows its crate). */
export function paintOf(piece: number): number {
  if (isCrate(piece)) return CRATE_PAINT[crateSize(piece)];
  if (isAnts(piece)) return ANTS;
  if (piece === EMPTY) return EMPTY_PAINT;
  return piece;
}

/** The bottom-left cell of the crate covering (x, y). */
function crateAnchor(cells: readonly number[], x: number, y: number): [number, number] | null {
  for (let ay = y; ay <= Math.min(HEIGHT - 1, y + 1); ay++) for (let ax = Math.max(0, x - 2); ax <= x; ax++) {
    const p = cells[ay * WIDTH + ax];
    if (!isCrateAnchor(p)) continue;
    const { width, height } = CRATE_SIZES[crateSize(p)];
    if (x < ax + width && y > ay - height) return [ax, ay];
  }
  return null;
}

/** Takes away the crate covering (x, y), leaving colours in its cells so the board stays full. */
function removeCrate(cells: number[], x: number, y: number): void {
  const anchor = crateAnchor(cells, x, y);
  if (!anchor) return;
  const [ax, ay] = anchor, { width, height } = CRATE_SIZES[crateSize(cells[ay * WIDTH + ax])];
  for (let dx = 0; dx < width; dx++) for (let dy = 0; dy < height; dy++) cells[(ay - dy) * WIDTH + ax + dx] = (ax + dx + 2 * (ay - dy)) % COLOURS;
}

/**
 * Paints a cell. A crate goes in with its top-left cell at (x, y), moved left or up to fit, over any
 * crate in its way. Returns false when nothing changed.
 */
export function paint(cells: number[], x: number, y: number, what: number): boolean {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT || !PAINTABLE.includes(what) || what === MOON_PAINT) return false;
  const size = CRATE_PAINT.indexOf(what);
  if (size < 0) {
    const piece = pieceFor(what);
    if (cells[y * WIDTH + x] === piece) return false;
    if (isCrate(cells[y * WIDTH + x])) removeCrate(cells, x, y);
    cells[y * WIDTH + x] = piece;
    return true;
  }
  const { width, height } = CRATE_SIZES[size];
  const ax = Math.min(x, WIDTH - width), ay = Math.min(y, HEIGHT - height) + height - 1;
  if (isCrateAnchor(cells[ay * WIDTH + ax]) && crateSize(cells[ay * WIDTH + ax]) === size) return false;
  for (let dx = 0; dx < width; dx++) for (let dy = 0; dy < height; dy++) if (isCrate(cells[(ay - dy) * WIDTH + ax + dx])) removeCrate(cells, ax + dx, ay - dy);
  for (let dx = 0; dx < width; dx++) for (let dy = 0; dy < height; dy++) cells[(ay - dy) * WIDTH + ax + dx] = makeCrate(dx === 0 && dy === 0 ? 0 : dy === 0 ? 1 : 2, size, size);
  return true;
}

const pieceFor = (what: number) => what === ANTS ? makeAnts(ANT_COUNT, 3) : what === EMPTY_PAINT ? EMPTY : what;

/**
 * Puts a moon with its top-left cell at (x, y), moved left or up to fit, over any moon in its way.
 * The same moon painted again takes it away. Returns false when nothing changed.
 */
export function paintMoon(moons: MoonField, x: number, y: number, phase: number, charge: number): boolean {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return false;
  const mx = Math.min(x, WIDTH - 2), my = Math.min(y, HEIGHT - 2);
  const same = moons.active.find((m) => m.x === mx && m.y === my);
  if (same && same.phase === phase && same.charge === charge) moons.clear(mx, my);
  else moons.place(mx, my, phase, charge);
  return true;
}

/** Every cell one colour or special, or empty. */
export function fill(cells: number[], what: number): boolean {
  if (!PAINTABLE.includes(what) || CRATE_PAINT.includes(what) || what === MOON_PAINT) return false;
  cells.fill(pieceFor(what));
  return true;
}

const PIECE_LETTERS = 'uwxyvnmpo';
const moonCode = (moons: readonly Moon[]) => moons.length ? ':' + moons.map((m) => `${m.x}${m.y}${m.phase}${m.charge}`).join('') : '';
/** The letters for a crate's cells, row by row from the top. */
const CRATE_LETTERS = [['k'], ['gh', 'ij'], ['abc', 'def']];

export function boardCode(cells: readonly number[], moons: readonly Moon[] = []): string {
  const letters: string[] = cells.map((p) => isAnts(p) ? 'q' : isCrate(p) ? '?' : p === EMPTY ? 'z' : PIECE_LETTERS[p]);
  cells.forEach((p, i) => {
    if (!isCrateAnchor(p)) return;
    const size = crateSize(p), rows = CRATE_LETTERS[size], ax = i % WIDTH, ay = Math.floor(i / WIDTH);
    rows.forEach((row, r) => [...row].forEach((ch, dx) => { letters[(ay - rows.length + 1 + r) * WIDTH + ax + dx] = ch; }));
  });
  return 'F' + letters.join('') + moonCode(moons);
}

/** A moon as the board text gives it: where its top-left cell is, its phase and its claws. */
export type MoonCode = Pick<Moon, 'x' | 'y' | 'phase' | 'charge'>;

/** The board's cells and moons from its text, or null if it isn't a whole board. */
export function readBoardCode(text: string): { cells: number[]; moons: MoonCode[] } | null {
  const m = new RegExp(`^F([a-z]{${WIDTH * HEIGHT}})(?::((?:[0-${WIDTH - 2}][0-${HEIGHT - 2}][1-4][0-3])+))?$`).exec(text.trim());
  if (!m || /[lrst]/.test(m[1])) return null;
  const moons = (m[2]?.match(/..../g) ?? []).map(([x, y, phase, charge]) => ({ x: +x, y: +y, phase: +phase, charge: +charge }));
  const rows = Array.from({ length: HEIGHT }, (_, y) => [...m[1].slice(y * WIDTH, (y + 1) * WIDTH)]);
  // Every crate letter has to be in a whole crate of its size, read from the crate's top-left letter.
  const claimed = rows.map((row) => row.map(() => false));
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const size = CRATE_LETTERS.findIndex((crate) => crate[0][0] === rows[y][x]);
    if (size < 0 || claimed[y][x]) continue;
    const crate = CRATE_LETTERS[size];
    if (y + crate.length > HEIGHT || x + crate[0].length > WIDTH) return null;
    for (let r = 0; r < crate.length; r++) for (let dx = 0; dx < crate[r].length; dx++) {
      if (rows[y + r][x + dx] !== crate[r][dx] || claimed[y + r][x + dx]) return null;
      claimed[y + r][x + dx] = true;
    }
  }
  if (rows.some((row, y) => row.some((ch, x) => 'abcdefghijk'.includes(ch) && !claimed[y][x]))) return null;
  return { cells: lettersToCells(rows), moons };
}

/** Ways a painted board differs from one that could come up in the game. */
export function boardIssues(cells: readonly number[], moons: readonly MoonCode[] = []): string[] {
  const issues: string[] = [];
  const board = new ForageBoard(0);
  cells.forEach((p, i) => (board.cells[i] = p));
  if (board.findRuns().length) issues.push('Three of a colour are in a line; the game clears those before you can move.');
  const anchors = cells.map((p, i) => [p, i] as const).filter(([p]) => isCrateAnchor(p));
  if (anchors.some(([, i]) => Math.floor(i / WIDTH) === HEIGHT - 1)) issues.push('A crate is on the bottom row; the game collects it straight away.');
  const area = anchors.reduce((n, [p]) => n + CRATE_SIZES[crateSize(p)].width * CRATE_SIZES[crateSize(p)].height, 0);
  if (anchors.length > MAX_CRATES || area > MAX_CRATE_AREA) issues.push(`The game has at most ${MAX_CRATES} crates covering ${MAX_CRATE_AREA} cells on the board.`);
  if (cells.filter(isAnts).length > 1) issues.push('Only one set of ants is on the board at a time.');
  if (cells.includes(EMPTY)) issues.push('The game never leaves a cell empty; pieces fall into it from above once your next move plays out.');
  if (moons.length > 2) issues.push('The game has at most 2 moons on the board.');
  if (moons.some((m) => [0, 1, WIDTH, WIDTH + 1].some((d) => isCrate(cells[m.y * WIDTH + m.x + d])))) issues.push('A moon is over a crate; the game only puts moons where there are none.');
  return issues;
}
