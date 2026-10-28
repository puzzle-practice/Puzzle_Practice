// Carpentry: the Vampire Lair's carpentry and a ship's, recreated from the Puzzle Pirates game
// (duty/carpentry, build 20260909165753; ship carpentry and its maneuver tokens checked against
// test build 20261017062155). The rules are in board.ts and game.ts; this file is
// CarpentryPanel and CarpentryBoardView with their sprites: the game's art, the wood deck that
// scrolls, holes with splintered ends that blink and grow, pieces cut from the wood textures and
// outlined by state, the putty bucket and its blood, rattling and flying pieces, the floating
// ratings and the star meter. The canvas is the 450x600 puzzle panel; settings and scores are in
// the side panel.
//
// On top of the game are the Vampire Carp simulator's modes and features: two-minute
// sessions scored +2 / +1 / -1, Ghost (placed pieces hidden), Speed (small holes, see game.ts),
// Unlimited, seeds, cheat pieces, pause, Dismiss, best scores, and the end-of-session stats. Ship
// carpentry sessions are two minutes too, scored by the holes' own points, at a chosen difficulty
// and token pool; tokens on planks are drawn from the game's bonus.png quarters.
import { Images } from '../../core/assets';
import { SoundBank } from '../../core/audio';
import { TimerWarning } from '../../core/timer-warning';
import { copyText, pasteText } from '../../core/clipboard';
import { keyMatches } from '../../core/controls';
import { drawGameText, floatAt, gameTextBox, loadGameFont, TEXT_YELLOW } from '../../core/game-text';
import { dutyDesk } from '../../core/duty/desk';
import { LEARNING, type RatingScale } from '../../core/duty/ratings';
import { historyGroup } from '../../core/history';
import { ReplayRecorder, stateText, type PuzzleReplay, type ReplaySettingsCodec } from '../../core/replay';
import type { InputEvent } from '../../core/input';
import type { PuzzleFactory } from '../../core/puzzle';
import type { GameRecord } from '../../core/storage';
import { Random } from '../../core/random';
import { BONUS_SETS, BoardRandom, type Cell, Piece, PIECE_LETTERS, TOKEN_NAMES } from './board';
import {
  CELL,
  Game,
  type HoleSprite,
  newStats,
  type PieceSprite,
  type SoundName,
  type Stats,
  TEXT_MS,
  TOKEN_MS,
  TOOLBOX_AT,
  VIEW_H,
  VIEW_W,
  VIEW_X,
  VIEW_Y,
} from './game';
import { PIECES_NO_PUTTY } from './shapes';
import { piecesDrawn } from './report';
import { boardCode, boardIssues, clearHoles, FIXED_GRAIN, load as loadBoard, paintHole, pieceLetter, readBoardCode, setTool, toolFor } from './create';

const imageUrls = import.meta.glob<string>('./media/*.png', { eager: true, query: '?url', import: 'default' });
const soundUrls = import.meta.glob<string>('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' });


/** The deck's planks: 108x54 tiles, every other row half a plank over (CarpentryBoardView.g). */
const PLANK_W = 6 * CELL;
const PLANK_H = 3 * CELL;
const PLANKS = 7;
/** A piece texture is 90 wide (wood_pieces), the putty bucket 56x68 (putty), its spout 50px up. */
const TEXTURE_W = 5 * CELL;
const PUTTY_W = 56;
const PUTTY_H = 68;
const PUTTY_SPOUT = 50;
/**
 * The two looks: the Vampire Lair's dark "_vampirate" art, or normal carpentry's. Each has its
 * own piece outline colours by state (carpentry/r.l and r.k) and its own poured putty (s.H, s.G).
 */
type Look = 'vampire' | 'normal';
const LOOKS: Record<Look, { suffix: string; outlines: string[]; putty: string }> = {
  vampire: { suffix: '_vampirate', outlines: ['#7c6200', '#ebd7aa', '#c273ff', '#ff0000', '#8750b2', '#030303'], putty: 'rgb(92, 11, 20)' },
  normal: { suffix: '', outlines: ['#7c6200', '#ffff00', '#00afef', '#ff0000', '#005574', '#030303'], putty: 'rgb(198, 145, 104)' },
};
/** Token quarters in bonus.png: tile type << 2 | quarter, 18px each (CarpentryBoardView.m). */
const TOKEN_TILE = CELL;
const TOKENS = [
  { value: 0, label: 'Off' },
  { value: 1, label: '4 Tokens' },
  { value: 2, label: '5 Tokens' },
];
const DIFFICULTIES = Array.from({ length: 10 }, (_, value) => ({ value, label: `${value} · ${value + 1} ${value ? 'stars' : 'star'}` }));
/** The star meter  at (5, 185) in the view: 9 stars of 21px, 19px apart. */
const STAR = 21;
const STAR_STEP = 19;
const STARS = 9;
const STARS_AT: Cell = [VIEW_X + 5, VIEW_Y + 185];
/** The meter moves 1% every 45ms (9 stars x 500 / 100). */
const STAR_MS_PER_PCT = (STARS * 500) / 100;
/** "Nice work!" (m.level_up), in yellow outlined blue-grey (CarpentryBoardView.b(String)). */
const LEVEL_TEXT = 'Nice work!';

const SESSION_SHORT = 120000;
/**
 * Duty report ratings, as vampirate board-ups are rated (YPPedia, Vampirate expedition): Asleep up
 * to Frenetic by the score (Vampire proof 2, Creaky 1, Slipshod -1), then our own four words above Frenetic.
 */
const RATING_SCALES: RatingScale[] = [{ id: 'boardUps', label: 'Score', cutoffs: [3, 6, 9, 12, 15, 20, 25, 30, 35, 40], gauntlet: true }];
const SESSION_LONG = 999999999999999999;
/** Board seeds are 48-bit, like java.util.Random's. */
const MAX_SEED = 2 ** 48 - 1;

/** Additional sounds for a new best and option changes. */
type ExtraSound = 'audio_pb_sound' | 'audio_options_change';

/** Cheat pieces in the layout of the simulator's cheats_ui.png, the putty ('b') on a row of its own. */
const CHEAT_ROWS = [['p', 'f', 'y', 't'], ['w', 'u', 'n', 'v'], ['l', 'z', 'x', 'i'], ['b']];

interface Config {
  volume: number;
  cheats: boolean;
  ghost: boolean;
  speed: boolean;
  speedHoles: number;
  speedSize: number;
  unlimited: boolean;
  /** Index into PIECES_NO_PUTTY, or 12 for any piece. */
  speedLetter: number;
  look: Look;
  /** Ship carpentry instead of the Vampire Lair's, at a difficulty with a token pool (BONUS_SETS). */
  ship: boolean;
  difficulty: number;
  tokens: number;
  /** Freeplay mode: paint the holes and choose the toolbox, with no clock or PB. */
  create: boolean;
}

const DEFAULT_CONFIG: Config = {
  volume: 1,
  cheats: false,
  ghost: false,
  speed: false,
  speedHoles: 1,
  speedSize: 3,
  unlimited: false,
  speedLetter: 3,
  look: 'vampire',
  ship: false,
  difficulty: 5,
  tokens: 0,
  create: false,
};
/** What a replay recorded before ship carpentry existed played as. */
const LAIR_ONLY = { ship: false, difficulty: 5, tokens: 0 };

