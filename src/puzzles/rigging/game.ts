import { gameFont, gameFontFor } from '../../core/game-text';
import { Performance } from '../bilging/game';
import {
  EMPTY, GAFF, PULLEYS, ROWS, RiggingBoard, SKIPS_FOR_PENALTY, TAR, WILD, isLink, isWild, opposite, rowSize, shapeOf, type Link, type Point, type Pull,
} from './board';

export interface RiggingSettings {
  difficulty: number;
  tokens: number;
  timerMs: number;
  indicatorMax: number;
  /** Normal plays the duty puzzle; Freeplay lets you paint the board and never deals a new one. */
  mode: Mode;
}
export type Mode = 'normal' | 'create';
export const DEFAULT_SETTINGS: RiggingSettings = { difficulty: 6, tokens: 1, timerMs: 0, indicatorMax: 7.48, mode: 'normal' };
/** The game's default indicator thresholds for rigging (points a slide). */
export const DEFAULT_LEVELS = [0, 1.02, 2.04, 2.38, 3.06, 3.4, 3.74, 4.08, 4.08, 4.42, 4.76, 4.76, 5.1, 5.1, 5.44, 5.78, 5.78, 6.12, 6.8, 7.48];
export function indicatorStep(value: number, max = 7.48): number {
  const i = DEFAULT_LEVELS.findIndex(n => value <= n * max / 7.48);
  return i === -1 ? 20 : i;
}
export function readSettings(value: unknown): RiggingSettings | null {
  if (!value || typeof value !== 'object') return null;
  // Settings saved before Freeplay mode existed are Normal.
  const s = { mode: 'normal', ...value } as RiggingSettings;
  return ['normal', 'create'].includes(s.mode) && Number.isInteger(s.difficulty) && s.difficulty >= 0 && s.difficulty <= 9 && [0, 1, 2].includes(s.tokens) &&
    [0, 120000, 300000, 600000].includes(s.timerMs) && Number.isFinite(s.indicatorMax) && s.indicatorMax >= 1 && s.indicatorMax <= 1000 ? { ...s } : null;
}
export const settingsKey = (s: RiggingSettings) => `d${s.difficulty}-t${s.tokens}-${s.timerMs}-i${s.indicatorMax}`;

/** Every piece Freeplay mode can paint: the eight colours, wild, tar, gaff and the three splices. */
export const PAINTABLE = [0, 1, 2, 3, 4, 5, 6, 7, WILD, TAR, GAFF, 12, 13, 14];
const validPiece = (v: number) => PAINTABLE.includes(v & 15) && (shapeOf(v) === 0 || (v & 15) < 8 && shapeOf(v) <= 7) && v < 128;
const isColour = (v: number) => v !== EMPTY && (v & 15) < 8;
/** Freeplay: a colour painted over a colour keeps its token, so pieces and tokens paint separately. */
export const repaint = (old: number, piece: number) => piece < 8 && isColour(old) ? piece | shapeOf(old) << 4 : piece;
/** Freeplay: a colour with its token changed (0 takes it off). Other pieces carry no token. */
export const reshape = (old: number, shape: number) => isColour(old) ? (old & 15) | shape << 4 : old;
/** A board as text: the active pulley (0–5), each piece as two hex digits row by row, then the turns since the last clear when there are any. */
export function boardCode(board: RiggingBoard): string {
  return 'R' + board.nextPulley + board.cells().map(v => v.toString(16).padStart(2, '0')).join('') + (board.skipped ? board.skipped : '');
}
export function readBoardCode(text: string): { pulley: number; cells: number[]; skipped: number } | null {
  const m = /^R([0-5])((?:[0-9a-f]{2}){61})([0-2])?$/i.exec(text.trim());
  if (!m) return null;
  const cells = m[2].match(/../g)!.map(h => parseInt(h, 16));
  return cells.every(validPiece) ? { pulley: Number(m[1]), cells, skipped: Number(m[3] ?? 0) } : null;
}
/** Pieces pulled to fill the level meter: 20 at difficulty 0, then 27 per level above it. */
export const piecesForLevel = (difficulty: number) => difficulty === 0 ? 20 : (difficulty + 1) * 27;

