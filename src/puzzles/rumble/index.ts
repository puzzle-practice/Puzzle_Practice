import { seedControls } from '../../core/seeds';
// Rumble (the game calls it boxing), from Puzzle Pirates: the board rules are in board.ts, a board
// in play is fighter.ts, the NPCs are npc.ts, and the fight between boards is match.ts. This file
// is the panel on top: the 450x600 panel with the board at (93, 41), each side's
// status list (yours on the left, the enemies' on the right), the fists and their aim, balls flying,
// popping and falling, punches and sprinkle landing, and the game's art and sounds. Settings and
// scores are in the side panel, laid out like Swordfight's. Freeplay mode, like Distilling's, is a
// sandbox on your own board: deal or paint it ball by ball, send yourself punches you pick, and
// play on; its rules are in create.ts.
import { SessionPause } from '../../core/pause';
import { Images } from '../../core/assets';
import { SoundBank } from '../../core/audio';
import { RumbleAudio } from './audio';
import { punchPosition } from './punch';
import { paintGlove } from './portrait';
import { drawImpact, impactHighlight } from './impact';
import { keyMatches } from '../../core/controls';
import { drawGameText, drawPauseLabel, floatAt, gameTextBox, loadGameFont, wrapGameText, BOARD_FONT_SMALL } from '../../core/game-text';
import { sessionAverages } from '../../core/duty/desk';
import { currentPirate } from '../../core/duty/profile';
import { faceCanvas } from '../../core/duty/view';
import { historyGroup } from '../../core/history';
import type { InputEvent } from '../../core/input';
import type { Option } from '../../core/panel';
import type { PuzzleFactory } from '../../core/puzzle';
import { Random } from '../../core/random';
import { ReplayRecorder, stateText, type PuzzleReplay, type ReplaySettingsCodec } from '../../core/replay';
import type { GameRecord } from '../../core/storage';
import { drawFace, FACE } from '../swordfight/faces';
import { DEFAULT_STYLE, type NpcStyle } from './npc';
import { DIR_PREC, H, STEP_Y, VIEW_H, VIEW_W, W, type Point } from './board';
import { ballInFist, CHARGE_MS, type Fighter, type Shout, PUNCH_STEP_MS, ROTATE_STEP, FINE_STEP, WARN_MS } from './fighter';
import { BLUDGEONS, colourMapping, FISTS_TYPE, GLOVE_NAMES, HOOK_TYPE } from './gloves';
import { BARBARIAN_FACTOR, Match, type MatchSettings, type NpcSettings, type FightRules } from './match';
import {
  ball, BLOCKED, charged, COLOUR_NAMES, colourOf, dark, EMPTY, FURBALL, isArriving, isBall, isCharged, isDark, isLight, light, ORANGE, plain,
} from './pieces';
import {
  type BoardSnapshot, convertSnapshot, dealInto, floating, MAX_COLOURS, MAX_LENGTH, MAX_ROWS, MAX_WIDTH, type PunchChoices,
  type PunchSpec, resetSparks, restoreBoard, rollPunch, shaftOf, SIM_BLUDGEONS, SimGlove, snapshotBoard, ballCount,
  furballColours, furballSlots, recolour, VIEWER_KINDS, viewerBoard, viewerBruises, werewolfPiece,
} from './create';
import type { Board } from './board';
import { AIM_BOARD_SHOTS, AIM_DIFFICULTIES, AIM_HISTORY, AIM_LIVES, AIM_MS, AIM_REPLAY_VERSION, AimTrainer, type AimDifficulty, type AimTarget } from './aim';
import { END_HOLD_MS } from '../../core/end-hold';

