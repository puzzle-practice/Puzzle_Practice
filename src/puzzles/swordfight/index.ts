// Swordfight, rebuilt from Puzzle Pirates (build 20260909165753): the board
// rules are in board.ts and strikes.ts, a player's board in play is fighter.ts, and this file is
// SwordPanel and SwordBoardView on top: the 450x600 panel with the board at (143, 62), the next pair,
// each pirate's status with a small copy of their board, the falling pair with its outline, pieces
// settling, shattering and fusing, incoming strikes with their warnings, and the game's art and
// sounds. Settings and scores are in the side panel.
import { SessionPause } from '../../core/pause';
import { Images } from '../../core/assets';
import { SoundBank } from '../../core/audio';
import { keyMatches } from '../../core/controls';
import { loadFont } from '../../core/fonts';
import { sessionAverages } from '../../core/duty/desk';
import { currentPirate } from '../../core/duty/profile';
import { faceCanvas } from '../../core/duty/view';
import { historyGroup } from '../../core/history';
import type { InputEvent } from '../../core/input';
import type { Option } from '../../core/panel';
import type { PuzzleFactory } from '../../core/puzzle';
import { PyRandom } from '../../core/pyrandom';
import { ReplayRecorder, type PuzzleReplay, type ReplaySettingsCodec } from '../../core/replay';
import type { GameRecord } from '../../core/storage';
import {
  blockPiece, blockTile, colour, DAMAGE, DAMAGE_HINT, EMPTY, H, isBlock, isBreaker, kind, METAL, RUM, SWORD, swordTile, W,
} from './board';
import { COL_PX, type Fighter, FAST_SPEED, ROW_PX, secondOf, startSpeed } from './fighter';
import { type GameStyle, gameSkillStyle, type NpcStyle, skillStyle } from './npc';
import { drawFace, FACE } from './faces';
import { Match, type MatchSettings, styleFor } from './match';
import { PLAIN_SWORDS, SWORD_COLOURS, SWORD_NAMES, isHorizontal } from './strikes';
import delarobbUrl from './delarobb.ttf?url';

const imageUrls = import.meta.glob<string>('./media/*.png', { eager: true, query: '?url', import: 'default' });
const swordIconUrls = import.meta.glob<string>('./media/swords/*.png', { eager: true, query: '?url', import: 'default' });
const faceUrls = import.meta.glob<string>('./media/faces/*.png', { eager: true, query: '?url', import: 'default' });
const soundUrls = import.meta.glob<string>('./sounds/*.ogg', { eager: true, query: '?url', import: 'default' });

const PUZZLE = 'swordfight';
const WIDTH = 450;
const HEIGHT = 600;
const BOARD_X = 143;
const BOARD_Y = 62;
const BOARD_W = W * COL_PX;
const BOARD_H = H * ROW_PX;
/** The next pair, in the box at the top left (SwordPanel: NextBlockView at (96, 6)). */
const NEXT_X = 96;
const NEXT_Y = 6;
/** Status rows: yours on the left at (1, 97), the opponents' on the right at (313, 97), 62px each. */
const LEFT_X = 1;
const RIGHT_X = 313;
const ROWS_Y = 97;
const ROW_H = 62;
const MINI = 4;
const FONT = 'Delarobb';
/** Piece colours' art, by colour number (sword/a/h.p). */
const COLOUR_NAMES = ['red', 'green', 'blue', 'yellow'];

/** Floating messages show for 1.5s, knock-outs 3s, the result 4s (s.d, s.a_). */
const MESSAGE_MS = 1500;
/** The eight sword colours (red, orange, yellow, green, blue, purple, white, black), for attacker dots. */
const SWORD_RGB = ['#d22a1e', '#f08a1e', '#f2d22e', '#3fa535', '#2f63d6', '#8a3fc4', '#f4f4f4', '#202020'];
/** Name colours (YoFaceLabel roles): yellow for most, red (role 12) for skilled swabbies. */
const NAME_YELLOW = '#ffff00';
const NAME_RED = '#ff1a2c';

/** Every sound a variant may pick from (the game's sound list). */
const SOUND_FILES: Record<string, string[]> = {
  block_join: ['block_join'], block_join_big: ['block_join_big'], block_join_huge: ['block_join_huge'],
  block_explode: ['strike_land', 'strike_land2'], block_explode_big: ['strike_land_big', 'strike_land_big2'],
  block_explode_huge: ['strike_land_huge', 'strike_land_huge2'],
  piece_land: ['metal_piece_land'], metal_piece_land: ['metal_piece_land2'],
  piece_explode: ['piece_explode', 'piece_explode2', 'piece_explode3', 'piece_explode4'],
  chain_double: ['chain_double'], chain_triple: ['chain_triple'], chain_quadruple: ['chain_quadruple'], chain_plus: ['chain_five'],
  hstrike_enter: ['hstrike_enter'], hstrike_enter_big: ['hstrike_enter_big'], hstrike_enter_huge: ['hstrike_enter_huge'],
  vstrike_enter: ['vstrike_enter', 'vstrike_enter2'], vstrike_enter_big: ['vstrike_enter_big'],
  vstrike_enter_huge: ['vstrike_enter_huge', 'vstrike_enter_huge2'],
  strike_blocked: ['strike_blocked', 'strike_blocked2'], strike_land: ['strike_land', 'strike_land2'],
  strike_land_big: ['strike_land_big', 'strike_land_big2'], strike_land_huge: ['strike_land_huge', 'strike_land_huge2'],
  danger_sprinkle: ['danger_sprinkle'], danger: ['danger'], danger_big: ['danger_big'], danger_huge: ['danger_huge'],
  opponent_knocked_out: ['opponent_knocked_out', 'opponent_knocked_out2'],
  self_knocked_out: ['self_knocked_out', 'self_knocked_out2'], teammate_knocked_out: ['teammate_knocked_out'],
  win: ['win'], lose: ['lose'], fanfare: ['fanfare'],
};

interface Settings extends MatchSettings {}

/** Jared's settings from 6 October 2026. */
const DEFAULTS: Settings = {
  cultists: 2,
  homunculi: 0,
  opponents: 2,
  thralls: 0,
  swabbies: 0,
  cultistSkill: 60,
  homunculusSkill: 60,
  thrallSkill: 50,
  swabbieSkill: 50,
  opponentType: 'game',
  gameAi: gameSkillStyle(60),
  ai: { pairMs: 3000, breakAverage: 40, variation: 41, heightBoost: 1.5, storeChance: 23, comboMax: 3, strikeShare: 85, pairsPerAttack: 1 },
  difficulty: 1,
  breakers: 18,
  sword: [16, 0, 0],
};

