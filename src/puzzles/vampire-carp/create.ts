// Carpentry's Freeplay mode: painting the holes, the planks in them and the toolbox, and reading
// them as text. A board's text is C, then each hole's 10x10 box as 25 hex digits (a bit a square,
// column by column, 1 a square of the hole, planked or not), then a colon and the toolbox's three
// planks: the piece letter (b for putty) and 1 if its grain runs across as dealt, 0 if not. Planks
// already in the holes follow a semicolon, six characters each in the order they went in: the
// hole (0-3), the piece letter, its grain as dealt, its orientation (0-7), then where its first
// cell sits in the hole's box, x and y, each plus 2 as a hex digit.
import { CarpentryBoard, type Cell, Hole, MAX_HOLE, MAX_KNOCKOUTS, NUM_HOLES, Piece, PIECE_LETTERS, PUTTY, PUTTY_TOOL, tutorialCells } from './board';

/** I, L, N, Y and putty are always dealt with the grain across. */
export const FIXED_GRAIN = new Set([1, 2, 4, 10, PUTTY]);
export const pieceLetter = (kind: number) => (kind === PUTTY ? 'b' : PIECE_LETTERS[kind]);

/** The hole's squares in its 10x10 box, [x][y], whether planks cover them yet or not. */
export function holeGrid(hole: Hole): boolean[][] {
  const grid = Array.from({ length: MAX_HOLE }, () => Array<boolean>(MAX_HOLE).fill(false));
  const [ox, oy] = hole.offset;
  for (let x = 0; x < hole.width; x++) for (let y = 0; y < hole.height; y++) {
    if (hole.origEmpty[x]?.[y] && x + ox >= 0 && x + ox < MAX_HOLE && y + oy >= 0 && y + oy < MAX_HOLE) grid[x + ox][y + oy] = true;
  }
  return grid;
}

/** A plank in a hole, with its first cell in the hole's 10x10 box rather than the hole. Planks already on the board keep their piece, tokens and all. */
export interface BoxPlank { tool: number; orient: number; at: Cell; piece?: Piece }

/** The hole's planks in the order they went in, placed in its box. */
export function holePlanks(hole: Hole): BoxPlank[] {
  const [ox, oy] = hole.offset;
  return hole.tools.map(({ piece, at }) => ({ tool: piece.tool, orient: piece.orient, at: [at[0] + ox, at[1] + oy], piece }));
}

/** The hole for these squares with these planks put back in order. Planks left covering nothing drop out. */
function rebuild(grid: boolean[][], id: number, planks: BoxPlank[]): Hole {
  const hole = shapeHole(grid, id);
  if (!hole.size && !hole.origSquares) return hole;
  const [ox, oy] = hole.offset;
  for (const p of planks) hole.restorePiece(p.piece ?? new Piece(p.tool, p.orient), [p.at[0] - ox, p.at[1] - oy]);
  return hole;
}

/** The topmost plank covering a square of the hole's box, or -1. */
function plankOn(hole: Hole, [x, y]: Cell): number {
  const [ox, oy] = hole.offset;
  for (let i = hole.tools.length - 1; i >= 0; i--) {
    const { piece, at } = hole.tools[i];
    if (piece.cells().some(([cx, cy]) => cx + at[0] + ox === x && cy + at[1] + oy === y)) return i;
  }
  return -1;
}

/**
 * A freshly dealt hole with these open squares, kept where they are in the box. Its size is its
 * squares ÷ 5, and the rest count as the growth a neglected hole gets.
 */
