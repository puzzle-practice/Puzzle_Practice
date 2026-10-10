// Vampire Carp: the Vampire Lair's carpentry, rebuilt from the Puzzle Pirates game (duty/carpentry
// in vampirate mode, build 20260909165753). The rules are in board.ts and game.ts; this file is
// CarpentryPanel and CarpentryBoardView with their sprites: the game's art, the wood deck that
// scrolls, holes with splintered ends that blink and grow, pieces cut from the wood textures and
// outlined by state, the putty bucket and its blood, rattling and flying pieces, the floating
// ratings and the star meter. The canvas is the 450x600 puzzle panel; settings and scores are in
// the side panel.
//
// On top of the game are the Vampire Carp simulator's modes and features: two-minute
// sessions scored +2 / +1 / -1, Ghost (placed pieces hidden), Speed (small holes, see game.ts),
// Unlimited, seeds, cheat pieces, pause, Dismiss, best scores, and the end-of-session stats.
import { Images } from '../../core/assets';
import { SoundBank } from '../../core/audio';
import { copyText } from '../../core/clipboard';
import { keyMatches } from '../../core/controls';
import { loadFont } from '../../core/fonts';
import { dutyDesk } from '../../core/duty/desk';
import type { RatingScale } from '../../core/duty/ratings';
import { historyGroup } from '../../core/history';
import { ReplayRecorder, type PuzzleReplay, type ReplaySettingsCodec } from '../../core/replay';
import type { InputEvent } from '../../core/input';
import type { PuzzleFactory } from '../../core/puzzle';
import type { GameRecord } from '../../core/storage';
import { PyRandom } from '../../core/pyrandom';
import { BoardRandom, type Cell, Piece, PIECE_LETTERS } from './board';
import {
  CELL,
  Game,
  type HoleSprite,
  newStats,
  type PieceSprite,
  type SoundName,
  type Stats,
  TEXT_MS,
  TOOLBOX_AT,
  VIEW_H,
  VIEW_W,
  VIEW_X,
  VIEW_Y,
} from './game';
import { PIECES_NO_PUTTY } from './shapes';
import { piecesDrawn } from './report';
import delarobbUrl from './delarobb.ttf?url';

const imageUrls = import.meta.glob<string>('./media/*.png', { eager: true, query: '?url', import: 'default' });
const soundUrls = import.meta.glob<string>('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' });

const FONT = 'Delarobb';

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

/** Jared's sounds besides the game's: the 15-second warning, a new best, and option changes. */
type ExtraSound = 'warning' | 'audio_pb_sound' | 'audio_options_change';

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
};

