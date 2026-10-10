// Blacksmithing presentation and practice controls: sword, hammer, tongs, sparks,
// legal-strike glows, combos and floating messages. Board rules live in logic.ts.
import { SessionPause } from '../../core/pause';
import { Images } from '../../core/assets';
import { SoundBank } from '../../core/audio';
import { loadFont } from '../../core/fonts';
import { dutyDesk } from '../../core/duty/desk';
import type { RatingScale } from '../../core/duty/ratings';
import { historyGroup } from '../../core/history';
import { keyMatches } from '../../core/controls';
import { ReplayRecorder, type PuzzleReplay, type ReplaySettingsCodec } from '../../core/replay';
import type { InputEvent, Point } from '../../core/input';
import type { Option } from '../../core/panel';
import type { PuzzleFactory } from '../../core/puzzle';
import type { Drawable } from '../../core/screen';
import { PyRandom } from '../../core/pyrandom';
import type { GameRecord } from '../../core/storage';
import {
  BOARD_DONE,
  boardDifficulty,
  CHAIN_OF_KIND,
  FINISHED,
  IronBoard,
  LONG_CHAIN,
  MAX_PERFECT_SIZE,
  MIN_PERFECT_SIZE,
  perfectBoard,
  perfectPoints,
  SET_MESSAGES,
  SIZE,
  type Strike,
  WILD,
  WILD_REVEALED,
} from './logic';
import delarobbUrl from './delarobb.ttf?url';

const imageUrls = import.meta.glob<string>('./media/*.png', { eager: true, query: '?url', import: 'default' });
const soundUrls = import.meta.glob<string>('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' });
type Sound = 'chain' | 'hammer1' | 'hammer2' | 'hammer3' | 'set' | 'sword_enter' | 'tongs' | 'wild';

const WIDTH = 450;
/** Squares are 60px, the first at (52, 67); the frame sits 7px outside them. */
const CELL = 60;
const BOARD_X = 52;
const BOARD_Y = 67;
const FRAME_X = 45;
const FRAME_Y = 60;
/** The blade's top edge (IronBoardView: the sword runs along y = 50). */
const SWORD_Y = 50;
const BLADE_W = 450;
const BLADE_H = 394;
/** Blades from red hot to smooth (IronBoardView.f); the sword blends between them as it's struck. */
const BLADES = ['blade_hot', 'blade_warm', 'blade_cracked', 'blade_rough', 'blade_smooth'];
/** Tile sheets by strikes left: 1 cool, 2 warm, 3 hot (IronBoardView.e). */
const TILE_SHEETS = ['', 'cool', 'warm', 'hot'];
/** Multi-frame animations play at 15 frames a second. */
const FRAME_MS = 1000 / 15;
/** Glows on the squares that can be struck next: pale for hot squares. */
const GLOW_HOT = 'rgb(255, 255, 130)';
const GLOW = 'rgb(255, 255, 65)';
/** Message sizes: the game fonts, indexed as IronBoardView asks for them. */
const FONT_SIZES = [24, 30, 36, 42, 52, 68];
const FONT = 'Delarobb';
/** Floating messages rise 30px over 1.5s, fading in the second half (nenya FloatingTextAnimation). */
const FLOAT_MS = 1500;
const FLOAT_PX = 30;

/** Short names for the done levels, for the panel (the messages are in logic.ts). */
const BLADE_NAMES = ['Club', 'Hefty blade', 'Finely balanced', 'Keen edge', 'Masterpiece'];

/**
 * Duty report ratings: a classic sword by how far its blade got (0 Club up to 4 Masterpiece), a
 * perfect-board run by points a board (3 cleared, 1 one off).
 */
const RATING_SCALES: RatingScale[] = [
  { id: 'blade', label: 'Classic, blade (0 Club to 4 Masterpiece)', cutoffs: [0, 1, 2, 3, 4] },
  { id: 'perfect', label: 'Perfect board, points a board', cutoffs: [0.5, 1, 1.5, 2.25, 2.75], step: 0.05 },
];

type Mode = 'classic' | 'perfect';
const MODES: Option<Mode>[] = [
  { value: 'classic', label: 'Classic (6x6, as in the game)' },
  { value: 'perfect', label: 'Perfect board' },
];

/** Perfect-board run lengths: no timer, or 2 minutes. */
const TIMERS: Option<number>[] = [
  { value: 0, label: 'No timer' },
  { value: 120000, label: '2 minutes' },
];

/** A perfect-board record for one size and difficulty. */
interface PerfectRecord {
  boards: number;
  points: number;
  cleared: number;
  oneOff: number;
}

const DIFFICULTIES: Option<number>[] = [
  { value: 1, label: '1: numbers 1-3' },
  { value: 2, label: '2: adds rook, bishop, knight' },
  { value: 3, label: '3: adds 4 and queen' },
  { value: 4, label: '4: adds rum jugs' },
];

/** Key to cursor direction, as dx, dy (IronController's cursN, cursNE,...). */
const KEY_MOVES: Record<string, Point> = {
  arrowup: [0, -1],
  arrowdown: [0, 1],
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  '8': [0, -1],
  '2': [0, 1],
  '4': [-1, 0],
  '6': [1, 0],
  '7': [-1, -1],
  '9': [1, -1],
  '1': [-1, 1],
  '3': [1, 1],
  home: [-1, -1],
  pageup: [1, -1],
  end: [-1, 1],
  pagedown: [1, 1],
};
interface Anim {
  layer: number;
  update?(now: number): boolean;
  /** Draws the animation; returns false once it's finished. */
  draw(now: number): boolean;
}

interface Path {
  from: Point;
  to: Point;
  start: number;
  duration: number;
  begun?: boolean;
  onBegin?: () => void;
  onEnd?: () => void;
}

