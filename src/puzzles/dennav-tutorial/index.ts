// The Dennav tutorial: lessons on each kind of chain, played on the Dennav board.
// Learn watches a move play out link by link; Practice deals the same strategy a few moves early;
// Spot the wrong star hides one wrong star in a board; Find the wrong move spoils a build-up with one bad turn.
import { Images } from '../../core/assets';
import { SoundBank, unlockAudio } from '../../core/audio';
import { drawGameText, floatAt, gameFont, gameFontFor, gameTextBox, loadGameFont, wrapGameText, FLOAT_MS, TEXT_WHITE, TEXT_YELLOW } from '../../core/game-text';
import { Random } from '../../core/random';
import { keyFor, keyLabel, keyMatches } from '../../core/controls';
import { copyText } from '../../core/clipboard';
import type { PuzzleFactory } from '../../core/puzzle';
import { NavigationGame, DEFAULT_SETTINGS, modeLabel, readSettings, type Scene } from '../navigation/game';
import { mobileControls } from '../navigation/mobile-controls';
import { Store } from '../../core/storage';
import { drawTarget, targetAppearance } from '../navigation/appearance';
import { COLOUR_NAMES, OCTANT_NAMES, PAINT_KEYS, WILD } from '../navigation/create';
import { EMPTY, type Run, type Target } from '../navigation/logic';
import {
  RINGS, INNER, MIDDLE, TOP, act as performAction, play, runStars, linkStars, verticalPlan, bestHorizontals, wildedBy, planHorizontal, innerRun, guessBuild, linedUp, SETTINGS, buildUpAtMost, dropEntries, spoilBuild, chainName, fixes, gameAt, generate, makeMistake, outcome, positionOf, scramble,
  type Action, type BadBuild, type BuildGuess, type VerticalPlan, type Example, type Link, type Mistake, type Outcome, type Position,
} from './engine';
import { LESSONS, TOPICS, VEGAS_AS_PLAYED, type Lesson } from './lessons';
import { AfterTriplePlay, dealAfterTriple } from './after-triple';
import { besideTop, checkPlan, dealPlanningBoard, paintPlan, planningOptions, type PlanCheck, type PlanningOption } from './planning';
import { builtComboIssue, buildOptionsFor, checkBuildTurned, solutionsFor, unturnedCell, type BuildIssue, type Strictness } from './build-position';
import { boardExport } from './board-export';
import { checkFinishPosition, dealFinish, finishGame, finishHint, judgeFinish, type FinishDeal } from './finish-combo';
import { DONKEY_CHAIN, analyseBreak, breakFrames, donkeyGame, setsOff, targetsBeforeClears, trackStars, type BreakFrame, type DonkeyAnalysis } from './donkey-practice';
import { HoldScrub } from './hold-scrub';
import { BAG_STARS, judgeDonkeyRing, starsDown } from './donkey-ring';
import { dealBase, judgeBasePosition, judgeLayer2, layer2Warnings, scrambleBase, type DealtBase, type Turns } from './donkey-layers';
import { act as playMove, settled } from './engine';
import { dealFilled, hasRing3Target, judgeCombo, judgeFill, judgeStack, verticalColumns } from './ring3-drills';
import { cascadeSetupGame, checkCascadeSetup, dealCascadeSetup, hasInnerWilds, type CascadeDeal } from './cascade-single';
import { FAIL_PENALTY_S, endSession, loadModeStats, noteAttempt, noteMove, percent, seconds, statsOf, type ModeStats, type Session, type Stats } from './practice-stats';

const soundUrls = {
  ...import.meta.glob<string>('../navigation/sounds/*.mp3', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob<string>('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' }),
};
const imageUrls = import.meta.glob<string>('../navigation/media/*.png', { eager: true, query: '?url', import: 'default' });
const COLOURS = ['blue', 'orange', 'red', 'white', 'yellow'];
/** Off for now: the buzz when a board fails, to come back later. */
const FAIL_BUZZ = false;
/** Off for now: ringing stacked stars in Layer 2 while it is played; they're still ringed once submitted. */
const LIVE_STACK_WARNINGS = false;
const PLAN_WILD_OUTLINE = '#91bba6', PLAN_PROBLEM_OUTLINE = '#ce9c96', PLAN_WARNING_OUTLINE = '#d8c48e';
const STRICTNESS: { value: Strictness; label: string }[] = [
  { value: 'lenient', label: 'Lenient: any working triple' },
  { value: 'standard', label: 'Standard: suboptimal warns' },
  { value: 'strict', label: 'Strict: suboptimal fails' },
];
const PLAN_PAINT_KEYS = PAINT_KEYS.filter((binding) => binding.colour !== WILD);
const CX = 225, CY = 300;
const radius = (ring: number) => 55 + (RINGS - 1 - ring) * 47;
const position = (octant: number, r: number): [number, number] => [CX + Math.cos(octant * Math.PI / 4) * r, CY - Math.sin(octant * Math.PI / 4) * r];
const ringLabel = (ring: number) => `ring ${RINGS - ring}`;
/** New board without judging the current one: R by default, rebindable in Settings. Ctrl still works unless rebound. */
const NEW_BOARD_KEY = 'r', NEW_BOARD_ALIASES = ['control'];
const newBoardKeyLabel = () => keyLabel(keyFor('dennav-tutorial', 'newBoard', NEW_BOARD_KEY));

type Mode = 'aftertriple' | 'learn' | 'steps' | 'plan' | 'build' | 'finish' | 'practise' | 'scratch' | 'donkeyring' | 'donkeybase' | 'donkeylayer' | 'r3fill' | 'r3stack' | 'r3build' | 'donkey' | 'spot' | 'when' | 'cascade-open' | 'cascade-setup' | 'cascade-practice';
const MODES: { value: Mode; label: string }[] = [
  { value: 'learn', label: '1. Example' }, { value: 'donkeyring', label: '2. Build Ring 1' },
  { value: 'donkeybase', label: '3. Position the base' }, { value: 'donkeylayer', label: '4. Build layer 2' },
  { value: 'r3fill', label: '2. Fill the targets' }, { value: 'r3stack', label: '2. Stack the pair' }, { value: 'r3build', label: '3. Build the combo' },
  { value: 'cascade-open', label: '2. Build Ring 1 and a Drop-in' },
  { value: 'cascade-setup', label: '3. Prepare a Drop-in' },
  { value: 'cascade-practice', label: '4. Practice' },
  { value: 'plan', label: '2. Plan Position' },
  { value: 'build', label: '3. Build Ring 1' }, { value: 'finish', label: '4. Finish the Combo' },
  { value: 'practise', label: '5. Practice' }, { value: 'donkey', label: '5. Practice' },
  { value: 'aftertriple', label: '6. After a triple' },
];
/** Topic-specific lessons; Example and Practice are available for every topic. */
function modeFits(mode: Mode, lesson: string): boolean {
  // After a triple: a vertical triple breaks, then the board plays on (Vertical triple's last lesson).
  if (mode === 'aftertriple') return lesson === 'vertical-triple';
  if (mode.startsWith('cascade-')) return lesson === 'cascade-single';
  // The donkey and vegas practise from scratch with Donkey from scratch's flow, listed as their Practice.
  if (mode === 'practise' && (lesson === 'cascade-single' || lesson === 'donkey' || lesson === 'vegas')) return false;
  if (mode === 'steps' || mode === 'plan' || mode === 'build' || mode === 'finish' || mode === 'scratch') return lesson === 'vertical-triple';
  if (mode === 'donkey' || mode === 'donkeyring' || mode === 'donkeybase' || mode === 'donkeylayer') return lesson === 'donkey' || lesson === 'vegas';
  if (mode === 'r3fill') return lesson === 'top-double' || lesson === 'top-triple';
  if (mode === 'r3stack') return lesson === 'drop-in-vertical';
  if (mode === 'r3build') return lesson === 'top-double' || lesson === 'top-triple' || lesson === 'drop-in-vertical';
  return true;
}
/** The Mode list for a lesson, the same array each time so the panel only rebuilds it when the lesson changes. */
const modeLists = new Map<string, { value: Mode; label: string }[]>();
const modesFor = (lesson: string) => { let list = modeLists.get(lesson); if (!list) modeLists.set(lesson, list = MODES.filter((m) => modeFits(m.value, lesson)).map((m, i) => ({ ...m, label: m.label.replace(/^\d+\. /, `${i + 1}. `) }))); return list; };
/** Practice stages: turns only (0–3 turns before the move), or building up the last few stars (negative: -n moves of build-up). */
const STAGES = [
  ...[0, 1, 2, 3].map((value) => ({ value, label: value ? `${value + 1} moves out (turns only)` : 'One move to go' })),
  ...[3, 5, 8].map((n) => ({ value: -n, label: `Finish the combo: last ${n} stars` })),
];

function describeRun(run: Run): string {
  if (run.direction === 0) return `horizontal in ${ringLabel(run.ring)}`;
  const outer = run.ring - run.length + 1;
  return `vertical through rings ${RINGS - run.ring}–${RINGS - outer}`;
}
/** A caption for one link of a chain. */
function caption(link: Link, index: number): string {
  if (link.kind === 'target') return `Link ${link.chain}: constellation charted — a ${chainName(link.chain).toLowerCase()}!`;
  const what = link.runs.map(describeRun).join(' and ');
  if (link.afterChart) {
    return `Cascade after charting: ${what}.${link.wilded.length ? ` ${link.wilded.length} of the new targets start wild.` : ''}`;
  }
  const wild = link.wilded.length ? ` Turns ${link.wilded.length} target${link.wilded.length > 1 ? 's' : ''} wild.` : index === 0 ? ' The first clear of a move never turns targets wild.' : '';
  return `Link ${link.chain}: ${what}.${wild}`;
}
function moveText(action: Action, entry?: { colour: number; octant: number }): string {
  if (action.kind === 'drop') return entry ? `drop ${COLOUR_NAMES[entry.colour].toLowerCase()} at ${OCTANT_NAMES[entry.octant].toLowerCase()}` : 'drop the star';
  return `turn ${ringLabel(action.ring)} ${action.clockwise ? 'clockwise' : 'anticlockwise'}`;
}

