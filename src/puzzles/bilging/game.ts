import {
  BONUS_SETS, BilgeBoard, BilgeScore, COLOR_COUNT, CRAB, CRAB_PROB, EMPTY, HEIGHT, JELLY, JELLY_PROB, LEVEL_POINTS, PUFFER, PUFFER_PROB, WIDTH,
  runCells, token, type, type Cell, type Rise, type Run,
} from './board';

export interface BilgingSettings {
  difficulty: number;
  tokens: number;
  /** Rows under water, counted from the bottom (3–9). */
  water: number;
  timerMs: number;
  indicatorMax: number;
  /** Normal plays the duty puzzle; Freeplay lets you paint the board and never levels up. */
  mode: Mode;
}
export type Mode = 'normal' | 'create';
export const DEFAULT_SETTINGS: BilgingSettings = { difficulty: 5, tokens: 1, water: 3, timerMs: 0, indicatorMax: 8.4, mode: 'normal' };
export const WATER_LEVELS = [3, 4, 5, 6, 7, 8, 9];
export const DEFAULT_LEVELS = [0, 2.4, 3, 3.6, 3.6, 4.2, 4.2, 4.2, 4.8, 4.8, 5.4, 5.4, 5.4, 6, 6, 6.6, 6.6, 7.2, 7.8, 8.4];
export function indicatorStep(value: number, max = 8.4): number {
  const i = DEFAULT_LEVELS.findIndex(n => value <= n * max / 8.4);
  return i === -1 ? 20 : i;
}
export function readSettings(value: unknown): BilgingSettings | null {
  if (!value || typeof value !== 'object') return null;
  // Settings saved before Freeplay mode existed are Normal.
  const s = { mode: 'normal', ...value } as BilgingSettings;
  return ['normal', 'create'].includes(s.mode) && Number.isInteger(s.difficulty) && s.difficulty >= 0 && s.difficulty <= 9 && [0, 1, 2].includes(s.tokens) &&
    WATER_LEVELS.includes(s.water) && [0, 120000, 300000, 600000].includes(s.timerMs) &&
    Number.isFinite(s.indicatorMax) && s.indicatorMax >= 1 && s.indicatorMax <= 1000 ? { ...s } : null;
}
export const settingsKey = (s: BilgingSettings) => `d${s.difficulty}-t${s.tokens}-w${s.water}-${s.timerMs}-i${s.indicatorMax}`;

/** Every piece Freeplay mode can paint: the seven colours, then puffer, crab and jellyfish. */
export const PAINTABLE = [0, 1, 2, 3, 4, 5, 6, PUFFER, CRAB, JELLY];
/** A colour with a token half: half 0 is the lower half, 1 the upper. */
export const withToken = (piece: number, shape: number, upper: number) => piece < PUFFER && shape ? piece | upper << 4 | shape << 5 : piece;
const validPiece = (v: number) => PAINTABLE.includes(type(v)) && (v < 16 || type(v) < PUFFER && BONUS_SETS[2].includes(token(v)) && v < 256);
/** A board as text: B, then each piece as two hex digits, bottom row first. */
export function boardCode(board: BilgeBoard): string {
  return 'B' + board.cells.map(v => v.toString(16).padStart(2, '0')).join('');
}
export function readBoardCode(text: string): number[] | null {
  const m = new RegExp(`^B((?:[0-9a-f]{2}){${WIDTH * HEIGHT}})$`, 'i').exec(text.trim());
  if (!m) return null;
  const cells = m[1].match(/../g)!.map(h => parseInt(h, 16));
  return cells.every(validPiece) ? cells : null;
}
/** Ways a painted board differs from one the game could deal at these settings. */
export function boardIssues(board: BilgeBoard, s: BilgingSettings): string[] {
  const issues: string[] = [], d = s.difficulty, cells = board.cells.map(type);
  if (board.runs(false).length) issues.push('A line of three or more is on the board; the game clears those before you can swap.');
  if (cells.some(t => t >= COLOR_COUNT[d] && t < PUFFER)) issues.push(`Difficulty ${d} deals only the first ${COLOR_COUNT[d]} colours.`);
  if (!PUFFER_PROB[d] && cells.includes(PUFFER)) issues.push('Puffers appear from difficulty 2.');
  if (!CRAB_PROB[d] && cells.includes(CRAB)) issues.push('Crabs appear from difficulty 4.');
  if (!JELLY_PROB[d] && cells.includes(JELLY)) issues.push('Jellyfish appear from difficulty 5.');
  if (cells.some((t, i) => t === CRAB && Math.floor(i / WIDTH) >= s.water)) issues.push('A crab is above the water; it would already have been pumped out.');
  const tokens = board.cells.map(token).filter(Boolean);
  if (tokens.length && !s.tokens) issues.push('Token pieces only appear with Tokens on.');
  else if (tokens.some(t => !BONUS_SETS[s.tokens].includes(t))) issues.push('Flower tokens need Tokens set to 5 Tokens.');
  if (board.completedToken()) issues.push('A token is already complete; the game would count it before you can swap.');
  return issues;
}

