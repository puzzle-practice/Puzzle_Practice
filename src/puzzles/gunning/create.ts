// Gunning's Freeplay mode: painting the deck, the pieces on it and what the cannons hold, and reading it
// all as text. A deck's text is G, the cannon count and the way the barrel faces (0 up, 1 right,
// 2 down, 3 left), then, separated by colons: a character a cell row by row (. open, c crate,
// h hole, = cannon); the pieces, each its letter (w swab, s shot, p powder, d wad), column and row
// in base 36 and direction; each cannon's slots from the breech (- for empty) and f if it is fouled;
// and the arrows, newest first, as column, row and direction. An optional @xy after the facing
// saves a moved barrel's column and row in base 36; old codes keep the barrel at (6, 6).
import {
  BARREL_ROW, BREECH, type Cannon, CANNON_ROWS, CRATE, EMPTY, GunneryBoard, heightFor, HOLE, MIDDLE, MUZZLE,
  PARTIAL, Piece, POWDER, SHOT, SWAB, UP, WAD, WIDTH,
} from './board';

/** Freeplay's paint: deck cells, the four pieces, and a fouled cannon. */
export const PAINTS = ['crate', 'hole', 'clear', 'swab', 'shot', 'powder', 'wad', 'fouled', 'barrel'] as const;
export type Paint = (typeof PAINTS)[number];
export const PAINT_NAMES: Record<Paint, string> = {
  crate: 'Crate', hole: 'Hole', clear: 'Clear', swab: 'Swab', shot: 'Shot', powder: 'Powder', wad: 'Wad', fouled: 'Fouled', barrel: 'Barrel',
};
const TYPES: Partial<Record<Paint, number>> = { swab: SWAB, shot: SHOT, powder: POWDER, wad: WAD };
const LETTERS: Record<number, string> = { [SWAB]: 'w', [SHOT]: 's', [POWDER]: 'p', [WAD]: 'd' };
const BY_LETTER = new Map(Object.entries(LETTERS).map(([type, letter]) => [letter, Number(type)]));

const element = (raw: number) => raw & 0xff;
const isCannon = (e: number) => e === MUZZLE || e === MIDDLE || e === BREECH;
/** The cell a cannon's slot rests on: slot 0 is the breech. */
const slotX = (cannon: Cannon, slot: number) => (cannon.left ? 3 - slot : 9 + slot);

function removeArrow(board: GunneryBoard, i: number): void {
  const order = board.arrowOrder(i);
  if (order === -1) return;
  board.cells[i] &= 0xffffff;
  board.arrows.splice(order, 1);
  board.arrows.push(-1);
}

function removePieces(board: GunneryBoard, x: number, y: number): boolean {
  const before = board.pieces.length;
  board.pieces = board.pieces.filter((p) => p.inCannon || p.x !== x || p.y !== y);
  board.ballsOut = board.pieces.filter((p) => p.type === SHOT).length;
  return board.pieces.length !== before;
}

/** Empties a cannon, washed and ready. */
export function emptyCannon(cannon: Cannon, board: GunneryBoard): void {
  cannon.slots = [null, null, null];
  cannon.fouled = false;
  cannon.state = EMPTY;
  board.clearResting(cannon.id);
  board.pieces = board.pieces.filter((p) => !p.inCannon || board.cannonId(p.x, p.y) !== cannon.id || !isCannon(board.element(p.x, p.y)));
}

/** Loads a piece into a cannon's next slot, as if it had rolled in. A full load leaves the cannon loaded. */
function loadCannon(board: GunneryBoard, cannon: Cannon, type: number): boolean {
  if (type === SWAB || (cannon.state !== EMPTY && cannon.state !== PARTIAL)) return false;
  const y = CANNON_ROWS[cannon.id >> 1];
  const piece = new Piece(type, 0, y, cannon.left ? 3 : 1);
  if (!cannon.accept(piece, false)) return false;
  const slot = cannon.slots.indexOf(piece);
  piece.x = piece.nx = slotX(cannon, slot);
  board.setResting(piece.x, y, type);
  if (type === SHOT) cannon.checkLoaded(false);
  return true;
}