const imageUrls = import.meta.glob<string>('./media/*.png', { eager: true, query: '?url', import: 'default' });
const gloveUrls = import.meta.glob<string>('./media/gloves/*.png', { eager: true, query: '?url', import: 'default' });
const faceUrls = import.meta.glob<string>('../swordfight/media/faces/*.png', { eager: true, query: '?url', import: 'default' });
const dotUrls = import.meta.glob<string>('../swordfight/media/*dot.png', { eager: true, query: '?url', import: 'default' });
const soundUrls = {
  ...import.meta.glob<string>('./sounds/*.ogg', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob<string>('../swordfight/sounds/{opponent,teammate}_knocked_out*.ogg', { eager: true, query: '?url', import: 'default' }),
};

const PUZZLE = 'rumble';
const WIDTH = 450;
const HEIGHT = 600;
/** The board at (93, 41); friends at (1, 40) and enemies at (367, 40), 82 wide, 80 a row. */
const BOARD_X = 93;
const BOARD_Y = 41;
const LEFT_X = 1;
const RIGHT_X = 367;
const ROWS_Y = 40;
const ROW_H = 80;
const LIST_W = 82;
const VISIBLE_ROWS = 7;
const SCROLL_Y = 23;
const BALL = 30;

/** Ball colours for the small boards and attacker dots. */
const BALL_RGB = ['#e0261c', '#f4d52a', '#f4861e', '#2fc4e8', '#2c5ce0', '#7a4a1d'];
/** The combo shouts' colours, by ball colour: fill, then outline. */
/** Combo starburst colours by ball colour: stroke, gradient from, gradient to, text, text halo. */
const SHOUT_RGB: Array<[string, string, string, string, string]> = [
  ['#fff000', '#b80000', '#ff0000', '#ffffff', '#5e0000'],
  ['#ffffff', '#ffd200', '#ffe800', '#ff0000', '#520000'],
  ['#ffffff', '#e08100', '#ff9400', '#fff600', '#5e3a00'],
  ['#ffffff', '#0b86ff', '#2fbaff', '#ff0000', '#520000'],
  ['#e0ecff', '#0001ff', '#4866ff', '#ffa200', '#5e3a00'],
  ['#000000', '#5a250d', '#79391d', '#ffa200', '#5e3a00'],
];
const COMBO_WORDS = [
  'POW!', 'POP!', 'BIM!', 'BAM!', 'BOOM!', 'BOP!', 'WHAM!', 'THUD!', 'CRUNCH!', 'OOF!', 'SLAM!', 'SOCK!', 'SMACK!', 'SPLAT!',
  'CLONK!', 'THWAPP!', 'SNKT!', 'THUNK!', 'KAPOW!', 'CRACK!', 'CRUNK!', 'SOCKO!', 'WHACK!', 'SLAP!', 'TWEAK!', 'PINCH!',
  'POKE!', 'PROD!', 'NURPLE!', 'GONZO!', 'YEOWCH!', 'UNPLEASANT!', 'BADDABING!', 'BADDABOOM!', 'KRAKKATHOOM!',
];
/** The board shakes at 7 shots: each ball nudged by one of these, by frame and place. */
const SHAKE: Point[] = [
  { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: -1 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 }, { x: 0, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 },
];
const NAME_YELLOW = '#ffff00';
const NAME_RED = '#ff1a2c';
const MESSAGE_MS = 1500;

/** Every sound a name may pick from. */
const SOUND_FILES: Record<string, string[]> = {
  opponent_knocked_out: ['opponent_knocked_out', 'opponent_knocked_out2'],
  teammate_knocked_out: ['teammate_knocked_out'],
  charge_ball_explode: ['charged_ball_explode'],
};

// The trainer's replay version is separate so Fight replays remain compatible.
type Settings = MatchSettings & { aimTrainer?: typeof AIM_REPLAY_VERSION; aimDifficulty?: AimDifficulty };
type Kind = NpcSettings['kind'];

const DEFAULT_RULES: FightRules = {
  timeBonus: true, suppression: true, dropOffToAttackers: true, defence: true, defenceSquares: 90, side: 'random',
};

const DEFAULTS: Settings = {
  enemyRoster: [{ kind: 'Brigand', skill: 50, bludgeon: null }, { kind: 'Brigand', skill: 50, bludgeon: null }],
  allyRoster: [],
  ai: { ...DEFAULT_STYLE },
  rules: { ...DEFAULT_RULES },
  oneFisted: false,
  werewolf: false,
  rumless: false,
  damageLevel: 0,
  startRows: 3,
  bludgeon: [FISTS_TYPE, 0],
};

const MAX_ENEMIES = 30;
const MAX_ALLIES = 29;
const NPC_KINDS: Option<Kind>[] = (['Brigand', 'Barbarian', 'Skilled swabbie', 'Custom'] as const).map((kind) => ({ value: kind, label: kind }));

function npcDefaults(kind: Kind): NpcSettings {
  return { kind, skill: kind === 'Skilled swabbie' ? 70 : 50, bludgeon: null };
}

const inRange = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && inRange(v, lo, hi);

function validRoster(value: unknown, max: number): value is NpcSettings[] {
  return Array.isArray(value) && value.length <= max && value.every((npc) => npc && typeof npc === 'object' &&
    NPC_KINDS.some((o) => o.value === npc.kind) && inRange(npc.skill, 0, 100) && (npc.bludgeon === null || BLUDGEONS.includes(npc.bludgeon)));
}

function validStyle(value: unknown): value is NpcStyle {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return inRange(s.shotMs, 150, 4900) && inRange(s.variation, 0, 100) && inRange(s.targetedSlowdown, 0, 300) &&
    inRange(s.aimError, 0, 10) && typeof s.sparks === 'boolean' && inRange(s.bruiseChance, 0, 100) && inRange(s.bruiseShare, 0, 50);
}

function validRules(value: unknown): value is FightRules {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return typeof s.timeBonus === 'boolean' && typeof s.suppression === 'boolean' && typeof s.dropOffToAttackers === 'boolean' &&
    typeof s.defence === 'boolean' && int(s.defenceSquares, 1, 1000) &&
    (s.side === 'random' || s.side === 'left' || s.side === 'right');
}

function validSettings(value: unknown): value is Settings {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (s.aimTrainer === undefined || s.aimTrainer === AIM_REPLAY_VERSION) &&
    (s.aimDifficulty === undefined || AIM_DIFFICULTIES.includes(s.aimDifficulty as AimDifficulty)) && validRoster(s.enemyRoster, MAX_ENEMIES) && validRoster(s.allyRoster, MAX_ALLIES) && validStyle(s.ai) && validRules(s.rules) &&
    typeof s.oneFisted === 'boolean' && typeof s.werewolf === 'boolean' && typeof s.rumless === 'boolean' &&
    int(s.damageLevel, 0, 100) && int(s.startRows, 0, 12) && Array.isArray(s.bludgeon) && s.bludgeon.length === 2 &&
    BLUDGEONS.includes(s.bludgeon[0]) && int(s.bludgeon[1], 0, 119);
}

const KEYS = [
  { id: 'pause', label: 'Pause / resume', defaultKey: 'Escape' },
  { id: 'left', label: 'Aim left', defaultKey: 'ArrowLeft' },
  { id: 'right', label: 'Aim right', defaultKey: 'ArrowRight' },
  { id: 'fine', label: 'Fine aim (hold)', defaultKey: 'Shift' },
  { id: 'fireL', label: 'Fire left fist (hold to charge)', defaultKey: 'Z' },
  { id: 'fireR', label: 'Fire right fist (hold to charge)', defaultKey: 'X' },
  { id: 'next', label: 'Next target', defaultKey: 'S' },
  { id: 'prev', label: 'Previous target', defaultKey: 'A' },
];
/**
 * Fight is the game; Freeplay, as in Distilling, paints any board and never ends. Freeplay keeps no
 * history or replays: its board can change between any two shots. Aim trainer queues precision
 * and bank shots on changing bruise scaffolds, graded Easy to Very hard, with its own scores and replays.
 */
type Mode = 'Fight' | 'Create' | 'Aim trainer';
const MODES: Option<Mode>[] = [{ value: 'Fight', label: 'Fight' }, { value: 'Create', label: 'Freeplay' }, { value: 'Aim trainer', label: 'Aim trainer' }];

interface CreateSettings {
  rows: number;
  density: number;
  /** A bludgeon type, or -1 for random. */
  bludgeon: number;
  colours: number;
  randomColours: boolean;
  length: number;
  width: number;
  randomSize: boolean;
  side: PunchChoices['side'];
  bruises: number;
  showNumbers: boolean;
  /** Shows the next punch landed on the board. */
  previewOnBoard: boolean;
  /** The game's 5 second shot timer. Freeplay starts without it, as Distilling's does without its burn timer. */
  shotTimer: boolean;
  /** The board drops a row every eighth shot. */
  drops: boolean;
}

const CREATE_DEFAULTS: CreateSettings = {
  rows: 8, density: 85, bludgeon: 0, colours: 0, randomColours: false, length: 4, width: 6, randomSize: false,
  side: 'random', bruises: 0, showNumbers: false, previewOnBoard: false, shotTimer: false, drops: true,
};

/** Saved Freeplay settings over the defaults, keeping only values of the right type. */
function loadCreateSettings(value: unknown): CreateSettings {
  const settings = { ...CREATE_DEFAULTS };
  if (!value || typeof value !== 'object') return settings;
  const saved = value as Record<string, unknown>;
  for (const k of Object.keys(CREATE_DEFAULTS) as Array<keyof CreateSettings>) {
    if (typeof saved[k] === typeof CREATE_DEFAULTS[k]) (settings as Record<string, unknown>)[k] = saved[k];
  }
  return settings;
}

/** Freeplay mode paints with keys 1-5: red, yellow, orange (a furball in werewolf rumbling), cyan, blue. */
const PAINT_NAMES = ['Red', 'Yellow', 'Orange', 'Cyan', 'Blue'];
const CREATE_KEYS = [
  ...PAINT_NAMES.map((name, i) => ({ id: `paint${i + 1}`, label: `Freeplay: paint ${name.toLowerCase()}`, defaultKey: String(i + 1) })),
  { id: 'erase', label: 'Freeplay: erase', defaultKey: '0' },
  { id: 'charge', label: 'Freeplay: charge a ball', defaultKey: 'C' },
  { id: 'bruise', label: 'Freeplay: bruise a ball', defaultKey: 'B' },
  { id: 'punch', label: 'Freeplay: punch', defaultKey: 'P' },
  { id: 'roll', label: 'Freeplay: roll the punch again', defaultKey: 'R' },
  { id: 'deal', label: 'Freeplay: deal a board', defaultKey: 'G' },
  { id: 'undo', label: 'Freeplay: undo', defaultKey: 'U' },
  { id: 'preview', label: 'Freeplay: preview on board', defaultKey: 'V' },
];
const UNDO_LIMIT = 100;

const key = (event: string, id: string) => {
  const binding = [...KEYS, ...CREATE_KEYS].find((k) => k.id === id)!;
  const aliases = id === 'next' ? [']'] : id === 'prev' ? ['['] : id === 'fireL' ? ['ArrowUp'] : id === 'erase' ? ['Delete'] : [];
  return keyMatches(event, PUZZLE, id, binding.defaultKey, aliases);
};

interface Message {
  text: string;
  start: number;
  ms: number;
}

const gloveName = (type: number) => GLOVE_NAMES[type] ?? 'Bludgeon';

export default (async ({ screen, input, panel, store, ticks: rawTicks, setReplayTime: rawReplayTime }) => {
  const pause = new SessionPause(rawTicks, rawReplayTime);
  const { ticks, setReplayTime } = pause;
  const [images, gloveImages, faceImages, dots] = await Promise.all([
    Images.load(imageUrls), Images.load(gloveUrls), Images.load(faceUrls), Images.load(dotUrls), loadGameFont(),
  ]);
  const img = (name: string) => images.get(name);
  const fistHighlight = impactHighlight(img('fist_hit'));
  let replays!: ReplayRecorder;
  const sounds = new SoundBank(soundUrls, () => replays?.isSeeking ?? false);
  const rumbleAudio = new RumbleAudio(sounds);
  const soundPick = new Random();
  const ctx = screen.ctx;
  const play = (name: string) => {
    const files = SOUND_FILES[name] ?? [name];
    sounds.play(files[soundPick.integer(0, files.length - 1)]);
  };
  /** Werewolf rumbling growls on a loop from the start of a match until it ends. */
  let stopGrowl: (() => void) | null = null;
  const quietGrowl = () => { stopGrowl?.(); stopGrowl = null; };

  const saved = store.get<unknown>('settings', DEFAULTS);
  // Settings saved before NPCs had an aim error get the default, and lose the spark break chance.
  if (saved && typeof saved === 'object' && (saved as Settings).ai && typeof (saved as Settings).ai === 'object') {
    const ai = { ...DEFAULT_STYLE, ...(saved as Settings).ai } as NpcStyle & { sparkBreak?: number };
    delete ai.sparkBreak;
    (saved as Settings).ai = ai;
  }
  let settings: Settings = structuredClone(validSettings(saved) ? saved : DEFAULTS);

  let mode = store.get<Mode>('mode', 'Fight');
  if (!MODES.some((m) => m.value === mode)) mode = 'Fight';
  /** The mode the match on screen was started in. */
  let startedMode: Mode = mode;
  const creating = () => !!match && startedMode === 'Create';
  const aiming = () => !!match && startedMode === 'Aim trainer';
  let aim: AimTrainer | null = null;
  let aimDifficulty = store.get<AimDifficulty>('aimDifficulty', 'Mixed');
  if (!AIM_DIFFICULTIES.includes(aimDifficulty)) aimDifficulty = 'Mixed';
  /** Each difficulty keeps its own scores. Mixed keeps the trainer's original history. */
  const aimHistory = () => aimDifficulty === 'Mixed' ? AIM_HISTORY : `${AIM_HISTORY}:${aimDifficulty}`;
  const create = loadCreateSettings(store.get<unknown>('create', CREATE_DEFAULTS));
  const saveCreate = () => store.set('create', create);
  let match: Match | null = null;
  let running = false;
  let finished = false;
  let showResults = false;
  let startedAt = 0;
  let messages: Message[] = [];
  let showColours = store.get<boolean>('showColours', false);
  let showLanding = store.get<boolean>('showLanding', false);
  /** Aim trainer: each target's bounces and window of working angles. */
  let aimHints = store.get<boolean>('aimHints', true);
  const listOffsets: [number, number] = [0, 0];
  /** Aim keys held, repeating 20 times a second after 300ms. */
  const held = { left: 0, right: 0, leftNext: 0, rightNext: 0, fine: false };
  /** Presses originating on the board. In fights a held press carries into the next turn. */
  const firing = new Map<number, number>();
  /** Fire keys held, so a key's repeat doesn't press again. */
  const keysDown = new Set<number>();
  let lastMouse: [number, number] = [-1, -1];

  const settingsKey = () => `rumble:${JSON.stringify([settings.enemyRoster, settings.allyRoster, settings.ai, settings.rules,
    settings.oneFisted, settings.werewolf, settings.rumless, settings.damageLevel, settings.startRows, settings.bludgeon])}`;
  const record = store.get<Record<string, { wins: number; losses: number; best: number }>>('record', {});

  const seedMode = seedControls(panel, store, () => running || !!replays?.isPlaying);

  function start(seed?: number, as: Mode = mode): void {
    rumbleAudio.sync(null);
    paintedGloves.clear();
    pause.resume();
    const s = seed ?? seedMode.next(); seedMode.remember(s);
    startedMode = as;
    if (seed === undefined && as !== 'Create') replays.begin({ ...structuredClone(settings), ...(as === 'Aim trainer' ? { aimTrainer: AIM_REPLAY_VERSION, aimDifficulty } : {}) }, { seed: s });
    const now = ticks();
    messages = [];
    listOffsets[0] = listOffsets[1] = 0;
    held.left = held.right = 0;
    held.fine = false;
    firing.clear();
    keysDown.clear();
    lastMouse = [-1, -1];
    const fightSettings = as === 'Aim trainer'
      ? { ...structuredClone(settings), enemyRoster: [], allyRoster: [], startRows: 0, oneFisted: false, werewolf: false, rumless: false, damageLevel: 0 }
      : as === 'Create' ? { ...structuredClone(settings), enemyRoster: [], allyRoster: [], startRows: 0 } : structuredClone(settings);
    match = new Match(fightSettings, s, now, {
      sound: (name, fighter) => {
        if (fighter !== 0) return;
        if (name === 'game_over') quietGrowl();
        play(name);
      },
      message: (text, fighter) => {
        if (fighter === 0) messages.push({ text, start: ticks(), ms: text.includes('knocked') ? 3000 : text.startsWith('Ye') ? Infinity : MESSAGE_MS });
      },
    });
    running = true;
    finished = false;
    showResults = false;
    startedAt = now;
    aim = as === 'Aim trainer' ? new AimTrainer(match.player, s, now, play, aimDifficulty) : null;
    if (as === 'Create') startCreate();
    play('game_start');
    quietGrowl();
    if (match.settings.werewolf) stopGrowl = sounds.loop('werewolf_growl');
  }

  function outcome(): string {
    if (!match) return '';
    if (aiming()) return aim?.result ?? 'Stopped';
    if (!settings.enemyRoster.length) return 'Knocked out';
    if (match.result === 'won') return 'Victory';
    if (match.result === 'lost') return 'Defeat';
    return 'Stopped';
  }

  const damageSent = (f: Fighter) => f.stats.punchSquares + f.stats.sprinkleSent;

  function stop(): void {
    if (!match || !running) return;
    rumbleAudio.sync(null);
    const now = ticks();
    if (aiming() && aim) {
      aim.finish('Stopped', now);
      const tape = replays.finish(aim.result!);
      if (aim.result !== 'Stopped' && !replays.isPlaying) {
        store.addHistory(aimHistory(), {
          score: aim.score, result: aim.result!, shots: aim.shots, lives: aim.lives, difficulty: aim.difficulty,
          ms: Math.round(aim.endedAt! - startedAt),
          ...(tape ? { replayAt: tape.at, replayId: tape.runId ?? '' } : {}),
        });
      }
      match.endedAt = aim.endedAt!;
      running = false;
      finished = showResults = true;
      play('game_over');
      return;
    }
    const completed = !!match.result;
    const f = match.player;
    const finishedReplay = startedMode === 'Fight' ? replays.finish(outcome()) : null;
    if (store.scoresEnabled && completed && !replays.isPlaying && startedMode === 'Fight') {
      store.addHistory(settingsKey(), {
        score: damageSent(f),
        result: outcome(),
        won: match.result === 'won' ? 1 : 0,
        ms: Math.round((match.endedAt || now) - startedAt),
        received: f.stats.received,
        largestReceived: f.stats.largestReceived,
        shots: f.stats.shots,
        punches: f.stats.punches,
        bestChain: f.stats.bestChain,
        ...(finishedReplay ? { replayAt: finishedReplay.at, replayId: finishedReplay.runId ?? '' } : {}),
      });
      const r = record[settingsKey()] ?? { wins: 0, losses: 0, best: 0 };
      if (settings.enemyRoster.length) {
        if (match.result === 'won') r.wins++;
        else r.losses++;
      }
      r.best = Math.max(r.best, damageSent(f));
      record[settingsKey()] = r;
      store.set('record', record);
    }
    if (!match.result) match.endedAt = now;
    quietGrowl();
    running = false;
    finished = true;
  }

  // ---- Freeplay mode ----

  const createRng = new Random();
  let undo: BoardSnapshot[] = [];
  /** A board to carry into the next Freeplay start (the werewolf swap restarts with the same board). */
  let carry: BoardSnapshot | null = null;
  let spec: PunchSpec = roll();
  /** The palette's colour: while one is picked, the left button paints it and the right erases. */
  let palette: number | null = null;
  /** A paint key held down paints the cell under the mouse: a colour, or -1 to erase. */
  let paintKey: number | null = null;
  /** The mouse button painting a stroke (1 paints, 3 erases), and the last cell it painted. */
  let stroke = 0;
  let lastPainted = -1;
  /** The board before a stroke, saved for undo once the stroke changes something. */
  let strokeStart: BoardSnapshot | null = null;
  let createMessage = '';
  let punches = 0;
  let destroyed = 0;

  const createBoard = (): Board | null => (creating() ? match!.player.board : null);

  function choices(): PunchChoices {
    return {
      bludgeon: create.bludgeon < 0 ? null : create.bludgeon,
      colours: create.randomColours ? null : create.colours,
      size: create.randomSize ? null : { length: create.length, width: create.width },
      side: create.side,
      bruises: create.bruises,
    };
  }

  function roll(): PunchSpec {
    return rollPunch(createRng, choices());
  }

  /** Re-rolls after a choice changes, so the preview always shows what lands next. */
  function rechoose(): void {
    saveCreate();
    spec = roll();
  }

  const createGlove = () => new SimGlove(spec.bludgeon, spec.colours, settings.werewolf);

  /** The board can be changed: between shots, with nothing landing on it. */
  function editable(): boolean {
    if (!running || !creating() || pause.paused || replays?.isPlaying) return false;
    const f = match!.player;
    return f.phase === 'control' && !f.punch && !f.sprinkle && !f.flight;
  }

  function startCreate(): void {
    const f = match!.player;
    f.sandbox.endless = true;
    f.sandbox.shotTimer = create.shotTimer;
    f.sandbox.drops = create.drops;
    if (carry) restoreBoard(f.board, carry);
    else {
      dealInto(f.board, createRng, create.rows, create.density, settings.werewolf);
      undo = [];
      punches = destroyed = 0;
      createMessage = `Dealt ${ballCount(f.board)} balls.`;
    }
    carry = null;
    palette = paintKey = null;
    stroke = 0;
    strokeStart = null;
    spec = roll();
  }

  function remember(): void {
    const b = createBoard();
    if (!b) return;
    undo.push(snapshotBoard(b));
    if (undo.length > UNDO_LIMIT) undo.shift();
  }

  /** After any edit: charged balls are the board's sparks, and the shot timer starts over. */
  function edited(): void {
    const b = createBoard()!;
    resetSparks(b);
    match!.player.edited(ticks());
  }

  function deal(): void {
    if (!editable()) return;
    remember();
    const b = createBoard()!;
    dealInto(b, createRng, create.rows, create.density, settings.werewolf);
    edited();
    createMessage = `Dealt ${ballCount(b)} balls.`;
  }

  function clearBoard(): void {
    if (!editable()) return;
    remember();
    dealInto(createBoard()!, createRng, 0, 0, settings.werewolf);
    edited();
    createMessage = 'Board cleared.';
  }

  function undoLast(): void {
    if (!editable()) return;
    const last = undo.pop();
    if (!last) return;
    restoreBoard(createBoard()!, last);
    edited();
    createMessage = 'Undone.';
  }

  function dropFloating(): void {
    if (!editable()) return;
    const b = createBoard()!;
    const loose = floating(b);
    if (!loose.length) {
      createMessage = 'Nothing is floating.';
      return;
    }
    remember();
    for (const p of loose) b.set(p, EMPTY);
    edited();
    createMessage = `Dropped ${loose.length} floating ball${loose.length === 1 ? '' : 's'}.`;
  }

  /** Werewolf rumbling changes the fists' balls too, so Freeplay starts again on the same board, its oranges swapped. */
  function setWerewolf(on: boolean): void {
    settings.werewolf = on;
    save();
    if (!running || !creating()) return;
    const snapshot = snapshotBoard(match!.player.board);
    convertSnapshot(snapshot, on);
    for (const u of undo) convertSnapshot(u, on);
    if (strokeStart) convertSnapshot(strokeStart, on);
    carry = snapshot;
    start(undefined, 'Create');
  }

  function land(): void {
    if (!editable()) {
      if (running && creating()) createMessage = 'Wait for the board to settle before punching.';
      return;
    }
    const f = match!.player;
    const before = snapshotBoard(f.board);
    const punch = f.strikeNow(shaftOf(spec), createGlove(), ticks());
    if (!punch) return;
    undo.push(before);
    if (undo.length > UNDO_LIMIT) undo.shift();
    const lost = punch.result.columns.reduce((n, c) => n + c.destroyed.length, 0);
    punches++;
    destroyed += lost;
    createMessage = `${describe(spec)} landed${lost ? `, destroying ${lost} ball${lost === 1 ? '' : 's'}` : ''}.`;
    if (f.board.isDead()) createMessage += ' In a fight that would knock ye out.';
    spec = roll();
  }

  function describe(p: PunchSpec): string {
    return `${p.length}x${p.width} ${gloveName(p.bludgeon)} from the ${p.side === 1 ? 'left' : 'right'}`;
  }

  interface Preview {
    key: string;
    board: Board;
    /** Cells holding the punch's own balls once it has landed. */
    landed: Set<number>;
    destroyed: number;
  }
  let previewCache: Preview | null = null;

  /**
   * The next punch landed on a copy of the board. The random numbers it uses (where bruises go)
   * are put back afterwards, so the real punch lands exactly as previewed.
   */
  function preview(b: Board): Preview {
    const k = `${b.cells.join(',')}|${b.topLarge}|${JSON.stringify(spec)}|${settings.werewolf}`;
    if (previewCache?.key === k) return previewCache;
    const state = b.alt.snapshot();
    const copy = b.clone();
    const result = copy.punch(shaftOf(spec), createGlove());
    b.alt.restore(state);
    const landed = new Set<number>();
    for (const column of result.columns) {
      for (const move of column.moves) if (move.from < 0) landed.add(cellKey(column.cells[move.to]));
    }
    previewCache = { key: k, board: copy, landed, destroyed: result.columns.reduce((n, c) => n + c.destroyed.length, 0) };
    return previewCache;
  }

  // The bludgeon viewer: werewolf punches by bludgeon (1), punch type (2) and furball slot (3), on an empty board.
  const viewer = { on: false, bludgeon: 0, kind: 0, slot: 0 };
  let viewerCache: { key: string; board: Board } | null = null;
  /** Where the bruises go: a new seed each time the furball colour slot changes, or on a reshuffle. */
  let viewerSeed = 1;
  const reshuffle = () => { viewerSeed = createRng.integer(1, 2 ** 31 - 1); };
  const viewerType = () => SIM_BLUDGEONS[viewer.bludgeon];
  const wrap = (value: number, n: number) => ((value % n) + n) % n;
  const viewing = () => viewer.on && creating();

  function viewerShown(): Board {
    const k = `${viewer.bludgeon}|${viewer.kind}|${viewer.slot}|${viewerSeed}`;
    if (viewerCache?.key !== k) viewerCache = { key: k, board: viewerBoard(viewerType(), viewer.kind, viewer.slot, viewerSeed) };
    return viewerCache.board;
  }

  /** Changing the bludgeon starts its punch type and furball slot over. */
  function stepBludgeon(by: number): void {
    viewer.bludgeon = wrap(viewer.bludgeon + by, SIM_BLUDGEONS.length);
    viewer.kind = 0;
    viewer.slot = 0;
  }
  const stepKind = (by: number) => { viewer.kind = wrap(viewer.kind + by, VIEWER_KINDS.length); };
  /** A new colour slot also moves the bruises. */
  function stepSlot(by: number): void {
    viewer.slot = wrap(viewer.slot + by, furballSlots(viewerType()));
    reshuffle();
  }

  function viewerLines(): string[] {
    const type = viewerType();
    const kind = VIEWER_KINDS[viewer.kind];
    const slots = furballSlots(type);
    return [
      `1. ${gloveName(type)} (${viewer.bludgeon + 1}/${SIM_BLUDGEONS.length})`,
      `2. ${kind.label}${kind.bruised ? ` (${viewerBruises(kind.length, kind.width)} bruises)` : ''} (${viewer.kind + 1}/${VIEWER_KINDS.length})`,
      slots > 1
        ? `3. Furball in colour slot ${viewer.slot + 1} (${viewer.slot + 1}/${slots}), colours ${furballColours(type, viewer.slot)}`
        : '3. Fixed colours (1/1)',
    ];
  }

  function hoveredCell(): Point | null {
    const b = createBoard();
    if (!b) return null;
    const [mx, my] = input.mouse;
    if (!onBoard(mx, my)) return null;
    const cell = b.cellAt(mx - BOARD_X, my - BOARD_Y);
    return b.valid(cell) ? cell : null;
  }

  /** Changes the ball under the mouse; a stroke's changes undo together. */
  function editCell(change: (piece: number) => number, inStroke = false): void {
    const cell = hoveredCell();
    if (!cell || !editable()) return;
    const b = createBoard()!;
    const before = b.get(cell);
    const after = change(before);
    if (after === before) return;
    if (!inStroke) remember();
    else if (strokeStart) {
      undo.push(strokeStart);
      if (undo.length > UNDO_LIMIT) undo.shift();
      strokeStart = null;
    }
    b.set(cell, after);
    edited();
  }

  const paintPiece = (colour: number) => (colour < 0 ? EMPTY : werewolfPiece(ball(colour), settings.werewolf));

  /** Paints the cell under the mouse once per cell as a stroke or a held key moves over it. */
  function paintAtMouse(colour: number, inStroke: boolean): void {
    const cell = hoveredCell();
    if (!cell) return;
    const k = cellKey(cell);
    if (k === lastPainted) return;
    lastPainted = k;
    editCell(() => paintPiece(colour), inStroke);
  }

  function cycleBruise(piece: number): number {
    if (!isBall(piece)) return piece;
    if (isDark(piece)) return light(piece);
    if (isLight(piece)) return plain(piece);
    return dark(piece);
  }

  /** The wheel turns the ball under the mouse to the next colour, as Distilling's does its pieces. */
  function cycleColour(piece: number, step: number): number {
    if (!isBall(piece)) return piece;
    const colour = colourOf(piece) === FURBALL ? ORANGE : colourOf(piece);
    return werewolfPiece(recolour(piece, (colour + step + 5) % 5), settings.werewolf);
  }

  /** Freeplay mode's keys and painting: true if it used the event. */
  function createInput(event: InputEvent): boolean {
    if (!creating()) return false;
    if (viewer.on) {
      if (event.type === 'keydown') {
        const k = event.key;
        if (k === 'arrowleft' || k === 'arrowright') stepBludgeon(k === 'arrowleft' ? -1 : 1);
        else if (k === 'arrowup' || k === 'arrowdown') stepKind(k === 'arrowup' ? -1 : 1);
        else if (k === 'a' || k === 's') stepSlot(k === 'a' ? -1 : 1);
        else if (k === 'r') reshuffle();
      }
      // The viewer covers the board, so nothing reaches the game while it's open.
      return event.type === 'keydown' || event.type === 'keyup' || event.type === 'mousedown' || event.type === 'mouseup';
    }
    if (event.type === 'keydown') {
      const paint = PAINT_NAMES.findIndex((_, i) => key(event.key, `paint${i + 1}`));
      if (paint >= 0 || key(event.key, 'erase')) {
        paintKey = paint >= 0 ? paint : -1;
        lastPainted = -1;
        paintAtMouse(paintKey, false);
      } else if (key(event.key, 'charge')) editCell((p) => (isBall(p) ? (isCharged(p) ? plain(p) : charged(plain(p))) : p));
      else if (key(event.key, 'bruise')) editCell(cycleBruise);
      else if (key(event.key, 'punch')) land();
      else if (key(event.key, 'roll')) spec = roll();
      else if (key(event.key, 'deal')) deal();
      else if (key(event.key, 'undo')) undoLast();
      else if (key(event.key, 'preview')) { create.previewOnBoard = !create.previewOnBoard; saveCreate(); }
      else return false;
      return true;
    }
    if (event.type === 'keyup') {
      const paint = PAINT_NAMES.findIndex((_, i) => key(event.key, `paint${i + 1}`));
      if (paint >= 0 || key(event.key, 'erase')) {
        paintKey = null;
        return true;
      }
      return false;
    }
    if (event.type !== 'mousedown' && event.type !== 'mouseup') return false;
    const [mx, my] = event.pos;
    if (event.type === 'mousedown' && (event.button === 4 || event.button === 5) && onBoard(mx, my)) {
      editCell((p) => cycleColour(p, event.button === 4 ? 1 : -1));
      return true;
    }
    if (palette === null) return false;
    if (event.type === 'mousedown' && (event.button === 1 || event.button === 3) && onBoard(mx, my)) {
      const b = createBoard()!;
      strokeStart = snapshotBoard(b);
      stroke = event.button;
      lastPainted = -1;
      paintAtMouse(stroke === 3 ? -1 : palette, true);
      return true;
    }
    if (event.type === 'mouseup' && event.button === stroke) {
      stroke = 0;
      strokeStart = null;
      return true;
    }
    return event.type === 'mousedown' || event.type === 'mouseup';
  }

  /** Strokes and held keys keep painting as the mouse moves. */
  function createPaint(): void {
    if (!creating() || viewer.on) return;
    if (stroke && palette !== null) paintAtMouse(stroke === 3 ? -1 : palette, true);
    else if (paintKey !== null) paintAtMouse(paintKey, false);
  }

  // ---- Input ----

  const listX = (side: 0 | 1) => (side === 0 ? LEFT_X : RIGHT_X);

  function scrollList(event: InputEvent): boolean {
    if (!match || event.type !== 'mousedown') return false;
    const [x, y] = event.pos;
    const side = x >= LEFT_X && x < LEFT_X + LIST_W ? 0 : x >= RIGHT_X && x < RIGHT_X + LIST_W ? 1 : -1;
    if (side < 0) return false;
    const at = side as 0 | 1;
    if (match.rows[at].length <= VISIBLE_ROWS) return false;
    let delta = 0;
    if (y >= ROWS_Y && (event.button === 4 || event.button === 5)) delta = event.button === 4 ? -1 : 1;
    else if (event.button === 1 && y >= SCROLL_Y && y < SCROLL_Y + 14) {
      const localX = x - listX(at) - 10;
      if (localX >= 0 && localX < 34) delta = -1;
      else if (localX >= 35 && localX < 69) delta = 1;
    }
    if (!delta) return false;
    listOffsets[at] = Math.max(0, Math.min(match.rows[at].length - VISIBLE_ROWS, listOffsets[at] + delta));
    if (pause.paused) replays.command(`list-scroll:${at}:${listOffsets[at]}`);
    return true;
  }

  const onBoard = (x: number, y: number) => x >= BOARD_X && x < BOARD_X + VIEW_W && y >= BOARD_Y && y < BOARD_Y + VIEW_H;
  /** With one fist, either button fires it. */
  const fistFor = (f: Fighter, which: number) => (f.fists === 1 ? 0 : which);

  const canPress = (f: Fighter, fist: number) => aiming() ? !!aim?.canFire(fist) : !f.out && !f.halted;
  function press(f: Fighter, fist: number, now: number): void {
    firing.set(fist, f.controlAt);
    if (!aiming()) f.press(fist, now);
  }
  function release(f: Fighter, fist: number, now: number): void {
    if (aiming()) aim!.fire(fist, now);
    else f.release(fist, now);
  }

  function handle(events: InputEvent[], now: number): void {
    if (!match) return;
    const f = match.player;
    for (const event of events) {
      if (scrollList(event) || !running || match.result || createInput(event)) continue;
      if (event.type === 'keydown') {
        if (key(event.key, 'left')) { f.rotate(held.fine ? FINE_STEP : ROTATE_STEP); held.left = now; held.leftNext = now + 300; }
        else if (key(event.key, 'right')) { f.rotate(-(held.fine ? FINE_STEP : ROTATE_STEP)); held.right = now; held.rightNext = now + 300; }
        else if (key(event.key, 'fine')) held.fine = true;
        else if (key(event.key, 'fireL') || key(event.key, 'fireR')) {
          const fist = fistFor(f, key(event.key, 'fireL') ? 0 : 1);
          if (!keysDown.has(fist)) { keysDown.add(fist); if (canPress(f, fist)) press(f, fist, now); }
        } else if (key(event.key, 'next')) match.cycleTarget(1);
        else if (key(event.key, 'prev')) match.cycleTarget(-1);
      } else if (event.type === 'keyup') {
        if (key(event.key, 'left')) held.left = 0;
        else if (key(event.key, 'right')) held.right = 0;
        else if (key(event.key, 'fine')) held.fine = false;
        else if (key(event.key, 'fireL') || key(event.key, 'fireR')) {
          const fist = fistFor(f, key(event.key, 'fireL') ? 0 : 1);
          keysDown.delete(fist);
          if (firing.has(fist) && (!aiming() || firing.get(fist) === f.controlAt)) release(f, fist, now);
          firing.delete(fist);
        }
      } else if (event.type === 'mousedown' && (event.button === 1 || event.button === 3)) {
        const [mx, my] = event.pos;
        if (onBoard(mx, my)) {
          f.aimAt(mx - BOARD_X, my - BOARD_Y);
          const fist = fistFor(f, event.button === 1 ? 0 : 1);
          if (canPress(f, fist)) press(f, fist, now);
        } else if (event.button === 1) {
          // Clicking a pirate's status targets them: an enemy to attack, a teammate to defend.
          for (const side of [0, 1] as const) {
            if (mx < listX(side) || mx >= listX(side) + LIST_W) continue;
            const row = Math.floor((my - ROWS_Y) / ROW_H);
            const list = match.rows[side];
            if (my >= ROWS_Y && row < VISIBLE_ROWS && row + listOffsets[side] < list.length) match.setTarget(list[row + listOffsets[side]]);
          }
        }
      } else if (event.type === 'mouseup' && (event.button === 1 || event.button === 3)) {
        const fist = fistFor(f, event.button === 1 ? 0 : 1);
        const turn = firing.get(fist);
        firing.delete(fist);
        if (turn !== undefined && (!aiming() || turn === f.controlAt)) {
          const [mx, my] = event.pos;
          if (onBoard(mx, my)) f.aimAt(mx - BOARD_X, my - BOARD_Y);
          release(f, fist, now);
        }
      }
    }
    if (!running || match.result) return;
    createPaint();
    // The mouse aims both fists whenever it moves over the board.
    const [mx, my] = input.mouse;
    if ((mx !== lastMouse[0] || my !== lastMouse[1]) && onBoard(mx, my)) f.aimAt(mx - BOARD_X, my - BOARD_Y);
    lastMouse = [mx, my];
    for (const side of ['left', 'right'] as const) {
      const next = side === 'left' ? 'leftNext' : 'rightNext';
      while (held[side] && now >= held[next]) {
        const step = held.fine ? FINE_STEP : ROTATE_STEP;
        f.rotate(side === 'left' ? step : -step);
        held[next] += 50;
      }
    }
  }

  // ---- Drawing ----

  function drawAimTargets(): void {
    for (const [i, target] of [aim!.current, aim!.next].entries()) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = i === 0 ? 2 : 1;
      if (i === 1) ctx.setLineDash([3, 3]);
      for (const p of target.cells) {
        const at = match!.player.board.pixel(p);
        ctx.beginPath();
        ctx.arc(at.x + 15, at.y + 15, 14, 0, Math.PI * 2);
        ctx.stroke();
      }
      const at = match!.player.board.pixel(target.cells[0]);
      drawGameText(ctx, String(i + 1), at.x + 15, at.y + 6, { px: 13, family: 'dialog', bold: true, align: 'center' });
      ctx.restore();
    }
  }

  function drawAimStatus(now: number): void {
    const t = aim!;
    ctx.save();
    // Score, lives and time are in the side panel; the board shows only the two targets.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(367, 48, 80, 288);
    const label = (text: string, x: number, y: number, px = 13, fill = '#fff') =>
      drawGameText(ctx, text, x, y, { px, family: 'dialog', align: 'center', fill });
    const target = (item: AimTarget, y: number, title: string) => {
      label(title, 407, y, 11);
      drawBall(ball(item.colour), 392, y + 22, now);
      label(item.fist === 0 ? 'Left hand' : 'Right hand', 407, y + 59, 11);
      label(item.difficulty, 407, y + 79, 11, '#ffffaa');
      if (!aimHints) return;
      // The easiest route: its bounces, and how wide its window of working angles is.
      const route = item.routes[0];
      label(route.bounces ? `${route.bounces} bounce${route.bounces > 1 ? 's' : ''}` : 'Direct', 407, y + 95, 10, '#ccc');
      label(`${(route.hi - route.lo + 1) / DIR_PREC}° window`, 407, y + 109, 10, '#ccc');
    };
    target(t.current, 60, '1 · NOW');
    target(t.next, 203, '2 · NEXT');
    if (now - t.feedbackAt < 1200 && (!t.result || t.landing)) {
      drawGameText(ctx, t.feedback, BOARD_X + VIEW_W / 2, BOARD_Y + 380, { px: 18, align: 'center' });
    }
    ctx.restore();
  }

  /** A ball's art and frame: balls 0 plain, 2 dark bruise, 3 light, 4 arriving; charged sparkle every 125ms. */
  function drawBall(piece: number, x: number, y: number, now: number, alpha = 1): void {
    if (piece === EMPTY || piece < 0) return;
    const name = COLOUR_NAMES[colourOf(piece)];
    if (!name) return;
    ctx.globalAlpha = alpha;
    if (isCharged(piece)) {
      ctx.drawImage(img(`charged_${name}`), (Math.floor(now / 125) % 4) * BALL, 0, BALL, BALL, Math.round(x), Math.round(y), BALL, BALL);
      ctx.drawImage(img('aura_white'), (Math.floor(now / 100) % 10) * 40, 0, 40, 40, Math.round(x) - 5, Math.round(y) - 5, 40, 40);
    } else {
      const frame = isDark(piece) ? 2 : isLight(piece) ? 3 : isArriving(piece) ? 4 : 0;
      ctx.drawImage(img(`balls-${name}`), frame * BALL, 0, BALL, BALL, Math.round(x), Math.round(y), BALL, BALL);
    }
    ctx.globalAlpha = 1;
  }

  function tile(image: HTMLImageElement, sx: number, sw: number, sh: number, x: number, y: number, w: number, h: number): void {
    for (let ty = y; ty < y + h; ty += sh) {
      for (let tx = x; tx < x + w; tx += sw) {
        const cw = Math.min(sw, x + w - tx);
        const ch = Math.min(sh, y + h - ty);
        ctx.drawImage(image, sx, 0, cw, ch, tx, ty, cw, ch);
      }
    }
  }

  /** Landing spots, worked out again only when the aim or board changes. */
  let landingKey = '';
  let landing: Array<Point | null> = [];

  function drawBoard(f: Fighter, now: number): void {
    const b = f.board;
    ctx.save();
    ctx.translate(BOARD_X, BOARD_Y);
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();
    // Damage rows: stone, with the skull ledge on the last.
    if (b.damage > 0) {
      const damage = img('damage');
      if (b.damage > 1) tile(damage, 0, 88, 23, 1, 1, VIEW_W - 2, (b.damage - 1) * STEP_Y);
      tile(damage, 88, 88, 23, 1, (b.damage - 1) * STEP_Y + 1, VIEW_W - 2, 23);
    }
    // The board slides down a row as it drops.
    const slide = Math.round(-STEP_Y * (1 - f.dropProgress(now)));
    const shaking = (b.shots === 6 || b.shots === 7) && !f.out;
    const shakeFrame = f.shakeFrame(now);
    const hidden = new Set<number>();
    const punch = f.punch;
    if (punch) {
      for (const column of punch.result.columns) for (const cell of column.cells) hidden.add(cellKey(cell));
    }
    const sprinkle = f.sprinkle;
    if (sprinkle) for (const ball of sprinkle.balls) hidden.add(cellKey(ball.cell));
    // Freeplay mode can show the bludgeon viewer instead, or the next punch landed on the board.
    if (viewing()) {
      drawCreateBoard(viewerShown(), now);
      ctx.restore();
      return;
    }
    const view = creating() && create.previewOnBoard && editable() ? preview(b) : null;
    const shown = view?.board ?? b;
    for (let y = shown.damage; y < H; y++) {
      for (let x = 0; x < shown.width(y); x++) {
        const p = { x, y };
        const piece = shown.get(p);
        if (piece === EMPTY || piece === BLOCKED || hidden.has(cellKey(p))) continue;
        const at = shown.pixel(p);
        const nudge = shaking ? SHAKE[(shakeFrame + (x + 1) * y) % SHAKE.length] : SHAKE[0];
        drawBall(piece, at.x + nudge.x, at.y + nudge.y + slide, now, view && !view.landed.has(cellKey(p)) ? 0.4 : 1);
        if (creating() && create.showNumbers) colourNumber(piece, at.x + nudge.x, at.y + nudge.y + slide);
      }
    }
    if (creating()) drawPainting();
    if (aiming() && aim) drawAimTargets();
    if (punch) drawPunch(f, now);
    if (sprinkle) {
      for (const ball of sprinkle.balls) {
        const at = b.pixel(ball.cell);
        const from = (H + 1 + ball.depth) * STEP_Y;
        const y = Math.max(at.y, from - (now - sprinkle.start) / 0.6);
        drawBall(ball.piece, at.x, y, now);
      }
    }
    // Pops: each ball's five explosion frames at 24 a second.
    for (const pop of f.pops) {
      if (now < pop.at) {
        const at = b.pixel(pop.cell);
        drawBall(pop.piece, at.x, at.y, now);
        continue;
      }
      const frame = Math.floor((now - pop.at) * 24 / 1000);
      const name = COLOUR_NAMES[colourOf(pop.piece)];
      if (frame < 5 && name) {
        const at = b.pixel(pop.cell);
        ctx.drawImage(img(`explode_${name}`), frame * BALL, 0, BALL, BALL, at.x, at.y, BALL, BALL);
      }
    }
    for (const g of f.grapes) {
      const t = Math.max(0, now - g.start);
      drawBall(g.piece, g.x, g.y + g.distance * Math.min(1, t / g.ms), now);
    }
    if (f.flight) {
      const at = flightAt(f, now);
      drawBall(f.flight.piece, at.x - 15, at.y - 15, now);
    }
    if (aiming() && aim?.landing) {
      const landed = aim.landing;
      const at = b.pixel(landed.cell);
      drawBall(landed.piece, at.x, at.y, now);
      ctx.save();
      ctx.strokeStyle = landed.hit ? '#8bff9c' : '#ff7777';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at.x + 15, at.y + 15, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    drawFists(f, now);
    drawWarnings(f, now);
    drawShouts(f, now);
    drawPunchHits(f, now);
    if (f.rumless) ctx.drawImage(img('rumless_icon'), 90, 475);
    if (f.out) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    drawMessages(now);
    ctx.restore();
  }

  const cellKey = (p: Point) => p.y * W + p.x;

  /** The bludgeon viewer's board: just its balls. */
  function drawCreateBoard(b: Board, now: number): void {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < b.width(y); x++) {
        const piece = b.get({ x, y });
        if (piece === EMPTY || piece === BLOCKED) continue;
        const at = b.pixel({ x, y });
        drawBall(piece, at.x, at.y, now);
        if (create.showNumbers) colourNumber(piece, at.x, at.y);
      }
    }
  }

  /** The colour's paint key over a ball: 1 red, 2 yellow, 3 orange or furball, 4 cyan, 5 blue. */
  function colourNumber(piece: number, x: number, y: number): void {
    if (!isBall(piece)) return;
    const colour = colourOf(piece);
    const digit = String((colour === FURBALL ? ORANGE : colour) + 1);
    ctx.save();
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.strokeText(digit, x + BALL / 2, y + BALL / 2 + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(digit, x + BALL / 2, y + BALL / 2 + 1);
    ctx.restore();
  }

  /** While painting, a ring marks the cell under the mouse. */
  function drawPainting(): void {
    if (palette === null && paintKey === null) return;
    const cell = editable() ? hoveredCell() : null;
    if (!cell) return;
    const at = match!.player.board.pixel(cell);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(at.x + BALL / 2, at.y + BALL / 2, BALL / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  function flightAt(f: Fighter, now: number): Point {
    const fl = f.flight!;
    let prev = fl.start;
    for (let i = 1; i < fl.points.length; i++) {
      const end = fl.times[i - 1];
      if (now <= end || i === fl.points.length - 1) {
        const t = end > prev ? Math.min(1, Math.max(0, (now - prev) / (end - prev))) : 1;
        const a = fl.points[i - 1];
        const b = fl.points[i];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      prev = end;
    }
    return fl.points[fl.points.length - 1];
  }

  /**
   * A punch slides in along its diagonal, everything in a column moving together: each ball waits
   * where it is until the column reaches it, then moves with it to where it ends up.
   */
  function drawPunch(f: Fighter, now: number): void {
    const punch = f.punch!;
    const b = f.board;
    const t = (now - punch.start) / PUNCH_STEP_MS;
    punch.result.columns.forEach((column) => {
      const cells = column.cells.map((p) => b.pixel(p));
      if (!cells.length) return;
      const step = cells.length > 1 ? { x: cells[1].x - cells[0].x, y: cells[1].y - cells[0].y } : { x: punch.side === 1 ? 13 : -13, y: STEP_Y };
      const at = (i: number): Point => {
        if (i <= 0) return { x: cells[0].x + step.x * i, y: cells[0].y + step.y * i };
        const lo = Math.min(Math.floor(i), cells.length - 1);
        const hi = Math.min(lo + 1, cells.length - 1);
        const r = i - Math.floor(i);
        return { x: cells[lo].x + (cells[hi].x - cells[lo].x) * r, y: cells[lo].y + (cells[hi].y - cells[lo].y) * r };
      };
      for (const move of column.moves) {
        const pos = punchPosition(move, t);
        const p = at(pos);
        drawBall(move.piece, p.x, p.y, now);
      }
      for (const d of column.destroyed) {
        const frame = Math.floor((now - (punch.start + d.step * PUNCH_STEP_MS)) * 24 / 1000);
        const name = COLOUR_NAMES[colourOf(d.piece)];
        const p = cells[d.at];
        if (frame < 0) { drawBall(d.piece, p.x, p.y, now); continue; }
        if (frame >= 5 || !name) continue;
        ctx.drawImage(img(`explode_${name}`), frame * BALL, 0, BALL, BALL, p.x, p.y, BALL, BALL);
      }
    });
  }

  function drawPunchHits(f: Fighter, now: number): void {
    // Keep wall impacts visible even when the moving balls have already settled.
    for (const { side, row, at } of f.punchHits) {
      drawImpact(ctx, img('fist_hit'), fistHighlight, side, row, now - at);
    }
  }

  function drawFists(f: Fighter, now: number): void {
    const b = f.board;
    const control = f.phase === 'control' && !f.out;
    // Where each ball would land, if asked for.
    if (showLanding && control) {
      const k = `${f.dir.join()}:${b.cells.join()}:${b.topLarge}`;
      if (k !== landingKey) {
        landingKey = k;
        landing = b.origins.map((_, fist) => b.shoot(b.path(fist, f.dir[fist]))?.rest ?? null);
      }
      landing.forEach((p, fist) => {
        if (!p || f.hand[fist] === EMPTY || (aiming() && fist !== aim!.current.fist)) return;
        const at = b.pixel(p);
        drawBall(f.hand[fist], at.x, at.y, now, 0.5);
      });
    }
    const late = control && f.sandbox.shotTimer && now - f.controlAt >= WARN_MS;
    b.origins.forEach((o, fist) => {
      const frame = f.fists === 1 ? 1 : fist;
      // The trainer keeps the fired colour until the next target is promoted. In a fight,
      // an empty fist shows its next ball instead.
      const inactive = aiming() && fist !== aim!.current.fist;
      const next = aiming() ? (fist === aim!.next.fist ? ball(aim!.next.colour) : dark(ball(0))) : b.peek(fist);
      const name = COLOUR_NAMES[aiming() && !inactive ? aim!.current.colour : colourOf(f.hand[fist] !== EMPTY ? f.hand[fist] : next)];
      let wobble = { x: 0, y: 0 };
      if (f.rumless) wobble = { x: Math.round(Math.sin(now / 300 * Math.PI) * 1.5), y: Math.round(Math.cos(now / 300 * Math.PI) * 1.5) };
      const previewX = o.x + (frame === 0 ? 1 : -1) * BALL - 15;
      ctx.save();
      if (aiming() && fist !== aim!.next.fist) ctx.filter = 'grayscale(1) brightness(0.6)';
      drawBall(next, previewX, aiming() ? VIEW_H - 40 : VIEW_H - 15, now);
      ctx.restore();
      if (aiming() && fist === aim!.next.fist) drawGameText(ctx, '2', previewX + 15, VIEW_H - 33, { px: 12, family: 'dialog', bold: true, align: 'center' });
      ctx.save();
      if (inactive) ctx.filter = 'grayscale(1) brightness(0.6)';
      if (name) ctx.drawImage(img(`longfist_${name}`), frame * 41, 0, 41, 80, o.x - 21 + wobble.x, o.y - 21 + wobble.y, 41, 80);
      const piece = f.hand[fist];
      if (piece !== EMPTY && (control || f.phase !== 'out')) {
        const at = ballInFist(o, f.dir[fist]);
        const shake = late ? { x: (Math.floor(now / 50) % 2), y: (Math.floor(now / 50 + 1) % 2) } : { x: 0, y: 0 };
        const shown = f.charging === fist && f.chargedHand ? charged(piece) : piece;
        drawBall(shown, at.x - 15 + shake.x, at.y - 15 + shake.y, now);
        if (f.charging === fist && !f.chargedHand) {
          const frame7 = Math.floor((now - f.chargeStart) * 15 / 1000) % 7;
          ctx.drawImage(img('charge_anim'), frame7 * 50, 0, 50, 50, at.x - 25, at.y - 25, 50, 50);
        }
        if (f.charging === fist && f.chargedHand) {
          const since = now - (f.chargeStart + CHARGE_MS);
          if (since < 200) {
            ctx.globalAlpha = Math.max(0, 1 - since * 0.005);
            ctx.drawImage(img('charge'), at.x - 23, at.y - 23);
            ctx.globalAlpha = 1;
          }
        }
      }
      if (control && !inactive) {
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.rotate((90 - f.dir[fist] / DIR_PREC) * Math.PI / 180);
        const pointer = img('pointer');
        ctx.drawImage(pointer, -Math.floor(pointer.width / 2), -pointer.height);
        ctx.restore();
      }
      ctx.restore();
    });
  }

  /** Incoming strikes' bursts blink every 500ms from the left, right or bottom. */
  function drawWarnings(f: Fighter, now: number): void {
    if (!f.warnings || f.phase !== 'control') return;
    if (Math.floor((now - f.warnAt) / 500) % 2 === 1) return;
    const y = 1 + f.board.damage * STEP_Y;
    if (f.warnings & 2) ctx.drawImage(img('warning_burst_left'), 1, y);
    if (f.warnings & 4) ctx.drawImage(img('warning_burst_right'), VIEW_W - 38 - 1, y);
    if (f.warnings & 8) ctx.drawImage(img('warning_burst_bottom'), Math.floor((VIEW_W - 81) / 2), VIEW_H - 27);
  }

  /** A cosmetic number in [0, 1) that stays the same for a shout on every frame and in replays. */
  function shoutRandom(sh: Shout, salt: number): number {
    let h = (sh.start * 31 + sh.word * 7919 + sh.x * 131 + sh.y * 17 + salt * 104729) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
  }

  /**
   * Combo words in a spinning starburst: 18pt bold Dialog over a 30-point star around the text,
   * filled with a gradient and stroked 2px. It grows from half size in its first 100 ms and spins a
   * few degrees over its life, without fading.
   */
  function drawShouts(f: Fighter, now: number): void {
    for (const sh of f.shouts) {
      if (now < sh.start) continue;
      const age = now - sh.start;
      const [stroke, from, to, fill, halo] = SHOUT_RGB[sh.colour] ?? SHOUT_RGB[0];
      const word = COMBO_WORDS[sh.word];
      const style = { px: 18, family: 'dialog' as const, bold: true, fill, outline: halo, align: 'center' as const };
      const { w, h } = gameTextBox(ctx, word, style);
      const x = Math.max(40, Math.min(VIEW_W - 40, sh.x));
      const angle = (shoutRandom(sh, 1) * 360 + (shoutRandom(sh, 2) * 16 - 9) * Math.min(1, age / sh.ms)) * Math.PI / 180;
      ctx.save();
      ctx.translate(x, sh.y);
      const scale = age < 100 ? 0.5 + age / 200 : 1;
      ctx.scale(scale, scale);
      ctx.save();
      ctx.rotate(angle);
      ctx.beginPath();
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2;
        const grow = i % 2 ? 15 : 8;
        const px = Math.cos(a) * (w / 2 + grow), py = Math.sin(a) * (h / 2 + grow);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, -h / 2 - 15, 0, h / 2 + 15);
      gradient.addColorStop(0, from);
      gradient.addColorStop(1, to);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = stroke;
      ctx.stroke();
      ctx.restore();
      drawGameText(ctx, word, 0, -h / 2, style);
      ctx.restore();
    }
  }

  /** Popups in the 30px game font, wrapped to the board, centred on it and pushed clear of each other. */
  function drawMessages(now: number): void {
    messages = messages.filter((m) => now < m.start + m.ms);
    const style = { px: 30, align: 'center' as const };
    let y: number | null = null;
    for (const m of messages) {
      const text = wrapGameText(ctx, m.text, style, VIEW_W);
      const { h } = gameTextBox(ctx, text, style);
      const { dy, alpha } = floatAt(now - m.start, m.ms);
      if (y === null) y = (VIEW_H - h) / 2;
      drawGameText(ctx, text, VIEW_W / 2, y + dy, { ...style, alpha });
      y += h;
    }
  }

  // ---- Status lists ----

  const faces = new WeakMap<Match, Map<string, HTMLCanvasElement>>();
  function faceOf(m: Match, index: number, out: boolean): HTMLCanvasElement {
    let cache = faces.get(m);
    if (!cache) faces.set(m, (cache = new Map()));
    const pirate = index === 0 ? currentPirate() : null;
    const k = `${index}${out ? 'out' : ''}${pirate ? JSON.stringify(pirate.face) : ''}`;
    let face = cache.get(k);
    if (!face) cache.set(k, (face = pirate ? faceCanvas(pirate.face, out ? 'really_sad' : 'normal')
      : drawFace(m.looks[index], out, (name) => faceImages.get(name))));
    return face;
  }

  /** A centred 10pt Dialog label in the game's outline style (YoFaceLabel). */
  function outlined(text: string, x: number, y: number, colour: string): void {
    drawGameText(ctx, text, x, y - 1, { px: 10, family: 'dialog', fill: colour, align: 'center' });
  }

  /** The glove art over a face: the pirate's bludgeon (werewolf claws for everyone in werewolf rumbling). */
  const paintedGloves = new Map<string, HTMLCanvasElement>();
  function gloveArt(m: Match, index: number): HTMLCanvasElement | null {
    const glove = m.gloves[index];
    const type = glove.type;
    const skin = index === 0 ? currentPirate().face.skin : m.looks[index].colours.skin ?? 'tan';
    const names = settings.werewolf || m.settings.werewolf ? [`glove_werewolf${type}`, `glove${type}`] : [`glove${type}`];
    for (const name of names) {
      if (!gloveImages.has(name)) continue;
      const key = `${name}:${glove.colours}:${skin}`;
      let image = paintedGloves.get(key);
      if (!image) paintedGloves.set(key, image = paintGlove(gloveImages.get(name), glove, skin));
      return image;
    }
    return null;
  }

  /**
   * A pirate's status laid out in 82x80: the name over the top, the face
   * with their bludgeon over it, a small board 24x46 (2px a ball) beside it, the blue defence bar
   * over that on your side while someone defends them, and attacker dots underneath.
   */
  function drawStatus(m: Match, index: number, x: number, y: number, right: boolean): void {
    const f = m.fighters[index];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, LIST_W, ROW_H);
    ctx.clip();
    const faceX = x + (right ? 24 : 0);
    const face = faceOf(m, index, f.out);
    ctx.drawImage(face, faceX + (58 - FACE) / 2, y + 9);
    const glove = gloveArt(m, index);
    if (glove) ctx.drawImage(glove, faceX, y + 9, 58, Math.round(glove.height * 58 / glove.width));
    // The small board.
    const bx = x + (right ? 0 : 58);
    const by = y + 19;
    ctx.fillStyle = f.out ? '#92974a' : '#b1ab92';
    ctx.fillRect(bx, by, 24, 46);
    const b = f.board;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < b.width(r); c++) {
        const piece = b.get({ x: c, y: r });
        if (piece === EMPTY) continue;
        ctx.fillStyle = piece === BLOCKED ? '#555' : f.out ? '#94552a' : showColours ? BALL_RGB[colourOf(piece)] ?? '#9e0b0e' : '#9e0b0e';
        ctx.fillRect(bx + 2 + c * 2 + (b.largeRow(r) ? 0 : 1), by + 2 + r * 2, 2, 2);
      }
    }
    ctx.strokeStyle = index === m.target && !f.out ? '#ffffff' : '#c1b016';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, 23, 45);
    ctx.strokeStyle = '#000';
    ctx.strokeRect(bx + 1.5, by + 1.5, 21, 43);
    // The defence bar.
    if (!right && m.defender(index) >= 0 && m.settings.rules.defence) {
      const halo = m.halo(index);
      const w = Math.floor(halo * 16 / 100) + 4;
      const hx = bx + Math.floor((20 - w) / 2);
      const hy = y + 14;
      ctx.strokeStyle = index === m.target ? '#ffffff' : '#c1b016';
      ctx.strokeRect(hx + 0.5, hy + 0.5, w + 3, 5);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(hx + 1.5, hy + 1.5, w + 1, 3);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(hx + 2, hy + 2, w, 2);
    }
    // Attacker dots: one per enemy targeting them, in their bludgeon's colours; five make a group dot.
    const attackers = m.attackers(index);
    const ax0 = x + (right ? 0 : 24);
    const dir = right ? 1 : -1;
    let ax = right ? ax0 : ax0 + 58 - 9;
    const groups = Math.floor(attackers.length / 5);
    for (let i = 0; i < groups; i++) {
      ctx.drawImage(dots.get('group_dot'), ax, y + 66 + 1);
      ax += dir * 10;
    }
    ax += right ? 2 : 1;
    for (const from of attackers.slice(groups * 5)) {
      const [primary, secondary] = colourMapping(m.gloves[from].colours);
      const cx = ax + 3;
      const cy = y + 66 + 3 + 3;
      for (const [r, colour] of [[4.25, '#ffff00'], [4, BALL_RGB[secondary]], [2, BALL_RGB[primary]]] as const) {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ax += dir * 9;
    }
    // The name over the top, 10pt and outlined, wrapped to the status's width.
    ctx.font = '10px Dialog, Arial, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    const lines: string[] = [];
    for (const word of m.names[index].split(' ')) {
      const last = lines.length - 1;
      if (last >= 0 && ctx.measureText(`${lines[last]} ${word}`).width <= LIST_W - 4) lines[last] += ` ${word}`;
      else lines.push(word);
    }
    const colour = m.kinds[index] === 'Skilled swabbie' ? NAME_RED : NAME_YELLOW;
    lines.slice(0, 2).forEach((line, i) => outlined(line, x + LIST_W / 2, y + 1 + i * 11, colour));
    ctx.restore();
    const [mx, my] = input.mouse;
    if (mx >= faceX && mx < faceX + 58 && my >= y + 9 && my < y + 67) hovered = index;
  }

  let hovered = -1;

  function tooltip(text: string): void {
    ctx.save();
    ctx.font = '12px Arial, sans-serif';
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

  function drawList(side: 0 | 1): void {
    if (!match) return;
    const rows = match.rows[side];
    const x = listX(side);
    listOffsets[side] = Math.max(0, Math.min(Math.max(0, rows.length - VISIBLE_ROWS), listOffsets[side]));
    rows.slice(listOffsets[side], listOffsets[side] + VISIBLE_ROWS)
      .forEach((i, row) => drawStatus(match!, i, x, ROWS_Y + row * ROW_H, side === 1));
    // The team label, "standing | total", and scroll buttons when the list is longer than the panel.
    ctx.save();
    ctx.font = '11px Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const standing = rows.filter((i) => !match!.fighters[i].out).length;
    outlined(`${side === 0 ? 'Yer team' : 'Enemies'} | ${standing}`, x + 10 + 34, 3 + 9, '#ffffff');
    if (rows.length > VISIBLE_ROWS) {
      for (const [dx, text, disabled] of [
        [0, '▲', listOffsets[side] === 0], [35, '▼', listOffsets[side] + VISIBLE_ROWS >= rows.length],
      ] as const) {
        ctx.fillStyle = '#292a2b';
        ctx.fillRect(x + 10 + dx, SCROLL_Y, 34, 14);
        ctx.fillStyle = disabled ? '#777' : '#fff';
        ctx.fillText(text, x + 10 + dx + 17, SCROLL_Y + 7);
      }
    }
    ctx.restore();
  }

  // ---- The frame ----

  function frame(events: InputEvent[]): void {
    const liveEvents = pause.input(events, PUZZLE, running);
    if (liveEvents === null) {
      rumbleAudio.sync(null);
      events.forEach(scrollList);
      draw(ticks());
      return;
    }
    events = liveEvents;
    const routed = replays.frame(events, input.mouse, ticks());
    events = routed.events;
    input.mouse = routed.mouse;
    const now = ticks();
    if (!routed.renderOnly) {
      for (const command of routed.commands) {
        const parts = /^list-scroll:([01]):(\d+)$/.exec(command);
        if (parts) listOffsets[Number(parts[1]) as 0 | 1] = Number(parts[2]);
      }
      // Resolve due shots and the deadline before accepting further input. A late frame still
      // credits a ball that actually landed before 2:00, but cannot start a shot after time is up.
      if (aiming() && aim && running) { aim.update(now); if (aim.result) stop(); }
      else if (match && running) { match.update(now); if (match.settledAt) stop(); }
      handle(events, now);
      if (match && running) {
        if (aiming()) { aim!.update(now); if (aim!.result) stop(); }
        else { match.update(now); if (match.settledAt) stop(); }
      } else if (aiming() && aim?.result) aim.update(now);
    }
    rumbleAudio.sync(running && !aiming() && !replays.isSeeking && !replays.isAdvancing ? match?.player ?? null : null);
    if (replays.isSeeking || replays.isAdvancing) return;
    draw(now);
  }

  function howTo(): void {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(BOARD_X, BOARD_Y, VIEW_W, VIEW_H);
    const title = img('title');
    ctx.drawImage(title, Math.round(WIDTH / 2 - title.width), 70, title.width * 2, title.height * 2);
    ctx.font = '13px Arial, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const text = mode === 'Aim trainer' ? [
      'Aim trainer: 3 lives. 2 minutes.',
      '',
      'Shoot the matching ball from the active hand at target 1. Use the mouse or arrow keys to aim; hold Shift for fine aim.',
      '',
      'Left click or Z fires the left hand. Right click or X fires the right. Grey hands are inactive.',
      '',
      'Target 2 and the next ball stay visible so you can prepare. Pick a difficulty from Easy (straight in) to Very hard (two bounces, a tiny window or a far bank), or Mixed.',
      `The board changes every ${AIM_BOARD_SHOTS} shots. Your previewed target stays ready.`,
      '',
      'Each connection scores 1. Each miss costs a life. The round ends at 0 lives or when time runs out.',
    ] : mode === 'Create' ? [
      'Freeplay: a board of your own that never ends.',
      '',
      'Start deals a board of the rows and density you pick. Shoot it as in a fight, or change it between shots:',
      'hold 1–5 to paint red, yellow, orange, cyan or blue under the mouse and 0 to erase, or pick a colour in the panel and click or drag. The wheel changes a ball’s colour, C charges it and B bruises it.',
      '',
      'Pick a bludgeon, its colours and a punch’s size, or leave them random, and press Punch! (P) to land it on your board. Preview on board (V) shows where it will land first.',
    ] : [
      'Aim both fists with the mouse or the arrow keys.',
      'Left button (or Z) fires the left fist, right button (or X) the right.',
      'Hold a button for a second to charge the ball.',
      '',
      'Three of a colour pop; what no longer hangs from the top falls.',
      'One group sends sprinkle. A charged ball in a group becomes a spark:',
      'popping the oldest spark’s group sets off every later one, and two',
      'or more groups at once send a punch.',
      '',
      'The board drops a row every eighth shot. A ball in the bottom row',
      'and ye be knocked out.',
    ];
    let y = 150;
    for (const line of text) {
      const words = line.split(' ');
      let current = '';
      for (const word of words) {
        if (ctx.measureText(`${current} ${word}`).width > VIEW_W - 24 && current) {
          ctx.fillText(current, BOARD_X + 12, y);
          y += 17;
          current = word;
        } else current = current ? `${current} ${word}` : word;
      }
      ctx.fillText(current, BOARD_X + 12, y);
      y += 17;
    }
    ctx.restore();
  }

  function backgroundName(): string {
    if (mode === 'Aim trainer') return 'background';
    if (settings.werewolf) return 'background_werewolf';
    if (settings.oneFisted) return 'background_boxing';
    return 'background';
  }

  function draw(now: number): void {
    screen.fill('#000');
    screen.blit(img(match ? (match.settings.werewolf ? 'background_werewolf' : match.settings.oneFisted ? 'background_boxing' : 'background') : backgroundName()), 0, 0);
    if (!match) {
      howTo();
      replays.drawOverlay(ctx);
      return;
    }
    hovered = -1;
    if (!aiming()) { drawList(0); drawList(1); }
    drawBoard(match.player, running ? now : match.settledAt || match.endedAt || now);
    if (aiming()) drawAimStatus(now);
    if (finished && !match.result && !aiming()) banner('Stopped', 330);
    if (hovered >= 0) {
      const glove = match.gloves[hovered];
      const target = match.targets[hovered];
      const doing = target < 0 ? '' : match.teams[target] === match.teams[hovered] ? `, defending ${match.names[target]}` : `, attacking ${match.names[target]}`;
      tooltip(`${glove.name}${doing}`);
    }
    replays.drawOverlay(ctx);
  }

  function banner(text: string, y: number): void {
    drawPauseLabel(ctx, text, WIDTH / 2, y, WIDTH, BOARD_FONT_SMALL);
  }

  pause.install(panel, () => running);

  // ---- Panel ----

  panel.clock(() => mode === 'Aim trainer'
    ? { label: 'Time left', ms: aim?.remaining(ticks()) ?? AIM_MS, countdown: true, warn: (aim?.remaining(ticks()) ?? AIM_MS) <= 10000 }
    : { label: 'Time', ms: match ? (match.endedAt || ticks()) - startedAt : 0 });
  panel.controls(PUZZLE, [...KEYS, ...CREATE_KEYS]);

  const session = panel.session();
  session.select('Mode', MODES, () => mode, (m) => {
    mode = m;
    store.set('mode', m);
    match = null;
    aim = null;
    finished = showResults = false;
    viewer.on = false;
  }, { disabled: () => running || replays?.isPlaying, title: 'Fight against opponents, build a board in Freeplay, or practise precision and bounce shots in Aim trainer (3 lives, 2 minutes).' });
  session.select('Difficulty', AIM_DIFFICULTIES.map(value => ({ value, label: value })), () => aimDifficulty, (d) => {
    aimDifficulty = d;
    store.set('aimDifficulty', d);
    match = null;
    aim = null;
    finished = showResults = false;
  }, {
    hidden: () => mode !== 'Aim trainer', disabled: () => running || replays?.isPlaying,
    title: 'Each target is graded by its easiest route. Easy goes straight in; Medium has a fair spread of angles or a bounce near the target; Hard has a tighter angle and a longer bank; Very hard needs two bounces, a window of a degree or less, or a bounce far from the target. Mixed deals all four.',
  });
  session.toggle('Shot hints', () => aimHints, (on) => { aimHints = on; store.set('aimHints', on); }, {
    hidden: () => mode !== 'Aim trainer',
    title: 'Shows how many bounces each target\'s easiest route takes, and how wide its window of working angles is.',
  });
  session.button('Start', () => {
    if (replays.isPlaying) {
      replays.stop();
      if (!replays.isPlaying) start();
    } else if (running) stop();
    else start();
  }, {
    variant: 'primary', label: () => (replays?.isPlaying ? 'Start' : running ? 'Stop' : finished ? 'Rumble again' : 'Start'),
  });
  session.button('View stats', () => { showResults = !showResults; }, {
    hidden: () => !finished || (!match?.result && !aiming()), label: () => (showResults ? 'View board' : 'View stats'),
  });
  const targeting = () => running && !!match && startedMode === 'Fight' && (settings.enemyRoster.length > 1 || settings.allyRoster.length > 0);
  panel.group(undefined, { hidden: () => !targeting() }).hint(() => {
    if (!targeting() || !match || match.target < 0) return '';
    const t = match.target;
    const verb = match.teams[t] === 0 ? 'Defending' : 'Attacking';
    return `${verb} ${match.names[t]}: press A / S or click an enemy to change, or click a teammate to defend them.`;
  });

  const recordNow = () => record[settingsKey()] ?? { wins: 0, losses: 0, best: 0 };
  panel.score('Aim trainer', { hidden: () => mode !== 'Aim trainer' }).stats(['', 'Now', 'Best'], () => [
    ['Connections', String(aim?.score ?? 0), String(Math.max(0, ...store.history(aimHistory()).map(g => g.score)))],
    ['Lives', String(aim?.lives ?? AIM_LIVES), ''],
  ]);
  panel.group('Aim trainer', { hidden: () => mode !== 'Aim trainer' }).note(() =>
    `Shoot target 1 with the matching active hand. Target 2 and its ball preview your next shot. Grey hands are disabled. Each hit scores 1; each miss costs a life. The board changes every ${AIM_BOARD_SHOTS} shots.`);
  panel.score('Rumble', { hidden: () => mode !== 'Fight' }).stats(['', 'Now', 'Best'], () => [
    ['Damage sent', match ? String(damageSent(match.player)) : '0', String(recordNow().best || '—')],
    ...(settings.enemyRoster.length ? [['Wins', String(recordNow().wins), `of ${recordNow().wins + recordNow().losses}`]] : []),
  ]);
  const rate = (amount: number) => {
    const seconds = match ? Math.max(0, (match.endedAt || ticks()) - startedAt) / 1000 : 0;
    return (seconds > 0 ? amount / seconds : 0).toFixed(2);
  };
  function fightAverages(): string[][] {
    const games = store.history(settingsKey());
    const rows = sessionAverages(games.map((g) => ({ ...g, duty: '' })), { scoreLabel: 'Damage sent' });
    const durations = games.filter((g) => typeof g.ms === 'number' && g.ms > 0);
    if (durations.length) {
      const seconds = durations.reduce((sum, g) => sum + Number(g.ms) / 1000, 0);
      rows.push(['Damage sent per second', `${(durations.reduce((sum, g) => sum + Number(g.score), 0) / seconds).toFixed(2)}/s`],
        ['Damage taken per second', `${(durations.reduce((sum, g) => sum + Number(g.received ?? 0), 0) / seconds).toFixed(2)}/s`]);
    }
    return rows;
  }
  panel.results(() => {
    // Let the final hit/miss remain visible before the results cover the board.
    if (aiming() && aim?.landing && ticks() < aim.landing.until) return null;
    // When time runs out, a ball still in the air lands, and the board stays in view a moment.
    if (aiming() && aim?.result === 'Time up' && ticks() < aim.settledAt! + END_HOLD_MS) return null;
    if (finished && showResults && aiming() && aim) return {
      title: `Aim trainer · ${aim.difficulty} · ${aim.result}`,
      averages: sessionAverages(store.history(aimHistory()).map(g => ({ ...g, duty: '' })), { scoreLabel: 'Connections' }),
      rows: [
        ['Connections', String(aim.score)], ['Shots', String(aim.shots)],
        ['Accuracy', aim.shots ? `${Math.round(100 * aim.score / aim.shots)}%` : '—'],
        ['Lives left', String(aim.lives)], ['Time', `${((aim.endedAt! - startedAt) / 1000).toFixed(1)}s`],
      ],
    };
    if (!finished || !showResults || !match || !match.result) return null;
    const s = match.player.stats;
    const team = settings.allyRoster.length > 0;
    const won = match.result === 'won';
    const title = settings.enemyRoster.length ? (team ? (won ? 'Yer team is victorious!' : 'Yer team is defeated!') : (won ? 'Ye be the victor!' : 'Ye be defeated!')) : 'Practice results';
    return {
      title,
      headline: settings.enemyRoster.length ? title : undefined,
      averages: fightAverages(),
      rows: [
        ['Result', outcome()],
        ['Time', `${((match.endedAt - startedAt) / 1000).toFixed(1)}s`],
        ['Damage sent', String(damageSent(match.player))],
        ['Punch squares sent', String(s.punchSquares)],
        ['Sprinkle sent', `${s.sprinkleSent} balls`],
        ['Damage taken', String(s.received)],
        ['Damage sent per second', `${rate(damageSent(match.player))}/s`],
        ['Damage taken per second', `${rate(s.received)}/s`],
        ['Punches sent', String(s.punches)],
        ['Biggest punch', s.biggestPunch ? `${s.biggestPunch} squares` : '—'],
        ['Largest strike received', s.largestReceived ? `${s.largestReceived} balls` : '—'],
        ['Shots', String(s.shots)],
        ['Balls popped', String(s.popped)],
        ['Balls dropped off', String(s.dropped)],
        ['Sparks primed', String(s.sparks)],
        ['Best chain', `${s.bestChain} ${s.bestChain === 1 ? 'group' : 'groups'}`],
        ['Board drops', String(s.drops)],
      ],
    };
  });

  // Freeplay mode's board, punch and viewer, as Distilling's Freeplay has its Board group.
  const createHidden = () => mode !== 'Create';
  const createOff = () => !editable();
  const boardGroup = panel.controlSettings.group('Board', { hidden: createHidden });
  const paletteRow = document.createElement('div');
  paletteRow.className = 'piece-palette';
  PAINT_NAMES.forEach((name, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-button';
    const icon = document.createElement('canvas');
    icon.width = icon.height = BALL;
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createTextNode('');
    button.append(icon, label);
    button.addEventListener('click', () => {
      palette = palette === i ? null : i;
      panel.used();
    });
    let drawn = '';
    panel.addSync(() => {
      button.disabled = !running || !creating();
      button.setAttribute('aria-pressed', String(palette === i));
      const furball = settings.werewolf && i === ORANGE;
      const k = String(furball);
      if (k === drawn) return;
      drawn = k;
      const c = icon.getContext('2d')!;
      c.clearRect(0, 0, BALL, BALL);
      c.drawImage(img(`balls-${COLOUR_NAMES[furball ? FURBALL : i]}`), 0, 0, BALL, BALL, 0, 0, BALL, BALL);
      label.textContent = `${i + 1} · ${furball ? 'Furball' : name}`;
    });
    paletteRow.append(button);
  });
  boardGroup.append(paletteRow);
  boardGroup.hint(() => 'Hold 1–5 to paint under the mouse and 0 to erase, or pick a colour above: then the left button paints and the right erases. Pick it again to fire again. The wheel changes a ball’s colour, C charges it and B bruises it. U undoes.');
  boardGroup
    .toggle('Werewolf (orange is furball)', () => settings.werewolf, setWerewolf, {
      disabled: () => !!replays?.isPlaying,
      title: 'Werewolf rumbling: orange balls are brown furballs, on the board, in your fists and in punches. Freeplay starts again on the same board, its oranges swapped.' })
    .toggle('Show colour numbers', () => create.showNumbers, (on) => { create.showNumbers = on; saveCreate(); })
    .toggle('Preview on board (V)', () => create.previewOnBoard, (on) => { create.previewOnBoard = on; saveCreate(); }, {
      title: 'Shows the next punch landed on the board, its balls bright and the rest dimmed. Punch! still lands it for real.' })
    .number('Rows', () => create.rows, (v) => { create.rows = Math.round(v); saveCreate(); }, { min: 0, max: MAX_ROWS, step: 1 })
    .range('Density %', () => create.density, (v) => { create.density = v; saveCreate(); }, { min: 0, max: 100, outputWidth: 4 })
    .button('Deal (G)', deal, { variant: 'primary', disabled: createOff, title: 'A new board of these rows and density. Start deals one too.' })
    .button('Clear', clearBoard, { disabled: createOff })
    .button('Drop floating', dropFloating, { disabled: createOff, title: 'Removes balls no longer attached to the top, e.g. after editing.' })
    .button('Undo (U)', undoLast, { disabled: () => createOff() || !undo.length })
    .hint(() => (creating() ? createMessage : 'Start to deal a board.'));

  const bludgeonOptions: Option<number>[] = [
    { value: -1, label: 'Random' },
    ...SIM_BLUDGEONS.map((type) => ({ value: type, label: gloveName(type) })),
  ];
  const sideOptions: Option<PunchChoices['side']>[] = [
    { value: 'random', label: 'Random' }, { value: 'left', label: 'Left wall' }, { value: 'right', label: 'Right wall' },
  ];
  const fixedColours = () => spec.bludgeon === FISTS_TYPE || spec.bludgeon === HOOK_TYPE;
  const sprinkleCanvas = document.createElement('canvas');
  const SPRINKLE_BALL = 19;
  sprinkleCanvas.width = 9 * SPRINKLE_BALL + SPRINKLE_BALL / 2;
  sprinkleCanvas.height = 104;
  sprinkleCanvas.style.width = `${sprinkleCanvas.width}px`;
  sprinkleCanvas.style.height = `${sprinkleCanvas.height}px`;
  sprinkleCanvas.setAttribute('aria-label', 'The next punch’s sprinkle, at one and two layers');
  let sprinkleDrawn = '';
  panel.addSync(() => {
    const k = `${spec.bludgeon}|${spec.colours}|${settings.werewolf}`;
    if (k === sprinkleDrawn) return;
    sprinkleDrawn = k;
    const c = sprinkleCanvas.getContext('2d')!;
    c.clearRect(0, 0, sprinkleCanvas.width, sprinkleCanvas.height);
    c.font = 'bold 12px sans-serif';
    c.fillStyle = getComputedStyle(document.body).color || '#000';
    const g = createGlove();
    const icon = (piece: number, x: number, y: number) => {
      const name = COLOUR_NAMES[colourOf(piece)];
      if (name) c.drawImage(img(`balls-${name}`), (isDark(piece) ? 2 : isLight(piece) ? 3 : 0) * BALL, 0, BALL, BALL, x, y, SPRINKLE_BALL, SPRINKLE_BALL);
    };
    // The bludgeon's bottom two pattern rows, rising into nine columns: the first layer lands highest.
    c.fillText('Sprinkle, 1 layer (9)', 0, 12);
    for (let i = 0; i < 9; i++) icon(g.piece(i, 0, false), i * SPRINKLE_BALL, 18);
    c.fillText('Sprinkle, 2 layers', 0, 56);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 9; i++) icon(g.piece(i, j, false), i * SPRINKLE_BALL + (j * SPRINKLE_BALL) / 2, 62 + j * SPRINKLE_BALL * 0.8);
  });
  panel.controlSettings.group('Punch', { hidden: createHidden })
    .hint(() => {
      const view = creating() ? preview(match!.player.board) : null;
      return `Next: ${describe(spec)}, colours ${spec.colours}${spec.bruises ? `, ${spec.bruises} bruises` : ''}.${view?.destroyed ? ` Destroys ${view.destroyed} ball${view.destroyed === 1 ? '' : 's'}.` : ''}`;
    })
    .select('Bludgeon', bludgeonOptions, () => create.bludgeon, (v) => { create.bludgeon = v; rechoose(); })
    .toggle('Random colours', () => create.randomColours, (on) => { create.randomColours = on; rechoose(); })
    .number('Colours', () => create.colours, (v) => { create.colours = Math.round(v); rechoose(); }, {
      min: 0, max: MAX_COLOURS, hidden: () => create.randomColours,
      title: 'The bludgeon colour number (0-255): it reorders the five colours, and odd numbers mirror the pattern. Bare fists and the hook ignore it.' })
    .hint(() => (fixedColours() ? `${gloveName(spec.bludgeon)} always use the same colours.` : `Colour order: ${colourMapping(spec.colours).map((c) => COLOUR_NAMES[c === ORANGE && settings.werewolf ? FURBALL : c]).join(', ')}${spec.colours % 2 ? ', mirrored' : ''}`))
    .toggle('Random size', () => create.randomSize, (on) => { create.randomSize = on; rechoose(); })
    .number('Length', () => create.length, (v) => { create.length = Math.round(v); rechoose(); }, { min: 1, max: MAX_LENGTH, hidden: () => create.randomSize })
    .number('Width', () => create.width, (v) => { create.width = Math.round(v); rechoose(); }, { min: 1, max: MAX_WIDTH, hidden: () => create.randomSize })
    .select('Comes from', sideOptions, () => create.side, (v) => { create.side = v; rechoose(); })
    .number('Bruises', () => create.bruises, (v) => { create.bruises = Math.round(v); rechoose(); }, {
      min: 0, max: Math.trunc((MAX_LENGTH * MAX_WIDTH) / 2), title: 'Bruises scattered at random through the punch (at most half of it).' })
    .button('Punch! (P)', land, { variant: 'primary', disabled: createOff, title: 'Lands the punch on your board now, between shots.' })
    .button('Roll again (R)', () => { spec = roll(); }, { title: 'Re-rolls whatever is random, and the wall when it is random.' })
    .append(sprinkleCanvas);

  const viewerGroup = panel.controlSettings.group('Bludgeon viewer (werewolf)', { hidden: createHidden });
  const viewerHidden = () => !viewer.on;
  viewerGroup.toggle('Show viewer', () => viewer.on, (on) => { viewer.on = on; }, {
    disabled: () => !creating(),
    title: 'Werewolf punches on an empty board, over your own: step through each bludgeon, punch type and furball colour slot. Left/right, up/down and A/S step them while it shows; R reshuffles the bruises.' });
  viewerGroup.hint(() => viewerLines()[0], { hidden: viewerHidden })
    .button('◀ Bludgeon', () => stepBludgeon(-1), { hidden: viewerHidden }).button('Bludgeon ▶', () => stepBludgeon(1), { hidden: viewerHidden })
    .hint(() => viewerLines()[1], { hidden: viewerHidden })
    .button('◀ Punch', () => stepKind(-1), { hidden: viewerHidden }).button('Punch ▶', () => stepKind(1), { hidden: viewerHidden })
    .hint(() => viewerLines()[2], { hidden: viewerHidden })
    .button('◀ Furball', () => stepSlot(-1), { hidden: viewerHidden }).button('Furball ▶', () => stepSlot(1), { hidden: viewerHidden })
    .button('Reshuffle bruises (R)', reshuffle, { hidden: () => !viewer.on || !VIEWER_KINDS[viewer.kind].bruised });

  panel.group('Freeplay stats', { hidden: createHidden }).stats(['', ''], () => {
    const b = createBoard();
    return [
      ['Balls on board', b ? String(ballCount(b)) : '—'],
      ['Lowest row', b ? String(b.lowest() + 1) : '—'],
      ['Shots', creating() ? String(match!.player.stats.shots) : '0'],
      ['Punches landed', String(punches)],
      ['Balls destroyed', String(destroyed)],
    ];
  });

  const replayAction = {
    available: (game: GameRecord) => typeof game.replayAt === 'number' && (replays?.hasPlayableAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined) ?? false),
    play: (game: GameRecord) => { if (typeof game.replayAt === 'number') replays?.playAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined); },
  };
  historyGroup(panel, () => (mode !== 'Fight' ? null : store.history(settingsKey())), [
    { label: 'Result', value: (g) => String(g.result ?? '') },
    { label: 'Damage', value: (g) => String(g.score) },
    { label: 'Time', value: (g) => typeof g.ms === 'number' ? `${(g.ms / 1000).toFixed(0)}s` : '' },
  ], 'Past rumbles', replayAction, false);
  historyGroup(panel, () => mode === 'Aim trainer' ? store.history(aimHistory()) : null, [
    { label: 'Result', value: g => String(g.result ?? '') },
    { label: 'Connections', value: g => String(g.score) },
    { label: 'Shots', value: g => String(g.shots ?? 0) },
    { label: 'Time', value: g => `${(Number(g.ms ?? 0) / 1000).toFixed(0)}s` },
  ], 'Past aim training', replayAction, false);

  function save(): void {
    store.set('settings', settings);
  }
  const off = { disabled: () => running || replays?.isPlaying };

  // Rosters, as Swordfight's: how many, then each NPC's type, bludgeon and skill.
  const npcBludgeons: Option<number>[] = [{ value: -1, label: 'Random' }, ...BLUDGEONS.map((value) => ({ value, label: gloveName(value) }))];
  for (const [side, title, label, max, defaultKind] of [
    ['enemyRoster', 'Opponents', 'Opponent', MAX_ENEMIES, 'Brigand'],
    ['allyRoster', 'Teammates', 'Teammate', MAX_ALLIES, 'Skilled swabbie'],
  ] as const) {
    panel.settings.group(title, { hidden: () => mode !== 'Fight' }).number('Number', () => settings[side].length, (value) => {
      const roster = settings[side].slice(0, Math.round(value));
      while (roster.length < Math.round(value)) roster.push(npcDefaults(defaultKind));
      settings[side] = roster;
      save();
    }, {
      ...off, min: 0, max, step: 1,
      title: side === 'allyRoster' ? `NPC teammates in addition to you, up to ${MAX_ALLIES}.` : `Up to ${MAX_ENEMIES} opponents. None is practice on your own.`,
    });
    let selected = 0;
    let choices: Option<number>[] = [];
    const index = () => (selected = Math.min(selected, Math.max(0, settings[side].length - 1)));
    const npc = () => settings[side][index()] ?? npcDefaults(defaultKind);
    const change = (edit: (value: NpcSettings) => void) => {
      const value = settings[side][index()];
      if (value) { edit(value); save(); }
    };
    const g = panel.settings.group(`Customise ${label.toLowerCase()}`, { hidden: () => mode !== 'Fight' || !settings[side].length });
    g.select('NPC', () => {
      const length = settings[side].length;
      if (choices.length !== length) choices = Array.from({ length }, (_, i) => ({ value: i, label: `${label} ${i + 1}` }));
      return choices;
    }, index, (i) => { selected = i; }, off);
    g.select('Type', NPC_KINDS, () => npc().kind, (kind) => change((value) => {
      Object.assign(value, kind === 'Custom' ? { kind } : npcDefaults(kind));
    }), { ...off, title: `Brigands and barbarians carry the bludgeons NPPs fight with. Barbarians play at ${BARBARIAN_FACTOR * 100}% of their skill, the game's barbarian factor.` });
    g.select('Bludgeon', npcBludgeons, () => npc().bludgeon ?? -1, (b) => change((value) => { value.bludgeon = b === -1 ? null : b; }), off);
    g.range('Skill', () => npc().skill, (skill) => change((value) => { value.skill = Math.round(skill); }), { ...off, min: 0, max: 100 });
    g.button(`Apply first ${label.toLowerCase()} to all`, () => {
      const roster = settings[side];
      if (roster.length < 2) return;
      settings[side] = roster.map(() => ({ ...roster[0] }));
      save();
    }, { disabled: () => off.disabled() || settings[side].length < 2, title: 'Copy the first one’s type, bludgeon and skill to every one. Bludgeon colours remain random.' });
  }

  const foes = panel.settings.group('NPC behaviour', { hidden: () => mode !== 'Fight' });
  const ai = (change: (a: NpcStyle) => void) => { change(settings.ai); save(); };
  foes.number('Time per shot (ms)', () => settings.ai.shotMs, (v) => ai((a) => { a.shotMs = v; }), { ...off, min: 150, max: 4900, step: 50,
    title: 'How long an NPC of skill 50 takes over a shot. Skill 100 is half as long again quicker, skill 0 half as long again slower. The game fires for you at 5 seconds.' });
  foes.range('Variation (±%)', () => settings.ai.variation, (v) => ai((a) => { a.variation = v; }), { ...off, min: 0, max: 100,
    title: 'How far each shot’s time varies, either way.' });
  foes.range('Slower when targeted (%)', () => settings.ai.targetedSlowdown, (v) => ai((a) => { a.targetedSlowdown = v; }), { ...off, min: 0, max: 300, step: 5,
    title: 'How much slower an NPC plays for each enemy targeting it, up to 4. Swordfight’s in-game NPCs slow down like this.' });
  foes.range('Aim error at skill 0 (°)', () => settings.ai.aimError, (v) => ai((a) => { a.aimError = v; }), { ...off, min: 0, max: 10, step: 0.5,
    title: 'How far off an NPC’s aim can be, either way. It shrinks with skill: half this at skill 50, none at 100.' });
  foes.toggle('Build spark chains', () => settings.ai.sparks, (on) => ai((a) => { a.sparks = on; }), { ...off,
    title: 'Lets NPCs charge balls into sparks and set the chain off for a punch: at their target length (a spark for every 20 skill, up to 5), or sooner the lower their board gets. Punches that break up a spark’s group break the spark, as on yours.' });
  foes.range('Bruise chance at skill 100 (%)', () => settings.ai.bruiseChance, (v) => ai((a) => { a.bruiseChance = v; }), { ...off, min: 0, max: 100,
    title: 'How likely an NPC’s punch is to carry bruises. It scales with skill: half this at skill 50, none at 0.' });
  foes.range('Bruised share of a punch (%)', () => settings.ai.bruiseShare, (v) => ai((a) => { a.bruiseShare = v; }), { ...off, min: 0, max: 50,
    title: 'When a punch carries bruises, this share of its squares are bruised. It is capped at half.' });

  const rules = panel.settings.group('Fight rules (approximated)', { hidden: () => mode !== 'Fight' });
  const rule = (change: (r: FightRules) => void) => { change(settings.rules); save(); };
  rules.hint(() => 'How strikes pass between pirates isn’t known exactly. These are best guesses, each one adjustable.');
  rules.toggle('Time bonus', () => settings.rules.timeBonus, (on) => rule((r) => { r.timeBonus = on; }), { ...off,
    title: 'Clears grow 20% for each whole minute of the fight. Whole minutes is a guess.' });
  rules.toggle('Suppression', () => settings.rules.suppression, (on) => rule((r) => { r.suppression = on; }), { ...off,
    title: 'Each enemy targeting you, other than the one you are targeting, takes a row off your punches, up to half their length (rounded down).' });
  rules.toggle('Drop-off to suppressors', () => settings.rules.dropOffToAttackers, (on) => rule((r) => { r.dropOffToAttackers = on; }), { ...off,
    hidden: () => !settings.rules.suppression,
    title: 'A punch’s drop-off goes as sprinkle to each enemy suppressing it. Not to the one you are targeting, so a 1v1 sends none.' });
  rules.toggle('Defence', () => settings.rules.defence, (on) => rule((r) => { r.defence = on; }), { ...off,
    title: 'Target a teammate (click them) to defend them: your clears fill their blue bar instead of hitting an enemy. How much it soaks is a guess.' });
  rules.number('Squares to fill a bar', () => settings.rules.defenceSquares, (v) => rule((r) => { r.defenceSquares = Math.round(v); }), { ...off, min: 1, max: 1000, step: 1,
    hidden: () => !settings.rules.defence, title: 'Punch squares (width × length) or sprinkle balls that fill a defence bar. It holds twice this, the rest unseen. A punch at a defended pirate loses a row for each row’s worth of squares in the bar. A guess (10×9 is commonly quoted).' });
  rules.select('Punches come from', [
    { value: 'random', label: 'Either wall' }, { value: 'left', label: 'The left wall' }, { value: 'right', label: 'The right wall' },
  ] as Option<FightRules['side']>[], () => settings.rules.side, (side) => rule((r) => { r.side = side; }), { ...off, title: 'Which wall a punch comes from.' });

  const fight = panel.settings.group('Fight', { hidden: () => mode === 'Aim trainer' });
  fight.toggle('Boxing (one fist)', () => settings.oneFisted, (on) => { settings.oneFisted = on; save(); }, { ...off,
    title: 'The one-fisted variant: a single fist in the middle, aiming 10° to 170°.' });
  fight.toggle('Werewolf rumbling', () => settings.werewolf, setWerewolf, { disabled: () => (running && !creating()) || replays?.isPlaying,
    title: 'Orange balls are brown furballs, and everyone fights with werewolf claws. A furball group counts its charged balls as groups, and needs two of them to spark.' });
  fight.toggle('Rumless', () => settings.rumless, (on) => { settings.rumless = on; save(); }, { ...off,
    title: 'Without rum your fists wobble: every shot goes up to 2.5° off.' });
  fight.range('Damage level', () => settings.damageLevel, (v) => { settings.damageLevel = Math.round(v); save(); }, { ...off, min: 0, max: 100,
    formatValue: (v) => `${v} (${Math.floor(v * 5 * 20 / 600)} rows)`, outputWidth: 11,
    title: 'Ship damage when boarding: every 6 levels blocks a row at the top of your board.' });
  fight.number('Starting rows', () => settings.startRows, (v) => { settings.startRows = Math.round(v); save(); }, { ...off, min: 0, max: 12, step: 1,
    hidden: () => mode === 'Create' });

  const sandbox = panel.settings.group('Freeplay', { hidden: () => mode !== 'Create' });
  const sandboxRule = (change: () => void) => {
    change();
    saveCreate();
    if (creating()) Object.assign(match!.player.sandbox, { shotTimer: create.shotTimer, drops: create.drops });
  };
  sandbox.toggle('Shot timer', () => create.shotTimer, (on) => sandboxRule(() => { create.shotTimer = on; }), {
    title: 'The game warns at 4 seconds and fires for you at 5. Freeplay starts without it.' });
  sandbox.toggle('Board drops a row every 8 shots', () => create.drops, (on) => sandboxRule(() => { create.drops = on; }), {
    title: 'As in a fight. Off, the board stays where it is however many shots you take.' });
  sandbox.hint(() => 'Freeplay never ends: a ball in the bottom row would knock ye out in a fight, but here ye play on.');

  const yours = panel.settings.group('Your bludgeon', { hidden: () => mode === 'Aim trainer' });
  yours.select('Bludgeon', BLUDGEONS.map((value) => ({ value, label: gloveName(value) })), () => settings.bludgeon[0],
    (t) => { settings.bludgeon = [t, settings.bludgeon[1]]; save(); }, off);
  yours.number('Colours (0-119)', () => settings.bludgeon[1], (c) => { settings.bludgeon = [settings.bludgeon[0], Math.round(c)]; save(); }, {
    ...off, min: 0, max: 119, step: 1, disabled: () => off.disabled() || settings.bludgeon[0] === FISTS_TYPE || settings.bludgeon[0] === HOOK_TYPE,
    title: 'Your bludgeon’s colour byte: it orders the five colours in its pattern, and odd numbers mirror it.',
  });
  yours.hint(() => {
    const map = colourMapping(settings.bludgeon[0] === FISTS_TYPE || settings.bludgeon[0] === HOOK_TYPE ? 0 : settings.bludgeon[1]);
    return `Pattern colours: ${map.map((c) => COLOUR_NAMES[c]).join(', ')}.`;
  });

  const display = panel.settings.group('Display');
  display.toggle('Colours on small boards', () => showColours, (on) => { showColours = on; store.set('showColours', on); }, {
    title: 'The game shows only where each pirate has balls. This shows their colours too.',
  });
  display.toggle('Show where the ball lands', () => showLanding, (on) => { showLanding = on; store.set('showLanding', on); }, {
    title: 'A faded ball where each fist’s shot would come to rest.',
  });
  panel.settings.group('Reset').button('Reset to defaults', () => { settings = structuredClone(DEFAULTS); save(); }, off);

  const replaySettingsCodec: ReplaySettingsCodec = {
    currentVersion: 4,
    simulatorVersion: 5,
    // Old fights selected attacks and handled held buttons differently. Aim drills are unchanged.
    migrate: (version, value) => (validSettings(value) && (version === 4 || (version === 3 && !!value.aimTrainer)) ? value : null),
  };
  let savedSettings: Settings | null = null;
  let savedMode: Mode | null = null;
  let savedDifficulty: AimDifficulty | null = null;
  replays = new ReplayRecorder(PUZZLE, store, panel, ticks, (tape: PuzzleReplay) => {
    savedSettings ??= structuredClone(settings);
    savedMode ??= mode;
    settings = structuredClone(tape.settings as Settings);
    mode = settings.aimTrainer ? 'Aim trainer' : 'Fight';
    savedDifficulty ??= aimDifficulty;
    aimDifficulty = settings.aimDifficulty ?? 'Mixed';
    delete settings.aimTrainer;
    delete settings.aimDifficulty;
    const seed = (tape.seed as { seed?: unknown })?.seed;
    if (typeof seed !== 'number') throw new Error('Invalid Rumble replay seed');
    start(seed, mode);
  }, () => {
    if (running) stop();
    if (savedSettings) {
      settings = savedSettings;
      savedSettings = null;
    }
    if (savedDifficulty !== null) {
      aimDifficulty = savedDifficulty;
      savedDifficulty = null;
    }
    if (savedMode !== null) {
      mode = savedMode;
      savedMode = null;
      if (mode !== startedMode) { match = null; aim = null; finished = showResults = false; }
    }
  }, (seed) => typeof (seed as { seed?: unknown })?.seed === 'number', setReplayTime, () => frame([]), replaySettingsCodec, () => !running || replays.isPlaying);

  if (import.meta.env.DEV) (window as unknown as { __rumble: unknown }).__rumble = { get match() { return match; }, get aim() { return aim; } };

  // Taken over, the replay's settings are the game's: the player's own aren't put back afterwards.
  replays.onTakeOver = () => {
    savedSettings = null;
    savedMode = null;
    if (savedDifficulty !== null) store.set('aimDifficulty', aimDifficulty);
    savedDifficulty = null;
  };
  // What decides how the game goes on; replays check it after every recorded input.
  replays.fingerprint = () => aiming() ? stateText(match, aim, running, finished) : stateText(match, running, finished);

  // Opening a replay file ends a game in progress, as its Stop button would.
  replays.setStopLive(() => { if (running) stop(); });
  return { frame, dispose: () => { rumbleAudio.sync(null); quietGrowl(); replays.dispose(); sounds.dispose(); } };
}) satisfies PuzzleFactory;