/** Screen layout from the game: 44-pixel spacing, rows 38 pixels apart, the board's top row at y = 143. */
export const STEP = 44, ROW_STEP = Math.trunc(STEP / 2 * Math.sqrt(3)), BOARD_X = 50, BOARD_Y = 143;
export function cellPos(p: Point): [number, number] {
  return [p.x * STEP + (9 - rowSize(p.y)) * STEP / 2 + BOARD_X, p.y * ROW_STEP + BOARD_Y];
}
export function cellAt(px: number, py: number): Point | null {
  const y = Math.round((py - BOARD_Y) / ROW_STEP) || 0;
  if (y < 0 || y >= 9) return null;
  const size = rowSize(y), x = Math.round((px - BOARD_X - (9 - size) * STEP / 2) / STEP) || 0;
  return x >= 0 && x < size ? { x, y } : null;
}
/** One step along each sliding axis (SW, W, NW); the opposite directions slide the other way. */
export const AXES: readonly [number, number][] = [[-STEP / 2, ROW_STEP], [-STEP, 0], [-STEP / 2, -ROW_STEP]];
const AXIS_LENGTH = AXES.map(([x, y]) => Math.hypot(x, y));
/** Where each pulley's wheel sits relative to its piece. */
export const PULLEY_OFFSETS: readonly [number, number][] = [[-1, -57], [47, -31], [48, 33], [-1, 54], [-47, 33], [-47, -33]];
export const pulleyPos = (i: number): [number, number] => {
  const [x, y] = cellPos(PULLEYS[i]);
  return [x + PULLEY_OFFSETS[i][0], y + PULLEY_OFFSETS[i][1]];
};
/** Drags shorter than this choose no axis yet. */
export const DRAG_START = 20;

/** The axis a drag follows: the one whose line passes closest to the pointer. */
export function dragAxis(dx: number, dy: number): number {
  let best = 0, bestDistance = Infinity;
  AXES.forEach(([ax, ay], i) => {
    const t = (dx * ax + dy * ay) / (ax * ax + ay * ay);
    const d = Math.hypot(Math.round(t * ax) - dx, Math.round(t * ay) - dy);
    if (d < bestDistance) { bestDistance = d; best = i; }
  });
  return best;
}
/** Distance dragged along an axis, in pixels. */
export const projection = (axis: number, dx: number, dy: number) => (AXES[axis][0] * dx + AXES[axis][1] * dy) / AXIS_LENGTH[axis];
/** A drag's slide: whole places along the axis, with negative distances sliding the opposite way. */
export function slideFor(axis: number, distance: number): { dir: number; amount: number } {
  const n = Math.round(distance / AXIS_LENGTH[axis]) || 0;
  return n < 0 ? { dir: opposite(axis), amount: -n } : { dir: axis, amount: n };
}

export const PATH_STEP_MS = 50, HOOK_MS = 300, TAR_MS = 900, FADE_MS = 200, REFILL_MS = 400;
export const CACHE_FILL_MS = 950, LEVEL_MS = 2900;

export interface Flight { piece: number; path: [number, number][]; duration: number }
export interface Scene {
  kind: 'pull' | 'refill' | 'cache' | 'level';
  /** The board as it looks when the scene starts. */
  cells: number[][];
  duration: number;
  pulley?: number;
  /** Time before the pieces start towards the pulley (splices, gaffs and tar going off first). */
  delay?: number;
  flights?: Flight[];
  gone?: Set<string>;
  tar?: Point[];
  labels?: { text: string; size: number; at: [number, number] }[];
  /** Coils showing during the scene. */
  coils: number;
  sounds?: string[];
}

export interface MoveResult { pieces: number; points: number; skipped: boolean; specials: number[]; maneuvers: number[] }