export function shapeHole(grid: boolean[][], id: number): Hole {
  const open: Cell[] = [];
  for (let x = 0; x < MAX_HOLE; x++) for (let y = 0; y < MAX_HOLE; y++) if (grid[x][y]) open.push([x, y]);
  if (!open.length) return Hole.blank(id);
  const x0 = Math.min(...open.map((c) => c[0])), x1 = Math.max(...open.map((c) => c[0]));
  const y0 = Math.min(...open.map((c) => c[1])), y1 = Math.max(...open.map((c) => c[1]));
  const cells = Array.from({ length: x1 - x0 + 1 }, (_, x) => Array.from({ length: y1 - y0 + 1 }, (_, y) => grid[x + x0][y + y0]));
  const hole = Hole.shaped(cells, id);
  hole.boxAt = [x0, y0];
  hole.knockouts = Math.min(MAX_KNOCKOUTS, open.length - hole.size * 5);
  // A hole grows into its outer two columns; with nowhere left there, it can't grow.
  const w = hole.width, side = (x: number, y: number) => x >= 0 && x < w && hole.origEmpty[x][y];
  const room = w >= 2 && Array.from({ length: hole.height }, (_, y) => !(side(1, y) && side(0, y)) || !(side(w - 2, y) && side(w - 1, y))).some(Boolean);
  if (!room) hole.knockouts = MAX_KNOCKOUTS;
  return hole;
}

/**
 * Opens or closes a square of hole `index`'s box. A plank on the square comes out, leaving the
 * square open for cutting or wood for filling; the other planks stay where they are. Returns the
 * new hole, or null when nothing changed.
 */
export function paintHole(board: CarpentryBoard, index: number, at: Cell, open: boolean): Hole | null {
  const [x, y] = at;
  if (x < 0 || y < 0 || x >= MAX_HOLE || y >= MAX_HOLE) return null;
  const old = board.holes[index], grid = holeGrid(old), planks = holePlanks(old);
  const plank = grid[x][y] ? plankOn(old, at) : -1;
  if (grid[x][y] === open && plank < 0) return null;
  if (plank >= 0) planks.splice(plank, 1);
  grid[x][y] = open;
  return (board.holes[index] = rebuild(grid, old.id, planks));
}

/** Closes every hole. */
export function clearHoles(board: CarpentryBoard): void {
  for (let i = 0; i < NUM_HOLES; i++) board.holes[i] = Hole.blank(board.holes[i].id);
}

/** A toolbox byte for a piece and grain; pieces always dealt across stay across. */
export function toolFor(kind: number, across: boolean): number {
  if (kind === PUTTY) return PUTTY_TOOL;
  return (kind << 1) | (across || FIXED_GRAIN.has(kind) ? 1 : 0);
}
export function setTool(board: CarpentryBoard, slot: number, tool: number): boolean {
  if (slot < 0 || slot > 2 || board.toolbox[slot] === tool || tool >> 1 > PUTTY || tool < 0) return false;
  board.toolbox[slot] = tool;
  board.toolTokens[slot] = null;
  return true;
}

export function boardCode(board: CarpentryBoard): string {
  let code = 'C', planks = '';
  board.holes.forEach((hole, h) => {
    const grid = holeGrid(hole);
    let bits = '';
    for (let x = 0; x < MAX_HOLE; x++) for (let y = 0; y < MAX_HOLE; y++) bits += grid[x][y] ? '1' : '0';
    for (let i = 0; i < 100; i += 4) code += parseInt(bits.slice(i, i + 4), 2).toString(16);
    for (const p of holePlanks(hole)) planks += `${h}${pieceLetter(p.tool >> 1)}${p.tool & 1}${p.orient}${(p.at[0] + 2).toString(16)}${(p.at[1] + 2).toString(16)}`;
  });
  return `${code}:${board.toolbox.map((t) => (t < 0 ? '' : pieceLetter(t >> 1) + (t & 1))).join('')}${planks ? `;${planks}` : ''}`;
}

export interface BoardText { holes: boolean[][][]; tools: number[]; planks?: BoxPlank[][] }