/** At most this many enemies, and allies, in a fight. */
const MAX_ENEMIES = 6;
const MAX_ALLIES = 5;
const SKILLS = ['cultistSkill', 'homunculusSkill', 'thrallSkill', 'swabbieSkill'] as const;

const KEYS = [
    { id: 'pause', label: 'Pause / resume', defaultKey: 'Escape' },
  { id: 'left', label: 'Move left', defaultKey: 'ArrowLeft' },
  { id: 'right', label: 'Move right', defaultKey: 'ArrowRight' },
  { id: 'cw', label: 'Turn clockwise', defaultKey: 'ArrowDown' },
  { id: 'ccw', label: 'Turn anticlockwise', defaultKey: 'ArrowUp' },
  { id: 'drop', label: 'Drop faster', defaultKey: 'Space' },
  { id: 'next', label: 'Next target', defaultKey: 'S' },
  { id: 'prev', label: 'Previous target', defaultKey: 'A' },
];
const key = (event: string, id: string) => {
  const binding = KEYS.find((k) => k.id === id)!;
  const aliases = id === 'next' ? [']'] : id === 'prev' ? ['['] : [];
  return keyMatches(event, PUZZLE, id, binding.defaultKey, aliases);
};

function validSword(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && PLAIN_SWORDS.includes(value[0]) &&
    value.slice(1).every((n) => Number.isInteger(n) && n >= 0 && n < 8);
}

const inRange = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && inRange(v, lo, hi);

function validStyle(value: unknown): value is NpcStyle {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return inRange(s.pairMs, 50, 20000) && inRange(s.breakAverage, 0, 100) && inRange(s.variation, 0, 100) &&
    inRange(s.heightBoost, 0, 10) && inRange(s.storeChance, 0, 100) && int(s.comboMax, 0, 20) &&
    inRange(s.strikeShare, 0, 100) && int(s.pairsPerAttack, 0, 100);
}

function validGameStyle(value: unknown): value is GameStyle {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return inRange(s.pairMs, 50, 20000) && inRange(s.baseDestroy, 0, 100) && inRange(s.maxDestroy, 0, 100) &&
    inRange(s.chainChance, 0, 100) && inRange(s.targetedSlowdown, 0, 1000) && inRange(s.strikeShare, 0, 100) && int(s.pairsPerAttack, 0, 100);
}

/** Saved settings without the current opponent options get them from their AI skill. */
function upgrade(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const s = { ...(value as Record<string, unknown>) };
  // One AI skill for everyone became a skill for each kind of pirate.
  const old = int(s.aiSkill, 0, 100) ? (s.aiSkill as number) : int(s.skill, 0, 10) ? (s.skill as number) * 10 : 60;
  delete s.skill;
  delete s.aiSkill;
  if (!validStyle(s.ai)) s.ai = skillStyle(old);
  if (!validGameStyle(s.gameAi)) s.gameAi = gameSkillStyle(old);
  for (const k of SKILLS) if (!int(s[k], 0, 100)) s[k] = DEFAULTS[k];
  if (!int(s.thralls, 0, MAX_ALLIES) || !int(s.swabbies, 0, MAX_ALLIES)) {
    s.thralls = 0;
    s.swabbies = 0;
  }
  if (s.opponentType !== 'tally' && s.opponentType !== 'game') s.opponentType = 'game';
  // Before cultists and homunculi, opponents were one count with one sword: they become cultists.
  if (!int(s.cultists, 0, MAX_ENEMIES) || !int(s.homunculi, 0, MAX_ENEMIES)) {
    s.cultists = int(s.opponents, 0, MAX_ENEMIES) ? s.opponents : 0;
    s.homunculi = 0;
  }
  s.opponents = (s.cultists as number) + (s.homunculi as number);
  delete s.enemySword;
  return s;
}

function validSettings(value: unknown): value is Settings {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return int(s.cultists, 0, MAX_ENEMIES) && int(s.homunculi, 0, MAX_ENEMIES) && s.opponents === (s.cultists as number) + (s.homunculi as number) &&
    int(s.opponents, 0, MAX_ENEMIES) && int(s.thralls, 0, MAX_ALLIES) && int(s.swabbies, 0, MAX_ALLIES) &&
    (s.thralls as number) + (s.swabbies as number) <= MAX_ALLIES && SKILLS.every((k) => int(s[k], 0, 100)) && validStyle(s.ai) && validGameStyle(s.gameAi) &&
    (s.opponentType === 'tally' || s.opponentType === 'game') && int(s.difficulty, 0, 9) &&
    typeof s.breakers === 'number' && s.breakers >= 0 && s.breakers <= 100 && validSword(s.sword);
}

interface Message {
  text: string;
  start: number;
  ms: number;
}