/** Pieces rise at 1.5 times the 0.35 px/ms drop rate: 45 px rows. */
export const riseDuration = (rows: number) => rows * 45 / 0.525;
export const SWAP_DRY_MS = 250, SWAP_WET_MS = 450, FADE_MS = 250, PUFFER_BURST_MS = 450, PUFFER_MS = 1175, JELLY_MS = 667;
export const TOKEN_MS = 300, LEVEL_UP_MS = 2000;
export const crabDuration = (x: number) => 5 * (x < WIDTH / 2 ? 45 * x + 45 : 45 * (WIDTH - x));

export type SceneKind = 'swap' | 'clear' | 'rise' | 'token' | 'crabs' | 'puffer' | 'jelly' | 'level';
export interface Scene {
  kind: SceneKind;
  /** The board as it looks when the scene starts. */
  cells: number[];
  duration: number;
  swap?: { x: number; y: number };
  cleared?: Cell[];
  rises?: Rise[];
  at?: { x: number; y: number };
  token?: number;
  label?: string;
  points?: number;
  sound?: string;
  /** Chain step reached by this clear. */
  chain?: number;
}

/** Eighteen ten-second intervals; idle intervals count as one unproductive move. */
export class Performance {
  private buckets = Array.from({ length: 18 }, () => ({ points: 0, moves: 0 }));
  private slot = 0;
  private time = 0;
  advance(ms: number): void {
    while (this.time + 10000 <= ms) {
      if (!this.buckets[this.slot].moves) this.buckets[this.slot].moves = 1;
      this.time += 10000; this.slot = (this.slot + 1) % 18; this.buckets[this.slot] = { points: 0, moves: 0 };
    }
  }
  add(points: number, moves: number): void { this.buckets[this.slot].points += points; this.buckets[this.slot].moves += moves; }
  get value(): number {
    const moves = this.buckets.reduce((n, b) => n + b.moves, 0);
    return moves ? Math.max(0, this.buckets.reduce((n, b) => n + b.points, 0) / moves) : 0;
  }
}

function runLabel(runs: readonly Run[]): { label: string | undefined; sound: string } {
  const lengths = runs.map(r => r.length);
  if (runs.length === 1) {
    const n = lengths[0];
    return n > 3 ? { label: n === 4 ? 'Good' : 'Great', sound: n === 4 ? 'piece_destroy_good' : 'piece_destroy_great' } : { label: undefined, sound: 'piece_destroy' };
  }
  if (runs.length === 2) {
    const lo = Math.min(...lengths), hi = Math.max(...lengths);
    const cry = hi >= 5 ? 'Yarrr!' : lo === 4 ? 'Har!' : 'Arrr!';
    return { label: `${cry} ${Math.min(lo, 5)}x${Math.min(hi, 5)}!`, sound: hi === 5 ? 'piece_destroy_yarrr' : lo === 4 ? 'piece_destroy_har' : 'piece_destroy_arrr' };
  }
  if (runs.length === 3) return { label: 'Bingo!', sound: 'piece_destroy_bingo' };
  return Math.max(...lengths.slice(0, 4)) > 4 ? { label: 'Vegas!', sound: 'piece_destroy_vegas' } : { label: 'Sea Donkey!', sound: 'piece_destroy_sea_donkey' };
}

export interface MoveResult { points: number; chain: number; crabs: number; tokens: number[] }

export class BilgingGame {
  board: BilgeBoard;
  cursor = { x: 2, y: 10 };
  scenes: Scene[] = [];
  sceneElapsed = 0;
  points = 0;
  moves = 0;
  levels = 0;
  levelPoints = 0;
  crabs = 0;
  puffers = 0;
  jellies = 0;
  longestChain = 0;
  lastMove: MoveResult | null = null;
  tokenCounts = Array<number>(8).fill(0);
  performance = new Performance();
  private boardNumber = 0;
  private pendingPoints = 0;
  private pendingLevel = false;

