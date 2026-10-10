// Distilling presentation and practice controls: swaps, lit corners, furnace heat,
// column burns, vial fill and messages. Board rules live in logic.ts.
import { Images } from '../../core/assets';
import { SoundBank } from '../../core/audio';
import { copyText, pasteText } from '../../core/clipboard';
import { loadFont } from '../../core/fonts';
import { keyMatches } from '../../core/controls';
import { dutyDesk } from '../../core/duty/desk';
import type { RatingScale } from '../../core/duty/ratings';
import { columnOrbs } from './report';
import { historyGroup } from '../../core/history';
import { ReplayRecorder, type PuzzleReplay, type ReplaySettingsCodec } from '../../core/replay';
import { PyRandom } from '../../core/pyrandom';
import type { InputEvent, Point } from '../../core/input';
import type { PuzzleFactory } from '../../core/puzzle';
import type { GameRecord } from '../../core/storage';
import {
  convert_seed,
  type Board,
  emptyBoard,
  generate_board,
  generate_column,
  generate_seed,
  generate_seeded_column,
  get_create_seed,
  get_practice_board,
  get_practice_settings,
  import_board,
  next_random_seed,
  random as simRandom,
  type Seed,
  fromColumns,
  toBrewPiece,
  toColumns,
} from './boards';
import { practiceAvailable, practiceGroupNames, practiceNames } from './practice';
import {
  BrewBoard,
  BrewGame,
  BURNT,
  type GameOptions,
  TICK_MS,
  type ColumnResult,
  type FurnaceEvent,
  HEIGHT,
  LIGHT,
  MEDIUM,
  HEAVY,
  SPICE,
  vialLiquid,
  WIDTH as COLUMNS,
} from './logic';
import delarobbUrl from './delarobb.ttf?url';

const imageUrls = import.meta.glob<string>('./media/*.png', { eager: true, query: '?url', import: 'default' });
const soundUrls = import.meta.glob<string>('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' });
type Sound =
  | 'swap_up'
  | 'swap_down'
  | 'burn_warning'
  | 'burn'
  | 'burnt'
  | 'smooth'
  | 'blecch'
  | 'blecch2'
  | 'crystal_clear'
  | 'crystal_clear2'
  | 'spicy'
  | 'finished';

/** The board view sits at (25, 135) in the panel, 425x465 (BrewPanel.b). */
const VIEW_X = 25;
const VIEW_Y = 135;
const VIEW_W = 425;
const VIEW_H = 465;
/** Pieces are 40px; the top row is 23px down, and short columns sit half a piece lower (BrewBoardView.a, b). */
const CELL = 40;
const TOP = 23;
/** The furnace art in view coordinates (BrewBoardView.d, e, f, g). */
const FURNACE_X = 316;
const FURNACE_Y = 399;
const FURNACE_W = 109;
const FURNACE_H = 66;
/** Where a column leaves: up off the top, or down into the furnace, at the right column's x. */
const EXIT_X = 9 * CELL;
const EXIT_UP = -CELL;
const EXIT_DOWN = 416;
/** Leaving pieces move at 0.4 px/ms; swaps take 150 ms and the board's slide 900 ms. */
const EXIT_SPEED = 0.4;
const SWAP_MS = 150;
const SLIDE_MS = 900;
/** The vial (BrewIndicator) at (235, 55), 42x75. */
const VIAL_X = 235;
const VIAL_Y = 55;
const VIAL_W = 42;
const VIAL_H = 75;
/** Message fonts: size 1 for most, 0 for spice and burnt. */
const FONT_SIZES = [24, 30];
const FONT = 'Delarobb';
/** Floating messages drift 30px over 1.5 s, fading in the second half (nenya FloatingTextAnimation). */
const FLOAT_MS = 1500;
const FLOAT_PX = 30;

/** Cursor directions (BrewBoardView.b): 0 down-left, 2 up-left, 3 up, 4 up-right, 6 down-right, 7 down. */
const SW = 0;
const NW = 2;
const N = 3;
const NE = 4;
const SE = 6;
const S = 7;
/** Keys from the game's key map for Distilling, with the number pad both ways. */
const KEY_MOVES: Record<string, number> = {
  arrowleft: SW,
  '1': SW,
  '4': SW,
  end: SW,
  arrowright: NE,
  '9': NE,
  '6': NE,
  pageup: NE,
  arrowdown: S,
  '2': S,
  arrowup: N,
  '8': N,
  '3': SE,
  pagedown: SE,
  '7': NW,
  home: NW,
};
/**
 * The Distilling Simulator's modes: Standard (your spawn rates and timer), Seeded (replay a seed or a
 * recorded piece sequence), Create (paint any board; never ends) and Practice (set boards from practice.ts).
 */
type Mode = 'Standard' | 'Seeded' | 'Create' | 'Practice';
interface DistillingReplayState {
  format: 'distilling-replay-state';
  board: Board;
  simSeed: Seed;
  randomState: ReturnType<PyRandom['snapshot']>;
}

const MODES: { value: Mode; label: string }[] = [
  { value: 'Standard', label: 'Standard' },
  { value: 'Seeded', label: 'Seeded' },
  { value: 'Create', label: 'Create' },
  { value: 'Practice', label: 'Practice' },
];
/** Duty report ratings for Standard and Seeded: the score (points a column distilled). Practice and Create are Learning. */
const RATING_SCALES: RatingScale[] = [{ id: 'score', label: 'Score (points a column)', cutoffs: [1, 3, 5, 7, 9], step: 0.25 }];

/** The simulator's spawn weights, in its piece order: black, brown, burnt, spice, white. */
const DEFAULT_SPAWN = [10, 10, 0, 1, 10];
/** The simulator's spawn rate boxes, in the order it showed them. */
const SPAWN_BOXES: [number, string][] = [
  [0, 'Black'],
  [1, 'Brown'],
  [4, 'White'],
  [3, 'Spice'],
  [2, 'Burnt'],
];
/** Practice drills with a furnace interval this long have no timer. */
const TIMERLESS = 15000000;
/** Create mode paints with keys 1-5: black, brown, white, spice, burnt; the wheel cycles in that order. */
const PAINT_ORDER = [HEAVY, MEDIUM, LIGHT, SPICE, BURNT];

const MESSAGES = {
  clear: 'Crystal clear!',
  smooth: 'Smooooooth',
  blecch: 'Blecch!',
  burnt: 'Burnt!',
  spicy: 'Spicy!',
  wasted_spice: 'Wasted Spice',
  jug_filled: 'Finished!',
};

interface Path {
  points: Point[];
  /** Time each point is reached. */
  times: number[];
  /** Called as each point after the first is reached, with its index. */
  onNode?: (i: number) => void;
  onEnd?: () => void;
  /** Called if another path replaces this one before it ends (nenya's pathCancelled). */
  onCancel?: () => void;
  reached: number;
}

interface Piece {
  type: number;
  col: number;
  row: number;
  /** Corners lit for the directions it can swap. */
  mask: number;
  x: number;
  y: number;
  selected: boolean;
  path: Path | null;
}

