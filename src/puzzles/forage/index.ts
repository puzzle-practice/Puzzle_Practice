// Forage, recreated from the Puzzle Pirates game (duty/forage, build 20260909165753): the rules are
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
import { TimerWarning } from '../../core/timer-warning';
import { drawGameText, drawPauseLabel, floatAt, gameFontFor, gameTextBox, loadGameFont, FLOAT_MS } from '../../core/game-text';
import { dutyDesk } from '../../core/duty/desk';
import type { DutyReport } from '../../core/duty/report';
import type { RatingScale } from '../../core/duty/ratings';
import { historyGroup } from '../../core/history';
import { ReplayRecorder, type PuzzleReplay, type ReplayAction, type ReplaySettingsCodec } from '../../core/replay';
import { excludesUnlikelyReplays, showsReplayClicks, type GameRecord } from '../../core/storage';
import type { InputEvent, Point } from '../../core/input';
import type { Option } from '../../core/panel';
import type { PuzzleFactory } from '../../core/puzzle';
import { Random } from '../../core/random';
import { seedControls, seedFor, freshSeed } from '../../core/seeds';
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
  WIDTH,
} from './board';
import { GauntletChests, CrateRequests, CHEST_DELAY_MS, CURSED_TILES, WEREWOLF_TILES } from './crates';
import { keyMatches } from '../../core/controls';
import { copyText, pasteText } from '../../core/clipboard';
import {
  CRATE_PAINT, EMPTY_PAINT, MOON_PAINT, PAINTABLE, PIECE_NAMES, boardCode, boardIssues, fill as fillCells, lettersToCells, paint as paintCell, paintMoon, paintOf,
  readBoardCode,
} from './create';
import { type Cell, CELL, type Effect, Forage, looks, type SoundName, type Sprite, type Step, TIMING } from './engine';
import { CHEST_WEIGHTINGS, fillPuzzle, type Mode, parseBoard, randomizeColours, scramblePuzzle, type Settings } from './logic';
import type { Moon, MoonBlast } from './werewolf';
import { PUZZLES } from './puzzles';
import { EndHold } from '../../core/end-hold';

const soundUrls = import.meta.glob<string>(['./sounds/*.mp3', '!./sounds/forage_night.mp3'], { eager: true, query: '?url', import: 'default' });
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
/** Floating messages drift up 30px over 1.5s, fading out in the second half. */
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
 * or when the player dismisses it. Den and Den (Exp) are Gauntlet with Werewolf Isle's settings
 * filled in (settings.den).
 */