  constructor(readonly settings: BilgingSettings, readonly seed: number) { this.board = this.deal(); }
  private deal(): BilgeBoard {
    // Fresh boards after a level-up use a deterministic practice seed sequence for portable replays.
    const seed = this.boardNumber ? (this.seed + Math.imul(this.boardNumber, 0x9e3779b9)) >>> 0 : this.seed;
    return new BilgeBoard(seed, this.settings.difficulty, this.settings.tokens);
  }
  get busy(): boolean { return this.scenes.length > 0; }
  get tokens(): number { return this.tokenCounts.reduce((a, b) => a + b, 0); }
  get efficiency(): number { return this.moves ? this.points / this.moves : 0; }
  get dry(): boolean { return this.cursor.y >= this.settings.water; }
  moveCursor(dx: number, dy: number): void {
    const x = Math.max(this.cursor.x + dx, 0), y = Math.max(this.cursor.y + dy, 0);
    if (x < WIDTH - 1 && y < HEIGHT) this.cursor = { x, y };
  }
  pointAt(x: number, y: number): void {
    this.cursor = { x: Math.max(0, Math.min(x, WIDTH - 2)), y: Math.max(0, Math.min(y, HEIGHT - 1)) };
  }
  private push(scene: Omit<Scene, 'cells'>): void { this.scenes.push({ ...scene, cells: [...this.board.cells] }); }
  private clear(cells: { x: number; y: number }[]): Cell[] {
    const out: Cell[] = [];
    for (const c of cells) {
      const piece = this.board.get(c.x, c.y);
      if (piece === EMPTY) continue;
      out.push({ ...c, piece }); this.board.set(c.x, c.y, EMPTY);
    }
    return out;
  }

  /** Swaps the pieces at the cursor and plays out the cascade. Returns false when the game refuses the swap. */
  swap(x = this.cursor.x, y = this.cursor.y): boolean | 'crab' {
    if (this.busy) return false;
    const b = this.board, water = this.settings.water, a = b.get(x, y), c = b.get(x + 1, y);
    if (a === CRAB || c === CRAB) return 'crab';
    if (a === EMPTY && c === EMPTY) return false;
    const duration = y >= water ? SWAP_DRY_MS : SWAP_WET_MS;
    if (a === c) { this.push({ kind: 'swap', swap: { x, y }, duration, sound: 'piece_swap' }); return true; }
    this.moves++; this.performance.add(0, 1);
    const score = new BilgeScore(), result: MoveResult = { points: 0, chain: 0, crabs: 0, tokens: [] };
    if (a === PUFFER || c === PUFFER) {
      const px = c === PUFFER ? x + 1 : x;
      this.push({ kind: 'puffer', at: { x: px, y }, duration: PUFFER_BURST_MS, sound: 'pufferfish_destroy' });
      b.set(px, y, EMPTY);
      const area: { x: number; y: number }[] = [];
      for (let yy = Math.max(0, y - 1); yy <= Math.min(HEIGHT - 1, y + 1); yy++)
        for (let xx = Math.max(0, px - 1); xx <= Math.min(WIDTH - 1, px + 1); xx++) area.push({ x: xx, y: yy });
      const before = [...b.cells], cleared = this.clear(area), points = score.add(cleared.length);
      this.scenes.push({ kind: 'clear', cells: before, at: { x: px, y }, cleared, duration: PUFFER_MS - PUFFER_BURST_MS, points, chain: score.chain });
      this.puffers++;
    } else if (a !== JELLY && c !== JELLY) {
      this.push({ kind: 'swap', swap: { x, y }, duration, sound: 'piece_swap' });
      b.set(x, y, c); b.set(x + 1, y, a);
    } else {
      const jx = a === JELLY ? x : x + 1, ox = a === JELLY ? x + 1 : x;
      b.set(jx, y, EMPTY);
      const t = type(b.get(ox, y)), all: { x: number; y: number }[] = [];
      for (let xx = 0; xx < WIDTH; xx++) for (let yy = 0; yy < HEIGHT; yy++) if (type(b.get(xx, yy)) === t) all.push({ x: xx, y: yy });
      const before = [...b.cells]; before[y * WIDTH + jx] = JELLY;
      const cleared = this.clear(all), points = score.add(cleared.length);
      this.scenes.push({ kind: 'jelly', cells: before, at: { x: jx, y }, cleared, duration: JELLY_MS, label: 'Jelly fished!', points, sound: 'jellyfish_destroy', chain: score.chain });
      this.jellies++;
    }
    this.resolve(score, result);
    result.points = score.points; result.chain = score.chain;
    this.lastMove = result;
    this.longestChain = Math.max(this.longestChain, score.chain);
    this.pendingPoints = score.points;
    if (score.points > 0) {
      this.levelPoints += score.points;
      if (!this.creating && this.levelPoints >= LEVEL_POINTS[this.settings.difficulty]) {
        this.pendingLevel = true;
        this.push({ kind: 'level', duration: LEVEL_UP_MS, label: 'Great work!', sound: 'clear' });
      }
    }
    if (!this.scenes.length) this.finishMove();
    return true;
  }