/** Ten piece explosions break into quarters that fly up and fall (SwordBoardView's explode info). */
function chunkVelocity(seed: number, i: number): [number, number] {
  const r = (n: number) => {
    const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return [(r(i * 2) * 2 - 1) * 0.082, -r(i * 2 + 1) * 0.522];
}

export default (async ({ screen, input, panel, store, ticks: rawTicks, setReplayTime: rawReplayTime }) => {
  const pause = new SessionPause(rawTicks, rawReplayTime);
  const { ticks, setReplayTime } = pause;
  const [images, icons, faceImages] = await Promise.all([Images.load(imageUrls), Images.load(swordIconUrls), Images.load(faceUrls), loadFont(FONT, delarobbUrl)]);
  const img = (name: string) => images.get(name);
  let replays!: ReplayRecorder;
  const sounds = new SoundBank(soundUrls, () => replays?.isSeeking ?? false);
  const soundPick = new PyRandom();
  soundPick.seedFromCrypto();
  const ctx = screen.ctx;
  const play = (name: string) => {
    const files = SOUND_FILES[name];
    if (files) sounds.play(files[soundPick.randintN(0, files.length - 1)]);
  };

  const saved = upgrade(store.get<unknown>('settings', DEFAULTS));
  let settings: Settings = structuredClone(validSettings(saved) ? saved : DEFAULTS);
  const seeds = new PyRandom();
  seeds.seedFromCrypto();

  let match: Match | null = null;
  let running = false;
  let finished = false;
  /** The fight's stats cover the board only once asked for; until then the board stays on show. */
  let showResults = false;
  let startedAt = 0;
  let messages: Message[] = [];
  let hideOpponents = store.get<boolean>('hideOpponents', true);
  let showQueues = store.get<boolean>('showQueues', false);
  /** Left and right held, repeating 7 times a second after 300ms (PuzzlePanel's key bindings). */
  const held = { left: 0, right: 0, leftNext: 0, rightNext: 0 };

  /** Fights are kept apart by who's in them, how good they are, and how the AI plays. */
  const opponentKey = () => {
    const style = settings.opponentType === 'game' ? settings.gameAi : settings.ai;
    return `${settings.opponentType} ${SKILLS.map((k) => settings[k]).join('/')} ${JSON.stringify(style)}`;
  };
  const settingsKey = () => `${settings.cultists}c${settings.homunculi}h${settings.thralls}t${settings.swabbies}s:${opponentKey()}:${settings.difficulty}:${settings.breakers}`;
  const record = store.get<Record<string, { wins: number; losses: number; best: number }>>('record', {});

  function start(seed?: number): void {
    pause.resume();
    const s = seed ?? seeds.randintN(1, 2 ** 31 - 1);
    if (seed === undefined) replays.begin(structuredClone(settings), { seed: s });
    const now = ticks();
    messages = [];
    held.left = held.right = 0;
    match = new Match(structuredClone(settings), s, now, {
      sound: (name, fighter) => { if (fighter === 0) play(name); },
      message: (text, fighter) => { if (fighter === 0) messages.push({ text, start: ticks(), ms: text.includes('knocked') ? 3000 : text.startsWith('Ye be') && !text.includes('knocked') ? Infinity : MESSAGE_MS }); },
    });
    running = true;
    finished = false;
    showResults = false;
    startedAt = now;
    play('fanfare');
  }

  function outcome(): string {
    if (!match) return '';
    if (!settings.opponents) return 'Knocked out';
    if (match.result === 'won') return 'Victory';
    if (match.result === 'lost') return 'Defeat';
    return 'Stopped';
  }

  function stop(): void {
    if (!match) return;
    const now = ticks();
    const completed = !!match.result;
    const f = match.player;
    const finishedReplay = replays.finish(outcome());
    if (completed && !replays.isPlaying) {
      store.addHistory(settingsKey(), {
        score: f.stats.sent,
        result: outcome(),
        won: match.result === 'won' ? 1 : 0,
        ms: Math.round((match.endedAt || now) - startedAt),
        received: f.stats.received,
        largestReceived: f.stats.largestReceived,
        ...Object.fromEntries(COLOUR_NAMES.map((name, i) => [`${name}Drought`, f.stats.breakerDroughts[i]])),
        pairs: f.stats.pairs,
        bestChain: f.stats.bestChain,
        ...(finishedReplay ? { replayAt: finishedReplay.at, replayId: finishedReplay.runId ?? '' } : {}),
      });
      const r = record[settingsKey()] ?? { wins: 0, losses: 0, best: 0 };
      if (settings.opponents) {
        if (match.result === 'won') r.wins++;
        else r.losses++;
      }
      r.best = Math.max(r.best, f.stats.sent);
      record[settingsKey()] = r;
      store.set('record', record);
    }
    if (!match.result) match.endedAt = now;
    running = false;
    finished = true;
  }

  // ---- Input ----

  function handle(events: InputEvent[], now: number): void {
    if (!match || !running || match.result) return;
    const f = match.player;
    for (const event of events) {
      if (event.type === 'keydown') {
        if (key(event.key, 'left')) { f.move(-1, now); held.left = now; held.leftNext = now + 300; }
        else if (key(event.key, 'right')) { f.move(1, now); held.right = now; held.rightNext = now + 300; }
        else if (key(event.key, 'cw')) f.rotate(true, now);
        else if (key(event.key, 'ccw')) f.rotate(false, now);
        else if (key(event.key, 'drop')) f.setFast(true, now);
        else if (key(event.key, 'next')) match.cycleTarget(1);
        else if (key(event.key, 'prev')) match.cycleTarget(-1);
      } else if (event.type === 'keyup') {
        if (key(event.key, 'left')) held.left = 0;
        else if (key(event.key, 'right')) held.right = 0;
        else if (key(event.key, 'drop')) f.setFast(false, now);
      } else if (event.type === 'mousedown' && event.button === 1) {
        // Clicking an opponent's status targets them.
        const [mx, my] = event.pos;
        if (mx >= RIGHT_X && mx < RIGHT_X + 136) {
          // Rows as they're shown; the knocked out can't be targeted.
          const row = Math.floor((my - ROWS_Y) / ROW_H);
          const enemies = match.rows[1];
          if (row >= 0 && row < enemies.length) match.setTarget(enemies[row]);
        }
      }
    }
    for (const side of ['left', 'right'] as const) {
      const next = side === 'left' ? 'leftNext' : 'rightNext';
      while (held[side] && now >= held[next]) {
        f.move(side === 'left' ? -1 : 1, held[next]);
        held[next] += 1000 / 7;
      }
    }
  }

  // ---- Drawing ----

  /** The tile for a piece: its sheet and frame (sword/a/h.b). */
  function tileOf(p: number, small = false): [string, number] | null {
    const sm = small ? '_sm' : '';
    switch (kind(p)) {
      case SWORD: return [`piece_swords_strike${sm}`, swordTile(p)];
      case DAMAGE: return [`piece_swords_metal${sm}`, 7];
      case DAMAGE_HINT: return [`piece_swords_metal${sm}`, colour(p)];
      case METAL: return [`piece_swords_metal${sm}`, 8];
      case RUM: return null;
      default: {
        const name = COLOUR_NAMES[colour(p)];
        if (!name) return null;
        return [`piece_swords_${name}${sm}`, isBlock(p) ? blockTile(p) : isBreaker(p) ? 10 : 0];
      }
    }
  }

  function drawPiece(p: number, x: number, y: number, alpha = 1): void {
    if (p === EMPTY) return;
    const tile = tileOf(p);
    if (!tile) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img(tile[0]), tile[1] * COL_PX, 0, COL_PX, ROW_PX, Math.trunc(x), Math.trunc(y), COL_PX, ROW_PX);
    ctx.globalAlpha = 1;
  }

  /** The pair's first piece is outlined in white (a 1px white glow). */
  const glowCache = new Map<number, HTMLCanvasElement>();
  function glowing(p: number): HTMLCanvasElement {
    let canvas = glowCache.get(p);
    if (canvas) return canvas;
    canvas = document.createElement('canvas');
    canvas.width = COL_PX + 2;
    canvas.height = ROW_PX + 2;
    const c = canvas.getContext('2d')!;
    const tile = tileOf(p)!;
    for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 2], [0, 2], [2, 0]]) {
      c.drawImage(img(tile[0]), tile[1] * COL_PX, 0, COL_PX, ROW_PX, dx, dy, COL_PX, ROW_PX);
    }
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.globalCompositeOperation = 'source-over';
    c.drawImage(img(tile[0]), tile[1] * COL_PX, 0, COL_PX, ROW_PX, 1, 1, COL_PX, ROW_PX);
    glowCache.set(p, canvas);
    return canvas;
  }

  function drawPair(f: Fighter, now: number): void {
    const p = f.pair;
    if (!p) return;
    const offset = p.bounceAt ? 1 : f.progress(now) * ROW_PX;
    const [sc, sr] = secondOf(p);
    drawPiece(p.pieces[1], sc * COL_PX, sr * ROW_PX + offset);
    ctx.drawImage(glowing(p.pieces[0]), p.col * COL_PX - 1, p.row * ROW_PX + offset - 1);
  }

  function drawBoard(f: Fighter, now: number): void {
    ctx.save();
    ctx.translate(BOARD_X, BOARD_Y);
    ctx.beginPath();
    ctx.rect(0, 0, BOARD_W, BOARD_H);
    ctx.clip();
    const moving = new Set(f.movers.map((m) => m.to * W + m.x));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) if (!moving.has(y * W + x)) drawPiece(f.board.get(x, y), x * COL_PX, y * ROW_PX);
    }
    // Pieces settling slide straight down (DropBoardView.b with a LinePath).
    for (const m of f.movers) {
      const t = Math.min(1, Math.max(0, (now - m.start) / (m.end - m.start)));
      drawPiece(m.piece, m.x * COL_PX, (m.from + (m.to - m.from) * t) * ROW_PX);
    }
    // New blocks fade in over the loose pieces before they fuse.
    for (const j of f.joins) {
      const a = Math.min(1, (now - j.start) * 0.004);
      const { block } = j;
      for (let cx = 0; cx < block.w; cx++) {
        for (let cy = 0; cy < block.h; cy++) {
          drawPiece(blockPiece(block.colour, cx, cy, block.w, block.h), (block.x + cx) * COL_PX, (block.y - block.h + 1 + cy) * ROW_PX, a);
        }
      }
    }
    for (const s of f.sprites) {
      const total = Math.abs(s.to - s.from);
      const t = Math.min(total, Math.max(0, (now - s.start) / s.stepMs));
      const lead = s.from + Math.sign(s.to - s.from) * t;
      if (!s.across) {
        s.pieces.forEach((p, i) => drawPiece(p, s.line * COL_PX, (lead - i) * ROW_PX));
      } else {
        s.pieces.forEach((p, i) => drawPiece(p, (lead + i * s.dir) * COL_PX, s.line * ROW_PX));
      }
    }
    drawShadows(f, now);
    drawPair(f, now);
    // Shattered pieces break into quarters that fly up and fall away over half a second.
    for (const b of f.blasts) {
      const t = now - b.start;
      const tile = tileOf(b.piece);
      if (!tile) continue;
      ctx.globalAlpha = Math.max(0, 1 - t / 500);
      for (let i = 0; i < 4; i++) {
        const [vx, vy] = chunkVelocity(b.start + b.x * 31 + b.y * 17, i);
        const qx = (i % 2) * (COL_PX / 2);
        const qy = Math.floor(i / 2) * (ROW_PX / 2);
        const x = b.x * COL_PX + qx + vx * t;
        const y = b.y * ROW_PX + qy + vy * t + 0.000522 * t * t / 2;
        ctx.drawImage(img(tile[0]), tile[1] * COL_PX + qx, qy, COL_PX / 2, ROW_PX / 2, Math.trunc(x), Math.trunc(y), COL_PX / 2, ROW_PX / 2);
      }
      ctx.globalAlpha = 1;
    }
    // Sparks where a sword hits.
    for (const hit of f.impacts) {
      const t = now - hit.start;
      const n = Math.min(12, 3 + hit.size);
      ctx.globalAlpha = Math.max(0, 1 - t / 600);
      for (let i = 0; i < n; i++) {
        const [vx, vy] = chunkVelocity(hit.start + i, i);
        const x = hit.x * COL_PX + vx * 3 * t - 19;
        const y = hit.y * ROW_PX + vy * 0.6 * t + 0.0005 * t * t - 19;
        ctx.drawImage(img('sparks'), (i % 3) * 39, 0, 39, 39, Math.trunc(x), Math.trunc(y), 39, 39);
      }
      ctx.globalAlpha = 1;
    }
    if (f.out) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    }
    drawMessages(now);
    ctx.restore();
  }

  /** Warnings of incoming strikes poke in at the edge and blink every 300ms. */
  function drawShadows(f: Fighter, now: number): void {
    if (!f.shadows.length || !f.pair) return;
    if (Math.floor(now / 300) % 2 === 1) return;
    ctx.globalAlpha = 0.75;
    for (const s of f.shadows) {
      const area = s.width * s.height;
      const hidden = 1 - [1 / 3, 2 / 3, 1][area <= 6 ? 0 : area <= 10 ? 1 : 2];
      if (isHorizontal(s)) {
        const col = s.orient === 0 ? Math.max(s.x, 0) : Math.min(s.x + s.width - 1, W - 1);
        const column = s.pieces[col];
        if (!column) continue;
        const x = s.orient === 0 ? BOARD_W - COL_PX * (1 - hidden) : -COL_PX * hidden;
        const rows = Math.min(s.height, column.length);
        for (let i = rows - 1; i >= 0; i--) drawPiece(column[i], x, (s.y - i) * ROW_PX);
      } else {
        for (let col = Math.max(s.x, 0); col < Math.min(s.x + s.width, W); col++) {
          const column = s.pieces[col];
          if (column) drawPiece(column[0], col * COL_PX, -ROW_PX * hidden);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawMessages(now: number): void {
    messages = messages.filter((m) => now < m.start + m.ms);
    let y = BOARD_H / 2;
    for (const m of messages) {
      const p = (now - m.start) / m.ms;
      ctx.save();
      ctx.globalAlpha = p < 0.7 ? 1 : Math.max(0, 1 - (p - 0.7) / 0.3);
      ctx.font = `28px "${FONT}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000';
      const ty = y - 30 * Math.min(p, 0.7);
      ctx.strokeText(m.text, BOARD_W / 2, ty, BOARD_W - 4);
      ctx.fillStyle = '#fff';
      ctx.fillText(m.text, BOARD_W / 2, ty, BOARD_W - 4);
      ctx.restore();
      y += 36;
    }
  }

  function drawNext(f: Fighter | null): void {
    const next = f?.next;
    if (!next) return;
    drawPiece(next[1], NEXT_X, NEXT_Y);
    drawPiece(next[0], NEXT_X, NEXT_Y + ROW_PX);
  }

  /**
   * A pirate's status row, laid out as the game lays it out: face with the name over it, sword,
   * small board and attacker dots, mirrored on the right. The small board has a gold outline (white
   * on your target) with a black line inside, on khaki (darker once knocked out).
   */
  /** Each fight's faces, drawn once: standing and knocked out. */
  const faces = new WeakMap<Match, Map<string, HTMLCanvasElement>>();
  function faceOf(m: Match, index: number, out: boolean): HTMLCanvasElement {
    let cache = faces.get(m);
    if (!cache) faces.set(m, (cache = new Map()));
    const pirate = index === 0 ? currentPirate() : null;
    const key = `${index}${out ? 'out' : ''}${pirate ? JSON.stringify(pirate.face) : ''}`;
    let face = cache.get(key);
    if (!face) cache.set(key, (face = pirate ? faceCanvas(pirate.face, out ? 'really_sad' : 'normal')
      : drawFace(m.looks[index], out, (name) => faceImages.get(name))));
    return face;
  }

  /** Text in the game's outline style: black one pixel all round, then the colour (samskivert Label OUTLINE). */
  function outlined(text: string, x: number, y: number, colour: string): void {
    ctx.fillStyle = '#000';
    for (const [dx, dy] of [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]]) ctx.fillText(text, x + dx - 1, y + dy - 1);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  }

  function drawStatus(m: Match, index: number, x: number, y: number, right: boolean): void {
    const f = m.fighters[index];
    const sword = m.swords[index];
    const SLOT = 60;
    const SWORD_W = 30;
    const SUMMARY_W = W * MINI + 4;
    const SUMMARY_H = H * MINI + 4;
    const DOTS = 13;
    // Left: face, sword, board, dots. Right: dots, board, sword, face.
    const parts = right ? ['dots', 'board', 'sword', 'face'] : ['face', 'sword', 'board', 'dots'];
    const widths: Record<string, number> = { face: SLOT, sword: SWORD_W, board: SUMMARY_W, dots: DOTS };
    const at: Record<string, number> = {};
    let px = x;
    for (const part of parts) {
      at[part] = px;
      px += widths[part];
    }
    ctx.save();
    // The small board.
    const bx = at.board;
    const by = y + Math.floor((ROW_H - SUMMARY_H) / 2);
    ctx.fillStyle = f.out ? '#92974a' : '#b1ab92';
    ctx.fillRect(bx, by, SUMMARY_W, SUMMARY_H);
    if (hideOpponents && m.teams[index] === 1) {
      // Hidden: only how high each column is, in dark red, as the game shows other pirates without their boards.
      ctx.fillStyle = f.out ? '#94552a' : '#9e0b0e';
      const levels = f.board.columnLevels();
      levels.forEach((h, c) => { if (h) ctx.fillRect(bx + 2 + c * MINI, by + SUMMARY_H - h * MINI - 2, MINI, h * MINI); });
    } else {
      for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) {
          const tile = tileOf(f.board.get(c, r), true);
          if (tile) ctx.drawImage(img(tile[0]), tile[1] * MINI, 0, MINI, MINI, bx + 2 + c * MINI, by + 2 + r * MINI, MINI, MINI);
        }
      }
    }
    ctx.strokeStyle = index === m.target && !f.out ? '#ffffff' : '#c1b016';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, SUMMARY_W - 1, SUMMARY_H - 1);
    ctx.strokeStyle = '#000';
    ctx.strokeRect(bx + 1.5, by + 1.5, SUMMARY_W - 3, SUMMARY_H - 3);
    // The sword.
    const icon = icons.has(`sword${sword.type}`) ? icons.get(`sword${sword.type}`) : null;
    if (icon) {
      const iy = y + Math.floor((ROW_H - icon.height) / 2);
      ctx.drawImage(icon, at.sword, iy);
      const [mx, my] = input.mouse;
      if (mx >= at.sword && mx < at.sword + SWORD_W && my >= y && my < y + ROW_H) hoveredSword = index;
    }
    // The face (passed out once knocked out, faded where the game has no such face), with the name
    // over its top as YoFaceLabel draws it: 10pt, outlined, wrapped to the face's width.
    const face = faceOf(m, index, f.out);
    if (f.out && index !== 0 && m.looks[index].out === m.looks[index].layers) ctx.globalAlpha = 0.6;
    ctx.drawImage(face, at.face + (SLOT - FACE) / 2, y + 4);
    ctx.globalAlpha = 1;
    ctx.font = '10px Dialog, Arial, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    const lines: string[] = [];
    for (const word of m.names[index].split(' ')) {
      const last = lines.length - 1;
      if (last >= 0 && ctx.measureText(`${lines[last]} ${word}`).width <= SLOT - 2) lines[last] += ` ${word}`;
      else lines.push(word);
    }
    const colour = m.kinds[index] === 'Skilled swabbie' ? NAME_RED : NAME_YELLOW;
    // With attack queues shown, an enemy still standing shows attacks:pieces waiting for it instead.
    const queue = showQueues && m.teams[index] === 1 && !f.out && 'queue' in f ? f.queue : null;
    if (queue) lines.splice(0, lines.length, `${queue.attacks}:${queue.blocks}`);
    lines.forEach((line, i) => outlined(line, at.face + SLOT / 2, y + 1 + i * 13, colour));
    // Attacker dots: one for each pirate attacking this one, in the colours of their sword.
    const attackers = m.targeters(index);
    let dy = y + 2;
    const groups = Math.floor(attackers.length / 5);
    for (let i = 0; i < groups; i++) {
      ctx.drawImage(img('group_dot'), right ? at.dots + 1 : at.dots + DOTS - 9 - 1, dy);
      dy += 10;
    }
    dy++;
    for (const from of attackers.slice(groups * 5)) {
      const { primary, secondary } = m.swords[from];
      const cx = (right ? at.dots + 1 : at.dots + DOTS - 6 - 2) + 3;
      const cy = dy + 3;
      ctx.fillStyle = SWORD_RGB[secondary];
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = SWORD_RGB[primary];
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
      dy += 9;
    }
    ctx.restore();
  }

  /** The sword under the mouse, found while drawing the status rows. */
  let hoveredSword = -1;

  /** A tooltip by the mouse with a sword's name and colours (primary, then secondary). */
  function swordTip(m: Match, index: number): void {
    const sword = m.swords[index];
    const [p, s] = [SWORD_COLOURS[sword.primary], SWORD_COLOURS[sword.secondary].toLowerCase()];
    const text = `${sword.name}: ${sword.primary === sword.secondary ? p : `${p} and ${s}`}`;
    ctx.save();
    ctx.font = '11px Arial, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const w = Math.ceil(ctx.measureText(text).width) + 8;
    const [mx, my] = input.mouse;
    const x = Math.max(0, Math.min(WIDTH - w, mx + 10));
    const y = my + 18 + 17 > HEIGHT ? my - 20 : my + 18;
    ctx.fillStyle = '#fffbe0';
    ctx.fillRect(x, y, w, 17);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 16);
    ctx.fillStyle = '#000';
    ctx.fillText(text, x + 4, y + 3);
    ctx.restore();
  }

  function banner(text: string, y: number): void {
    ctx.save();
    ctx.font = `24px "${FONT}"`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff';
    ctx.strokeText(text, WIDTH / 2, y);
    ctx.fillText(text, WIDTH / 2, y);
    ctx.restore();
  }

  // ---- The frame ----

  function frame(events: InputEvent[]): void {
    const liveEvents = pause.input(events, 'swordfight', running);
    if (liveEvents === null) return;
    events = liveEvents;
    const routed = replays.frame(events, input.mouse, ticks());
    events = routed.events;
    input.mouse = routed.mouse;
    const now = ticks();
    if (!routed.renderOnly) {
      handle(events, now);
      if (match && running) {
        match.update(now);
        if (match.settledAt) stop();
      }
    }
    if (replays.isSeeking || replays.isAdvancing) return;
    screen.fill('#000');
    if (!match) {
      screen.blit(img('howto'), 0, 0);
      replays.drawOverlay(ctx);
      return;
    }
    screen.blit(img('background'), 0, 0);
    drawNext(match.player);
    // Your side on the left, you first; the enemies on the right; the knocked out at the bottom.
    hoveredSword = -1;
    match.rows[0].forEach((i, row) => drawStatus(match!, i, LEFT_X, ROWS_Y + row * ROW_H, false));
    match.rows[1].forEach((i, row) => drawStatus(match!, i, RIGHT_X, ROWS_Y + row * ROW_H, true));
    drawBoard(match.player, running ? now : match.settledAt || match.endedAt || now);
    if (finished && !match.result) banner('Stopped', 330);
    if (hoveredSword >= 0) swordTip(match, hoveredSword);
    replays.drawOverlay(ctx);
  }

  pause.install(panel, () => running);

  // ---- Panel ----

  const clockNow = () => (match?.endedAt ? match.endedAt : running ? ticks() : ticks());
  panel.clock(() => ({ label: 'Time', ms: match ? clockNow() - startedAt : 0 }));
  panel.controls(PUZZLE, KEYS);

  const session = panel.session();
  // Cultists and homunculi, up to six between them; none is practice on your own.
  const enemies = (cultists: number, homunculi: number) => {
    settings.cultists = cultists;
    settings.homunculi = Math.min(homunculi, MAX_ENEMIES - cultists);
    settings.opponents = settings.cultists + settings.homunculi;
    save();
  };
  const counts = (): Option<number>[] => Array.from({ length: MAX_ENEMIES + 1 }, (_, n) => ({ value: n, label: String(n) }));
  session.select('Cultists (spears)', counts(), () => settings.cultists, (n) => enemies(n, Math.min(settings.homunculi, MAX_ENEMIES - n)), { disabled: () => running });
  session.select('Homunculi (trunks)', counts(), () => settings.homunculi, (n) => enemies(Math.min(settings.cultists, MAX_ENEMIES - n), n), { disabled: () => running });
  // Allies on your side: thralls and skilled swabbies, up to five between them.
  const allies = (thralls: number, swabbies: number) => {
    settings.thralls = thralls;
    settings.swabbies = Math.min(swabbies, MAX_ALLIES - thralls);
    save();
  };
  const allyCounts = (): Option<number>[] => Array.from({ length: MAX_ALLIES + 1 }, (_, n) => ({ value: n, label: String(n) }));
  session.select('Thralls (allies)', allyCounts(), () => settings.thralls, (n) => allies(n, Math.min(settings.swabbies, MAX_ALLIES - n)), { disabled: () => running || !settings.opponents });
  session.select('Skilled swabbies (allies)', allyCounts(), () => settings.swabbies, (n) => allies(Math.min(settings.thralls, MAX_ALLIES - n), n), { disabled: () => running || !settings.opponents });
  session.note(() => {
    const sword = SWORD_NAMES[settings.sword[0]];
    const speed = `${Math.round(ROW_PX / startSpeed(settings.difficulty))}ms a row`;
    return settings.opponents
      ? `Skill: cultists ${settings.cultistSkill}, homunculi ${settings.homunculusSkill}, thralls ${settings.thrallSkill}, swabbies ${settings.swabbieSkill} · starting speed ${speed} · your ${sword.toLowerCase()} (Settings tab)`
      : `Starting speed ${speed} · your ${sword.toLowerCase()} (Settings tab)`;
  });
  // Starting while a replay is open closes it and starts a fight of your own.
  session.button('Start', () => {
    if (replays.isPlaying) {
      replays.stop();
      if (!replays.isPlaying) start();
    } else if (running) stop();
    else start();
  }, {
    variant: 'primary', label: () => (replays?.isPlaying ? 'Start' : running ? 'Stop' : finished ? 'Fight again' : 'Start'),
  });
  session.button('View stats', () => { showResults = !showResults; }, {
    hidden: () => !finished || !match?.result, label: () => (showResults ? 'View board' : 'View stats'),
  });
  const targeting = () => running && !!match && settings.opponents > 1;
  panel.group(undefined, { hidden: () => !targeting() }).note(() => targeting() ? `Attacking ${match!.names[match!.target]}: press A / S or click a pirate on the right to change.` : '');

  const recordNow = () => record[settingsKey()] ?? { wins: 0, losses: 0, best: 0 };
  panel.score('Fight').stats(['', 'Now', 'Best'], () => [
    ['Damage sent', match ? String(match.player.stats.sent) : '0', String(recordNow().best || '—')],
    ...(settings.opponents ? [['Wins', String(recordNow().wins), `of ${recordNow().wins + recordNow().losses}`]] : []),
  ]);
  const damageRate = (amount: number) => {
    const seconds = match ? Math.max(0, (match.endedAt || ticks()) - startedAt) / 1000 : 0;
    return (seconds > 0 ? amount / seconds : 0).toFixed(2);
  };
  function fightAverages(): string[][] {
    const games = store.history(settingsKey());
    const rows = sessionAverages(games.map((g) => ({ ...g, duty: '' })), { scoreLabel: 'Damage sent' });
    const durations = games.filter((g) => typeof g.ms === 'number' && g.ms > 0);
    if (durations.length) {
      const seconds = durations.reduce((sum, g) => sum + Number(g.ms) / 1000, 0);
      rows.push(['Damage sent per second', `${(durations.reduce((sum, g) => sum + Number(g.score), 0) / seconds).toFixed(2)} squares/s`],
        ['Damage taken per second', `${(durations.reduce((sum, g) => sum + Number(g.received ?? 0), 0) / seconds).toFixed(2)} squares/s`]);
    }
    return rows;
  }
  panel.results(() => finished && showResults && match && match.result ? {
    title: settings.opponents ? (match.result === 'won' ? 'Ye be the victor!' : 'Ye be defeated!') : 'Practice results',
    headline: settings.opponents ? (match.result === 'won' ? 'Ye be the victor!' : 'Ye be defeated!') : undefined,
    averages: fightAverages(),
    rows: [
      ['Result', outcome()],
      ['Time', `${((match.endedAt - startedAt) / 1000).toFixed(1)}s`],
      ['Damage sent', String(match.player.stats.sent)],
      ['Damage taken', String(match.player.stats.received)],
      ['Damage sent per second', `${damageRate(match.player.stats.sent)} squares/s`],
      ['Damage taken per second', `${damageRate(match.player.stats.received)} squares/s`],
      ['Largest attack received', `${match.player.stats.largestReceived} squares`],
      ...COLOUR_NAMES.map((name, i) => [`Longest ${name} breaker drought`, `${match!.player.stats.breakerDroughts[i]} pieces`]),
      ['Pairs placed', String(match.player.stats.pairs)],
      ['Pieces shattered', String(match.player.stats.shattered)],
      ['Best chain', String(match.player.stats.bestChain)],
      ['Swords sent', String(match.player.stats.swordsSent)],
      ['Biggest sword', match.player.stats.biggestSword ? `${match.player.stats.biggestSword} squares` : '—'],
    ],
  } : null);

  const replayAction = {
    available: (game: GameRecord) => typeof game.replayAt === 'number' && (replays?.hasPlayableAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined) ?? false),
    play: (game: GameRecord) => { if (typeof game.replayAt === 'number') replays?.playAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined); },
  };
  historyGroup(panel, () => store.history(settingsKey()), [
    { label: 'Result', value: (g) => String(g.result ?? '') },
    { label: 'Damage', value: (g) => String(g.score) },
    { label: 'Time', value: (g) => typeof g.ms === 'number' ? `${(g.ms / 1000).toFixed(0)}s` : '' },
  ], 'Past fights', replayAction, false);

  function save(): void {
    store.set('settings', settings);
  }
  panel.settings.group('Opponent screens').toggle('Hide opponent screens', () => hideOpponents, (on) => { hideOpponents = on; store.set('hideOpponents', on); }, {
    title: 'Shows red boxes where an opponent has pieces, instead of the pieces themselves.',
  });
  panel.settings.group('Opponent screens').toggle('Show attack queues', () => showQueues, (on) => { showQueues = on; store.set('showQueues', on); }, {
    title: "Replaces each enemy's name with the attacks waiting to land on it and how many pieces they hold, as attacks:pieces (5:30 is five attacks of 30 pieces).",
  });
  const off = { disabled: () => running };
  const foes = panel.settings.group('Opponents');
  foes.select('Opponent type', [
    { value: 'game', label: 'Ingame' },
    { value: 'tally', label: 'Experimental' },
  ] as Option<'tally' | 'game'>[], () => settings.opponentType, (t) => { settings.opponentType = t; save(); }, off);
  // Each kind of pirate has its own skill, 0 to 100, which sets how much its breakers destroy.
  const skillLabels: Record<(typeof SKILLS)[number], string> = { cultistSkill: 'Cultist skill', homunculusSkill: 'Homunculus skill', thrallSkill: 'Thrall skill', swabbieSkill: 'Skilled swabbie skill' };
  for (const k of SKILLS) {
    foes.range(skillLabels[k], () => settings[k], (v) => { settings[k] = v; save(); }, { ...off, min: 0, max: 100,
      title: "0 to 100, as the game's own pirates. It sets how much of its colour a breaker destroys (the game's table has a value at every 10, blended between) and, for Ingame, the chain chance." });
  }
  foes.note(() => {
    const at = (skill: number) => {
      const st = styleFor(settings, skill);
      return settings.opponentType === 'game'
        ? `${st.game.baseDestroy}-${st.game.maxDestroy}% destroyed, ${st.game.chainChance}% chained`
        : `${st.tally.breakAverage}% cleared, height x${st.tally.heightBoost}, stores ${st.tally.storeChance}%, combo ${st.tally.comboMax}`;
    };
    return `Cultists: ${at(settings.cultistSkill)}. Homunculi: ${at(settings.homunculusSkill)}. Thralls: ${at(settings.thrallSkill)}. Skilled swabbies: ${at(settings.swabbieSkill)}.`;
  });
  const ai = (change: (a: NpcStyle) => void) => { change(settings.ai); save(); };
  const tallyOff = { disabled: () => running, hidden: () => settings.opponentType !== 'tally' };
  foes.number('Time per pair (ms)', () => settings.ai.pairMs, (v) => ai((a) => { a.pairMs = v; }), { ...tallyOff, min: 50, max: 20000, step: 50,
    title: 'How fast an opponent plays: how often it is dealt a pair.' });
  foes.range('Variation (±%)', () => settings.ai.variation, (v) => ai((a) => { a.variation = v; }), { ...tallyOff, min: 0, max: 50,
    title: 'How far a clear varies from that, either way.' });
  foes.range('Strikes vs sprinkles (%)', () => settings.ai.strikeShare, (v) => ai((a) => { a.strikeShare = v; }), { ...tallyOff, min: 0, max: 100,
    formatValue: (v) => (v === 0 ? 'all sprinkles' : v === 100 ? 'all strikes' : `${v}% strikes`), outputWidth: 13,
    title: 'Its style: how much of each clear it sends as swords, the rest as sprinkles. 50 is an even mix.' });
  foes.number('Your attacks land every (pairs)', () => settings.ai.pairsPerAttack, (v) => ai((a) => { a.pairsPerAttack = v; }), { ...tallyOff, min: 0, max: 100,
    title: 'Your attacks land on an opponent at most once per this many of its pairs.' });
  const gameOff = { disabled: () => running, hidden: () => settings.opponentType !== 'game' };
  const gai = (change: (a: GameStyle) => void) => { change(settings.gameAi); save(); };
  foes.number('Time per pair (ms)', () => settings.gameAi.pairMs, (v) => gai((a) => { a.pairMs = v; }), { ...gameOff, min: 50, max: 20000, step: 50,
    title: 'How fast an opponent plays when you are not targeting it: how often it is dealt a pair.' });
  foes.range('Slower when targeted (%)', () => settings.gameAi.targetedSlowdown, (v) => gai((a) => { a.targetedSlowdown = v; }), { ...gameOff, min: 0, max: 300, step: 5,
    title: 'How much slower an AI plays for each pirate attacking it, up to 4. The game slows an AI from 1 targeter, and most at 4.' });
  foes.range('Strikes vs sprinkles (%)', () => settings.gameAi.strikeShare, (v) => gai((a) => { a.strikeShare = v; }), { ...gameOff, min: 0, max: 100,
    formatValue: (v) => (v === 0 ? 'all sprinkles' : v === 100 ? 'all strikes' : `${v}% strikes`), outputWidth: 13,
    title: 'Its style: how much of each clear it sends as swords, the rest as sprinkles. 50 is an even mix.' });
  foes.number('Your attacks land every (pairs)', () => settings.gameAi.pairsPerAttack, (v) => gai((a) => { a.pairsPerAttack = v; }), { ...gameOff, min: 0, max: 100,
    title: 'Your attacks land on an opponent at most once per this many of its pairs.' });
  const game = panel.settings.group('Fight');
  game.select('Starting speed', Array.from({ length: 10 }, (_, d) => ({ value: d, label: `${d}: ${Math.round(ROW_PX / startSpeed(d))}ms a row` })),
    () => settings.difficulty, (d) => { settings.difficulty = d; save(); }, { disabled: () => running });
  game.number('Breaker chance (%)', () => settings.breakers, (v) => { settings.breakers = v; save(); }, { min: 0, max: 100, step: 0.5, disabled: () => running });
  game.note(() => `The pair speeds up as it's dealt, to ${Math.round(ROW_PX / 0.25)}ms a row at most; holding drop is ${Math.round(ROW_PX / FAST_SPEED)}ms a row.`);

  const swordOptions: Option<number>[] = PLAIN_SWORDS.map((t) => ({ value: t, label: SWORD_NAMES[t] }));
  const colourOptions: Option<number>[] = SWORD_COLOURS.map((name, i) => ({ value: i, label: name }));
  for (const [title, which] of [['Your sword', 'sword']] as const) {
    const g = panel.settings.group(title);
    g.select('Sword', swordOptions, () => settings[which][0], (t) => { settings[which] = [t, settings[which][1], settings[which][2]]; save(); }, { disabled: () => running });
    g.select('Colour 1', colourOptions, () => settings[which][1], (c) => { settings[which] = [settings[which][0], c, settings[which][2]]; save(); }, { disabled: () => running || settings[which][0] === 127 });
    g.select('Colour 2', colourOptions, () => settings[which][2], (c) => { settings[which] = [settings[which][0], settings[which][1], c]; save(); }, { disabled: () => running || settings[which][0] === 127 });
  }
  panel.settings.group('Reset').button('Reset to defaults', () => { settings = structuredClone(DEFAULTS); save(); }, { disabled: () => running });

  const replaySettingsCodec: ReplaySettingsCodec = {
    currentVersion: 6,
    simulatorVersion: 2,
    // Earlier recordings had an opponent that played the board, so they can't be replayed.
    migrate: (version, value) => {
      const upgraded = version < 6 ? upgrade(value) : value;
      return version >= 3 && version <= 6 && validSettings(upgraded) ? upgraded : null;
    },
  };
  let savedSettings: Settings | null = null;
  replays = new ReplayRecorder(PUZZLE, store, panel, ticks, (tape: PuzzleReplay) => {
    savedSettings ??= structuredClone(settings);
    settings = structuredClone(upgrade(tape.settings) as Settings);
    const seed = (tape.seed as { seed?: unknown })?.seed;
    if (typeof seed !== 'number') throw new Error('Invalid Swordfight replay seed');
    start(seed);
  }, () => {
    if (running) stop();
    if (savedSettings) {
      settings = savedSettings;
      savedSettings = null;
    }
  }, (seed) => typeof (seed as { seed?: unknown })?.seed === 'number', setReplayTime, () => frame([]), replaySettingsCodec, () => !running || replays.isPlaying);

  // For driving the game from tests during development.
  if (import.meta.env.DEV) (window as unknown as { __sf: unknown }).__sf = { get match() { return match; } };

  return { frame, dispose: () => { replays.dispose(); sounds.dispose(); } };
}) satisfies PuzzleFactory;
