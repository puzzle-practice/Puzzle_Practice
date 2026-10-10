// Treasure Haul presentation and session controls. Pieces float upward into the net;
// earned chests and practice drills share the same board animations. Rules live in logic.ts.
import { SessionPause } from '../../core/pause';
import { Images } from '../../core/assets';
import { SoundBank } from '../../core/audio';
import { loadFont } from '../../core/fonts';
import { dutyDesk } from '../../core/duty/desk';
import type { RatingScale } from '../../core/duty/ratings';
import { historyGroup } from '../../core/history';
import { ReplayRecorder, type PuzzleReplay, type ReplaySettingsCodec } from '../../core/replay';
import { keyMatches } from '../../core/controls';
import type { InputEvent } from '../../core/input';
import type { Option } from '../../core/panel';
import type { PuzzleFactory } from '../../core/puzzle';
import type { Drawable } from '../../core/screen';
import type { GameRecord } from '../../core/storage';
import { PyRandom } from '../../core/pyrandom';
import {
  type Cleared,
  chestValue,
  EMERALD,
  EMPTY,
  H,
  ChestMeter,
  ChestSupply,
  CHEST_DELAY_MS,
  HaulBoard,
  isChest,
  isChestOrigin,
  type Message,
  RUBY,
  type Step,
  W,
} from './logic';
import { createDrill, type ClearPack } from './training';
import delarobbUrl from './delarobb.ttf?url';

const imageUrls = import.meta.glob<string>('./media/*.png', { eager: true, query: '?url', import: 'default' });
const soundUrls = import.meta.glob<string>('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' });
type Sound = 'haul' | 'piece_swap' | 'piece_destroy' | 'big_combo' | 'shiny' | 'ruby' | 'emerald';

const WIDTH = 450;
/** Squares are 45px (HaulBoardView: 45, 45); the 360x360 board sits at (44, 205) in the panel. */
const CELL = 45;
const BOARD_X = 44;
const BOARD_Y = 205;
/** The net and hands panel above the board (HaulPanel._topPanel). */
const TOP = 198;
const BOARD = W * CELL;
/** The net, gold pile and hands share a line 98px down (HaulPanel.c). */
const NET_LINE = 98;
/** Mini pieces are 23px (HaulBoardView.f, g). */
const MINI = 23;
/** Floating up: 0.35px/ms, half again as fast when settling. */
const RISE_PX_PER_MS = 0.35 * 1.5;
const SWAP_MS = 250;
/** Spawn mode: the pieces above a chest that comes in on the bottom two rows, which must all clear to haul it. */
const MAX_ABOVE = 2 * (H - 2);
/** Spawn mode: points for a chest in the middle four columns, and for one anywhere else. */
const SPAWN_POINTS = 3;
const BAD_SPAWN = -9;
/** Message sizes: the game fonts, picked by the step's points out of 100. */
const FONT_SIZES = [24, 30, 36, 42, 52, 68];
const FONT = 'Delarobb';
/** Floating messages rise 30px over 1.5s, fading in the second half (nenya ScoreAnimation). */
const FLOAT_MS = 1500;
const FLOAT_PX = 30;
/** A skin tone for the hauling hands, which the game tints to your pirate's. */
const SKIN = [236, 188, 140];

/**
 * Chest modes limit the number in play and earn replacements from cleared coins. Spawn: a chest is
 * always waiting to come in, and the board is dealt again each time one does. clear: a chest comes in after a simulated move; each haul starts another drill.
 */
type Mode = '0' | 'chests1' | 'chests2' | 'spawn' | 'clear' | LegacyMode;
/** The old fixed 1- and 2-chest modes: no longer offered, but their replays still play. */
type LegacyMode = '1' | '2';
const MODES: Option<Mode>[] = [
  { value: '0', label: 'No chests' },
  { value: 'chests1', label: '1 chest' },
  { value: 'chests2', label: '2 chests' },
  { value: 'spawn', label: 'Spawn Chests' },
  { value: 'clear', label: 'Clear Chests' },
];
/** Default cleared-coin threshold for earning a chest. */
const COINS_PER_CHEST = 150;
/** Keeps historical replay defaults and history keys consistent. */
const LEGACY_COINS_PER_CHEST = 200;
/** Low, medium and high value chests at the shallow end of the pool (treasureMinAwesomeness). */
const CHEST_VALUE_WEIGHTS = [90, 9, 1];
const ROUNDS: Option<number>[] = [
  { value: 0, label: 'No timer' },
  { value: 30, label: '30 seconds' },
  { value: 120, label: '2 minutes' },
];


type Point = [number, number];

/** A piece moving between squares (DropBoardView.b with a LinePath); it lands in its square when done. */
interface Mover {
  piece: number;
  from: Point;
  to: Point;
  start: number;
  duration: number;
  tx: number;
  ty: number;
}

/** A cleared piece left in place until its blast reaches it. */
interface Fade {
  piece: number;
  x: number;
  y: number;
  until: number;
}

interface Spark {
  sheet: string;
  x: number;
  y: number;
  angle: number;
  start: number;
}

/** A piece flying up off the board, then a mini piece flying into the net. */
interface Flyer {
  piece: number;
  x: number;
  y: number;
  start: number;
  amp: number;
  period: number;
  fps: number;
}

interface Mini {
  piece: number;
  x: number;
  start: number;
  fps: number;
}

interface Text {
  text: string;
  colour: string;
  px: number;
  x: number;
  y: number;
  w: number;
  h: number;
  start: number;
}

interface Tally {
  moves: number;
  points: number;
  bestMove: number;
  coins: number;
  gems: number;
  /** The gems by kind, for the duty report. */
  rubies: number;
  emeralds: number;
  chests: number;
  chestsByType: number[];
  rubiesSpawned: number;
  emeraldsSpawned: number;
  /** Spawn mode: chests that came in, those in the middle four columns, and the score (see scoreSpawn). */
  spawned: number;
  middle: number;
  spawnScore: number;
}

/** Vampire ratings use the published chest counts; coin mode uses points a minute. */
const RATING_SCALES: RatingScale[] = [
  { id: 'points', label: 'Points a minute (0 chests)', cutoffs: [40, 80, 130, 180, 240] },
  // YPPedia: Vampirate expedition, Treasure Haul scoring.
  { id: 'vampirateChests', label: '2 chests, chests hauled', cutoffs: [2, 3, 5, 6, 8], gauntlet: true },
];

const emptyTally = (): Tally => ({ moves: 0, points: 0, bestMove: 0, coins: 0, gems: 0, rubies: 0, emeralds: 0, chests: 0, chestsByType: [0, 0, 0], rubiesSpawned: 0, emeraldsSpawned: 0, spawned: 0, middle: 0, spawnScore: 0 });