  /** Tokens, rising pieces, crabs above water, then runs; each successful step starts the loop again. */
  private resolve(score: BilgeScore, result: MoveResult): void {
    const b = this.board, water = this.settings.water;
    for (let safety = 0; safety < 1000; safety++) {
      const done = b.completedToken();
      if (done) {
        this.push({ kind: 'token', at: { x: done.x, y: done.y }, token: done.piece, duration: TOKEN_MS });
        b.set(done.x, done.y, type(b.get(done.x, done.y))); b.set(done.x, done.y + 1, type(b.get(done.x, done.y + 1)));
        this.tokenCounts[done.piece]++; result.tokens.push(done.piece);
        continue;
      }
      const before = [...b.cells], rises = b.rise();
      if (rises.length) {
        this.scenes.push({ kind: 'rise', cells: before, rises, duration: riseDuration(Math.max(...rises.map(r => r.to - r.from))), sound: 'piece_land' });
        continue;
      }
      const crabs: { x: number; y: number }[] = [];
      for (let y = water; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) if (type(b.get(x, y)) === CRAB) crabs.push({ x, y });
      if (crabs.length) {
        const cells = [...b.cells], cleared = this.clear(crabs);
        let points = 0;
        for (let i = 0; i < cleared.length; i++) points += score.crab(water);
        this.crabs += cleared.length; result.crabs += cleared.length;
        this.scenes.push({ kind: 'crabs', cells, cleared, points, label: cleared.length === 1 ? 'Crab cleared!' : `${cleared.length} crabs cleared!`,
          duration: Math.max(...cleared.map(c => crabDuration(c.x))), sound: 'crab_scuttle' });
        continue;
      }
      const runs = b.runs(false);
      if (runs.length) {
        const first = !score.chain, cells = [...b.cells];
        const cleared = this.clear(runs.flatMap(runCells)), points = score.runs(runs, b.colors);
        const call = first ? runLabel(runs) : { label: score.chain === 2 ? 'Super!' : 'Bonus!', sound: score.chain === 2 ? 'piece_destroy_super' : 'piece_destroy_bonus' };
        this.scenes.push({ kind: 'clear', cells, cleared, duration: FADE_MS, points, chain: score.chain, ...call });
        continue;
      }
      break;
    }
  }

  step(delta: number): void {
    if (!this.scenes.length) return;
    this.sceneElapsed += delta;
    while (this.scenes.length && this.sceneElapsed >= this.scenes[0].duration) {
      const done = this.scenes.shift()!;
      this.sceneElapsed -= done.duration;
      if (done.kind === 'level') this.newBoard();
    }
    if (!this.scenes.length) { this.sceneElapsed = 0; this.finishMove(); }
  }
  get creating(): boolean { return this.settings.mode === 'create'; }
  /** Freeplay mode: puts a piece on a space. Returns false when nothing changed. */
  paint(x: number, y: number, piece: number): boolean {
    if (!this.creating || this.busy || !validPiece(piece) || x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT || this.board.get(x, y) === piece) return false;
    this.board.set(x, y, piece);
    return true;
  }
  /** Freeplay mode: the whole board one piece. */
  fill(piece: number): void {
    if (this.creating && !this.busy && validPiece(piece)) this.board.cells.fill(piece);
  }
  /** Freeplay mode: a board from its text. */
  load(code: string): boolean {
    const cells = readBoardCode(code);
    if (!this.creating || this.busy || !cells) return false;
    this.board.cells = cells;
    return true;
  }
  /** Freeplay mode: a fresh random board (the next in this session's seed sequence). */
  generate(): void {
    if (!this.creating || this.busy) return;
    this.boardNumber++; this.board = this.deal();
  }
  private newBoard(): void {
    this.levels++; this.levelPoints = 0; this.pendingLevel = false;
    this.boardNumber++; this.board = this.deal();
  }
  private finishMove(): void {
    this.points += this.pendingPoints; this.performance.add(this.pendingPoints, 0); this.pendingPoints = 0;
    if (this.pendingLevel) this.newBoard();
  }
  /** Completes every queued animation at once (used for replays and tests). */
  settle(): void { while (this.scenes.length) this.step(this.scenes[0].duration - this.sceneElapsed); }
}
