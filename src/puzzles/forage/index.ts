// Forage, rebuilt from the Puzzle Pirates game (duty/forage, build 20260909165753): the rules are
// in board.ts and engine.ts, and this file is ForagePanel and ForageBoardView with their helper
// classes: the game's art, sounds and timings, the cursor, crates glowing and sparkling, cleared
// pieces popping, the monkey, ants, the earthquake's bob, the banana meter, the floating messages
// and the intro and outro. The canvas is the 450x600 puzzle panel; settings and scores are in the
// side panel.
//
// On top of the game are the Forage Simulator's modes: Puzzle (its hand-made boards, from
// logic.ts and puzzles.ts), CI and Infinite (cursed isle foraging, with the simulator's chests and
// flat 1/2/3 scoring, crates.ts) and Normal.
import { SessionPause } from '../../core/pause';
import { Images } from '../../core/assets';
import { SoundBank } from '../../core/audio';
import { loadFont } from '../../core/fonts';
import { dutyDesk } from '../../core/duty/desk';
import type { DutyReport } from '../../core/duty/report';
import type { RatingScale } from '../../core/duty/ratings';
import { historyGroup } from '../../core/history';
import { ReplayRecorder, type PuzzleReplay, type ReplayAction, type ReplaySettingsCodec } from '../../core/replay';
import type { GameRecord } from '../../core/storage';
import type { InputEvent, Point } from '../../core/input';
import type { Option } from '../../core/panel';
import type { PuzzleFactory } from '../../core/puzzle';
import { PyRandom } from '../../core/pyrandom';
import {
  antCount,
  antFacing,
  crateKey,
  crateSize,
  CRATE_SIZES,
  EMPTY,
  HEIGHT,
  isAnts,
  isCrate,
  isCrateAnchor,
  isTool,
  makeAnts,
  makeCrate,
  WIDTH,
} from './board';
import { GauntletChests, CrateRequests, CURSED_TILES } from './crates';
import { keyMatches } from '../../core/controls';
import { type Cell, CELL, type Effect, Forage, looks, type SoundName, type Sprite, type Step, TIMING } from './engine';
import { CHEST_WEIGHTINGS, fillPuzzle, type Mode, parseBoard, randomizeColours, scramblePuzzle, type Settings } from './logic';
import { PUZZLES } from './puzzles';
import delarobbUrl from './delarobb.ttf?url';

const soundUrls = import.meta.glob<string>('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' });
const imageUrls = import.meta.glob<string>('./media/*.png', { eager: true, query: '?url', import: 'default' });

/** The board view sits at (67, 50) in the panel, 315x450 (ForageBoardView.c, d, a, b). */
const LEFT = 67;
const TOP = 50;
const VIEW_W = WIDTH * CELL;
const VIEW_H = HEIGHT * CELL;
/** The cursor's frame reaches 7px past its cells (ForageBoardView.j). */
const CURSOR_PAD = 7;
/** The banana meter  at (20, 335): bananas 21px, stacked 19px apart from the bottom of nine. */
const METER_X = 20;
const METER_Y = 335;
const BANANA = 21;
const BANANA_STEP = 19;
/** A banana fills in 500ms. */
const BANANA_MS = 500;
/** The game updates the board every 14ms (about 71 times a second). */
const FRAME_MS = 14;
const FONT = 'Delarobb';
/** Floating messages drift up 30px over 1.5s, fading out in the second half. */
const FLOAT_MS = 1500;
const FLOAT_PX = 30;
/** Ants' counts sit here in their cell, by facing (ForageBoardView.g). */
const ANT_NUMBER_AT: Cell[] = [
  [28, 13],
  [15, 28],
  [1, 14],
  [13, 0],
];

/** Every board brings a full meter of nine. */
const BANANAS = 9;
/** Puzzles the random pick chooses between (the desktop version drew from 1–14). */
const RANDOM_POOL = Object.keys(PUZZLES)
  .map(Number)
  .filter((id) => id <= 14);

/**
 * CI and Infinite are cursed isle (Gauntlet) foraging: when a board's crates are all collected,
 * deal a new one (within the 2 minutes, for CI). Normal is normal foraging in the game's rules,
 * with no clock, and is one board: it ends when the banana meter is full,
 * or when the player dismisses it.
 */
const MODES: Option<Mode>[] = [
  { value: 'puzzle', label: 'Puzzle' },
  { value: 'ci', label: 'Gauntlet' },
  { value: 'chaos', label: 'Chaos' },
  { value: 'normal', label: 'Normal' },
];
/**
 * Duty report ratings. Normal foraging goes by points a move. Gauntlet and Chaos are rated like
 * cursed isle foraging (YPPedia, Cursed Isles): Asleep up to Frenetic by points (bone box 1, fetish
 * jar 2, cursed chest 3), then four extra words and 👀 at 40. Puzzles are Learning.
 */
const RATING_SCALES: RatingScale[] = [
  { id: 'normal', label: 'Normal, points a move', cutoffs: [0.25, 0.5, 0.8, 1.2, 1.6], step: 0.05 },
  { id: 'gauntletPoints', label: 'Gauntlet and Chaos, points', cutoffs: [3, 6, 9, 12, 15, 20, 25, 30, 35, 40], gauntlet: true },
];

/** Modes that end and keep a best score. */
const SCORED = new Set<Mode>(['ci', 'infinite', 'normal', 'chaos']);

/**
 * Normal mode's default chest mix: observed rates of 0.65, 0.345 and 0.0047 for 1x1, 2x2 and
 * 3x2, as ratios, with the 3x2 doubled.
 */
const NORMAL_RATIOS: Settings['normalRatios'] = [0.6472, 0.3435, 0.0094];

const DEFAULT_SETTINGS: Settings = {
  mode: 'ci',
  bb: true,
  fj: true,
  cc: false,
  eq: true,
  machete: true,
  shovel: true,
  monkey: true,
  ants: true,
  scramble: true,
  forageLevel: 6,
  normalRatios: [...NORMAL_RATIOS],
  chestRatios: undefined,
  pacedChests: true,
};

interface PuzzleRecord {
  moves: number;
  time: number;
}

interface ForageReplaySeed {
  format: 'forage-replay-state';
  seeds: [number, number];
  boards: string[];
}

/** The simulator's letters as game pieces. Colours u-y are dirt, wood, grass, sand and stone. */
const LETTER_PIECES: Record<string, number> = { u: 0, v: 4, w: 1, x: 2, y: 3, n: 5, m: 6, p: 7, o: 8, z: EMPTY };