/** Keys from the simulator's keybinds.yaml: flip, rotate anticlockwise, clockwise, toolbox 1-3, place. */
const KEYS = { flip: 'space', ccw: 'x', cw: 'c', slots: ['1', '2', '3'], place: 'z' };
/** Freeplay mode: keys held over a hole's box cut squares open or close them with wood. */
const PAINT_KEYS = [{ id: 'cut', label: 'Cut hole squares (Freeplay)', defaultKey: 'q', open: true }, { id: 'wood', label: 'Fill squares with wood (Freeplay)', defaultKey: 'w', open: false }];
/** The toolbox choices in Freeplay: each plank with its grain across or along as dealt, and the putty. */
const TOOL_OPTIONS = Array.from({ length: 13 }, (_, kind) => kind).flatMap((kind) =>
  kind === 12 ? [{ value: toolFor(kind, true), label: 'Putty' }]
    : FIXED_GRAIN.has(kind) ? [{ value: toolFor(kind, true), label: pieceLetter(kind).toUpperCase() }]
      : [{ value: toolFor(kind, true), label: `${pieceLetter(kind).toUpperCase()}, grain across` }, { value: toolFor(kind, false), label: `${pieceLetter(kind).toUpperCase()}, grain along` }]);

interface SessionTable {
  sessions: number;
  total_score: number;
  total_holes: number;
  total_pieces: number;
  max_score: number;
  most_vp: number;
  most_holes: number;
  most_pieces: number;
  average_holes: number;
  score_per_hole: number;
  average_score: number;
  average_pieces: number;
}

/** A 2x2 orientation matrix [a, b, c, d] mapping base offsets to the piece's (x' = a x + c y, y' = b x + d y). */
function orientMatrix(o: number): [number, number, number, number] {
  let m: [number, number, number, number] = o & 1 ? [0, 1, 1, 0] : [1, 0, 0, 1];
  if (o & 4) m = [-m[0], m[1], -m[2], m[3]];
  if (o & 2) m = [m[0], -m[1], m[2], -m[3]];
  return m;
}

/** a then b (b after a). */
function compose(b: number[], a: number[]): [number, number, number, number] {
  return [b[0] * a[0] + b[2] * a[1], b[1] * a[0] + b[3] * a[1], b[0] * a[2] + b[2] * a[3], b[1] * a[2] + b[3] * a[3]];
}

/** ImageUtil.createTracedImage: a 1px outline of `colour` around the image's opaque pixels. */
function traced(img: CanvasImageSource, sx: number, w: number, h: number, colour: [number, number, number]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, sx, 0, w, h, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && px[(y * w + x) * 4 + 3] > 0;
  const edge: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (opaque(x, y)) continue;
      if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) edge.push((y * w + x) * 4);
    }
  }
  for (const i of edge) {
    px[i] = colour[0];
    px[i + 1] = colour[1];
    px[i + 2] = colour[2];
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/**
 * The red blink outline of a hole: Graphics.draw(Area) with a 1px pen, which runs along the
 * top and left pixels of the shape and just outside its right and bottom (carpentry/p.a).
 */
function holeOutline(black: HTMLCanvasElement): HTMLCanvasElement {
  const w = black.width;
  const h = black.height;
  const src = black.getContext('2d')!.getImageData(0, 0, w, h).data;
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ff0000';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaque(x, y)) continue;
      if (!opaque(x, y - 1) || !opaque(x - 1, y)) ctx.fillRect(x, y, 1, 1);
      if (!opaque(x + 1, y)) ctx.fillRect(x + 1, y, 1, 1);
      if (!opaque(x, y + 1)) ctx.fillRect(x, y + 1, 1, 1);
    }
  }
  return canvas;
}

const hexRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

