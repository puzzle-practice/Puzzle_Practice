// Alchemistry's Freeplay mode: painting tubes and bottles and reading the board as text. A board's text
// is A, the difficulty, the bulb order (0-5) or ~ and each bulb's primary with q after it when it
// is quicksilver, then two base-36 characters a square, column by
// column from the left, for the piece's shape, turn and special, then a colon and the eleven
// bottles separated by commas: each is its label colors from the bottom, then * and how many are
// filled, or ! when it is broken.
import { AlchemyBoard, Bottle, DOUBLE_PIECES, MAX_LAYERS, MIN_LAYERS, mixColors, rotated, SECONDARIES, SINGLE_PIECES, SPECIAL_MIN, specialOf, valid, WIDTH } from './logic';

/** Every tube shape the game deals: the single tubes, then the overlapping pairs. */
export const SHAPES: readonly number[] = [...SINGLE_PIECES, ...DOUBLE_PIECES];
export const SHAPE_NAMES = ['Straight', 'Sharp bend', 'Bend', 'Fork', 'Cross', 'Peace', 'Crook', 'Reverse crook', 'Fan', 'Five-way', 'Six-way',
  'Straight and sharp bend', 'Straight and bend', 'Crossed straights', 'Crossed bends', 'Facing bends', 'Bend and sharp bend'];
export const SPECIAL_NAMES = ['None', 'Quicksilver', 'Bonus', 'Multifill'];
/** The bulb orders a board can deal, left to right. */
export const BULBS = [[2, 3, 4], [2, 4, 3], [3, 4, 2], [3, 2, 4], [4, 2, 3], [4, 3, 2]];
export const LABEL_COLORS = [2, 3, 4, 5, 6, 7];
export const LABEL_NAMES: Record<number, string> = { 2: 'Red', 3: 'Yellow', 4: 'Blue', 5: 'Orange', 6: 'Purple', 7: 'Green' };
/** Bottles hold one to four labels. */
export const MAX_LABELS = 4;

const tubes = (piece: number) => piece & 4095;
/** The shape and clockwise turns a piece was dealt as, or null for a piece the game never deals. */
export function shapeOf(piece: number): [number, number] | null {
  for (let shape = 0; shape < SHAPES.length; shape++) {
    let p: number = SHAPES[shape];
    for (let turn = 0; turn < 6; turn++, p = rotated(p)) if (tubes(p) === tubes(piece)) return [shape, turn];
  }
  return null;
}
export function makePiece(shape: number, turn: number, special: number): number {
  let piece: number = SHAPES[shape];
  for (let i = 0; i < turn; i++) piece = rotated(piece);
  return piece | (special << 20);
}

/** Paints a square, keeping the turn of what was there. Returns false when nothing changed. */
export function paint(board: AlchemyBoard, x: number, y: number, shape: number, special: number): boolean {
  if (!valid(x, y) || !SHAPES[shape] || special < 0 || special > 3) return false;
  const old = board.get(x, y), turn = shapeOf(old)?.[1] ?? 0, piece = makePiece(shape, turn, special);
  if (tubes(old) === tubes(piece) && specialOf(old) === special) return false;
  board.set(x, y, piece);
  board.colorBoard();
  return true;
}

export function fill(board: AlchemyBoard, shape: number, special: number): boolean {
  if (!SHAPES[shape]) return false;
  for (let x = 0; x < WIDTH; x++) for (let y = 0; valid(x, y); y++) board.set(x, y, makePiece(shape, 0, special));
  board.colorBoard();
  return true;
}

/** Sets which primaries feed the bulbs, as a newly dealt board would. */
export function setBulbs(board: AlchemyBoard, order: number): boolean {
  if (!BULBS[order]) return false;
  setBulbColors(board, BULBS[order].slice(0, bulbCount(board)).map((color) => ({ color, quicksilver: false })));
  return true;
}
/** The dealt bulb order the board's bulbs are in, or -1 when the game couldn't deal them. */
export function bulbOrder(board: AlchemyBoard): number {
  const bulbs = bulbColors(board);
  if (bulbs.some((b) => b.quicksilver)) return -1;
  return BULBS.findIndex((order) => bulbs.every((b, i) => b.color === order[i]));
}