interface Message {
  text: string;
  px: number;
  start: number;
  duration: number;
  y: number;
  h: number;
}

interface Tally {
  chains: Record<number, number>;
  numberSets: number;
  orderedSets: number;
  chessSets: number;
  longestChain: number;
  longestRun: number;
  jugs: number;
}

const emptyTally = (): Tally => ({ chains: {}, numberSets: 0, orderedSets: 0, chessSets: 0, longestChain: 0, longestRun: 0, jugs: 0 });

/** The animation frames for a sheet played forward, held on the last frame, then back (IronBoardView.a(String, int, int, int)). */
function bounce(count: number, hold: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(i);
  for (let i = 0; i < hold; i++) out.push(count - 1);
  for (let i = count - 1; i >= 0; i--) out.push(i);
  return out;
}

/** A solid-colour copy of a sheet, for glows. */
function silhouette(img: HTMLImageElement, colour: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, img.width, img.height);
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

  const glowSheets = TILE_SHEETS.map((name) => (name ? [silhouette(img(name), GLOW), silhouette(img(name), GLOW_HOT)] : []));

  let difficulty = store.get<number>('difficulty', 4);
  let mode = store.get<Mode>('mode', 'classic');
  let perfectSize = store.get<number>('perfectSize', 3);
  const bests = store.get<Record<string, number>>('bestStrikes', {});
  const perfectRecords = store.get<Record<string, PerfectRecord>>('perfectRecords', {});
  const perfectKey = () => `${perfectSize}-${difficulty}`;
  const runHistoryKey = () => `${timerMs ? 'run' : 'untimed-run'}:${perfectKey()}`;
  /** Points from the perfect board just finished, or null. */
  let lastPoints: number | null = null;
  let timerMs = store.get<number>('perfectTimer', 0);
  const timedBests = store.get<Record<string, number>>('perfectTimedBests', {});
  /** A perfect-board run: boards dealt one after another, with the points they've scored. */
  const run = { active: false, start: 0, end: 0, points: 0, boards: 0, perfect: 0, oneOff: 0, farOff: 0, timeUp: false };
  const timeLeft = () => (timerMs ? Math.max(0, timerMs - ((run.active ? ticks() : run.end) - run.start)) : null);

  let board: IronBoard | null = null;
  /** Each square as drawn: it changes when the hammer lands, a little after the strike. */
  let shown: { type: number; condition: number }[][] = [];
  let hammerable = false;
  let running = false;
  let finished = false;
  let doneness = 0;
  let tally = emptyTally();
  let anims: Anim[] = [];
  let timers: { at: number; run: () => void }[] = [];
  let messages: Message[] = [];
  let glows: { x: number; y: number; hot: boolean }[] = [];
  let glowStart = 0;
  let cursor: Point | null = null;
  let pressed: Point | null = null;
  let lastMouse: Point = [-1, -1];

  let sword: Drawable = img(BLADES[0]);
  let swordAt: Point = [-img(BLADES[0]).width, SWORD_Y];
  let swordPath: Path | null = null;
  let gleamPath: Path | null = null;
  let gleamAt: Point | null = null;
  /** Squares and frame fade in when the sword arrives and out when it's done (alpha 0-1). */
  let fade = { start: 0, duration: 1, from: 0, to: 0 };

  const later = (ms: number, run: () => void) => timers.push({ at: ticks() + ms, run });
  /** Boards smaller than 6x6 sit in the middle of the usual board area. */
  const boardSize = () => board?.size ?? SIZE;
  const inset = () => ((SIZE - boardSize()) * CELL) / 2;
  const pieceXY = (x: number, y: number): Point => [BOARD_X + inset() + x * CELL, BOARD_Y + inset() + y * CELL];
  const totalStrikes = () => (board ? board.size * board.size * board.strikesPerSquare : 0);

  function pathPos(path: Path, now: number): Point {
    const t = Math.max(0, Math.min(1, (now - path.start) / path.duration));
    return [path.from[0] + (path.to[0] - path.from[0]) * t, path.from[1] + (path.to[1] - path.from[1]) * t];
  }

  function fadeAlpha(now: number): number {
    const t = Math.max(0, Math.min(1, (now - fade.start) / fade.duration));
    return fade.from + (fade.to - fade.from) * t;
  }

  function fadeTo(to: number, delay: number, duration: number): void {
    const now = ticks();
    fade = { start: now + delay, duration, from: fadeAlpha(now), to };
  }

  /** A sheet of equal tiles played at 15fps (nenya MultiFrameAnimation), calling onFrame as each frame starts. */
  function frames(
    name: string,
    w: number,
    h: number,
    sequence: number[],
    x: number,
    y: number,
    layer: number,
    opts: { flipX?: boolean; flipY?: boolean; onFrame?: (i: number) => void; onEnd?: () => void } = {},
  ): Anim {
    const sheet = img(name);
    const perRow = Math.floor(sheet.width / w);
    const start = ticks();
    let last = -1;
    return {
      layer,
      update(now) {
        const i = Math.floor((now - start) / FRAME_MS);
        if (i >= sequence.length) {
          opts.onEnd?.();
          return false;
        }
        // (Optional calls skip their arguments, so the count can't go inside onFrame?.(...).)
        for (; last < i; last++) opts.onFrame?.(last + 1);
        return true;
      },
      draw(now) {
        const i = Math.floor((now - start) / FRAME_MS);
        if (i >= sequence.length) return false;
        const tile = sequence[i];
        ctx.save();
        ctx.translate(Math.trunc(x) + (opts.flipX ? w : 0), Math.trunc(y) + (opts.flipY ? h : 0));
        ctx.scale(opts.flipX ? -1 : 1, opts.flipY ? -1 : 1);
        ctx.drawImage(sheet, (tile % perRow) * w, Math.floor(tile / perRow) * h, w, h, 0, 0, w, h);
        ctx.restore();
        return true;
      },
    };
  }

  /** Little sparks thrown from the hammer (nenya SparkAnimation): up and to either side, falling, for a second. */
  function sparks(x: number, y: number, count: number): Anim {
    const sheet = img('little_spark');
    const start = ticks();
    const bits = Array.from({ length: count }, (_, i) => ({
      tile: i % 4,
      vx: (0.45 + random() * (0.6 - 0.45)) * (random() < 0.5 ? -1 : 1),
      vy: -(0.57 + random() * (0.6 - 0.57)),
      ay: rng.randintN(5, 39) / 5000,
    }));
    return {
      layer: 9,
      draw(now) {
        const t = now - start;
        if (t >= 1000) return false;
        for (const b of bits) {
          const px = Math.trunc(x + b.vx * t);
          const py = Math.trunc(y + b.vy * t + 0.5 * b.ay * t * t);
          ctx.drawImage(sheet, b.tile * 30, 0, 30, 28, px, py, 30, 28);
        }
        return true;
      },
    };
  }

  /** A floating message centred on the board, moved down clear of any still showing (PuzzleBoardView.f). */
  function say(text: string, sizeIndex: number, duration = FLOAT_MS): void {
    const px = FONT_SIZES[Math.max(0, Math.min(FONT_SIZES.length - 1, sizeIndex))];
    const h = Math.round(px * 1.2);
    let y = (600 - h) / 2;
    const now = ticks();
    for (const m of messages) {
      const my = m.y - (FLOAT_PX * (now - m.start)) / m.duration;
      if (y < my + m.h && my < y + h) y = my + m.h;
    }
    messages.push({ text, px, start: now, duration, y, h });
  }

  function drawMessages(now: number): void {
    messages = messages.filter((m) => now < m.start + m.duration);
    for (const m of messages) {
      const t = (now - m.start) / m.duration;
      const alpha = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2);
      ctx.save();
      ctx.globalAlpha = alpha;
      // The game stretches its message font 10% wide and draws it outlined in black.
      ctx.translate(WIDTH / 2, m.y - FLOAT_PX * t + m.px);
      ctx.scale(1.1, 1);
      ctx.font = `${m.px}px "${FONT}"`;
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(m.text, 0, 0, WIDTH / 1.1);
      ctx.fillStyle = '#fff';
      ctx.fillText(m.text, 0, 0, WIDTH / 1.1);
      ctx.restore();
    }
  }

  // ---- The game ----

  /**
   * Perfect boards change over faster than the game's sword: the squares fade quicker and the
   * blade leaves and arrives sooner (about 1.8s between boards instead of 4.5s).
   */
  const quick = () => mode === 'perfect';

  function newSword(): void {
    pause.resume();
    const level = boardDifficulty(difficulty);
    board = mode === 'perfect' ? new IronBoard(level, random, perfectBoard(perfectSize, level, random)) : new IronBoard(level, random);
    lastPoints = null;
    shown = board.pieces.map((col) => col.map((p) => ({ type: p.type, condition: p.condition })));
    running = true;
    finished = false;
    hammerable = false;
    doneness = 0;
    tally = emptyTally();
    anims = [];
    timers = [];
    // In a run the last board's result can still be showing as the next board arrives.
    if (!run.active) messages = [];
    glows = [];
    cursor = null;
    pressed = null;
    lastMouse = [-1, -1];
    gleamPath = null;
    fade = { start: 0, duration: 1, from: 0, to: 0 };
    // The red-hot blade slides in from the left, then the squares fade in over it.
    sword = img(BLADES[0]);
    swordPath = {
      from: [-sword.width, SWORD_Y],
      to: [0, SWORD_Y],
      start: ticks(),
      duration: quick() ? 350 : 500,
      onBegin: () => sounds.play('sword_enter'),
      onEnd: () => {
        fadeTo(1, 0, quick() ? 400 : 1000);
        later(quick() ? 400 : 1000, () => (hammerable = true));
      },
    };
  }

  function strike(x: number, y: number): void {
    if (!hammerable || !board) return;
    const hit = board.hit(x, y);
    if (!hit) return;
    hammerable = false;
    if (mode === 'classic') announce(hit);
    if (hit.finished && mode === 'classic') {
      const level = board.doneLevel();
      if (level === 0) sayDone();
      else if (level !== 4) say(FINISHED, 3);
    }
    swing(hit);
    glowStart = ticks();
    glows = board.findHittable().map((p) => ({ x: p.x, y: p.y, hot: p.condition === board!.strikesPerSquare }));
    reblade();
  }

  /** Messages and sounds for the chain (IronBoardView.a(Chain)), and the tally for the panel. */
  function announce(hit: Strike): void {
    const chain = hit.chain;
    if (mode === 'classic' && board!.doneLevel() !== doneness) {
      doneness = board!.doneLevel();
      sayDone();
    }
    if (chain.isIdentical()) {
      sounds.play('chain');
      const size = chain.size();
      say(CHAIN_OF_KIND[Math.min(6, size)], 4 - Math.max(1, 6 - size));
      tally.chains[Math.min(6, size)] = (tally.chains[Math.min(6, size)] ?? 0) + 1;
      tally.longestChain = Math.max(tally.longestChain, size);
    } else if (chain.justCompletedSet()) {
      sounds.play('set');
      if (chain.inNumericSet) {
        const ordered = chain.isActiveSetOrdered();
        say(ordered ? SET_MESSAGES.ordered : SET_MESSAGES.numbers, 3);
        if (ordered) tally.orderedSets++;
        else tally.numberSets++;
      } else {
        say(SET_MESSAGES.chess, 3);
        tally.chessSets++;
      }
      const sets = chain.numSets();
      if (sets > 1) say(LONG_CHAIN[sets] ?? `m.long_chain_all${sets}`, 2);
      tally.longestRun = Math.max(tally.longestRun, sets);
    }
    if (hit.piece.type === WILD) tally.jugs++;
  }

  function sayDone(): void {
    const level = board!.doneLevel();
    say(BOARD_DONE[level], 1 + level, 2000);
  }

  /** The hammer, tongs and sparks for one strike. */
  function swing(hit: Strike): void {
    const { x, y } = hit.piece;
    const [px, py] = pieceXY(x, y);
    const cx = px + CELL / 2;
    const cy = py + CELL / 2;
    const hx = cx - 82;
    const hy = cy - 104;
    const refresh = () => (shown[x][y] = { type: hit.piece.type, condition: hit.piece.condition });
    let landed = false;
    const hammer = frames('hammer', 450, 600, bounce(4, 0), hx, hy, 10, {
      onFrame: (i) => {
        if (landed || i < 4) return;
        landed = true;
        sounds.play((['hammer1', 'hammer2', 'hammer3'] as const)[rng.randintN(0, 2)]);
        // Big sparks burst out in four mirrored quarters around the square's centre.
        anims.push(frames('big_spark', 108, 114, [0, 1, 2, 3, 4], cx, cy - 114, 9));
        anims.push(frames('big_spark', 108, 114, [0, 1, 2, 3, 4], cx - 108, cy - 114, 9, { flipX: true }));
        anims.push(frames('big_spark', 108, 114, [0, 1, 2, 3, 4], cx - 108, cy, 9, { flipX: true, flipY: true }));
        anims.push(frames('big_spark', 108, 114, [0, 1, 2, 3, 4], cx, cy, 9, { flipY: true }));
        anims.push(sparks(hx - 27, hy + 75, rng.randintN(10, 24)));
        refresh();
      },
      onEnd: () => {
        refresh();
        hammerable = true;
        if (board && board.findHittable().length === 0) endSword();
      },
    });
    later(250, () => anims.push(hammer));

    // The tongs hold the blade's end near the square; the lower jaw goes behind the blade.
    let tx = cx - 500;
    let ty = 0;
    if (cx < FRAME_X + 2 * CELL) {
      if (cy > 250) {
        ty += 50;
        tx += cy > 325 ? 400 : 75;
      } else tx += 100;
    }
    anims.push(frames('tongs_top', 450, 600, bounce(4, 7), tx, ty, 8));
    anims.push(frames('tongs_bottom', 450, 600, bounce(4, 7), tx, ty, -8));
    if (!hit.chain.isIdentical() && !hit.chain.justCompletedSet()) later(200, () => sounds.play('tongs'));
    if (hit.piece.type === WILD) {
      say(WILD_REVEALED, 3);
      sounds.play('wild');
    }
  }

  /** Blends the blade toward smooth as strikes add up (IronBoardView.c(o)). */
  function reblade(): void {
    const level = (board!.numHits * (BLADES.length - 1)) / totalStrikes();
    const i = Math.floor(level);
    if (i >= BLADES.length - 1) {
      sword = img(BLADES[BLADES.length - 1]);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = BLADE_W;
    canvas.height = BLADE_H;
    const c = canvas.getContext('2d')!;
    c.drawImage(img(BLADES[i]), 0, 0);
    c.globalAlpha = level - i;
    c.drawImage(img(BLADES[i + 1]), 0, 0);
    sword = canvas;
  }

  /** No square can be struck: the squares fade, a good blade gleams, and the sword is lifted away. */
  function endSword(): void {
    hammerable = false;
    glows = [];
    cursor = null;
    const delay = quick() ? 150 : 400;
    const duration = quick() ? 400 : 1000;
    fadeTo(0, delay, duration);
    const now = ticks();
    if (mode === 'perfect') {
      const left = board!.remaining();
      lastPoints = perfectPoints(left);
      say(left === 0 ? 'Perfect! +3' : left === 1 ? 'One off! +1' : `${left} left`, left === 0 ? 5 : 3, 2000);
    }
    if (mode === 'perfect' ? lastPoints === 3 : board!.doneLevel() >= 2) {
      const gleam = img('gleam');
      gleamPath = { from: [WIDTH, SWORD_Y], to: [-gleam.width, SWORD_Y], start: now + delay + duration, duration: delay };
      later((3 * delay) / 2 + duration, () => anims.push(frames('twinkle', 200, 48, [0, 1, 2, 3, 4, 5, 6, 7], WIDTH / 2, SWORD_Y, 0)));
    }
    swordPath = {
      from: [0, SWORD_Y],
      to: [0, -BLADE_H - 500],
      start: now + (quick() ? delay : delay * 3) + duration,
      duration: quick() ? 500 : 800,
      onBegin: () => sounds.play('sword_enter'),
      onEnd: finish,
    };
  }

  function finish(): void {
    running = false;
    finished = true;
    if (mode === 'perfect') {
      if (!replays.isPlaying) {
        const record = perfectRecords[perfectKey()] ?? { boards: 0, points: 0, cleared: 0, oneOff: 0 };
        record.boards++;
        record.points += lastPoints ?? 0;
        if (lastPoints === 3) record.cleared++;
        if (lastPoints === 1) record.oneOff++;
        perfectRecords[perfectKey()] = record;
        store.set('perfectRecords', perfectRecords);
      }
      run.points += lastPoints ?? 0;
      run.boards++;
      if (lastPoints === 3) run.perfect++;
      else if (lastPoints === 1) run.oneOff++;
      else run.farOff++;
      // The next board comes straight in, for as long as the run lasts.
      if (run.active) newSword();
      else replays.finish(`Points ${run.points}`);
      return;
    }
    const report = duty.end({
      mode: 'Classic',
      performance: duty.rate('blade', board ? board.doneLevel() : -1),
      score: { label: 'Strikes', value: String(board?.numHits ?? 0) },
      cleared: [
        { label: 'Sets Struck', items: [
          { icon: 'smith-number-set', label: 'number sets', count: tally.numberSets },
          { icon: 'smith-ordered-set', label: 'ordered sets', count: tally.orderedSets },
          { icon: 'smith-chess-set', label: 'chess sets', count: tally.chessSets },
        ] },
        { label: 'Chains', items: [2, 3, 4, 5, 6].map((n) => ({
          icon: `smith-chain${n}`, label: ['double', 'triple', 'bingo', 'donkey', 'vegas'][n - 2], count: tally.chains[n] ?? 0,
        })) },
      ],
    });
    const finishedReplay = replays.finish(`Strikes ${board?.numHits ?? 0}`, report);
    const key = String(difficulty);
    if (board && !replays.isPlaying) store.addHistory(`classic:${key}`, {
      score: board.numHits,
      ...duty.fields(report),
      ...(finishedReplay ? { replayAt: finishedReplay.at, replayId: finishedReplay.runId ?? ''} : {}),
    });
    if (!replays.isPlaying && board && board.numHits > (bests[key] ?? 0)) {
      bests[key] = board.numHits;
      store.set('bestStrikes', bests);
    }
  }

  /** Clears the board and everything animating on it, with nothing scored. */
  function abortBoard(): void {
    running = false;
    finished = true;
    board = null;
    anims = [];
    timers = [];
    messages = [];
    glows = [];
    swordPath = null;
    gleamPath = null;
    hammerable = false;
  }

  function startRun(): void {
    pause.resume();
    duty.clear();
    replays.begin({ mode, difficulty, perfectSize, timerMs }, rng.snapshot());
    Object.assign(run, { active: true, start: ticks(), end: ticks(), points: 0, boards: 0, perfect: 0, oneOff: 0, farOff: 0, timeUp: false });
    newSword();
  }

  /** Ends a run. A board still being played when time runs out doesn't score. */
  function endRun(timeUp: boolean): void {
    run.active = false;
    run.end = ticks();
    run.timeUp = timeUp;
    const report = duty.end({
      mode: 'Perfect board',
      performance: duty.rate('perfect', run.boards ? run.points / run.boards : 0),
      score: { label: 'Points', value: String(run.points) },
      cleared: [{ label: 'Boards Finished', items: [
        { icon: 'smith-perfect', label: 'perfect', count: run.perfect },
        { icon: 'smith-one-off', label: 'one off', count: run.oneOff },
        { icon: 'smith-far-off', label: 'too far off', count: run.farOff },
      ] }],
    });
    const finishedReplay = replays.finish(`Points ${run.points}`, report);
    abortBoard();
    if (replays.isPlaying) return;
    const key = perfectKey();
    // A manually ended untimed run is a session; timed averages only include full rounds.
    if (!timerMs || timeUp) store.addHistory(runHistoryKey(), { score: run.points, boards: run.boards, ...duty.fields(report), ...(finishedReplay ? { replayAt: finishedReplay.at, replayId: finishedReplay.runId ?? ''} : {}) });
    if (!timeUp) return;
    say("Time's up!", 4, 2500);
    if (run.points > (timedBests[key] ?? -1)) {
      timedBests[key] = run.points;
      store.set('perfectTimedBests', timedBests);
    }
  }

  function moveCursor(dx: number, dy: number): void {
    if (!hammerable) return;
    const [x, y] = cursor ?? [0, 0];
    cursor = [Math.max(0, Math.min(boardSize() - 1, x + dx)), Math.max(0, Math.min(boardSize() - 1, y + dy))];
  }

  function squareAt(pos: Point): Point | null {
    const [left, top] = pieceXY(0, 0);
    if (pos[0] < left || pos[1] < top) return null;
    const x = Math.floor((pos[0] - left) / CELL);
    const y = Math.floor((pos[1] - top) / CELL);
    return x < boardSize() && y < boardSize() && board ? [x, y] : null;
  }

  // ---- Drawing ----

  /** The anvil's combo readout (IronBoardView.g): a chain as piece x count, or the set so far with a tally of sets. */
  function drawChain(): void {
    const chain = board?.chain;
    if (mode === 'perfect' || !chain || !chain.size()) return;
    const bx = 10;
    const by = 450;
    const bonus = img('bonus');
    const digits = img('bonus_integers');
    const tile = (type: number, x: number) => ctx.drawImage(bonus, type * 42, 0, 42, 42, x, by, 42, 42);
    const digit = (d: number, x: number) => d < 10 && ctx.drawImage(digits, d * 19, 0, 19, 31, x, by + 7, 19, 31);
    if (chain.isIdentical()) {
      tile(chain.identicalType, bx);
      screen.blit(img('x'), bx + 45, by + 10);
      const n = chain.size();
      if (n >= 10) {
        digit(Math.floor(n / 10), bx + 75);
        digit(n % 10, bx + 105);
      } else digit(n, bx + 75);
      return;
    }
    chain.activeSet().forEach((type, i) => tile(type, bx + 42 * i));
    const sets = chain.numSets();
    if (!sets) return;
    const mark = sets % 5 === 0 ? 4 : (sets % 5) - 1;
    ctx.drawImage(img('tally'), mark * 50, 0, 50, 46, bx + 80, by + 50, 50, 46);
  }

  /** One-strike squares are drawn red hot, as fresh squares are. */
  const sheetFor = (condition: number) => condition + 3 - (board?.strikesPerSquare ?? 3);

  /** The gold frame around the squares, its 7px border kept and its middle stretched for smaller boards. */
  function drawFrame(alpha: number): void {
    const frame = img('frame');
    const b = 7;
    const inner = frame.width - 2 * b;
    const size = boardSize() * CELL;
    const x = FRAME_X + inset();
    const y = FRAME_Y + inset();
    ctx.save();
    ctx.globalAlpha = alpha;
    const parts = [
      [0, b, 0],
      [b, inner, b],
      [frame.width - b, b, b + size],
    ];
    for (const [sx, sw, dx] of parts) {
      for (const [sy, sh, dy] of parts) {
        const dw = sw === inner ? size : b;
        const dh = sh === inner ? size : b;
        ctx.drawImage(frame, sx, sy, sw, sh, x + dx, y + dy, dw, dh);
      }
    }
    ctx.restore();
  }

  function drawSquares(now: number): void {
    const alpha = fadeAlpha(now);
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let x = 0; x < boardSize(); x++) {
      for (let y = 0; y < boardSize(); y++) {
        const { type, condition } = shown[x][y];
        if (!condition) continue;
        const [px, py] = pieceXY(x, y);
        ctx.drawImage(img(TILE_SHEETS[sheetFor(condition)]), type * CELL, 0, CELL, CELL, px, py, CELL, CELL);
      }
    }
    ctx.restore();
    // Glows pulse between 25% and 75% over a second each way.
    const phase = ((now - glowStart) % 2000) / 1000;
    const glowAlpha = 0.25 + 0.5 * (phase < 1 ? phase : 2 - phase);
    for (const g of glows) {
      const { type, condition } = shown[g.x][g.y];
      if (!condition) continue;
      const [px, py] = pieceXY(g.x, g.y);
      ctx.save();
      ctx.globalAlpha = glowAlpha * alpha;
      ctx.drawImage(glowSheets[sheetFor(condition)][g.hot ? 1 : 0], type * CELL, 0, CELL, CELL, px, py, CELL, CELL);
      ctx.restore();
    }
  }

  function stepPath(path: Path | null, now: number): Point | null {
    if (!path) return null;
    if (!path.begun && now >= path.start) {
      path.begun = true;
      path.onBegin?.();
    }
    const at = pathPos(path, now);
    if (now >= path.start + path.duration && path.onEnd) {
      const done = path.onEnd;
      path.onEnd = undefined;
      done();
    }
    return at;
  }

  function frame(events: InputEvent[]): void {
    const liveEvents = pause.input(events, 'blacksmithing', running || run.active);
    if (liveEvents === null) return;
    events = liveEvents;
    const routed = replays.frame(events, input.mouse, ticks());
    events = routed.events;
    input.mouse = routed.mouse;
    const now = ticks();
    if (!routed.renderOnly) {
      for (const event of events) {
        if (event.type === 'mousedown' && event.button === 1) pressed = squareAt(event.pos);
        else if (event.type === 'mouseup' && event.button === 1) {
          // A click strikes only if it's pressed and released on the same square.
          const square = squareAt(event.pos);
          if (square && pressed && square[0] === pressed[0] && square[1] === pressed[1]) strike(square[0], square[1]);
          pressed = null;
        } else if (event.type === 'keydown') {
          const directions: Array<[string, string]> = [
            ['up', 'arrowup'], ['down', 'arrowdown'], ['left', 'arrowleft'], ['right', 'arrowright'],
            ['upLeft', 'home'], ['upRight', 'pageup'], ['downLeft', 'end'], ['downRight', 'pagedown'],
          ];
          const direction = directions.find(([id, key]) => keyMatches(event.key, 'blacksmithing', id, key));
          const move = direction ? KEY_MOVES[direction[1]] : ['8','2','4','6','7','9','1','3'].includes(event.key) ? KEY_MOVES[event.key] : undefined;
          if (move) moveCursor(move[0], move[1]);
          else if (keyMatches(event.key, 'blacksmithing', 'strike', 'space', ['enter','5','clear']) && cursor) strike(cursor[0], cursor[1]);
        }
      }
      // The cursor follows the mouse while the board can be struck.
      if (hammerable && (input.mouse[0] !== lastMouse[0] || input.mouse[1] !== lastMouse[1])) cursor = squareAt(input.mouse);
      lastMouse = input.mouse;

      if (run.active && timeLeft() === 0) endRun(true);

      for (const timer of timers.filter((t) => now >= t.at)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.run();
      }

      swordAt = stepPath(swordPath, now) ?? swordAt;
      gleamAt = stepPath(gleamPath, now);
      const ended = new Set<Anim>();
      for (const animation of [...anims]) if (animation.update && !animation.update(now)) ended.add(animation);
      anims = anims.filter((animation) => !ended.has(animation));
    }
    if (replays.isSeeking || replays.isAdvancing) return;

    screen.fill('#000');
    screen.blit(img('background'), 0, 0);
    drawChain();

    const swordPos = swordAt;
    const gleamPos = gleamAt;

    const layers: Anim[] = [
      ...anims,
      {
        layer: -1,
        draw: () => {
          if (board) screen.blit(sword, swordPos[0], swordPos[1]);
          return true;
        },
      },
      {
        layer: 0,
        draw: (t) => {
          const alpha = fadeAlpha(t);
          if (board && alpha > 0) drawFrame(alpha);
          if (gleamPos) screen.blit(img('gleam'), gleamPos[0], gleamPos[1]);
          return true;
        },
      },
      {
        layer: 2,
        draw: (t) => {
          if (board) drawSquares(t);
          return true;
        },
      },
      {
        layer: 7,
        draw: () => {
          if (cursor && board) {
            const [px, py] = pieceXY(cursor[0], cursor[1]);
            screen.blit(img('cursor'), px - 2, py - 2);
          }
          return true;
        },
      },
    ];
    // Stable sort: equal layers draw in the order they were added, as in the game.
    const order = layers.map((a, i) => [a, i] as const).sort((a, b) => a[0].layer - b[0].layer || a[1] - b[1]);
    const ended = new Set<Anim>();
    for (const [a] of order) if (!a.draw(now)) ended.add(a);
    if (ended.size) anims = anims.filter((a) => !ended.has(a));
    drawMessages(now);

    if (!running && !finished) {
      ctx.save();
      ctx.font = `30px "${FONT}"`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.fillStyle = '#fff';
      ctx.strokeText('Press Start to forge a sword', WIDTH / 2, 230);
      ctx.fillText('Press Start to forge a sword', WIDTH / 2, 230);
      ctx.restore();
    }
    replays.drawOverlay(ctx);
  }

  pause.install(panel, () => running || run.active);

  // ---- Panel ----

  /** Settings are locked while a sword or a run is going. */
  const busy = () => running || run.active;
  panel.clock(() => {
    const left = mode === 'perfect' ? timeLeft() : null;
    return left === null ? null : { label: 'Time left', ms: left, countdown: true, warn: run.active && left < 10000 };
  });

  panel.controls('blacksmithing', [
    { id: 'pause', label: 'Pause / resume', defaultKey: 'Escape' },
    { id: 'up', label: 'Move up', defaultKey: 'ArrowUp' },
    { id: 'down', label: 'Move down', defaultKey: 'ArrowDown' },
    { id: 'left', label: 'Move left', defaultKey: 'ArrowLeft' },
    { id: 'right', label: 'Move right', defaultKey: 'ArrowRight' },
    { id: 'upLeft', label: 'Move up-left', defaultKey: 'Home' },
    { id: 'upRight', label: 'Move up-right', defaultKey: 'PageUp' },
    { id: 'downLeft', label: 'Move down-left', defaultKey: 'End' },
    { id: 'downRight', label: 'Move down-right', defaultKey: 'PageDown' },
    { id: 'strike', label: 'Strike', defaultKey: 'Space' },
  ]);
  const session = panel.session();
  session.select('Mode', MODES, () => mode, (m) => {
    mode = m;
    store.set('mode', m);
  }, { disabled: busy });
  const actions = panel.group();
  actions.note(() => {
    const level = `Difficulty ${difficulty}`;
    return mode === 'perfect' ? `${perfectSize}x${perfectSize} board · ${level}` : level;
  });
  // Starting while a replay is open closes it and starts a game of your own.
  actions.button('Start', () => {
    if (replays.isPlaying) { replays.stop(); if (replays.isPlaying) return; }
    if (mode === 'perfect') {
      if (run.active) endRun(false);
      else startRun();
    } else if (running) { abortBoard(); replays.finish('Stopped'); }
    else { duty.clear(); replays.begin({ mode, difficulty, perfectSize, timerMs }, rng.snapshot()); newSword(); }
  }, { variant: 'primary', label: () => (replays?.isPlaying ? 'Start' : busy() ? 'Stop' : !finished || mode === 'perfect' ? 'Start' : 'New sword') });

  const best = () => bests[String(difficulty)];
  const perfectRecord = () => perfectRecords[perfectKey()];
  panel.score('Run', { hidden: () => mode !== 'perfect' }).stats(['', 'This run', 'Best'], () => {
    const best = timerMs ? timedBests[perfectKey()] : undefined;
    return [
      ['Points', String(run.points), best !== undefined ? String(best) : ''],
    ];
  }).note(() => (timerMs ? 'Best is the most points in 2 minutes.' : 'Boards keep coming until you press Stop.'));

  panel.tab('History').group('Perfect board totals', { hidden: () => mode !== 'perfect' }).stats(['', 'Now', 'Total'], () => {
    const record = perfectRecord();
    return [
      ['Squares left', board?.strikesPerSquare === 1 ? `${board.remaining()} / ${board.size * board.size}` : '-', ''],
      ['Points', lastPoints === null ? '-' : String(lastPoints), String(record?.points ?? 0)],
      ['Boards', '', String(record?.boards ?? 0)],
      ['Cleared (3)', '', String(record?.cleared ?? 0)],
      ['One off (1)', '', String(record?.oneOff ?? 0)],
      ['Points / board', '', record?.boards ? (record.points / record.boards).toFixed(2) : '-'],
    ];
  }).note(() => `Totals are for ${perfectSize}x${perfectSize} at difficulty ${difficulty}.`)
    .button('Reset totals', () => {
      delete perfectRecords[perfectKey()];
      store.set('perfectRecords', perfectRecords);
    }, { disabled: () => busy() || !perfectRecord() });

  panel.score('Sword', { hidden: () => mode !== 'classic' }).stats(['', 'Now', 'Best'], () => {
    const hits = board?.numHits ?? 0;
    return [
      ['Strikes', board ? `${hits} / ${totalStrikes()}` : '-', best() ? String(best()) : '-'],
    ];
  });

  const replayAction = {
    available: (game: GameRecord) => typeof game.replayAt === 'number' && (replays?.hasPlayableAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined) ?? false),
    play: (game: GameRecord) => { if (typeof game.replayAt === 'number') replays?.playAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined); },
  };
  historyGroup(panel, () => (mode === 'classic' ? store.history(`classic:${difficulty}`) : null), [
    { label: 'Strikes', value: (g) => String(g.score) },
  ], 'Past games', replayAction);
  historyGroup(panel, () => (mode === 'perfect' ? store.history(runHistoryKey()) : null), [
    { label: 'Points', value: (g) => String(g.score) },
    { label: 'Boards', value: (g) => String(g.boards) },
  ], 'Past games', replayAction);

  panel.tab('History').group('Combos', { hidden: () => mode !== 'classic' || running || !finished }).stats(['', 'This sword'], () => [
    ['Double', String(tally.chains[2] ?? 0)],
    ['Triple', String(tally.chains[3] ?? 0)],
    ['Bingo', String(tally.chains[4] ?? 0)],
    ['Donkey', String(tally.chains[5] ?? 0)],
    ['Vegas', String(tally.chains[6] ?? 0)],
    ['Longest chain', String(tally.longestChain)],
    ['In the Rhythm', String(tally.numberSets)],
    ['By the Numbers', String(tally.orderedSets)],
    ["Fancy Hammerin'", String(tally.chessSets)],
    ['Longest set run', String(tally.longestRun)],
    ['Rum jugs', String(tally.jugs)],
  ]);

  const duty = dutyDesk(panel, store, 'blacksmithing', 'Blacksmithing', RATING_SCALES, {
    shown: (id) => (id === 'perfect') === (mode === 'perfect'),
  });
  panel.results(() => finished && !busy() ? {
    title: mode === 'perfect' ? 'Perfect board results' : 'Sword results',
    report: duty.last,
    averages: mode === 'classic'
      ? duty.averages(store.history(`classic:${difficulty}`), { scoreLabel: 'Strikes' })
      : duty.averages(store.history(runHistoryKey()), { scoreLabel: 'Points' }),
    rows: mode === 'perfect' ? [
      ['Points', String(run.points)], ['Boards', String(run.boards)],
      ['Perfect / One off / Too far off', `${run.perfect} / ${run.oneOff} / ${run.farOff}`],
      ['Time', `${(Math.max(0, run.end - run.start) / 1000).toFixed(2)}s`],
    ] : [
      ['Strikes', String(board?.numHits ?? 0)],
      ['Blade', board ? BLADE_NAMES[board.doneLevel()] : '—'],
      ['Best strikes', String(best() ?? 0)],
      ['Longest chain', String(tally.longestChain)],
      ['Double / Triple / Bingo / Donkey / Vegas', [2, 3, 4, 5, 6].map((n) => tally.chains[n] ?? 0).join(' / ')],
      ['Number / ordered / chess sets', `${tally.numberSets} / ${tally.orderedSets} / ${tally.chessSets}`],
      ['Longest set run', String(tally.longestRun)], ['Rum jugs', String(tally.jugs)],
    ],
  } : null);

  const settings = panel.settings.group('Game');
  settings.select('Difficulty', DIFFICULTIES, () => difficulty, (d) => {
    difficulty = d;
    store.set('difficulty', d);
  }, { disabled: busy, title: 'Which pieces appear (YPPedia: Blacksmithing, Difficulty levels)' });
  settings.number('Board size', () => perfectSize, (n) => {
    perfectSize = Math.max(MIN_PERFECT_SIZE, Math.min(MAX_PERFECT_SIZE, Math.round(n) || 3));
    store.set('perfectSize', perfectSize);
  }, {
    min: MIN_PERFECT_SIZE,
    max: MAX_PERFECT_SIZE,
    disabled: busy,
    hidden: () => mode !== 'perfect',
    title: 'Squares along each side; every square can be struck once',
  });
  settings.select('Timer', TIMERS, () => timerMs, (ms) => {
    timerMs = ms;
    store.set('perfectTimer', ms);
  }, { disabled: busy, hidden: () => mode !== 'perfect', title: 'Boards keep coming until Stop, or until the time runs out' });
  settings.button('Reset to defaults', () => {
    mode = 'classic';
    difficulty = 4;
    perfectSize = 3;
    timerMs = 0;
    store.set('mode', mode);
    store.set('difficulty', difficulty);
    store.set('perfectSize', perfectSize);
    store.set('perfectTimer', timerMs);
  }, { disabled: busy });

  const replaySettingsCodec: ReplaySettingsCodec = {
    currentVersion: 1,
    simulatorVersion: 1,
    migrate: (version, value) => {
      if (version !== 1 || !value || typeof value !== 'object') return null;
      const s = value as Record<string, unknown>;
      return (s.mode === 'classic' || s.mode === 'perfect') && Number.isFinite(s.difficulty) &&
        Number.isInteger(s.perfectSize) && Number.isFinite(s.timerMs) && (s.timerMs as number) >= 0 ? value : null;
    },
  };
  let savedReplaySettings: { mode: Mode; difficulty: number; perfectSize: number; timerMs: number } | null = null;
  replays = new ReplayRecorder('blacksmithing', store, panel, ticks, (tape: PuzzleReplay) => {
    savedReplaySettings ??= { mode, difficulty, perfectSize, timerMs };
    const settings = tape.settings as { mode: Mode; difficulty: number; perfectSize: number; timerMs: number };
    mode = settings.mode;
    difficulty = settings.difficulty;
    perfectSize = settings.perfectSize;
    timerMs = settings.timerMs;
    if (!rng.restore(tape.seed)) throw new Error('Invalid Blacksmithing random state');
    abortBoard();
    run.active = false;
    if (mode === 'perfect') startRun();
    else newSword();
  }, () => {
    if (run.active) endRun(false);
    else if (running) abortBoard();
    if (savedReplaySettings) {
      ({ mode, difficulty, perfectSize, timerMs } = savedReplaySettings);
      savedReplaySettings = null;
    }
  }, (seed) => new PyRandom(0).restore(seed), setReplayTime, () => frame([]), replaySettingsCodec, () => !busy() || replays.isPlaying);

  return { frame, dispose: () => { replays.dispose(); sounds.dispose(); } };
}) satisfies PuzzleFactory;