/** A copy of the purple hands tinted to a skin tone, keeping their shading. */
function tint(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const c = canvas.getContext('2d')!;
  c.drawImage(img, 0, 0);
  const data = c.getImageData(0, 0, img.width, img.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    // The parts to tint are purple: red and blue well above green.
    if (Math.min(r, b) - g < 40) continue;
    const v = Math.max(r, b) / 255;
    for (let k = 0; k < 3; k++) d[i + k] = Math.min(255, Math.round(SKIN[k] * v * 1.1));
  }
  c.putImageData(data, 0, 0);
  return canvas;
}

export default (async ({ screen, input, panel, store, ticks: rawTicks, setReplayTime: rawReplayTime }) => {
  const pause = new SessionPause(rawTicks, rawReplayTime);
  const { ticks, setReplayTime } = pause;
  const [images] = await Promise.all([Images.load(imageUrls), loadFont(FONT, delarobbUrl)]);
  const img = (name: string) => images.get(name);
  const sounds = new SoundBank<Sound>(soundUrls, () => replays?.isSeeking ?? false);
  const ctx = screen.ctx;
  const rng = new PyRandom();
  rng.seedFromCrypto();
  const random = () => rng.random();
  let replays!: ReplayRecorder;
  const hands = tint(img('hands'));

  let mode = store.get<Mode>('mode', 'chests2');
  if (mode === '1') mode = 'chests1';
  if (mode === '2') mode = 'chests2';
  if (!MODES.some((m) => m.value === mode)) mode = 'chests2';
  let coinsPerChest = store.get<number>('coinsPerChest', COINS_PER_CHEST);
  /** Chests mode: coins hauled since the last chest was awarded. */
  let chestMeter = new ChestMeter(coinsPerChest);
  /** Chests modes: a chest earned while the board already has its limit, waiting for room. */
  let chestEarned = false;
  let chestRules: 1 | 2 | 3 = 3;
  let trainingRules: 1 | 2 = 2;
  let chestSupply = new ChestSupply(coinsPerChest, ticks());
  /** 1 chest / 2 chests: the most chests on their way or on the board at once. */
  const chestLimit = () => (mode === 'chests1' ? 1 : mode === 'chests2' ? 2 : 0);
  const chestMode = () => chestLimit() > 0;
  let roundSecs = store.get<number>('round', 120);
  if (!ROUNDS.some((r) => r.value === roundSecs)) roundSecs = 120;
  const bests = store.get<Record<string, number>>('bestPoints', {});
  const savedPack = store.get<ClearPack | 'diamonds'>('clearPack', 'standard');
  let clearPack: ClearPack = savedPack === 'diamonds' ? 'emeralds' : savedPack;
  let spawnDelay = true;
  let gemRates = store.get<[number, number]>('gemRates', [200 / 308, 200 / 308]);
  let firstClearAt: number | null = null;
  let trainingChest: { x: number; y: number } | null = null;


  let board: HaulBoard | null = null;
  /** The pieces as drawn in their squares (DropBoardView._pieces); moving and cleared pieces are drawn separately. */
  let shown: number[] = new Array<number>(W * H).fill(EMPTY);
  let movers: Mover[] = [];
  let fades: Fade[] = [];
  let sparks: Spark[] = [];
  let flyers: Flyer[] = [];
  let minis: Mini[] = [];
  let texts: Text[] = [];
  let timers: { at: number; run: () => void }[] = [];
  let running = false;
  let finished = false;
  /** The cursor shows and moves once the pieces have floated in (HaulBoardView.c(boolean)). */
  let active = false;
  let stable = true;
  /** The start: every piece floats in from 360px below, the higher ones quicker. */
  let intro: { start: number; durations: number[] } | null = null;
  let roundEnd = 0;
  /** When the game ended, so its clock stops there. */
  let stoppedAt = 0;
  /** Spawn mode: a chest has come in, so the board is dealt again once it has finished moving. */
  let redeal = false;
  /** Spawn mode: the chest that came in, floating up until the board settles. */
  let landing: { x: number; middle: boolean; hauled: boolean } | null = null;
  /** When the spawned chest has been on show long enough to redeal (0 until it stops moving). */
  let redealAt = 0;
  /** Round start and a marker that the current training chest has been hauled. */
  let clockStart = 0;
  let clearMs = 0;
  let cursor: Point = [4, 6];
  let lastMouse: Point = [-1, -1];
  let tally = emptyTally();
  /** Mini pieces landed in the net, which raise the gold pile (HaulPanel._goldScore). */
  let gold = 0;
  /** The net's animation start, 0 when still. */
  let netStart = 0;
  /** The hands: hauling while pieces are on their way; each pull is 350ms down, 150ms up. */
  let hauling = false;
  let pull: { start: number; down: boolean } | null = null;
  let handsUp = true;

  const later = (ms: number, run: () => void) => timers.push({ at: ticks() + ms, run });
  /** Top-left of square (x, y) in board pixels: y = 0 is the bottom row (HaulBoardView.a(int, int, Point)). */
  const cellXY = (x: number, y: number): Point => [x * CELL, (H - 1 - y) * CELL];
  const chestSheet = (mini: boolean) => (mini ? 'minichest2x2' : 'chest2x2');
  /** Bests are kept per mode, pack, round length and spawn rules. */
  const timed = () => roundSecs > 0;
  const scoreLabel = () => mode === 'spawn' ? 'Spawn score' : mode === 'clear' ? 'Chests cleared' : chestMode() || mode === '1' || mode === '2' ? 'Chests hauled' : 'Points';
  const bestKey = () => `${mode}:${mode === 'clear' ? clearPack + ':' : ''}${roundSecs}` +
    (coinOnlyEdges() || gemRates.every((rate) => rate === 200 / 308) ? '' : `:gems:${gemRates.join('-')}`) +
    (mode === 'spawn' && spawnDelay ? ':delay' : '') +
    (chestRules >= 2 && (chestMode() || mode === 'spawn' || mode === 'clear') ? chestRules === 3 && mode === 'chests2' ? ':rules3' : ':rules2' : '') +
    (presetDrill() ? ':drills2' : '') +
    (chestMode() && coinsPerChest !== LEGACY_COINS_PER_CHEST ? `:coins:${coinsPerChest}` : '');
  const actionCount = () => movers.length + fades.length;
  const inFlight = () => flyers.length + minis.length;
  const presetDrill = () => mode === 'clear' && trainingRules === 2 && (clearPack === 'emeralds' || clearPack === 'edges');
  const coinOnlyEdges = () => mode === 'clear' && trainingRules === 2 && clearPack === 'edges';

  function playLater(sound: Sound, ms: number): void {
    if (ms <= 0) sounds.play(sound);
    else later(ms, () => sounds.play(sound));
  }

  // ---- Drawing helpers ----

  /** A piece's still picture: frame 0 of its strip, a chest's picture on its top-left square, nothing on the rest. */
  function drawPiece(piece: number, x: number, y: number): void {
    if (piece === EMPTY) return;
    if (isChest(piece)) {
      if (!isChestOrigin(piece)) return;
      ctx.drawImage(img(chestSheet(false)), chestValue(piece) * 2 * CELL, 0, 2 * CELL, 2 * CELL, x, y, 2 * CELL, 2 * CELL);
      return;
    }
    ctx.drawImage(img(`piece${piece}`), 0, 0, CELL, CELL, Math.trunc(x), Math.trunc(y), CELL, CELL);
  }

  /** One frame of an animated strip, looping at fps. */
  function drawFrame(sheet: Drawable, size: number, fps: number, start: number, now: number, x: number, y: number): void {
    const frames = Math.max(1, Math.floor(sheet.width / size));
    const f = Math.floor(((now - start) * fps) / 1000) % frames;
    ctx.drawImage(sheet, f * size, 0, size, size, Math.trunc(x), Math.trunc(y), size, size);
  }

  /** A floating message, moved clear of any already showing (PuzzleBoardView.f's arranger). */
  function say(message: Message, points: number): void {
    const px = FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.floor((points * (FONT_SIZES.length)) / 100))];
    ctx.save();
    ctx.font = `${px}px "${FONT}"`;
    const w = Math.ceil(ctx.measureText(message.text).width * 1.1) + 4;
    ctx.restore();
    const h = Math.round(px * 1.2);
    let x: number;
    let y: number;
    // HaulBoardView.a(int x, int y, int w, int h,...): centred across w squares, and over the top of h.
    const place = (cx: number, cy: number, cw: number, ch: number) => {
      const [bx, by] = cellXY(cx, cy);
      x = Math.max(Math.min(bx + (cw * CELL - w) / 2, BOARD - w), 0);
      y = by + (ch * CELL - 2 * h) / 2;
    };
    if (message.kind === 'chain') place(0, H - 1, W, H);
    else if (message.run) place(message.run.x, message.run.y, message.run.dir === 0 ? message.run.length : 1, message.run.dir === 1 ? message.run.length : 1);
    else place(cursor[0], cursor[1], 2, 1);
    const now = ticks();
    for (const t of texts) {
      const ty = t.y - (FLOAT_PX * (now - t.start)) / FLOAT_MS;
      if (y! < ty + t.h && ty < y! + h && x! < t.x + t.w && t.x < x! + w) y = ty + t.h;
    }
    texts.push({ text: message.text, colour: message.kind === 'chain' ? '#ffff00' : '#ffffff', px, x: x!, y: Math.min(y!, BOARD - h), w, h, start: now });
  }

  // ---- The game ----

  /** A fresh board floating in from below; at full speed it's the start, quicker for a spawn-mode redeal. */
  function deal(speed: number, onReady: () => void): void {
    firstClearAt = null;
    trainingChest = null;
    if (mode === 'clear') {
      const drill = createDrill(random, clearPack, trainingRules);
      board = drill.board;
      if (!presetDrill()) trainingChest = drill.chest;
    } else {
      board = new HaulBoard(random);
      board.populate();
    }
    board.gemRates = coinOnlyEdges() ? [0, 0] : [...gemRates];
    board.chestReady = () => mode !== 'spawn' || (chestRules === 1 && !spawnDelay) || (firstClearAt !== null && ticks() >= firstClearAt + CHEST_DELAY_MS);
    sendChests();
    shown = [...board.cells];
    if (trainingChest) {
      const { x, y } = trainingChest;
      for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) shown[(y - dy) * W + x + dx] = EMPTY;
      const sx = x + (x > 0 ? -1 : 2);
      shown[2 * W + sx] = board.get(sx, 1);
      shown[W + sx] = board.get(sx, 2);
    }
    movers = [];
    fades = [];
    stable = true;
    redeal = false;
    landing = null;
    if (presetDrill()) {
      intro = null;
      onReady();
      return;
    }
    // Each column's pieces get quicker going up: 1500ms less up to 150ms per piece, no quicker than 500ms.
    const durations: number[] = [];
    const left = new Array<number>(W).fill(0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (left[x] === 0) left[x] = 1500;
        left[x] = Math.max(left[x] - rng.randintN(0, 149), 500);
        durations[y * W + x] = left[x] / speed;
      }
    }
    intro = { start: ticks(), durations };
    later(Math.max(...durations), () => {
      intro = null;
      if (trainingChest && board) {
        // The practice partner's clear opens a route; the chest floats in before control passes back.
        const { x, y } = trainingChest;
        const sx = x + (x > 0 ? -1 : 2);
        sounds.play('piece_swap');
        move(board.get(sx, 1), sx, 2, sx, 1, SWAP_MS);
        move(board.get(sx, 2), sx, 1, sx, 2, SWAP_MS);
        later(SWAP_MS, () => {
          movers = movers.filter((m) => m.tx !== sx || (m.ty !== 1 && m.ty !== 2));
          shown[2 * W + sx] = board!.get(sx, 2);
          shown[W + sx] = board!.get(sx, 1);
          const bringIn = () => {
            for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
              move(board!.get(x + dx, y - dy), x + dx, -1 - dy, x + dx, y - dy, CELL * (y + 1) / RISE_PX_PER_MS);
            }
            later(CELL * (y + 1) / RISE_PX_PER_MS, onReady);
          };
          if (chestRules >= 2) later(CHEST_DELAY_MS, bringIn);
          else bringIn();
        });
      } else onReady();
    });
  }

  function start(): void {
    pause.resume();
    replays.begin({ mode, clearPack, roundSecs, spawnDelay, gemRates: [...gemRates], coinsPerChest, chestRules, trainingRules }, rng.snapshot());
    chestSupply = new ChestSupply(coinsPerChest, ticks(), chestRules === 3 && mode === 'chests2');
    chestMeter = chestRules >= 2 ? chestSupply.meter : new ChestMeter(coinsPerChest);
    chestEarned = false;
    sparks = [];
    flyers = [];
    minis = [];
    texts = [];
    timers = [];
    tally = emptyTally();
    duty.clear();
    gold = 0;
    netStart = 0;
    hauling = false;
    pull = null;
    handsUp = true;
    running = true;
    finished = false;
    active = false;
    cursor = [4, 6];
    lastMouse = [-1, -1];
    roundEnd = 0;
    clockStart = 0;
    clearMs = 0;
    deal(1, () => {
      sounds.play('big_combo');
      active = true;
      if (timed()) roundEnd = ticks() + roundSecs * 1000;
      clockStart = ticks();
    });
  }

  function dismissBoard(): void {
    if (!running || !active || intro || !stable || actionCount() || landing || redeal) return;
    active = false;
    sparks = []; flyers = []; minis = []; texts = []; timers = [];
    netStart = 0; hauling = false; pull = null; handsUp = true; redealAt = 0; clearMs = 0;
    deal(3, () => { active = true; });
  }

  /** The score a mode keeps a best of: chests hauled, coin points or spawn-drill points. */
  function score(): number {
    if (mode === 'spawn') return tally.spawnScore;
    if (mode === 'clear' || chestMode()) return tally.chests;
    return tally.points;
  }

  function stop(): void {
    // A round counts when its time is up, or in clear mode when the board is cleared; not when stopped early.
    const completed = timed() && !!roundEnd && ticks() >= roundEnd;
    const wasRunning = running;
    const report = wasRunning ? endReport() : duty.last;
    const finishedReplay = replays.finish(`${score()} ${mode === 'clear' || chestMode() ? 'chests' : 'points'}`, report);
    if (completed && wasRunning && !replays.isPlaying) store.addHistory(bestKey(), {
      score: score(),
      ...duty.fields(report),
      ...(finishedReplay ? { replayAt: finishedReplay.at, replayId: finishedReplay.runId ?? ''} : {}),
    });
    stoppedAt = ticks();
    running = false;
    active = false;
    finished = true;
    intro = null;
    timers = [];
    const best = bests[bestKey()];
    const better = !replays.isPlaying && completed && (best === undefined || score() > best);
    if (better) {
      bests[bestKey()] = score();
      store.set('bestPoints', bests);
    }
  }

  /** Vampire mode rates chests hauled; 0 chests rates points a minute. Haunted Seas has no published fixed thresholds; it and drills are Learning. */
  function endReport() {
    const minutes = clockStart ? Math.max(0, ticks() - clockStart) / 60000 : 0;
    const rated = mode === '0' || (mode === '2' || mode === 'chests2');
    return duty.end({
      mode: MODES.find((m) => m.value === mode)?.label,
      performance: duty.rate(rated ? (mode === '2' || mode === 'chests2') ? 'vampirateChests' : 'points' : null,
        rated ? (mode === '2' || mode === 'chests2') ? tally.chests : (minutes > 0 ? tally.points / minutes : 0) : null),
      score: { label: scoreLabel(), value: String(score()) },
      cleared: mode === '0' ? [{ label: 'Treasure Hauled', items: [
        { icon: 'haul-coin', label: 'coins', count: tally.coins },
        { icon: 'haul-ruby', label: 'rubies', count: tally.rubies },
        { icon: 'haul-emerald', label: 'emeralds', count: tally.emeralds },
      ] }] : [{ label: 'Chests Hauled', items: [
        ...['small', 'medium', 'large'].map((size, i) => ({
          icon: `${(mode === '2' || mode === 'chests2') ? 'vampirate-chest' : (mode === '1' || mode === 'chests1') ? 'haunted-chest' : 'chest'}-${size}`,
          label: `${size} chests`, count: tally.chestsByType[i],
        })),
      ] }],
    });
  }

  /** Moves a square's piece to another square over the duration (DropBoardView.a_). */
  function move(piece: number, fx: number, fy: number, tx: number, ty: number, duration: number): void {
    if (fy >= 0 && fy < H) shown[fy * W + fx] = EMPTY;
    movers.push({ piece, from: cellXY(fx, fy), to: cellXY(tx, ty), start: ticks(), duration, tx, ty });
  }

  /** Clears a piece: it stays until the blast reaches it, then sparks and flies up to the net. */
  function clearFx(c: Cleared, removeSprite = true): void {
    if (removeSprite) shown[c.y * W + c.x] = EMPTY;
    const now = ticks();
    fades.push({ piece: c.piece, x: c.x, y: c.y, until: now + c.delay });
    later(c.delay, () => {
      let [px, py] = cellXY(c.x, c.y);
      const chest = isChest(c.piece);
      const sheet = c.piece === RUBY ? 'sparks_ruby' : c.piece === EMERALD ? 'sparks_emerald' : 'sparks';
      const at = ticks();
      for (let i = 0; i < 5; i++) {
        sparks.push({ sheet: sheet, x: chest ? px + 23 : px, y: chest ? py - 23 : py, angle: (Math.PI * 2 * i) / 5, start: at });
      }
      if (!chest || isChestOrigin(c.piece)) {
        [px, py] = cellXY(c.x, c.y);
        flyers.push({ piece: c.piece, x: px, y: py, start: at, amp: random() * 10, period: 100 + rng.randintN(0, 99), fps: 15 + rng.randintN(0, 14) });
        startHauling();
      }
    });
  }

  /** Sounds for cleared pieces: each kind once per blast wave. */
  function clearSounds(cleared: Cleared[]): void {
    const heard = new Set<string>();
    for (const c of cleared) {
      const key = `${c.delay}:${c.piece}`;
      if (heard.has(key)) continue;
      heard.add(key);
      playLater(c.piece === RUBY ? 'ruby' : c.piece === EMERALD ? 'emerald' : 'piece_destroy', c.delay);
    }
  }

  function countCleared(cleared: Cleared[]): void {
    if (chestMode() && chestRules >= 2) chestSupply.addCleared(cleared, ticks());
    for (const c of cleared) {
      if (c.piece === RUBY || c.piece === EMERALD) {
        tally.gems++;
        if (c.piece === RUBY) tally.rubies++;
        else tally.emeralds++;
      }
      else if (!isChest(c.piece)) tally.coins++;
    }
  }

  function swapAt(x: number, y: number): void {
    if (!board || !active || !stable || intro || redeal || landing || clearMs || actionCount() > 0 || (roundEnd && ticks() >= roundEnd)) return;
    sendChests();
    if (chestMode() && chestRules >= 2) chestSupply.beginMove(board, chestLimit());
    const result = board.swap(x, y);
    if (result.kind === 'illegal') return;
    if (result.kind === 'gem') {
      tally.moves++;
      if (result.cleared.length && firstClearAt === null) firstClearAt = ticks();
      clearSounds(result.cleared);
      countCleared(result.cleared);
      for (const c of result.cleared) clearFx(c);
      stable = false;
    } else {
      // The two pieces trade places over 250ms.
      sounds.play('piece_swap');
      move(result.upper, x, y, x, y - 1, SWAP_MS);
      move(result.lower, x, y - 1, x, y, SWAP_MS);
      if (result.kind === 'swap') {
        tally.moves++;
        stable = false;
      }
    }
  }

  /** Supplies spawn drills and preserves the chest scheduling used by historical replays. */
  function sendChests(): void {
    if (!board) return;
    // Spawn mode: one chest always waiting at the bottom, ready to come in at the next gap.
    if (mode === 'spawn') {
      if (!board.chestList.length) board.chestList.push({ value: rng.randintN(0, 2), size: 0 });
      return;
    }
    if (chestMode()) {
      if (chestRules >= 2) return;
      // The first chest is sent as the game starts; the rest are earned (awardChests) and wait for room under the limit.
      let count = board.chestList.length + board.pending.length;
      for (const p of board.cells) if (isChestOrigin(p)) count++;
      if (tally.moves === 0 && count === 0) chestEarned = true;
      if (chestEarned && count < chestLimit()) {
        board.pending.push({ value: pickChestValue(), size: 0 });
        chestEarned = false;
      }
      return;
    }
    const want = mode === 'clear' || mode === '0' ? 0 : Number(mode);
    let count = board.chestList.length + board.pending.length;
    for (const p of board.cells) if (isChestOrigin(p)) count++;
    for (; count < want; count++) board.pending.push({ value: rng.randintN(0, 2), size: 0 });
  }

  /** A chest's value (its picture): low, medium or high by the game's shallow-end weights. */
  function pickChestValue(): number {
    let r = random() * CHEST_VALUE_WEIGHTS.reduce((a, b) => a + b, 0);
    for (let v = 0; v < CHEST_VALUE_WEIGHTS.length; v++) if ((r -= CHEST_VALUE_WEIGHTS[v]) < 0) return v;
    return 0;
  }

  /** Historical replays earned one waiting chest from each move's point total. */
  function awardChests(points: number): void {
    if (!chestMode() || !board || chestRules >= 2) return;
    if (chestMeter.add(points) > 0) chestEarned = true;
    sendChests();
  }

  function animate(step: Step): void {
    if (step.kind === 'rise') {
      for (const m of step.moves) {
        if (m.fy < 0 && m.piece === RUBY) tally.rubiesSpawned++;
        if (m.fy < 0 && m.piece === EMERALD) tally.emeraldsSpawned++;
        const duration = (CELL * Math.abs(m.ty - m.fy)) / RISE_PX_PER_MS;
        move(m.piece, m.fx, m.fy, m.tx, m.ty, duration);
      }
      const spawned = mode === 'spawn' ? step.moves.find((m) => isChestOrigin(m.piece) && m.fy < 0) : undefined;
      if (spawned) {
        // The middle four columns are 2-5; the chest is scored once it has floated up and the board has settled.
        landing = { x: spawned.tx, middle: spawned.tx >= 2 && spawned.tx + 1 <= W - 3, hauled: false };
      }
    } else if (step.kind === 'haul') {
      tally.chests += step.chests.length;
      for (const chest of step.chests) tally.chestsByType[chestValue(chest.piece)]++;
      if (landing && step.chests.some((c) => c.x === landing!.x)) landing.hauled = true;
      if (mode === 'clear') {
        clearMs = ticks() - clockStart;
        sounds.play('big_combo');
      }
      // The chest's top-left square goes twice: once for the chest and once with its squares.
      for (const chest of step.chests) clearFx({ x: chest.x, y: H - 1, piece: chest.piece, delay: 0 });
      clearSounds(step.cleared);
      for (const c of step.cleared) clearFx(c);
    } else {
      if (step.cleared.length && firstClearAt === null) firstClearAt = ticks();
      clearSounds(step.cleared);
      countCleared(step.cleared);
      for (const c of step.cleared) clearFx(c);
      if (step.message) {
        if (step.message.sound) sounds.play(step.message.sound);
        say(step.message, step.points);
      }
    }
  }

  /** The board settles one step at a time once nothing is moving. */
  function evolve(): void {
    if (!board || intro || actionCount() > 0) return;
    if (redeal) {
      // The chest has landed and been scored: it shows for half a second, then a new board floats in.
      if (!redealAt) redealAt = ticks() + 500;
      if (ticks() < redealAt) return;
      if (roundEnd && ticks() >= roundEnd) stop();
      else deal(3, () => { active = true; });
      return;
    }
    if (stable) return;
    if (chestMode() && chestRules >= 2) chestSupply.release(board, ticks(), pickChestValue);
    const step = board.step();
    if (step) {
      animate(step);
      return;
    }
    stable = true;
    const points = board.settle();
    tally.points += points;
    tally.bestMove = Math.max(tally.bestMove, points);
    awardChests(points);
    if (landing) scoreSpawn(landing);
    else if (roundEnd && ticks() >= roundEnd) stop();
    else if (mode === 'clear' && clearMs) {
      clearMs = 0;
      active = false;
      redeal = true;
      redealAt = 0;
    }
  }

  /**
   * Spawn mode, once the chest has landed: a chest in the middle four columns scores 3, plus
   * 12 less the pieces still above it in its two columns (12 is what's above a chest on the
   * bottom two rows; a chest that floats all the way up and is hauled has none left). A chest
   * anywhere else scores -9. Then the board is dealt again.
   */
  function scoreSpawn(chest: { x: number; middle: boolean; hauled: boolean }): void {
    landing = null;
    let above = 0;
    let row = H - 1;
    if (!chest.hauled && board) {
      for (let y = 0; y < H; y++) if (isChestOrigin(board.get(chest.x, y))) row = y;
      for (let y = row + 1; y < H; y++) for (const x of [chest.x, chest.x + 1]) if (board.get(x, y) !== EMPTY) above++;
    }
    const gained = chest.middle ? SPAWN_POINTS + MAX_ABOVE - above : BAD_SPAWN;
    tally.spawned++;
    if (chest.middle) tally.middle++;
    tally.spawnScore += gained;
    sounds.play(chest.middle ? 'shiny' : 'piece_destroy');
    const [x, y] = cellXY(chest.x, row);
    texts.push({ text: gained > 0 ? `+${gained}` : String(gained), colour: chest.middle ? '#ffff00' : '#ff6060', px: 42, x: x + 10, y: Math.max(0, y - 10), w: 70, h: 50, start: ticks() });
    redeal = true;
    redealAt = 0;
  }

  function startHauling(): void {
    if (!netStart) netStart = ticks();
    if (!hauling) {
      hauling = true;
      if (!pull) {
        sounds.play('haul');
        pull = { start: ticks(), down: true };
      }
    }
  }

  // ---- Per-frame updates ----

  function updateMovers(now: number): void {
    movers = movers.filter((m) => {
      if (now < m.start + m.duration) return true;
      shown[m.ty * W + m.tx] = m.piece;
      return false;
    });
    fades = fades.filter((f) => now < f.until + 20);
  }

  function updateFlyers(now: number): void {
    flyers = flyers.filter((f) => {
      const y = Math.round(f.y - (now - f.start) * 0.6);
      const h = isChest(f.piece) ? 2 * CELL : CELL;
      if (y >= -h) return true;
      const x = Math.round(f.x + f.amp * Math.sin((Math.PI * 2 * (now - f.start)) / f.period));
      minis.push({ piece: f.piece, x: x + 44, start: now, fps: 15 + rng.randintN(0, 14) });
      return false;
    });
    minis = minis.filter((m) => {
      if (now < m.start + 500) return true;
      gold++;
      return false;
    });
    sparks = sparks.filter((s) => now < s.start + 900);
  }

  /** The net plays at 10fps while anything is on its way, finishing its cycle; the hands follow. */
  function netFrame(now: number): number {
    if (!netStart) return 0;
    const f = Math.floor((now - netStart) / 100) % 3;
    if (inFlight() === 0) {
      hauling = false;
      if (f === 2) netStart = 0;
    }
    return f;
  }

  /** The hands' height and picture: down 350ms with open hands, up 150ms closed. */
  function handsPose(now: number): { y: number; tile: number } {
    const up = NET_LINE - 47;
    const down = NET_LINE - 16;
    if (!pull) return { y: handsUp ? up : down, tile: handsUp ? 1 : 0 };
    const t = now - pull.start;
    if (pull.down) {
      if (t < 350) return { y: up + ((down - up) * t) / 350, tile: 1 };
      pull = { start: pull.start + 350, down: false };
      return handsPose(now);
    }
    if (t < 150) return { y: down + ((up - down) * t) / 150, tile: 0 };
    handsUp = true;
    if (hauling) {
      sounds.play('haul');
      pull = { start: pull.start + 150, down: true };
      return handsPose(now);
    }
    pull = null;
    return { y: up, tile: 1 };
  }

  function drawTop(now: number): void {
    const top = TOP;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, WIDTH, top);
    ctx.clip();
    const pile = img('gold_pile');
    ctx.drawImage(pile, 0, NET_LINE - Math.max(0, Math.min(pile.height, Math.round((gold / 10000) * pile.height))));
    const pose = handsPose(now);
    ctx.drawImage(hands, pose.tile * 58, 0, 58, 73, 225 - 29, Math.trunc(pose.y), 58, 73);
    ctx.drawImage(img('net_haul'), netFrame(now) * 450, 0, 450, 109, 0, NET_LINE - 9, 450, 109);
    // Mini pieces come up from the board to the net in 300ms, then drop into it in 200ms.
    for (const m of minis) {
      const chest = isChest(m.piece);
      const size = chest ? 2 * MINI : MINI;
      const t = now - m.start;
      const mid = NET_LINE + size / 2;
      const y = t < 300 ? top + ((mid - top) * t) / 300 : mid + ((NET_LINE - size - mid) * (t - 300)) / 200;
      if (chest) ctx.drawImage(img(chestSheet(true)), chestValue(m.piece) * size, 0, size, size, m.x, Math.trunc(y), size, size);
      else drawFrame(img(`minipiece${m.piece}`), MINI, m.fps, m.start, now, m.x, y);
    }
    ctx.restore();
  }

  function drawBoard(now: number): void {
    ctx.save();
    ctx.translate(BOARD_X, BOARD_Y);
    ctx.beginPath();
    ctx.rect(0, 0, BOARD, BOARD);
    ctx.clip();
    if (intro) {
      const t = now - intro.start;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const d = intro.durations[y * W + x];
          const [px, py] = cellXY(x, y);
          drawPiece(shown[y * W + x], px, py + 360 * Math.max(0, 1 - t / d));
        }
      }
    } else {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) drawPiece(shown[y * W + x], ...cellXY(x, y));
    }
    for (const f of fades) if (now < f.until) drawPiece(f.piece, ...cellXY(f.x, f.y));
    for (const m of movers) {
      const t = Math.min(1, (now - m.start) / m.duration);
      drawPiece(m.piece, Math.trunc(m.from[0] + (m.to[0] - m.from[0]) * t), Math.trunc(m.from[1] + (m.to[1] - m.from[1]) * t));
    }
    if (active && board) {
      ctx.drawImage(img('cursor'), cursor[0] * CELL - 4, (H - 1 - cursor[1]) * CELL - 4);
    }
    // Sparks fly out for 900ms, fading after the first 200ms.
    for (const s of sparks) {
      const t = now - s.start;
      const late = Math.max(0, t - 200);
      const x = s.x + Math.round(t * Math.cos(s.angle) * 0.12 + 3e-5 * late * late);
      const y = s.y + Math.round(t * (Math.sin(s.angle) * 0.12 + 1e-4 * t));
      ctx.globalAlpha = Math.max(0, Math.min(1, 1 - late / 700));
      drawFrame(img(s.sheet), 39, 15, s.start, now, x, y);
      ctx.globalAlpha = 1;
    }
    for (const f of flyers) {
      const t = now - f.start;
      const x = Math.round(f.x + f.amp * Math.sin((Math.PI * 2 * t) / f.period));
      const y = Math.round(f.y - t * 0.6);
      if (isChest(f.piece)) drawPiece(f.piece, x, y);
      else drawFrame(img(`piece${f.piece}`), CELL, f.fps, f.start, now, x, y);
    }
    drawTexts(now);
    ctx.restore();
  }

  function drawTexts(now: number): void {
    texts = texts.filter((t) => now < t.start + FLOAT_MS);
    for (const t of texts) {
      const p = (now - t.start) / FLOAT_MS;
      ctx.save();
      ctx.globalAlpha = p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) * 2);
      // The game stretches its message font 10% wide and outlines it in black.
      ctx.translate(t.x + t.w / 2, t.y - FLOAT_PX * p);
      ctx.scale(1.1, 1);
      ctx.font = `${t.px}px "${FONT}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.colour;
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
  }

  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  function banner(text: string, y: number): void {
    ctx.save();
    ctx.font = `30px "${FONT}"`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff';
    ctx.strokeText(text, WIDTH / 2, y);
    ctx.fillText(text, WIDTH / 2, y);
    ctx.restore();
  }

  function moveCursor(dx: number, dy: number): void {
    if (!active) return;
    // The cursor covers a square and the one below it, so its row is never the bottom one.
    const x = Math.max(cursor[0] + dx, 0);
    const y = Math.max(cursor[1] + dy, 1);
    if (x < W && y < H) cursor = [x, y];
  }

  function frame(events: InputEvent[]): void {
    const liveEvents = pause.input(events, 'treasure-haul', running);
    if (liveEvents === null) return;
    events = liveEvents;
    const routed = replays.frame(events, input.mouse, ticks());
    events = routed.events;
    input.mouse = routed.mouse;
    const now = ticks();
    if (!routed.renderOnly) {
      for (const command of routed.commands) if (command === 'dismiss') dismissBoard();
      const onBoard = (p: Point) => p[0] >= BOARD_X && p[0] < BOARD_X + BOARD && p[1] >= BOARD_Y && p[1] < BOARD_Y + BOARD;
      // The cursor follows the mouse over the board: the square under it and the one below (HaulBoardView.c(int, int)).
      if (active && onBoard(input.mouse) && (input.mouse[0] !== lastMouse[0] || input.mouse[1] !== lastMouse[1])) {
        const cx = Math.max(0, Math.min(Math.floor((input.mouse[0] - BOARD_X) / CELL), W - 1));
        const cy = Math.min(H - 1, H - Math.floor((input.mouse[1] - BOARD_Y) / CELL));
        cursor = [cx, cy];
      }
      lastMouse = input.mouse;
      for (const event of events) {
        if (event.type === 'mousedown' && event.button <= 3 && onBoard(event.pos)) swapAt(cursor[0], cursor[1]);
        else if (event.type === 'keydown') {
          if (keyMatches(event.key, 'treasure-haul', 'left', 'arrowleft')) moveCursor(-1, 0);
          else if (keyMatches(event.key, 'treasure-haul', 'right', 'arrowright')) moveCursor(1, 0);
          else if (keyMatches(event.key, 'treasure-haul', 'up', 'arrowup')) moveCursor(0, 1);
          else if (keyMatches(event.key, 'treasure-haul', 'down', 'arrowdown')) moveCursor(0, -1);
          else if (keyMatches(event.key, 'treasure-haul', 'swap', 'space', ['enter'])) swapAt(cursor[0], cursor[1]);
        }
      }

      for (const timer of timers.filter((t) => now >= t.at)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.run();
      }
      updateMovers(now);
      updateFlyers(now);
      if (running) {
        evolve();
        // Time's up: no more swaps, and the round ends once the board settles.
        if (roundEnd && now >= roundEnd) {
          active = false;
          if (stable && actionCount() === 0) stop();
        }
      }
      handsPose(now);
      netFrame(now);

    }

    if (replays.isSeeking || replays.isAdvancing) return;
    screen.fill('#000');
    screen.blit(img('background'), 0, 0);
    drawTop(now);
    drawBoard(now);
    if (!running && !board) banner('Press Start to haul treasure', BOARD_Y + 180);
    else if (finished) banner(clearMs ? `Hauled in ${seconds(clearMs)}` : roundEnd && now >= roundEnd ? "Time's up!" : 'Stopped', BOARD_Y + 180);
    replays.drawOverlay(ctx);
  }

  pause.install(panel, () => running);

  // ---- Panel ----

  /** The clock's now: it stops when the game does. */
  const clockNow = () => (running ? ticks() : stoppedAt);
  panel.clock(() => {
    if (!timed()) return null;
    const ms = roundEnd ? roundEnd - clockNow() : roundSecs * 1000;
    return { label: 'Time left', ms, countdown: true, warn: running && ms < 10000 };
  });

  panel.controls('treasure-haul', [
    { id: 'pause', label: 'Pause / resume', defaultKey: 'Escape' },
    { id: 'left', label: 'Move left', defaultKey: 'ArrowLeft' },
    { id: 'right', label: 'Move right', defaultKey: 'ArrowRight' },
    { id: 'up', label: 'Move up', defaultKey: 'ArrowUp' },
    { id: 'down', label: 'Move down', defaultKey: 'ArrowDown' },
    { id: 'swap', label: 'Swap pieces', defaultKey: 'Space' },
  ]);
  const session = panel.session();
  session.select('Mode', MODES, () => mode, (m) => {
    mode = m;
    store.set('mode', m);
  }, { disabled: () => running });
  session.select('Training pack', [
    { value: 'standard', label: 'Middle chests' },
    { value: 'efficient', label: 'Vertical + horizontal 3' },
    { value: 'emeralds', label: 'Edge emeralds' },
    { value: 'edges', label: 'Difficult edge chests' },
  ] as Option<ClearPack>[], () => clearPack, (p) => { clearPack = p; store.set('clearPack', p); }, { hidden: () => mode !== 'clear', disabled: () => running });
  const actions = panel.group();
  actions.note(() => mode === 'clear' ? presetDrill() ? 'Start with the chest in position. Haul as many as you can.' : 'A practice move brings in each chest. Haul as many as you can.' : '');
  // Starting while a replay is open closes it and starts a game of your own.
  actions.button('Start', () => { if (replays.isPlaying) { replays.stop(); if (replays.isPlaying) return; } if (running) stop(); else start(); }, { variant: 'primary', label: () => (replays?.isPlaying ? 'Start' : running ? 'Stop' : finished ? 'Play again' : 'Start') });

  actions.button('Dismiss', () => { replays.command('dismiss'); dismissBoard(); }, {
    disabled: () => !running || !active || !!intro || !stable || !!actionCount() || !!landing || redeal || pause.paused || !!replays?.isPlaying,
    title: 'Deal a fresh board; keep the session score and timer running.',
  });

  const best = () => bests[bestKey()];
  const waitingChests = () => (running || finished ? chestSupply.waiting + (board?.chestList.length ?? 0) : 0);
  panel.score('Haul').stats(['', 'Now', 'Best'], () => [[
    scoreLabel(),
    String(score()), timed() && best() !== undefined ? String(best()) : '—',
  ], ...(chestMode() && chestRules >= 2 ? [
    ['Coins toward next chest', `${chestMeter.coins} / ${coinsPerChest}`, '—'],
    ['Chests waiting', String(waitingChests()), '—'],
  ] : [])]);
  const duty = dutyDesk(panel, store, 'treasure-haul', 'Treasure Haul', RATING_SCALES, {
    shown: (id) => id === 'vampirateChests' ? (mode === '2' || mode === 'chests2') : mode === '0',
  });
  panel.results(() => finished ? {
    title: 'Treasure Haul results',
    report: duty.last,
    averages: duty.averages(timed() ? store.history(bestKey()) : null,
      { scoreLabel: scoreLabel() }),
    rows: [
      [scoreLabel(), String(score())],
      ...(chestMode() ? [['Points', String(tally.points)], ['Coins toward next chest', `${chestMeter.coins} / ${coinsPerChest}`],
        ...(chestRules >= 2 ? [['Chests waiting', String(waitingChests())]] : [])] : []),
      ['Time', `${(clockStart ? Math.max(0, stoppedAt - clockStart) / 1000 : 0).toFixed(2)}s`],
      ['Moves', String(tally.moves)],
      ...(!chestMode() ? [['Best move', String(tally.bestMove)]] : []),
      ['Coins', String(tally.coins)], ['Gems', String(tally.gems)], ['Chests hauled', String(tally.chests)],
      ['Rubies spawned', String(tally.rubiesSpawned)], ['Emeralds spawned', String(tally.emeraldsSpawned)],
      ...(mode === 'spawn' ? [['Chests in middle', `${tally.middle} / ${tally.spawned}`]] : []),
    ],
  } : null);
  const replayAction = {
    available: (game: GameRecord) => typeof game.replayAt === 'number' && (replays?.hasPlayableAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined) ?? false),
    play: (game: GameRecord) => { if (typeof game.replayAt === 'number') replays?.playAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined); },
  };
  historyGroup(panel, () => timed() ? store.history(bestKey()) : null, [{
    label: 'Score', value: (g) => String(g.score),
  }], 'Past games', replayAction);
  panel.settings.group('Game').select('Round', ROUNDS, () => roundSecs, (s) => {
    roundSecs = s;
    store.set('round', s);
  }, { disabled: () => running });
  panel.settings.group('Chests', { hidden: () => !chestMode() })
    .number('Coins per chest', () => coinsPerChest, (v) => {
      coinsPerChest = Math.max(1, Math.round(v));
      store.set('coinsPerChest', coinsPerChest);
    }, { min: 1, max: 2000, step: 10, disabled: () => running, title: 'Coins cleared to earn a chest: 150 by default. Earned chests wait at least one second and stay queued until there is room.' });
  actions.note(() => chestMode() || mode === 'spawn' ? 'Earned chests wait at least one second for a 2x2 opening.' : '');
  actions.note(() => mode === 'chests2' && chestRules === 3 ? 'With no chest in play, make a clear to start the one-second wait for the first chest.' : '');
  actions.note(() => coinOnlyEdges() ? 'Clear the edge with coin matches and the emeralds provided.' : '');
  const gems = panel.settings.group('Gem spawn rates', { columns: 2, hidden: coinOnlyEdges });
  ['Ruby (%)', 'Emerald (%)'].forEach((label, i) => gems.number(label, () => gemRates[i], (v) => {
    gemRates[i] = Math.max(0, Math.min(100 - gemRates[1 - i], v));
    store.set('gemRates', gemRates);
  }, { min: 0, max: 100, step: 0.01, disabled: () => running }));
  gems.button('Defaults', () => { gemRates = [200 / 308, 200 / 308]; store.set('gemRates', gemRates); }, { disabled: () => running });
  panel.settings.group('Reset').button('Reset to defaults', () => {
    mode = 'chests2';
    roundSecs = 120;
    clearPack = 'standard';
    spawnDelay = true;
    gemRates = [200 / 308, 200 / 308];
    coinsPerChest = COINS_PER_CHEST;
    store.set('coinsPerChest', coinsPerChest);
    store.set('mode', mode);
    store.set('round', roundSecs);
    store.set('clearPack', clearPack);
    store.set('spawnDelay', spawnDelay);
    store.set('gemRates', gemRates);
  }, { disabled: () => running });

  const replaySettingsCodec: ReplaySettingsCodec = {
    currentVersion: 3,
    simulatorVersion: 3,
    migrate: (version, value) => {
      if ((version !== 1 && version !== 2 && version !== 3) || !value || typeof value !== 'object') return null;
      const s = value as Record<string, unknown>;
      return ['0', '1', '2', 'chests1', 'chests2', 'spawn', 'clear'].includes(String(s.mode)) &&
        (version === 1 || (version === 2 ? s.chestRules === 2 : s.chestRules === 2 || s.chestRules === 3)) &&
        (version < 3 || s.trainingRules === 2) &&
        (s.coinsPerChest === undefined || (Number.isFinite(s.coinsPerChest) && (s.coinsPerChest as number) >= 1)) &&
        ['standard', 'efficient', 'emeralds', 'edges'].includes(String(s.clearPack)) &&
        Number.isFinite(s.roundSecs) && (s.roundSecs as number) >= 0 && typeof s.spawnDelay === 'boolean' &&
        Array.isArray(s.gemRates) && s.gemRates.length === 2 && s.gemRates.every((n) => Number.isFinite(n) && (n as number) >= 0) ? { ...s, chestRules: version === 1 ? 1 : version === 2 ? 2 : s.chestRules, trainingRules: version < 3 ? 1 : 2 } : null;
    },
  };
  type HaulSettings = { mode: Mode; clearPack: ClearPack; roundSecs: number; spawnDelay: boolean; gemRates: [number, number]; coinsPerChest?: number; chestRules?: 1 | 2 | 3; trainingRules?: 1 | 2 };
  let savedReplaySettings: HaulSettings | null = null;
  replays = new ReplayRecorder('treasure-haul', store, panel, ticks, (tape: PuzzleReplay) => {
    savedReplaySettings ??= { mode, clearPack, roundSecs, spawnDelay, gemRates: [...gemRates], coinsPerChest, chestRules, trainingRules };
    const settings = tape.settings as HaulSettings;
    chestRules = settings.chestRules ?? 1;
    trainingRules = settings.trainingRules ?? 1;
    mode = settings.mode;
    clearPack = settings.clearPack;
    roundSecs = settings.roundSecs;
    spawnDelay = settings.spawnDelay;
    gemRates = [...settings.gemRates];
    coinsPerChest = settings.coinsPerChest ?? LEGACY_COINS_PER_CHEST;
    if (!rng.restore(tape.seed)) throw new Error('Invalid Treasure Haul random state');
    start();
  }, () => {
    if (running) stop();
    if (savedReplaySettings) {
      ({ mode, clearPack, roundSecs, spawnDelay, gemRates } = savedReplaySettings);
      chestRules = savedReplaySettings.chestRules ?? 3;
      trainingRules = savedReplaySettings.trainingRules ?? 2;
      coinsPerChest = savedReplaySettings.coinsPerChest ?? COINS_PER_CHEST;
      savedReplaySettings = null;
    }
  }, (seed) => new PyRandom(0).restore(seed), setReplayTime, () => frame([]), replaySettingsCodec, () => !running || replays.isPlaying);

  return { frame, dispose: () => { replays.dispose(); sounds.dispose(); } };
}) satisfies PuzzleFactory;