export default (async ({ screen, input, panel, store, ticks, setReplayTime }) => {
  const [images] = await Promise.all([Images.load(imageUrls), loadGameFont()]);
  const img = (name: string) => images.get(name);
  const sounds = new SoundBank(soundUrls, () => replays?.isSeeking ?? false);
  const warning = new TimerWarning('vampirate', () => replays?.isSeeking ?? false);
  const ctx = screen.ctx;

  // The putty bucket by state, for each look: upright for 0-1, pouring for 2-3, traced in the state's colour.
  const puttyImages = Object.fromEntries(
    (Object.keys(LOOKS) as Look[]).map((look) => [
      look,
      [0, 1, 2, 3].map((s) => traced(img(`putty${LOOKS[look].suffix}`), s < 2 ? 0 : PUTTY_W, PUTTY_W, PUTTY_H, hexRgb(LOOKS[look].outlines[s]))),
    ]),
  ) as Record<Look, HTMLCanvasElement[]>;

  const config: Config = { ...DEFAULT_CONFIG, ...store.get<Partial<Config>>('config', {}) };
  /** Ship carpentry always has the normal art; the Vampire Lair's look can be chosen. */
  const lookName = (): Look => (config.ship ? 'normal' : LOOKS[config.look] ? config.look : 'vampire');
  const look = () => LOOKS[lookName()];
  /** The art for the chosen look, e.g. art('toolbox') is toolbox_vampirate.png in the vampire look. */
  const art = (name: string) => img(`${name}${look().suffix}`);
  const saveConfig = () => store.set('config', config);
  const bestScores = store.get<Record<string, number>>('bestScores', {});


  // ---- Session ----
  let game: Game | null = null;
  let stats: Stats = newStats();
  let boardActive = false;
  let startTime = 0;
  let pauseTime = 0;
  let timePassed = 0;
  let boardIndex = 0;
  let seeded = store.get<boolean>('seeded', false);
  let seed = store.get<number>('sessionSeed', Math.floor(Math.random() * MAX_SEED));
  let seedAtStart = seed;
  let speedRng = new Random();
  let replays!: ReplayRecorder;
  let replayBoardSeeds: number[] | null = null;
  let replaySpeedState: unknown = null;
  let recordedSpeedState: unknown = null;
  let recordedBoardSeeds: number[] = [];
  let cheatsUsed = false;
  let sightUsed = false;
  let scoreCounting = store.get<boolean>('scoreCounting', true);
  let endProcedureComplete = false;
  let endProcedureKey = '';
  let sessionScoresComputed = false;
  const sessionScores: Record<string, SessionTable> = {};
  let bestScoresKey = '';
  let bestScore = 0;
  let loadBestScore = true;
  let pendingSounds: { at: number; name: SoundName }[] = [];
  let meterShown = 0;
  let meterAt = 0;
  let lastMouse: Cell = [-1, -1];
  // Replays through simulator version 2 applied the final pointer position before queued releases.
  let legacyPointerOrder = false;
  let inputVersion = 5;
  const sessionTime = () => (config.unlimited || config.create ? SESSION_LONG : SESSION_SHORT);
  /** Freeplay mode: the palette choice a left click paints (recorded, so replays click the same way), the key held, and pasted-text errors. */
  let paletteOpen: boolean | null = null, paintWith: boolean | null = null, painting = false, pasteNote = '';
  const creating = () => boardActive && config.create && !!game;
  const score = () => (config.ship ? stats.points : -stats.grades[0] + stats.grades[1] + stats.grades[2] * 2);
  const tokenTotal = () => stats.tokens.reduce((a, b) => a + b, 0);

  function play(name: SoundName | ExtraSound): void {
    if (replays?.isSeeking) return;
    sounds.play(name.startsWith('audio_') ? name : `audio_${name}`);
  }

  /** The board for this point in the session: seeded sessions deal seed, seed + 1,... */
  function newBoard(): void {
    const boardSeed = replayBoardSeeds?.[boardIndex] ?? ((seedAtStart + boardIndex) % (MAX_SEED + 1));
    recordedBoardSeeds.push(boardSeed);
    replays?.updateSeed({ seed: seedAtStart, speedRng: recordedSpeedState, boardSeeds: [...recordedBoardSeeds] });
    const speed = config.speed && !config.ship && !config.create ? { holes: config.speedHoles, size: config.speedSize, letter: config.speedLetter } : null;
    game = new Game(
      boardSeed,
      new BoardRandom(BigInt(boardSeed) ^ 0x2545f491n),
      stats,
      {
        sound: (name, delay = 0) => (delay ? pendingSounds.push({ at: timePassed + delay, name }) : play(name)),
        levelDone: () => {
          boardIndex++;
          newBoard();
        },
      },
      speed,
      speedRng,
      timePassed,
      { ship: config.ship, difficulty: config.difficulty, tokens: config.tokens, independentStreams: true },
      inputVersion,
    );
    meterShown = 0;
    meterAt = timePassed;
  }

  function startSession(version = 5): void {
    inputVersion = version;
    legacyPointerOrder = version <= 2;
    stats = newStats();
    duty.clear();
    if (!replays.isPlaying) store.setScoresEnabled(!seeded && !config.create);
    // Freeplay is a sandbox: no PB and no history.
    cheatsUsed = seeded || config.unlimited || config.create;
    paletteOpen = paintWith = null; painting = false; pasteNote = '';
    sightUsed = false;
    if (!seeded) seed = Math.floor(Math.random() * MAX_SEED);
    seedAtStart = seed;
    speedRng = new Random(seed);
    if (replaySpeedState) {
      if (!speedRng.restore(replaySpeedState)) throw new Error('Invalid Vampire Carp random state');
      replaySpeedState = null;
    }
    recordedSpeedState = speedRng.snapshot();
    boardIndex = 0;
    lastMouse = [-1, -1];
    recordedBoardSeeds = [];
    startTime = ticks();
    timePassed = 0;
    pauseTime = 0;
    warning.reset();
    endProcedureComplete = false;
    sessionScoresComputed = false;
    pendingSounds = [];
    replays.begin({ config: { ...config }, seeded }, { seed: seedAtStart, speedRng: recordedSpeedState, boardSeeds: [] });
    newBoard();
  }

  function scoresKey(): string {
    if (config.ship) return `ship${config.ghost ? 'a' : 'b'}d${config.difficulty}t${config.tokens}`;
    return (config.ghost ? 'a' : 'b') + (config.speed ? 'a' : 'b') + (config.speed ? `${config.speedHoles}${config.speedSize}${config.speedLetter}` : '000');
  }

  /** The session's duty report: coffins boarded up by grade, rated by the score. Ship carpentry isn't rated yet. */
  function endReport() {
    if (config.ship) {
      return duty.end({
        mode: `Difficulty ${config.difficulty}${config.tokens ? `, ${TOKENS[config.tokens].label.toLowerCase()} tokens` : ''}`,
        performance: LEARNING,
        score: { label: 'Points', value: String(score()) },
      });
    }
    return duty.end({
      performance: duty.rate('boardUps', score()),
      score: { label: 'Score', value: String(score()) },
      cleared: [{ label: 'Coffins Boarded Up', inScore: true, items: [
        { icon: 'coffin-slipshod', label: 'slipshod', count: stats.grades[0] },
        { icon: 'coffin-creaky', label: 'creaky', count: stats.grades[1] },
        { icon: 'coffin-vampire-proof', label: 'vampire proof', count: stats.grades[2] },
      ] }],
    });
  }

  function endSession(): void {
    boardActive = false;
    const report = endReport();
    const finishedReplay = replays.finish(`Score ${score()}`, report);
    if (!endProcedureComplete) {
      // As the simulator's scores.yaml: every counted session's score, and the PB, per settings.
      if (store.scoresEnabled && !replays.isPlaying && !cheatsUsed && scoreCounting && !(config.ghost && sightUsed)) {
        store.addHistory(bestScoresKey, { score: score(), ...duty.fields(report), ...(finishedReplay ? { replayAt: finishedReplay.at, replayId: finishedReplay.runId ?? ''} : {}) });
        if (score() > bestScore) {
          bestScore = score();
          if (!config.ghost) play('audio_pb_sound');
          bestScores[bestScoresKey] = bestScore;
          store.set('bestScores', bestScores);
        }
      }
      endProcedureComplete = true;
      endProcedureKey = bestScoresKey;
    }
    if (!replays.isPlaying && score() > 0 && !sessionScoresComputed && !config.create) {
      recordSession();
      sessionScoresComputed = true;
    }
  }

  function recordSession(): void {
    const total = score();
    const holes = stats.holesFilled;
    const s = sessionScores[bestScoresKey];
    if (!s) {
      sessionScores[bestScoresKey] = {
        sessions: 1,
        total_score: total,
        total_holes: holes,
        total_pieces: stats.placed,
        max_score: total,
        most_vp: stats.grades[2],
        most_holes: holes,
        most_pieces: stats.placed,
        average_holes: holes,
        score_per_hole: total / holes,
        average_score: total,
        average_pieces: stats.placed,
      };
      return;
    }
    s.sessions++;
    s.total_score += total;
    s.total_holes += holes;
    s.total_pieces += stats.placed;
    s.max_score = Math.max(s.max_score, total);
    s.most_vp = Math.max(s.most_vp, stats.grades[2]);
    s.most_holes = Math.max(s.most_holes, holes);
    s.most_pieces = Math.max(s.most_pieces, stats.placed);
    s.average_holes = s.total_holes / s.sessions;
    s.score_per_hole = s.total_score / s.total_holes;
    s.average_score = s.total_score / s.sessions;
    s.average_pieces = s.total_pieces / s.sessions;
  }

  // ---- Input ----

  const inView = (x: number, y: number) => x >= VIEW_X && y >= VIEW_Y && x < VIEW_X + VIEW_W && y < VIEW_Y + VIEW_H;

  function handleEvents(events: InputEvent[]): void {
    events = events.filter((event) => {
      if (event.type === 'keydown' && keyMatches(event.key, 'vampire-carp', 'pause', 'escape')) { toggleSessionPause(); return false; }
      return true;
    });
    if (!game || !boardActive) return;
    const [mx, my] = input.mouse;
    const movePointer = (x: number, y: number) => {
      if ((x !== lastMouse[0] || y !== lastMouse[1]) && inView(x, y)) {
        game!.pointerMove(x, y);
        const open = paintWith ?? (painting ? paletteOpen : null);
        if (creating() && open !== null) paintAt(x, y, open);
      }
      lastMouse = [x, y];
    };
    // The latest position can be from AFTER a release. Start at the first queued pointer event,
    // process each button event where it happened, then catch up to the latest position.
    const firstPointer = events.find((event): event is Extract<InputEvent, { pos: Cell }> => 'pos' in event);
    const initialPointer = !legacyPointerOrder && firstPointer ? firstPointer.pos : input.mouse;
    movePointer(...initialPointer);
    for (const event of events) {
      if (!legacyPointerOrder && (event.type === 'mousedown' || event.type === 'mouseup')) movePointer(...event.pos);
      if (creating()) {
        const paintKey = event.type === 'keydown' || event.type === 'keyup' ? PAINT_KEYS.find((k) => keyMatches(event.key, 'vampire-carp', k.id, k.defaultKey)) : undefined;
        if (paintKey) {
          if (event.type === 'keyup') { if (paintWith === paintKey.open) paintWith = null; }
          else { paintWith = paintKey.open; paintAt(mx, my, paintKey.open); }
          continue;
        }
        if (event.type === 'mousedown' && event.button === 1 && paletteOpen !== null && Game.boxAt(event.pos[0], event.pos[1])) {
          painting = true;
          paintAt(event.pos[0], event.pos[1], paletteOpen);
          continue;
        }
        if (event.type === 'mouseup' && event.button === 1 && painting) { painting = false; continue; }
      }
      if (event.type === 'mousedown') {
        if (inView(event.pos[0], event.pos[1])) {
          // Several clicks can arrive in one frame; each acts where it happened.
          game.pointerMove(event.pos[0], event.pos[1]);
          game.pointerDown(event.button, event.pos[0], event.pos[1], timePassed);
        }
      } else if (event.type === 'mouseup') {
        game.pointerUp(event.button, timePassed);
      } else if (event.type === 'keydown') {
        const k = event.key;
        if (keyMatches(k, 'vampire-carp', 'flip', KEYS.flip)) game.flip();
        else if (keyMatches(k, 'vampire-carp', 'rotateLeft', KEYS.ccw)) game.rotate(false);
        else if (keyMatches(k, 'vampire-carp', 'rotateRight', KEYS.cw)) game.rotate(true);
        else if (KEYS.slots.some((key, i) => keyMatches(k, 'vampire-carp', `piece${i + 1}`, key))) {
          game.keyPick(KEYS.slots.findIndex((key, i) => keyMatches(k, 'vampire-carp', `piece${i + 1}`, key)));
        }
        else if (keyMatches(k, 'vampire-carp', 'place', KEYS.place) && inView(mx, my)) game.placeKey(mx, my, timePassed);
      }
    }
    if (!legacyPointerOrder) movePointer(mx, my);
  }

  /** Freeplay mode: cuts open or closes the square of a hole's box under the pointer. */
  function paintAt(px: number, py: number, open: boolean): void {
    const box = Game.boxAt(px, py);
    if (box && game?.edit(() => paintHole(game!.board, box.index, box.at, open) !== null)) play('piece_place_overlap');
  }

  /** Freeplay mode: a recorded change, applied now and again at the same moment in a replay. */
  function createCommand(command: string): void {
    if (!creating()) return;
    const [name, value = ''] = command.split(':', 2) as [string, string?];
    if (name === 'palette') paletteOpen = value === 'cut' ? true : value === 'wood' ? false : null;
    else if (name === 'tool') { const [slot, tool] = value.split(',').map(Number); game!.edit(() => setTool(game!.board, slot, tool)); }
    else if (name === 'clear') game!.edit(() => { clearHoles(game!.board); return true; });
    else if (name === 'load') { const read = readBoardCode(command.slice(5)); if (read) game!.edit(() => { loadBoard(game!.board, read); return true; }); }
  }
  const record = (command: string) => {
    if (!creating() || replays.isPlaying) return;
    replays.command(command);
    createCommand(command);
  };

  // ---- Drawing the board view ----

  /** Board-view pixels (world) to the panel. */
  const sx = (wx: number) => VIEW_X + wx - game!.view[0];
  const sy = (wy: number) => VIEW_Y + wy - game!.view[1];

  function drawDeck(view: Cell): void {
    const sheet = art('wood_background');
    const [vx, vy] = view;
    const r0 = Math.floor(vy / PLANK_H);
    const r1 = Math.floor((vy + VIEW_H) / PLANK_H);
    const c0 = Math.floor(vx / PLANK_W);
    const c1 = Math.floor((vx + VIEW_W) / PLANK_W);
    for (let r = r0; r <= r1; r++) {
      const [start, off] = r % 2 === 0 ? [c0, 0] : [c0 - 1, PLANK_W / 2];
      for (let c = start; c <= c1; c++) {
        const tile = (Math.abs(c) * Math.abs(r)) % PLANKS;
        screen.blit(sheet, VIEW_X + c * PLANK_W + off - vx, VIEW_Y + r * PLANK_H - vy, { area: [tile * PLANK_W, 0, PLANK_W, PLANK_H] });
      }
    }
  }

  /** Each hole drawn once into a canvas: black cells, splinters cut out, and its red blink outline. */
  const holeCache = new WeakMap<HoleSprite, { version: number; black: HTMLCanvasElement; red: HTMLCanvasElement }>();

  function holeCanvases(hs: HoleSprite) {
    const version = hs.grown.length;
    const cached = holeCache.get(hs);
    if (cached && cached.version === version) return cached;
    const w = hs.hole.width * CELL + 1;
    const h = hs.hole.height * CELL + 1;
    const black = document.createElement('canvas');
    black.width = w;
    black.height = h;
    const b = black.getContext('2d')!;
    b.fillStyle = '#000000';
    hs.cells.forEach((col, x) => col.forEach((open, y) => open && b.fillRect(x * CELL, y * CELL, CELL, CELL)));
    for (const [x, y, gw, gh] of hs.grown) b.fillRect(x, y, gw, gh);
    for (const [x, y, rw] of hs.ragged) b.clearRect(x, y, rw, 1);
    const red = holeOutline(black);
    const entry = { version, black, red };
    holeCache.set(hs, entry);
    return entry;
  }

  function drawHole(hs: HoleSprite): void {
    if (hs.hole.width === 0) return;
    const { black, red } = holeCanvases(hs);
    const x = sx(hs.pos[0]);
    const y = sy(hs.pos[1]);
    screen.blit(black, x, y);
    if (hs.blink?.on) screen.blit(red, x, y);
  }

  /** Draws a piece with its first cell's top-left at (x, y) on the panel (carpentry/r and s). */
  function drawPiece(sprite: PieceSprite, x: number, y: number): void {
    const piece = sprite.piece;
    if (piece.isPutty) {
      if (sprite.pour) {
        drawPour(sprite, x, y);
        return;
      }
      const at: Cell = sprite.held ? [x, y - PUTTY_SPOUT] : [x - PUTTY_W / 2, y - PUTTY_H / 2];
      screen.blit(puttyImages[lookName()][Math.min(3, sprite.state)], at[0], at[1], sprite.held ? { alpha: 204 } : {});
      return;
    }
    const cells = piece.cells();
    const base = new Piece(piece.tool, sprite.look.baseOrient).cells();
    const minBx = Math.min(...base.map((c) => c[0]));
    const minBy = Math.min(...base.map((c) => c[1]));
    const m = orientMatrix(piece.orient);
    const b = orientMatrix(sprite.look.baseOrient);
    const t = compose(m, [b[0], b[2], b[1], b[3]]);
    const texture = art('wood_pieces');
    ctx.save();
    if (sprite.held) ctx.globalAlpha = 0.6;
    cells.forEach(([cx, cy], k) => {
      const tx = sprite.look.texture * TEXTURE_W + sprite.look.crop[0] + (base[k][0] - minBx) * CELL;
      const ty = sprite.look.crop[1] + (base[k][1] - minBy) * CELL;
      ctx.setTransform(t[0], t[1], t[2], t[3], Math.trunc(x) + cx * CELL + CELL / 2, Math.trunc(y) + cy * CELL + CELL / 2);
      ctx.drawImage(texture, tx, ty, CELL, CELL, -CELL / 2, -CELL / 2, CELL, CELL);
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Token quarters go over the wood, under the outline, faded with it when held (carpentry/r.f).
    cells.forEach(([cx, cy], k) => {
      const token = piece.token(k);
      if (token) ctx.drawImage(img('bonus'), token * TOKEN_TILE, 0, TOKEN_TILE, TOKEN_TILE, Math.trunc(x) + cx * CELL, Math.trunc(y) + cy * CELL, CELL, CELL);
    });
    ctx.restore();
    outline(cells, x, y, look().outlines[sprite.state]);
    // The little pin at the piece's first cell (carpentry/r.e).
    const px = Math.trunc(x) + CELL / 2 - 1;
    const py = Math.trunc(y) + CELL / 2 - 1;
    screen.rect(px, py, 1, 1, '#404040');
    screen.rect(px + 1, py + 1, 1, 1, '#404040');
    screen.rect(px, py + 1, 1, 1, '#000000');
    screen.rect(px + 1, py, 1, 1, '#808080');
  }

  /** The outline around a set of cells. */
  function outline(cells: Cell[], x: number, y: number, colour: string): void {
    const has = (a: number, b: number) => cells.some(([cx, cy]) => cx === a && cy === b);
    x = Math.trunc(x);
    y = Math.trunc(y);
    for (const [cx, cy] of cells) {
      const px = x + cx * CELL;
      const py = y + cy * CELL;
      if (!has(cx, cy - 1)) screen.rect(px, py, CELL + 1, 1, colour);
      if (!has(cx, cy + 1)) screen.rect(px, py + CELL, CELL + 1, 1, colour);
      if (!has(cx - 1, cy)) screen.rect(px, py, 1, CELL + 1, colour);
      if (!has(cx + 1, cy)) screen.rect(px + CELL, py, 1, CELL + 1, colour);
    }
  }

  /** Poured putty: blood spreading in a circle from the middle of the poured cell (carpentry/s.a(long)). */
  function drawPour(sprite: PieceSprite, x: number, y: number): void {
    const pour = sprite.pour!;
    const r = Math.min(pour.radius, (timePassed - pour.start) / 10);
    ctx.save();
    ctx.beginPath();
    ctx.arc(Math.trunc(x) + CELL / 2, Math.trunc(y) + CELL / 2, Math.max(0, r), 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = look().putty;
    for (const [cx, cy] of sprite.piece.cells()) ctx.fillRect(Math.trunc(x) + cx * CELL, Math.trunc(y) + cy * CELL, CELL, CELL);
    ctx.restore();
    outline(sprite.piece.cells(), x, y, look().outlines[5]);
  }

  /** A whole token, its four quarters around a centre (the game's own token animations are blank). */
  function drawToken(type: number, cx: number, cy: number): void {
    for (let q = 0; q < 4; q++) {
      ctx.drawImage(img('bonus'), ((type << 2) | q) * TOKEN_TILE, 0, TOKEN_TILE, TOKEN_TILE, Math.trunc(cx) - CELL + (q & 1) * CELL, Math.trunc(cy) - CELL + (q >> 1) * CELL, CELL, CELL);
    }
  }

  /** A label centred on (cx, cy), outlined (carpentry popups); returns its box. */
  function floatText(text: string, cx: number, cy: number, px: number, fill: string, outline: string, alpha: number) {
    const { h } = gameTextBox(ctx, text, { px });
    return drawGameText(ctx, text, cx, cy - h / 2, { px, fill, outline, align: 'center', alpha });
  }

  function drawBoard(): void {
    const g = game!;
    ctx.save();
    ctx.beginPath();
    ctx.rect(VIEW_X, VIEW_Y, VIEW_W, VIEW_H);
    ctx.clip();
    drawDeck(g.view);
    for (const hs of g.holeSprites) drawHole(hs);
    if (!config.ghost) {
      for (const hs of g.holeSprites) {
        for (const p of hs.pieces) {
          const o = p.sprite.shake?.offset ?? [0, 0];
          drawPiece(p.sprite, sx(hs.pos[0] + p.at[0] * CELL) + o[0], sy(hs.pos[1] + p.at[1] * CELL) + o[1]);
        }
      }
    }
    screen.blit(art('toolbox'), VIEW_X + TOOLBOX_AT[0], VIEW_Y + TOOLBOX_AT[1]);
    g.tools.forEach((tool, slot) => {
      if (!tool || tool === g.held) return;
      const [cx, cy] = Game.toolCell(slot);
      drawPiece(tool, VIEW_X + cx * CELL, VIEW_Y + cy * CELL);
    });
    if (g.held) drawPiece(g.held, VIEW_X + g.cursor[0] * CELL, VIEW_Y + g.cursor[1] * CELL);
    for (const f of g.flyers) {
      const [fx, fy] = g.flyerAt(f);
      drawPiece(f.sprite, sx(fx), sy(fy));
    }
    for (const t of g.texts) {
      const { dy, alpha } = floatAt(timePassed - t.start, TEXT_MS);
      const main = floatText(t.text, sx(t.at[0]), sy(t.at[1]) + dy, t.size, t.colour, '#000000', alpha);
      // The bonus number sits right of the rank, 6px up; the grain/homogenous lines stack under it, 24px yellow.
      if (t.streak) drawGameText(ctx, `x${t.streak + 1}`, main.x + main.w, main.y - 6, { px: 24, alpha });
      if (t.sub) drawGameText(ctx, t.sub, main.x + main.w / 2, main.y + main.h, { px: 24, fill: TEXT_YELLOW, align: 'center', alpha });
    }
    for (const f of g.tokenFlyers) {
      const [fx, fy] = g.tokenAt(f);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - (timePassed - f.start) / TOKEN_MS);
      drawToken(f.type, sx(fx), sy(fy));
      ctx.restore();
    }
    if (g.levelText) floatText(LEVEL_TEXT, sx(g.levelText.at[0]), sy(g.levelText.at[1]), 36, '#fff320', '#30627b', 1);
    ctx.restore();
  }

  /** stars.png: tile 0 the empty star, tile 1 the fill, which rises from the bottom. */
  function drawStars(): void {
    const sheet = img('stars');
    const target = game ? game.meter : 0;
    const elapsed = timePassed - meterAt;
    meterAt = timePassed;
    if (target < meterShown) meterShown = target;
    else meterShown = Math.min(target, meterShown + elapsed / STAR_MS_PER_PCT);
    const total = Math.trunc(meterShown) * STARS;
    const full = Math.trunc(total / 100);
    const part = total % 100;
    for (let i = 0; i < STARS; i++) {
      const y = STARS_AT[1] + (STARS - i - 1) * STAR_STEP;
      screen.blit(sheet, STARS_AT[0], y, { area: [0, 0, STAR, STAR] });
      const pct = i < full ? 100 : i > full ? 0 : part;
      const h = Math.trunc((pct * STAR) / 100);
      if (h > 0) screen.blit(sheet, STARS_AT[0], y + STAR - h, { area: [STAR, STAR - h, STAR, h] });
    }
  }

  /** The simulator's end-of-session table. */
  const duty = dutyDesk(panel, store, 'vampire-carp', 'Carpentry', RATING_SCALES);
  panel.results(() => endProcedureComplete && !boardActive && endProcedureKey === bestScoresKey ? {
    title: 'Carpentry results',
    report: duty.last,
    rows: [
      ['Score', String(score())],
      ['Time', `${(timePassed / 1000).toFixed(1)}s`],
      ...(config.ship
        ? [
            ['Points', String(stats.points)],
            ['MP, CR, FJ, SW, PB', stats.ranks.join(', ')],
            ['Best masterpiece streak', String(stats.bestStreak)],
            ...(config.tokens ? [['Tokens', String(tokenTotal())]] : []),
          ]
        : [['SS, CC, VP', stats.grades.join(', ')]]),
      ['Holes filled', String(stats.holesFilled)],
      ['Score per hole', stats.holesFilled ? (score() / stats.holesFilled).toFixed(2) : '0'],
      ['Placed, replaced', `${stats.placed}, ${stats.replaced}`],
      ['Flips, spins', `${stats.flips}, ${stats.spins}`],
      ['Keyboard, mouse picks', `${stats.keyPicks}, ${stats.mousePicks}`],
      ['Hole, deck scrolls', stats.scrolls.join(', ')],
      ['Animation time', `${(stats.animating / 1000).toFixed(2)}s`],
      ['Average focus', stats.focus.length ? (stats.focus.reduce((a, b) => a + b, 0) / stats.focus.length).toFixed(1) : '0'],
      ['Longest P drought', String(Math.max(...stats.pDrought))],
      ['Slowest, quickest hole', `${(stats.holeTimes[0] / 1000).toFixed(1)}s, ${Number.isFinite(stats.holeTimes[1]) ? (stats.holeTimes[1] / 1000).toFixed(1) : '—'}s`],
      ['Pieces drawn', piecesDrawn(stats.found)],
      ['Seed', String(seedAtStart)],
    ],
    // Every counted session with these settings, apart from this one's details.
    averages: [
      ...(sessionScores[bestScoresKey] ? (() => {
        const totals = sessionScores[bestScoresKey];
        return [
          ['Sessions', String(totals.sessions)],
          ['Average score, holes', `${totals.average_score.toFixed(2)}, ${totals.average_holes.toFixed(2)}`],
          ['Overall score per hole', totals.score_per_hole.toFixed(2)],
          ['Average pieces', totals.average_pieces.toFixed(1)],
          config.ship ? ['Best score', String(totals.max_score)] : ['Best score, most VP', `${totals.max_score}, ${totals.most_vp}`],
          ['Most holes, pieces', `${totals.most_holes}, ${totals.most_pieces}`],
        ];
      })() : []),
    ],
  } : null);

  // ---- Panel ----

  const changed = (change: () => void) => () => {
    change();
    saveConfig();
  };
  /** Changing the kind of session stops the board and loads that kind's PB. */
  const restartOption = (change: () => void) =>
    changed(() => {
      loadBestScore = true;
      boardActive = false;
      change();
    });

  type Mode = 'normal' | 'ghost' | 'speed' | 'create';
  const mode = (): Mode => (config.create ? 'create' : config.ghost ? 'ghost' : config.speed && !config.ship ? 'speed' : 'normal');
  const setMode = (next: Mode) => {
    if (next === mode()) return;
    loadBestScore = true;
    if (config.create !== (next === 'create')) boardActive = false;
    config.create = next === 'create';
    // Ghost hides placed pieces, so a session that used it can't set a PB.
    if (config.ghost !== (next === 'ghost')) sightUsed = true;
    if (config.speed !== (next === 'speed')) boardActive = false;
    config.ghost = next === 'ghost';
    config.speed = next === 'speed';
    saveConfig();
  };

  panel.clock(() =>
    config.unlimited || config.create
      ? { label: 'Time', ms: timePassed }
      : { label: 'Time left', ms: sessionTime() - timePassed, countdown: true, warn: boardActive && sessionTime() - timePassed < 10000 },
  );

  const session = panel.session();
  panel.controls('vampire-carp', [
    { id: 'pause', label: 'Pause / resume', defaultKey: 'Escape' },
    { id: 'flip', label: 'Flip piece', defaultKey: 'Space' },
    { id: 'rotateLeft', label: 'Rotate anticlockwise', defaultKey: 'X' },
    { id: 'rotateRight', label: 'Rotate clockwise', defaultKey: 'C' },
    ...[1,2,3].map((n) => ({ id: `piece${n}`, label: `Select piece ${n}`, defaultKey: String(n) })),
    { id: 'place', label: 'Place piece', defaultKey: 'Z' },
    ...PAINT_KEYS.map(({ id, label, defaultKey }) => ({ id, label, defaultKey })),
  ]);
  session.select(
    'Carpentry',
    [
      { value: 'lair', label: 'Vampire Lair' },
      { value: 'ship', label: 'Ship' },
    ],
    () => (config.ship ? 'ship' : 'lair'),
    (v) =>
      restartOption(() => {
        config.ship = v === 'ship';
        // Speed is the Vampire Lair's practice mode.
        if (config.ship) config.speed = false;
      })(),
    { title: 'The Vampire Lair’s coffins, or a ship’s hull at a duty difficulty with maneuver tokens' },
  );
  const LAIR_MODES = [
    { value: 'normal' as Mode, label: 'Normal' },
    { value: 'ghost' as Mode, label: 'Ghost' },
    { value: 'speed' as Mode, label: 'Speed' },
    { value: 'create' as Mode, label: 'Freeplay' },
  ];
  const SHIP_MODES = LAIR_MODES.filter((m) => m.value !== 'speed');
  session.select(
    'Mode',
    () => (config.ship ? SHIP_MODES : LAIR_MODES),
    mode,
    setMode,
    { title: 'Ghost hides placed pieces; Speed deals small holes with the pieces to fill them; Freeplay lets you paint the board' },
  );
  const actions = panel.group();

  const pauseAvailable = () => timePassed > 0 && timePassed < sessionTime() && pauseTime > 0;
  function toggleSessionPause(): void {
    if (boardActive) pauseTime = timePassed;
    else if (pauseTime > 0) startTime = ticks();
    if (pauseAvailable()) boardActive = !boardActive;
  }
  actions
    .button(
      'Start',
      // Starting while a replay is open closes it and starts a game of your own.
      () => {
        if (replays.isPlaying) { replays.stop(); if (replays.isPlaying) return; }
        if (!boardActive) { replayBoardSeeds = null; replaySpeedState = null; startSession(); }
        else replays.finish(`Score ${score()}`, endReport());
        boardActive = !boardActive;
      },
      { variant: 'primary', label: () => (replays?.isPlaying ? 'Start' : boardActive ? 'Stop' : 'Start') },
    )
    .button(
      'Pause',
      () => {
        replays.command('pause');
        toggleSessionPause();
      },
      { label: () => (boardActive ? 'Pause' : 'Play'), disabled: () => !!replays?.isPlaying || (!boardActive && !pauseAvailable()) },
    )
    .button(
      'Dismiss',
      () => {
        if (!boardActive) return;
        replays.command('dismiss');
        boardIndex++;
        newBoard();
      },
      { disabled: () => !boardActive || !!replays?.isPlaying, title: 'Deal a new board without restarting the clock' },
    );

  // Freeplay mode's board panel: the board's text, the paint palette and the toolbox.
  const createOnly = () => !config.create;
  const editing = () => !creating() || !game!.editable || replays.isPlaying;
  const boardGroup = panel.group('Board', { hidden: createOnly });
  boardGroup.button('Copy', () => { if (game) copyText(boardCode(game.board), 'Copy this board:'); }, { disabled: () => !game, title: 'Copy the holes and toolbox as text' });
  boardGroup.button('Paste', () => void pasteText('Paste a board:').then((text) => {
    if (text === null) return;
    if (readBoardCode(text)) { pasteNote = ''; record(`load:${text.trim()}`); }
    else pasteNote = 'That isn’t a carpentry board. Boards copied here start with C.';
  }), { disabled: editing, title: 'Play a board from a pasted copy' });
  boardGroup.button('Generate', () => {
    if (!creating()) return;
    replays.command('dismiss');
    boardIndex++;
    newBoard();
    copyText(boardCode(game!.board), 'Copy this board:');
  }, { disabled: editing, title: 'Deal a new board and copy it' });
  const palette = document.createElement('div');
  palette.className = 'piece-palette';
  for (const [label, value, open] of [['Q · Cut', 'cut', true], ['W · Wood', 'wood', false]] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-button';
    button.textContent = label;
    button.addEventListener('click', () => { record(`palette:${paletteOpen === open ? '-' : value}`); panel.used(); });
    panel.addSync(() => {
      button.disabled = !creating() || replays.isPlaying;
      button.setAttribute('aria-pressed', String(paletteOpen === open));
    });
    palette.append(button);
  }
  boardGroup.append(palette);
  boardGroup.button('Clear holes', () => record('clear'), { disabled: editing, title: 'Fill every hole with wood' });
  for (let slot = 0; slot < 3; slot++) {
    boardGroup.select(`Toolbox ${slot + 1}`, TOOL_OPTIONS, () => game?.board.toolbox[slot] ?? TOOL_OPTIONS[0].value, (tool) => record(`tool:${slot},${tool}`), { disabled: editing });
  }
  boardGroup.note(() => pasteNote);
  boardGroup.note(() => {
    const issues = game ? boardIssues(game.board, config.ship) : [];
    return issues.length ? `Not a board the game could deal: ${issues.join(' ')}` : '';
  }, { hidden: () => !creating() });

  const settings = panel.settings.group('Game');
  settings.select('Difficulty', DIFFICULTIES, () => config.difficulty, (n) => restartOption(() => (config.difficulty = n))(), {
    hidden: () => !config.ship,
    title: 'The duty’s difficulty: hole sizes, and holes for a full star meter',
  });
  settings.select('Tokens', TOKENS, () => config.tokens, (n) => restartOption(() => (config.tokens = n))(), {
    hidden: () => !config.ship,
    title: 'Maneuver tokens on every plank, from the game’s 4-token or 5-token pool',
  });
  const speedHidden = () => !config.speed;
  settings.select(
    'Holes',
    [1, 2, 3, 4].map((n) => ({ value: n, label: String(n) })),
    () => config.speedHoles,
    (n) => restartOption(() => (config.speedHoles = n))(),
    { hidden: speedHidden, title: 'Speed: holes on the board at once' },
  );
  settings.select(
    'Size',
    [1, 2, 3].map((n) => ({ value: n, label: `${n} piece${n > 1 ? 's' : ''}` })),
    () => config.speedSize,
    (n) =>
      restartOption(() => {
        config.speedSize = n;
        if (n === 1) config.speedLetter = 12;
      })(),
    { hidden: speedHidden, title: 'Speed: pieces per hole' },
  );
  settings.select(
    'Piece',
    [...PIECES_NO_PUTTY.map((letter, i) => ({ value: i, label: letter.toUpperCase() })), { value: 12, label: 'Any' }],
    () => config.speedLetter,
    (n) => restartOption(() => (config.speedLetter = n))(),
    { hidden: speedHidden, disabled: () => config.speedSize === 1, title: 'Speed: a piece every hole needs' },
  );
  settings.toggle(
    'Unlimited',
    () => config.unlimited,
    (on) =>
      changed(() => {
        config.unlimited = on;
        cheatsUsed = true;
      })(),
    { title: 'No time limit (no PB)' },
  );
  settings.toggle(
    'Score counts',
    () => scoreCounting,
    (on) => {
      scoreCounting = on;
      boardActive = false;
      store.set('scoreCounting', on);
    },
    { title: 'Off: sessions can’t set a PB' },
  );
  settings.toggle(
    'Cheats',
    () => config.cheats,
    (on) =>
      changed(() => {
        config.cheats = on;
        cheatsUsed = true;
      })(),
    { title: 'Pick any piece from the cheat pieces (no PB)' },
  );

  panel.score().stats(['', 'Now', 'PB'], () => [
    [config.ship ? 'Points' : 'Score', String(score()), String(bestScore)],
  ]);

  // Tokens handed over this session, by type, as Bilging shows them.
  const tokenStats = panel.group('Maneuver practice', { hidden: () => !config.ship || !config.tokens });
  tokenStats.stats(['Shape', 'Handed over'], () => (BONUS_SETS[config.tokens] ?? []).map((type) => [TOKEN_NAMES[type], String(stats.tokens[type])]));
  tokenStats.hint(
    () =>
      'Every plank carries a quarter or more of a token. A finished hole hands over one whole token from its cells, two for a masterpiece, none if it took more than two planks over its size. A ship maneuver also needs the other duty stations.',
  );

  const replayAction = {
    available: (game: GameRecord) => typeof game.replayAt === 'number' && (replays?.hasPlayableAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined) ?? false),
    play: (game: GameRecord) => { if (typeof game.replayAt === 'number') replays?.playAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined); },
  };
  historyGroup(panel, () => store.history(scoresKey()), [{ label: 'Score', value: (g) => String(g.score) }], 'Past games', replayAction);

  // Seeded: the board's own seed, so it deals what the game would.
  const seedGroup = panel.seedSettings.group('Seed');
  seedGroup.toggle('Fixed seed', () => seeded, on => { seeded = on; store.set('seeded', on); if (on) store.set('sessionSeed', seed); },
    { disabled: () => boardActive || pauseAvailable() || !!replays?.isPlaying, title: 'On: repeat this seed without setting PBs. Off: a fresh seed for every run.' });
  seedGroup.text(
    'Seed',
    () => String(seed),
    (text) => {
      boardActive = false;
      play('audio_options_change');
      text = text.trim();
      if (/^\d{1,15}$/.test(text) && Number(text) <= MAX_SEED) {
        seed = Number(text); seeded = true; store.set('seeded', true); store.set('sessionSeed', seed);
      }
    },
    { placeholder: 'up to 15 digits', inputMode: 'numeric', disabled: () => boardActive || pauseAvailable() || !!replays?.isPlaying },
  );
  seedGroup
    .button(
      'Copy',
      () => {
        copyText(String(seed), 'Copy this seed:');
        play('audio_options_change');
      },
      { title: 'Copy the seed' },
    )
    .button(
      'New',
      () => {
        boardActive = false;
        seed = Math.floor(Math.random() * MAX_SEED); seeded = true;
        store.set('seeded', true); store.set('sessionSeed', seed);
        copyText(String(seed), 'Copy this seed:');
        play('audio_options_change');
      },
      { disabled: () => boardActive || pauseAvailable() || !!replays?.isPlaying, title: 'Make a new fixed seed and copy it' },
    );

  // Cheats: click a piece to hold it.
  const cheats = panel.controlSettings.group('Cheat pieces', { hidden: () => !config.cheats });
  for (const row of CHEAT_ROWS) {
    const line = document.createElement('div');
    line.className = 'panel-buttons';
    line.style.display = 'grid';
    line.style.gridTemplateColumns = 'repeat(4, minmax(0, 1fr))';
    for (const letter of row) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'panel-button';
      button.style.padding = '6px 0';
      if (letter === 'b') button.style.gridColumn = '1 / -1';
      button.textContent = letter === 'b' ? 'Putty' : letter.toUpperCase();
      button.addEventListener('click', () => {
        if (game && boardActive) game.holdCheat(letter === 'b' ? 12 : PIECE_LETTERS.indexOf(letter as (typeof PIECE_LETTERS)[number]));
        cheatsUsed = true;
        panel.used();
      });
      line.append(button);
    }
    cheats.append(line);
  }

  panel.settings.group('Look').select(
    'Vampire Lair graphics',
    [
      { value: 'vampire', label: 'Vampire Lair' },
      { value: 'normal', label: 'Normal carpentry' },
    ],
    () => config.look,
    (v) => changed(() => (config.look = v))(),
    { title: 'The Vampire Lair’s dark art, or normal carpentry’s; ship carpentry always has its own' },
  );
  panel.settings.group('Reset').button('Reset to defaults', () => {
    Object.assign(config, DEFAULT_CONFIG);
    saveConfig();
    seeded = false;
    store.set('seeded', false);
    scoreCounting = true;
    store.set('scoreCounting', true);
    loadBestScore = true;
  });

  // Version 2 added ship carpentry; version 1 replays are all the Vampire Lair's.
  const replaySettingsCodec: ReplaySettingsCodec = {
    currentVersion: 2,
    simulatorVersion: 5,
    migrate: (version, value) => {
      if ((version !== 1 && version !== 2) || !value || typeof value !== 'object') return null;
      const wrapper = value as Record<string, unknown>;
      if (typeof wrapper.seeded !== 'boolean' || !wrapper.config || typeof wrapper.config !== 'object') return null;
      if (version === 1) wrapper.config = { ...(wrapper.config as object), ...LAIR_ONLY };
      const c = wrapper.config as Record<string, unknown>;
      return Number.isFinite(c.volume) && typeof c.cheats === 'boolean' && typeof c.ghost === 'boolean' &&
        typeof c.speed === 'boolean' && Number.isFinite(c.speedHoles) && Number.isFinite(c.speedSize) &&
        typeof c.unlimited === 'boolean' && Number.isInteger(c.speedLetter) &&
        (c.look === 'vampire' || c.look === 'normal') && typeof c.ship === 'boolean' &&
        Number.isInteger(c.difficulty) && (c.difficulty as number) >= 0 && (c.difficulty as number) <= 9 &&
        [0, 1, 2].includes(c.tokens as number) && (c.create === undefined || typeof c.create === 'boolean') ? value : null;
    },
  };
  const isVampireReplaySeed = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    const state = value as { seed: number; speedRng: unknown; boardSeeds: number[] };
    return Number.isSafeInteger(state.seed) && state.seed >= 0 && state.seed <= MAX_SEED &&
      Array.isArray(state.boardSeeds) && state.boardSeeds.length > 0 &&
      state.boardSeeds.every((seed) => Number.isSafeInteger(seed) && seed >= 0 && seed <= MAX_SEED) &&
      new Random(0).restore(state.speedRng);
  };
  let savedReplaySettings: { config: Config; seeded: boolean; seed: number; scoreCounting: boolean } | null = null;
  replays = new ReplayRecorder('vampire-carp', store, panel, ticks, (tape: PuzzleReplay) => {
    savedReplaySettings ??= { config: { ...config }, seeded, seed, scoreCounting };
    const settings = tape.settings as { config: Config; seeded: boolean };
    const seedData = tape.seed as { seed: number; speedRng: unknown; boardSeeds: number[] };
    if (!seedData || !Number.isSafeInteger(seedData.seed) || seedData.seed < 0 ||
        !Array.isArray(seedData.boardSeeds) || !seedData.boardSeeds.every((s) => Number.isSafeInteger(s) && s >= 0)) {
      throw new Error('Invalid Vampire Carp seed');
    }
    // Replays saved before Freeplay mode existed aren't Freeplay.
    Object.assign(config, LAIR_ONLY, { create: false }, settings.config);
    seeded = true;
    seed = seedData.seed;
    seedAtStart = seedData.seed;
    replayBoardSeeds = [...seedData.boardSeeds];
    replaySpeedState = seedData.speedRng;
    startSession(tape.simulatorVersion ?? 1);
    boardActive = true;
  }, () => {
    if (boardActive) endSession();
    boardActive = false;
    pauseTime = 0;
    replayBoardSeeds = null;
    replaySpeedState = null;
    if (savedReplaySettings) {
      Object.assign(config, savedReplaySettings.config);
      ({ seeded, seed, scoreCounting } = savedReplaySettings);
      savedReplaySettings = null;
      loadBestScore = true;
    }
  }, isVampireReplaySeed, setReplayTime, () => frame([]), replaySettingsCodec,
  () => (!boardActive && !pauseAvailable()) || replays.isPlaying);

  // Taken over, the replay's settings are the game's, and new boards come as in any game.
  replays.onTakeOver = () => {
    savedReplaySettings = null;
    replayBoardSeeds = null;
    replays.updateSeed({ seed: seedAtStart, speedRng: recordedSpeedState, boardSeeds: [...recordedBoardSeeds] });
  };

  // ---- The frame ----

  function frame(events: InputEvent[]): void {
    const routed = replays.frame(events, input.mouse, ticks());
    events = routed.events;
    input.mouse = routed.mouse;
    if (!routed.renderOnly) {
      for (const command of routed.commands) {
        if (command === 'pause') toggleSessionPause();
        else if (command === 'dismiss' && boardActive) { boardIndex++; newBoard(); }
        else createCommand(command);
      }
      if (loadBestScore) {
        bestScoresKey = scoresKey();
        bestScore = bestScores[bestScoresKey] ?? 0;
        loadBestScore = false;
      }
      if (boardActive) timePassed = ticks() - startTime + pauseTime;
      handleEvents(events);
      if (game && boardActive) {
        game.update(timePassed, !replays.isSeeking);
        const due = pendingSounds.filter((s) => s.at <= timePassed);
        pendingSounds = pendingSounds.filter((s) => s.at > timePassed);
        for (const s of due) play(s.name);
      }
      if (boardActive) warning.update(config.unlimited || config.create ? null : sessionTime() - timePassed);
      if (boardActive && timePassed > sessionTime()) endSession();

    }

    // Replay seeking updates the simulation state without repainting each intermediate frame.
    if (replays.isSeeking || replays.isAdvancing) return;

    screen.blit(art('background'), 0, 0);
    const title = art('title');
    screen.blit(title, Math.round((450 - title.width) / 2), Math.round((VIEW_Y - title.height) / 2));
    if (game) drawBoard();
    else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(VIEW_X, VIEW_Y, VIEW_W, VIEW_H);
      ctx.clip();
      drawDeck([0, 0]);
      screen.blit(art('toolbox'), VIEW_X + TOOLBOX_AT[0], VIEW_Y + TOOLBOX_AT[1]);
      ctx.restore();
    }
    drawStars();
    replays.drawOverlay(ctx);
  }

  // What decides how the game goes on; replays check it after every recorded input.
  replays.fingerprint = () => stateText(stats, boardIndex, boardActive, timePassed, speedRng.snapshot());

  // Opening a replay file ends a game in progress, as its Stop button would.
  replays.setStopLive(() => { if (boardActive) { replays.finish(`Score ${score()}`, endReport()); boardActive = false; } });
  return { frame, dispose: () => { replays.dispose(); sounds.dispose(); warning.dispose(); } };
}) satisfies PuzzleFactory;