export default (async ({ screen, input, panel, store, ticks }) => {
  const [images] = await Promise.all([Images.load(imageUrls), loadGameFont()]);
  const sounds = new SoundBank(soundUrls);
  window.addEventListener('pointerdown', unlockAudio);
  const ctx = screen.ctx;
  // The tutorial is a mode of Navigation: picking another mode goes back there with it chosen.
  const navigationStore = new Store('navigation');
  const NAV_MODES = [
    { value: 'normal', label: modeLabel('normal') }, { value: 'ww-test', label: modeLabel('ww-test') },
    { value: 'create', label: 'Freeplay' }, { value: 'tutorial', label: 'Tutorial' },
  ] as const;
  panel.settings.group().select('Mode', NAV_MODES, () => 'tutorial', (value) => {
    if (value === 'tutorial') return;
    const settings = readSettings(navigationStore.get('settings', DEFAULT_SETTINGS)) ?? { ...DEFAULT_SETTINGS };
    settings.create = value === 'create';
    if (value !== 'create') settings.mode = value;
    navigationStore.set('settings', settings);
    location.hash = '#/navigation';
  });
  const matchWildColour = targetAppearance(panel);
  const rng = new Random();
  // After a triple used to be a topic of its own; it is now Vertical triple's last lesson.
  const storedLesson = store.get('lesson', TOPICS[0].id);
  let lessonIndex = Math.max(0, TOPICS.findIndex((l) => l.id === (storedLesson === 'after-triple' ? 'vertical-triple' : storedLesson)));
  let mode: Mode = storedLesson === 'after-triple' ? 'aftertriple' : store.get<Mode>('mode', 'learn');
  if (!MODES.some((m) => m.value === mode)) mode = 'learn';
  let stage = store.get<number>('stage', 0);
  let slow = store.get<boolean>('slow', true);
  let ringChain = store.get<boolean>('ringChain', true);
  /** How the chain stars are ringed: all gold, each link its own colour, or only the next link to clear. */
  type Highlight = 'gold' | 'links' | 'next';
  const HIGHLIGHTS: { value: Highlight; label: string }[] = [{ value: 'links', label: 'Colour by link' }, { value: 'gold', label: 'All gold' }, { value: 'next', label: 'Next link only' }];
  let highlight: Highlight = store.get<Highlight>('chainHighlight', 'links');
  if (!HIGHLIGHTS.some((h) => h.value === highlight)) highlight = 'links';
  let debugMode = store.get<boolean>('debugMode', true), exportNotice = '';
  const lesson = (): Lesson => TOPICS[lessonIndex];

  // What's on the board.
  const firstMoment = lesson().moments[0] ?? LESSONS[0].moments[0];
  let shown: Position = firstMoment.position;
  let example: Example = firstMoment;
  let exampleLabel = firstMoment.label;
  let momentIndex = 0;
  let game: NavigationGame | null = null;
  let start: Position | null = null;
  let solution: Action[] = [];
  /** Finish the combo: the board to build, and what the player is told to do. */
  let goal: Position | null = null, practiceGoal = '', showGoal = store.get<boolean>('showGoal', true);
  /** Build-up stages: the stars still to come, in order (the next star is the game's entry). */
  let upcoming: { colour: number; octant: number }[] = [], dealtUpcoming: { colour: number; octant: number }[] = [];
  let selected = RINGS - 1;
  let moves = 0;
  /** Scenes playing, with their captions; a held scene waits for Next (Step mode) or a pause (Play). */
  let scenes: { scene: Scene; caption?: string; targets?: Target[] }[] = [], sceneStart = 0, stepping = false, waiting = false;
  let afterScenes: (() => void) | null = null;
  let captionText = '', status = '';
  let clearNotice: { text: string; at: number; px: number; fill: string } | null = null;
  /** Cells drawn ringed: the wrong star once found, a wrong click, the trigger's ring. */
  let marks: { cell: number; colour: string }[] = [];
  /** Marks for each scene of a move as it plays (the chain highlight, or a replayed break's blamed stars), following the stars. */
  let sceneMarks: Map<Scene, { cell: number; colour: string }[]> | null = null;
  let arrowRing: { ring: number; clockwise: boolean } | null = null;
  let mistake: Mistake | null = null, found = false;
  /** Find the wrong move: the spoiled build, how far through it the board is, and the working board it was meant to reach. */
  let bad: BadBuild | null = null, buildAt = 0, goodFinal: Position | null = null, buildTrigger: Action | null = null;

  /** Replaying the last move slowly (Build from scratch). */
  let replaying = false;
  const isCascade = () => mode.startsWith('cascade-');
  /** Practice in the topics without a flow of their own: build the whole combo on a fresh board. */
  const fromScratchPractice = () => mode === 'practise';
  const isTraining = () => isCascade() || fromScratchPractice();
  // Normal Dennav speed whenever the player moves the rings; Slow is only for watching.
  const isSlow = () => mode !== 'donkey' && mode !== 'aftertriple' && !isTraining() && (replaying || (slow && !playing()));
  const speed = () => (isSlow() ? 2 : 1);
  const busy = () => scenes.length > 0;
  /** Modes where the player moves the rings. */
  const playing = () => isCascade() || mode === 'practise' || mode === 'scratch' || mode === 'donkey' || mode === 'donkeyring' || mode === 'donkeybase' || mode === 'donkeylayer' || isR3() || mode === 'build' || mode === 'finish' || (mode === 'aftertriple' && !!afterTriple && afterTriple.phase !== 'ready');

  /** The entry sound belongs to a new drop, never to gravity within a chain. */
  function act(g: NavigationGame, action: Action): Scene[] {
    const list = performAction(g, action);
    if (action.kind === 'drop' && list.length) sounds.play('star_drop');
    return list;
  }

  function playScenes(list: Scene[], captions: Map<Scene, string>, done: (() => void) | null = null): void {
    const targets = mode === 'donkey' ? targetsBeforeClears(list, shown.targets) : null;
    scenes = list.map((scene) => ({ scene, caption: captions.get(scene), targets: targets?.get(scene) }));
    sceneStart = ticks(); waiting = false; afterScenes = done;
    beginScene();
  }
  function beginScene(): void {
    const current = scenes[0];
    if (!current) return;
    if (current.caption) captionText = current.caption;
    const { clear } = current.scene;
    if (clear) {
      const scoreless = clear.kind === 'run';
      if (!scoreless || clear.chain > 1) {
        clearNotice = {
          text: `${chainName(clear.chain)}!${scoreless ? '' : ` Constellation! +${clear.points}`}`,
          at: sceneStart,
          px: clear.chain > 1 ? gameFont(1) : gameFontFor(clear.points, 300),
          fill: clear.chain > 1 ? TEXT_YELLOW : TEXT_WHITE,
        };
      }
    }
    if (clear?.kind === 'target') {
      const rings = clear.cells.map((c) => c.ring);
      const sound = rings.length === 1 ? 'constellation_single' : rings.length === 2
        ? (rings[0] === rings[1] ? 'constellation_medium' : 'constellation_small')
        : rings[0] === rings[1] && rings[1] === rings[2] ? 'constellation_huge'
        : new Set(rings.slice(0, 3)).size === 3 ? 'constellation_medium' : 'constellation_big';
      sounds.play(sound);
    } else if (clear) sounds.play('star_destroy');
  }
  /** A move played back for the player to follow: turns slowed down, and a pause after it before the next. */
  function paced(list: Scene[], g: NavigationGame): Scene[] {
    if (!isSlow()) return list;
    const slowed = list.map((scene) => scene.rotation ? { ...scene, duration: 450 } : scene);
    return [...slowed.slice(0, -1), ...slowed.slice(-1).map((scene) => ({ ...scene, duration: Math.max(scene.duration, 700) })), ...(slowed.length ? [] : [{ ...g.scene(700) }])];
  }
  function captionsFor(o: Outcome): Map<Scene, string> {
    return new Map(o.links.map((link, i) => [link.scene, caption(link, i)]));
  }

  // --- Chain highlight ---
  const GOLD = '#ffd84a';
  /** Link 1 red, 2 orange, 3 yellow, 4 green, 5 cyan, 6 and on violet. */
  const LINK_COLOURS = ['#ff5050', '#ff9a3c', '#ffe14a', '#5ee07a', '#4ad8ff', '#b07cff'];
  const linkColour = (k: number) => LINK_COLOURS[Math.min(k, LINK_COLOURS.length - 1)];
  /** The clears that make the chain, in order, each with its stars as cells of the board before the move. */
  function chainLinks(p: Position, action: Action): { cells: number[]; run: number }[] {
    return linkStars(p, action).map((l, run) => ({ cells: l.cells, run, counts: l.counts })).filter((l) => l.counts);
  }
  /** The chain stars ringed on the board before the move, in the chosen highlight. */
  function chainMarks(p: Position, action: Action): { cell: number; colour: string }[] {
    if (highlight === 'gold') return runStars(p, action).map((cell) => ({ cell, colour: GOLD }));
    const out: { cell: number; colour: string }[] = [], seen = new Set<number>();
    chainLinks(p, action).forEach((l, k) => {
      if (highlight === 'next' && k > 0) return;
      for (const cell of l.cells) if (!seen.has(cell)) { seen.add(cell); out.push({ cell, colour: linkColour(k) }); }
    });
    return out;
  }
  /**
   * The chain stars ringed while the move plays, following them as they turn and fall: every link in its
   * colour, or only the link still to clear next (while Step waits on a clear, the one after it). All gold
   * rings nothing during the move, as before.
   */
  function chainSceneMarks(list: Scene[], p: Position, action: Action): Map<Scene, { cell: number; colour: string }[]> | null {
    if (highlight === 'gold') return null;
    const runScenes = list.map((s, i) => (s.clear?.kind === 'run' ? i : -1)).filter((i) => i >= 0);
    const links = chainLinks(p, action).map((l) => ({ ...l, at: runScenes[l.run] ?? Infinity }));
    const tracked = links.map((l) => trackStars(list, l.cells));
    return new Map(list.map((scene, i) => {
      const out: { cell: number; colour: string }[] = [], seen = new Set<number>();
      const nextLink = links.findIndex((l) => l.at > i);
      links.forEach((_, k) => {
        if (highlight === 'next' && k !== nextLink) return;
        for (const cell of tracked[k].get(scene) ?? []) if (!seen.has(cell)) { seen.add(cell); out.push({ cell, colour: linkColour(k) }); }
      });
      return [scene, out];
    }));
  }

  /** A key to the link colours: a coloured dot per link, numbered. */
  function linkLegend(): HTMLElement {
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;gap:10px;align-items:center;font-size:12px;margin:2px 0 4px';
    legend.append('Links:');
    LINK_COLOURS.forEach((colour, k) => {
      const item = document.createElement('span');
      item.style.cssText = 'display:inline-flex;align-items:center;gap:3px';
      const dot = document.createElement('span');
      dot.style.cssText = `display:inline-block;width:11px;height:11px;border-radius:50%;border:2px solid ${colour};box-sizing:border-box`;
      item.append(dot, k === LINK_COLOURS.length - 1 ? `${k + 1}+` : String(k + 1));
      legend.append(item);
    });
    return legend;
  }

  // --- Learn ---
  /** The example's move as stills (board before, each turn, fall and clear, board after), and the one shown. */
  let exampleFrames: { frames: BreakFrame[]; start: number; result: Outcome } | null = null, exampleAt = 0;
  function showExample(next: Example, label: string): void {
    stopScenes(); exampleFrames = null; exampleAt = 0;
    example = next; exampleLabel = label; shown = next.position; game = null;
    scenes = []; marks = []; status = ''; mistake = null; bad = null; sceneMarks = null;
    arrowRing = next.action.kind === 'rotate' ? { ring: next.action.ring, clockwise: next.action.clockwise } : null;
    if (ringChain) marks = chainMarks(next.position, next.action);
    captionText = `${label}: ${moveText(next.action, next.position.entry)} sets it off.`;
  }
  /** Steps the example one still back or forward; the first still is the board before the move. */
  function exampleStep(by: number): void {
    if (mode !== 'learn') return;
    stopScenes();
    exampleFrames ??= breakFrames([], example.position, example.action, { stars: [], targets: [], end: [] } as unknown as DonkeyAnalysis);
    const { frames, result } = exampleFrames;
    exampleAt = Math.max(0, Math.min(frames.length - 1, exampleAt + by));
    if (exampleAt === 0) { const at = exampleAt; showExample(example, exampleLabel); exampleFrames = { frames, start: 0, result }; exampleAt = at; return; }
    const f = frames[exampleAt];
    shown = f.position; arrowRing = null; sceneMarks = null;
    marks = f.clearing.map((cell) => ({ cell, colour: f.scene?.clear?.kind === 'target' ? GOLD : linkColour(f.link ?? 0) }));
    const text = f.kind === 'clear' ? (f.scene && captionsFor(result).get(f.scene)) || 'The constellation charts.'
      : f.kind === 'fall' ? 'Stars fall in.'
      : f.kind === 'turn' ? 'After the move.'
      : result.charted ? `Charted as a ${chainName(result.charted).toLowerCase()}.` : 'Nothing charted.';
    captionText = `${text} (${exampleAt + 1} / ${frames.length})`;
  }
  function watch(step: boolean): void {
    stopScenes(); exampleFrames = null; exampleAt = 0;
    const g = gameAt(example.position);
    const list = act(g, example.action);
    const o = outcome(list, positionOf(g));
    stepping = step; arrowRing = null; marks = [];
    sceneMarks = ringChain ? chainSceneMarks(list, example.position, example.action) : null;
    playScenes(list, captionsFor(o), () => {
      sceneMarks = null;
      shown = positionOf(g);
      captionText = o.charted ? `Charted as a ${chainName(o.charted).toLowerCase()}.${o.nextInnerWild ? ' The next constellation starts with ring 1 wild.' : ''}` : 'Nothing charted.';
    });
  }
  /** The topic's hand-built board the last example was made from, so the next one starts from another. */
  let lastExampleBase = -1;
  /** A fresh example: a variation of one of the topic's hand-built boards, not the one used last time. */
  function newExample(): void {
    const moments = lesson().moments;
    let base = rng.integer(0, moments.length - 1);
    if (moments.length > 1 && base === lastExampleBase) base = (base + rng.integer(1, moments.length - 1)) % moments.length;
    lastExampleBase = base;
    showExample(generate(moments[base], lesson().accepts, rng, lesson().keep), 'Example');
  }


  // --- Build it step by step (the vertical triple) ---
  let stepEx: Example | null = null, plan: VerticalPlan | null = null, stepAt = 0, picked = false, chosen: number[] = [];
  const STEP_TITLES = ['The goal', 'Step 1: where the horizontal goes', 'Step 2: build the vertical', 'Step 3: the star on top'];
  const hasSteps = () => lesson().id === 'vertical-triple';
  /** The board with only some rings on it. */
  function only(p: Position, rings: number[]): Position {
    return { ...p, cells: p.cells.map((c, i) => (rings.includes(Math.floor(i / 8)) ? c : EMPTY)) };
  }
  function newSteps(fromSession = false): void {
    if (!hasSteps()) { stepEx = null; plan = null; shown = { ...shown, cells: shown.cells.map(() => EMPTY), targets: [] }; marks = []; arrowRing = null; captionText = ''; status = 'Step by step is written for the vertical triple so far. Pick Vertical triple in Lesson.'; return; }
    const l = lesson();
    for (let tries = 0; tries < 40; tries++) {
      const ex: Example = fromSession ? l.moments[momentIndex = (momentIndex + (tries ? 1 : 0)) % l.moments.length]
        : generate(l.moments[rng.integer(0, l.moments.length - 1)], l.accepts, rng, l.keep);
      const pl = verticalPlan(ex);
      // New examples put the horizontal where it turns the most targets wild, as step 1 teaches.
      if (!pl || (!fromSession && tries < 39 && (pl.lineups.length || wildedBy(ex.position.targets, planHorizontal(ex, pl)).length < bestHorizontals(ex.position.targets).wild))) continue;
      stepEx = ex; plan = pl;
      showStep(0);
      return;
    }
    status = 'Couldn’t make one of those just now. Try again.';
  }
  function showStep(k: number): void {
    if (!stepEx || !plan || busy()) return;
    const ex = stepEx, pl = plan;
    stepAt = Math.max(0, Math.min(3, k)); picked = false; chosen = []; scenes = []; game = null;
    const yellow = '#ffd84a', red = '#ff4040';
    const colour = (cell: number) => COLOUR_NAMES[ex.position.cells[cell]].toLowerCase();
    arrowRing = null; marks = [];
    if (stepAt === 0) {
      shown = ex.position;
      marks = chainMarks(ex.position, ex.action);
      arrowRing = ex.action.kind === 'rotate' ? { ring: ex.action.ring, clockwise: ex.action.clockwise } : null;
      status = `${STEP_TITLES[0]}. This is the finished board: ${moveText(ex.action)} lines the ${colour(pl.vertical[0])} vertical up through rings 1–3 and it clears. The ring 4 star above it drops all the way into ring 1 and joins the ${colour(pl.pair[0])} pair there, and that second clear turns the targets beside it wild, so the constellation charts as a triple. Press Play move to watch, then Next step to see how it's built.`;
    } else if (stepAt === 1) {
      shown = only(ex.position, []);
      status = `${STEP_TITLES[1]}. Plan it from the targets, before ring 1 is built. The ring 1 horizontal is the second clear, so every target beside it goes wild: targets in ring 1 next to or under it, and ring 2 targets directly above it. Click the three ring 1 cells where it turns the most targets wild (they're marked green).`;
    } else if (stepAt === 2) {
      shown = only(ex.position, [INNER, MIDDLE, TOP]);
      marks = pl.vertical.map((cell) => ({ cell, colour: yellow }));
      for (const cell of pl.lineups) marks.push({ cell, colour: red });
      const turn = ex.action.kind === 'rotate' ? ex.action : null;
      const offset = turn ? `${ringLabel(turn.ring)} is left one place out, so it doesn't clear until the last turn` : 'it is only completed by the last move';
      const top = ex.position.targets.filter((t) => t.ring === TOP);
      const under = pl.pair.concat(pl.gap).map((c) => linedUp(ex.action, c) % 8);
      const ring3 = top.length ? (top.some((t) => under.includes(t.octant))
        ? ' The ring 3 target sits over the horizontal, so it gets filled in step 3.'
        : ' The ring 3 target isn’t over the horizontal, so fill it now, while you build the vertical.') : '';
      status = `${STEP_TITLES[2]}. Build the ${colour(pl.vertical[0])} vertical through rings 1, 2 and 3 over that star (marked); ${offset}. While you build, never stack two of a colour anywhere else in rings 1 and 2 or rings 2 and 3, either as the rings sit now or after that last turn: one more of that colour turned or dropped onto them clears early. ${pl.lineups.length ? 'The red stars break that rule.' : 'Nothing does here.'}${ring3}`;
    } else {
      shown = ex.position;
      marks = [{ cell: pl.top, colour: yellow }];
      arrowRing = ex.action.kind === 'rotate' ? { ring: ex.action.ring, clockwise: ex.action.clockwise } : null;
      status = `${STEP_TITLES[3]}. Last, turn ring 4 so the star over the vertical (marked) is ${colour(pl.top)}, the pair's colour. Then ${moveText(ex.action)}: the vertical clears, that star drops into ring 1, and the horizontal turns the targets beside it wild. Press Play move.`;
    }
    captionText = STEP_TITLES[stepAt];
  }
  function pickHorizontal(cell: number): void {
    if (!stepEx || !plan || stepAt !== 1 || picked || busy()) return;
    if (Math.floor(cell / 8) !== INNER) return;
    const ex = stepEx, pl = plan, targets = ex.position.targets;
    const yellow = '#40ff70', blue = '#7fd8ff';
    chosen = chosen.includes(cell) ? chosen.filter((c) => c !== cell) : [...chosen, cell];
    marks = chosen.map((c) => ({ cell: c, colour: yellow }));
    if (chosen.length < 3) { status = `${chosen.length} of 3 picked. Click a picked cell again to unpick it.`; return; }
    const start = [0, 1, 2, 3, 4, 5, 6, 7].find((o) => innerRun(o).every((c) => chosen.includes(c)));
    if (start === undefined) { chosen = []; marks = []; status = 'A horizontal is three cells in a row in ring 1. Pick again.'; return; }
    const best = bestHorizontals(targets), wilded = wildedBy(targets, chosen);
    const where = (start: number) => innerRun(start).map((c) => OCTANT_NAMES[c % 8].toLowerCase()).join(', ');
    if (wilded.length < best.wild) {
      chosen = []; marks = [];
      status = `That turns ${wilded.length} target${wilded.length === 1 ? '' : 's'} wild. There's a spot that turns ${best.wild} wild: look for one under a ring 2 target that also reaches ring 1 targets either side. Pick again.`;
      return;
    }
    picked = true;
    for (const t of wilded) marks.push({ cell: t.ring * 8 + t.octant, colour: blue });
    const own = planHorizontal(ex, pl), ownWild = wildedBy(targets, own).length;
    const others = best.starts.filter((st) => st !== start);
    const same = own.length === 3 && own.every((c) => chosen.includes(c));
    status = `Yes: that turns ${wilded.length} target${wilded.length === 1 ? '' : 's'} wild (marked blue).${others.length ? ` ${others.length === 1 ? `So would ${where(others[0])}` : `${others.length} other spots do as well`}: which to build depends on the order the stars come in.` : ''} The vertical goes through one of the three cells: the ring 4 star drops into ring 1 there.${same ? ' It’s where this board builds it.' : ` This board builds it at ${own.map((c) => OCTANT_NAMES[c % 8].toLowerCase()).join(', ')}, turning ${ownWild} wild.`} Press Next step.`;
  }
  function playSteps(): void {
    if (!stepEx || busy()) return;
    const g = gameAt(stepEx.position);
    const list = act(g, stepEx.action);
    const o = outcome(list, positionOf(g));
    stepping = false; arrowRing = null; marks = []; shown = stepEx.position;
    sceneMarks = stepAt === 0 ? chainSceneMarks(list, stepEx.position, stepEx.action) : null;
    playScenes(list, captionsFor(o), () => {
      sceneMarks = null;
      shown = positionOf(g);
      captionText = o.charted ? `Charted as a ${chainName(o.charted).toLowerCase()}.` : 'Nothing charted.';
    });
  }

  // --- Plan a vertical triple ---
  let brush = 0, planBoard = 0, plansSolved = 0, planNextAt = 0;
  let planPaintWith: number | null = null, planPainting = false;
  let planMouse: [number, number] = [-1, -1];
  let paintedPlan: Position | null = null, revealedPlan: Position | null = null;
  let lastAcceptedPlan: Position | null = null;
  let revealedOptions: PlanningOption[] = [], revealedAt = 0;
  let planCheck: PlanCheck | null = null;
  let planNotice = '';
  const planDetails = document.createElement('section');
  planDetails.className = 'tutorial-plan-details'; planDetails.hidden = true;
  const planFeedback = document.createElement('p');
  planFeedback.setAttribute('role', 'status'); planFeedback.setAttribute('aria-live', 'polite');
  const answerNavigation = document.createElement('div'); answerNavigation.className = 'tutorial-answer-navigation';
  const previousAnswer = document.createElement('button'), nextAnswer = document.createElement('button');
  previousAnswer.type = nextAnswer.type = 'button';
  previousAnswer.className = nextAnswer.className = 'panel-button';
  previousAnswer.textContent = 'Previous answer'; nextAnswer.textContent = 'Next answer';
  previousAnswer.addEventListener('click', () => { if (mode === 'build') showBuildSolution(buildSolutionAt - 1); else showPlanOption(revealedAt - 1); screen.canvas.focus({ preventScroll: true }); });
  nextAnswer.addEventListener('click', () => { if (mode === 'build') showBuildSolution(buildSolutionAt + 1); else showPlanOption(revealedAt + 1); screen.canvas.focus({ preventScroll: true }); });
  const answerCount = document.createElement('span'); answerCount.setAttribute('aria-live', 'polite');
  answerNavigation.append(previousAnswer, answerCount, nextAnswer);
  planDetails.append(answerNavigation, planFeedback);
  screen.canvas.after(planDetails);

  function syncPlanDetails(): void {
    planDetails.hidden = mode !== 'build' && mode !== 'finish' && (mode !== 'plan' || (!planCheck && !revealedPlan && !planNotice));
    const solving = mode === 'build' && buildSolutionShown;
    answerNavigation.hidden = solving ? false : mode !== 'plan' || !revealedPlan;
    previousAnswer.textContent = solving ? 'Previous solution' : 'Previous answer';
    nextAnswer.textContent = solving ? 'Next solution' : 'Next answer';
    previousAnswer.disabled = nextAnswer.disabled = (solving ? buildSolutions.length : revealedOptions.length) < 2;
    const count = solving ? `Solution ${buildSolutionAt + 1} of ${buildSolutions.length}` : `Answer ${revealedAt + 1} of ${revealedOptions.length}`;
    if (answerCount.textContent !== count) answerCount.textContent = count;
    const message = mode === 'finish' ? status : mode === 'build' ? solving ? buildSolutionText() : status : planNotice || (revealedPlan ? status : planCheck?.message ?? '');
    if (planFeedback.textContent !== message) planFeedback.textContent = message;
    planDetails.classList.toggle('is-invalid', mode === 'finish' ? finishFailed : mode === 'build' ? buildFailed : !revealedPlan && !!planCheck && !planCheck.accepted);
  }
  const planInstructions = 'Paint three ring 1 stars: a pair and the first vertical star.';
  function newPlan(): void {
    paintedPlan = dealPlanningBoard(rng, opening());
    planNotice = '';
    planBoard++; planNextAt = 0; revealedPlan = null; planCheck = null;
    revealedOptions = []; revealedAt = 0;
    planPaintWith = null; planPainting = false;
    game = null; scenes = []; afterScenes = null; waiting = false; marks = []; arrowRing = null;
    shown = paintedPlan;
    captionText = `Board ${planBoard} · ${plansSolved} accepted`;
    status = planInstructions;
  }
  function markPlan(result: Pick<PlanCheck, 'accepted' | 'site'>): void {
    marks = result.site?.wilded.map((t) => ({ cell: t.ring * 8 + t.octant, colour: PLAN_WILD_OUTLINE })) ?? [];
    if (!result.accepted && paintedPlan?.cells.filter((c) => c !== EMPTY).length === 3) {
      paintedPlan.cells.forEach((c, cell) => { if (c !== EMPTY) marks.push({ cell, colour: PLAN_PROBLEM_OUTLINE }); });
    }
  }
  function paintPlanningCell(cell: number, colour = brush): void {
    if (!paintedPlan || revealedPlan || planNextAt) return;
    if (paintedPlan.cells[cell] === colour) return;
    planNotice = '';
    paintedPlan.cells[cell] = colour;
    shown = paintedPlan;
    planCheck = checkPlan(paintedPlan);
    status = planCheck.message;
    markPlan(planCheck);
    if (planCheck.accepted) {
      lastAcceptedPlan = { cells: [...paintedPlan.cells], targets: paintedPlan.targets.map((t) => ({ ...t })), entry: { ...paintedPlan.entry } };
      plansSolved++;
      planNextAt = ticks() + 2000;
      captionText = `Accepted · ${planCheck.site!.wilded.length} targets turn wild`;
    } else captionText = paintedPlan.cells.filter((c) => c !== EMPTY).length >= 3 ? planCheck.message.split('. ')[0] : `Board ${planBoard} · ${plansSolved} accepted`;
  }
  function paintPlanningAt(pos: [number, number], colour: number): void {
    const cell = cellAt(pos);
    if (cell) paintPlanningCell(cell.ring * 8 + cell.octant, colour);
  }
  function clearPlan(): void {
    if (!paintedPlan || planNextAt) return;
    paintedPlan.cells.fill(EMPTY); shown = paintedPlan;
    planPaintWith = null; planPainting = false;
    revealedPlan = null; planCheck = null; planNotice = ''; marks = []; status = planInstructions;
    revealedOptions = []; revealedAt = 0;
    captionText = `Board ${planBoard} · ${plansSolved} accepted`;
  }
  function revealPlan(): void {
    if (!paintedPlan || planNextAt) return;
    planNotice = '';
    planPaintWith = null; planPainting = false;
    if (revealedPlan) {
      revealedPlan = null; shown = paintedPlan; marks = [];
      status = planCheck?.message ?? planInstructions;
      if (planCheck) markPlan(planCheck);
      captionText = planCheck && paintedPlan.cells.filter((c) => c !== EMPTY).length >= 3
        ? planCheck.message.split('. ')[0] : `Board ${planBoard} · ${plansSolved} accepted`;
      return;
    }
    if (!revealedOptions.length) revealedOptions = planningOptions(paintedPlan.targets);
    if (!revealedOptions.length) {
      planNotice = 'No answer under the current rules.';
      captionText = planNotice;
      syncPlanDetails(); draw(ticks());
      return;
    }
    showPlanOption(revealedAt);
  }
  function showPlanOption(index: number): void {
    if (!paintedPlan || !revealedOptions.length || mode !== 'plan' || planNextAt) return;
    revealedAt = (index + revealedOptions.length) % revealedOptions.length;
    const { site, verticalColour, horizontalColour } = revealedOptions[revealedAt];
    revealedPlan = { ...paintedPlan, cells: paintPlan(site, verticalColour, horizontalColour) }; shown = revealedPlan;
    // This option was already validated when the board's answer list was made.
    markPlan({ accepted: true, site });
    captionText = `Answer ${revealedAt + 1} of ${revealedOptions.length} · ${COLOUR_NAMES[verticalColour]} vertical, ${COLOUR_NAMES[horizontalColour].toLowerCase()} pair`;
    status = `${site.wilded.length} targets turn wild. Keep at least one wrong until the second clear.`;
    // Answer browsing is a UI action: repaint immediately, even if the simulation is throttled.
    syncPlanDetails();
    draw(ticks());
  }

  // --- Build Ring 1: normal drops/turns, ending at the three-star plan. ---
  /** A fail always stays on the board that caused it until Space (retry), Enter (next) or R (new board). */
  const pauseBuildOnFail = true;
  let buildBoard = 0, buildsSolved = 0, buildMoves = 0, buildSeed = 1;
  let buildStart: Position | null = null, buildOptions: PlanningOption[] = [];
  let strictness = store.get<Strictness>('buildStrictness', 'standard');
  let buildStopped = false, buildFailed = false, buildResetPending = false, buildSubmitPending = false, buildNextAt = 0;
  const buildInstructions = 'Build three ring 1 stars. Press Enter to submit.';
  // Show solution: accepted plans drawn faintly over the player's board. Only a view; it never completes the board.
  let buildSolutions: PlanningOption[] = [], buildSolutionAt = 0, buildSolutionShown = false;
  function toggleBuildSolution(): void {
    if (buildSolutionShown) { buildSolutionShown = false; syncPlanDetails(); draw(ticks()); return; }
    buildSolutions = buildStart ? solutionsFor(shown, planningOptions(buildStart.targets)) : [];
    if (!buildSolutions.length) { status = 'No answer under the current rules.'; syncPlanDetails(); draw(ticks()); return; }
    buildSolutionShown = true;
    showBuildSolution(0);
  }
  function showBuildSolution(index: number): void {
    if (!buildSolutionShown || !buildSolutions.length) return;
    buildSolutionAt = (index + buildSolutions.length) % buildSolutions.length;
    syncPlanDetails(); draw(ticks());
  }
  function buildSolutionText(): string {
    const { site, verticalColour, horizontalColour } = buildSolutions[buildSolutionAt];
    const at = (cell: number) => OCTANT_NAMES[cell % 8].toLowerCase();
    const pair = site.horizontal.filter((cell) => cell !== site.vertical[0]).map(at).join(' and ');
    const beside = besideTop(shown.targets, site) ? ' Vertical beside the ring 3 target, so the build can finish early if the stars come early.' : '';
    return `${COLOUR_NAMES[horizontalColour]} pair at ${pair}, ${COLOUR_NAMES[verticalColour].toLowerCase()} vertical at ${at(site.vertical[0])}. `
      + `${site.wilded.length} targets turn wild (outlined). Keep at least one wrong until the second clear.${beside}`;
  }
  /** The shown solution's three ring 1 stars, for the faint goal drawing. */
  function buildSolutionGoal(): Position | null {
    if (mode !== 'build' || !buildSolutionShown || !buildSolutions.length) return null;
    const { site, verticalColour, horizontalColour } = buildSolutions[buildSolutionAt];
    return { ...shown, cells: paintPlan(site, verticalColour, horizontalColour) };
  }
  const buildSolutionMarks = () => mode === 'build' && buildSolutionShown && buildSolutions.length
    ? buildSolutions[buildSolutionAt].site.wilded.map((t) => ({ cell: t.ring * 8 + t.octant, colour: PLAN_WILD_OUTLINE })) : [];
  function newBuildPosition(fromPlan = false): void {
    const source = fromPlan ? lastAcceptedPlan ?? paintedPlan : null;
    const p = source ?? dealPlanningBoard(rng, opening());
    buildStart = { ...p, cells: p.cells.map(() => EMPTY), targets: p.targets.map((t) => ({ ...t })) };
    buildOptions = buildOptionsFor(buildStart.targets, strictness);
    buildSeed = rng.integer(1, 0x7fffffff); buildBoard++;
    resetBuildPosition();
  }
  function resetBuildPosition(): void {
    if (!buildStart) return;
    input.drain(); // Pending keys belonged to the previous attempt.
    game = new NavigationGame(SETTINGS, buildSeed, undefined, opening());
    game.targets = buildStart.targets.map((t) => ({ ...t }));
    shown = positionOf(game);
    scenes = []; afterScenes = null; waiting = false; marks = []; arrowRing = null;
    lastMove = null; replaying = false; replayWanted = false; settleAt = 0;
    selected = INNER; buildMoves = 0; buildStopped = false; buildFailed = false; buildSolutionShown = false;
    buildResetPending = false; buildSubmitPending = false; buildNextAt = 0;
    captionText = `Board ${buildBoard} · ${buildsSolved} built`;
    status = buildInstructions;
  }
  function failBuildPosition(issue: BuildIssue, p: Position): void {
    shown = p; scenes = []; afterScenes = null; waiting = false;
    buildStopped = true; buildFailed = true; buildNextAt = 0;
    buildSubmitPending = false;
    marks = issue.cells.map((cell) => ({ cell, colour: PLAN_PROBLEM_OUTLINE }));
    captionText = issue.message; status = pauseBuildOnFail ? `${issue.message} Space: retry · Enter: next.` : issue.message;
    if (FAIL_BUZZ) sounds.play('buzz', 0.6);
    buildResetPending = !pauseBuildOnFail;
    syncPlanDetails(); draw(ticks());
  }
  function submitBuildPosition(): void {
    if (!game || buildStopped || buildSubmitPending) return;
    buildSubmitPending = true;
    if (!busy()) judgeBuildPosition();
    else status = 'Finishing moves before judging…';
  }
  function judgeBuildPosition(): void {
    if (!game || buildStopped || busy()) return;
    buildSubmitPending = false;
    const p = positionOf(game);
    if (game.booched) { failBuildPosition({ message: 'That drop booched.', cells: [game.entry.octant] }, p); return; }
    if (game.constellations) { failBuildPosition({ message: 'The constellation cleared. Start a new board.', cells: [] }, p); return; }
    // Ring 2 may not be turned into place yet: judge its most logical position, silently.
    // The player's board stays as they left it, so map marked ring 2 cells back onto it.
    const { check: checked, turns, position: judged } = checkBuildTurned(p, buildOptions, true, strictness);
    const onBoard = (issue: BuildIssue): BuildIssue => ({ ...issue, cells: issue.cells.map((cell) => unturnedCell(cell, turns)) });
    if (checked.kind === 'failed') { failBuildPosition(onBoard(checked.issue), p); return; }
    if (checked.kind === 'building') {
      // A combo the player built that the planning rules reject says why, not just "finish".
      failBuildPosition(onBoard(builtComboIssue(judged, 1, buildOptions, strictness) ?? { message: 'Finish the three-star ring 1 plan.', cells: [] }), p); return;
    }
    shown = p; buildStopped = true; buildFailed = false; buildsSolved++;
    buildNextAt = ticks() + 1;
    marks = checked.plan.site.horizontal.map((cell) => ({ cell, colour: PLAN_WILD_OUTLINE }));
    const warnings = checked.warnings ?? [];
    // Suboptimal points: accepted, but said, with their cells marked in a softer colour.
    for (const w of warnings) for (const cell of w.cells) marks.push({ cell: unturnedCell(cell, turns), colour: PLAN_WARNING_OUTLINE });
    captionText = warnings.length ? 'Position built (suboptimal)' : 'Position built';
    status = warnings.length
      ? `Position built, but: ${warnings.map((w) => `${w.message.replace(/\.$/, '')} (suboptimal)`).join('; ')}. Next board…`
      : 'Position built. Next board…';
    syncPlanDetails(); draw(ticks());
  }
  function buildPositionMove(action: Action): void {
    if (!game || !buildStart || buildStopped || buildSubmitPending) return;
    if (busy()) return;
    const g = game;
    const list = act(g, action);
    if (!list.length) {
      if (g.booched) { shown = positionOf(g); captionText = 'Board booched'; status = 'Board booched. Press Enter to submit.'; }
      if (buildSubmitPending) judgeBuildPosition();
      return;
    }
    buildMoves++;
    marks = []; stepping = false;
    captionText = `Board ${buildBoard} · ${buildMoves} moves · Enter to submit`;
    status = buildSubmitPending ? 'Finishing moves before judging…' : buildInstructions;
    // While you play, link captions stay off the board; the example, replays and step-through keep them.
    playScenes(list, new Map(), () => {
      shown = positionOf(g);
      if (buildSubmitPending) judgeBuildPosition();
    });
  }

  // --- Finish the Combo: the first bag is placed; play on with the game's next stars to the triple. ---
  let finishDeal: FinishDeal | null = null, finishOptions: PlanningOption[] = [];
  let finishBoard = 0, finishSolved = 0, finishMoves = 0, finishNextAt = 0;
  let finishStopped = false, finishFailed = false, finishHintShown = false;
  const finishInstructions = 'Finish the vertical through rings 1–3 with the pair’s colour in ring 4 above it, fill the targets that won’t turn wild, and set it off.';
  function newFinish(): void {
    finishDeal = dealFinish(rng, strictness, opening());
    finishOptions = buildOptionsFor(finishDeal.position.targets, strictness);
    finishBoard++;
    resetFinish();
  }
  function resetFinish(): void {
    if (!finishDeal) return;
    input.drain();
    game = finishGame(finishDeal);
    shown = positionOf(game);
    scenes = []; afterScenes = null; waiting = false; marks = []; arrowRing = null;
    lastMove = null; replaying = false; replayWanted = false;
    selected = TOP; finishMoves = 0; finishStopped = false; finishFailed = false; finishNextAt = 0;
    captionText = `Board ${finishBoard} · ${finishSolved} finished`;
    status = finishInstructions;
  }
  function failFinish(issue: BuildIssue, p: Position): void {
    shown = p; scenes = []; afterScenes = null; waiting = false;
    finishStopped = true; finishFailed = true;
    marks = issue.cells.map((cell) => ({ cell, colour: PLAN_PROBLEM_OUTLINE }));
    captionText = issue.message; status = `${issue.message} Space: retry · Enter: next.`;
    if (FAIL_BUZZ) sounds.play('buzz', 0.6);
    syncPlanDetails(); draw(ticks());
  }
  function finishMove(action: Action): void {
    if (!game || !finishDeal || finishStopped) return;
    if (busy()) return;
    const g = game;
    const before = positionOf(g);
    const list = act(g, action);
    const after = positionOf(g);
    if (!list.length && !g.booched) return;
    lastMove = { before, action };
    finishMoves++; marks = []; stepping = false;
    const o = outcome(list, after);
    const judge = () => {
      shown = positionOf(g);
      const result = judgeFinish(o, after, g.booched, finishOptions, strictness, lesson().accepts);
      if (result.kind === 'failed') { failFinish(result.issue, shown); return; }
      if (result.kind === 'success') {
        finishStopped = true; finishFailed = false; finishSolved++;
        finishNextAt = ticks() + 2500;
        captionText = 'Triple!'; status = `Yes! ${lesson().success} Next board…`;
        return;
      }
      // Suboptimal pieces: keep playing, but say so, with their cells in the softer colour.
      marks = result.warnings.flatMap((w) => w.cells.map((cell) => ({ cell, colour: PLAN_WARNING_OUTLINE })));
      captionText = `Board ${finishBoard} · ${finishMoves} moves`;
      status = result.warnings.length ? `Careful: ${result.warnings.map((w) => `${w.message.replace(/\.$/, '')} (suboptimal)`).join('; ')}.` : finishInstructions;
    };
    if (!list.length) { judge(); return; }
    playScenes(list, new Map(), judge);
  }
  function toggleFinishHint(): void { finishHintShown = !finishHintShown; draw(ticks()); }

  // --- Build from scratch ---
  /** Off for now: the red marks and buzz for stacked line-ups while building from scratch, to come back once they're reliable. */
  const LINEUP_WARNINGS = false;
  /** What the board looks like it's building, and the line-ups already buzzed for. */
  let guess: BuildGuess | null = null, buzzed = new Set<string>();
  /** The last move with the board before it, to replay slowly. */
  let lastMove: { before: Position; action: Action } | null = null;
  let replayWanted = false;
  function replayLast(): void {
    if (!lastMove || !game || replaying) return;
    // Pressed while a move plays out: replay once it has finished.
    if (busy()) { replayWanted = true; return; }
    const g = gameAt(lastMove.before);
    const list = act(g, lastMove.action);
    const o = outcome(list, positionOf(g));
    const live = game;
    replaying = true; stepping = false; marks = []; shown = lastMove.before;
    captionText = `Last move: ${moveText(lastMove.action, lastMove.action.kind === 'drop' ? lastMove.before.entry : undefined)}`;
    playScenes(list, captionsFor(o), () => { replaying = false; shown = positionOf(live); captionText = ''; if (mode === 'scratch') checkScratch(); });
  }
  function newScratch(): void {
    game = new NavigationGame(SETTINGS, rng.integer(1, 0x7fffffff), undefined, opening());
    start = null; upcoming = []; goal = null;
    shown = positionOf(game);
    scenes = []; afterScenes = null; waiting = false; replaying = false; replayWanted = false; settleAt = 0; stable = 0; judged = null; lastMove = null; marks = []; arrowRing = null; moves = 0; selected = RINGS - 1; guess = null; buzzed = new Set();
    captionText = '';
    status = LINEUP_WARNINGS ? 'Build vertical triples from scratch. When the board looks like one is being built, its stars are marked, and a buzz sounds if two of a colour are stacked in rings 1 and 2 or rings 2 and 3 (as the rings sit, or after the turn you’re saving), since one more of that colour would clear them early.' : 'Build vertical triples from scratch. When the board looks like one is being built, its stars are marked.';
  }
  /** When the board has sat still long enough to judge (ms), and how many judgements in a row saw the same build. */
  let settleAt = 0, stable = 0, judged: BuildGuess | null = null;
  const SETTLE_MS = 700;
  /** After each move: mark what the board looks like it's building, and judge it once play pauses. */
  function checkScratch(): void {
    if (!game) return;
    guess = guessBuild(game.board.cells, game.targets, guess);
    marks = [];
    settleAt = ticks() + SETTLE_MS;
    if (!guess) { status = 'No vertical triple in sight yet.'; return; }
    for (const c of [...guess.vertical, ...guess.pair]) marks.push({ cell: c, colour: '#7fd8ff' });
    if (!LINEUP_WARNINGS) { status = buildText(guess); return; }
    for (const [a, b] of guess.lineups) marks.push({ cell: a, colour: '#ff4040' }, { cell: b, colour: '#ff4040' });
    status = `${buildText(guess)} ${guess.lineups.length ? 'Two of a colour are stacked (marked red).' : 'Nothing is stacked that could clear early.'}`;
  }
  function buildText(g: BuildGuess): string {
    return `Looks like a ${COLOUR_NAMES[g.colour].toLowerCase()} vertical over ${OCTANT_NAMES[g.column].toLowerCase()}${g.turn ? `, lined up by ${moveText(g.turn)}` : ''}.`;
  }
  /**
   * Once play has paused: buzz for a new line-up, but only when sure of the build, that is when the
   * same build has been seen two pauses running, or its vertical is complete bar the last turn.
   */
  function judgeScratch(): void {
    settleAt = 0;
    if (!game || !guess) { stable = 0; judged = null; buzzed = new Set(); return; }
    const same = !!judged && judged.column === guess.column && judged.colour === guess.colour;
    stable = same ? stable + 1 : 1; judged = guess;
    const sure = stable >= 2 || guess.vertical.length === 3;
    const keys = new Set(guess.lineups.map(([a, b]) => `${a}-${b}-${game!.board.cells[a]}`));
    if (!sure || !LINEUP_WARNINGS) return;
    if ([...keys].some((k) => !buzzed.has(k))) {
      sounds.play('buzz', 0.6);
      status = `${buildText(guess)} Two of a colour are stacked (marked red): one more of that colour on them clears early and can spoil the chain.`;
    }
    buzzed = keys;
  }

  // --- Practice ---
  function newPractice(): void {
    const l = lesson();
    if (!STAGES.some((st) => st.value === stage)) stage = 0;
    for (let tries = 0; tries < 20; tries++) {
      const seed = l.moments[rng.integer(0, l.moments.length - 1)];
      const ex = generate(seed, l.accepts, rng, l.keep);
      let dealt: { position: Position; solution: Action[] } | null;
      dealtUpcoming = [];
      if (stage < 0) {
        const h = buildUpAtMost(ex.position, rng, -stage);
        if (!h) continue;
        dealt = { position: h.boards[0], solution: [...h.moves, ex.action] };
        dealtUpcoming = [...dropEntries(h), ex.position.entry];
      } else dealt = stage ? scramble(ex, stage, l.accepts, rng) : { position: ex.position, solution: [ex.action] };
      if (!dealt) continue;
      start = dealt.position; solution = dealt.solution; goal = stage < 0 ? ex.position : null;
      const drops = solution.filter((a) => a.kind === 'drop').length;
      practiceGoal = stage < 0
        ? `Goal: ${l.goal} Then ${moveText(ex.action)} to set off the ${l.title.toLowerCase()}. ${drops} star${drops === 1 ? '' : 's'} still to come, each falling where the game puts it: turn the rings to take them where they belong. The finished board is shown faintly.`
        : `Goal: ${l.goal} ${stage ? `It’s ${stage + 1} moves away.` : 'One move does it.'}`;
      resetPractice();
      return;
    }
    status = 'Couldn’t deal that stage just now. Try again, or try an earlier stage.';
  }
  /**
   * Stops a move playing out, as Ctrl does. Play buttons that start a new board call it instead of greying
   * out while a move plays, which made them flash on every move.
   */
  function stopScenes(): void {
    scenes = []; afterScenes = null; waiting = false; stepping = false; replaying = false; sceneMarks = null;
  }
  function resetPractice(): void {
    if (!start) return;
    game = gameAt(start, rng.integer(1, 0x7fffffff));
    upcoming = dealtUpcoming.map((e) => ({ ...e }));
    if (upcoming.length) game.entry = upcoming.shift()!;
    shown = positionOf(game);
    scenes = []; marks = []; arrowRing = null; moves = 0; selected = RINGS - 1;
    captionText = ''; status = practiceGoal;
  }
  function answerText(): string {
    const stars = [start!.entry, ...dealtUpcoming].slice(dealtUpcoming.length ? 1 : 0);
    let next = 0;
    return solution.map((a, i) => `${i + 1}. ${moveText(a, a.kind === 'drop' ? stars[next++] : undefined)}`).join(', ');
  }
  /** After a drop in a build-up stage, the next star is the next one in the build. */
  function nextStar(g: NavigationGame, action: Action): void {
    if (action.kind === 'drop' && upcoming.length) g.entry = upcoming.shift()!;
  }
  function practiceMove(action: Action): void {
    if (!game || !playing()) return;
    if (isTraining()) { trainingMove(action); return; }
    if (mode === 'build') { buildPositionMove(action); return; }
    if (mode === 'finish') { finishMove(action); return; }
    if (mode === 'donkey') { donkeyMove(action); return; }
    if (mode === 'donkeyring') { donkeyRingMove(action); return; }
    if (mode === 'donkeybase' || mode === 'donkeylayer') { donkeyStageMove(action); return; }
    if (isR3()) { r3Move(action); return; }
    if (mode === 'aftertriple') { afterTripleMove(action); return; }
    // A move made while one plays out is dropped, as in the game: nothing waits its turn.
    if (busy()) return;
    if (mode === 'scratch') lastMove = { before: positionOf(game), action };
    if (action.kind === 'drop' && game.board.get(game.entry.octant, 0) !== EMPTY) { status = 'That drop would booch the board.'; return; }
    const list = act(game, action);
    if (!list.length) return;
    nextStar(game, action);
    moves++;
    const o = outcome(list, positionOf(game));
    const g = game;
    stepping = false;
    playScenes(list, captionsFor(o), () => {
      shown = positionOf(g);
      if (mode === 'scratch') {
        checkScratch();
        if (replayWanted) { replayWanted = false; replayLast(); }
        return;
      }
      if (!o.links.length) { status = `${moves} move${moves > 1 ? 's' : ''} so far.`; return; }
      if (lesson().accepts(o)) status = `Yes! ${lesson().success}`;
      else status = `That set off ${o.charted ? `a ${chainName(o.charted).toLowerCase()}` : 'a clear'}, but not a ${lesson().title.toLowerCase()}. Reset to try again, or Show answer.`;
    });
  }
  function showAnswer(): void {
    if (!start || busy()) return;
    resetPractice();
    const g = game!;
    const queue = [...solution];
    const next = () => {
      const action = queue.shift();
      if (!action) return;
      const before = g.entry;
      const list = act(g, action);
      nextStar(g, action);
      const o = outcome(list, positionOf(g));
      status = `Answer: ${answerText()}.`;
      captionText = moveText(action, before);
      stepping = false;
      playScenes(paced(list, g), captionsFor(o), () => { shown = positionOf(g); if (queue.length) next(); });
    };
    next();
  }

  // --- Practice stats (optional, Settings): per board drill and lesson, by session ---
  let showStats = store.get<boolean>('showPracticeStats', false);
  /** The constellation freshly dealt practice and build boards start from: 3/2/1 (mid-game) or the game's 1/2/1 opening. */
  type StartingBoard = '321' | '121';
  let startingBoard: StartingBoard = store.get<StartingBoard>('startingBoard', '321') === '121' ? '121' : '321';
  const opening = () => startingBoard === '121';
  /** The drill and lesson the open session belongs to, while one is open. */
  let statsOpen: string | null = null;
  const statsCache = new Map<string, ModeStats>();
  const statsKeyFor = (m: Mode): string | null => (m === 'donkey' || m === 'donkeyring' || m === 'donkeybase' || m === 'donkeylayer' || isR3(m) || m.startsWith('cascade-') || m === 'practise' ? `${m}:${lesson().id}` : null);
  function statsFor(key: string): ModeStats {
    let stats = statsCache.get(key);
    if (!stats) {
      // A session left open by a reload or a closed page is finished now.
      stats = loadModeStats(store.get<ModeStats | null>(`practiceStats:${key}`, null));
      statsCache.set(key, stats); store.set(`practiceStats:${key}`, stats);
    }
    return stats;
  }
  function saveStats(key: string, stats: ModeStats): void {
    const sessions = statsFor(key).history.length;
    statsCache.set(key, stats); store.set(`practiceStats:${key}`, stats);
    if (stats.history.length !== sessions || stats.current?.last === stats.current?.start) renderStats();
  }
  /** A move on a counted board: keeps the session going, or starts one after 30 idle minutes. */
  function recordMove(): void {
    const key = statsKeyFor(mode);
    if (!key) return;
    if (statsOpen && statsOpen !== key) endStats();
    statsOpen = key;
    saveStats(key, noteMove(statsFor(key), Date.now()));
  }
  /** A board finished: passed in `ms` from its first move, or failed. */
  /** Time since a board's first move (0 if it had none). */
  const since = (first: number | null | undefined) => (first ? Date.now() - first : 0);
  function recordAttempt(passed: boolean, ms = 0): void {
    const key = statsKeyFor(mode);
    if (!key) return;
    if (statsOpen && statsOpen !== key) endStats();
    statsOpen = key;
    saveStats(key, noteAttempt(statsFor(key), Date.now(), passed, ms));
    renderStats();
  }
  function endStats(): void {
    if (!statsOpen) return;
    const key = statsOpen;
    statsOpen = null;
    saveStats(key, endSession(statsFor(key)));
    renderStats();
  }
  const statsViews: { mode: Mode; element: HTMLElement }[] = [];
  /** A row of the table: boards, fail rate and the two average times. */
  function statsRow(label: string, s: Stats): HTMLElement[] {
    return [label, String(s.attempts), percent(s.failRate), seconds(s.completionMs), seconds(s.fastestMs), seconds(s.slowestMs), seconds(s.totalMs)].map((text, i) => {
      const cell = document.createElement('span');
      cell.textContent = text;
      if (i) cell.style.textAlign = 'right';
      return cell;
    });
  }
  /** A small line chart, one point per session, the current session last and highlighted. */
  function statsChart(title: string, values: (number | null)[], format: (v: number | null) => string, currentLast: boolean): HTMLElement {
    const box = document.createElement('div');
    box.style.cssText = 'margin-top:6px';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;opacity:0.85';
    const last = values.at(-1) ?? null;
    head.append(Object.assign(document.createElement('span'), { textContent: title }), Object.assign(document.createElement('span'), { textContent: format(last) }));
    const W = 220, H = 40, pad = 5;
    const known = values.filter((v): v is number => v !== null);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', '100%'); svg.setAttribute('height', String(H));
    svg.style.display = 'block';
    if (known.length) {
      const lo = Math.min(...known, 0), hi = Math.max(...known) || 1;
      const x = (i: number) => values.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (values.length - 1);
      const y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - 2 * pad);
      const points = values.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.setAttribute('points', points); line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'currentColor');
      line.setAttribute('stroke-opacity', '0.5'); line.setAttribute('stroke-width', '1.5');
      svg.append(line);
      values.forEach((v, i) => {
        if (v === null) return;
        const current = currentLast && i === values.length - 1;
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', x(i).toFixed(1)); dot.setAttribute('cy', y(v).toFixed(1));
        dot.setAttribute('r', current ? '4' : '2.5');
        dot.setAttribute('fill', current ? '#4ad8ff' : 'currentColor');
        if (!current) dot.setAttribute('fill-opacity', '0.7');
        svg.append(dot);
      });
    }
    box.append(head, svg);
    return box;
  }
  /** Practice drills always show their time to pass, even with the full stats off. */
  const practiceDrill = (m: Mode) => m === 'practise' || m === 'donkey' || m === 'cascade-practice';
  const headlines: { mode: Mode; element: HTMLElement }[] = [];
  function renderStats(): void {
    for (const view of headlines) {
      const key = statsKeyFor(view.mode);
      if (showStats || view.mode !== mode || !key) { view.element.replaceChildren(); continue; }
      const stats = statsFor(key);
      const current = stats.current && stats.current.attempts > 0 ? stats.current : null;
      const now = statsOf(current ? [current] : []), recent = statsOf(stats.history.slice(-10));
      view.element.textContent = `Time to pass: ${seconds(now.totalMs)} this session · ${seconds(recent.totalMs)} last 10`;
    }
    for (const view of statsViews) {
      const key = statsKeyFor(view.mode);
      if (!showStats || view.mode !== mode || !key) { view.element.replaceChildren(); continue; }
      const stats = statsFor(key);
      const current = stats.current && stats.current.attempts > 0 ? stats.current : null;
      const recent = stats.history.slice(-10);
      const table = document.createElement('div');
      table.style.cssText = 'display:grid;grid-template-columns:auto repeat(6, auto);gap:2px 6px;font-size:11px;white-space:nowrap;margin-top:4px';
      const heads = [['', ''], ['Boards', 'Boards played'], ['Fails', 'Fail rate'], ['Avg', 'Average completion time'], ['Fastest', 'Fastest completion'], ['Slowest', 'Slowest completion'], ['Time to pass', `Expected time per pass: all pass and fail time, plus ${FAIL_PENALTY_S} s per fail, over the passes`]];
      for (const [i, [text, title]] of heads.entries()) {
        const cell = document.createElement('span');
        cell.textContent = text; cell.title = title; cell.style.opacity = '0.7';
        if (i) cell.style.textAlign = 'right';
        table.append(cell);
      }
      table.append(...statsRow('This session', statsOf(current ? [current] : [])), ...statsRow('Last 10', statsOf(recent)));
      // One point per session: the last 10 finished, then this one.
      const sessions: Session[] = current ? [...recent, current] : recent;
      const per = sessions.map((s) => statsOf([s]));
      const charts = sessions.length ? [
        statsChart('Fail rate', per.map((s) => s.failRate), percent, !!current),
        statsChart('Avg completion', per.map((s) => s.completionMs), seconds, !!current),
        statsChart('Time to pass', per.map((s) => s.totalMs), seconds, !!current),
      ] : [];
      view.element.replaceChildren(table, ...charts);
    }
  }
  /** The stats table, charts and Reset stats button in a drill's panel, shown while Show practice stats is on. */
  function addStats(group: ReturnType<typeof panel.group>, drill: Mode): void {
    const element = document.createElement('div');
    statsViews.push({ mode: drill, element });
    group.append(element, { hidden: () => !showStats });
    if (practiceDrill(drill)) {
      const headline = document.createElement('div');
      headline.style.cssText = 'font-size:12px;opacity:0.85;margin-top:4px';
      headlines.push({ mode: drill, element: headline });
      group.append(headline, { hidden: () => showStats });
    }
    group.button('Reset stats', () => {
      const key = statsKeyFor(mode);
      if (!key) return;
      if (statsOpen === key) statsOpen = null;
      saveStats(key, { current: null, history: [] });
      renderStats();
    }, { hidden: () => !showStats, title: 'Clear this drill’s stats for this lesson' });
  }

  // --- Ring 3 topics: Fill the targets, Stack the pair, Build the combo ---
  const isR3 = (m: Mode = mode) => m === 'r3fill' || m === 'r3stack' || m === 'r3build';
  let r3Board = 0, r3Done = 0, r3Moves = 0, r3FirstMove = 0;
  let r3Stopped = false, r3Failed = false, r3ResetPending = false, r3SubmitPending = false, r3NextAt = 0;
  /** The board as dealt (for Retry) and the game's seed for its drops. */
  let r3Deal: { position: Position; seed: number } | null = null;
  function newR3(): void {
    r3Unjudged();
    for (let tries = 0; tries < 60; tries++) {
      const seed = rng.integer(1, 0x7fffffff);
      const dealt = new NavigationGame(SETTINGS, seed, undefined, opening());
      const fresh = positionOf(dealt);
      if (!hasRing3Target(fresh.targets)) continue;
      // Ring 3 into a vertical needs a column beside the ring 3 target with no target in it.
      if (lesson().id === 'drop-in-vertical' && !verticalColumns(fresh.targets).length) continue;
      // Build the combo starts from rings 1 and 2 already built; the others from an empty board.
      const position = mode === 'r3build' ? dealFilled(rng, fresh, lesson().id === 'drop-in-vertical', lesson().id === 'top-double') : fresh;
      if (!position) continue;
      r3Deal = { position, seed };
      r3Board++;
      resetR3();
      return;
    }
    status = 'Couldn’t deal a board just now. Try again.';
  }
  /** Leaving a board with moves on it before it was judged counts as a fail. */
  function r3Unjudged(): void {
    if (isR3() && game && !r3Stopped && r3Moves > 0) recordAttempt(false, since(r3FirstMove));
  }
  function resetR3(): void {
    r3Unjudged();
    if (!r3Deal) return;
    input.drain(); // Pending keys belonged to the previous attempt.
    game = new NavigationGame(SETTINGS, r3Deal.seed, undefined, opening());
    r3Deal.position.cells.forEach((c, i) => { game!.board.cells[i] = c; });
    game.targets = r3Deal.position.targets.map((t) => ({ ...t }));
    shown = positionOf(game);
    scenes = []; afterScenes = null; waiting = false; marks = []; arrowRing = null;
    selected = mode === 'r3build' ? TOP : INNER; r3Moves = 0; r3FirstMove = 0;
    r3Stopped = false; r3Failed = false; r3ResetPending = false; r3SubmitPending = false; r3NextAt = 0;
    captionText = `Board ${r3Board} · ${r3Done} done`;
    status = '';
  }
  function failR3(message: string, cells: number[]): void {
    if (game) shown = positionOf(game);
    scenes = []; afterScenes = null; waiting = false;
    r3Stopped = true; r3Failed = true; r3SubmitPending = false; r3NextAt = 0;
    marks = cells.map((cell) => ({ cell, colour: PLAN_PROBLEM_OUTLINE }));
    captionText = message;
    status = pauseBuildOnFail ? `${message} Space: retry · Enter: next.` : message;
    if (FAIL_BUZZ) sounds.play('buzz', 0.6);
    r3ResetPending = !pauseBuildOnFail;
    recordAttempt(false, since(r3FirstMove));
  }
  function passR3(caption: string): void {
    r3Stopped = true; r3Failed = false; r3Done++;
    r3NextAt = ticks() + (mode === 'r3build' ? 900 : 1);
    captionText = caption;
    recordAttempt(true, since(r3FirstMove));
  }
  /** Fill the targets and Stack the pair are judged after every move (Stack the pair once ring 2 is full, or on Enter). */
  function judgeR3Now(final: boolean): void {
    if (!game || mode === 'r3build' || r3Stopped || busy()) return;
    const p = positionOf(game);
    const judged = mode === 'r3fill' ? judgeFill(p, lesson().id !== 'top-triple') : judgeStack(p, final);
    if (judged.kind === 'building') {
      if (final) failR3('Not done yet.', []);
      return;
    }
    if (judged.kind === 'fail') { failR3(judged.message, judged.cells); return; }
    passR3(mode === 'r3fill' ? 'Targets filled' : 'Pair stacked');
  }
  function submitR3(): void {
    if (!game || r3Stopped || mode === 'r3build') return;
    if (busy()) { r3SubmitPending = true; return; }
    judgeR3Now(true);
  }
  function r3Move(action: Action): void {
    if (!game || r3Stopped) return;
    if (busy()) return;
    const g = game;
    const list = act(g, action);
    if (!list.length) {
      if (g.booched) { failR3('That drop booched.', [g.entry.octant]); return; }
      if (r3SubmitPending) judgeR3Now(true);
      return;
    }
    r3Moves++;
    if (!r3FirstMove) r3FirstMove = Date.now();
    recordMove();
    marks = [];
    const o = outcome(list, positionOf(g));
    const cleared = o.links.flatMap((l) => l.scene.clear?.cells.map((c) => c.ring * 8 + c.octant) ?? []);
    captionText = `Board ${r3Board} · ${r3Moves} moves`;
    // Build the combo: the move that sets something off is the one judged. Its links play without captions.
    const judgedMove = mode === 'r3build' && o.links.length > 0;
    playScenes(list, new Map(), () => {
      shown = positionOf(g);
      if (mode === 'r3build') {
        if (judgedMove) {
          const judged = judgeCombo(o, lesson().accepts, lesson().title);
          if (judged.kind === 'pass') passR3(lesson().success.split(':')[0]);
          else if (judged.kind === 'fail') failR3(judged.message, judged.cells);
          return;
        }
      } else if (cleared.length) {
        failR3(o.charted ? 'The constellation charted.' : 'A clear went off.', cleared);
        return;
      } else judgeR3Now(false);
      if (r3Stopped) return;
      if (r3SubmitPending) judgeR3Now(true);
    });
  }

  // --- Donkey lessons 3 and 4: the base turned into position, then layer 2 built on it ---
  const isStage = (m: Mode = mode) => m === 'donkeybase' || m === 'donkeylayer';
  let stageBoard = 0, stagesDone = 0, stageMoves = 0, stageFirstMove = 0;
  let stageStopped = false, stageFailed = false, stageResetPending = false, stageSubmitPending = false, stageNextAt = 0;
  /** The board as dealt (for Retry), the base's roles in the dealt turn, and the game's seed for its drops. */
  let stageDeal: { position: Position; base: DealtBase; seed: number } | null = null;
  /** How far rings 1 and 2 have turned since the deal. */
  let stageTurns: Turns = { ring1: 0, ring2: 0 };
  function newDonkeyStage(): void {
    stageUnjudged();
    for (let tries = 0; tries < 60; tries++) {
      const seed = rng.integer(1, 0x7fffffff);
      const dealtGame = donkeyGame(seed, opening());
      const dealt = dealBase(rng, dealtGame.targets);
      if (!dealt) continue;
      // Lesson 3 deals the base turned out of position; lesson 4 deals it in position.
      const cells = mode === 'donkeybase' ? scrambleBase(rng, dealt.cells, dealtGame.targets) : dealt.cells;
      if (!cells) continue;
      const position: Position = { cells, targets: dealtGame.targets.map((t) => ({ ...t })), entry: { ...dealtGame.entry } };
      if (!settled(position)) continue;
      stageDeal = { position, base: dealt.base, seed };
      stageBoard++;
      resetDonkeyStage();
      return;
    }
    status = 'Couldn’t deal a board just now. Try again.';
  }
  /** Leaving a board with moves on it before it was judged counts as a fail. */
  function stageUnjudged(): void {
    if (isStage() && game && !stageStopped && stageMoves > 0) recordAttempt(false, since(stageFirstMove));
  }
  function resetDonkeyStage(): void {
    stageUnjudged();
    if (!stageDeal) return;
    input.drain(); // Pending keys belonged to the previous attempt.
    game = donkeyGame(stageDeal.seed, opening());
    stageDeal.position.cells.forEach((c, i) => { game!.board.cells[i] = c; });
    game.targets = stageDeal.position.targets.map((t) => ({ ...t }));
    shown = positionOf(game);
    scenes = []; afterScenes = null; waiting = false; marks = []; arrowRing = null;
    selected = mode === 'donkeybase' ? INNER : MIDDLE; stageMoves = 0; stageFirstMove = 0; stageTurns = { ring1: 0, ring2: 0 };
    stageStopped = false; stageFailed = false; stageResetPending = false; stageSubmitPending = false; stageNextAt = 0;
    captionText = `Board ${stageBoard} · ${stagesDone} done`;
    status = '';
  }
  function failDonkeyStage(message: string, cells: number[]): void {
    if (game) shown = positionOf(game);
    scenes = []; afterScenes = null; waiting = false;
    stageStopped = true; stageFailed = true; stageSubmitPending = false; stageNextAt = 0;
    marks = cells.map((cell) => ({ cell, colour: PLAN_PROBLEM_OUTLINE }));
    captionText = message;
    status = pauseBuildOnFail ? `${message} Space: retry · Enter: next.` : message;
    if (FAIL_BUZZ) sounds.play('buzz', 0.6);
    stageResetPending = !pauseBuildOnFail;
    recordAttempt(false, since(stageFirstMove));
  }
  /** Lesson 3 passes as soon as the base is in a good position and fails only on Enter; lesson 4 is judged once ring 2 is full. */
  function judgeDonkeyStageNow(final: boolean): void {
    if (!game || !stageDeal || stageStopped || busy()) return;
    const cells = game.board.cells;
    const judged = mode === 'donkeybase' ? judgeBasePosition(cells, game.targets) : judgeLayer2(cells, game.targets, stageDeal.base, stageTurns, final);
    if (mode === 'donkeylayer' && judged.kind !== 'fail' && (final || LIVE_STACK_WARNINGS)) {
      // Stacks are warned about, not failed: ringed softly, with the last one said.
      const warnings = layer2Warnings(cells, stageDeal.base, stageTurns);
      marks = warnings.flatMap((w) => w.cells.map((cell) => ({ cell, colour: PLAN_WARNING_OUTLINE })));
      status = warnings.at(-1)?.message ?? '';
    }
    if (judged.kind === 'building') return;
    if (judged.kind === 'fail') { if (final || mode === 'donkeylayer') failDonkeyStage(judged.message, judged.cells); return; }
    stageStopped = true; stageFailed = false; stagesDone++;
    stageNextAt = ticks() + 1;
    captionText = mode === 'donkeybase' ? 'In position' : 'Layer 2 built';
    recordAttempt(true, Date.now() - (stageFirstMove || Date.now()));
  }
  function submitDonkeyStage(): void {
    if (!game || stageStopped) return;
    if (busy()) { stageSubmitPending = true; return; }
    judgeDonkeyStageNow(true);
  }
  const ring2Full = (cells: number[]) => [0, 1, 2, 3, 4, 5, 6, 7].every((o) => cells[MIDDLE * 8 + o] !== EMPTY);
  function donkeyStageMove(action: Action): void {
    if (!game || stageStopped) return;
    if (busy()) return;
    // Lesson 3 is turns only; in lesson 4 a drop with ring 2 full judges the board as it is.
    if (action.kind === 'drop' && mode === 'donkeybase') return;
    if (action.kind === 'drop' && ring2Full(game.board.cells)) { judgeDonkeyStageNow(true); return; }
    const g = game;
    const list = act(g, action);
    if (!list.length) {
      if (g.booched) { failDonkeyStage('That drop booched.', [g.entry.octant]); return; }
      if (stageSubmitPending) judgeDonkeyStageNow(true);
      return;
    }
    // A clockwise turn moves each star one octant down.
    if (action.kind === 'rotate' && action.ring === INNER) stageTurns.ring1 += action.clockwise ? -1 : 1;
    if (action.kind === 'rotate' && action.ring === MIDDLE) stageTurns.ring2 += action.clockwise ? -1 : 1;
    stageMoves++;
    if (!stageFirstMove) stageFirstMove = Date.now();
    recordMove();
    marks = [];
    const o = outcome(list, positionOf(g));
    const cleared = o.links.flatMap((l) => l.scene.clear?.cells.map((c) => c.ring * 8 + c.octant) ?? []);
    const charted = o.links.some((l) => l.kind === 'target');
    captionText = `Board ${stageBoard} · ${stageMoves} moves`;
    playScenes(list, new Map(), () => {
      shown = positionOf(g);
      if (cleared.length) { failDonkeyStage(charted ? 'The constellation charted.' : 'A clear went off.', cleared); return; }
      judgeDonkeyStageNow(false);
      if (stageStopped) return;
      if (stageSubmitPending) judgeDonkeyStageNow(true);
    });
  }

  // --- Donkey Build Ring 1: ring 1 from the first bag, in the donkey shape (A A B B C C D E) ---
  let ringBoard = 0, ringsBuilt = 0, ringSeed = 1, ringMoves = 0, ringFirstMove = 0;
  let ringStopped = false, ringFailed = false, ringResetPending = false, ringSubmitPending = false, ringNextAt = 0;
  /** When Donkey from scratch's board had its first move. */
  let donkeyFirstMove = 0;
  /** The board's seed and opening, so a failed attempt can be played again up to any move. */
  let donkeySeed = 1, donkeyOpening = false;
  /** Carrying on a failed attempt from an earlier point: from that move (1 is the first), and not counted in the stats. */
  let donkeyRetryFrom: number | null = null;
  function newDonkeyRing(): void {
    ringUnjudged();
    ringSeed = rng.integer(1, 0x7fffffff); ringBoard++;
    resetDonkeyRing();
  }
  /** Leaving a board with moves on it before it was judged counts as a fail. */
  function ringUnjudged(): void {
    if (mode === 'donkeyring' && game && !ringStopped && ringMoves > 0) recordAttempt(false, since(ringFirstMove));
  }
  function resetDonkeyRing(): void {
    ringUnjudged();
    input.drain(); // Pending keys belonged to the previous attempt.
    game = donkeyGame(ringSeed, opening());
    shown = positionOf(game);
    scenes = []; afterScenes = null; waiting = false; marks = []; arrowRing = null;
    selected = INNER; ringMoves = 0; ringFirstMove = 0;
    ringStopped = false; ringFailed = false; ringResetPending = false; ringSubmitPending = false; ringNextAt = 0;
    captionText = `Board ${ringBoard} · ${ringsBuilt} built`;
    status = '';
  }
  function failDonkeyRing(message: string, cells: number[]): void {
    if (game) shown = positionOf(game);
    scenes = []; afterScenes = null; waiting = false;
    ringStopped = true; ringFailed = true; ringSubmitPending = false; ringNextAt = 0;
    marks = cells.map((cell) => ({ cell, colour: PLAN_PROBLEM_OUTLINE }));
    captionText = message;
    status = pauseBuildOnFail ? `${message} Space: retry · Enter: next.` : message;
    if (FAIL_BUZZ) sounds.play('buzz', 0.6);
    ringResetPending = !pauseBuildOnFail;
    recordAttempt(false, since(ringFirstMove));
  }
  function judgeDonkeyRingNow(final: boolean): void {
    if (!game || ringStopped || busy()) return;
    const judged = judgeDonkeyRing(game.board.cells, final);
    if (judged.kind === 'building') return;
    if (judged.kind === 'fail') { failDonkeyRing(judged.message, judged.cells); return; }
    ringStopped = true; ringFailed = false; ringsBuilt++;
    ringNextAt = ticks() + 1;
    captionText = 'Ring 1 built';
    recordAttempt(true, Date.now() - (ringFirstMove || Date.now()));
  }
  function submitDonkeyRing(): void {
    if (!game || ringStopped) return;
    if (busy()) { ringSubmitPending = true; return; }
    judgeDonkeyRingNow(true);
  }
  function donkeyRingMove(action: Action): void {
    if (!game || ringStopped) return;
    if (busy()) return;
    // With the bag's ten stars down, turns can still finish ring 1; dropping an eleventh judges the board as it is.
    if (action.kind === 'drop' && starsDown(game.board.cells) >= BAG_STARS) { judgeDonkeyRingNow(true); return; }
    const g = game;
    const list = act(g, action);
    if (!list.length) {
      if (g.booched) { failDonkeyRing('That drop booched.', [g.entry.octant]); return; }
      if (ringSubmitPending) judgeDonkeyRingNow(true);
      return;
    }
    ringMoves++;
    if (!ringFirstMove) ringFirstMove = Date.now();
    recordMove();
    marks = [];
    const o = outcome(list, positionOf(g));
    const cleared = o.links.flatMap((l) => l.scene.clear?.cells.map((c) => c.ring * 8 + c.octant) ?? []);
    const charted = o.links.some((l) => l.kind === 'target');
    captionText = `Board ${ringBoard} · ${ringMoves} moves`;
    playScenes(list, new Map(), () => {
      shown = positionOf(g);
      if (cleared.length) { failDonkeyRing(charted ? 'The constellation charted.' : 'A clear went off.', cleared); return; }
      judgeDonkeyRingNow(false);
      if (ringStopped) return;
      if (ringSubmitPending) judgeDonkeyRingNow(true);
    });
  }

  // --- Cascade setup drills, continuous cascade play, and vertical triples from scratch. ---
  let trainingDeal: CascadeDeal | null = null, trainingInitial: Position | null = null;
  let trainingSeed = 1, trainingBoard = 0, trainingMoves = 0, trainingFirstMove: number | null = null;
  let trainingStopped = false, trainingFailed = false, trainingSubmitPending = false, trainingNextAt = 0;
  const setupTraining = () => mode === 'cascade-open' || mode === 'cascade-setup';
  function abandonTraining(): void {
    if (game && !trainingStopped && trainingMoves > 0) recordAttempt(false, since(trainingFirstMove));
    trainingStopped = true;
  }
  function newTraining(): void {
    abandonTraining();
    trainingDeal = isCascade() && mode !== 'cascade-open' ? dealCascadeSetup(rng) : null;
    trainingSeed = trainingDeal?.seed ?? rng.integer(1, 0x7fffffff);
    trainingBoard++;
    resetTraining();
  }
  function resetTraining(): void {
    abandonTraining();
    input.drain();
    game = trainingDeal ? cascadeSetupGame(trainingDeal) : new NavigationGame(SETTINGS, trainingSeed, undefined, (mode === 'cascade-open' || fromScratchPractice()) && opening());
    trainingInitial = positionOf(game);
    shown = positionOf(game);
    stopScenes(); marks = []; arrowRing = null; lastMove = null; goal = null; start = null;
    selected = mode === 'cascade-setup' || mode === 'cascade-practice' ? MIDDLE : INNER;
    trainingMoves = 0; trainingFirstMove = null; trainingStopped = false; trainingFailed = false;
    trainingSubmitPending = false; trainingNextAt = 0;
    captionText = ''; status = '';
  }
  function failTraining(issue: BuildIssue, reset = false): void {
    if (trainingStopped) return;
    if (game) shown = positionOf(game);
    stopScenes(); trainingStopped = true; trainingFailed = true; trainingSubmitPending = false;
    marks = issue.cells.map((cell) => ({ cell, colour: PLAN_PROBLEM_OUTLINE }));
    captionText = issue.message;
    status = reset ? '' : `${issue.message} Space: retry · Enter: next.`;
    if (FAIL_BUZZ) sounds.play('buzz', 0.6);
    recordAttempt(false, since(trainingFirstMove));
    trainingNextAt = reset ? ticks() + 1 : 0;
  }
  function submitTraining(): void {
    if (!game || trainingStopped || !setupTraining()) return;
    if (busy()) { trainingSubmitPending = true; return; }
    trainingSubmitPending = false;
    const checked = checkCascadeSetup(positionOf(game), mode === 'cascade-open');
    if (checked.kind === 'failed') { failTraining(checked.issue, !pauseBuildOnFail); return; }
    trainingStopped = true;
    recordAttempt(true, Date.now() - (trainingFirstMove ?? Date.now()));
    trainingNextAt = ticks() + 1;
  }
  function trainingMove(action: Action): void {
    if (!game || trainingStopped) return;
    if (busy()) return;
    const g = game;
    const before = positionOf(g);
    const list = act(g, action);
    if (!list.length && !g.booched) {
      if (trainingSubmitPending) submitTraining();
      return;
    }
    trainingFirstMove ??= Date.now(); trainingMoves++; recordMove();
    lastMove = { before, action }; marks = []; stepping = false; status = ''; captionText = '';
    const after = positionOf(g), o = outcome(list, after);
    const done = () => {
      shown = positionOf(g);
      if (g.booched) { failTraining({ message: 'That drop booched.', cells: [before.entry.octant] }, mode === 'cascade-practice'); return; }
      if (setupTraining() && o.links.length) { failTraining({ message: 'A clear went off before the setup was ready.', cells: [] }, !pauseBuildOnFail); return; }
      if (mode === 'cascade-practice') {
        if (!hasInnerWilds(after)) { failTraining({ message: 'Ring 1 lost its wilds.', cells: [] }, true); return; }
        if (o.charted !== null) {
          recordAttempt(lesson().accepts(o), Date.now() - trainingFirstMove!);
          trainingFirstMove = null; trainingMoves = 0;
        }
      } else if (fromScratchPractice() && (o.charted !== null || setsOff(o))) {
        if (!lesson().accepts(o)) {
          const judged = judgeCombo(o, lesson().accepts, lesson().title);
          failTraining(judged.kind === 'fail' ? { message: judged.message, cells: judged.cells } : { message: `That wasn’t ${lesson().title.toLowerCase()}.`, cells: [] });
          return;
        }
        recordAttempt(true, Date.now() - trainingFirstMove!);
        trainingStopped = true; trainingNextAt = ticks() + 1; return;
      }
      if (trainingSubmitPending) submitTraining();
    };
    if (list.length) playScenes(list, new Map(), done);
    else done();
  }

  // --- Donkey from a blank board ---
  /** The move that set the board off, and what it did against a donkey (or a vegas, on that lesson). */
  let donkeyBreak: { before: Position; action: Action; analysis: DonkeyAnalysis } | null = null;
  /** The player ended the board with Earlier before anything set it off: judged a fail where it stood. */
  let donkeyEnded = false;
  const donkeyStopped = () => !!donkeyBreak || donkeyEnded;
  /** The moves made on this board before the break, each with the board before it. */
  let donkeyHistory: { before: Position; action: Action }[] = [];
  /** Stills of the build and the break, stepped through with the arrow keys once the board has broken. */
  let donkeyFrames: { frames: BreakFrame[]; start: number; result: Outcome } | null = null, frameAt = 0;
  const BLAME = '#ff4040', TARGET_BLAME = '#ffb040', FIXED = '#40ff70';
  const donkeyGoal = () => lesson().id === 'vegas' ? DONKEY_CHAIN + 1 : DONKEY_CHAIN;
  const scrub = new HoldScrub((direction) => {
    if (direction < 0 && canEndEarly()) { endDonkeyEarly(); return true; }
    if (mode !== 'donkey' || !donkeyStopped() || !donkeyFrames || busy()) return false;
    const previous = frameAt;
    stepFrame(direction);
    return frameAt !== previous;
  });
  const stopScrub = () => scrub.stop();
  const hideScrub = () => { if (document.hidden) stopScrub(); };
  window.addEventListener('pointerup', stopScrub);
  window.addEventListener('pointercancel', stopScrub);
  window.addEventListener('blur', stopScrub);
  document.addEventListener('visibilitychange', hideScrub);
  function newDonkey(keepNotice = false): void {
    // A board left before it was judged counts as a fail (a passed one starts the next board itself).
    if (!keepNotice && mode === 'donkey' && game && !donkeyStopped() && moves > 0 && donkeyRetryFrom === null) recordAttempt(false, since(donkeyFirstMove));
    donkeyEnded = false;
    donkeyFirstMove = 0; donkeyRetryFrom = null;
    scrub.stop();
    if (!keepNotice) clearNotice = null;
    donkeySeed = rng.integer(1, 0x7fffffff); donkeyOpening = opening();
    game = donkeyGame(donkeySeed, donkeyOpening);
    start = null; upcoming = []; goal = null; donkeyBreak = null; sceneMarks = null; donkeyHistory = []; donkeyFrames = null; frameAt = 0;
    shown = positionOf(game);
    scenes = []; afterScenes = null; waiting = false; stepping = false; replaying = false; marks = []; arrowRing = null; moves = 0; selected = RINGS - 1;
    captionText = '';
    status = '';
  }
  function donkeyMove(action: Action): void {
    if (!game || donkeyStopped() || busy()) return;
    if (action.kind === 'drop' && game.board.get(game.entry.octant, 0) !== EMPTY) { status = 'That drop would booch the board.'; return; }
    const before = positionOf(game);
    const list = act(game, action);
    if (!list.length) return;
    moves++;
    const now = Date.now();
    if (!donkeyFirstMove) donkeyFirstMove = now;
    const counted = donkeyRetryFrom === null;
    if (counted) recordMove();
    const o = outcome(list, positionOf(game));
    const g = game;
    const broke = setsOff(o);
    const succeeded = (o.charted ?? 0) >= donkeyGoal();
    if (broke && counted) recordAttempt(succeeded, now - donkeyFirstMove);
    if (!broke) donkeyHistory.push({ before, action });
    stepping = false;
    // Live play never writes link captions on the board, not for a stray single and not for the break:
    // the break is described afterwards, in the panel and when stepping through it with the arrows.
    captionText = '';
    shown = before;
    playScenes(list, new Map(), () => {
      shown = positionOf(g);
      if (succeeded) { newDonkey(true); return; }
      if (broke) { endDonkey(before, action); return; }
    });
  }
  /** The build move the still on screen comes before (the break's own stills count as the break's move), or null. */
  function continuePoint(): number | null {
    if (!donkeyStopped() || !donkeyFrames) return null;
    const f = donkeyFrames.frames[frameAt];
    if (f.kind === 'move') return f.move! - 1;
    return donkeyHistory.length;
  }
  /**
   * Carries on the failed board from the still on screen: the same board and the same stars to come,
   * with the moves before that point already made. The rest of this attempt isn't counted in the stats.
   */
  function continueFromHere(): void {
    const made = continuePoint();
    if (made === null || busy()) return;
    scrub.stop();
    const g = donkeyGame(donkeySeed, donkeyOpening);
    const history = donkeyHistory.slice(0, made);
    for (const h of history) playMove(g, h.action);
    game = g; donkeyHistory = history; donkeyBreak = null; donkeyEnded = false; donkeyFrames = null; frameAt = 0;
    donkeyRetryFrom = made + 1;
    shown = positionOf(g);
    scenes = []; afterScenes = null; waiting = false; stepping = false; marks = []; sceneMarks = null; arrowRing = null; clearNotice = null;
    captionText = '';
    status = `Carrying on from move ${made + 1}. This try isn't counted in your stats. ${newBoardKeyLabel()} starts a new board.`;
  }
  /** Earlier while building, with moves on the board: ends it there. */
  /** A board with moves on it that Earlier could end (the button's state, so it never depends on a move playing). */
  const hasBuildToEnd = () => mode === 'donkey' && !!game && !donkeyStopped() && donkeyHistory.length > 0;
  const canEndEarly = () => hasBuildToEnd() && !busy();
  /**
   * Ends the board where it stands, as a fail at this point (unless it's a try carried on from earlier),
   * and steps back one move so the build can be stepped through and carried on from any point.
   */
  function endDonkeyEarly(): void {
    if (!canEndEarly()) return;
    if (donkeyRetryFrom === null) recordAttempt(false, since(donkeyFirstMove));
    const now = positionOf(game!);
    const frames: BreakFrame[] = donkeyHistory.map((h, i) => ({ kind: 'move', position: h.before, move: i + 1, action: h.action, blame: [], targets: [], clearing: [] }));
    frames.push({ kind: 'end', position: now, blame: [], targets: [], clearing: [] });
    donkeyFrames = { frames, start: frames.length - 1, result: { links: [], charted: null, nextInnerWild: false, after: now } };
    donkeyEnded = true; game = null;
    showFrame(frames.length - 2);
    status = `Board ended here${donkeyRetryFrom === null ? ', counted as a fail' : ' (not counted)'}. The left and right arrows step through your build. Space carries on from the still you're on, without counting in your stats. ${newBoardKeyLabel()} starts a new board.`;
  }
  function endDonkey(before: Position, action: Action): void {
    const analysis = analyseBreak(before, action, donkeyGoal());
    donkeyBreak = { before, action, analysis };
    donkeyFrames = breakFrames(donkeyHistory, before, action, analysis);
    game = null;
    showBreakBoard();
    status = `${analysis.headline} ${analysis.problem}${analysis.fix ? ` ${analysis.fix.text}` : ''} ${analysis.success ? '' : 'Replay the break to watch it with that ringed. '}The left and right arrows step through it, and back through your build. Space carries on from the still you're on, without counting in your stats. ${newBoardKeyLabel()} starts a new board.`;
  }
  /** The board just before the break, with the stars to blame ringed red and targets amber. */
  function showBreakBoard(): void {
    if (!donkeyBreak || busy()) return;
    showFrame(donkeyFrames?.start ?? 0);
  }
  /** One still of the build or the break: blamed stars red, blamed targets amber, a clear's stars in its link colour. */
  function showFrame(index: number): void {
    if (!donkeyStopped() || !donkeyFrames || busy()) return;
    const { frames, start, result } = donkeyFrames;
    frameAt = Math.max(0, Math.min(frames.length - 1, index));
    const f = frames[frameAt];
    shown = f.position; sceneMarks = null;
    marks = [
      ...f.clearing.filter((cell) => !f.blame.includes(cell)).map((cell) => ({ cell, colour: f.scene?.clear?.kind === 'target' ? GOLD : linkColour(f.link ?? 0) })),
      ...f.blame.map((cell) => ({ cell, colour: BLAME })),
      ...f.targets.map((cell) => ({ cell, colour: TARGET_BLAME })),
    ];
    arrowRing = (f.kind === 'move' || f.kind === 'before') && f.action?.kind === 'rotate' ? { ring: f.action.ring, clockwise: f.action.clockwise } : null;
    const move = (a: Action | undefined) => (a ? moveText(a, a.kind === 'drop' ? f.position.entry : undefined) : '');
    const text = f.kind === 'move' ? `Move ${f.move}: ${move(f.action)}.`
      : f.kind === 'before' ? `Before the break (move ${start + 1}): ${move(f.action)}.`
      : f.kind === 'clear' ? (f.scene && captionsFor(result).get(f.scene)) || 'The constellation charts.'
      : f.kind === 'fall' ? 'Stars fall in.'
      : f.kind === 'turn' ? 'After the move.'
      : donkeyEnded ? 'Where you ended the board.'
      : result.charted ? `Charted as a ${chainName(result.charted).toLowerCase()}.` : 'Nothing charted.';
    captionText = `${text} (${frameAt + 1} / ${frames.length})`;
  }
  function stepFrame(by: number): void { if (donkeyFrames) showFrame(frameAt + by); }
  /** Plays the break again with the blamed stars ringed as they move; or the fixed board. */
  function replayBreak(fixed: boolean): void {
    if (!donkeyBreak || busy()) return;
    scrub.stop();
    const { analysis } = donkeyBreak;
    const fix = analysis.fix;
    if (fixed && !fix) return;
    const p = fixed ? fix!.position : donkeyBreak.before, action = fixed ? fix!.action : donkeyBreak.action;
    replaying = true;
    const g = gameAt(p);
    const played = act(g, action), result = outcome(played, positionOf(g));
    const list = paced(played, g);
    const tracked = trackStars(list, fixed ? fix!.cells : analysis.stars);
    const fixedTargets = fixed ? [] : analysis.targets;
    sceneMarks = new Map(list.map((scene) => [scene, [
      ...(tracked.get(scene) ?? []).map((cell) => ({ cell, colour: fixed ? FIXED : BLAME })),
      ...fixedTargets.map((cell) => ({ cell, colour: TARGET_BLAME })),
    ]]));
    const last = list.at(-1);
    if (last && !fixed && analysis.end.length) sceneMarks.set(last, [...(sceneMarks.get(last) ?? []), ...analysis.end.map((cell) => ({ cell, colour: BLAME }))]);
    shown = p; marks = []; arrowRing = null; stepping = false;
    captionText = `${fixed ? 'Fixed' : 'Your break'}: ${moveText(action, action.kind === 'drop' ? p.entry : undefined)}`;
    playScenes(list, captionsFor(result), () => {
      replaying = false; stepping = false;
      const end = last ? sceneMarks?.get(last) ?? [] : [];
      sceneMarks = null;
      if (last) shown = { cells: last.cells, targets: last.targets, entry: p.entry };
      marks = end;
      captionText = `${fixed ? 'Fixed' : 'As you built it'}: ${result.charted ? `charted as a ${chainName(result.charted).toLowerCase()}` : 'nothing charted'}.`;
    });
  }

  // --- Spot the wrong star ---
  function newMistake(asPlayed = false): void {
    const l = lesson();
    for (let tries = 0; tries < 20; tries++) {
      const ex = asPlayed ? VEGAS_AS_PLAYED : generate(l.moments[rng.integer(0, l.moments.length - 1)], l.accepts, rng, l.keep);
      const m = asPlayed ? { ...VEGAS_AS_PLAYED, cell: 2 * 8 + 7, fix: 0, result: play(ex.position, ex.action) } : makeMistake(ex, l.accepts, rng, l.keep);
      if (!m) continue;
      mistake = m; found = false; game = null; shown = m.position; example = m;
      scenes = []; marks = [];
      arrowRing = m.action.kind === 'rotate' ? { ring: m.action.ring, clockwise: m.action.clockwise } : null;
      captionText = `Meant to be a ${l.title.toLowerCase()} when you ${moveText(m.action, m.position.entry)}.`;
      status = 'One star on this board spoils the chain. Click it.';
      return;
    }
    status = 'Couldn’t make one of those just now. Try again.';
  }
  function clickStar(cell: number): void {
    if (!mistake || busy() || found) return;
    if (mistake.position.cells[cell] === EMPTY) return;
    if (cell === mistake.cell || fixes(mistake, cell, lesson().accepts)) {
      found = true;
      marks = [{ cell, colour: '#40ff70' }];
      status = `That’s it. ${COLOUR_NAMES[mistake.position.cells[cell]]} there ${spoilText()}. Press Watch it go wrong, or Watch it fixed.`;
    } else {
      marks = [...marks.filter((m) => m.cell !== cell), { cell, colour: '#ff4040' }];
      status = 'Not that one: changing it wouldn’t save the chain. Look again.';
    }
  }
  function spoilText(): string {
    const m = mistake!, r = m.result;
    const fixed = { ...m.position, cells: [...m.position.cells] };
    fixed.cells[m.cell] = m.fix;
    const good = play(fixed, m.action);
    if (!r.charted) return 'means the constellation never charts';
    if (r.charted < (good.charted ?? 0)) return `means it only charts as a ${chainName(r.charted).toLowerCase()} instead of a ${chainName(good.charted!).toLowerCase()}`;
    if (good.nextInnerWild && !r.nextInnerWild) return `still charts a ${chainName(r.charted).toLowerCase()}, but no cascade follows, so the next constellation's ring 1 isn't wild`;
    return `turns it into a ${chainName(r.charted).toLowerCase()} made the wrong way`;
  }
  function watchMistake(fixed: boolean): void {
    if (!mistake || busy()) return;
    const p = { ...mistake.position, cells: [...mistake.position.cells] };
    if (fixed) p.cells[mistake.cell] = mistake.fix;
    const g = gameAt(p);
    const list = act(g, mistake.action);
    const o = outcome(list, positionOf(g));
    shown = p; stepping = false;
    marks = [{ cell: mistake.cell, colour: fixed ? '#40ff70' : '#ff4040' }];
    playScenes(list, captionsFor(o), () => {
      shown = positionOf(g);
      captionText = o.charted ? `${fixed ? 'Fixed' : 'As it was'}: charted as a ${chainName(o.charted).toLowerCase()}.` : `${fixed ? 'Fixed' : 'As it was'}: nothing charted.`;
    });
  }

  // --- Find the wrong move ---
  /** A build-up toward the lesson's strategy with one wrong move in it. */
  function newBadBuild(): void {
    const l = lesson();
    for (let tries = 0; tries < 20; tries++) {
      const ex = generate(l.moments[rng.integer(0, l.moments.length - 1)], l.accepts, rng, l.keep);
      const build = buildUpAtMost(ex.position, rng, rng.integer(6, 10));
      const spoiled = build && spoilBuild(build, ex.action, l.accepts, rng);
      if (!spoiled) continue;
      bad = spoiled; goodFinal = ex.position; buildTrigger = ex.action; found = false;
      game = null; scenes = []; marks = []; arrowRing = null;
      showBuild(0);
      status = `This board is being built for a ${l.title.toLowerCase()}, set off by ${moveText(ex.action)}. One move on the way spoils it. Step through with Later ▶ (or →), and press That move was wrong just after the move you think did it.`;
      return;
    }
    status = 'Couldn’t make one of those just now. Try again.';
  }
  /** Shows the board after `k` moves of the build, with the next falling star waiting above it. */
  function showBuild(k: number): void {
    const b = bad!;
    buildAt = Math.max(0, Math.min(b.moves.length, k));
    shown = b.boards[buildAt]; marks = [];
    const done = b.moves[buildAt - 1], next = b.moves[buildAt];
    captionText = buildAt === 0 ? `Start. ${b.moves.length} moves to come.`
      : `Move ${buildAt} of ${b.moves.length}: ${moveText(done, done.kind === 'drop' ? b.boards[buildAt - 1].entry : undefined)}.${next ? '' : ' The board is built.'}`;
    arrowRing = !next && buildTrigger?.kind === 'rotate' ? { ring: buildTrigger.ring, clockwise: buildTrigger.clockwise } : null;
  }
  function buildStep(delta: number): void {
    if (!bad || busy()) return;
    if (delta < 0) { showBuild(buildAt - 1); return; }
    if (buildAt >= bad.moves.length) return;
    // Play the move out, so any clear it sets off can be seen.
    const k = buildAt, move = bad.moves[k];
    const g = gameAt(bad.boards[k]);
    const list = act(g, move);
    const o = outcome(list, positionOf(g));
    const captions = captionsFor(o);
    for (const link of o.links) if (link.kind === 'run') captions.set(link.scene, `Clear: ${link.runs.map(describeRun).join(' and ')}.`);
    stepping = false; marks = []; arrowRing = null;
    captionText = `Move ${k + 1}: ${moveText(move, move.kind === 'drop' ? bad.boards[k].entry : undefined)}`;
    playScenes(paced(list, g), captions, () => showBuild(k + 1));
  }
  function wrongMoveText(): string {
    const b = bad!, k = b.culprit, move = b.moves[k];
    const what = b.skipped ? `Before move ${k + 1} a turn was missed: ${moveText(b.meant!)}.`
      : b.meant ? `Move ${k + 1} should have been ${moveText(b.meant)}, not ${moveText(move)}.`
      : `Move ${k + 1}, ${moveText(move)}, shouldn’t have been made before that drop.`;
    const why = b.kind === 'clear' ? 'It set off a clear that wasn’t meant, taking stars out of the setup.'
      : 'It left a star that should have filled a target somewhere else, so that target ends up filled wrong.';
    const result = b.result.charted ? `The trigger then only charts a ${chainName(b.result.charted).toLowerCase()}.` : 'The trigger then doesn’t chart the constellation.';
    return `${what} ${why} ${result}`;
  }
  function guessMove(): void {
    if (!bad || buildAt === 0 || found || busy()) return;
    const k = buildAt - 1;
    if (k === bad.culprit) { found = true; status = `Yes! ${wrongMoveText()}`; }
    else status = `Not move ${k + 1}. The wrong move came ${k < bad.culprit ? 'later' : 'earlier'}.`;
  }
  function watchBuildTrigger(right: boolean): void {
    if (!bad || !buildTrigger || busy()) return;
    const p = right ? goodFinal! : bad.boards[bad.moves.length];
    const g = gameAt(p);
    const list = act(g, buildTrigger);
    const o = outcome(list, positionOf(g));
    shown = p; stepping = false; marks = []; arrowRing = null;
    playScenes(list, captionsFor(o), () => {
      shown = positionOf(g);
      captionText = `${right ? 'Built right' : 'As built'}: ${o.charted ? `charted as a ${chainName(o.charted).toLowerCase()}` : 'nothing charted'}.`;
    });
  }

  // --- Drawing ---
  function star(colour: number, octant: number, r: number, highlighted = false, target = false): void {
    const [x, y] = position(octant, r);
    const tile = (target ? (highlighted ? 24 : 16) : highlighted ? 8 : 0) + ((octant + 2) % 8);
    ctx.drawImage(images.get(`star_${COLOURS[colour]}`), tile * 56, 0, 56, 56, Math.trunc(x) - 28, Math.trunc(y) - 28, 56, 56);
  }
  function drawBoard(scene: Scene, progress: number, now: number, glows: { cell: number; colour: string }[] = []): void {
    const cleared = new Set(scene.clear?.cells.map((c) => c.ring * 8 + c.octant));
    const falling = new Map(scene.falls?.map((f) => [f.from * 8 + f.octant, f]));
    for (const t of scene.targets) {
      const [x, y] = position(t.octant, radius(t.ring));
      drawTarget(ctx, images, scene, t, x, y, matchWildColour());
    }
    // Marks go over the targets (a target's is a ring round it) and under the stars.
    for (const m of glows) {
      const target = scene.targets.some((t) => t.ring * 8 + t.octant === m.cell);
      const empty = scene.cells[m.cell] < 0;
      if (mode === 'plan' || mode === 'build' || mode === 'finish') planningOutline(m.cell, m.colour, m.colour === PLAN_WILD_OUTLINE ? 29 : 24);
      else ringMark(m.cell, m.colour, empty ? (target ? 28 : 17) : 0, target ? 21 : 30);
    }
    for (let ring = 0; ring < RINGS; ring++) for (let o = 0; o < 8; o++) {
      const colour = scene.cells[ring * 8 + o];
      if (colour < 0) continue;
      const target = scene.targets.find((t) => t.octant === o && t.ring === ring);
      const fall = falling.get(ring * 8 + o);
      const fallProgress = fall ? Math.min(1, (now - sceneStart) / (speed() * Math.trunc(56 * Math.abs(fall.ring - fall.from) / 0.75))) : progress;
      const r = fall ? radius(fall.from) + (radius(fall.ring) - radius(fall.from)) * fallProgress : radius(ring);
      const angle = scene.rotation?.ring === ring ? o + (scene.rotation.clockwise ? -1 : 1) * progress : o;
      ctx.save();
      if (cleared.has(ring * 8 + o)) ctx.globalAlpha = Math.max(0, 1 - progress);
      const lit = !!target && (target.wild || target.colour === colour) && !(scene.clear?.kind === 'run' && cleared.has(ring * 8 + o));
      if (angle === o) star(colour, o, r, lit);
      else {
        const [x, y] = position(angle, r);
        ctx.drawImage(images.get(`star_${COLOURS[colour]}`), ((o + 2) % 8) * 56, 0, 56, 56, x - 28, y - 28, 56, 56);
      }
      ctx.restore();
    }
  }
  /** A thin perimeter only: keep the original piece and target colours unobscured. */
  function planningOutline(cell: number, colour: string, size: number): void {
    const [x, y] = position(cell % 8, radius(Math.floor(cell / 8)));
    ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 1.25; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  /** A glow behind a star, added as light so a target under it still shows. */
  /** `outline`: draw a ring of that radius instead, round a target (so it stays readable) or an empty cell. */
  /** `size`: the glow's radius (smaller on a target, so its frame still shows). */
  function ringMark(cell: number, colour: string, outline = 0, size = 30): void {
    const [x, y] = position(cell % 8, radius(Math.floor(cell / 8)));
    if (outline) {
      ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 4; ctx.shadowColor = colour; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, outline, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      return;
    }
    const glow = ctx.createRadialGradient(x, y, 8, x, y, size);
    glow.addColorStop(0, colour); glow.addColorStop(0.55, colour); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  /** The finished board, faint, wherever the board in play doesn't match it yet. */
  function drawGoal(target: Position, cells: number[], alpha = 0.38): void {
    ctx.save(); ctx.globalAlpha = alpha;
    target.cells.forEach((colour, i) => { if (colour !== EMPTY && cells[i] !== colour) star(colour, i % 8, radius(Math.floor(i / 8))); });
    ctx.restore();
  }
  function drawArrow(ring: number, clockwise: boolean): void {
    const r = radius(ring) + 24;
    // A short arc over the top of the ring, pointing the way it turns (clockwise on screen is decreasing angle).
    const a0 = Math.PI * 0.62, a1 = Math.PI * 0.38;
    const [from, to] = clockwise ? [a0, a1] : [a1, a0];
    ctx.save(); ctx.strokeStyle = '#ffd84a'; ctx.fillStyle = '#ffd84a'; ctx.lineWidth = 4; ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.arc(CX, CY, r, -from, -to, !clockwise); ctx.stroke();
    const [ex, ey] = [CX + Math.cos(to) * r, CY - Math.sin(to) * r];
    const dir = clockwise ? -1 : 1;
    const tx = -Math.sin(to) * dir, ty = -Math.cos(to) * dir;
    ctx.beginPath(); ctx.moveTo(ex + tx * 12, ey + ty * 12); ctx.lineTo(ex - ty * 8, ey + tx * 8); ctx.lineTo(ex + ty * 8, ey - tx * 8); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function wrap(text: string, width: number): string[] {
    const words = text.split(' '), lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }
  function drawCaption(text: string): void {
    if (!text) return;
    ctx.save();
    ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const lines = wrap(text, 420).slice(0, 3);
    const top = 600 - 10 - lines.length * 21;
    ctx.fillStyle = 'rgba(10, 8, 20, 0.72)'; ctx.fillRect(0, top - 6, 450, lines.length * 21 + 12);
    ctx.fillStyle = '#fff';
    lines.forEach((line, i) => ctx.fillText(line, CX, top + i * 21));
    ctx.restore();
  }
  function draw(now: number): void {
    screen.blit(images.get('werewolf_background'), 0, 0);
    screen.blit(images.get('title'), 0, 0);
    if (playing() && game) {
      ctx.save(); ctx.globalAlpha = 0.85;
      ctx.drawImage(images.get('werewolf_rings'), (RINGS - 1 - selected) * 414, 0, 414, 414, CX - 207, CY - 207, 414, 414);
      ctx.restore();
    }
    const current = scenes[0];
    const scene: Scene = current ? { ...current.scene, targets: current.targets ?? current.scene.targets } : { cells: shown.cells, targets: shown.targets, duration: 0 };
    const duration = (current?.scene.duration ?? 0) * speed();
    const progress = duration ? Math.min(1, (now - sceneStart) / duration) : 1;
    if (mode === 'plan') {
      // Show the paintable slots even before there are any stars on the board.
      ctx.save(); ctx.strokeStyle = 'rgba(180, 205, 255, 0.45)'; ctx.lineWidth = 1;
      for (let ring = 0; ring < RINGS; ring++) for (let o = 0; o < 8; o++) {
        const [x, y] = position(o, radius(ring));
        ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    drawBoard(scene, progress, now, current ? sceneMarks?.get(current.scene) ?? [] : [...marks, ...buildSolutionMarks()]);
    const solution = current ? null : buildSolutionGoal();
    if (solution) drawGoal(solution, scene.cells, 0.7);
    if (!current && mode === 'finish' && finishHintShown && finishDeal) drawGoal(finishHint(shown, finishDeal.plan), scene.cells, 0.7);
    if (!current && mode === 'practise' && game && goal && showGoal) drawGoal(goal, scene.cells);
    if (!current) {
      if (arrowRing) drawArrow(arrowRing.ring, arrowRing.clockwise);
      if (playing() && game && !game.finished && !isTraining() && mode !== 'scratch' && mode !== 'donkey' && mode !== 'donkeyring' && mode !== 'donkeybase' && mode !== 'donkeylayer' && !isR3() && mode !== 'build' && mode !== 'finish' && mode !== 'aftertriple') star(game.entry.colour, game.entry.octant, 205);
      if (mode === 'when' && bad && bad.moves[buildAt]?.kind === 'drop') star(bad.boards[buildAt].entry.colour, bad.boards[buildAt].entry.octant, 205);
    }
    // From scratch keeps the next star in view while a move plays out.
    if (((isTraining() && !trainingStopped) || mode === 'scratch' || mode === 'donkey' || (mode === 'donkeyring' && !ringStopped) || (mode === 'donkeylayer' && !stageStopped) || (isR3() && !r3Stopped) || (mode === 'build' && !buildStopped) || (mode === 'finish' && !finishStopped) || mode === 'aftertriple') && game && !game.finished) star(game.entry.colour, game.entry.octant, 205);
    drawCaption(captionText);
    if (clearNotice) {
      const elapsed = now - clearNotice.at;
      if (elapsed >= FLOAT_MS) clearNotice = null;
      else {
        const style = { px: clearNotice.px, fill: clearNotice.fill, align: 'center' as const };
        const text = wrapGameText(ctx, clearNotice.text, style, 450);
        const { dy, alpha } = floatAt(elapsed);
        drawGameText(ctx, text, CX, CY - gameTextBox(ctx, text, style).h / 2 + dy, { ...style, alpha });
      }
    }
  }

  /** Plays scenes out: each clear's caption shows while it plays, and stays a moment (or until Next in Step mode). */
  function advance(now: number): void {
    while (scenes.length && !waiting) {
      const current = scenes[0];
      const end = sceneStart + current.scene.duration * speed();
      if (now < end) return;
      // A clear's caption stays up a moment when slowed down (or until Next when stepping); otherwise game speed.
      if (current.caption && scenes.length > 1 && (stepping || isSlow())) {
        if (stepping) { waiting = true; return; }
        const hold = end + 900 * speed();
        if (now < hold) return;
        sceneStart = hold;
      } else sceneStart = end;
      scenes.shift();
      startNext();
    }
  }
  function startNext(): void {
    beginScene();
    if (!scenes.length) { const done = afterScenes; afterScenes = null; done?.(); }
  }
  function next(): void {
    if (!waiting) return;
    waiting = false; sceneStart = ticks(); scenes.shift(); startNext();
  }

  function cellAt([x, y]: [number, number]): { ring: number; octant: number } | null {
    const distance = Math.hypot(x - CX, y - CY);
    if (distance < 30 || distance > radius(0) + 28) return null;
    let ring = 0;
    for (let r = 1; r < RINGS; r++) if (Math.abs(radius(r) - distance) < Math.abs(radius(ring) - distance)) ring = r;
    return { ring, octant: ((Math.round(Math.atan2(CY - y, x - CX) / (Math.PI / 4)) % 8) + 8) % 8 };
  }

  function setMode(next: Mode): void {
    scrub.stop();
    clearNotice = null;
    // A mode the lesson has nothing built for falls back to its example; the lesson never changes here.
    if (!modesFor(lesson().id).some((m) => m.value === next)) next = modesFor(lesson().id)[0].value;
    endStats();
    mode = next; store.set('mode', mode);
    sceneMarks = null; donkeyBreak = null; donkeyEnded = false; replaying = false; stepping = false;
    scenes = []; marks = []; status = ''; mistake = null; bad = null; game = null; start = null;
    waiting = false; afterScenes = null; afterTripleAt = 0; planNextAt = 0; planPaintWith = null; planPainting = false;
    buildResetPending = false; buildSubmitPending = false; buildNextAt = 0; buildStopped = false; buildFailed = false; buildSolutionShown = false;
    // Every example shown is a fresh one, made from the topic's boards.
    if (mode === 'learn') newExample();
    else if (mode === 'steps') newSteps(true);
    else if (mode === 'plan') newPlan();
    else if (mode === 'build') newBuildPosition(true);
    else if (mode === 'finish') newFinish();
    else if (isTraining()) newTraining();
    else if (mode === 'practise') newPractice();
    else if (mode === 'scratch') newScratch();
    else if (mode === 'donkey') newDonkey();
    else if (mode === 'donkeyring') newDonkeyRing();
    else if (isStage()) newDonkeyStage();
    else if (isR3()) newR3();
    else if (mode === 'when') newBadBuild();
    else if (mode === 'aftertriple') newAfterTriple();
    else newMistake();
    renderStats();
  }
  function setLesson(index: number): void {
    lessonIndex = index; momentIndex = 0; store.set('lesson', lesson().id);
    renderText();
    setMode(mode);
  }

  // --- After a triple: a vertical triple breaks, then the board plays on as normal until a new board ---
  let afterTriple: AfterTriplePlay | null = null;
  /** When the dealt board's triple goes off (0 once it has). */
  let afterTripleAt = 0;
  /** How long the board before the break stays up, with the turn's arrow, before the move plays. */
  const AFTER_TRIPLE_PAUSE_MS = 900;
  function newAfterTriple(): void {
    stopScenes(); clearNotice = null;
    const deal = dealAfterTriple(rng);
    afterTriple = new AfterTriplePlay(deal, act);
    game = afterTriple.game;
    shown = positionOf(game);
    upcoming = []; marks = []; status = ''; captionText = ''; moves = 0; selected = RINGS - 1;
    arrowRing = deal.action.kind === 'rotate' ? { ring: deal.action.ring, clockwise: deal.action.clockwise } : null;
    afterTripleAt = ticks() + AFTER_TRIPLE_PAUSE_MS;
  }
  function breakAfterTriple(): void {
    afterTripleAt = 0;
    const play = afterTriple;
    if (!play) return;
    arrowRing = null;
    playScenes(play.break(), new Map(), afterTripleSettled);
  }
  /** Once a move has played out: the board as it stands. */
  function afterTripleSettled(): void {
    if (!afterTriple) return;
    shown = positionOf(afterTriple.game);
  }
  /** Free play after the break: no judging, and a move made while one plays out is dropped, as in the game. */
  function afterTripleMove(action: Action): void {
    const play = afterTriple;
    if (!play || play.phase !== 'play') return;
    if (busy()) return;
    const list = play.move(action);
    if (play.game.booched) {
      // The board has ended: it stays up until a new one.
      shown = positionOf(play.game);
      captionText = 'Board booched'; status = `Board booched. ${newBoardKeyLabel()} deals a new board.`;
      return;
    }
    if (!list.length) return;
    moves++;
    playScenes(list, new Map(), afterTripleSettled);
  }

  // --- Panel ---
  const text = document.createElement('div');
  text.className = 'tutorial-text';
  function renderText(): void {
    const l = lesson();
    const list = document.createElement('ul');
    for (const item of l.lookFor) { const li = document.createElement('li'); li.textContent = item; list.append(li); }
    const heading = document.createElement('p'); heading.className = 'tutorial-heading'; heading.textContent = 'Before the move, check:';
    text.replaceChildren(...l.intro.map((p) => { const node = document.createElement('p'); node.textContent = p; return node; }), heading, list);
  }
  renderText();


  // Rings are selected and turned by pointer exactly as in Dennav: a click selects, a drag turns.
  const pointerCommands: string[] = [];
  let pointerFrame = 0;
  const disposePointer = mobileControls(screen, panel, navigationStore, () => ({
    active: playing() && !(mode === 'donkey' && donkeyStopped()),
    settling: busy(), painting: false, rings: RINGS, selected, board: game, frame: pointerFrame,
  }), (command) => pointerCommands.push(command));
  function pointerCommand(command: string): void {
    if (!playing() || (mode === 'donkey' && donkeyStopped())) return;
    if (command === 'ccw' || command === 'cw') practiceMove({ kind: 'rotate', ring: selected, clockwise: command === 'cw' });
    else if (command === 'drop') practiceMove({ kind: 'drop' });
    else if (command === 'ringOut') selected = Math.max(0, selected - 1);
    else if (command === 'ringIn') selected = Math.min(RINGS - 1, selected + 1);
    else if (command.startsWith('ring:') || command.startsWith('turn:')) {
      const [, ring, direction] = command.split(':');
      const number = Number(ring);
      if (!Number.isInteger(number) || number < 1 || number > RINGS) return;
      selected = RINGS - number;
      if (command.startsWith('turn:')) practiceMove({ kind: 'rotate', ring: selected, clockwise: direction === 'cw' });
    }
  }

  const lessonGroup = panel.group('Tutorial');
  lessonGroup.select('Topic', TOPICS.map((l, value) => ({ value, label: `${value + 1}. ${l.title}` })), () => lessonIndex, setLesson);
  lessonGroup.select('Lesson', () => modesFor(lesson().id), () => mode, setMode);
  lessonGroup.note(() => mode === 'build' || mode === 'finish' || (mode === 'plan' && (planCheck || revealedPlan || planNotice)) ? '' : status);

  const rowBreak = () => document.createElement('div');
  panel.settings.group('Practice').select('Starting board', [{ value: '321', label: '3-2-1' }, { value: '121', label: '1-2-1' }] as { value: StartingBoard; label: string }[], () => startingBoard, (value) => {
    startingBoard = value; store.set('startingBoard', value);
    // Deal a board from the new start in drills that deal fresh boards.
    if (mode !== 'learn' && mode !== 'steps' && !busy()) setMode(mode);
  }, { title: 'The constellation dealt boards start from: 3 targets in ring 1, 2 in ring 2 and 1 in ring 3, or the game’s opening 1-2-1' })
    .toggle('Show practice stats', () => showStats, (on) => { showStats = on; store.set('showPracticeStats', on); renderStats(); }, { title: 'Fail rate and times per session for setup drills and practice' });
  panel.settings.group('Debug').toggle('Debug mode', () => debugMode, (on) => {
    debugMode = on; store.set('debugMode', on); exportNotice = '';
  });
  const learn = panel.group('Watch', { hidden: () => mode !== 'learn' });
  learn.button('Play move', () => watch(false), { variant: 'primary' })
    .button('Back\n◀', () => exampleStep(-1), { title: 'One still back (Left arrow)' })
    .button('Forward\n▶', () => exampleStep(1), { title: 'One still on (Right arrow)' });
  // Both step buttons on two lines, the word over its arrow.
  for (const b of learn.element.querySelectorAll('button')) if (/^(Back|Forward)\n/.test(b.textContent ?? '')) b.style.whiteSpace = 'pre-line';
  learn.append(rowBreak());
  learn.button('Show board', () => showExample(example, exampleLabel), { title: 'Back to the board before the move' })
    .button(`New example (${newBoardKeyLabel()})`, newExample, { title: 'A fresh example of this combo' });
  learn.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); })
    .toggle('Highlights', () => ringChain, (on) => { ringChain = on; store.set('ringChain', on); if (!busy()) showExample(example, exampleLabel); }, { title: 'Before the move, ring the stars its clears will use' });
  learn.append(rowBreak());
  learn.select('Chain highlight', HIGHLIGHTS, () => highlight, (value) => {
    highlight = value; store.set('chainHighlight', value);
    if (busy()) return;
    if (mode === 'learn') showExample(example, exampleLabel);
  }, { disabled: () => !ringChain, title: 'All gold rings every chain star; Colour by link gives each clear its own colour; Next link only rings just the clear that comes next' });
  learn.append(linkLegend(), { hidden: () => !ringChain || highlight === 'gold' });

  const steps = panel.group('Step by step', { hidden: () => mode !== 'steps' });
  steps.button('◀ Back', () => showStep(stepAt - 1), { disabled: () => !stepEx || stepAt === 0 })
    .button('Next step ▶', () => showStep(stepAt + 1), { variant: 'primary', disabled: () => !stepEx || stepAt === 3 })
    .button('Play move', playSteps, { disabled: () => !stepEx || (stepAt !== 0 && stepAt !== 3) });
  steps.append(rowBreak());
  steps.button('Show board', () => showStep(stepAt), { disabled: () => !stepEx, title: 'Back to this step’s board' })
    .button('Next example board', () => { momentIndex = (momentIndex + 1) % lesson().moments.length; newSteps(true); }, { disabled: () => !hasSteps(), title: 'The next of this lesson’s example boards' })
    .button('New example', () => newSteps(), { disabled: () => !hasSteps(), title: 'The same strategy in new colours and target layouts' });
  steps.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); });

  const planning = panel.group('Plan a vertical triple', { hidden: () => mode !== 'plan' });
  planning.select('Paint', [...COLOUR_NAMES.map((label, value) => ({ value, label })), { value: EMPTY, label: 'Eraser' }], () => brush, (value) => { brush = value; }, { disabled: () => !!revealedPlan || !!planNextAt });
  planning.button('Show answer', revealPlan, { label: () => revealedPlan ? 'Hide answer' : 'Show answer', disabled: () => !!planNextAt })
    .button('Clear painting', clearPlan, { disabled: () => !!planNextAt })
    .button('New board', newPlan);
  function addControls(group: typeof planning, building = false, id = building ? 'build' : 'plan', submit = building): void {
  const controlsToggle = document.createElement('button');
  controlsToggle.type = 'button'; controlsToggle.className = 'tutorial-controls-toggle';
  controlsToggle.textContent = 'Show controls'; controlsToggle.setAttribute('aria-expanded', 'false');
  const controlsId = `tutorial-${id}-controls`;
  controlsToggle.setAttribute('aria-controls', controlsId);
  const controlsHelp = document.createElement('div');
  controlsHelp.id = controlsId; controlsHelp.className = 'tutorial-controls'; controlsHelp.hidden = true;
  controlsToggle.addEventListener('click', () => {
    controlsHelp.hidden = !controlsHelp.hidden;
    controlsToggle.textContent = controlsHelp.hidden ? 'Show controls' : 'Hide controls';
    controlsToggle.setAttribute('aria-expanded', String(!controlsHelp.hidden));
    if (!controlsHelp.hidden) {
      const keys = document.createElement('p'), pointer = document.createElement('p');
      keys.textContent = building
        ? `${[1, 2, 3, 4].map((n) => keyLabel(keyFor('navigation', `selectRing${n}`, String(n)))).join('/')} Rings · ${keyLabel(keyFor('navigation', 'ccw', 'arrowleft'))}/${keyLabel(keyFor('navigation', 'cw', 'arrowright'))} Turn · ${keyLabel(keyFor('navigation', 'drop', 'space'))} Drop${submit ? ' · Enter Submit' : ''}`
        : PLAN_PAINT_KEYS.map(({ id, defaultKey, colour }) => `${keyLabel(keyFor('navigation', id, defaultKey))} ${colour === EMPTY ? 'Erase' : COLOUR_NAMES[colour]}`).join(' · ');
      pointer.textContent = building ? 'Click a ring to select it; drag it to turn. After a fail: Space retries, Enter skips.' : 'Hold a key and move to paint. Click/drag also paints; right-click erases.';
      controlsHelp.replaceChildren(keys, pointer);
    }
    screen.canvas.focus({ preventScroll: true });
  });
  group.append(controlsToggle).append(controlsHelp);
  }
  addControls(planning);

  const building = panel.group('Build Ring 1', { hidden: () => mode !== 'build' });
  building.button('New board', () => newBuildPosition())
    .button('Retry board', resetBuildPosition)
    .button('Show solution', toggleBuildSolution, { label: () => buildSolutionShown ? 'Hide solution' : 'Show solution', title: 'Show an accepted ring 1 plan over your board' });
  building.select('Strictness', STRICTNESS, () => strictness, (value) => {
    strictness = value; store.set('buildStrictness', value);
    if (buildStart) buildOptions = buildOptionsFor(buildStart.targets, strictness);
  }, { title: 'Lenient: any combo that still sets off the triple. Standard: suboptimal pieces only warn. Strict: suboptimal pieces fail too.' });
  building.button('Submit (Enter)', submitBuildPosition, { variant: 'primary', disabled: () => buildStopped || buildSubmitPending });
  addControls(building, true);

  const finishing = panel.group('Finish the Combo', { hidden: () => mode !== 'finish' });
  finishing.button('New board', () => newFinish())
    .button('Retry board', resetFinish)
    .button('Show hint', toggleFinishHint, { label: () => finishHintShown ? 'Hide hint' : 'Show hint', title: 'Show the finished combo faintly over your board' });
  finishing.select('Strictness', STRICTNESS, () => strictness, (value) => {
    strictness = value; store.set('buildStrictness', value);
    if (finishDeal) finishOptions = buildOptionsFor(finishDeal.position.targets, strictness);
  }, { title: 'Lenient: any combo that still sets off the triple. Standard: suboptimal pieces only warn. Strict: suboptimal pieces fail too.' });
  finishing.button('Replay last move slowly', replayLast, { disabled: () => !lastMove, title: 'Play your last move again, slowed down, to see what it set off' });
  addControls(finishing, true);

  const scratch = panel.group('Build from scratch', { hidden: () => mode !== 'scratch' });
  scratch.button('New board', newScratch, { variant: 'primary' });
  scratch.append(rowBreak());
  scratch.button('Replay last move slowly', replayLast, { disabled: () => !lastMove, title: 'Play your last move again, slowed down, to see what it set off' });
  scratch.append(rowBreak());

  const ringGroup = panel.group('Build Ring 1', { hidden: () => mode !== 'donkeyring' });
  ringGroup.button('New board', newDonkeyRing)
    .button('Retry board', () => resetDonkeyRing())
    .button('Submit (Enter)', submitDonkeyRing, { variant: 'primary', disabled: () => ringStopped });
  addControls(ringGroup, true);
  addStats(ringGroup, 'donkeyring');
  for (const [stage, title] of [['donkeybase', 'Position the base'], ['donkeylayer', 'Build layer 2']] as const) {
    const group = panel.group(title, { hidden: () => mode !== stage });
    group.button('New board', newDonkeyStage)
      .button('Retry board', () => resetDonkeyStage())
      .button('Submit (Enter)', submitDonkeyStage, { variant: 'primary', disabled: () => stageStopped });
    addControls(group, true);
    addStats(group, stage);
  }
  for (const [drill, title] of [['r3fill', 'Fill the targets'], ['r3stack', 'Stack the pair'], ['r3build', 'Build the combo']] as const) {
    const group = panel.group(title, { hidden: () => mode !== drill });
    group.button('New board', newR3).button('Retry board', () => resetR3());
    if (drill !== 'r3build') group.button('Submit (Enter)', submitR3, { variant: 'primary', disabled: () => r3Stopped });
    addControls(group, true);
    addStats(group, drill);
  }
  const donkeyGroup = panel.group('Donkey from a blank board', { hidden: () => mode !== 'donkey' });
  donkeyGroup.button(`New board (${newBoardKeyLabel()})`, newDonkey, { variant: 'primary', title: 'A fresh board, without judging this one' });
  donkeyGroup.append(rowBreak());
  donkeyGroup.button('◀ Earlier', () => (canEndEarly() ? endDonkeyEarly() : stepFrame(-1)), { disabled: () => (donkeyFrames ? frameAt === 0 : !hasBuildToEnd()), title: 'One still back (Left arrow): back through the break, then your build. While building, ends the board here as a fail.' })
    .button('Later ▶', () => stepFrame(1), { disabled: () => !donkeyFrames || frameAt >= donkeyFrames.frames.length - 1, title: 'One still on (Right arrow)' });
  donkeyGroup.append(rowBreak());
  donkeyGroup.button('Continue from here (Space)', continueFromHere, { disabled: () => continuePoint() === null, title: 'Carry on this board from the still on screen, with the same stars to come. Not counted in your stats.' });
  for (const [label, direction] of [['◀ Earlier', -1], ['Later ▶', 1]] as const) {
    const button = [...donkeyGroup.element.querySelectorAll('button')].find((b) => b.textContent === label)!;
    button.addEventListener('pointerdown', (event) => {
      if (button.disabled || (event.button !== 0 && event.button !== 2)) return;
      event.preventDefault();
      scrub.press(direction, ticks());
    });
    // Pointer presses step immediately; keep the ordinary click for keyboard activation only.
    button.addEventListener('click', (event) => {
      if (event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }
  donkeyGroup.append(rowBreak());
  donkeyGroup.button('Replay the break', () => replayBreak(false), { disabled: () => !donkeyBreak, title: 'Watch the move that set it off, with the stars to blame ringed red' });
  donkeyGroup.append(rowBreak());
  donkeyGroup.button('Watch it fixed', () => replayBreak(true), { disabled: () => !donkeyBreak?.analysis.fix, title: 'The same break with the fix made' })
    .button('Board before the break', showBreakBoard, { disabled: () => !donkeyBreak });
  addStats(donkeyGroup, 'donkey');

  for (const [drill, title] of [['cascade-open', 'Build Ring 1 and a Drop-in'], ['cascade-setup', 'Prepare a Drop-in']] as const) {
    const group = panel.group(title, { hidden: () => mode !== drill });
    group.button('New board', newTraining).button('Retry board', resetTraining)
      .button('Submit (Enter)', submitTraining, { variant: 'primary', disabled: () => trainingStopped || trainingSubmitPending });
    addControls(group, true, drill);
    addStats(group, drill);
  }
  for (const drill of ['cascade-practice', 'practise'] as const) {
    const group = panel.group('Practice', { hidden: () => mode !== drill || !isTraining() });
    group.button(`New board (${newBoardKeyLabel()})`, newTraining)
      .button('Retry board', resetTraining);
    addControls(group, true, `${drill}-continuous`, false);
    addStats(group, drill);
  }

  const practise = panel.group('Practice', { hidden: () => mode !== 'practise' || fromScratchPractice() });
  practise.select('Stage', STAGES, () => stage, (value) => { stage = value; store.set('stage', value); stopScenes(); newPractice(); }, { title: 'How many moves before the board sets the strategy off' });
  practise.button('New board', () => { stopScenes(); newPractice(); }, { variant: 'primary' })
    .button('Reset', () => { stopScenes(); resetPractice(); }, { disabled: () => !start })
    .button('Show answer', showAnswer, { disabled: () => !start });
  practise.append(rowBreak());
  practise.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); })
    .toggle('Show the finished board', () => showGoal, (on) => { showGoal = on; store.set('showGoal', on); }, { hidden: () => stage >= 0 });

  const spot = panel.group('Spot the mistake', { hidden: () => mode !== 'spot' });
  spot.button('New board', () => newMistake(), { variant: 'primary', disabled: busy })
    .button('Vegas one link short', () => newMistake(true), { disabled: busy, hidden: () => lesson().id !== 'vegas', title: 'The vegas example with one star changed, so it charts a donkey: find that star' });
  spot.append(rowBreak());
  spot.button('Watch it go wrong', () => watchMistake(false), { disabled: () => !mistake })
    .button('Watch it fixed', () => watchMistake(true), { disabled: () => !mistake || !found });
  spot.append(rowBreak());
  spot.button('Show answer', () => {
    if (!mistake || busy()) return;
    found = true; marks = [{ cell: mistake.cell, colour: '#40ff70' }];
    status = `The ${COLOUR_NAMES[mistake.position.cells[mistake.cell]].toLowerCase()} star in ${ringLabel(Math.floor(mistake.cell / 8))} should be ${COLOUR_NAMES[mistake.fix].toLowerCase()}: as it is, it ${spoilText()}.`;
  }, { disabled: () => !mistake || found });
  spot.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); });

  const when = panel.group('Find the wrong move', { hidden: () => mode !== 'when' });
  when.button('New build', newBadBuild, { variant: 'primary', disabled: busy });
  when.append(rowBreak());
  when.button('◀ Earlier', () => buildStep(-1), { disabled: () => !bad || buildAt === 0 })
    .button('Later ▶', () => buildStep(1), { disabled: () => !bad || buildAt >= bad.moves.length });
  when.button('That move was wrong', guessMove, { disabled: () => !bad || found || buildAt === 0, title: 'The move just played is the one that spoiled the build' });
  when.append(rowBreak());
  when.button('Watch it go wrong', () => watchBuildTrigger(false), { disabled: () => !bad || buildAt < bad.moves.length })
    .button('Watch it built right', () => watchBuildTrigger(true), { disabled: () => !bad || !found });
  when.append(rowBreak());
  when.button('Show answer', () => { if (!bad) return; found = true; showBuild(bad.culprit + 1); status = wrongMoveText(); }, { disabled: () => !bad || found });
  when.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); });

  const afterTripleGroup = panel.group('After a triple', { hidden: () => mode !== 'aftertriple' });
  afterTripleGroup.button(`New board (${newBoardKeyLabel()})`, newAfterTriple, { variant: 'primary', title: 'A fresh board: a vertical triple breaks on it, then play on as normal' });

  const debug = panel.group(undefined, { hidden: () => !debugMode });
  debug.button('Export board', () => {
    if (!debugMode || busy()) return;
    const p = shown;
    const data = boardExport(p, {
      lesson: lesson().id, mode, feedback: status, selectedRing: RINGS - selected,
      phase: isTraining() ? trainingFailed ? 'failed' : trainingStopped ? 'complete' : 'building'
        : mode === 'finish' ? finishFailed ? 'failed' : finishStopped ? 'complete' : 'building'
        : mode === 'build' ? buildFailed ? 'failed' : buildStopped ? 'complete' : 'building'
        : mode === 'donkey' ? donkeyStopped() ? 'failed' : 'building'
        : mode === 'plan' ? revealedPlan ? 'answer' : 'painting' : 'viewing',
      boardNumber: isTraining() ? trainingBoard : mode === 'finish' ? finishBoard : mode === 'build' ? buildBoard : mode === 'plan' ? planBoard : undefined,
      seed: mode === 'build' ? buildSeed : game?.seed,
      initialPosition: isTraining() ? trainingInitial ?? undefined : mode === 'build' ? buildStart ?? undefined : mode === 'finish' ? finishDeal?.position : undefined,
      action: mode === 'learn' ? example.action : undefined,
      validation: setupTraining() ? checkCascadeSetup(p, mode === 'cascade-open') : mode === 'finish' ? checkFinishPosition(p, finishOptions, strictness) : mode === 'build' ? (({ check, turns }) => ({ ...check, ring2Turns: turns }))(checkBuildTurned(p, buildOptions, true, strictness)) : mode === 'plan' ? checkPlan(p) : undefined,
    });
    copyText(data, 'Copy board export:'); exportNotice = 'Board copied. Paste it into chat.';
  }, { title: 'Copy the board and validation details for chat' });
  debug.note(() => exportNotice);

  panel.controls('dennav-tutorial', [{ id: 'newBoard', label: 'New board (without judging this one)', defaultKey: NEW_BOARD_KEY }]);

  panel.group('About this strategy', { collapsed: true, hidden: () => mode === 'plan' || mode === 'build' || mode === 'aftertriple' }).append(text);

  setMode(mode);

  const key = (name: string, action: string, fallback: string) => keyMatches(name, 'navigation', action, fallback);
  /** R (or Ctrl): a new board straight away, without judging the one in play. */
  function newBoardShortcut(): void {
    clearNotice = null;
    scenes = []; afterScenes = null; waiting = false; stepping = false; replaying = false; sceneMarks = null;
    if (isTraining()) newTraining();
    else if (mode === 'donkey') newDonkey();
    else if (mode === 'donkeyring') newDonkeyRing();
    else if (isStage()) newDonkeyStage();
    else if (isR3()) newR3();
    else if (mode === 'scratch') newScratch();
    else if (mode === 'build') newBuildPosition();
    else if (mode === 'finish') newFinish();
    else if (mode === 'practise') newPractice();
    else if (mode === 'plan') newPlan();
    else if (mode === 'spot') newMistake();
    else if (mode === 'when') newBadBuild();
    else if (mode === 'learn') newExample();
    else if (mode === 'steps' && hasSteps()) newSteps();
    else if (mode === 'aftertriple') newAfterTriple();
  }
  return {
    dispose() {
      scrub.stop(); disposePointer();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('pointerup', stopScrub);
      window.removeEventListener('pointercancel', stopScrub);
      window.removeEventListener('blur', stopScrub);
      document.removeEventListener('visibilitychange', hideScrub);
      sounds.dispose(); planDetails.remove();
    },
    frame(events) {
      pointerFrame++;
      for (const command of pointerCommands.splice(0)) pointerCommand(command);
      for (const event of events) {
        if (event.type === 'mouseup') scrub.stop();
        if (mode === 'plan') {
          const paintKey = event.type === 'keydown' || event.type === 'keyup'
            ? PLAN_PAINT_KEYS.find(({ id, defaultKey }) => key(event.key, id, defaultKey)) : undefined;
          if (paintKey) {
            if (event.type === 'keyup') { if (planPaintWith === paintKey.colour) planPaintWith = null; }
            else { planPaintWith = paintKey.colour; paintPlanningAt(input.mouse, paintKey.colour); }
          } else if (event.type === 'mousedown' && (event.button === 1 || event.button === 3)) {
            if (event.button === 1) planPainting = true;
            paintPlanningAt(event.pos as [number, number], event.button === 3 ? EMPTY : planPaintWith ?? brush);
          } else if (event.type === 'mouseup' && event.button === 1) planPainting = false;
          continue;
        }
        if (event.type === 'keydown' && keyMatches(event.key, 'dennav-tutorial', 'newBoard', NEW_BOARD_KEY, NEW_BOARD_ALIASES)) { newBoardShortcut(); continue; }
        if (mode === 'donkey' && busy()) continue;
        if (event.type === 'keydown') {
          if (isTraining() && trainingStopped) {
            if (trainingFailed && event.key === 'space') resetTraining();
            else if (event.key === 'enter') newTraining();
            continue;
          }
          if (setupTraining() && event.key === 'enter') { submitTraining(); continue; }
          if (mode === 'donkeyring' && ringFailed && ringStopped) {
            if (event.key === 'space') resetDonkeyRing();
            else if (event.key === 'enter') newDonkeyRing();
            continue;
          }
          if (mode === 'donkeyring' && event.key === 'enter') { submitDonkeyRing(); continue; }
          if (isStage() && stageFailed && stageStopped) {
            if (event.key === 'space') resetDonkeyStage();
            else if (event.key === 'enter') newDonkeyStage();
            continue;
          }
          if (isStage() && event.key === 'enter') { submitDonkeyStage(); continue; }
          if (isR3() && r3Failed && r3Stopped) {
            if (event.key === 'space') resetR3();
            else if (event.key === 'enter') newR3();
            continue;
          }
          if (isR3() && event.key === 'enter') { submitR3(); continue; }
          if (mode === 'build' && buildFailed && buildStopped) {
            if (event.key === 'space') resetBuildPosition();
            else if (event.key === 'enter') newBuildPosition();
            continue;
          }
          if (mode === 'build' && event.key === 'enter') { submitBuildPosition(); continue; }
          if (mode === 'finish' && finishStopped) {
            if (finishFailed && event.key === 'space') resetFinish();
            else if (event.key === 'enter') newFinish();
            continue;
          }
          if (key(event.key, 'drop', 'space') && waiting) { next(); continue; }
          if (mode === 'when') {
            if (key(event.key, 'ccw', 'arrowleft')) buildStep(-1);
            else if (key(event.key, 'cw', 'arrowright')) buildStep(1);
            continue;
          }
          if (mode === 'learn') {
            if (key(event.key, 'ccw', 'arrowleft')) { exampleStep(-1); continue; }
            if (key(event.key, 'cw', 'arrowright')) { exampleStep(1); continue; }
          }
          if (mode === 'donkey' && donkeyStopped()) {
            // Once the board has broken, the arrows step through what happened instead of turning rings.
            if (key(event.key, 'ccw', 'arrowleft')) stepFrame(-1);
            else if (key(event.key, 'cw', 'arrowright')) stepFrame(1);
            else if (key(event.key, 'drop', 'space')) continueFromHere();
            continue;
          }
          if (!playing()) continue;
          if (key(event.key, 'ringOut', 'arrowup')) selected = Math.max(0, selected - 1);
          else if (key(event.key, 'ringIn', 'arrowdown')) selected = Math.min(RINGS - 1, selected + 1);
          else if (key(event.key, 'ccw', 'arrowleft')) practiceMove({ kind: 'rotate', ring: selected, clockwise: false });
          else if (key(event.key, 'cw', 'arrowright')) practiceMove({ kind: 'rotate', ring: selected, clockwise: true });
          else if (key(event.key, 'drop', 'space')) practiceMove({ kind: 'drop' });
          else {
            const ring = [1, 2, 3, 4].findIndex((n) => key(event.key, `selectRing${n}`, String(n)));
            if (ring >= 0) selected = RINGS - 1 - ring;
          }
        } else if (event.type === 'mousedown' && (event.button === 1 || event.button === 3)) {
          if (mode === 'donkey' && donkeyStopped()) {
            scrub.press(event.button === 1 ? -1 : 1, ticks());
            continue;
          }
          const cell = cellAt(event.pos as [number, number]);
          if (!cell) continue;
          if (mode === 'spot' && event.button === 1) clickStar(cell.ring * 8 + cell.octant);
          else if (mode === 'steps' && event.button === 1) pickHorizontal(cell.ring * 8 + cell.octant);
          // Selecting and turning rings by pointer goes through Navigation's controls (pointerControls).
        }
      }
      if (mode === 'plan') {
        const mouse = input.mouse;
        if (mouse[0] !== planMouse[0] || mouse[1] !== planMouse[1]) {
          const colour = planPaintWith ?? (planPainting ? brush : null);
          if (colour !== null) paintPlanningAt(mouse, colour);
        }
        planMouse = [...mouse];
      }
      advance(ticks());
      if (mode !== 'donkey' || busy()) scrub.stop();
      else scrub.tick(ticks());
      if (mode === 'plan' && planNextAt && ticks() >= planNextAt) newPlan();
      if (mode === 'build') {
        if (buildResetPending) {
          const failure = status; newBuildPosition(); status = `Last fail: ${failure}`;
        } else if (buildNextAt && ticks() >= buildNextAt) newBuildPosition();
      }
      if (mode === 'finish' && finishNextAt && ticks() >= finishNextAt) newFinish();
      if (isTraining() && trainingNextAt && ticks() >= trainingNextAt) newTraining();
      if (mode === 'donkeyring') {
        if (ringResetPending) { const failure = status; newDonkeyRing(); status = `Last fail: ${failure}`; }
        else if (ringNextAt && ticks() >= ringNextAt) newDonkeyRing();
      }
      if (isStage()) {
        if (stageResetPending) { const failure = status; newDonkeyStage(); status = `Last fail: ${failure}`; }
        else if (stageNextAt && ticks() >= stageNextAt) newDonkeyStage();
      }
      if (isR3()) {
        if (r3ResetPending) { const failure = status; newR3(); status = `Last fail: ${failure}`; }
        else if (r3NextAt && ticks() >= r3NextAt) newR3();
      }
      if (mode === 'aftertriple' && afterTripleAt && ticks() >= afterTripleAt) breakAfterTriple();
      if (mode === 'scratch' && settleAt && ticks() >= settleAt && !busy()) judgeScratch();
      syncPlanDetails();
      draw(ticks());
    },
  };
}) satisfies PuzzleFactory;