/** The pieces a pull carries and the line each follows back through the chain to the pulley. */
function flights(pull: Pull, cells: number[][], wheel: [number, number]): Flight[] {
  const out: Flight[] = [];
  for (const chain of pull.chains()) for (const node of [...chain.pulled.values(), ...chain.isolates.values()]) {
    const piece = cells[node.at.y][node.at.x], t = piece & 15;
    let start = cellPos(node.at);
    // A piece a gaff hooked starts halfway towards the gaff.
    if (t !== chain.colour && !isWild(piece) && !isLink(piece) && node.via) {
      const v = cellPos(node.via.at);
      start = [Math.trunc((start[0] + v[0]) / 2), Math.trunc((start[1] + v[1]) / 2)];
    }
    const path: [number, number][] = [start];
    for (let v: Link | null = node.via; v; v = v.via) path.push(cellPos(v.at));
    path.push(wheel);
    out.push({ piece, path, duration: PATH_STEP_MS * (path.length + 1) });
  }
  return out;
}

export class RiggingGame {
  board: RiggingBoard;
  cursor: Point = { x: 0, y: 0 };
  /** Keyboard selection: the next direction keys slide the rope instead of moving the cursor. */
  selecting = false;
  /** The slide being shown before it is let go: along axis 0–2, `offset` pixels. */
  preview: { at: Point; axis: number; offset: number } | null = null;
  scenes: Scene[] = [];
  sceneElapsed = 0;
  points = 0;
  moves = 0;
  pulls = 0;
  pieces = 0;
  levels = 0;
  levelPieces = 0;
  biggestPull = 0;
  /** Specials earned: wild, tar, gaff, splice. */
  earned = { wild: 0, tar: 0, gaff: 0, splice: 0 };
  maneuverCounts = Array<number>(8).fill(0);
  lastMove: MoveResult | null = null;
  performance = new Performance();
  private boardNumber = 0;
  private pendingLevel = false;

  constructor(readonly settings: RiggingSettings, readonly seed: number) { this.board = this.deal(); }
  private deal(): RiggingBoard {
    // Boards after a level-up use a deterministic practice seed sequence so replays repeat.
    const seed = this.boardNumber ? (this.seed + Math.imul(this.boardNumber, 0x9e3779b9)) >>> 0 : this.seed;
    return new RiggingBoard(seed, this.settings.difficulty, this.settings.tokens);
  }
  get busy(): boolean { return this.scenes.length > 0; }
  get efficiency(): number { return this.moves ? this.points / this.moves : 0; }
  get maneuvers(): number { return this.maneuverCounts.reduce((a, b) => a + b, 0); }
  get levelTarget(): number { return piecesForLevel(this.settings.difficulty); }
  /** Coils on the rope: what the scene in progress shows, else the board's. */
  get coils(): number { return this.scenes[0]?.coils ?? this.board.cache; }

  /** A direction key: moves the cursor (wrapping round its rope), or while selecting nudges the slide. */
  key(dir: number): void {
    if (!this.selecting) {
      const p = this.board.adjacent(this.cursor.x, this.cursor.y, dir, true);
      if (p) this.cursor = p;
      return;
    }
    const axis = dir < 3 ? dir : opposite(dir), sign = dir < 3 ? 1 : -1;
    if (this.preview && this.preview.axis !== axis) return;
    this.preview = { at: { ...this.cursor }, axis, offset: (this.preview?.offset ?? 0) + sign * AXIS_LENGTH[axis] };
  }
  pointAt(p: Point): void { if (!this.selecting) this.cursor = { ...p }; }
  /** S: start selecting, or let go of the selected slide. Returns true when a slide was made. */
  select(): boolean {
    if (!this.selecting) {
      if (this.busy) return false;
      this.selecting = true; this.preview = null;
      return false;
    }
    const preview = this.preview;
    this.selecting = false; this.preview = null;
    if (!preview) return false;
    const { dir, amount } = slideFor(preview.axis, preview.offset);
    return this.slide(preview.at.x, preview.at.y, dir, amount);
  }
  /** Space or a right click: put the rope back. */
  cancel(): void { if (this.preview) { this.preview = null; this.selecting = false; } }