type ModeChoice = Mode | 'den' | 'den-exp';
const MODES: Option<ModeChoice>[] = [
  { value: 'puzzle', label: 'Puzzle' },
  { value: 'ci', label: 'Gauntlet' },
  { value: 'den', label: 'Den' },
  { value: 'den-exp', label: 'Den (Exp)' },
  { value: 'chaos', label: 'Chaos' },
  { value: 'normal', label: 'Normal' },
  { value: 'create', label: 'Freeplay' },
];
/** Freeplay mode paints with keys 1-5 (the colours), 6-9 (shovel, machete, monkey, earthquake), 0 (ants) and - (empty) held over the board. */
const PAINT_KEYS = [
  ...PAINTABLE.slice(0, 10).map((paint, i) => ({ id: `paint${i + 1}`, label: `Paint ${PIECE_NAMES[i].toLowerCase()} (Freeplay)`, defaultKey: String((i + 1) % 10), paint })),
  { id: 'paintEmpty', label: 'Paint empty (Freeplay)', defaultKey: '-', paint: EMPTY_PAINT },
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

/** Den's Maximum moons setting goes up to five. */
const MAX_MOONS = 5;

/** Modes that end and keep a best score. */
const SCORED = new Set<Mode>(['ci', 'infinite', 'normal', 'chaos', 'werewolf']);

/**
 * Normal mode's default chest mix: observed rates of 0.65, 0.345 and 0.0047 for 1x1, 2x2 and
 * 3x2, as ratios, with the 3x2 doubled.
 */
const NORMAL_RATIOS: Settings['normalRatios'] = [0.6472, 0.3435, 0.0094];

const DEFAULT_SETTINGS: Settings = {
  mode: 'ci',
  werewolfArt: false,
  moons: false,
  maxMoons: 1,
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
  rootSeed?: number;
}

/** Something drawn for a while that doesn't hold up the board. */
interface Timed {
  effect: Effect;
  start: number;
}

export default (async ({ screen, input, panel, store, ticks: rawTicks, setReplayTime: rawReplayTime }) => {
  const pause = new SessionPause(rawTicks, rawReplayTime);
  const { ticks, setReplayTime } = pause;
  const [images] = await Promise.all([Images.load(imageUrls), loadGameFont()]);
  const img = (name: string) => images.get(name);
  const rng = new Random();
  /** The pieces' flight paths in and out, seeded per session so a replay's intros last as long. */
  const flights = new Random();
  looks.random = () => flights.random();
  const sounds = new SoundBank<SoundName>(soundUrls);
  let werewolfIntroPlayed = false;
  const warning = new TimerWarning('gauntlet', () => replays?.isSeeking ?? false);

  const settings: Settings = { ...DEFAULT_SETTINGS, ...store.get<Partial<Settings>>('settings', {}) };
  settings.maxMoons = Math.min(MAX_MOONS, Math.max(1, Math.round(Number(settings.maxMoons) || 1)));
  // The initial local test exposed a separate mode. Fold saved play settings into Gauntlet.
  // Replay settings are restored separately below, preserving that version's rules.
  if (settings.mode === 'werewolf') {
    settings.mode = 'ci';
    settings.den = 'den';
    store.set('settings', settings);
  }
  // Werewolf art and moons were Gauntlet toggles before the Den modes took them over.
  if (settings.mode === 'ci' && !settings.den && settings.moons) settings.den = 'den';
  if (!settings.den) settings.werewolfArt = settings.moons = false;
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
  const werewolfBest = store.get<Record<string, number>>('werewolfBestPerMove', {});
  const legacyWerewolf = () => settings.mode === 'werewolf';
  /** Den or Den (Exp), when playing Gauntlet with a Den preset. */
  const den = () => (settings.mode === 'ci' ? settings.den : undefined);
  const werewolf = () => legacyWerewolf() || (settings.mode === 'ci' && (!!den() || !!settings.werewolfArt));
  const useMoons = () => legacyWerewolf() || (settings.mode === 'ci' && (!!den() || !!settings.moons));
  const normalMode = () => settings.mode === 'normal' || legacyWerewolf();
  const bests = () => (legacyWerewolf() ? werewolfBest : normalMode() ? normalBest : ciBest);

  /** Normal foraging looks like the fruit jungle; the rest are cursed isle boards. */
  const cursed = () => !normalMode();

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
  const moonBorn = new Map<number, number>();
  /** Each moon's phase as last drawn, and when it took that phase: a new phase shows bright. */
  const moonPhaseSince = new Map<number, { phase: number; since: number }>();
  /** When each moon's claw count last changed. */
  const moonCountSince = new Map<number, { count: number; since: number }>();
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
  /**
   * The rules a game is played by (the replay format's simulatorVersion). 2: Werewolf art and
   * moons as Gauntlet toggles. 3: Normal crates are paced (two moves, the next two-second batch,
   * then a move), and a Chaos chest whose column is blocked tries another each move. Replays play
   * by the rules they were recorded with. 4 adds native, independent per-board streams.
   * 5 overlaps the chest delay with two fresh moves, restarting only after the chest lands.
   * 6 makes the moon limit selectable, defaulting to one for new games.
   * 7 restores the one-second chest delay, keeping the overlapping click requirement.
   * 8: moons no longer keep incoming crates off their cells.
   */
  const RULES = 8;
  let rules = RULES;
  const moonLimit = (): number => rules < 6 ? 2 : settings.maxMoons ?? 1;
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
  /**
   * Game time. While watching, the replay sets ticks() to the time each recorded frame ran, from
   * the same starting point as the game it recorded, keeping the 14ms frames and chest delays
   * on the same times so playback produces the same board.
   */
  const clock = () => ticks();
  const hold = new EndHold(clock);
  game = newGame();

  const ciKey = () => {
    const base = (['bb', 'fj', 'cc', 'eq', 'machete', 'shovel', 'monkey'] as const).map((k) => (settings[k] ? 'b' : 'a')).join('') +
      (normalMode() ? settings.normalRatios.join('-') : settings.chestRatios?.join('-') ?? settings.forageLevel) +
      (settings.ants ? 'ants' : '');
    // Preserve existing scores for the original Gauntlet and Normal round lengths.
    const original = normalMode() ? 0 : 120;
    if (den()) return `${base}:${den() === 'exp' ? 'den-exp' : 'den'}${moonLimit() === 1 ? '' : `:moons:${moonLimit()}`}`;
    return base + (roundSeconds() === original ? '' : `:timer:${roundSeconds()}`) +
      (settings.mode === 'ci' && settings.werewolfArt ? ':werewolf-art' : '') +
      (settings.mode === 'ci' && settings.moons ? `:moons${moonLimit() === 1 ? ':1' : ''}` : '');
  };

  const roundSeconds = () => settings.mode === 'create' ? 0 : den() ? 300 : settings.roundSeconds ?? (settings.mode === 'ci' ? 120 : 0);
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
    const w = normalMode() ? settings.normalRatios : settings.chestRatios ?? CHEST_WEIGHTINGS[settings.forageLevel];
    return [settings.bb ? w[0] : 0, settings.fj ? w[1] : 0, settings.cc ? w[2] : 0];
  }

  /** A fresh game board from a random seed, with the mode's crates and the chosen specials. */
  const seedMode = seedControls(panel, store, () => boardActive || !!replays?.isPlaying);
  function newGame(): Forage {
    const boardIndex = replay ? nextReplayBoard : sessionSeed?.boards.length ?? 0;
    const seed = replay
      ? BigInt(sessionSeed?.boards[nextReplayBoard++] ?? 0)
      : BigInt(sessionSeed?.rootSeed !== undefined ? seedFor(sessionSeed.rootSeed, 'board', boardIndex) : freshSeed());
    if (sessionSeed?.rootSeed !== undefined) {
      rng.seed(seedFor(sessionSeed.rootSeed, 'crates', boardIndex));
      flights.seed(seedFor(sessionSeed.rootSeed, 'flights', boardIndex));
    }
    if (!replay && sessionSeed) {
      sessionSeed.boards.push(String(seed));
      replays?.updateSeed(sessionSeed);
    }
    const chestDelay = rules >= 7 ? CHEST_DELAY_MS : 2000;
    const source =
      normalMode()
        ? new CrateRequests(rng, crateWeights(), BANANAS, rules >= 3, () => clock(), rules >= 5, chestDelay)
        : settings.mode === 'puzzle' || settings.mode === 'create'
          ? {}
          : new GauntletChests(rng, crateWeights(), BANANAS, settings.mode === 'chaos', settings.mode === 'ci' && !!settings.pacedChests, () => clock(), rules >= 3, rules >= 5, chestDelay);
    const g = new Forage(seed, source, 8, useMoons(), werewolf(), settings.mode === 'create', moonLimit());
    // Shovel, machete, monkey, earthquake, ants.
    g.board.allowed = [settings.shovel, settings.machete, settings.monkey, settings.eq, settings.ants];
    if (!normalMode()) g.crateArt = [...CURSED_TILES];
    if (werewolf()) g.crateArt = [...WEREWOLF_TILES];
    if (g.moons && settings.mode !== 'create') {
      const exp = den() === 'exp';
      g.moons.blocksCrates = rules < 8;
      g.moons.eagerPhase = g.moons.chestBias = g.moons.spawnWithCrate = exp;
      g.moons.pace = exp ? 0.75 : 1;
    }
    return g;
  }

  /** Deals a board; New board keeps the clock running. */
  function newBoard(restartClock = false): void {
    pendingNextBoard = false;
    playing = [];
    timed = [];
    moonBorn.clear();
    moonPhaseSince.clear();
    moonCountSince.clear();
    game = newGame();
    crates = 0;
    meterShown = 0;
    intro(restartClock);
  }

  function start(): void {
    pause.resume();
    warning.reset();
    movesUsed = 0;
    clockwise = anticlockwise = 0;
    sessionCrates = [0, 0, 0];
    duty.clear();
    settledAt = 0;
    pendingNextBoard = false;
    ended = false;
    hold.clear();
    createStarted = settings.mode === 'create';
    paintWith = null;
    painting = false;
    pasteNote = '';
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
    // Werewolf's intro plays for the first game only.
    if (werewolf()) {
      if (!werewolfIntroPlayed && !replays?.isSeeking) sounds.play('werewolf_intro');
      werewolfIntroPlayed = true;
    } else {
      if (!replays?.isSeeking) sounds.play(cursed() ? 'cursed_intro' : 'intro');
    }
    flight = { pieces: flyingPieces(), start: clock(), out: false };
    if (game.moons) syncMoonBirth(game.moons.active, clock() + flightLength());
    // The clock starts once the pieces are in.
    if (restartClock) startTime = clock() + flightLength();
  }

  function outro(delay = 0): void {
    flight = { pieces: flyingPieces(), start: clock() + delay, out: true };
    if (!werewolf() && !replays?.isSeeking && !replays?.isPaused) window.setTimeout(() => { if (!replays.isSeeking && !replays.isPaused) sounds.play('outro'); }, delay);
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
    if (settings.scramble || replay || !store.scoresEnabled) return;
    store.addHistory(historyKey()!, { score: movesUsed, moves: movesUsed, clockwise, anticlockwise, time: timePassed, ...duty.fields(report), ...(finishedReplay ? { replayAt: finishedReplay.at, replayId: finishedReplay.runId ?? '' } : {}) });
    const best = record ?? { moves: movesUsed, time: timePassed };
    record = { moves: Math.min(best.moves, movesUsed), time: Math.min(best.time, timePassed) };
    puzzleRecords[puzzleId] = record;
    store.set('puzzleRecords', puzzleRecords);
  }

  /** Normal foraging rates a run by points per move; the other modes show total points. */
  function shownScore(): number {
    return normalMode() ? (movesUsed ? score / movesUsed : 0) : score;
  }
  const scoreText = (n: number) => (normalMode() ? n.toFixed(2) : String(n));

  /**
   * A Normal session too short to rate: ten for each move plus the seconds played comes to under
   * 95. It isn't rated, and keeps no replay, best or history.
   */
  const unrated = () => settings.mode === 'normal' && movesUsed * 10 + timePassed / 1000 < 95;

  function finishScored(): void {
    ended = true;
    boardActive = false;
    const key = ciKey();
    const best = bests();
    const final = shownScore();
    const report = endReport();
    const dropReplay = unrated() && excludesUnlikelyReplays();
    if (dropReplay && !replay) { replays.cancel(); sessionSeed = null; recordedAction = false; }
    const finishedReplay = dropReplay ? null : endRecording(normalMode() ? `${scoreText(final)} a move` : `Score ${final}`, report);
    if (store.scoresEnabled && !replay && !unrated()) {
      if (final > (best[key] ?? 0)) {
        best[key] = final;
        store.set(legacyWerewolf() ? 'werewolfBestPerMove' : normalMode() ? 'normalBestPerMove' : 'ciBest', best);
      }
      store.addHistory(historyKey()!, normalMode()
        ? { score: Number(final.toFixed(2)), points: score, moves: movesUsed, clockwise, anticlockwise, ...duty.fields(report), ...(finishedReplay ? { replayAt: finishedReplay.at, replayId: finishedReplay.runId ?? '' } : {}) }
        : { score: final, clockwise, anticlockwise, ...duty.fields(report), ...(finishedReplay ? { replayAt: finishedReplay.at, replayId: finishedReplay.runId ?? '' } : {}) });
    }
    if (store.scoresEnabled && !replay && !unrated()) bestScore = Math.max(bestScore ?? 0, final);
    // A full meter is "Great work!" in the game, and the pieces fly off a second later. Its text is the 42px level-up size (16 of 32 points).
    if (normalMode() && boardDone()) {
      timed.push({ effect: { kind: 'text', text: 'Great work!', size: 16, delay: 0 }, start: clock() });
      outro(TIMING.outroDelay);
    } else outro();
  }

  /** The session's duty report: what it's rated on depends on the mode. */
  function endReport(): DutyReport {
    const gauntlet = settings.mode === 'ci' || settings.mode === 'chaos';
    const performance = unrated() ? duty.rate(null, null) : settings.mode === 'normal' ? duty.rate('normal', shownScore())
      : gauntlet ? duty.rate('gauntletPoints', score) : duty.rate(null, null);
    return duty.end({
      mode: legacyWerewolf() ? 'Werewolf' : MODES.find((m) => m.value === modeChoice())?.label,
      performance,
      unrated: unrated(),
      score: isPuzzle() ? { label: 'Moves', value: String(movesUsed) }
        : { label: normalMode() ? 'Points a move' : 'Score', value: scoreText(shownScore()) },
      cleared: [{ label: 'Crates Collected', inScore: true, items: [
        { icon: werewolf() ? 'werewolf-chest-small' : 'ci-bone-box', label: werewolf() ? 'small treasure crates' : 'bone boxes', count: sessionCrates[0] },
        { icon: werewolf() ? 'werewolf-chest-medium' : 'ci-fetish-jar', label: werewolf() ? 'medium treasure crates' : 'fetish jars', count: sessionCrates[1] },
        { icon: werewolf() ? 'werewolf-chest-large' : 'ci-cursed-chest', label: werewolf() ? 'large treasure crates' : 'cursed chests', count: sessionCrates[2] },
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
      if (normalMode()) score += result.points;
      else if (settings.mode !== 'puzzle') score += result.gauntletPoints;
      crates += result.collected[0] + result.collected[1] + result.collected[2];
      sessionCrates = sessionCrates.map((n, i) => n + result.collected[i]);
      // The score sound, by the move's game points (Werewolf howls whatever the points).
      if (result.points > 0 && !(normalMode() && crates >= BANANAS)) {
        const last = game.steps[game.steps.length - 1];
        last.sounds.push({ name: werewolf() ? 'chest_howl' : result.points > 14 ? 'score_big' : result.points > 7 ? 'score_medium' : 'score_small', delay: last.duration });
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
    if (step.moons) syncMoonBirth(step.moons, stepStart);
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
    if (boardActive && normalMode()) {
      if (movesUsed) {
        playing = [];
        finishScored();
      } else {
        boardActive = false;
        ended = true;
        const report = endReport();
        // A short session with no moves keeps no replay either, as a short scored one doesn't.
        if (unrated() && excludesUnlikelyReplays() && !replay) { replays.cancel(); sessionSeed = null; recordedAction = false; }
        else endRecording(`Dismissed, ${movesUsed} moves`, report);
      }
    } else if (boardActive) {
      boardActive = false;
      ended = true;
      endRecording(settings.mode === 'puzzle' ? `Puzzle ${puzzleId}, stopped` : `Stopped, ${movesUsed} moves`, endReport());
    } else {
      const rootSeed = seedMode.next();
      sessionSeed = { format: 'forage-replay-state', rootSeed, seeds: [seedFor(rootSeed, 'crates'), seedFor(rootSeed, 'flights')], boards: [] };
      // A game taken over from a replay kept that replay's rules; a new one plays by today's.
      rules = RULES;
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
    if (!replay && !boardActive) return;
    // Watching: the player's own settings go back. Playing (a setting changed): the game is dropped.
    const saved = replay?.saved ?? { settings: structuredClone(settings), puzzleId, pickedRandomly };
    replay = null;
    rules = RULES;
    sessionSeed = null;
    recordedAction = false;
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
    if (action.type.startsWith('forage-create-')) { edit(action); return; }
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

  // ---- Freeplay mode ----

  /** The palette piece a left click places, the piece a held key paints, and whether a drag is painting. */
  let palettePaint: number | null = null;
  let paintWith: number | null = null;
  let painting = false;
  let pasteNote = '';
  /** The phase (4 new to 1) and claws (0-3) a painted moon gets. */
  let moonPhase = 4;
  let moonClaws = 0;
  let createStarted = false;
  const creating = () => boardActive && !ended && createStarted;
  /** The board can change once nothing on it is moving. */
  const editable = () => creating() && inPlay();
  /** Freeplay mode: a change to the board, recorded as it's made so replays repeat it in order. */
  function edit(action: ReplayAction): void {
    if (!editable()) return;
    const data = action.data && typeof action.data === 'object' ? action.data as Record<string, unknown> : {};
    const cells = [...game.cells];
    let changed = false;
    if (action.type === 'forage-create-paint' && Number.isInteger(data.x) && Number.isInteger(data.y) && Number.isInteger(data.paint)) {
      changed = paintCell(cells, data.x as number, data.y as number, data.paint as number);
    } else if (action.type === 'forage-create-moon' && game.moons && [data.x, data.y, data.phase, data.charge].every(Number.isInteger)) {
      changed = paintMoon(game.moons, data.x as number, data.y as number, data.phase as number, data.charge as number);
    } else if (action.type === 'forage-create-fill' && Number.isInteger(data.paint)) changed = fillCells(cells, data.paint as number);
    else if (action.type === 'forage-create-load' && typeof data.code === 'string') {
      const read = readBoardCode(data.code);
      if (read) {
        read.cells.forEach((p, i) => (cells[i] = p));
        game.moons?.clear(0, 0, WIDTH, HEIGHT);
        for (const m of read.moons) game.moons?.place(m.x, m.y, m.phase, m.charge);
        changed = true;
      }
    }
    if (!changed) return;
    game.load(cells);
    refitCursor();
    if (!replay) {
      replays.action(action);
      recordedAction = true;
    }
  }
  const cellAt = ([mx, my]: Point): Cell | null => {
    const x = Math.floor((mx - LEFT) / CELL), y = Math.floor((my - TOP) / CELL);
    return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT ? [x, y] : null;
  };
  const paintAt = (pos: Point, paint: number) => {
    const at = cellAt(pos);
    if (at && paint === MOON_PAINT) edit({ type: 'forage-create-moon', data: { x: at[0], y: at[1], phase: moonPhase, charge: moonClaws } });
    else if (at && paintOf(game.board.getPiece(at[0], at[1])) !== paint) edit({ type: 'forage-create-paint', data: { x: at[0], y: at[1], paint } });
  };

  /** While watching: the recorded mouse pointer, a ring where each click landed, and the speed. */
  function drawReplayOverlay(now: number): void {
    const r = replay!;
    const ctx = screen.ctx;
    ctx.save();
    r.clicks = r.clicks.filter((c) => now - c.t < 400);
    for (const c of showsReplayClicks() ? r.clicks : []) {
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

  let lastPointer: Point = [-1, -1];

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
  const modeChoice = (): ModeChoice => (den() ? (den() === 'exp' ? 'den-exp' : 'den') : settings.mode);
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
    group.toggle(label, () => !!get(), set, { hidden });
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
    ...PAINT_KEYS.map(({ id, label, defaultKey }) => ({ id, label, defaultKey })),
  ]);
  const session = panel.session();
  session.select('Mode', MODES, modeChoice, (value) => {
    // The Den modes are Gauntlet with Werewolf Isle's settings filled in.
    settings.mode = value === 'den' || value === 'den-exp' ? 'ci' : value;
    settings.den = value === 'den' ? 'den' : value === 'den-exp' ? 'exp' : undefined;
    settings.werewolfArt = settings.moons = false;
    saveSettings();
  }, {});
  session.number(
    'Puzzle',
    () => Number(puzzleId),
    (n) => {
      puzzleId = n in PUZZLES ? String(n) : '0';
      pickedRandomly = false;
      store.set('puzzleId', puzzleId);
    },
    { min: 0, hidden: () => !isPuzzle(), title: '0 picks a puzzle at random' },
  );
  const actions = panel.group();
  actions
    // Starting while a replay is open closes it and starts a game of your own.
    .button('Start', () => { if (replays.isPlaying) { replays.stop(); if (replays.isPlaying) return; } toggleRunning(); }, {
      variant: 'primary',
      label: () => (replay || !boardActive ? 'Start' : normalMode() ? 'Dismiss' : 'Stop'),
    })
    .button('New board', () => {
      if (!replay) replays.action({ type: 'forage-new-board' });
      newBoard();
    }, {
      disabled: () => isPuzzle() || normalMode() || !boardActive || !!replay,
      title: 'Deal a fresh board and bananas without restarting the clock; crates from a move still playing out still count',
    });

  // The board's text can be copied in any mode, and pasted, dealt anew or painted while playing in Freeplay.
  const createOnly = () => settings.mode !== 'create';
  const editing = () => !editable() || pause.paused || !!replay;
  const boardGroup = panel.group('Board');
  // Outside Freeplay an empty cell is a board still settling.
  boardGroup.button('Copy', () => copyText(boardCode(game.cells, game.moons?.active), 'Copy this board:'),
    { disabled: () => !creating() && game.cells.some((p) => p === EMPTY), title: 'Copy the board' });
  boardGroup.button('Paste', () => void pasteText('Paste a board:').then((text) => {
    if (text === null) return;
    if (readBoardCode(text)) { pasteNote = ''; edit({ type: 'forage-create-load', data: { code: text.trim() } }); }
    else pasteNote = 'That isn’t a Foraging board. Boards copied here start with F.';
  }), { hidden: createOnly, disabled: editing, title: 'Play a board from a pasted copy' });
  boardGroup.button('Generate', () => {
    replays.action({ type: 'forage-new-board' });
    recordedAction = true;
    newBoard();
    window.setTimeout(() => copyText(boardCode(game.cells, game.moons?.active), 'Copy this board:'), 50);
  }, { hidden: createOnly, disabled: editing, title: 'Deal a new board and copy it' });
  const palette = document.createElement('div');
  palette.className = 'piece-palette';
  PAINTABLE.forEach((paint, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-button';
    const icon = document.createElement('canvas');
    icon.width = icon.height = CELL;
    icon.setAttribute('aria-hidden', 'true');
    const iconCtx = icon.getContext('2d')!;
    const crate = CRATE_PAINT.indexOf(paint);
    if (crate >= 0) {
      const { width, height } = CRATE_SIZES[crate], scale = 1 / Math.max(width, height);
      // Freeplay plays on cursed isle boards, so its crates are the cursed ones.
      iconCtx.drawImage(img(`crate${width}x${height}`), CURSED_TILES[crate] * width * CELL, 0, width * CELL, height * CELL, 0, (CELL - height * CELL * scale) / 2, width * CELL * scale, height * CELL * scale);
    } else if (paint === 9) iconCtx.drawImage(img('ant'), 0, 0, CELL, CELL, 0, 0, CELL, CELL);
    else if (paint === MOON_PAINT) iconCtx.drawImage(img('moon_phase'), 45, 45, 90, 90, 0, 0, CELL, CELL);
    else if (paint === EMPTY_PAINT) {
      iconCtx.strokeStyle = '#8a8a8a';
      iconCtx.setLineDash([4, 3]);
      iconCtx.strokeRect(2.5, 2.5, CELL - 5, CELL - 5);
    } else iconCtx.drawImage(img('pieces'), paint * CELL, 0, CELL, CELL, 0, 0, CELL, CELL);
    button.append(icon, document.createTextNode(i < 10 ? `${(i + 1) % 10} · ${PIECE_NAMES[i]}` : paint === EMPTY_PAINT ? `- · ${PIECE_NAMES[i]}` : PIECE_NAMES[i]));
    button.addEventListener('click', () => { palettePaint = palettePaint === paint ? null : paint; panel.used(); });
    panel.addSync(() => {
      button.disabled = !creating();
      button.setAttribute('aria-pressed', String(palettePaint === paint));
    });
    palette.append(button);
  });
  boardGroup.append(palette, { hidden: createOnly });
  boardGroup.select('Moon phase', [4, 3, 2, 1].map((value) => ({ value, label: ['', '1, its last', '2', '3', '4, new'][value] })), () => moonPhase, (value) => { moonPhase = value; },
    { hidden: createOnly, title: 'The phase a painted moon starts at: it wanes a phase after each move that clears pieces, and is gone after the last' });
  boardGroup.select('Moon claws', [0, 1, 2, 3].map((value) => ({ value, label: String(value) })), () => moonClaws, (value) => { moonClaws = value; },
    { hidden: createOnly, title: 'Pieces already cleared inside a painted moon: the fourth fires it' });
  boardGroup.button('Fill board', () => edit({ type: 'forage-create-fill', data: { paint: palettePaint !== null && !CRATE_PAINT.includes(palettePaint) && palettePaint !== MOON_PAINT ? palettePaint : 0 } }),
    { hidden: createOnly, disabled: editing, title: 'Make every cell the selected colour or special, or empty' });
  boardGroup.note(() => pasteNote, { hidden: createOnly });
  boardGroup.note(() => {
    const issues = boardIssues(game.cells, game.moons?.active);
    return issues.length ? `Not a board the game could deal: ${issues.join(' ')}` : '';
  }, { hidden: () => createOnly() || !boardActive || ended });

  panel.score().stats(['', 'Now', 'Best'], () => [[
    isPuzzle() ? 'Moves' : normalMode() ? 'Points / move' : 'Score',
    isPuzzle() ? String(movesUsed) : scoreText(shownScore()),
    isPuzzle() ? !settings.scramble && record ? String(record.moves) : '' : bestScore !== null ? scoreText(bestScore) : '',
  ]]);
  const duty = dutyDesk(panel, store, 'forage', 'Foraging', RATING_SCALES, {
    shown: (id) => (id === 'normal' ? settings.mode === 'normal' : settings.mode === 'ci' || settings.mode === 'chaos'),
  });
  panel.results(() => ended && !flight && !hold.holding ? {
    title: 'Foraging results',
    report: duty.last,
    rows: [
      [isPuzzle() ? 'Moves' : 'Score', isPuzzle() ? String(movesUsed) : scoreText(shownScore())],
      ['Time', `${(timePassed / 1000).toFixed(2)}s`],
      ...(isPuzzle() ? [] : [['Moves', String(movesUsed)]]),
      ['Clockwise, anticlockwise', `${clockwise}, ${anticlockwise}`],
      // Points are the score except in Normal, where the score is points a move.
      ...(normalMode() ? [['Points', String(score)]] : []),
      ...(unrated() ? [['Rating', excludesUnlikelyReplays() ? 'Unrated: not saved' : 'Unrated: replay only']] : []),
    ],
    averages: duty.averages(historyKey() ? store.sessionHistory(historyKey()!) : null, isPuzzle()
      ? { scoreLabel: 'Moves', lowerIsBetter: true, digits: 1 }
      : { scoreLabel: normalMode() ? 'Points a move' : 'Score' }),
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
  historyGroup(panel, historyFor('werewolf'), [
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
    currentVersion: 2,
    simulatorVersion: RULES,
    migrate: (version, value) => {
      if ((version !== 1 && version !== 2) || !value || typeof value !== 'object') return null;
      const s = value as Record<string, unknown>;
      const ratios = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n) && (n as number) >= 0);
      return ['puzzle', 'ci', 'normal', 'chaos', 'werewolf', 'create'].includes(String(s.mode)) &&
        Number.isInteger(s.forageLevel) && (s.forageLevel as number) >= 0 && (s.forageLevel as number) <= 15 &&
        ['bb', 'fj', 'cc', 'eq', 'machete', 'shovel', 'monkey', 'ants', 'scramble'].every((key) => typeof s[key] === 'boolean') &&
        ['werewolfArt', 'moons'].every((key) => s[key] === undefined || typeof s[key] === 'boolean') &&
        (s.maxMoons === undefined || (Number.isInteger(s.maxMoons) && (s.maxMoons as number) >= 1 && (s.maxMoons as number) <= MAX_MOONS)) &&
        (s.den === undefined || s.den === 'den' || s.den === 'exp') &&
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
      (seed.rootSeed === undefined || (Number.isSafeInteger(seed.rootSeed) && seed.rootSeed >= 0 && seed.rootSeed <= 0xffffffff)) &&
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
    rules = tape.simulatorVersion ?? 1;
    sessionSeed = structuredClone(tape.seed);
    nextReplayBoard = 0;
    meterAt = 0;
    boardActive = true;
    start();
  }, stopReplay, isForageReplaySeed, setReplayTime, () => frame([]), replaySettingsCodec, () => !boardActive || !!replay);
  replays.onTakeOver = () => {
    // The game carries on as the player's: only the boards dealt so far are part of it.
    replay = null;
    sessionSeed = sessionSeed ? { ...sessionSeed, boards: sessionSeed.boards.slice(0, nextReplayBoard) } : null;
    if (sessionSeed) replays.updateSeed(sessionSeed);
    recordedAction = true;
  };
  // What decides how the game goes on; replays check it after every recorded input.
  replays.fingerprint = () => [game.cells.join(','), score, movesUsed, crates, clockwise, anticlockwise,
    settledAt, playing.length, pendingNextBoard, ended, boardActive, JSON.stringify(rng.snapshot())].join('|');

  const setup = panel.settings.group('Game');
  setup.select('Timer', [0, 30, 120, 300].map((value) => ({ value, label: value ? `${value} seconds` : 'No timer' })), roundSeconds, (value) => { settings.roundSeconds = value; saveSettings(); }, { hidden: () => isPuzzle() || !!den() });
  bind(setup, 'Scramble', 'scramble', () => !isPuzzle());

  const crateGroup = panel.settings.group('Crates');
  bind(crateGroup, 'Bone box', 'bb', werewolf);
  bind(crateGroup, 'Fetish jar', 'fj', werewolf);
  bind(crateGroup, 'Cursed chest', 'cc', werewolf);
  bind(crateGroup, 'Small treasure', 'bb', () => !werewolf());
  bind(crateGroup, 'Medium treasure', 'fj', () => !werewolf());
  bind(crateGroup, 'Large treasure', 'cc', () => !werewolf());

  const ratios = panel.settings.group('Chest ratios', { columns: 3, hidden: isPuzzle });
  (['1x1', '2x2', '3x2'] as const).forEach((label, i) =>
    ratios.number(
      label,
      () => normalMode() ? settings.normalRatios[i] : (settings.chestRatios ?? CHEST_WEIGHTINGS[settings.forageLevel])[i],
      (value) => {
        if (normalMode()) settings.normalRatios[i] = value;
        else { settings.chestRatios ??= [...CHEST_WEIGHTINGS[settings.forageLevel]]; settings.chestRatios[i] = value; }
        saveSettings();
      },
      { min: 0, step: 0.0001 },
    ),
  );
  ratios.select('Forage preset', Array.from({ length: 16 }, (_, value) => ({ value, label: String(value) })), setting('forageLevel').get,
    (level) => { settings.forageLevel = level; settings.chestRatios = undefined; saveSettings(); }, {
    hidden: () => normalMode(),
    title: 'Changes chest spawn rates only',
  });
  ratios.button(
    'Defaults',
    () => {
      if (normalMode()) settings.normalRatios = [...NORMAL_RATIOS];
      else settings.chestRatios = undefined;
      saveSettings();
    },
    { title: 'Rates of 0.65, 0.345 and 0.0047 as ratios, with the 3x2 doubled' },
  );

  const specials = panel.settings.group('Specials');
  bind(specials, 'Earthquake', 'eq');
  bind(specials, 'Machete', 'machete');
  bind(specials, 'Shovel', 'shovel');
  bind(specials, 'Monkey', 'monkey', werewolf);
  bind(specials, 'Wolf', 'monkey', () => !werewolf());
  bind(specials, 'Ants', 'ants');
  specials.select('Maximum moons', Array.from({ length: MAX_MOONS }, (_, i) => ({ value: i + 1, label: String(i + 1) })), moonLimit,
    (value) => { settings.maxMoons = value; saveSettings(); },
    { hidden: () => !den(), title: 'Maximum moons on the board at once; applies to the next game' });
  panel.settings.group('Reset').button('Reset to defaults', () => {
    Object.assign(settings, structuredClone(DEFAULT_SETTINGS));
    delete settings.roundSeconds;
    saveSettings();
    puzzleId = '0';
    pickedRandomly = false;
    store.set('puzzleId', puzzleId);
  }, {});

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
    const flash = werewolf() ? (size === 0 ? 'sparks_small_chest' : size === 1 ? 'sparks_medium_chest' : 'sparks_big_chest')
      : fruit ? (size === 0 ? 'sparks_small_fruit' : size === 1 ? 'sparks_large_fruit' : art === 0 ? 'sparks_gems' : 'sparks_gold') : null;
    if (flash) {
      const sheet = img(flash);
      const fw = werewolf() ? width * CELL : size === 0 ? 76 : size === 1 ? 145 : 135;
      const fh = werewolf() ? height * CELL : size === 0 ? 76 : size === 1 ? 145 : 90;
      const frames = Math.floor(sheet.width / fw);
      const frame = Math.floor(now / 50) % (frames * 3);
      const off = werewolf() ? 0 : size === 0 ? -15 : size === 1 ? -27 : 0;
      if (frame < frames) ctx.drawImage(sheet, frame * fw, 0, fw, fh, x + off, y + off, fw, fh);
    }
    ctx.restore();
  }

  /** Draws a piece with its image's top-left at view pixel (x, y). */
  function drawPiece(piece: number, x: number, y: number, alpha = 1, frame = 0, now = clock()): void {
    if (piece === EMPTY || (isCrate(piece) && !isCrateAnchor(piece))) return;
    if (isAnts(piece)) return drawAnts(piece, x, y, alpha, frame);
    if (isCrate(piece)) return drawCrate(piece, x, y, alpha, now);
    screen.blit(img('pieces'), x, y, { area: [(werewolf() && piece === 7 ? 9 : piece) * CELL, 0, CELL, CELL], ...(alpha < 1 && { alpha: alpha * 255 }) });
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
    const ctx = screen.ctx;
    const local = elapsed - s.delay;
    if (s.clear) {
      if (local >= s.duration) return;
      if (s.moonClear && local >= 0) {
        const [x, y] = pieceTopLeft(s.piece, s.from);
        ctx.save();
        ctx.filter = 'brightness(0) invert(1)';
        drawPiece(s.piece, x, y, local < 120 ? 1 : Math.max(0, 1 - (local - 120) / 250), 0, now);
        ctx.restore();
        return;
      }
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

  function drawWolf(step: Step, elapsed: number): void {
    const wolf = step.wolf;
    if (!wolf || elapsed >= wolf.duration) return;
    const frame = wolf.firstFrame + Math.min(4, Math.floor(elapsed / 100));
    screen.blit(img('wolf_head'), LEFT + wolf.box[0] * CELL, TOP + wolf.box[1] * CELL, { area: [frame * 225, 0, 225, 225] });
  }

  /** Moon art is 180px square around a fixed 2x2 area. */
  function moonImage(name: string, frame: number, moon: Moon, alpha = 1): void {
    screen.blit(img(name), (moon.x - 1) * CELL, (moon.y - 1) * CELL, { area: [frame * 180, 0, 180, 180], alpha: alpha * 255 });
  }

  /** Track births during simulation too, so seeking does not restart appearance animations. */
  function syncMoonBirth(moons: readonly Moon[], now: number): void {
    const present = new Set(moons.map((m) => m.id));
    for (const id of moonBorn.keys()) if (!present.has(id)) moonBorn.delete(id);
    for (const id of moonPhaseSince.keys()) if (!present.has(id)) moonPhaseSince.delete(id);
    for (const id of moonCountSince.keys()) if (!present.has(id)) moonCountSince.delete(id);
    for (const moon of moons) if (!moonBorn.has(moon.id)) moonBorn.set(moon.id, now);
  }

  function drawMoons(moons: readonly Moon[], now: number): void {
    syncMoonBirth(moons, now);
    for (const moon of moons) {
      const age = Math.max(0, now - moonBorn.get(moon.id)!);
      if (age < 500) moonImage('moon_appear', Math.min(5, Math.floor(age * 6 / 500)), moon);
      else {
        // A new phase or claw count shows at full strength for 250ms, then fades over 250ms to 60%.
        const fade = (shown: number) => shown < 250 ? 1 : 1 - 0.4 * Math.min(1, (shown - 250) / 250);
        const seen = moonPhaseSince.get(moon.id);
        if (!seen || seen.phase !== moon.phase) moonPhaseSince.set(moon.id, { phase: moon.phase, since: seen ? now : moonBorn.get(moon.id)! + 500 });
        const shown = now - moonPhaseSince.get(moon.id)!.since;
        moonImage('moon_phase', Math.min(3, Math.max(0, 4 - moon.phase)), moon, fade(shown));
        const count = Math.min(moon.charge, 3);
        const counted = moonCountSince.get(moon.id);
        if (!counted || counted.count !== count) moonCountSince.set(moon.id, { count, since: now });
        if (count > 0) moonImage('moon_counter', count - 1, moon, fade(Math.min(shown, now - moonCountSince.get(moon.id)!.since)));
      }
    }
  }

  /** The beams grow one cell per 40ms, beginning 350ms after the moon fires. */
  function drawMoonEffect(effect: Extract<Effect, { kind: 'moon' }>, shownFor: number): boolean {
    const { moon, blast } = effect;
    // Den (Exp)'s moons play out at 4/3 speed.
    const age = shownFor / (effect.pace ?? 1);
    if (!blast) {
      if (age >= 400) return false;
      moonImage('moon_phase', Math.min(3, 4 - Math.max(1, moon.phase)), moon, 0.6 * (1 - age / 400));
      return true;
    }
    if (age < 350) {
      moonImage('moon_phase', 4 - Math.max(1, moon.phase), moon, 0.6);
      moonImage('moon_counter', 2, moon);
      return true;
    }
    const local = age - 350;
    const last = (Math.max(0, ...blast.cells.values()) - 1) * 40;
    if (local >= Math.max(500, last + 300)) return false;
    const alpha = local <= last ? 1 : Math.max(0, 1 - (local - last) / 300);
    drawRays(blast, 1 + local / 40, alpha);
    if (local < 500) moonImage('moon_clear', Math.min(6, Math.floor(local * 7 / 500)), moon, 1);
    if (local <= last) moonImage('moon_counter', 2, moon, 1);
    return true;
  }

  function drawRays(blast: MoonBlast, length: number, alpha: number): void {
    const ctx = screen.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const ray of blast.rays) {
      ctx.beginPath();
      ctx.moveTo(ray[0] * CELL / 2, ray[1] * CELL / 2);
      let travelled = 0;
      for (let i = 2; i + 1 < ray.length && travelled < length; i += 2) {
        const dx = ray[i] - ray[i - 2], dy = ray[i + 1] - ray[i - 1];
        const segment = Math.max(Math.abs(dx), Math.abs(dy)) / 2;
        const portion = Math.min(1, (length - travelled) / segment);
        ctx.lineTo((ray[i - 2] + dx * portion) * CELL / 2, (ray[i - 1] + dy * portion) * CELL / 2);
        travelled += segment;
      }
      ctx.lineWidth = CELL * 0.4;
      ctx.strokeStyle = `rgba(150,215,255,${90 / 255 * alpha})`;
      ctx.stroke();
      ctx.lineWidth = CELL * 0.12;
      ctx.strokeStyle = `rgba(240,250,255,${230 / 255 * alpha})`;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Cleared fruit pops (piece0-4.png, 5 frames of 90px at about 13 fps) over its cell. */
  function drawPop(effect: Extract<Effect, { kind: 'pop' }>, age: number): boolean {
    const frame = Math.floor(age / (1000 / 13));
    if (frame >= TIMING.popFrames) return false;
    const [x, y] = effect.at;
    screen.blit(img(`piece${effect.piece}`), LEFT + x * CELL - 22, TOP + y * CELL - 23, { area: [frame * 90, 0, 90, 90] });
    return true;
  }

  /** Floating messages centred on the board, sized by their points (GameFonts.get(points, 32)). */
  function drawText(effect: Extract<Effect, { kind: 'text' }>, age: number): boolean {
    if (age >= FLOAT_MS) return false;
    const style = { px: gameFontFor(effect.size, 32), align: 'center' as const };
    const { dy, alpha } = floatAt(age);
    const { h } = gameTextBox(screen.ctx, effect.text, style);
    drawGameText(screen.ctx, effect.text, LEFT + VIEW_W / 2, TOP + (VIEW_H - h) / 2 + dy, { ...style, alpha });
    return true;
  }

  function drawTimed(now: number, layer: 'pop' | 'text' | 'moon'): void {
    timed = timed.filter((t) => {
      const age = now - t.start;
      if (age < 0) return true;
      if (t.effect.kind !== layer) return true;
      return t.effect.kind === 'pop' ? drawPop(t.effect, age) : t.effect.kind === 'moon' ? drawMoonEffect(t.effect, age) : drawText(t.effect, age);
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
    if (!flight) {
      step = currentStep(now);
    }
    if (flight) {
      if (!flight.out || now < flight.start) drawCells(flight.out ? game.cells : []);
      drawFlight(now);
    } else {
      if (step) {
        drawCells(step[0].board);
        // Pieces waiting to be replaced go underneath, so the monkey's new pieces show over them as they fly.
        for (const s of step[0].sprites) if (s.clear) drawSprite(s, step[1], now);
        for (const s of step[0].sprites) if (!s.clear) drawSprite(s, step[1], now);
      } else drawCells(game.cells);
    }
    if (!flight && (boardActive || step || game.cells.some((p) => p !== EMPTY))) {
      drawMoons(step?.[0].moons ?? game.moons?.active ?? [], now);
      drawTimed(now, 'moon');
    }
    ctx.translate(-LEFT, -TOP);
    drawTimed(now, 'pop');
    if (step) drawMonkey(step[0], step[1]);
    if (step) drawWolf(step[0], step[1]);
    ctx.restore();
    // The cursor shows while the board is in play; over a tool it shrinks to that cell.
    if (boardActive && !flight) {
      const small = toolAt(cursor[0], cursor[1]);
      screen.blit(img(small ? 'small_cursor' : 'cursor'), LEFT + cursor[0] * CELL - CURSOR_PAD, TOP + cursor[1] * CELL - CURSOR_PAD);
    }
    drawTimed(now, 'text');
  }

  function bigText(lines: string[]): void {
    drawPauseLabel(screen.ctx, lines.join('\n'), LEFT + VIEW_W / 2, TOP + VIEW_H / 2, VIEW_W);
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
    if (now >= startTime) warning.update(!isPuzzle() && roundSeconds() > 0 ? roundDuration() - timePassed : null);
    if (playing.length || flight || now < settledAt) return;
    // Time's up once the last move has played out; the board stays in view a moment before the results.
    if (!isPuzzle() && roundSeconds() > 0 && timePassed >= roundDuration()) { finishScored(); hold.start(); }
    else if (pendingNextBoard) newBoard();
    else if (isPuzzle() && game.crateCount() === 0) { finishPuzzle(); outro(); }
    else if (normalMode() && boardDone()) finishScored();
    else if (!normalMode() && settings.mode !== 'puzzle' && settings.mode !== 'chaos' && settings.mode !== 'create' && boardDone()) {
      pendingNextBoard = true;
      timed.push({ effect: { kind: 'text', text: 'Great work!', size: 16, delay: 0 }, start: now });
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
        advanceGame(clock());
        applyReplayAction(item.action);
      }
    }
    const now = clock();
    if (!routed.renderOnly) {
      const pointer = replay ? replay.mouse : input.mouse;
      if (boardActive && overBoard(pointer)) cursorFromMouse(pointer);
      if (!replay && creating() && (pointer[0] !== lastPointer[0] || pointer[1] !== lastPointer[1])) {
        if (paintWith !== null) paintAt(pointer, paintWith);
        else if (painting && palettePaint !== null && palettePaint !== MOON_PAINT) paintAt(pointer, palettePaint);
      }
      lastPointer = [pointer[0], pointer[1]];
      // While watching a replay the player's own clicks and keys don't reach the board.
      for (const event of replay ? [] : events) {
        if (creating() && event.type === 'mousedown' && event.button === 1 && palettePaint !== null && overBoard(event.pos)) {
          paintAt(event.pos, palettePaint);
          painting = true;
          continue;
        }
        if (event.type === 'mouseup' && event.button === 1) painting = false;
        if (creating() && event.type === 'mousedown' && (event.button === 4 || event.button === 5)) {
          // The wheel cycles the colour or special under the pointer.
          const at = cellAt(event.pos);
          const i = at ? PAINTABLE.indexOf(paintOf(game.board.getPiece(at[0], at[1]))) : -1;
          if (at && i >= 0 && i < 10) paintAt(event.pos, PAINTABLE[(i + (event.button === 4 ? 1 : 9)) % 10]);
          continue;
        }
        const paintKey = event.type === 'keydown' || event.type === 'keyup' ? PAINT_KEYS.find((k) => keyMatches(event.key, 'forage', k.id, k.defaultKey)) : undefined;
        if (paintKey) {
          if (!creating()) continue;
          if (event.type === 'keydown') { paintWith = paintKey.paint; paintAt(input.mouse, paintKey.paint); }
          else if (paintWith === paintKey.paint) paintWith = null;
          continue;
        }
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
    screen.blit(img(werewolf() ? 'background_werewolf' : cursed() ? 'background_cursed' : 'background'), 0, 0);
    const title = img(cursed() ? 'title_cursed' : 'title');
    screen.blit(title, Math.round((450 - title.width) / 2), Math.round((TOP - title.height) / 2));
    if (boardActive || ended || flight) drawBoard(now);
    else drawTimed(now, 'text');
    if (!boardActive && !ended && !flight) bigText(['Paused']);
    if (ended && settings.mode === 'puzzle' && !flight) bigText(['Puzzle', 'Cleared']);
    if (settings.mode !== 'puzzle') drawBananas();
    if (replay) drawReplayOverlay(now);
  }

  // Opening a replay file ends a game in progress, as its Stop button would.
  replays.setStopLive(() => { if (boardActive && !replay) toggleRunning(); });
  return { frame, dispose: () => { if (!recordedAction) replays.cancel(); replays.dispose(); sounds.dispose(); warning.dispose(); } };
}) satisfies PuzzleFactory;

/** Initial reserve used when filling hand-made puzzles. */
const RESERVE = ['xxxuuxw', 'wywvvuy', 'uxyyxwv', 'vuxvxxw', 'wwuuyxy', 'wvyyvuu', 'uxuxvwx', 'yxyywxu', 'xuwuxyx', 'wvwwxuu'];
