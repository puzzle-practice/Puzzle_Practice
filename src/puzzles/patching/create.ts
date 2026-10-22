// Patching's Freeplay mode: painting the board and reading it as text. A board's text is P, the
// difficulty (0-9, or A for 10), then two characters a square from the top left, row by row: the
// piece (S straight, L elbow, T tee, X cross, G grommet, O tie-off, B blocker, U spool) and its
// orientation (0-3).
import { BLOCKER, CROSS, ELBOW, facing, GROMMET, movable, neighbour, PatchingBoard, SLACK, SPOOL, STRAIGHT, TEE, TIE, type Piece } from './logic';

export const PAINTABLE = [STRAIGHT, ELBOW, TEE, CROSS, GROMMET, TIE, BLOCKER, SPOOL];
export const PIECE_NAMES: Record<number, string> = {
  [STRAIGHT]: 'Straight', [ELBOW]: 'Elbow', [TEE]: 'Tee', [CROSS]: 'Cross', [GROMMET]: 'Grommet', [TIE]: 'Tie-off', [BLOCKER]: 'Blocker', [SPOOL]: 'Spool',
};
const CHARS: Record<number, string> = { [STRAIGHT]: 'S', [ELBOW]: 'L', [TEE]: 'T', [CROSS]: 'X', [GROMMET]: 'G', [TIE]: 'O', [BLOCKER]: 'B', [SPOOL]: 'U' };
const TYPES = new Map(Object.entries(CHARS).map(([type, char]) => [char, Number(type)]));
/** Fill board can lay any piece except the spool and tie-offs, which stay where they are. */
export const FILLABLE = [STRAIGHT, ELBOW, TEE, CROSS, GROMMET, BLOCKER];

const piece = (type: number, orientation: number): Piece => ({ type, orientation, tension: SLACK, distance: 43 });
/** The spool must face a square on the grid, or the line has nowhere to go. */
const spoolFits = (i: number, orientation: number) => neighbour(i, (orientation + 2) % 4) >= 0;
const spoolOrientation = (i: number, from: number) => [0, 1, 2, 3].map((n) => (from + n) % 4).find((o) => spoolFits(i, o))!;

function settle(board: PatchingBoard): void {
  for (const p of board.pieces.values()) p.tension = SLACK;
  board.ties.sort((a, b) => a - b);
  board.update();
  board.distances();
}

/** Paints a square inside the board. The spool moves rather than doubling, swapping with what was there. Returns false when nothing changed. */
export function paint(board: PatchingBoard, i: number, type: number): boolean {
  if (!board.inBounds(i) || !PAINTABLE.includes(type)) return false;
  const old = board.pieces.get(i)!;
  if (old.type === type || i === board.spool) return false;
  if (type === SPOOL) {
    const spool = board.pieces.get(board.spool)!;
    board.pieces.set(board.spool, old);
    if (old.type === TIE) board.ties[board.ties.indexOf(i)] = board.spool;
    board.pieces.set(i, piece(SPOOL, spoolOrientation(i, spool.orientation)));
    board.spool = i;
  } else {
    if (old.type === TIE) board.ties.splice(board.ties.indexOf(i), 1);
    if (type === TIE) board.ties.push(i);
    board.pieces.set(i, piece(type, type === BLOCKER ? 0 : old.orientation));
  }
  settle(board);
  return true;
}

/** Rotates any piece but a blocker. The game only lets players turn movable pieces, but Freeplay can point the spool and tie-offs too. */
export function rotate(board: PatchingBoard, i: number, delta: number): boolean {
  const p = board.pieces.get(i);
  if (!p || !board.inBounds(i) || p.type === BLOCKER) return false;
  if (p.type === SPOOL) {
    const turned = [1, 2, 3].map((n) => (p.orientation + delta * n + 8) % 4).find((o) => spoolFits(i, o));
    if (turned === undefined) return false;
    p.orientation = turned;
  } else p.orientation = (p.orientation + delta + 4) % 4;
  board.update();
  return true;
}