interface Message {
  text: string;
  px: number;
  colour: string;
  x: number;
  y: number;
  w: number;
  h: number;
  start: number;
  down: boolean;
}

export default (async ({ screen, input, panel, store, ticks, setReplayTime }) => {
  const [images] = await Promise.all([Images.load(imageUrls), loadFont(FONT, delarobbUrl)]);
  const img = (name: string) => images.get(name);
  const sounds = new SoundBank<Sound>(soundUrls, () => replays?.isSeeking ?? false);
  const ctx = screen.ctx;

  const PIECE_SHEETS: Record<number, string> = { [LIGHT]: 'piece_white', [MEDIUM]: 'piece_mid', [HEAVY]: 'piece_dark', [BURNT]: 'piece_white_burnt' };
  /** Each piece type with each mask of lit corners, built from the two frames by quarters (BrewBoardView.b(byte, byte)). */
  const pieceCache = new Map<number, HTMLCanvasElement>();
  function pieceImage(type: number, mask: number): CanvasImageSource {
    if (type === SPICE) return img('piece_spice');
    const key = (type << 4) | mask;
    let canvas = pieceCache.get(key);
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = CELL;
      const c = canvas.getContext('2d')!;
      const sheet = img(PIECE_SHEETS[type]);
      const h = CELL / 2;
      // Quarter d lights when the piece can swap in direction d: top-right, top-left, bottom-left, bottom-right.
      const qx = [h, 0, 0, h];
      const qy = [0, 0, h, h];
      for (let q = 0; q < 4; q++) {
        const frame = mask & (1 << q) ? 1 : 0;
        c.drawImage(sheet, frame * CELL + qx[q], qy[q], h, h, qx[q], qy[q], h, h);
      }
      pieceCache.set(key, canvas);
    }
    return canvas;
  }

  let mode = store.get<Mode>('mode', 'Standard');
  if (!MODES.some((m) => m.value === mode)) mode = 'Standard';
  let timerOn = store.get<boolean>('timerOn', true);
  /** Create mode starts without a timer, as in the simulator. */
  let createTimerOn = store.get<boolean>('createTimerOn', false);
  let timerSeconds = store.get<number>('timerSeconds', (TICK_MS * 50) / 1000);
  let difficulty = store.get<number>('difficulty', 50);
  let spawnRates = store.get<number[]>('spawnRates', [...DEFAULT_SPAWN]);
  let practiceNum = store.get<number[]>('practiceNum', [0, 0]);
  /** The pasted seed: a simulator seed (Seeded) or a board seed (Create); blank for a random one. */
  let seedText = '';
  /** The seed to replay the last start, in the same form. */
  let lastSeed = '';
  /** The simulator's piece sequence and rng decider, used up as columns are made (boards.ts Seed). */
  let simSeed: Seed = ['', ''];
  /** The simulator's next random rng decider ("7" + 20 digits), counted up each start. */
  let randomSeed = generate_seed();
  let replays!: ReplayRecorder;
  let replayStartState: DistillingReplayState | null = null;
  let lastReplayState: DistillingReplayState | null = null;
  let paused = false;
  let startedMode: Mode = mode;
  /** A piece key (1-5) held down in Create mode paints the piece under the mouse. */
  let paintWith: number | null = null;
  let palettePiece: number | null = null;

  let game: BrewGame | null = null;
  let active = false;
  let running = false;
  let resultRows: string[][] | null = null;
  let pieces: Piece[][] = [];
  let leaving: Piece[] = [];
  let selected: Piece | null = null;
  let cursor = { col: 0, row: 0 };
  let dragMode = false;
  let dragSwapped = false;
  let mouseHeld = false;
  let lastMouse: Point = [-1, -1];
  /** Things the board waits on before taking input (BrewBoardView._waitCount). */
  let waitCount = 0;
  let swapCount = 0;
  let swaps = 0;
  let sessionStartedAt = 0;
  let sessionEndedAt: number | null = null;
  let sessionPausedAt: number | null = null;
  let sessionPausedMs = 0;
  let messages: Message[] = [];
  let timers: { at: number; run: () => void }[] = [];

  const later = (ms: number, run: () => void) => timers.push({ at: ticks() + ms, run });

  /** A piece's spot in view coordinates (BrewBoardView.c). */
  function spot(col: number, row: number): Point {
    const tall = game!.board.isTallColumn(col);
    return [col * CELL, TOP + row * CELL + (tall ? 0 : CELL / 2)];
  }

  function linePath(from: Point, to: Point, duration: number, onEnd?: () => void): Path {
    const now = ticks();
    return { points: [from, to], times: [now, now + duration], onEnd, reached: 0 };
  }

  /** A path through points at a steady speed (media/util/o with a velocity). */
  function speedPath(points: Point[], speed: number, onNode?: (i: number) => void, onEnd?: () => void): Path {
    const times = [ticks()];
    for (let i = 1; i < points.length; i++) {
      const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      times.push(times[i - 1] + d / speed);
    }
    return { points, times, onNode, onEnd, reached: 0 };
  }

  /** Starts a piece on a new path, cancelling any it was still on. */
  function setPath(p: Piece, path: Path): void {
    const old = p.path;
    p.path = path;
    old?.onCancel?.();
  }

  function stepPiece(p: Piece, now: number): void {
    const path = p.path;
    if (!path) return;
    while (path.reached < path.points.length - 1 && now >= path.times[path.reached + 1]) {
      path.reached++;
      if (path.reached < path.points.length - 1) path.onNode?.(path.reached);
    }
    if (path.reached >= path.points.length - 1) {
      [p.x, p.y] = path.points[path.points.length - 1];
      p.path = null;
      path.onEnd?.();
      return;
    }
    const i = path.reached;
    const t = (now - path.times[i]) / (path.times[i + 1] - path.times[i] || 1);
    p.x = Math.trunc(path.points[i][0] + (path.points[i + 1][0] - path.points[i][0]) * t);
    p.y = Math.trunc(path.points[i][1] + (path.points[i + 1][1] - path.points[i][1]) * t);
  }

  function makePiece(col: number, row: number, offscreen: boolean): Piece {
    const [x, y] = spot(col, row);
    return { type: game!.board.getPiece(col, row), col, row, mask: game!.board.swapMask(col, row), x: offscreen ? x - CELL : x, y, selected: false, path: null };
  }

  function makeColumn(col: number, offscreen: boolean): Piece[] {
    return game!.board.columns[col].map((_, row) => makePiece(col, row, offscreen));
  }

  const refreshMask = (p: Piece) => (p.mask = game!.board.swapMask(p.col, p.row));

  function waitFor(): () => void {
    waitCount++;
    return () => waitCount--;
  }

  // ---- Floating messages ----

  function measure(text: string, px: number): number {
    ctx.save();
    ctx.font = `${px}px "${FONT}"`;
    const w = ctx.measureText(text).width * 1.1;
    ctx.restore();
    return Math.ceil(w) + 4;
  }

  /** A message centred on the board, moved clear of others still showing (BrewBoardView.a(String,...)). */
  function say(text: string, opts: { orange?: boolean; down?: boolean; wait?: boolean } = {}): Message {
    const px = FONT_SIZES[opts.orange || opts.down ? 0 : 1];
    const w = measure(text, px);
    const h = Math.round(px * 1.2);
    let y = (VIEW_H - h) / 2;
    const now = ticks();
    for (const m of messages) {
      const my = messageY(m, now);
      if (y < my + m.h && my < y + h) y = my + m.h;
    }
    const message: Message = { text, px, colour: opts.orange ? '#ffc800' : '#fff', x: (VIEW_W - w) / 2, y, w, h, start: now, down: !!opts.down };
    messages.push(message);
    if (opts.wait) later(FLOAT_MS, waitFor());
    return message;
  }

  /** The Crystal Clear streak number, at the message's top-right corner (BrewBoardView.a(String, Animation)). */
  function sayBeside(text: string, beside: Message): void {
    const px = FONT_SIZES[0];
    messages.push({ text, px, colour: '#fff', x: beside.x + beside.w, y: beside.y - 6, w: measure(text, px), h: Math.round(px * 1.2), start: ticks(), down: false });
  }

  function messageY(m: Message, now: number): number {
    const t = Math.min(1, (now - m.start) / FLOAT_MS);
    return m.y + (m.down ? 1 : -1) * Math.trunc(FLOAT_PX * t);
  }

  function drawMessages(now: number): void {
    messages = messages.filter((m) => now < m.start + FLOAT_MS);
    for (const m of messages) {
      const t = (now - m.start) / FLOAT_MS;
      ctx.save();
      ctx.globalAlpha = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2);
      ctx.translate(VIEW_X + m.x + m.w / 2, VIEW_Y + messageY(m, now) + m.px);
      ctx.scale(1.1, 1);
      ctx.font = `${m.px}px "${FONT}"`;
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(m.text, 0, 0);
      ctx.fillStyle = m.colour;
      ctx.fillText(m.text, 0, 0);
      ctx.restore();
    }
  }

  const playLater = (name: Sound, ms: number) => later(ms, () => sounds.play(name));
  const pick = <T,>(a: T, b: T) => (Math.random() < 0.5 ? a : b);

  // ---- The game ----

  /** The settings this start runs with: Practice brings its own (practice.ts). */
  function runSettings(): { spawn: number[]; difficulty: number; interval: number | null } {
    if (mode === 'Practice') {
      const [spawn, interval, diff] = get_practice_settings(practiceNum);
      return { spawn, difficulty: diff, interval: interval >= TIMERLESS ? null : interval };
    }
    const timed = mode === 'Create' ? createTimerOn : timerOn;
    return { spawn: [...spawnRates], difficulty, interval: timed ? Math.round(timerSeconds * 1000) : null };
  }

  /** A new game on a simulator board, played in the game's rules. */
  function newGame(now = ticks()): BrewGame {
    const run = runSettings();
    const options: GameOptions = { tickMs: run.interval ? run.interval / 50 : TICK_MS, timerless: run.interval === null, endless: mode === 'Create' };
    const boardSeed = BigInt.asIntN(64, BigInt(Math.floor(Math.random() * 2 ** 48)));
    const text = seedText.trim();
    // The simulator's modes. A seed is [piece sequence, rng decider] (boards.ts convert_seed).
    let board: Board;
    if (replayStartState) {
      const snapshot = replayStartState;
      replayStartState = null;
      board = snapshot.board.map((column) => [...column]);
      simSeed = [...snapshot.simSeed];
      if (!simRandom.restore(snapshot.randomState)) throw new Error('Invalid Distilling replay state');
      lastSeed = '';
    } else if (mode === 'Seeded' || mode === 'Create') {
      simSeed = /^[0-9]+$/.test(text) ? convert_seed(text) : ['', ''];
      if (simSeed[1] === '') {
        simSeed[1] = randomSeed.slice(1);
        randomSeed = next_random_seed(randomSeed);
      }
      const sequence = simSeed[0];
      lastSeed = sequence + '7' + simSeed[1];
      simRandom.seed(simSeed[1]);
      if (sequence !== '') [board, simSeed] = import_board(simSeed);
      else [board, simSeed] = generate_board(emptyBoard(), run.spawn, 8, run.difficulty, simSeed);
    } else {
      simSeed = ['', randomSeed.slice(1)];
      randomSeed = next_random_seed(randomSeed);
      lastSeed = '7' + simSeed[1];
      simRandom.seed(simSeed[1]);
      if (mode === 'Practice') [board, simSeed] = get_practice_board(emptyBoard(), practiceNum, run.spawn, run.difficulty, simSeed);
      else [board, simSeed] = generate_board(emptyBoard(), run.spawn, 8, run.difficulty, simSeed);
    }
    lastReplayState = {
      format: 'distilling-replay-state',
      board: board.map((column) => [...column]),
      // Keep the remaining custom piece sequence, but discard the native decimal seed.
      // The PRNG state below is replay-only and cannot be pasted into the game seed field.
      simSeed: [simSeed[0], ''],
      randomState: simRandom.snapshot(),
    };
    const brew = BrewBoard.withColumns(toColumns(board), boardSeed);
    // New columns: the rest of a seeded piece sequence, then the spawn rates (activate_furnace).
    const seeded = mode === 'Seeded';
    brew.makeColumn = (tall) => {
      const height = tall ? HEIGHT : HEIGHT - 1;
      let column: number[];
      if (seeded) [column, simSeed] = generate_seeded_column(run.spawn, run.difficulty, simSeed, height);
      else [column, simSeed] = generate_column(run.spawn, run.difficulty, simSeed);
      return column.filter((p) => p !== -1).slice(0, height).map(toBrewPiece);
    };
    return new BrewGame(brew, now, options);
  }

  function start(): void {
    const now = ticks();
    swaps = 0;
    sessionStartedAt = now;
    sessionEndedAt = sessionPausedAt = null;
    sessionPausedMs = 0;
    resultRows = null;
    duty.clear();
    game = newGame(now);
    replays.begin({ mode, timerOn, createTimerOn, timerSeconds, difficulty, spawnRates: [...spawnRates], practiceNum: [...practiceNum] }, lastReplayState, now);
    startedMode = mode;
    paused = false;
    paintWith = null;
    palettePiece = null;
    pieces = [];
    for (let col = 0; col < COLUMNS; col++) pieces.push(makeColumn(col, false));
    leaving = [];
    selected = null;
    cursor = { col: 0, row: 0 };
    lastMouse = [-1, -1];
    mouseHeld = false;
    dragMode = dragSwapped = false;
    waitCount = swapCount = 0;
    messages = [];
    timers = [];
    active = true;
    running = true;
  }

  function stop(completed = false): void {
    if (!running || !game) return;
    sessionEndedAt = ticks();
    resultRows = makeResultRows();
    if (completed) saveCompletedSession();
    else replays.finish(`Score ${sessionScore().toFixed(2)}`, endReport());
    game.finished = true;
    game.burnDue = false;
    running = false;
    paused = false;
    active = false;
    pieces = [];
    leaving = [];
    selected = null;
    messages = [];
    timers = [];
  }

  /** Dismissing keeps the score already earned; it never processes the remaining column. */
  function dismiss(): void {
    if (!running) return;
    replays.command('dismiss');
    stop(true);
  }

  /** The player's turn is live: the session's on and nothing is sliding (PuzzleController.S, view.s). */
  const playing = () => running && !!game && !game.finished && !paused;

  function togglePause(): void {
    if (!running || !game) return;
    const now = ticks();
    paused = !paused;
    if (paused) {
      sessionPausedAt = now;
      game.pause(now);
    } else {
      sessionPausedMs += now - (sessionPausedAt ?? now);
      sessionPausedAt = null;
      game.resume(now);
    }
  }

  /** Create mode: change the piece under the mouse (the simulator's modify_piece). */
  function paint(pos: Point, type: number | ((old: number) => number)): void {
    if (!game || !running || !inView(pos) || waitCount) return;
    hover(pos);
    const p = pieces[cursor.col]?.[cursor.row];
    if (!p || p.path) return;
    const next = typeof type === 'number' ? type : type(p.type);
    if (next === p.type) return;
    game.board.columns[p.col][p.row] = next;
    p.type = next;
    refreshMask(p);
    for (let dir = 0; dir < 4; dir++) {
      const n = game.board.neighbour(p.col, p.row, dir);
      if (n) refreshMask(pieces[n[0]][n[1]]);
    }
  }

  /** Create mode: the whole board one piece (the simulator's middle-click on its palette). */
  function fillBoard(type: number): void {
    if (!game || !running || waitCount) return;
    game.board.columns = game.board.columns.map((c) => c.map(() => type));
    for (const p of pieces.flat()) p.type = type;
    for (const p of pieces.flat()) refreshMask(p);
  }
  const settled = () => waitCount === 0;

  function setSelected(p: Piece | null): void {
    if (selected) selected.selected = false;
    selected = p;
    if (p) p.selected = true;
  }

  /** Select a piece, or swap the selected one with the piece under the cursor (BrewBoardView.t). */
  function selOrSwap(): void {
    if (!playing() || !settled()) return;
    const piece = pieces[cursor.col]?.[cursor.row];
    if (!piece) return;
    if (!selected) {
      if (!dragMode && piece.mask) setSelected(piece);
    } else if (selected === piece) {
      if (!dragMode) setSelected(null);
    } else if (game!.board.swap(piece.col, piece.row, selected.col, selected.row)) {
      animateSwap(piece, selected);
      if (dragMode) dragSwapped = true;
      else setSelected(null);
    } else if (!dragMode && piece.mask) setSelected(piece);
  }

  /** Two pieces trade places over 150 ms (BrewBoardView.a(j, j)). */
  function animateSwap(a: Piece, b: Piece): void {
    swaps++;
    const pa = spot(a.col, a.row);
    const pb = spot(b.col, b.row);
    sounds.play(pa[1] > pb[1] ? 'swap_down' : 'swap_up');
    const done = dragMode ? null : waitFor();
    // A piece dragged on before its last swap landed changes course: the old move is cancelled,
    // which counts it off without settling the board.
    const swapPath = (p: Piece, to: Point, onEnd: () => void): Path => ({
      ...linePath([p.x, p.y], to, SWAP_MS, onEnd),
      onCancel: () => {
        if (p === a) done?.();
        swapCount--;
      },
    });
    setPath(a, swapPath(a, pb, () => {
      done?.();
      swapEnded(a);
    }));
    setPath(b, swapPath(b, pa, () => swapEnded(b)));
    beginSwap(a);
    beginSwap(b);
    const [ac, ar] = [a.col, a.row];
    pieces[ac][ar] = b;
    pieces[b.col][b.row] = a;
    a.col = b.col;
    a.row = b.row;
    b.col = ac;
    b.row = ar;
  }

  /** A piece starts moving: its corners go dark, and so do its neighbours' corners facing it. */
  function beginSwap(p: Piece): void {
    game!.setSettled(false);
    swapCount++;
    p.mask = 0;
    for (let dir = 0; dir < 4; dir++) {
      const n = game!.board.neighbour(p.col, p.row, dir);
      if (n) pieces[n[0]][n[1]].mask &= ~(1 << ((dir + 2) % 4));
    }
  }

  /** A swap lands: relight it and its resting neighbours, and let a due burn go once all swaps are done. */
  function swapEnded(p: Piece): void {
    refreshMask(p);
    for (let dir = 0; dir < 4; dir++) {
      const n = game!.board.neighbour(p.col, p.row, dir);
      if (n && !pieces[n[0]][n[1]].path) refreshMask(pieces[n[0]][n[1]]);
    }
    swapCount--;
    if (swapCount === 0) handle(game!.setSettled(true));
  }

  function handle(events: FurnaceEvent[]): void {
    for (const event of events) {
      if (event.type === 'warning') sounds.play('burn_warning');
      else burn(event.result, event.finished);
    }
  }

  /** The right column leaves and the board slides right (BrewBoardView.d, e), then the messages (BrewController.a(boolean, int[])). */
  function burn(result: ColumnResult, finished: boolean): void {
    // The column leaves: up into the jug, or down into the furnace, where whites burn and roll back left.
    for (const p of pieces[COLUMNS - 1]) {
      p.mask = 0;
      if (p === selected) setSelected(null);
      const burning = !result.distilled && p.type === LIGHT;
      const exitY = result.distilled ? EXIT_UP : EXIT_DOWN;
      const points: Point[] = [[p.x, p.y], [EXIT_X, exitY]];
      if (burning) points.push([-CELL, exitY]);
      p.path = speedPath(
        points,
        EXIT_SPEED,
        () => {
          if (!burning) return;
          sounds.play('burnt');
          p.type = BURNT;
        },
        () => (leaving = leaving.filter((q) => q !== p)),
      );
      leaving.push(p);
    }
    pieces.pop();
    pieces.unshift(makeColumn(0, true));
    for (let col = 0; col < COLUMNS; col++) {
      for (const p of pieces[col]) {
        p.col = col;
        p.path = linePath([p.x, p.y], spot(col, p.row), SLIDE_MS);
        if (col === 1 || col === COLUMNS - 1) refreshMask(p);
      }
    }
    const slid = waitFor();
    const first = pieces[0][0];
    const prevEnd = first.path!.onEnd;
    first.path!.onEnd = () => {
      prevEnd?.();
      slid();
    };
    cursor.row++;
    moveCursor(N);

    // Sounds and messages.
    sounds.play('burn');
    let delay = 1350;
    if (result.verdict === 'clear') {
      playLater(pick('crystal_clear', 'crystal_clear2'), delay);
      delay += 1070;
      const m = say(MESSAGES.clear);
      if (result.bonus) sayBeside(String(1 + result.bonus / 4), m);
    } else if (result.verdict === 'smooth') {
      playLater('smooth', delay);
      delay += 1750;
      say(MESSAGES.smooth);
    } else if (result.verdict === 'blecch') {
      playLater(pick('blecch', 'blecch2'), delay);
      delay += 600;
      say(MESSAGES.blecch);
    } else if (result.verdict === 'burnt') say(MESSAGES.burnt, { down: true });
    if (result.spice === 'spicy') {
      playLater('spicy', delay);
      say(MESSAGES.spicy, { orange: true });
    } else if (result.spice === 'wasted_spice') say(MESSAGES.wasted_spice, { orange: true, down: true });

    if (finished) finish();
  }

  /** The jug is full (BrewController.s): "Finished!" holds the board, then it clears. */
  function finish(): void {
    if (!running || !game) return;
    sessionEndedAt = ticks();
    resultRows = makeResultRows();
    saveCompletedSession();
    say(MESSAGES.jug_filled, { wait: true });
    sounds.play('finished');
    running = false;
    paused = false;
    later(FLOAT_MS, () => (active = false));
  }

  /** The session's duty report: the columns sent up, rated by the score in Standard and Seeded. */
  function endReport() {
    const rated = startedMode === 'Standard' || startedMode === 'Seeded';
    if (!rated) return null;
    return duty.end({
      mode: startedMode,
      performance: duty.rate(rated ? 'score' : null, rated ? sessionScore() : null),
      score: { label: 'Score', value: sessionScore().toFixed(2) },
      cleared: [{ label: 'Columns Sent Up', style: 'row', items: columnOrbs(game?.columns ?? []) }],
    });
  }

  function saveCompletedSession(): void {
    const key = historyKey(startedMode);
    const report = endReport();
    const finishedReplay = replays.finish(`Score ${sessionScore().toFixed(2)}`, report);
    if (key && game && !replays.isPlaying) store.addHistory(key, {
      score: Number(sessionScore().toFixed(2)),
      swaps,
      activeMs: sessionActiveMs(),
      ...duty.fields(report),
      ...(finishedReplay ? { replayAt: finishedReplay.at, replayId: finishedReplay.runId ?? ''} : {}),
    });
  }

  function burnNow(): void {
    // BrewController "endCol": only while nothing is sliding.
    if (!playing() || !settled()) return;
    handle(game!.burnNow(ticks()));
  }

  /** Moves the cursor one hex (BrewBoardView.b). */
  function moveCursor(dir: number): void {
    if (!game) return;
    const tall = game.board.isTallColumn(cursor.col);
    let dx = 0;
    let dy = 0;
    switch (dir) {
      case SW:
        dx = -1;
        dy = tall && cursor.col !== 0 ? 0 : 1;
        break;
      case NW:
        dx = -1;
        dy = !tall && cursor.col !== 0 ? 0 : -1;
        break;
      case N:
        dy = -1;
        break;
      case NE:
        dx = 1;
        dy = !tall && cursor.col !== COLUMNS - 1 ? 0 : -1;
        break;
      case SE:
        dx = 1;
        dy = tall && cursor.col !== COLUMNS - 1 ? 0 : 1;
        break;
      case S:
        dy = 1;
        break;
      default:
        return;
    }
    const col = Math.max(0, Math.min(COLUMNS - 1, cursor.col + dx));
    const maxRow = HEIGHT - (game.board.isTallColumn(col) ? 1 : 2);
    cursor = { col, row: Math.max(0, Math.min(maxRow, cursor.row + dy)) };
  }

  /** The cursor follows the mouse; while dragging, only near a piece's centre (BrewBoardView.a(Point)). */
  function hover(pos: Point): void {
    if (!game) return;
    const vx = pos[0] - VIEW_X;
    const vy = pos[1] - VIEW_Y;
    const col = Math.max(0, Math.min(COLUMNS - 1, Math.trunc(vx / CELL)));
    const tall = game.board.isTallColumn(col);
    const row = Math.min(HEIGHT - (tall ? 1 : 2), Math.trunc(Math.max(0, vy - TOP - (tall ? 0 : CELL / 2)) / CELL));
    if (dragMode) {
      const [sx, sy] = spot(col, row);
      if (Math.hypot(vx - (sx + CELL / 2), vy - (sy + CELL / 2)) > CELL / 2 - 1) return;
    }
    cursor = { col, row };
  }

  const inView = (pos: Point) => pos[0] >= VIEW_X && pos[0] < VIEW_X + VIEW_W && pos[1] >= VIEW_Y && pos[1] < VIEW_Y + VIEW_H;
  const isBurnButton = (button: number) => button === 3;

  // ---- Drawing ----

  function drawFurnace(): void {
    const level = game ? game.furnaceLevel() : 59;
    const x = VIEW_X + FURNACE_X;
    const y = VIEW_Y + FURNACE_Y;
    ctx.drawImage(img('furnace'), 0, 0, FURNACE_W, level, x, y, FURNACE_W, level);
    ctx.drawImage(img('furnace_hot'), 0, level, FURNACE_W, FURNACE_H - level, x, y + level, FURNACE_W, FURNACE_H - level);
  }

  function drawVial(): void {
    screen.blit(img('vial_back_dark'), VIAL_X, VIAL_Y);
    if (game && game.distilled > 0) {
      const liquid = vialLiquid(game.distilled, game.jugLights, game.jugHeavies);
      const top = VIAL_H - Math.round(liquid.level * VIAL_H);
      ctx.save();
      ctx.globalAlpha = liquid.alpha;
      ctx.fillStyle = hsb(liquid.hue, liquid.sat, liquid.bri);
      ctx.fillRect(VIAL_X, VIAL_Y + top, VIAL_W, VIAL_H - top);
      ctx.restore();
      ctx.fillStyle = '#fff';
      if (top === 0) ctx.fillRect(VIAL_X, VIAL_Y, VIAL_W, 1);
      else ctx.fillRect(VIAL_X, VIAL_Y + top - 1, VIAL_W, 2);
    }
    screen.blit(img('glass'), VIAL_X, VIAL_Y);
  }

  function drawPieces(): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(VIEW_X, VIEW_Y, VIEW_W, VIEW_H);
    ctx.clip();
    for (const p of [...pieces.flat(), ...leaving]) {
      if (p.selected) ctx.drawImage(img('selected_glow'), VIEW_X + p.x, VIEW_Y + p.y);
      ctx.drawImage(pieceImage(p.type, p.mask), VIEW_X + p.x, VIEW_Y + p.y);
    }
    ctx.restore();
  }

  function frame(events: InputEvent[]): void {
    const routed = replays.frame(events, input.mouse, ticks());
    events = routed.events;
    input.mouse = routed.mouse;
    const now = ticks();
    if (!routed.renderOnly) {
      for (const command of routed.commands) {
        if (command === 'pause') togglePause();
        else if (command === 'dismiss') dismiss();
      }
      const creating = running && startedMode === 'Create';
      for (const event of events) {
        if (event.type === 'mousedown' && event.button <= 3) {
          if (!inView(event.pos)) continue;
          if (creating && palettePiece !== null && event.button === 1) {
            paint(event.pos, palettePiece);
            mouseHeld = true;
            continue;
          }
          hover(event.pos);
          if (isBurnButton(event.button)) burnNow();
          else {
            selOrSwap();
            dragMode = true;
            mouseHeld = true;
          }
        } else if (event.type === 'mousedown' && creating) {
          // The wheel changes the piece under the mouse in Create mode.
          const step = event.button === 4 ? 1 : -1;
          paint(event.pos, (old) => PAINT_ORDER[(PAINT_ORDER.indexOf(old) + step + PAINT_ORDER.length) % PAINT_ORDER.length]);
        } else if (event.type === 'mouseup' && event.button <= 3) {
          if (isBurnButton(event.button)) continue;
          if (dragSwapped && selected) setSelected(null);
          dragMode = dragSwapped = mouseHeld = false;
        } else if (event.type === 'keydown') {
          const paintKeys = ['1', '2', '3', '4', '5'];
          const paintKey = creating ? paintKeys.findIndex((_, i) => keyMatches(event.key, 'distilling', `paint${i + 1}`, paintKeys[i])) : -1;
          const directionIds: Record<number, string> = { [SW]: 'downLeft', [NW]: 'upLeft', [N]: 'up', [NE]: 'upRight', [SE]: 'downRight', [S]: 'down' };
          const move = Object.entries(directionIds).find(([direction, id]) =>
            keyMatches(event.key, 'distilling', id, Object.keys(KEY_MOVES).find((key) => KEY_MOVES[key] === Number(direction) && key.startsWith('arrow')) ?? ''),
          );
          const movement = move ? Number(move[0]) : ['1','2','3','4','6','7','8','9','home','end','pageup','pagedown'].includes(event.key) ? KEY_MOVES[event.key] : undefined;
          if (paintKey >= 0) paintWith = PAINT_ORDER[paintKey];
          else if (keyMatches(event.key, 'distilling', 'pause', 'escape')) togglePause();
          else if (movement !== undefined) moveCursor(movement);
          else if (keyMatches(event.key, 'distilling', 'swap', 'space', ['5','clear'])) selOrSwap();
          else if (keyMatches(event.key, 'distilling', 'burn', 'x')) burnNow();
        } else if (event.type === 'keyup' && paintWith !== null && PAINT_ORDER[['1', '2', '3', '4', '5'].findIndex((_, i) => keyMatches(event.key, 'distilling', `paint${i + 1}`, String(i + 1)))] === paintWith) {
          paintWith = null;
        }
      }
      if (input.mouse[0] !== lastMouse[0] || input.mouse[1] !== lastMouse[1]) {
        // The game gets every mouse move; a frame here can cover several, so step along the line
        // between them, a few pixels at a time, so a quick drag doesn't skip pieces.
        const [x0, y0] = lastMouse[0] < 0 ? input.mouse : lastMouse;
        const steps = mouseHeld ? Math.max(1, Math.ceil(Math.hypot(input.mouse[0] - x0, input.mouse[1] - y0) / 4)) : 1;
        for (let i = 1; i <= steps; i++) {
          const pos: Point = [x0 + ((input.mouse[0] - x0) * i) / steps, y0 + ((input.mouse[1] - y0) * i) / steps];
          if (!inView(pos)) continue;
          hover(pos);
          if (mouseHeld) {
            if (creating && palettePiece !== null) paint(pos, palettePiece);
            else selOrSwap();
          }
        }
        lastMouse = input.mouse;
      }
      if (paintWith !== null && creating) paint(input.mouse, paintWith);

      for (const timer of timers.filter((t) => now >= t.at)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.run();
      }
      for (const p of [...pieces.flat(), ...leaving]) stepPiece(p, now);
      if (running && game) handle(game.update(now));

    }

    // Seeking needs simulation updates, not 60 fps canvas redraws for every point traversed.
    if (replays.isSeeking || replays.isAdvancing) return;

    screen.fill('#000');
    screen.blit(img('background'), 0, 0);
    drawVial();
    // Pieces go behind the furnace, so burning columns drop into it (they draw on the board's back layer).
    if (active) drawPieces();
    drawFurnace();
    if (active) {
      const [cx, cy] = game ? spot(cursor.col, cursor.row) : [0, 0];
      ctx.drawImage(img('cursor'), VIEW_X + cx, VIEW_Y + cy);
    }
    drawMessages(now);

    if (!active) banner(game ? 'Press Start to distil again' : 'Press Start to distil');
    else if (paused) banner('Paused');
    replays.drawOverlay(ctx);
  }

  function banner(text: string): void {
    ctx.save();
    ctx.font = `30px "${FONT}"`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff';
    ctx.strokeText(text, VIEW_X + VIEW_W / 2, 360);
    ctx.fillText(text, VIEW_X + VIEW_W / 2, 360);
    ctx.restore();
  }

  // ---- Panel ----
  // The simulator's settings column, as HTML controls: the same modes, settings, seed buttons and
  // the same two stats, Score and Chain.

  const save = <T,>(name: string, value: T): T => {
    store.set(name, value);
    return value;
  };

  /** pyperclip.paste in the simulator: a seed of digits only, else nothing changes (is_paste_legal). */
  async function pasteSeed(): Promise<boolean> {
    const text = await pasteText('Paste a seed:');
    if (text === null || !/^[0-9]+$/.test(text)) return false;
    seedText = text;
    return true;
  }

  /** The simulator's Score: points per column distilled. */
  function sessionScore(): number {
    const up = game ? game.columns.filter((c) => c.distilled).length : 0;
    return game ? game.points / Math.max(up, 1) : 0;
  }

  function sessionActiveMs(): number {
    const now = sessionEndedAt ?? ticks();
    return Math.max(0, now - sessionStartedAt - sessionPausedMs - (sessionPausedAt === null ? 0 : now - sessionPausedAt));
  }

  function swapsPerSecond(): string {
    const ms = sessionActiveMs();
    return (ms > 0 ? swaps * 1000 / ms : 0).toFixed(2);
  }

  /** Finished sessions are kept per mode and settings (per board for Practice); Create, a sandbox, keeps none. */
  function historyKey(m: Mode): string | null {
    if (m === 'Create') return null;
    if (m === 'Practice') return `Practice:${practiceNum.join('-')}`;
    return `${m}:${timerOn ? timerSeconds : 'off'}:${difficulty}:${spawnRates.join('-')}`;
  }

  const timerShown = () => (mode === 'Create' ? createTimerOn : timerOn);
  panel.controls('distilling', [
    { id: 'downLeft', label: 'Move down-left', defaultKey: 'ArrowLeft' },
    { id: 'upLeft', label: 'Move up-left', defaultKey: 'Home' },
    { id: 'up', label: 'Move up', defaultKey: 'ArrowUp' },
    { id: 'upRight', label: 'Move up-right', defaultKey: 'ArrowRight' },
    { id: 'downRight', label: 'Move down-right', defaultKey: 'PageDown' },
    { id: 'down', label: 'Move down', defaultKey: 'ArrowDown' },
    { id: 'swap', label: 'Swap pieces', defaultKey: 'Space' },
    { id: 'burn', label: 'Burn now', defaultKey: 'X' },
    { id: 'pause', label: 'Pause', defaultKey: 'Escape' },
    ...[1,2,3,4,5].map((n) => ({ id: `paint${n}`, label: `Paint piece ${n}`, defaultKey: String(n) })),
  ]);
  const gameGroup = panel.session();
  gameGroup.select('Mode', MODES, () => mode, (m) => {
    mode = save('mode', m);
    resultRows = null;
    game = null;
    seedText = '';
    lastSeed = '';
  }, { disabled: () => running });
  gameGroup.select(
    'Practice group',
    practiceAvailable.map((_, i) => ({ value: i, label: practiceGroupNames[i].replace(/:$/, '') })),
    () => practiceNum[0],
    (group) => (practiceNum = save('practiceNum', [group, 0])),
    { hidden: () => mode !== 'Practice', disabled: () => running },
  );
  // One board list per group, since a select's options are fixed.
  practiceAvailable.forEach((levels, group) => {
    gameGroup.select(
      'Practice board',
      levels.map((level) => ({ value: level, label: `${level}. ${practiceNames[group][level]}` })),
      () => practiceNum[1],
      (level) => (practiceNum = save('practiceNum', [group, level])),
      { hidden: () => mode !== 'Practice' || practiceNum[0] !== group, disabled: () => running },
    );
  });

  const actions = panel.group();
  actions.note(() => {
    if (mode === 'Practice') return '';
    const timer = timerShown() ? `${timerSeconds}s burn timer` : 'No burn timer';
    return `Difficulty ${difficulty} · ${timer}`;
  });
  actions
    // Starting while a replay is open closes it and starts a game of your own.
    .button('Start', () => { if (replays.isPlaying) { replays.stop(); if (replays.isPlaying) return; } if (running) dismiss(); else start(); }, { variant: 'primary', label: () => (replays?.isPlaying ? 'Start' : running ? 'Dismiss' : 'Start'), title: 'Dismiss saves the current score without processing another column' })
    .button('Pause', () => { replays.command('pause'); togglePause(); }, { disabled: () => !running || !!replays?.isPlaying, label: () => (paused ? 'Resume' : 'Pause'), title: 'Esc' });

  panel.score().stats([], () => {
    const games = historyKey(mode) ? store.history(historyKey(mode)!) : [];
    return [
      ['Score', sessionScore().toFixed(2)],
      ['Swaps per second', swapsPerSecond()],
      ...(games.length ? [['Best', Math.max(...games.map((g) => g.score)).toFixed(2)]] : []),
    ];
  });

  const replayAction = {
    available: (game: GameRecord) => typeof game.replayAt === 'number' && (replays?.hasPlayableAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined) ?? false),
    play: (game: GameRecord) => { if (typeof game.replayAt === 'number') replays?.playAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined); },
  };
  historyGroup(panel, () => (historyKey(mode) ? store.history(historyKey(mode)!) : null), [
    { label: 'Score', value: (g) => g.score.toFixed(2) },
  ], 'Past games', replayAction);

  const settingsGroup = panel.settings.group('Game', { hidden: () => mode === 'Practice' });
  settingsGroup.toggle('Burn timer', timerShown, (on) => {
    if (mode === 'Create') createTimerOn = save('createTimerOn', on);
    else timerOn = save('timerOn', on);
  }, { disabled: () => running });
  settingsGroup.number('Burn timer (s)', () => timerSeconds, (v) => (timerSeconds = save('timerSeconds', Math.max(1, Math.min(120, v)))), {
    min: 1,
    max: 120,
    step: 0.1,
    disabled: () => running,
    hidden: () => !timerShown(),
  });
  settingsGroup.number('Difficulty', () => difficulty, (n) => (difficulty = save('difficulty', Math.max(0, Math.min(100, Math.round(n))))), {
    min: 0,
    max: 100,
    disabled: () => running,
  });

  const spawnGroup = panel.settings.group('Spawn rates', { columns: 5, hidden: () => mode === 'Practice' });
  for (const [index, label] of SPAWN_BOXES) {
    spawnGroup.number(label, () => spawnRates[index], (n) => {
      spawnRates[index] = Math.max(0, Math.round(n));
      save('spawnRates', spawnRates);
    }, { min: 0, max: 999, disabled: () => running });
  }
  const defaultRates = () => spawnRates.every((v, i) => v === DEFAULT_SPAWN[i]);
  spawnGroup.button('Defaults', () => (spawnRates = save('spawnRates', defaultRates() ? [0, 0, 0, 0, 1] : [...DEFAULT_SPAWN])), {
    label: () => (defaultRates() ? 'Whites only' : 'Defaults'),
    disabled: () => running,
    title: 'Switch between the default spawn rates and a board of only whites',
  });

  // The board's seed can be copied in any mode, and pasted or dealt anew while playing in Create.
  const boardGroup = panel.group('Board');
  boardGroup.button('Copy', () => game && copyText(get_create_seed(fromColumns(game.board.columns)), 'Copy this seed:'), {
    disabled: () => !game,
    title: "Copy the board's seed",
  });
  boardGroup.button('Paste', () => void pasteSeed().then((ok) => ok && running && start()), {
    hidden: () => mode !== 'Create',
    disabled: () => !running,
    title: 'Play a board from a pasted seed',
  });
  boardGroup.button('Generate', () => {
    seedText = '';
    start();
    copyText(get_create_seed(fromColumns(game!.board.columns)), 'Copy this seed:');
  }, { hidden: () => mode !== 'Create', disabled: () => !running, title: 'Deal a new board and copy its seed' });
  const palette = document.createElement('div');
  palette.className = 'piece-palette';
  const pieceNames = ['Black', 'Brown', 'White', 'Spice', 'Burnt'];
  pieceNames.forEach((name, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-button';
    const icon = document.createElement('canvas');
    icon.width = icon.height = CELL;
    icon.setAttribute('aria-hidden', 'true');
    icon.getContext('2d')!.drawImage(pieceImage(PAINT_ORDER[i], 0), 0, 0);
    button.append(icon, document.createTextNode(`${i + 1} · ${name}`));
    button.addEventListener('click', () => {
      palettePiece = palettePiece === PAINT_ORDER[i] ? null : PAINT_ORDER[i];
      setSelected(null);
      panel.used();
    });
    panel.addSync(() => {
      button.disabled = !running;
      button.setAttribute('aria-pressed', String(palettePiece === PAINT_ORDER[i]));
    });
    palette.append(button);
  });
  boardGroup.append(palette, { hidden: () => mode !== 'Create' });
  boardGroup.note(() => 'Hold 1–5 to paint, or select a piece above and left-click to place it. Select it again to deselect. Scroll to cycle pieces.', { hidden: () => mode !== 'Create' });
  boardGroup.select('Fill piece', pieceNames.map((label, i) => ({ value: i, label })), () => Math.max(0, PAINT_ORDER.indexOf(palettePiece ?? PAINT_ORDER[0])), (i) => { palettePiece = PAINT_ORDER[i]; }, { hidden: () => mode !== 'Create' });
  boardGroup.button('Fill board', () => fillBoard(palettePiece ?? PAINT_ORDER[0]), { hidden: () => mode !== 'Create', disabled: () => !running });

  const seedGroup = panel.group('Seed', { hidden: () => mode !== 'Seeded' });
  seedGroup.button('Copy', () => lastSeed && copyText(lastSeed, 'Copy this seed:'), {
    disabled: () => running || !lastSeed,
    title: 'Copy the seed of the last start',
  });
  seedGroup.button('Paste', () => void pasteSeed(), { disabled: () => running, title: 'Use a pasted seed for the next start' });
  seedGroup.button('New', () => {
    seedText = generate_seed();
    copyText(seedText, 'Copy this seed:');
  }, { disabled: () => running, title: 'Make a new seed, copy it and use it for the next start' });

  panel.settings.group('Reset').button('Reset to defaults', () => {
    mode = save('mode', 'Standard');
    timerOn = save('timerOn', true);
    createTimerOn = save('createTimerOn', false);
    timerSeconds = save('timerSeconds', (TICK_MS * 50) / 1000);
    difficulty = save('difficulty', 50);
    spawnRates = save('spawnRates', [...DEFAULT_SPAWN]);
    practiceNum = save('practiceNum', [0, 0]);
    seedText = '';
    lastSeed = '';
    resultRows = null;
    game = null;
  }, { disabled: () => running });

  panel.clock(() => {
    if ((running && game?.timerless) || (!running && runSettings().interval === null)) return null;
    const ms = running && game ? game.timeUntilBurn(ticks()) : runSettings().interval ?? 0;
    return { label: 'Next burn', ms, countdown: true, warn: running && ms < 3000 };
  });
  function makeResultRows(): string[][] {
    return [
      ['Score', sessionScore().toFixed(2)],
      ['Swaps', String(swaps)], ['Swaps per second', swapsPerSecond()],
      ['Points', String(game?.points ?? 0)], ['Columns distilled', String(game?.columns.filter((c) => c.distilled).length ?? 0)],
      ['Columns burnt', String(game?.columns.filter((c) => !c.distilled).length ?? 0)],
      ['Spices distilled', String(game?.columns.reduce((sum, c) => sum + (c.distilled ? c.spices : 0), 0) ?? 0)],
      ['Spices burnt', String(game?.columns.reduce((sum, c) => sum + (!c.distilled ? c.spices : 0), 0) ?? 0)],
      ['Pieces distilled', String(game?.distilled ?? 0)], ['Longest crystal chain', String(game?.longestCrystalChain ?? 0)],
      ['Junk left', game?.junkLeft == null ? '—' : String(game.junkLeft)],
    ];
  }
  const duty = dutyDesk(panel, store, 'distilling', 'Distilling', RATING_SCALES, { shown: () => mode === 'Standard' || mode === 'Seeded' });
  panel.results(() => resultRows && !running && (startedMode === 'Standard' || startedMode === 'Seeded') ? {
    title: 'Distilling results',
    report: duty.last,
    averages: duty.averages(historyKey(startedMode) ? store.history(historyKey(startedMode)!) : null),
    rows: resultRows,
  } : null);

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__brew = {
      get game() {
        return game;
      },
      get pieces() {
        return pieces;
      },
      start,
      burnNow,
      setCursor: (col: number, row: number) => (cursor = { col, row }),
      selOrSwap,
    };
  }

  const isDistillingReplayState = (value: unknown): value is DistillingReplayState => {
    if (!value || typeof value !== 'object') return false;
    const state = value as DistillingReplayState;
    if (state.format !== 'distilling-replay-state' || !Array.isArray(state.board) || state.board.length !== 10 ||
        !state.board.every((column) => Array.isArray(column) && column.length === 9 && column.every((piece) => Number.isInteger(piece) && piece >= -1 && piece <= 4)) ||
        !Array.isArray(state.simSeed) || state.simSeed.length !== 2 || typeof state.simSeed[0] !== 'string' || state.simSeed[1] !== '') return false;
    return new PyRandom(0).restore(state.randomState);
  };

  const replaySettingsCodec: ReplaySettingsCodec = {
    currentVersion: 1,
    simulatorVersion: 1,
    migrate: (version, value) => {
      if (version !== 1 || !value || typeof value !== 'object') return null;
      const s = value as Record<string, unknown>;
      return ['Standard', 'Seeded', 'Create', 'Practice'].includes(String(s.mode)) &&
        typeof s.timerOn === 'boolean' && typeof s.createTimerOn === 'boolean' &&
        Number.isFinite(s.timerSeconds) && Number.isFinite(s.difficulty) &&
        Array.isArray(s.spawnRates) && s.spawnRates.every(Number.isFinite) &&
        Array.isArray(s.practiceNum) && s.practiceNum.every(Number.isFinite) ? value : null;
    },
  };
  let savedReplaySettings: { mode: Mode; timerOn: boolean; createTimerOn: boolean; timerSeconds: number; difficulty: number; spawnRates: number[]; practiceNum: number[]; seedText: string; lastSeed: string } | null = null;
  replays = new ReplayRecorder('distilling', store, panel, ticks, (tape: PuzzleReplay) => {
    savedReplaySettings ??= { mode, timerOn, createTimerOn, timerSeconds, difficulty, spawnRates: [...spawnRates], practiceNum: [...practiceNum], seedText, lastSeed };
    const settings = tape.settings as { mode: Mode; timerOn: boolean; createTimerOn: boolean; timerSeconds: number; difficulty: number; spawnRates: number[]; practiceNum: number[] };
    mode = settings.mode;
    timerOn = settings.timerOn;
    createTimerOn = settings.createTimerOn;
    timerSeconds = settings.timerSeconds;
    difficulty = settings.difficulty;
    spawnRates = [...settings.spawnRates];
    practiceNum = [...settings.practiceNum];
    if (!isDistillingReplayState(tape.seed)) throw new Error('Invalid Distilling replay state');
    replayStartState = tape.seed;
    seedText = '';
    lastSeed = '';
    start();
  }, () => {
    if (running) stop();
    if (savedReplaySettings) {
      ({ mode, timerOn, createTimerOn, timerSeconds, difficulty, spawnRates, practiceNum, seedText, lastSeed } = savedReplaySettings);
      savedReplaySettings = null;
    }
    replayStartState = null;
  }, isDistillingReplayState, setReplayTime, () => frame([]), replaySettingsCodec, () => !running || replays.isPlaying);

  return { frame, dispose: () => { if (running && !replays.isPlaying) dismiss(); replays.dispose(); sounds.dispose(); } };
}) satisfies PuzzleFactory;

/** java.awt.Color.getHSBColor as a CSS colour. */
function hsb(h: number, s: number, b: number): string {
  const hh = (h - Math.floor(h)) * 6;
  const f = hh - Math.floor(hh);
  const p = b * (1 - s);
  const q = b * (1 - s * f);
  const t = b * (1 - s * (1 - f));
  const [r, g, bl] = [
    [b, t, p],
    [q, b, p],
    [p, b, t],
    [p, q, b],
    [t, p, b],
    [b, p, q],
  ][Math.floor(hh)];
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(bl * 255)})`;
}