export interface Bulb { color: number; quicksilver: boolean }
/** The game deals two bulbs below difficulty 2 and three from there. */
export const bulbCount = (board: AlchemyBoard): number => board.difficulty < 2 ? 2 : 3;
/** The bulb that feeds a column. */
export const bulbOf = (board: AlchemyBoard, column: number): number => board.difficulty < 2 ? (column < 6 ? 0 : 1) : column < 4 ? 0 : column < 7 ? 1 : 2;
/** The columns whose bulbs turn to quicksilver until the next fill after a quicksilver piece. */
const QUICKSILVER_COLUMNS = [0, 4, 10];
/** Each bulb's primary, and whether it is quicksilver until the next fill. */
export function bulbColors(board: AlchemyBoard): Bulb[] {
  return Array.from({ length: bulbCount(board) }, (_, bulb) => {
    const column = board.baseColors.findIndex((_, x) => bulbOf(board, x) === bulb);
    return { color: board.baseColors[column], quicksilver: QUICKSILVER_COLUMNS.some((x) => bulbOf(board, x) === bulb && board.colors[x] === 9) };
  });
}
/** Sets each bulb's primary and quicksilver freely, deriving the label colors the board deals from them. */
export function setBulbColors(board: AlchemyBoard, bulbs: Bulb[]): boolean {
  if (bulbs.length !== bulbCount(board) || bulbs.some((b) => ![2, 3, 4].includes(b.color))) return false;
  board.baseColors = Array.from({ length: WIDTH }, (_, x) => bulbs[bulbOf(board, x)].color);
  board.colors = board.baseColors.map((color, x) => QUICKSILVER_COLUMNS.includes(x) && bulbs[bulbOf(board, x)].quicksilver ? 9 : color);
  const missing = [2, 3, 4].filter((c) => !bulbs.some((b) => b.color === c));
  board.missingPrimary = board.difficulty < 2 && missing.length === 1 ? missing[0] : -1;
  // The secondary a dealt board makes hardest is the first and last primaries mixed, counting the missing one last below difficulty 2.
  const last = board.difficulty < 2 ? (missing.length === 1 ? missing[0] : 0) : bulbs[2].color;
  board.hardSecondary = last && last !== bulbs[0].color ? mixColors(bulbs[0].color, last) : -1;
  board.colorBoard();
  return true;
}
const BULB_STEPS = [2, 3, 4, 9];
/** Steps a bulb through red, yellow, blue and quicksilver, forwards or backwards. Quicksilver keeps the primary it returns to after a fill. */
export function cycleBulb(board: AlchemyBoard, bulb: number, step = 1): boolean {
  const bulbs = bulbColors(board), b = bulbs[bulb];
  if (!b) return false;
  const next = BULB_STEPS[(BULB_STEPS.indexOf(b.quicksilver ? 9 : b.color) + step + 4) % 4];
  bulbs[bulb] = next === 9 ? { color: b.color, quicksilver: true } : { color: next, quicksilver: false };
  return setBulbColors(board, bulbs);
}

/** Adds a label on top of a bottle. */
export function addLabel(board: AlchemyBoard, x: number, color: number): boolean {
  const bottle = board.bottles[x];
  if (!bottle || !LABEL_COLORS.includes(color) || (bottle.size >= MAX_LABELS && !bottle.broken)) return false;
  // A broken bottle starts again with this as its first label.
  if (bottle.broken) { bottle.broken = false; bottle.required.fill(-1); bottle.filled.fill(-1); bottle.points = 0; }
  bottle.required[bottle.size] = color;
  board.colorBoard();
  return true;
}
/** Takes the top label off a bottle, breaking it instead when it has one left so a label added next sets its first color. */
export function removeLabel(board: AlchemyBoard, x: number): boolean {
  const bottle = board.bottles[x];
  if (!bottle || bottle.broken) return false;
  if (bottle.size <= 1) { bottle.broken = true; bottle.filled.fill(-1); bottle.points = 0; board.colorBoard(); return true; }
  const top = bottle.size - 1;
  bottle.required[top] = -1;
  bottle.filled[top] = -1;
  if (bottle.count > bottle.size - 1) bottle.filled[bottle.size - 1] = -1;
  board.colorBoard();
  return true;
}
/** Steps a bottle through how many labels are filled, then broken, then empty again. A full bottle leaves the belt, so it isn't one of the steps. */
export function cycleBottle(board: AlchemyBoard, x: number): boolean {
  const bottle = board.bottles[x];
  if (!bottle) return false;
  if (bottle.broken) { bottle.broken = false; bottle.filled.fill(-1); }
  else if (bottle.count + 1 < bottle.size) bottle.filled[bottle.count] = bottle.required[bottle.count];
  else bottle.broken = true;
  bottle.points = 0;
  board.colorBoard();
  return true;
}

const pieceCode = (piece: number) => { const [shape, turn] = shapeOf(piece) ?? [0, 0]; return ((shape * 6 + turn) * 4 + specialOf(piece)).toString(36).padStart(2, '0'); };
const bottleCode = (b: Bottle) => b.required.slice(0, b.size).join('') + (b.broken ? '!' : b.count ? `*${b.count}` : '');

export function boardCode(board: AlchemyBoard): string {
  const order = bulbOrder(board);
  let code = `A${board.difficulty}${order >= 0 ? order : `~${bulbColors(board).map((b) => b.color + (b.quicksilver ? 'q' : '')).join('')}`}`;
  for (let x = 0; x < WIDTH; x++) for (let y = 0; valid(x, y); y++) code += pieceCode(board.get(x, y));
  return `${code}:${board.bottles.map(bottleCode).join(',')}`;
}