export function fill(board: PatchingBoard, type: number): boolean {
  if (!FILLABLE.includes(type)) return false;
  for (let i = 0; i < 42; i++) if (board.inBounds(i) && i !== board.spool && !board.ties.includes(i)) board.pieces.set(i, piece(type, 0));
  settle(board);
  return true;
}

export function boardCode(board: PatchingBoard): string {
  let code = `P${board.difficulty.toString(11).toUpperCase()}`;
  for (let i = 0; i < 42; i++) { const p = board.pieces.get(i)!; code += CHARS[p.type] + (p.type === BLOCKER ? 0 : p.orientation); }
  return code;
}

export interface BoardText { difficulty: number; pieces: [number, number][] }

export function readBoardCode(text: string): BoardText | null {
  const m = /^P([0-9A])((?:[SLTXGOBU][0-3]){42})$/i.exec(text.trim());
  if (!m) return null;
  const difficulty = parseInt(m[1], 11), pieces: [number, number][] = [];
  for (let i = 0; i < 42; i++) pieces.push([TYPES.get(m[2][i * 2].toUpperCase())!, Number(m[2][i * 2 + 1])]);
  const probe = new PatchingBoard(difficulty, 0, false);
  const spools = pieces.flatMap(([type], i) => type === SPOOL ? [i] : []);
  if (spools.length !== 1 || !spoolFits(spools[0], pieces[spools[0]][1])) return null;
  if (pieces.some(([type], i) => !probe.inBounds(i) && type !== BLOCKER)) return null;
  return { difficulty, pieces };
}

/** A board built from text. */
export function load(read: BoardText, seed: number): PatchingBoard {
  const board = new PatchingBoard(read.difficulty, seed, false);
  read.pieces.forEach(([type, orientation], i) => {
    board.pieces.set(i, piece(type, orientation));
    if (type === SPOOL) board.spool = i;
    if (type === TIE) board.ties.push(i);
  });
  settle(board);
  return board;
}

/** Ways a painted board differs from one the game could deal at its difficulty. */
export function boardIssues(board: PatchingBoard): string[] {
  const issues: string[] = [], info = board.info, d = board.difficulty;
  const inside = [...board.pieces].filter(([i]) => board.inBounds(i));
  const count = (type: number) => inside.filter(([, p]) => p.type === type).length;
  if (board.ties.length !== info.ties) issues.push(`Difficulty ${d} deals ${info.ties} tie-off${info.ties === 1 ? '' : 's'}, not ${board.ties.length}.`);
  if (count(BLOCKER) > info.blockers) issues.push(info.blockers ? `Difficulty ${d} deals at most ${info.blockers} blockers.` : `Difficulty ${d} deals no blockers.`);
  if (info.min > 1 && count(GROMMET)) issues.push(`Difficulty ${d} deals no grommets.`);
  if (info.max < 4 && count(CROSS)) issues.push(`Difficulty ${d} deals no crosses.`);
  if (count(GROMMET) < board.minGrommets) issues.push(`Difficulty ${d} deals at least ${board.minGrommets} grommets.`);
  // The game only deals boards where every movable piece can be swapped toward the spool.
  const first = neighbour(board.spool, facing(board.pieces.get(board.spool)!)[0]);
  const reached = new Set([first]), stack = [first];
  while (stack.length) {
    const i = stack.pop()!;
    for (let dir = 0; dir < 4; dir++) {
      const n = neighbour(i, dir), p = board.pieces.get(n);
      if (p && movable(p) && !reached.has(n)) { reached.add(n); stack.push(n); }
    }
  }
  if (!board.inBounds(first)) issues.push('The spool faces the edge of the board.');
  else if ([...board.pieces].some(([i, p]) => movable(p) && !reached.has(i))) issues.push('Blockers wall off pieces from the spool.');
  return issues;
}