/** Keys from the simulator's keybinds.yaml: flip, rotate anticlockwise, clockwise, toolbox 1-3, place. */
const KEYS = { flip: 'space', ccw: 'x', cw: 'c', slots: ['1', '2', '3'], place: 'z' };

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
  const [images] = await Promise.all([Images.load(imageUrls), loadFont(FONT, delarobbUrl)]);
  const img = (name: string) => images.get(name);
  const sounds = new SoundBank(soundUrls, () => replays?.isSeeking ?? false);
  const ctx = screen.ctx;

  // The putty bucket by state, for each look: upright for 0-1, pouring for 2-3, traced in the state's colour.
  const puttyImages = Object.fromEntries(
    (Object.keys(LOOKS) as Look[]).map((look) => [
      look,
      [0, 1, 2, 3].map((s) => traced(img(`putty${LOOKS[look].suffix}`), s < 2 ? 0 : PUTTY_W, PUTTY_W, PUTTY_H, hexRgb(LOOKS[look].outlines[s]))),
    ]),
  ) as Record<Look, HTMLCanvasElement[]>;

  const config: Config = { ...DEFAULT_CONFIG, ...store.get<Partial<Config>>('config', {}) };
  const look = () => LOOKS[config.look] ?? LOOKS.vampire;
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
  let warningPlayed = false;
  let boardIndex = 0;
  let seeded = store.get<boolean>('seeded', false);
  let seed = Math.floor(Math.random() * MAX_SEED);
  let seedAtStart = seed;
  let speedRng = new PyRandom();
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
  const sessionTime = () => (config.unlimited ? SESSION_LONG : SESSION_SHORT);
  const score = () => -stats.grades[0] + stats.grades[1] + stats.grades[2] * 2;

  function play(name: SoundName | ExtraSound): void {
    if (replays?.isSeeking) return;
    sounds.play(name.startsWith('audio_') || name === 'warning' ? name : `audio_${name}`);
  }

  /** The board for this point in the session: seeded sessions deal seed, seed + 1,... */
  function newBoard(): void {
    const boardSeed = replayBoardSeeds?.[boardIndex] ?? (seeded ? seedAtStart + boardIndex : Math.floor(Math.random() * MAX_SEED));
    recordedBoardSeeds.push(boardSeed);
    replays?.updateSeed({ seed: seedAtStart, speedRng: recordedSpeedState, boardSeeds: [...recordedBoardSeeds] });
    const speed = config.speed ? { holes: config.speedHoles, size: config.speedSize, letter: config.speedLetter } : null;
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
    );
    meterShown = 0;
    meterAt = timePassed;
  }

  function startSession(): void {
    stats = newStats();
    duty.clear();
    cheatsUsed = seeded || config.unlimited;
    sightUsed = false;
    if (!seeded) seed = Math.floor(Math.random() * MAX_SEED);
    seedAtStart = seed;
    speedRng = seeded ? new PyRandom(seed) : new PyRandom();
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
    warningPlayed = false;
    endProcedureComplete = false;
    sessionScoresComputed = false;
    pendingSounds = [];
    replays.begin({ config: { ...config }, seeded }, { seed: seedAtStart, speedRng: recordedSpeedState, boardSeeds: [] });
    newBoard();
  }

  function scoresKey(): string {
    return (config.ghost ? 'a' : 'b') + (config.speed ? 'a' : 'b') + (config.speed ? `${config.speedHoles}${config.speedSize}${config.speedLetter}` : '000');
  }

  /** The session's duty report: coffins boarded up by grade, rated by the score. */
  function endReport() {
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
      if (!replays.isPlaying && !cheatsUsed && scoreCounting && !(config.ghost && sightUsed)) {
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
    if (!replays.isPlaying && score() > 0 && !sessionScoresComputed) {
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
    if ((mx !== lastMouse[0] || my !== lastMouse[1]) && inView(mx, my)) game.pointerMove(mx, my);
    lastMouse = [mx, my];
    for (const event of events) {
      if (event.type === 'mousedown') {
        if (inView(event.pos[0], event.pos[1])) {
          // Several clicks can arrive in one frame; each acts where it happened.
          game.pointerMove(event.pos[0], event.pos[1]);
          game.pointerDown(event.button, event.pos[0], event.pos[1]);
        }
      } else if (event.type === 'mouseup') {
        game.pointerUp(event.button);
      } else if (event.type === 'keydown') {
        const k = event.key;
        if (keyMatches(k, 'vampire-carp', 'flip', KEYS.flip)) game.flip();
        else if (keyMatches(k, 'vampire-carp', 'rotateLeft', KEYS.ccw)) game.rotate(false);
        else if (keyMatches(k, 'vampire-carp', 'rotateRight', KEYS.cw)) game.rotate(true);
        else if (KEYS.slots.some((key, i) => keyMatches(k, 'vampire-carp', `piece${i + 1}`, key))) {
          game.keyPick(KEYS.slots.findIndex((key, i) => keyMatches(k, 'vampire-carp', `piece${i + 1}`, key)));
        }
        else if (keyMatches(k, 'vampire-carp', 'place', KEYS.place) && inView(mx, my)) game.placeKey(mx, my);
      }
    }
  }

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
      screen.blit(puttyImages[config.look][Math.min(3, sprite.state)], at[0], at[1], sprite.held ? { alpha: 204 } : {});
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

  function floatText(text: string, cx: number, cy: number, size: number, fill: string, stroke: string, alpha: number): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(1.1, 1);
    ctx.font = `${size}px "${FONT}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = fill;
    ctx.fillText(text, 0, 0);
    ctx.restore();
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
      const age = timePassed - t.start;
      const alpha = age < TEXT_MS / 2 ? 1 : Math.max(0, 1 - (age - TEXT_MS / 2) / (TEXT_MS / 2));
      floatText(t.text, sx(t.at[0]), sy(t.at[1]) - (30 * age) / TEXT_MS, t.size, t.colour, '#000000', alpha);
    }
    if (g.levelText) floatText(LEVEL_TEXT, sx(g.levelText.at[0]), sy(g.levelText.at[1]), 36, 'rgb(255, 243, 32)', 'rgb(48, 98, 123)', 1);
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

  /** str(round(x, n)) in Python. */

  /** The simulator's end-of-session table. */
  const duty = dutyDesk(panel, store, 'vampire-carp', 'Carpentry', RATING_SCALES);
  panel.results(() => endProcedureComplete && !boardActive && endProcedureKey === bestScoresKey ? {
    title: 'Carpentry results',
    report: duty.last,
    rows: [
      ['Score', String(score())],
      ['Time', `${(timePassed / 1000).toFixed(1)}s`],
      ['SS, CC, VP', stats.grades.join(', ')],
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
          ['Best score, most VP', `${totals.max_score}, ${totals.most_vp}`],
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

  type Mode = 'normal' | 'ghost' | 'speed';
  const mode = (): Mode => (config.ghost ? 'ghost' : config.speed ? 'speed' : 'normal');
  const setMode = (next: Mode) => {
    if (next === mode()) return;
    loadBestScore = true;
    // Ghost hides placed pieces, so a session that used it can't set a PB.
    if (config.ghost !== (next === 'ghost')) sightUsed = true;
    if (config.speed !== (next === 'speed')) boardActive = false;
    config.ghost = next === 'ghost';
    config.speed = next === 'speed';
    saveConfig();
  };

  panel.clock(() =>
    config.unlimited
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
  ]);
  session.select(
    'Mode',
    [
      { value: 'normal', label: 'Normal' },
      { value: 'ghost', label: 'Ghost' },
      { value: 'speed', label: 'Speed' },
    ],
    mode,
    setMode,
    { title: 'Ghost hides placed pieces; Speed deals small holes with the pieces to fill them' },
  );
  const actions = panel.group();
  actions.note(() => {
    const parts: string[] = [];
    if (config.speed) {
      const holes = `${config.speedHoles} hole${config.speedHoles > 1 ? 's' : ''}`;
      const pieces = `${config.speedSize} piece${config.speedSize > 1 ? 's' : ''} each`;
      const always = config.speedSize > 1 && config.speedLetter !== 12 ? `, always a ${PIECES_NO_PUTTY[config.speedLetter].toUpperCase()}` : '';
      parts.push(`${holes} of ${pieces}${always}`);
    }
    if (seeded) parts.push('Seeded');
    if (config.cheats) parts.push('Cheats');
    if (!scoreCounting || config.unlimited || config.cheats) parts.push('No PB');
    return parts.join(' · ');
  });

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

  const settings = panel.settings.group('Game');
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
    'Seeded',
    () => seeded,
    (on) => {
      boardActive = false;
      seeded = on;
      store.set('seeded', on);
    },
    { title: 'Start sessions from the seed below' },
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
    ['Score', String(score()), String(bestScore)],
  ]);

  const replayAction = {
    available: (game: GameRecord) => typeof game.replayAt === 'number' && (replays?.hasPlayableAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined) ?? false),
    play: (game: GameRecord) => { if (typeof game.replayAt === 'number') replays?.playAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined); },
  };
  historyGroup(panel, () => store.history(scoresKey()), [{ label: 'Score', value: (g) => String(g.score) }], 'Past games', replayAction);

  // Seeded: the board's own seed, so it deals what the game would.
  const seedGroup = panel.group('Seed', { hidden: () => !seeded });
  seedGroup.text(
    'Seed',
    () => String(seed),
    (text) => {
      boardActive = false;
      play('audio_options_change');
      text = text.trim();
      if (/^\d{1,15}$/.test(text) && Number(text) <= MAX_SEED) seed = Number(text);
    },
    { placeholder: 'up to 15 digits', inputMode: 'numeric' },
  );
  seedGroup
    .button(
      'Copy',
      () => {
        boardActive = false;
        copyText(String(seed), 'Copy this seed:');
        play('audio_options_change');
      },
      { title: 'Copy the seed' },
    )
    .button(
      'New',
      () => {
        boardActive = false;
        seed = Math.floor(Math.random() * MAX_SEED);
        copyText(String(seed), 'Copy this seed:');
        play('audio_options_change');
      },
      { title: 'Make a new seed and copy it' },
    );

  // Cheats: click a piece to hold it.
  const cheats = panel.group('Cheat pieces', { hidden: () => !config.cheats });
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
    'Graphics',
    [
      { value: 'vampire', label: 'Vampire Lair' },
      { value: 'normal', label: 'Normal carpentry' },
    ],
    () => config.look,
    (v) => changed(() => (config.look = v))(),
    { title: 'The Vampire Lair’s dark art, or normal carpentry’s' },
  );
  panel.settings.group('Reset').button('Reset to defaults', () => {
    Object.assign(config, DEFAULT_CONFIG);
    saveConfig();
    seeded = false;
    store.set('seeded', false);
    scoreCounting = true;
    store.set('scoreCounting', true);
    loadBestScore = true;
  }, { disabled: () => boardActive || pauseAvailable() });

  const replaySettingsCodec: ReplaySettingsCodec = {
    currentVersion: 1,
    simulatorVersion: 1,
    migrate: (version, value) => {
      if (version !== 1 || !value || typeof value !== 'object') return null;
      const wrapper = value as Record<string, unknown>;
      if (typeof wrapper.seeded !== 'boolean' || !wrapper.config || typeof wrapper.config !== 'object') return null;
      const c = wrapper.config as Record<string, unknown>;
      return Number.isFinite(c.volume) && typeof c.cheats === 'boolean' && typeof c.ghost === 'boolean' &&
        typeof c.speed === 'boolean' && Number.isFinite(c.speedHoles) && Number.isFinite(c.speedSize) &&
        typeof c.unlimited === 'boolean' && Number.isInteger(c.speedLetter) &&
        (c.look === 'vampire' || c.look === 'normal') ? value : null;
    },
  };
  const isVampireReplaySeed = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    const state = value as { seed: number; speedRng: unknown; boardSeeds: number[] };
    return Number.isSafeInteger(state.seed) && state.seed >= 0 && state.seed < MAX_SEED &&
      Array.isArray(state.boardSeeds) && state.boardSeeds.length > 0 &&
      state.boardSeeds.every((seed) => Number.isSafeInteger(seed) && seed >= 0 && seed < MAX_SEED) &&
      new PyRandom(0).restore(state.speedRng);
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
    Object.assign(config, settings.config);
    seeded = true;
    seed = seedData.seed;
    seedAtStart = seedData.seed;
    replayBoardSeeds = [...seedData.boardSeeds];
    replaySpeedState = seedData.speedRng;
    startSession();
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

  // ---- The frame ----

  function frame(events: InputEvent[]): void {
    const routed = replays.frame(events, input.mouse, ticks());
    events = routed.events;
    input.mouse = routed.mouse;
    if (!routed.renderOnly) {
      for (const command of routed.commands) {
        if (command === 'pause') toggleSessionPause();
        else if (command === 'dismiss' && boardActive) { boardIndex++; newBoard(); }
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
      if (boardActive && timePassed > sessionTime()) endSession();
      if (boardActive && timePassed > sessionTime() - 15000 && !warningPlayed) {
        play('warning');
        warningPlayed = true;
      }

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

  return { frame, dispose: () => { replays.dispose(); sounds.dispose(); } };
}) satisfies PuzzleFactory;