export function readBoardCode(text: string): BoardText | null {
  const m = /^C([0-9a-f]{100}):((?:[filpntuvwxyzb][01]){3})(?:;((?:[0-3][filpntuvwxyzb][01][0-7][0-9a-d]{2})+))?$/i.exec(text.trim());
  if (!m) return null;
  const holes = Array.from({ length: NUM_HOLES }, (_, h) => {
    const bits = [...m[1].slice(h * 25, h * 25 + 25)].map((c) => parseInt(c, 16).toString(2).padStart(4, '0')).join('');
    return Array.from({ length: MAX_HOLE }, (_, x) => Array.from({ length: MAX_HOLE }, (_, y) => bits[x * MAX_HOLE + y] === '1'));
  });
  const kindOf = (letter: string) => (letter === 'b' ? PUTTY : PIECE_LETTERS.indexOf(letter as (typeof PIECE_LETTERS)[number]));
  const tools = [0, 1, 2].map((i) => toolFor(kindOf(m[2][i * 2].toLowerCase()), m[2][i * 2 + 1] === '1'));
  const planks: BoxPlank[][] = holes.map(() => []);
  for (let i = 0; i < (m[3]?.length ?? 0); i += 6) {
    const p = m[3].slice(i, i + 6).toLowerCase(), kind = kindOf(p[1]);
    planks[Number(p[0])].push({ tool: kind === PUTTY ? PUTTY_TOOL : (kind << 1) | Number(p[2]), orient: kind === PUTTY ? 1 : Number(p[3]), at: [parseInt(p[4], 16) - 2, parseInt(p[5], 16) - 2] });
  }
  return { holes, tools, planks };
}

/** Puts a board read from text onto the board. */
export function load(board: CarpentryBoard, read: BoardText): void {
  read.holes.forEach((grid, i) => { board.holes[i] = rebuild(grid, board.holes[i].id, read.planks?.[i] ?? []); });
  read.tools.forEach((tool, slot) => setTool(board, slot, tool));
}

/** A hole's squares, wherever they sit in its box. */
function shapeKey(hole: Hole): string {
  const grid = holeGrid(hole);
  const xs = grid.flatMap((col, x) => (col.some(Boolean) ? [x] : [])), ys = [...Array(MAX_HOLE).keys()].filter((y) => grid.some((col) => col[y]));
  return grid.slice(xs[0], xs[xs.length - 1] + 1).map((col) => col.slice(ys[0], ys[ys.length - 1] + 1).map(Number).join('')).join('/');
}

/** Ways a painted board differs from one the game could deal. `ship` is false for the Vampire Lair. */
export function boardIssues(board: CarpentryBoard, ship: boolean): string[] {
  const issues: string[] = [], d = board.difficulty;
  const [min, max] = ship ? [Math.max(4, 6 - d), Math.min(14, 6 + d)] : [5, 5];
  board.holes.forEach((hole, i) => {
    const squares = holeGrid(hole).flat().filter(Boolean).length;
    if (!squares) return;
    const name = ['Top-left', 'Top-right', 'Bottom-left', 'Bottom-right'][i];
    if (squares % 5 > MAX_KNOCKOUTS) issues.push(`${name} hole has ${squares} squares: holes come in fives, plus up to ${MAX_KNOCKOUTS} from growing.`);
    else if (ship && d < 2) { if (shapeKey(hole) !== shapeKey(Hole.shaped(tutorialCells(d), 0))) issues.push(`${name} hole isn’t difficulty ${d}’s tutorial hole.`); }
    else if (Math.trunc(squares / 5) < min || Math.trunc(squares / 5) > max) issues.push(`${name} hole is ${Math.trunc(squares / 5)} planks; ${ship ? `difficulty ${d} deals ${min}–${max}` : 'the Vampire Lair deals 5'}.`);
  });
  const putties = board.toolbox.filter((t) => t === PUTTY_TOOL).length;
  if (putties && ship && d < 3) issues.push(`Difficulty ${d} deals no putty.`);
  else if (putties > 1) issues.push('The toolbox never holds two putties.');
  if (ship && d < 2 && board.toolbox.some((t, slot) => t >> 1 !== [3, 10, 1][slot])) issues.push(`Difficulty ${d} always deals P, Y and I.`);
  return issues;
}