  /** Slides a rope and pulls at the active pulley. A slide that comes back to where it started is not a move. */
  slide(x: number, y: number, dir: number, amount: number): boolean {
    if (this.busy) return false;
    const b = this.board;
    if (!b.slide(x, y, dir, amount)) return false;
    this.cursor = { x, y };
    this.moves++;
    const pulley = b.nextPulley, coilsBefore = b.cache, cells = b.pieces.map(r => [...r]);
    const pull = b.pullNext();
    if (!pull) {
      this.performance.add(0, 1);
      this.lastMove = { pieces: 0, points: 0, skipped: true, specials: [], maneuvers: [] };
      return true;
    }
    const pieces = pull.count, wheel = pulleyPos(pulley);
    let points = pull.points(b.colours);
    this.pulls++; this.pieces += pieces; this.biggestPull = Math.max(this.biggestPull, pieces);
    for (const s of pull.maneuvers) this.maneuverCounts[s]++;
    const gone = new Set([...pull.chains()].flatMap(c => [...c.pulled.keys(), ...c.isolates.keys()]));
    const specials = this.newSpecials(gone);
    // Each wild the coils earn is worth 25 points without a move.
    const fills = Math.floor((coilsBefore + pieces) / 20);
    this.performance.add(points, 1);
    for (let i = 0; i < fills; i++) this.performance.add(25, 0);
    points += 25 * fills;
    this.points += points;
    this.lastMove = { pieces, points, skipped: false, specials, maneuvers: [...pull.maneuvers] };

    const hooked = [...pull.chains()].some(c => [...c.pulled.values()].some(n => {
      const v = cells[n.at.y][n.at.x];
      return isLink(v) || (n.via && (v & 15) !== c.colour && !isWild(v));
    }));
    const tar = [...pull.chains()].flatMap(c => c.tar);
    const delay = (hooked ? HOOK_MS : 0) + (tar.length ? TAR_MS : 0);
    const f = flights(pull, cells, wheel);
    const labels = [...pull.chains()].map(c => ({ text: `${c.pulled.size} cleared!`, size: gameFontFor(c.pulled.size - 2, 20), at: [wheel[0], Math.max(40, wheel[1])] as [number, number] }));
    if (pull.isolates.size) labels.push({ text: `${pull.isolates.size} looped!`, size: gameFontFor(Math.floor(Math.log2(pull.isolates.size)), 5), at: [225, 300] });
    const sounds = [pieces >= 15 ? 'pulley_fanfare_3' : pieces >= 10 ? 'pulley_fanfare_2' : pieces >= 5 ? 'pulley_fanfare_1' : '', 'rope_pull'];
    if ([...pull.chains()].some(c => [...c.pulled.values()].some(n => isLink(cells[n.at.y][n.at.x])))) sounds.push('splice');
    else if (hooked) sounds.push('hook');
    if (tar.length) sounds.push('tar_splat');
    this.scenes.push({ kind: 'pull', cells, pulley, delay, flights: f, gone, tar, labels, coils: coilsBefore,
      duration: delay + Math.max(...f.map(x => x.duration)) + FADE_MS, sounds: sounds.filter(Boolean) });
    const cleared = this.afterPull(cells, gone);
    for (let i = 0; i < fills; i++) this.scenes.push({ kind: 'cache', cells: cleared, coils: 20, duration: CACHE_FILL_MS, sounds: ['cache_fill'] });
    this.scenes.push({ kind: 'refill', cells: cleared, gone, coils: b.cache, duration: REFILL_MS,
      sounds: ['cache_increase', ...(specials.length ? ['special_piece'] : []), ...(pull.isolates.size || pull.tarEarned ? ['tar_slurp'] : [])] });
    this.levelPieces += pieces;
    if (this.settings.mode !== 'create' && this.levelPieces >= this.levelTarget && !this.pendingLevel) {
      this.pendingLevel = true;
      this.scenes.push({ kind: 'level', cells: b.pieces.map(r => [...r]), coils: b.cache, duration: LEVEL_MS, sounds: ['board_cleared'],
        labels: [{ text: 'Board cleared!', size: gameFont(2), at: [225, 300] }] });
    }
    return true;
  }
  private afterPull(cells: number[][], gone: Set<string>): number[][] {
    return cells.map((r, y) => r.map((v, x) => gone.has(`${x},${y}`) ? EMPTY : v));
  }
  /** Specials among the pieces that refilled the cleared spaces, counted by kind. */
  private newSpecials(gone: Set<string>): number[] {
    const found: number[] = [];
    for (const k of gone) {
      const [x, y] = k.split(',').map(Number), v = this.board.pieces[y][x];
      if (v === WILD) this.earned.wild++;
      else if (v === TAR) this.earned.tar++;
      else if (v === GAFF) this.earned.gaff++;
      else if (isLink(v)) this.earned.splice++;
      else continue;
      found.push(v);
    }
    return found;
  }