/** Paints a cell. Pieces face `dir` (0 up to 3 left). Returns false when nothing changed. */
export function paint(board: GunneryBoard, x: number, y: number, paint: Paint, dir: number): boolean {
  if (x < 0 || y < 0 || x >= WIDTH || y >= board.height) return false;
  const i = y * WIDTH + x, here = element(board.cells[i]);
  if (paint === 'barrel') {
    if (here !== 0 || (x === board.barrel.shown && y === board.barrel.row)) return false;
    removeArrow(board, i); removePieces(board, x, y);
    const facing = barrelFacing(board);
    board.barrel.col = board.barrel.shown = x; board.barrel.row = y;
    faceBarrel(board, facing);
    return true;
  }
  if (isCannon(here)) {
    const cannon = board.cannons[board.cannonId(x, y)];
    if (paint === 'clear') { if (cannon.state === EMPTY && !cannon.fouled && !cannon.slots.some(Boolean)) return false; emptyCannon(cannon, board); return true; }
    if (paint === 'fouled') { if (cannon.fouled && !cannon.slots.some(Boolean)) return false; emptyCannon(cannon, board); cannon.foul(); return true; }
    const type = TYPES[paint];
    return type !== undefined && loadCannon(board, cannon, type);
  }
  if (x === board.barrel.shown && y === board.barrel.row) return false;
  if (paint === 'crate' || paint === 'hole') {
    const value = paint === 'crate' ? CRATE : HOLE;
    if (here === value) return false;
    removeArrow(board, i);
    removePieces(board, x, y);
    board.cells[i] = value;
    return true;
  }
  if (paint === 'clear') {
    const changed = here !== 0 || board.arrowOrder(i) !== -1 || board.pieces.some((p) => !p.inCannon && p.x === x && p.y === y);
    removeArrow(board, i);
    removePieces(board, x, y);
    board.cells[i] = 0;
    return changed;
  }
  const type = TYPES[paint];
  if (type === undefined || here !== 0) return false;
  const old = board.pieces.find((p) => !p.inCannon && p.x === x && p.y === y);
  if (old && old.type === type && old.dir === dir) return false;
  removePieces(board, x, y);
  const piece = new Piece(type, x, y, dir);
  // Picks its next cell as a moving piece would, turning on an arrow or when blocked.
  if (piece.route(board, true)) return false;
  board.pieces.push(piece);
  if (type === SHOT) board.ballsOut++;
  return true;
}

/** Turns the barrel in place, waiting to put out a piece. */
export function faceBarrel(board: GunneryBoard, facing: number): void {
  const barrel = board.barrel;
  barrel.state = facing * 2; barrel.ticks = 0; barrel.target = -1; barrel.moving = false;
  barrel.col = barrel.shown;
}
export const barrelFacing = (board: GunneryBoard) => (board.barrel.state >= 0 && board.barrel.state < 8 ? Math.floor(board.barrel.state / 2) : 0);

const b36 = (n: number) => n.toString(36);

export function boardCode(board: GunneryBoard): string {
  const cells = board.cells.map((raw) => { const e = element(raw); return e === CRATE ? 'c' : e === HOLE ? 'h' : isCannon(e) ? '=' : '.'; }).join('');
  const pieces = board.pieces.filter((p) => !p.inCannon && !isCannon(board.element(p.x, p.y))).map((p) => LETTERS[p.type] + b36(p.x) + b36(p.y) + p.dir).join(',');
  const cannons = board.cannons.map((c) => c.slots.map((s) => (s ? LETTERS[s.type] : '-')).join('') + (c.fouled ? 'f' : '')).join(',');
  const arrows = board.arrows.filter((i) => i >= 0).map((i) => b36(i % WIDTH) + b36(Math.floor(i / WIDTH)) + (board.arrowAt(i) - UP)).join(',');
  const barrel = board.barrel, position = barrel.shown === BARREL_ROW && barrel.row === BARREL_ROW ? '' : `@${b36(barrel.shown)}${b36(barrel.row)}`;
  return `G${board.numCannons}${barrelFacing(board)}${position}:${cells}:${pieces}:${cannons}:${arrows}`;
}

export interface BoardText { cannons: number; facing: number; barrel: [number, number]; cells: string; pieces: [number, number, number, number][]; loads: string[]; arrows: [number, number, number][] }