export interface BoardText { difficulty: number; bulbs: Bulb[]; pieces: number[]; bottles: Bottle[] }

export function readBoardCode(text: string): BoardText | null {
  const m = /^A([0-8])([0-5]|~(?:[2-4]q?){2,3})([0-9a-z]{208}):([2-7]{1,4}(?:\*[1-3]|!)?(?:,[2-7]{1,4}(?:\*[1-3]|!)?){10})$/i.exec(text.trim());
  if (!m) return null;
  const pieces: number[] = [];
  for (let i = 0; i < 104; i++) {
    const n = parseInt(m[3].slice(i * 2, i * 2 + 2), 36), shape = Math.floor(n / 24);
    if (shape >= SHAPES.length) return null;
    pieces.push(makePiece(shape, Math.floor(n / 4) % 6, n % 4));
  }
  const bottles: Bottle[] = [];
  for (const part of m[4].split(',')) {
    const [, labels, mark] = /^([2-7]+)(.*)$/.exec(part)!;
    const bottle = new Bottle();
    [...labels].forEach((c, i) => { bottle.required[i] = Number(c); });
    if (mark === '!') bottle.broken = true;
    else if (mark) {
      const count = Number(mark.slice(1));
      if (count >= labels.length) return null;
      for (let i = 0; i < count; i++) bottle.filled[i] = bottle.required[i];
    }
    bottles.push(bottle);
  }
  const difficulty = Number(m[1]), count = difficulty < 2 ? 2 : 3;
  const bulbs = m[2][0] === '~' ? [...m[2].slice(1).matchAll(/([2-4])(q?)/gi)].map(([, color, q]) => ({ color: Number(color), quicksilver: !!q }))
    : BULBS[Number(m[2])].slice(0, count).map((color) => ({ color, quicksilver: false }));
  if (bulbs.length !== count) return null;
  return { difficulty, bulbs, pieces, bottles };
}

/** Puts a board read from text onto the board. Its difficulty must match, as the board's dealing rules come with it. */
export function load(board: AlchemyBoard, read: BoardText): void {
  let i = 0;
  for (let x = 0; x < WIDTH; x++) for (let y = 0; valid(x, y); y++) board.set(x, y, read.pieces[i++]);
  board.bottles = read.bottles.map((b) => b.clone());
  setBulbColors(board, read.bulbs);
}

/** Bottle colors the board could deal. */
export function labelPool(board: AlchemyBoard): number[] {
  const d = board.difficulty;
  let pool = [2, 3, 4];
  if (SECONDARIES[d]) pool.push(...[5, 6, 7].filter((c) => c !== board.hardSecondary || SECONDARIES[d] > 1));
  if (board.missingPrimary > 0) pool = pool.filter((c) => c !== board.missingPrimary && !({ 2: [5, 6], 3: [5, 7], 4: [6, 7] } as Record<number, number[]>)[board.missingPrimary].includes(c));
  return pool;
}

/** Ways a painted board differs from one the game could deal at its difficulty. */
export function boardIssues(board: AlchemyBoard): string[] {
  const issues: string[] = [], d = board.difficulty, pool = labelPool(board);
  const specials = new Set<number>();
  for (let x = 0; x < WIDTH; x++) for (let y = 0; valid(x, y); y++) { const s = specialOf(board.get(x, y)); if (s) specials.add(s); }
  for (const s of specials) if (d < SPECIAL_MIN[s]) issues.push(`${SPECIAL_NAMES[s]} pieces only appear from difficulty ${SPECIAL_MIN[s]}.`);
  const colors = new Set(board.bottles.flatMap((b) => b.required.slice(0, b.size)).filter((c) => !pool.includes(c)));
  if (colors.size) issues.push(`Difficulty ${d} with these bulbs deals no ${[...colors].map((c) => LABEL_NAMES[c].toLowerCase()).join(' or ')} labels.`);
  if (board.bottles.some((b) => b.size < MIN_LAYERS[d] || b.size > MAX_LAYERS[d])) {
    issues.push(`Difficulty ${d} deals bottles of ${MIN_LAYERS[d]}${MAX_LAYERS[d] === MIN_LAYERS[d] ? '' : `–${MAX_LAYERS[d]}`} label${MAX_LAYERS[d] > 1 ? 's' : ''}.`);
  }
  const bulbs = bulbColors(board);
  if (new Set(bulbs.map((b) => b.color)).size < bulbs.length) issues.push('The game gives every bulb a different primary.');
  if (bulbs.some((b) => b.quicksilver) && d < SPECIAL_MIN[1]) issues.push(`Quicksilver bulbs only appear from difficulty ${SPECIAL_MIN[1]}.`);
  if (board.bottles.every((b) => b.broken)) issues.push('Every bottle is broken, which ends the game.');
  return issues;
}