  step(delta: number): void {
    if (!this.scenes.length) return;
    this.sceneElapsed += delta;
    while (this.scenes.length && this.sceneElapsed >= this.scenes[0].duration) {
      const done = this.scenes.shift()!;
      this.sceneElapsed -= done.duration;
      if (done.kind === 'level') this.newBoard();
    }
    if (!this.scenes.length) this.sceneElapsed = 0;
  }
  get creating(): boolean { return this.settings.mode === 'create'; }
  /** Freeplay mode: puts a piece on a space. Returns false when nothing changed. */
  paint(p: Point, piece: number): boolean {
    if (!this.creating || this.busy || !validPiece(piece) || p.y < 0 || p.y >= ROWS || p.x < 0 || p.x >= rowSize(p.y)) return false;
    if (this.board.get(p) === piece) return false;
    this.preview = null; this.selecting = false;
    this.board.set(p, piece);
    return true;
  }
  /** Freeplay mode: the whole board one piece. */
  fill(piece: number): void {
    if (!this.creating || this.busy || !validPiece(piece)) return;
    this.preview = null; this.selecting = false;
    this.board.pieces = this.board.pieces.map(r => r.map(() => piece));
  }
  /** Freeplay mode: a board from its text, with its active pulley. */
  load(code: string): boolean {
    const read = readBoardCode(code);
    if (!this.creating || this.busy || !read) return false;
    this.preview = null; this.selecting = false;
    let i = 0;
    this.board.pieces = this.board.pieces.map(r => r.map(() => read.cells[i++]));
    this.board.nextPulley = read.pulley;
    this.board.skipped = read.skipped;
    return true;
  }
  /** Freeplay mode: makes the next pulley the active one. */
  nextPulley(): void { this.setPulley((this.board.nextPulley + 1) % PULLEYS.length); }
  /** Freeplay mode: makes a pulley (0–5, clockwise from the top) the active one. */
  setPulley(i: number): void {
    if (!this.creating || this.busy || !Number.isInteger(i) || i < 0 || i >= PULLEYS.length) return;
    this.board.nextPulley = i;
  }
  /** Freeplay mode: the turns since the last clear; at the last one a missed pull costs coils. */
  setBooching(turns: number): void {
    if (!this.creating || this.busy || !Number.isInteger(turns) || turns < 0 || turns >= SKIPS_FOR_PENALTY) return;
    this.board.skipped = turns;
  }
  /** Freeplay mode: a fresh random board (the next in this session's seed sequence). */
  generate(): void {
    if (!this.creating || this.busy) return;
    this.preview = null; this.selecting = false;
    this.boardNumber++; this.board = this.deal();
  }
  private newBoard(): void {
    this.levels++; this.levelPieces = 0; this.pendingLevel = false;
    this.boardNumber++; this.board = this.deal();
  }
  /** Completes every queued animation at once (used for replays and tests). */
  settle(): void { while (this.scenes.length) this.step(this.scenes[0].duration - this.sceneElapsed); }
}