export function readBoardCode(text: string): BoardText | null {
  const m = /^G([246])([0-3])(?:@([0-9a-c])([0-9a-g]))?:([.ch=]+):((?:[wspd][0-9a-c][0-9a-g][0-3](?:,|(?=:)))*):([^:]*):((?:[0-9a-c][0-9a-g][0-3],?){0,3})$/i.exec(text.trim());
  if (!m) return null;
  const cannons = Number(m[1]), height = heightFor(cannons), cells = m[5].toLowerCase();
  if (cells.length !== WIDTH * height) return null;
  const barrel: [number, number] = m[3] ? [parseInt(m[3], 36), parseInt(m[4], 36)] : [BARREL_ROW, BARREL_ROW];
  if (barrel[1] >= height || cells[barrel[1] * WIDTH + barrel[0]] !== '.') return null;
  const probe = new GunneryBoard(cannons, 0);
  for (let i = 0; i < cells.length; i++) if ((cells[i] === '=') !== isCannon(element(probe.cells[i]))) return null;
  const pieces = m[6].split(',').filter(Boolean).map((p) => [BY_LETTER.get(p[0].toLowerCase())!, parseInt(p[1], 36), parseInt(p[2], 36), Number(p[3])] as [number, number, number, number]);
  if (pieces.some(([, x, y]) => y >= height || cells[y * WIDTH + x] !== '.')) return null;
  const loads = m[7].split(',');
  if (loads.length !== cannons || loads.some((l) => !/^[wspd-]{3}f?$/i.test(l))) return null;
  const arrows = m[8].split(',').filter(Boolean).map((a) => [parseInt(a[0], 36), parseInt(a[1], 36), Number(a[2])] as [number, number, number]);
  if (arrows.some(([x, y]) => y >= height || cells[y * WIDTH + x] !== '.')) return null;
  return { cannons, facing: Number(m[2]), barrel, cells, pieces, loads, arrows };
}

/** Puts a deck read from text onto a board with the same number of cannons. */
export function load(board: GunneryBoard, read: BoardText): void {
  for (let i = 0; i < board.cells.length; i++) {
    const e = element(board.cells[i]);
    if (!isCannon(e)) board.cells[i] = read.cells[i] === 'c' ? CRATE : read.cells[i] === 'h' ? HOLE : 0;
  }
  board.arrows.fill(-1);
  for (const [x, y, dir] of [...read.arrows].reverse()) board.setArrow(x, y, dir + UP);
  board.pieces = [];
  board.ballsOut = 0;
  read.loads.forEach((slots, id) => {
    const cannon = board.cannons[id];
    emptyCannon(cannon, board);
    if (slots.endsWith('f')) cannon.foul();
    for (const c of slots.slice(0, 3)) if (c !== '-') loadCannon(board, cannon, BY_LETTER.get(c.toLowerCase())!);
  });
  board.barrel.col = board.barrel.shown = read.barrel[0]; board.barrel.row = read.barrel[1];
  faceBarrel(board, read.facing);
  for (const [type, x, y, dir] of read.pieces) {
    const piece = new Piece(type, x, y, dir);
    piece.route(board, true);
    board.pieces.push(piece);
    if (type === SHOT) board.ballsOut++;
  }
}

/** Where the game deals crates (and the ship takes holes): clear of the barrel's rows, the cannons' lanes and the gunports. */
function obstacleOk(board: GunneryBoard, i: number): boolean {
  const y = Math.floor(i / WIDTH), x = i % WIDTH;
  if (y === 5 || y === 6 || y === 7) return false;
  if (board.isCannonRow(y)) return x !== 0 && x !== 12 && x !== 4 && x !== 8;
  if (board.isCannonRow(y + 1)) return x !== 0 && x !== 12;
  return !board.isCannonRow(y - 1) || (x > 4 && x < 8);
}

/** Ways a painted deck differs from one the game could deal. */
export function boardIssues(board: GunneryBoard): string[] {
  const issues: string[] = [], n = board.numCannons;
  if(board.barrel.shown !== BARREL_ROW || board.barrel.row !== BARREL_ROW) issues.push('The game starts the barrel in the middle of row 6.');
  const crates = board.cells.flatMap((raw, i) => (element(raw) === CRATE ? [i] : []));
  const holes = board.cells.flatMap((raw, i) => (element(raw) === HOLE ? [i] : []));
  if (crates.length !== n * 4) issues.push(`${n} cannons deal ${n * 4} crates, not ${crates.length}.`);
  if (crates.some((i) => !obstacleOk(board, i))) issues.push('Crates never sit in the barrel’s rows, a cannon row’s open lanes, beside a gunport or across the lane below a cannon.');
  if (holes.some((i) => !obstacleOk(board, i))) issues.push('Holes only open where crates could sit.');
  const loose = board.pieces.filter((p) => !p.inCannon && !isCannon(board.element(p.x, p.y)));
  if (loose.length > n * 2) issues.push(`The barrel stops at ${n * 2} pieces on the deck.`);
  for (const type of [SWAB, SHOT, POWDER, WAD]) {
    if (loose.filter((p) => p.type === type).length > n / 2) issues.push(`The barrel puts out at most ${n / 2} of each piece at once.`);
  }
  const cells = new Set(loose.map((p) => `${p.x},${p.y}`));
  if (cells.size !== loose.length) issues.push('Two pieces share a cell.');
  return [...new Set(issues)];
}