/** A puzzle board in the simulator's letters, as game cells (crates as cursed ones). */
function lettersToCells(board: string[][]): number[] {
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

/** Something drawn for a while that doesn't hold up the board. */
interface Timed {
  effect: Effect;
  start: number;
}

export default (async ({ screen, input, panel, store, ticks: rawTicks, setReplayTime: rawReplayTime }) => {
  const pause = new SessionPause(rawTicks, rawReplayTime);
  const { ticks, setReplayTime } = pause;
  const [images] = await Promise.all([Images.load(imageUrls), loadFont(FONT, delarobbUrl)]);
  const img = (name: string) => images.get(name);
  const rng = new PyRandom();
  /** The pieces' flight paths in and out, seeded per session so a replay's intros last as long. */
  const flights = new PyRandom();
  looks.random = () => flights.random();
  const sounds = new SoundBank<SoundName>(soundUrls);

  const settings: Settings = { ...DEFAULT_SETTINGS, ...store.get<Partial<Settings>>('settings', {}) };
  if (settings.mode === 'infinite') {
    settings.mode = 'ci';
    settings.roundSeconds ??= 0;
  }
  settings.roundSeconds ??= settings.mode === 'ci' ? 120 : 0;
  // Gauntlet chests always arrive paced; only replays recorded before keep their old timing.
  settings.pacedChests = true;
  const saveSettings = () => store.set('settings', settings);
  const puzzleRecords = store.get<Record<string, PuzzleRecord>>('puzzleRecords', {});
  const ciBest = store.get<Record<string, number>>('ciBest', {});
  // Normal's score is points per move.
  const normalBest = store.get<Record<string, number>>('normalBestPerMove', {});
  const bests = () => (settings.mode === 'normal' ? normalBest : ciBest);

  /** Normal foraging looks like the fruit jungle; the rest are cursed isle boards. */
  const cursed = () => settings.mode !== 'normal';

  /** Dealt once the replay state below exists, since dealing checks for a replay. */
  let game: Forage;
  let boardActive = false;
  let ended = false;
  let pendingNextBoard = false;
  let movesUsed = 0;
  let clockwise = 0;
  let anticlockwise = 0;
  let score = 0;
  /** The banana meter: crates collected on this board, and how full it's drawn (0-100%). */
  let crates = 0;
  let meterShown = 0;
  let meterAt = 0;
  let startTime = 0;
  let timePassed = 0;
  /** Crates collected this session, small (1x1), medium (2x2) and large (3x2), for the duty report. */
  let sessionCrates = [0, 0, 0];
  let bestScore: number | null = null;
  let record: PuzzleRecord | null = null;
  /** The move being animated, and when its current step started. */
  let playing: Step[] = [];
  let stepStart = 0;
  /** When the board last called a move over and can take the next click. */
  let settledAt = 0;
  let timed: Timed[] = [];
  /** The intro or outro: pieces flying on or off the board. */
  let flight: { pieces: { piece: number; at: Cell; from: Point; duration: number }[]; start: number; out: boolean } | null = null;
  /** The cursor's top-left cell (ForageBoardView._cpos). */
  let cursor: Cell = [4, 6];

  /** The puzzle to play; 0 picks one at random each time. */
  let puzzleId = store.get<string>('puzzleId', '0');
  if (puzzleId !== '0' && !(puzzleId in PUZZLES)) puzzleId = '0';
  let pickedRandomly = false;

  // ---- Recording and replays ----

  let replays!: ReplayRecorder;
  let sessionSeed: ForageReplaySeed | null = null;
  let recordedAction = false;
  let nextReplayBoard = 0;
  /** Active replay-only visuals and the settings to restore when playback stops. */
  let replay: {
    now: number;
    mouse: Point;
    clicks: { t: number; x: number; y: number; b: number }[];
    /** What the player had set before watching, put back afterwards. */
    saved: { settings: Settings; puzzleId: string; pickedRandomly: boolean };
  } | null = null;
  /** Set while a replayed event is applied, so it happens at the time it was recorded. */
  let clockAt: number | null = null;
  /** Game time: real time, or the replay's clock while watching. */
  const clock = () => clockAt ?? (replay ? replay.now : ticks());
  game = newGame();

  const ciKey = () => {
    const base = (['bb', 'fj', 'cc', 'eq', 'machete', 'shovel', 'monkey'] as const).map((k) => (settings[k] ? 'b' : 'a')).join('') +
      (settings.mode === 'normal' ? settings.normalRatios.join('-') : settings.chestRatios?.join('-') ?? settings.forageLevel) +
      (settings.ants ? 'ants' : '');
    // Preserve existing scores for the original Gauntlet and Normal round lengths.
    const original = settings.mode === 'normal' ? 0 : 120;
    return base + (roundSeconds() === original ? '' : `:timer:${roundSeconds()}`);
  };

  const roundSeconds = () => settings.roundSeconds ?? (settings.mode === 'ci' ? 120 : 0);
  const roundDuration = () => roundSeconds() * 1000;

  /** Where this game's history is kept: per settings for CI and Normal, per puzzle (unscrambled) for Puzzle. */
  const historyKey = (): string | null =>
    settings.mode === 'puzzle'
      ? settings.scramble || puzzleId === '0'
        ? null
        : `puzzle:${puzzleId}`
      : SCORED.has(settings.mode)
        ? `${settings.mode}:${ciKey()}`
        : null;

  /** Crate weights for the mode, with turned-off crates at 0. */
  function crateWeights(): [number, number, number] {
    const w = settings.mode === 'normal' ? settings.normalRatios : settings.chestRatios ?? CHEST_WEIGHTINGS[settings.forageLevel];
    return [settings.bb ? w[0] : 0, settings.fj ? w[1] : 0, settings.cc ? w[2] : 0];
  }

  /** A fresh game board from a random seed, with the mode's crates and the chosen specials. */
  function newGame(): Forage {
    const seed = replay
      ? BigInt(sessionSeed?.boards[nextReplayBoard++] ?? 0)
      : BigInt(Math.floor(Math.random() * 2 ** 48));
    if (!replay && sessionSeed) {
      sessionSeed.boards.push(String(seed));
      replays?.updateSeed(sessionSeed);
    }
    const source =
      settings.mode === 'normal'
        ? new CrateRequests(rng, crateWeights(), BANANAS)
        : settings.mode === 'puzzle'
          ? {}
          : new GauntletChests(rng, crateWeights(), BANANAS, settings.mode === 'chaos', settings.mode === 'ci' && !!settings.pacedChests, () => clock());
    const g = new Forage(seed, source);
    // Shovel, machete, monkey, earthquake, ants.
    g.board.allowed = [settings.shovel, settings.machete, settings.monkey, settings.eq, settings.ants];
    if (settings.mode !== 'normal') g.crateArt = [...CURSED_TILES];
    return g;
  }

  /** Deals a board; New board keeps the clock running. */
  function newBoard(restartClock = false): void {
    pendingNextBoard = false;
    playing = [];
    timed = [];
    game = newGame();
    crates = 0;
    meterShown = 0;
    intro(restartClock);
  }

  function start(): void {
    pause.resume();
    movesUsed = 0;
    clockwise = anticlockwise = 0;
    sessionCrates = [0, 0, 0];
    duty.clear();
    settledAt = 0;
    pendingNextBoard = false;
    ended = false;
    const [gameSeed, flightSeed] = sessionSeed!.seeds;
    rng.seed(gameSeed);
    flights.seed(flightSeed);
    if (settings.mode === 'puzzle') {
      if (puzzleId === '0' || pickedRandomly) {
        puzzleId = String(rng.choice(RANDOM_POOL));
        pickedRandomly = true;
      }
      const id = Number(puzzleId);
      record = puzzleRecords[puzzleId] ?? null;
      const puzzle = randomizeColours(parseBoard(PUZZLES[id]), rng);
      const reserve = parseBoard(RESERVE);
      playing = [];
      timed = [];
      game = newGame();
      game.load(lettersToCells(settings.scramble ? scramblePuzzle(id, puzzle, reserve, settings, rng) : fillPuzzle(puzzle, reserve, settings, rng)));
      intro(true);
    } else {
      newBoard(true);
      score = 0;
      bestScore = SCORED.has(settings.mode) ? (bests()[ciKey()] ?? 0) : null;
    }
    timePassed = 0;
  }

  /** Pieces fly in from beyond the nearest corner, 1 ms a pixel along an arc. */
  function intro(restartClock: boolean): void {
    if (!replays?.isSeeking) sounds.play(cursed() ? 'cursed_intro' : 'intro');
    flight = { pieces: flyingPieces(), start: clock(), out: false };
    // The clock starts once the pieces are in.
    if (restartClock) startTime = clock() + flightLength();
  }

  function outro(delay = 0): void {
    flight = { pieces: flyingPieces(), start: clock() + delay, out: true };
    if (!replays?.isSeeking && !replays?.isPaused) window.setTimeout(() => { if (!replays.isSeeking && !replays.isPaused) sounds.play('outro'); }, delay);
  }

  function flyingPieces() {
    const out: { piece: number; at: Cell; from: Point; duration: number }[] = [];
    game.cells.forEach((piece, i) => {
      if (piece === EMPTY || (isCrate(piece) && !isCrateAnchor(piece))) return;
      const at: Cell = [i % WIDTH, Math.floor(i / WIDTH)];
      const [px, py] = pieceTopLeft(piece, at);
      const fx = px < VIEW_W / 2 ? -(flights.random() * 90 + 45) : VIEW_W + flights.random() * 90;
      const fy = py < VIEW_H / 2 ? -(flights.random() * 90 + 45) : VIEW_H + flights.random() * 90;
      out.push({ piece, at, from: [fx, fy], duration: (Math.abs(fx - px) + Math.abs(fy - py)) * TIMING.introPerPx });
    });
    return out;
  }

  const flightLength = () => Math.max(0, ...(flight?.pieces.map((p) => p.duration) ?? []));

  function finishPuzzle(): void {
    ended = true;
    boardActive = false;
    const report = endReport();
    const finishedReplay = endRecording(`Puzzle ${puzzleId}, ${movesUsed} moves`, report);
    if (settings.scramble || replay) return;
    store.addHistory(historyKey()!, { score: movesUsed, moves: movesUsed, clockwise, anticlockwise, time: timePassed, ...duty.fields(report), ...(finishedReplay ? { replayAt: finishedReplay.at, replayId: finishedReplay.runId ?? '' } : {}) });
    const best = record ?? { moves: movesUsed, time: timePassed };
    record = { moves: Math.min(best.moves, movesUsed), time: Math.min(best.time, timePassed) };
    puzzleRecords[puzzleId] = record;
    store.set('puzzleRecords', puzzleRecords);
  }

  /** Normal foraging rates a run by points per move; the other modes show total points. */
  function shownScore(): number {
    return settings.mode === 'normal' ? (movesUsed ? score / movesUsed : 0) : score;
  }
  const scoreText = (n: number) => (settings.mode === 'normal' ? n.toFixed(2) : String(n));

  function finishScored(): void {
    ended = true;
    boardActive = false;
    const key = ciKey();
    const best = bests();
    const final = shownScore();
    const report = endReport();
    const finishedReplay = endRecording(settings.mode === 'normal' ? `${scoreText(final)} a move` : `Score ${final}`, report);
    if (!replay) {
      if (final > (best[key] ?? 0)) {
        best[key] = final;
        store.set(settings.mode === 'normal' ? 'normalBestPerMove' : 'ciBest', best);
      }
      store.addHistory(historyKey()!, settings.mode === 'normal'
        ? { score: Number(final.toFixed(2)), points: score, moves: movesUsed, clockwise, anticlockwise, ...duty.fields(report), ...(finishedReplay ? { replayAt: finishedReplay.at, replayId: finishedReplay.runId ?? '' } : {}) }
        : { score: final, clockwise, anticlockwise, ...duty.fields(report), ...(finishedReplay ? { replayAt: finishedReplay.at, replayId: finishedReplay.runId ?? '' } : {}) });
    }
    bestScore = Math.max(bestScore ?? 0, final);
    // A full meter is "Great work!" in the game, and the pieces fly off a second later.
    if (settings.mode === 'normal' && boardDone()) {
      timed.push({ effect: { kind: 'text', text: 'Great work!', size: 32, delay: 0 }, start: clock() });
      outro(TIMING.outroDelay);
    } else outro();
  }

  /** The session's duty report: what it's rated on depends on the mode. */
  function endReport(): DutyReport {
    const gauntlet = settings.mode === 'ci' || settings.mode === 'chaos';
    const performance = settings.mode === 'normal' ? duty.rate('normal', shownScore())
      : gauntlet ? duty.rate('gauntletPoints', score) : duty.rate(null, null);
    return duty.end({
      mode: MODES.find((m) => m.value === settings.mode)?.label,
      performance,
      score: isPuzzle() ? { label: 'Moves', value: String(movesUsed) }
        : { label: settings.mode === 'normal' ? 'Points a move' : 'Score', value: scoreText(shownScore()) },
      cleared: [{ label: 'Crates Collected', inScore: true, items: [
        { icon: 'ci-bone-box', label: 'bone boxes', count: sessionCrates[0] },
        { icon: 'ci-fetish-jar', label: 'fetish jars', count: sessionCrates[1] },
        { icon: 'ci-cursed-chest', label: 'cursed chests', count: sessionCrates[2] },
      ] }],
    });
  }

  /** The board can take a click: playing, not mid-cascade, not flying in or out. */
  const inPlay = () => boardActive && !playing.length && clock() >= settledAt && !flight && (isPuzzle() || !roundSeconds() || clock() - startTime < roundDuration());

  /** A turn or tool with the cursor's top-left at `cell`; clicks during a cascade are dropped, as in the game. */
  function act(cell: Cell, ccw: boolean, replayed = false): void {
    if (!replayed && !inPlay()) return;
    game.steps = [];
    const rotation = !isTool(game.board.getPiece(cell[0], cell[1]));
    const outcome = game.act(cell[0], cell[1], ccw);
    if (outcome === 'illegal') return;
    if (rotation) {
      if (ccw) anticlockwise++;
      else clockwise++;
    }
    if (!replayed && !replay) {
      replays.action({ type: 'forage-act', data: { x: cell[0], y: cell[1], ccw } });
      recordedAction = true;
    }
    if (outcome === 'moved') {
      movesUsed++;
      const result = game.lastResult;
      if (settings.mode === 'normal') score += result.points;
      else if (settings.mode !== 'puzzle') score += result.gauntletPoints;
      crates += result.collected[0] + result.collected[1] + result.collected[2];
      sessionCrates = sessionCrates.map((n, i) => n + result.collected[i]);
      // The score sound, by the move's game points.
      if (result.points > 0 && !(settings.mode === 'normal' && crates >= BANANAS)) {
        const last = game.steps[game.steps.length - 1];
        last.sounds.push({ name: result.points > 14 ? 'score_big' : result.points > 7 ? 'score_medium' : 'score_small', delay: last.duration });
      }
    }
    playing = game.steps;
    game.steps = [];
    stepStart = clock();
    startStep();
  }

  /** Plays the current step's sounds and starts its effects. */
  function startStep(): void {
    const step = playing[0];
    if (!step) return;
    const heard = new Set<string>();
    for (const s of replays?.isSeeking || replays?.isPaused ? [] : step.sounds) {
      const key = `${s.name}@${s.delay}`;
      if (heard.has(key)) continue;
      heard.add(key);
      if (s.delay <= 0) sounds.play(s.name);
      else window.setTimeout(() => { if (!replays.isSeeking && !replays.isPaused) sounds.play(s.name); }, s.delay);
    }
    for (const effect of step.effects) timed.push({ effect, start: stepStart + effect.delay });
  }

  function toggleRunning(): void {
    // Dismissing a Normal session ends it there and scores it, counting any crates from the last
    // move that were still on their way off the board.
    if (boardActive && settings.mode === 'normal') {
      if (movesUsed) {
        playing = [];
        finishScored();
      } else {
        boardActive = false;
        ended = true;
        endRecording(`Dismissed, ${movesUsed} moves`, endReport());
      }
    } else if (boardActive) {
      boardActive = false;
      ended = true;
      endRecording(settings.mode === 'puzzle' ? `Puzzle ${puzzleId}, stopped` : `Stopped, ${movesUsed} moves`, endReport());
    } else {
      const seed = () => Math.floor(Math.random() * 2 ** 32);
      sessionSeed = { format: 'forage-replay-state', seeds: [seed(), seed()], boards: [] };
      nextReplayBoard = 0;
      recordedAction = false;
      replays.begin({ ...structuredClone(settings), puzzleId, pickedRandomly }, sessionSeed);
      boardActive = true;
      start();
    }
  }

  /** Keeps the session just played with the recent replays, if a move was made in it. */
  function endRecording(result: string, report?: DutyReport): PuzzleReplay | null {
    if (replay || !sessionSeed) return null;
    const finished = recordedAction ? replays.finish(result, report) : (replays.cancel(), null);
    sessionSeed = null;
    recordedAction = false;
    return finished;
  }

  /** Stops watching and puts the player's own settings back. */
  function stopReplay(): void {
    if (!replay) return;
    const { saved } = replay;
    replay = null;
    sessionSeed = null;
    nextReplayBoard = 0;
    Object.assign(settings, saved.settings);
    puzzleId = saved.puzzleId;
    pickedRandomly = saved.pickedRandomly;
    boardActive = false;
    ended = false;
    playing = [];
    flight = null;
    timed = [];
    game = newGame();
    crates = 0;
    meterShown = 0;
    movesUsed = 0;
    clockwise = anticlockwise = 0;
    score = 0;
    timePassed = 0;
    meterAt = ticks();
    bestScore = SCORED.has(settings.mode) ? (bests()[ciKey()] ?? 0) : null;
  }

  function applyReplayAction(action: ReplayAction): void {
    if (action.type !== 'forage-act' && action.type !== 'forage-cursor' &&
        action.type !== 'forage-click' && action.type !== 'forage-new-board') return;
    const data = action.data && typeof action.data === 'object' ? action.data as Record<string, unknown> : {};
    if (action.type === 'forage-act' && Number.isInteger(data.x) && Number.isInteger(data.y) && typeof data.ccw === 'boolean') {
      const cell: Cell = [data.x as number, data.y as number];
      if (flight && !flight.out && clock() - flight.start >= flightLength()) flight = null;
      currentStep(clock());
      cursor = cell;
      act(cell, data.ccw, true);
    } else if (action.type === 'forage-cursor' && Number.isInteger(data.x) && Number.isInteger(data.y)) {
      cursor = [data.x as number, data.y as number];
    } else if (action.type === 'forage-click' && Number.isFinite(data.x) && Number.isFinite(data.y) && Number.isFinite(data.button)) {
      replay?.clicks.push({ t: clock(), x: data.x as number, y: data.y as number, b: data.button as number });
    } else if (action.type === 'forage-new-board') newBoard();
  }

  /** While watching: the recorded mouse pointer, a ring where each click landed, and the speed. */
  function drawReplayOverlay(now: number): void {
    const r = replay!;
    const ctx = screen.ctx;
    ctx.save();
    r.clicks = r.clicks.filter((c) => now - c.t < 400);
    for (const c of r.clicks) {
      const age = (now - c.t) / 400;
      ctx.globalAlpha = 1 - age;
      ctx.strokeStyle = c.b === 3 ? '#ffb347' : '#7fd4ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 6 + age * 14, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    replays.drawOverlay(ctx);
  }

  // ---- Cursor  ----

  const toolAt = (x: number, y: number) => isTool(game.board.getPiece(x, y));

  /** The mouse picks the cell under it if that's a tool (the cursor shrinks to it), else the 2x2 there. */
  function cursorFromMouse([mx, my]: Point): void {
    const px = mx - LEFT;
    const py = my - TOP;
    let x = Math.max(0, Math.min(Math.floor(px / CELL), WIDTH - 1));
    let y = Math.max(0, Math.min(HEIGHT - 1, Math.floor(py / CELL)));
    if (!toolAt(x, y)) {
      x = Math.max(0, Math.min(Math.floor(px / CELL), WIDTH - 2));
      y = Math.max(0, Math.min(HEIGHT - 2, Math.floor(py / CELL)));
    }
    cursor = [x, y];
  }

  /** Arrow keys: the cursor stays a 2x2 inside the board, except on a tool in the last row or column. */
  function moveCursor(dx: number, dy: number): void {
    const [cx, cy] = cursor;
    const x = Math.max(cx + dx, 0);
    const y = Math.max(cy + dy, 0);
    if ((x < WIDTH - 1 && y < HEIGHT - 1) || (x < WIDTH && y < HEIGHT && toolAt(x, y))) cursor = [x, y];
    else if (cx === WIDTH - 2 && cy === HEIGHT - 2 && toolAt(WIDTH - 1, HEIGHT - 1)) cursor = [WIDTH - 1, HEIGHT - 1];
    else if (cx === WIDTH - 1 && cy === HEIGHT - 1 && !toolAt(x, y)) cursor = [WIDTH - 2, HEIGHT - 2];
  }

  /** After a move the cursor re-fits the board (ForageBoardView.w). */
  function refitCursor(): void {
    let x = Math.max(0, Math.min(cursor[0], WIDTH - 1));
    let y = Math.max(0, Math.min(HEIGHT - 1, cursor[1]));
    if (!toolAt(x, y)) {
      x = Math.max(0, Math.min(cursor[0], WIDTH - 2));
      y = Math.max(0, Math.min(HEIGHT - 2, cursor[1]));
    }
    cursor = [x, y];
  }

  const overBoard = ([mx, my]: Point) => mx >= LEFT && mx < LEFT + VIEW_W && my >= TOP && my < TOP + VIEW_H;

  function key(name: string): void {
    if (!boardActive) return;
    // X turns anticlockwise and C clockwise, as in the game; the arrows move the cursor.
    if (keyMatches(name, 'forage', 'rotateLeft', 'x')) act(cursor, true);
    else if (keyMatches(name, 'forage', 'rotateRight', 'c')) act(cursor, false);
    else if (name.startsWith('arrow') || ['arrowleft','arrowright','arrowup','arrowdown'].some((key, i) => keyMatches(name, 'forage', ['left','right','up','down'][i], key))) {
      if (keyMatches(name, 'forage', 'left', 'arrowleft')) moveCursor(-1, 0);
      else if (keyMatches(name, 'forage', 'right', 'arrowright')) moveCursor(1, 0);
      else if (keyMatches(name, 'forage', 'up', 'arrowup')) moveCursor(0, -1);
      else if (keyMatches(name, 'forage', 'down', 'arrowdown')) moveCursor(0, 1);
      if (!replay) replays.action({ type: 'forage-cursor', data: { x: cursor[0], y: cursor[1] } });
    }
  }

  pause.install(panel, () => boardActive && !ended);

  // ---- Panel ----

  const isPuzzle = () => settings.mode === 'puzzle';
  const locked = () => boardActive || !!replay;
  const setting = <K extends keyof Settings>(k: K) => ({
    get: () => settings[k],
    set: (value: Settings[K]) => {
      settings[k] = value;
      saveSettings();
    },
  });
  const bind = <K extends 'scramble' | 'bb' | 'fj' | 'cc' | 'eq' | 'machete' | 'shovel' | 'monkey' | 'ants'>(
    group: ReturnType<typeof panel.group>,
    label: string,
    k: K,
    hidden?: () => boolean,
  ) => {
    const { get, set } = setting(k);
    group.toggle(label, get, set, { disabled: locked, hidden });
  };

  panel.clock(() => {
    if (!isPuzzle() && roundSeconds() > 0) return { label: 'Time left', ms: roundDuration() - timePassed, countdown: true, warn: boardActive && roundDuration() - timePassed < 10000 };
    const puzzleBest = isPuzzle() && !settings.scramble && record;
    return { label: 'Time', ms: timePassed, best: puzzleBest ? record!.time : null };
  });

  panel.controls('forage', [
    { id: 'pause', label: 'Pause / resume', defaultKey: 'Escape' },
    { id: 'left', label: 'Move left', defaultKey: 'ArrowLeft' },
    { id: 'right', label: 'Move right', defaultKey: 'ArrowRight' },
    { id: 'up', label: 'Move up', defaultKey: 'ArrowUp' },
    { id: 'down', label: 'Move down', defaultKey: 'ArrowDown' },
    { id: 'rotateLeft', label: 'Rotate anticlockwise', defaultKey: 'X' },
    { id: 'rotateRight', label: 'Rotate clockwise', defaultKey: 'C' },
  ]);
  const session = panel.session();
  session.select('Mode', MODES, setting('mode').get, setting('mode').set, { disabled: locked });
  session.number(
    'Puzzle',
    () => Number(puzzleId),
    (n) => {
      puzzleId = n in PUZZLES ? String(n) : '0';
      pickedRandomly = false;
      store.set('puzzleId', puzzleId);
    },
    { min: 0, disabled: locked, hidden: () => !isPuzzle(), title: '0 picks a puzzle at random' },
  );
  const actions = panel.group();
  actions.note(() => isPuzzle() ? settings.scramble ? 'Scrambled' : '' : roundSeconds() ? `${roundSeconds()} second round` : 'No timer');
  actions
    // Starting while a replay is open closes it and starts a game of your own.
    .button('Start', () => { if (replays.isPlaying) { replays.stop(); if (replays.isPlaying) return; } toggleRunning(); }, {
      variant: 'primary',
      label: () => (replay || !boardActive ? 'Start' : settings.mode === 'normal' ? 'Dismiss' : 'Stop'),
    })
    .button('New board', () => {
      if (!replay) replays.action({ type: 'forage-new-board' });
      newBoard();
    }, {
      disabled: () => isPuzzle() || settings.mode === 'normal' || !boardActive || !!replay,
      title: 'Deal a fresh board and bananas without restarting the clock; crates from a move still playing out still count',
    });

  panel.score().stats(['', 'Now', 'Best'], () => [[
    isPuzzle() ? 'Moves' : settings.mode === 'normal' ? 'Points / move' : 'Score',
    isPuzzle() ? String(movesUsed) : scoreText(shownScore()),
    isPuzzle() ? !settings.scramble && record ? String(record.moves) : '' : bestScore !== null ? scoreText(bestScore) : '',
  ]]);
  const duty = dutyDesk(panel, store, 'forage', 'Foraging', RATING_SCALES, {
    shown: (id) => (id === 'normal' ? settings.mode === 'normal' : settings.mode === 'ci' || settings.mode === 'chaos'),
  });
  panel.results(() => ended && !flight ? {
    title: 'Forage results',
    report: duty.last,
    rows: [
      [isPuzzle() ? 'Moves' : 'Score', isPuzzle() ? String(movesUsed) : scoreText(shownScore())],
      ['Time', `${(timePassed / 1000).toFixed(2)}s`],
      ...(isPuzzle() ? [] : [['Moves', String(movesUsed)]]),
      ['Clockwise, anticlockwise', `${clockwise}, ${anticlockwise}`],
      // Points are the score except in Normal, where the score is points a move.
      ...(settings.mode === 'normal' ? [['Points', String(score)]] : []),
    ],
    averages: duty.averages(historyKey() ? store.history(historyKey()!) : null, isPuzzle()
      ? { scoreLabel: 'Moves', lowerIsBetter: true, digits: 1 }
      : { scoreLabel: settings.mode === 'normal' ? 'Points a move' : 'Score' }),
  } : null);

  // Every scored game, kept per settings key as the desktop version's score lists were.
  const historyFor = (mode: Mode) => () => (settings.mode === mode && historyKey() ? store.history(historyKey()!) : null);
  const replayAction = {
    available: (game: GameRecord) => typeof game.replayAt === 'number' && (replays?.hasPlayableAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined) ?? false),
    play: (game: GameRecord) => { if (typeof game.replayAt === 'number') replays?.playAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined); },
  };
  historyGroup(panel, historyFor('ci'), [{ label: 'Score', value: (g) => String(g.score) }], 'Past games', replayAction);
  historyGroup(panel, historyFor('chaos'), [{ label: 'Score', value: (g) => String(g.score) }], 'Past games', replayAction);
  historyGroup(panel, historyFor('normal'), [
    { label: 'Pts / move', value: (g) => Number(g.score).toFixed(2) },
    { label: 'Points', value: (g) => String(g.points) },
    { label: 'Moves', value: (g) => String(g.moves) },
  ], 'Past games', replayAction);
  historyGroup(panel, historyFor('puzzle'), [
    { label: 'Moves', value: (g) => String(g.moves) },
    { label: 'Time', value: (g) => `${(Number(g.time) / 1000).toFixed(2)}s` },
  ], 'Past games', replayAction);

  // The common replay UI owns Forage's history, playback controls, and files too.
  const replaySettingsCodec: ReplaySettingsCodec = {
    currentVersion: 1,
    simulatorVersion: 1,
    migrate: (version, value) => {
      if (version !== 1 || !value || typeof value !== 'object') return null;
      const s = value as Record<string, unknown>;
      const ratios = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n) && (n as number) >= 0);
      return ['puzzle', 'ci', 'normal', 'chaos'].includes(String(s.mode)) &&
        Number.isInteger(s.forageLevel) && (s.forageLevel as number) >= 0 && (s.forageLevel as number) <= 15 &&
        ['bb', 'fj', 'cc', 'eq', 'machete', 'shovel', 'monkey', 'ants', 'scramble'].every((key) => typeof s[key] === 'boolean') &&
        ratios(s.normalRatios) && (s.chestRatios === undefined || ratios(s.chestRatios)) &&
        (s.roundSeconds === undefined || (Number.isFinite(s.roundSeconds) && (s.roundSeconds as number) >= 0)) &&
        typeof s.puzzleId === 'string' && (s.puzzleId === '0' || s.puzzleId in PUZZLES) &&
        typeof s.pickedRandomly === 'boolean' ? value : null;
    },
  };
  const isForageReplaySeed = (value: unknown): value is ForageReplaySeed => {
    if (!value || typeof value !== 'object') return false;
    const seed = value as ForageReplaySeed;
    return seed.format === 'forage-replay-state' && Array.isArray(seed.seeds) && seed.seeds.length === 2 &&
      seed.seeds.every((n) => Number.isSafeInteger(n) && n >= 0) && Array.isArray(seed.boards) &&
      seed.boards.every((board) => typeof board === 'string' && /^\d{1,15}$/.test(board));
  };
  replays = new ReplayRecorder('forage', store, panel, ticks, (tape: PuzzleReplay) => {
    if (!isForageReplaySeed(tape.seed)) throw new Error('Invalid Forage replay state');
    const s = tape.settings as Settings & { puzzleId: string; pickedRandomly: boolean };
    const saved = replay?.saved ?? { settings: structuredClone(settings), puzzleId, pickedRandomly };
    const { puzzleId: replayPuzzleId, pickedRandomly: replayPickedRandomly, ...replaySettings } = structuredClone(s);
    Object.assign(settings, DEFAULT_SETTINGS, { pacedChests: false }, replaySettings);
    settings.roundSeconds ??= settings.mode === 'ci' ? 120 : 0;
    puzzleId = replayPuzzleId;
    pickedRandomly = replayPickedRandomly;
    replay = { now: 0, mouse: [-1, -1], clicks: [], saved };
    sessionSeed = structuredClone(tape.seed);
    nextReplayBoard = 0;
    meterAt = 0;
    boardActive = true;
    start();
  }, stopReplay, isForageReplaySeed, setReplayTime, () => frame([]), replaySettingsCodec, () => !boardActive || !!replay);

  const setup = panel.settings.group('Game');
  setup.select('Timer', [0, 30, 120, 300].map((value) => ({ value, label: value ? `${value} seconds` : 'No timer' })), roundSeconds, (value) => { settings.roundSeconds = value; saveSettings(); }, { disabled: locked, hidden: isPuzzle });
  setup.number('Chest mix preset', setting('forageLevel').get, (level) => { settings.forageLevel = Math.round(level); settings.chestRatios = undefined; saveSettings(); }, {
    min: 0,
    max: 15,
    disabled: locked,
    hidden: () => isPuzzle() || settings.mode === 'normal',
    title: 'Changes chest spawn rates only',
  });
  bind(setup, 'Scramble', 'scramble', () => !isPuzzle());

  const crateGroup = panel.settings.group('Crates');
  bind(crateGroup, 'Bone box', 'bb');
  bind(crateGroup, 'Fetish jar', 'fj');
  bind(crateGroup, 'Cursed chest', 'cc');

  const ratios = panel.settings.group('Chest ratios', { columns: 3, hidden: isPuzzle });
  (['1x1', '2x2', '3x2'] as const).forEach((label, i) =>
    ratios.number(
      label,
      () => settings.mode === 'normal' ? settings.normalRatios[i] : (settings.chestRatios ?? CHEST_WEIGHTINGS[settings.forageLevel])[i],
      (value) => {
        if (settings.mode === 'normal') settings.normalRatios[i] = value;
        else { settings.chestRatios ??= [...CHEST_WEIGHTINGS[settings.forageLevel]]; settings.chestRatios[i] = value; }
        saveSettings();
      },
      { min: 0, step: 0.0001, disabled: locked },
    ),
  );
  ratios.button(
    'Defaults',
    () => {
      if (settings.mode === 'normal') settings.normalRatios = [...NORMAL_RATIOS];
      else settings.chestRatios = undefined;
      saveSettings();
    },
    { disabled: locked, title: 'Rates of 0.65, 0.345 and 0.0047 as ratios, with the 3x2 doubled' },
  );

  const specials = panel.settings.group('Specials');
  bind(specials, 'Earthquake', 'eq');
  bind(specials, 'Machete', 'machete');
  bind(specials, 'Shovel', 'shovel');
  bind(specials, 'Monkey', 'monkey');
  bind(specials, 'Ants', 'ants');
  panel.settings.group('Reset').button('Reset to defaults', () => {
    Object.assign(settings, structuredClone(DEFAULT_SETTINGS));
    delete settings.roundSeconds;
    saveSettings();
    puzzleId = '0';
    pickedRandomly = false;
    store.set('puzzleId', puzzleId);
  }, { disabled: locked });

  // ---- Drawing ----

  /** A piece's image's top-left in view pixels when its anchor cell is at `at`: crates draw up from their bottom-left cell. */
  function pieceTopLeft(piece: number, [x, y]: Cell): Point {
    const up = isCrateAnchor(piece) ? CRATE_SIZES[crateSize(piece)].height - 1 : 0;
    return [x * CELL, (y - up) * CELL];
  }

  /** Ants: ant.png is 4 walking frames facing left, turned a quarter clockwise per facing, with their count. */
  function drawAnts(piece: number, x: number, y: number, alpha: number, frame: number): void {
    const ctx = screen.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(Math.trunc(x) + CELL / 2, Math.trunc(y) + CELL / 2);
    ctx.rotate((antFacing(piece) * Math.PI) / 2);
    ctx.drawImage(img('ant'), frame * CELL, 0, CELL, CELL, -CELL / 2, -CELL / 2, CELL, CELL);
    ctx.restore();
    const [nx, ny] = ANT_NUMBER_AT[antFacing(piece)];
    screen.blit(img('ant_numbers'), x + nx, y + ny, { area: [(antCount(piece) - 1) * 17, 0, 17, 17], alpha: alpha * 255 });
  }

  /** A crate's glow pulses between 40% and full behind it (ForageBoardView.c, E). */
  function glowAlpha(now: number): number {
    const t = (now % 1600) / 800;
    return 0.4 + 0.6 * (t < 1 ? t : 2 - t);
  }

  /**
   * A crate with its glow and, for fruit, gems and gold, a sparkle that plays one time in three at
   * 20 fps (ForageBoardView.c, k).
   */
  function drawCrate(piece: number, x: number, y: number, alpha: number, now: number): void {
    const size = crateSize(piece);
    const { width, height } = CRATE_SIZES[size];
    const art = game.crateArt[crateKey(piece)];
    const ctx = screen.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    const fruit = !cursed();
    if (size < 2) {
      const glow = img(`glow_${size === 0 ? 'small' : 'large'}_${fruit ? 'fruit' : 'cursed'}`);
      const off = size === 0 ? -15 : -27;
      ctx.globalAlpha = alpha * glowAlpha(now);
      ctx.drawImage(glow, x + off, y + off);
      ctx.globalAlpha = alpha;
    }
    ctx.drawImage(img(`crate${width}x${height}`), art * width * CELL, 0, width * CELL, height * CELL, x, y, width * CELL, height * CELL);
    const flash = fruit ? (size === 0 ? 'sparks_small_fruit' : size === 1 ? 'sparks_large_fruit' : art === 0 ? 'sparks_gems' : 'sparks_gold') : null;
    if (flash) {
      const sheet = img(flash);
      const fw = size === 0 ? 76 : size === 1 ? 145 : 135;
      const fh = size === 0 ? 76 : size === 1 ? 145 : 90;
      const frames = Math.floor(sheet.width / fw);
      const frame = Math.floor(now / 50) % (frames * 3);
      const off = size === 0 ? -15 : size === 1 ? -27 : 0;
      if (frame < frames) ctx.drawImage(sheet, frame * fw, 0, fw, fh, x + off, y + off, fw, fh);
    }
    ctx.restore();
  }

  /** Draws a piece with its image's top-left at view pixel (x, y). */
  function drawPiece(piece: number, x: number, y: number, alpha = 1, frame = 0, now = clock()): void {
    if (piece === EMPTY || (isCrate(piece) && !isCrateAnchor(piece))) return;
    if (isAnts(piece)) return drawAnts(piece, x, y, alpha, frame);
    if (isCrate(piece)) return drawCrate(piece, x, y, alpha, now);
    screen.blit(img('pieces'), x, y, { area: [piece * CELL, 0, CELL, CELL], ...(alpha < 1 && { alpha: alpha * 255 }) });
  }

  function drawCells(cells: readonly number[]): void {
    cells.forEach((piece, i) => {
      if (piece === EMPTY) return;
      const [x, y] = pieceTopLeft(piece, [i % WIDTH, Math.floor(i / WIDTH)]);
      drawPiece(piece, x, y);
    });
  }

  /** The step playing now, moving past finished ones; null once the move has played out. */
  /**
   * The game moves the board on once a frame, every 14ms: each step of a cascade starts on the
   * first frame after the last one's animation ends (and no sooner than the frame after it began),
   * and the board takes one more frame to call the move over before it takes a click (two if the
   * ants didn't step).
   */
  const nextFrame = (t: number) => Math.ceil(t / FRAME_MS) * FRAME_MS;

  function currentStep(now: number): [Step, number] | null {
    while (playing.length) {
      const elapsed = now - stepStart;
      if (elapsed < playing[0].duration) return [playing[0], elapsed];
      const done = playing.shift()!;
      const next = Math.max(nextFrame(stepStart + done.duration), stepStart + FRAME_MS);
      if (playing.length) {
        stepStart = next;
        startStep();
      } else {
        settledAt = next + (done.ants ? 0 : FRAME_MS);
        refitCursor();
      }
    }
    return null;
  }

  function spritePosition(s: Sprite, local: number, t: number): Point {
    const [fx, fy] = pieceTopLeft(s.piece, s.from);
    const [tx, ty] = pieceTopLeft(s.piece, s.to);
    if (s.path === 'arc') {
      // A quarter ellipse at a steady turn: up or down first, then across.
      const a = (t * Math.PI) / 2;
      return [fx + (tx - fx) * (1 - Math.cos(a)), fy + (ty - fy) * Math.sin(a)];
    }
    let y = fy + (ty - fy) * t;
    if (s.path === 'wobble' && t < 1) y += TIMING.wobblePx * Math.sin(TIMING.wobbleRate * local + (s.phase ?? 0));
    return [fx + (tx - fx) * t, y];
  }

  function drawSprite(s: Sprite, elapsed: number, now: number): void {
    const local = elapsed - s.delay;
    if (s.clear) {
      if (local >= s.duration) return;
      const alpha = local < 0 ? 1 : 1 - 0.8 * (local / Math.max(1, s.duration));
      const [x, y] = pieceTopLeft(s.piece, s.from);
      return drawPiece(s.piece, x, y, alpha, 0, now);
    }
    const t = local < 0 ? 0 : Math.min(1, local / Math.max(1, s.duration));
    const [x, y] = spritePosition(s, local, t);
    const frame = s.walk && t < 1 ? Math.floor(Math.max(0, local) / 100) % 4 : 0;
    drawPiece(s.piece, x, y, 1, frame, now);
  }

  /** The monkey: 17 frames 135px square; drops in and leaves at 1 px/ms, dances at 10 fps. */
  function drawMonkey(step: Step, elapsed: number): void {
    const sheet = img('monkey');
    for (const m of step.monkey) {
      const local = elapsed - m.delay;
      if (local < 0 || local >= m.duration) continue;
      const [bx, by] = [m.box[0] * CELL, m.box[1] * CELL];
      let y = by;
      let frame = 0;
      if (m.kind === 'drop') y = -3 * CELL + (by + 3 * CELL) * (local / m.duration);
      else if (m.kind === 'leave') {
        y = by - (by + 3 * CELL) * (local / m.duration);
        frame = 16;
      } else frame = Math.min(16, Math.floor(local / 100));
      const ctx = screen.ctx;
      ctx.save();
      if (m.facing === 1) {
        ctx.translate(LEFT + bx + 135, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(sheet, frame * 135, 0, 135, 135, 0, TOP + y, 135, 135);
      } else ctx.drawImage(sheet, frame * 135, 0, 135, 135, LEFT + bx, TOP + y, 135, 135);
      ctx.restore();
    }
  }

  /** Cleared fruit pops (piece0-4.png, 5 frames of 90px at about 13 fps) over its cell. */
  function drawPop(effect: Extract<Effect, { kind: 'pop' }>, age: number): boolean {
    const frame = Math.floor(age / (1000 / 13));
    if (frame >= TIMING.popFrames) return false;
    const [x, y] = effect.at;
    screen.blit(img(`piece${effect.piece}`), LEFT + x * CELL - 22, TOP + y * CELL - 23, { area: [frame * 90, 0, 90, 90] });
    return true;
  }

  /** Floating messages, centred over the board, rising and fading. */
  function drawText(effect: Extract<Effect, { kind: 'text' }>, age: number): boolean {
    if (age >= FLOAT_MS) return false;
    const size = Math.max(20, Math.min(32, effect.size));
    const ctx = screen.ctx;
    ctx.save();
    ctx.globalAlpha = age < FLOAT_MS / 2 ? 1 : 1 - (age - FLOAT_MS / 2) / (FLOAT_MS / 2);
    ctx.font = `${size}px "${FONT}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = cursed() ? '#2a0d3a' : '#2b1a05';
    ctx.fillStyle = cursed() ? '#e8d4ff' : '#fff2b0';
    const y = TOP + VIEW_H / 2 - (FLOAT_PX * age) / FLOAT_MS;
    ctx.strokeText(effect.text, LEFT + VIEW_W / 2, y);
    ctx.fillText(effect.text, LEFT + VIEW_W / 2, y);
    ctx.restore();
    return true;
  }

  function drawTimed(now: number, layer: 'pop' | 'text'): void {
    timed = timed.filter((t) => {
      const age = now - t.start;
      if (age < 0) return true;
      if (t.effect.kind !== layer) return true;
      return t.effect.kind === 'pop' ? drawPop(t.effect, age) : drawText(t.effect, age);
    });
  }

  function drawFlight(now: number): void {
    const f = flight!;
    const elapsed = Math.max(0, now - f.start);
    let done = true;
    for (const p of f.pieces) {
      const [cx, cy] = pieceTopLeft(p.piece, p.at);
      const t = Math.min(1, elapsed / Math.max(1, p.duration));
      if (t < 1) done = false;
      const [sx, sy, ex, ey] = f.out ? [cx, cy, p.from[0], p.from[1]] : [p.from[0], p.from[1], cx, cy];
      const a = (t * Math.PI) / 2;
      const x = sx + (ex - sx) * (1 - Math.cos(a));
      const y = sy + (ey - sy) * Math.sin(a);
      if (f.out && t >= 1) continue;
      drawPiece(p.piece, x, y, 1, 0, now);
    }
    if (done) {
      if (f.out) game.board.cells.fill(EMPTY);
      flight = null;
    }
  }

  /** How full the meter should be, 0-100%: each crate is one banana. */
  const meterTarget = () => Math.min(100, (crates * 100) / BANANAS);
  /** Every crate this board will bring has been collected. */
  // The board's done when the move that brings in its last crate ends, as the meter is still filling.
  const boardDone = () => crates >= BANANAS;

  /** Moves the drawn meter toward its target at 500ms a banana. */
  function stepMeter(now: number): void {
    const target = meterTarget();
    const elapsed = now - meterAt;
    meterAt = now;
    if (target < meterShown) meterShown = 0;
    meterShown = Math.min(target, meterShown + (elapsed * 100) / (BANANAS * BANANA_MS));
  }

  /** bananas.png: empty, full, outline. The fill spreads over the bananas from the bottom up. */
  function drawBananas(): void {
    const sheet = img('bananas');
    const total = meterShown * BANANAS;
    for (let i = 0; i < BANANAS; i++) {
      const y = METER_Y + (9 - i - 1) * BANANA_STEP;
      screen.blit(sheet, METER_X, y, { area: [0, 0, BANANA, BANANA] });
      const pct = Math.max(0, Math.min(100, total - i * 100));
      const h = Math.floor((pct * BANANA) / 100);
      if (h > 0) screen.blit(sheet, METER_X, y + BANANA - h, { area: [BANANA, BANANA - h, BANANA, h] });
    }
  }

  function drawBoard(now: number): void {
    const ctx = screen.ctx;
    ctx.save();
    // Pieces coming in from above or past the sides only show inside the board.
    ctx.beginPath();
    ctx.rect(LEFT, TOP, VIEW_W, VIEW_H);
    ctx.clip();
    ctx.translate(LEFT, TOP);
    let step: [Step, number] | null = null;
    if (flight) {
      if (!flight.out || now < flight.start) drawCells(flight.out ? game.cells : []);
      drawFlight(now);
    } else {
      step = currentStep(now);
      if (step) {
        drawCells(step[0].board);
        // Pieces waiting to be replaced go underneath, so the monkey's new pieces show over them as they fly.
        for (const s of step[0].sprites) if (s.clear) drawSprite(s, step[1], now);
        for (const s of step[0].sprites) if (!s.clear) drawSprite(s, step[1], now);
      } else drawCells(game.cells);
    }
    ctx.translate(-LEFT, -TOP);
    drawTimed(now, 'pop');
    if (step) drawMonkey(step[0], step[1]);
    ctx.restore();
    // The cursor shows while the board is in play; over a tool it shrinks to that cell.
    if (boardActive && !flight) {
      const small = toolAt(cursor[0], cursor[1]);
      screen.blit(img(small ? 'small_cursor' : 'cursor'), LEFT + cursor[0] * CELL - CURSOR_PAD, TOP + cursor[1] * CELL - CURSOR_PAD);
    }
    drawTimed(now, 'text');
  }

  function bigText(lines: string[]): void {
    const ctx = screen.ctx;
    ctx.save();
    ctx.font = `48px "${FONT}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#1a1020';
    ctx.fillStyle = '#ffffff';
    lines.forEach((line, i) => {
      const y = TOP + VIEW_H / 2 + (i - (lines.length - 1) / 2) * 56;
      ctx.strokeText(line, LEFT + VIEW_W / 2, y);
      ctx.fillText(line, LEFT + VIEW_W / 2, y);
    });
    ctx.restore();
  }

  function advanceGame(now: number): void {
    currentStep(now);
    if (flight && now >= flight.start + flightLength()) {
      if (flight.out) game.board.cells.fill(EMPTY);
      flight = null;
    }
    stepMeter(now);
    if (!boardActive) return;
    timePassed = Math.max(0, now - startTime);
    if (playing.length || flight || now < settledAt) return;
    if (!isPuzzle() && roundSeconds() > 0 && timePassed >= roundDuration()) finishScored();
    else if (pendingNextBoard) newBoard();
    else if (isPuzzle() && game.crateCount() === 0) { finishPuzzle(); outro(); }
    else if (settings.mode === 'normal' && boardDone()) finishScored();
    else if (settings.mode !== 'normal' && settings.mode !== 'puzzle' && settings.mode !== 'chaos' && boardDone()) {
      pendingNextBoard = true;
      timed.push({ effect: { kind: 'text', text: 'Great work!', size: 32, delay: 0 }, start: now });
      outro(TIMING.outroDelay);
    }
  }

  function frame(events: InputEvent[]): void {
    const liveEvents = pause.input(events, 'forage', boardActive && !ended);
    if (liveEvents === null) return;
    events = liveEvents;
    const routed = replays.frame([], [Math.round(input.mouse[0]), Math.round(input.mouse[1])], ticks());
    if (replay) {
      replay.now = routed.elapsed;
      replay.mouse = routed.mouse;
      for (const item of routed.actions) {
        clockAt = item.t;
        advanceGame(item.t);
        applyReplayAction(item.action);
        clockAt = null;
      }
    }
    const now = clock();
    if (!routed.renderOnly) {
      const pointer = replay ? replay.mouse : input.mouse;
      if (boardActive && overBoard(pointer)) cursorFromMouse(pointer);
      // While watching a replay the player's own clicks and keys don't reach the board.
      for (const event of replay ? [] : events) {
        // The game acts as the button goes down; left is anticlockwise, right clockwise.
        if (event.type === 'mousedown' && (event.button === 1 || event.button === 3) && boardActive && overBoard(event.pos)) {
          replays.action({ type: 'forage-click', data: { button: event.button, x: Math.round(event.pos[0]), y: Math.round(event.pos[1]) } });
          cursorFromMouse(event.pos);
          act(cursor, event.button === 1);
        } else if (event.type === 'mousedown' && !replay) {
          replays.action({ type: 'forage-click', data: { button: event.button, x: Math.round(event.pos[0]), y: Math.round(event.pos[1]) } });
        } else if (event.type === 'keydown') key(event.key);
      }

      advanceGame(now);
    }
    // Seeking advances the same simulation state without painting every 60 fps intermediate
    // frame, keeping long replay scrubs responsive.
    if (replays.isSeeking || replays.isAdvancing) return;
    screen.blit(img(cursed() ? 'background_cursed' : 'background'), 0, 0);
    const title = img(cursed() ? 'title_cursed' : 'title');
    screen.blit(title, Math.round((450 - title.width) / 2), Math.round((TOP - title.height) / 2));
    if (boardActive || ended || flight) drawBoard(now);
    else drawTimed(now, 'text');
    if (!boardActive && !ended && !flight) bigText(['Paused']);
    if (ended && settings.mode === 'puzzle' && !flight) bigText(['Puzzle', 'Cleared']);
    if (settings.mode !== 'puzzle') drawBananas();
    if (replay) drawReplayOverlay(now);
  }

  return { frame, dispose: () => { if (!recordedAction) replays.cancel(); replays.dispose(); sounds.dispose(); } };
}) satisfies PuzzleFactory;

/** board_pool_reserve.py's first reserve, which the desktop version used when filling puzzles. */
const RESERVE = ['xxxuuxw', 'wywvvuy', 'uxyyxwv', 'vuxvxxw', 'wwuuyxy', 'wvyyvuu', 'uxuxvwx', 'yxyywxu', 'xuwuxyx', 'wvwwxuu'];
