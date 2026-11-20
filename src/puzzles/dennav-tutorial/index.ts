// The Dennav tutorial: lessons on each kind of chain, played on the Dennav board.
// Learn watches a move play out link by link; Practice deals the same strategy a few moves early;
// Spot the wrong star hides one wrong star in a board; Find the wrong move spoils a build-up with one bad turn.
import { Images } from '../../core/assets';
import { SoundBank } from '../../core/audio';
import { Random } from '../../core/random';
import { keyFor, keyLabel, keyMatches } from '../../core/controls';
import { copyText } from '../../core/clipboard';
import type { PuzzleFactory } from '../../core/puzzle';
import { NavigationGame, type Scene } from '../navigation/game';
import { COLOUR_NAMES, OCTANT_NAMES, PAINT_KEYS, WILD } from '../navigation/create';
import { EMPTY, type Run } from '../navigation/logic';
import {
  RINGS, INNER, MIDDLE, TOP, act, play, runStars, verticalPlan, bestHorizontals, wildedBy, planHorizontal, innerRun, guessBuild, linedUp, SETTINGS, buildUpAtMost, dropEntries, spoilBuild, chainName, fixes, gameAt, generate, makeMistake, outcome, positionOf, scramble,
  type Action, type BadBuild, type BuildGuess, type VerticalPlan, type Example, type Link, type Mistake, type Outcome, type Position,
} from './engine';
import { LESSONS, VEGAS_AS_PLAYED, type Lesson } from './lessons';
import { besideTop, checkPlan, dealPlanningBoard, paintPlan, planningOptions, type PlanCheck, type PlanningOption } from './planning';
import { builtComboIssue, buildOptionsFor, checkBuildPosition, checkBuildTurned, solutionsFor, unturnedCell, type BuildIssue, type Strictness } from './build-position';
import { boardExport } from './board-export';
import { dealFinish, finishGame, finishHint, judgeFinish, type FinishDeal } from './finish-combo';
import { DONKEY_CHAIN, analyseBreak, breakScenes, setsOff, trackStars, type DonkeyAnalysis } from './donkey-practice';

const soundUrls = import.meta.glob<string>('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' });
const imageUrls = import.meta.glob<string>('../navigation/media/*.png', { eager: true, query: '?url', import: 'default' });
const COLOURS = ['blue', 'orange', 'red', 'white', 'yellow'];
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

type Mode = 'learn' | 'steps' | 'plan' | 'build' | 'finish' | 'practise' | 'scratch' | 'donkey' | 'spot' | 'when';
const MODES: { value: Mode; label: string }[] = [
  { value: 'learn', label: '1. Example' }, { value: 'plan', label: '2. Plan Position' },
  { value: 'build', label: '3. Build Ring 1' }, { value: 'finish', label: '4. Finish the Combo' },
  { value: 'steps', label: 'Build it step by step' }, { value: 'practise', label: 'Practice' },
  { value: 'scratch', label: 'Build from scratch' }, { value: 'donkey', label: 'Donkey from scratch' },
  { value: 'spot', label: 'Spot the wrong star' }, { value: 'when', label: 'Find the wrong move' },
];
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
  const images = await Images.load(imageUrls);
  const sounds = new SoundBank(soundUrls);
  const ctx = screen.ctx;
  const rng = new Random();
  let lessonIndex = Math.max(0, LESSONS.findIndex((l) => l.id === store.get('lesson', LESSONS[0].id)));
  let mode: Mode = store.get<Mode>('mode', 'learn');
  if (!MODES.some((m) => m.value === mode)) mode = 'learn';
  let stage = store.get<number>('stage', 0);
  let slow = store.get<boolean>('slow', true);
  let ringChain = store.get<boolean>('ringChain', true);
  let debugMode = store.get<boolean>('debugMode', true), exportNotice = '';
  const lesson = (): Lesson => LESSONS[lessonIndex];

  // What's on the board.
  let shown: Position = lesson().moments[0].position;
  let example: Example = lesson().moments[0];
  let exampleLabel = lesson().moments[0].label;
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
  let scenes: { scene: Scene; caption?: string }[] = [], sceneStart = 0, stepping = false, waiting = false;
  let afterScenes: (() => void) | null = null;
  let captionText = '', status = '';
  /** Cells drawn ringed: the wrong star once found, a wrong click, the trigger's ring. */
  let marks: { cell: number; colour: string }[] = [];
  let arrowRing: { ring: number; clockwise: boolean } | null = null;
  let mistake: Mistake | null = null, found = false;
  /** Find the wrong move: the spoiled build, how far through it the board is, and the working board it was meant to reach. */
  let bad: BadBuild | null = null, buildAt = 0, goodFinal: Position | null = null, buildTrigger: Action | null = null;

  /** Replaying the last move slowly (Build from scratch). */
  let replaying = false;
  const isSlow = () => replaying || (slow && mode !== 'build' && mode !== 'finish');
  const speed = () => (isSlow() ? 2 : 1);
  const busy = () => scenes.length > 0;
  /** Modes where the player moves the rings. */
  const playing = () => mode === 'practise' || mode === 'scratch' || mode === 'donkey' || mode === 'build' || mode === 'finish';

  function playScenes(list: Scene[], captions: Map<Scene, string>, done: (() => void) | null = null): void {
    scenes = list.map((scene) => ({ scene, caption: captions.get(scene) }));
    sceneStart = ticks(); waiting = false; afterScenes = done;
    if (scenes[0]?.caption) captionText = scenes[0].caption;
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

  // --- Learn ---
  function showExample(next: Example, label: string): void {
    example = next; exampleLabel = label; shown = next.position; game = null;
    scenes = []; marks = []; status = ''; mistake = null; bad = null;
    arrowRing = next.action.kind === 'rotate' ? { ring: next.action.ring, clockwise: next.action.clockwise } : null;
    if (ringChain) marks = runStars(next.position, next.action).map((cell) => ({ cell, colour: '#ffd84a' }));
    captionText = `${label}: ${moveText(next.action, next.position.entry)} sets it off.`;
  }
  function watch(step: boolean): void {
    if (busy()) return;
    const g = gameAt(example.position);
    const list = act(g, example.action);
    const o = outcome(list, positionOf(g));
    stepping = step; arrowRing = null; marks = [];
    playScenes(list, captionsFor(o), () => {
      shown = positionOf(g);
      captionText = o.charted ? `Charted as a ${chainName(o.charted).toLowerCase()}.${o.nextInnerWild ? ' The next constellation starts with ring 1 wild.' : ''}` : 'Nothing charted.';
    });
  }
  function nextMoment(): void {
    const moments = lesson().moments;
    momentIndex = (momentIndex + 1) % moments.length;
    showExample(moments[momentIndex], moments[momentIndex].label);
  }
  function newExample(): void {
    const moments = lesson().moments;
    const seed = moments[rng.integer(0, moments.length - 1)];
    showExample(generate(seed, lesson().accepts, rng, lesson().keep), 'New example');
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
      marks = runStars(ex.position, ex.action).map((cell) => ({ cell, colour: yellow }));
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
    playScenes(list, captionsFor(o), () => {
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
    paintedPlan = dealPlanningBoard(rng, planBoard === 0);
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
  let pauseBuildOnFail = store.get<boolean>('pauseBuildOnFail', true);
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
    const p = source ?? dealPlanningBoard(rng, buildBoard === 0);
    buildStart = { ...p, cells: p.cells.map(() => EMPTY), targets: p.targets.map((t) => ({ ...t })) };
    buildOptions = buildOptionsFor(buildStart.targets, strictness);
    buildSeed = rng.integer(1, 0x7fffffff); buildBoard++;
    resetBuildPosition();
  }
  function resetBuildPosition(): void {
    if (!buildStart) return;
    input.drain(); // Pending keys belonged to the previous attempt.
    game = new NavigationGame(SETTINGS, buildSeed);
    game.targets = buildStart.targets.map((t) => ({ ...t }));
    shown = positionOf(game);
    scenes = []; afterScenes = null; waiting = false; marks = []; arrowRing = null;
    queued = []; lastMove = null; replaying = false; replayWanted = false; settleAt = 0;
    selected = INNER; buildMoves = 0; buildStopped = false; buildFailed = false; buildSolutionShown = false;
    buildResetPending = false; buildSubmitPending = false; buildNextAt = 0;
    captionText = `Board ${buildBoard} · ${buildsSolved} built`;
    status = buildInstructions;
  }
  function failBuildPosition(issue: BuildIssue, p: Position): void {
    shown = p; scenes = []; afterScenes = null; waiting = false;
    buildStopped = true; buildFailed = true; buildNextAt = 0;
    buildSubmitPending = false; queued = [];
    marks = issue.cells.map((cell) => ({ cell, colour: PLAN_PROBLEM_OUTLINE }));
    captionText = issue.message; status = pauseBuildOnFail ? `${issue.message} Space: retry · Enter: next.` : issue.message;
    sounds.play('buzz', 0.6);
    buildResetPending = !pauseBuildOnFail;
    syncPlanDetails(); draw(ticks());
  }
  function submitBuildPosition(): void {
    if (!game || buildStopped || buildSubmitPending) return;
    buildSubmitPending = true;
    if (!busy() && !queued.length) judgeBuildPosition();
    else status = 'Finishing moves before judging…';
  }
  function judgeBuildPosition(): void {
    if (!game || buildStopped || busy() || queued.length) return;
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
  function buildPositionMove(action: Action, fromQueue = false): void {
    if (!game || !buildStart || buildStopped || (buildSubmitPending && !fromQueue)) return;
    if (busy()) { if (queued.length < 4) queued.push(action); return; }
    const g = game;
    const list = act(g, action);
    if (!list.length) {
      if (g.booched) { shown = positionOf(g); captionText = 'Board booched'; status = 'Board booched. Press Enter to submit.'; }
      if (g.booched) queued = [];
      const nextMove = queued.shift();
      if (nextMove) buildPositionMove(nextMove, true);
      else if (buildSubmitPending) judgeBuildPosition();
      return;
    }
    buildMoves++;
    marks = []; stepping = false;
    captionText = `Board ${buildBoard} · ${buildMoves} moves · Enter to submit`;
    status = buildSubmitPending ? 'Finishing moves before judging…' : buildInstructions;
    playScenes(list, captionsFor(outcome(list, positionOf(g))), () => {
      shown = positionOf(g);
      const nextMove = queued.shift();
      if (nextMove) buildPositionMove(nextMove, true);
      else if (buildSubmitPending) judgeBuildPosition();
    });
  }

  // --- Finish the Combo: the first bag is placed; play on with the game's next stars to the triple. ---
  let finishDeal: FinishDeal | null = null, finishOptions: PlanningOption[] = [];
  let finishBoard = 0, finishSolved = 0, finishMoves = 0, finishNextAt = 0;
  let finishStopped = false, finishFailed = false, finishHintShown = false;
  const finishInstructions = 'Finish the vertical through rings 1–3 with the pair’s colour in ring 4 above it, fill the targets that won’t turn wild, and set it off.';
  function newFinish(): void {
    finishDeal = dealFinish(rng, strictness, finishBoard === 0);
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
    queued = []; lastMove = null; replaying = false; replayWanted = false;
    selected = TOP; finishMoves = 0; finishStopped = false; finishFailed = false; finishNextAt = 0;
    captionText = `Board ${finishBoard} · ${finishSolved} finished`;
    status = finishInstructions;
  }
  function failFinish(issue: BuildIssue, p: Position): void {
    shown = p; scenes = []; afterScenes = null; waiting = false; queued = [];
    finishStopped = true; finishFailed = true;
    marks = issue.cells.map((cell) => ({ cell, colour: PLAN_PROBLEM_OUTLINE }));
    captionText = issue.message; status = `${issue.message} Space: retry · Enter: next.`;
    sounds.play('buzz', 0.6);
    syncPlanDetails(); draw(ticks());
  }
  function finishMove(action: Action, fromQueue = false): void {
    if (!game || !finishDeal || finishStopped) return;
    if (busy() && !fromQueue) { if (queued.length < 4 && !replaying) queued.push(action); return; }
    const g = game;
    const before = positionOf(g);
    const list = act(g, action);
    const after = positionOf(g);
    if (!list.length && !g.booched) { const nextMove = queued.shift(); if (nextMove) finishMove(nextMove, true); return; }
    lastMove = { before, action };
    finishMoves++; marks = []; stepping = false;
    const o = outcome(list, after);
    const judge = () => {
      shown = positionOf(g);
      const result = judgeFinish(o, after, g.booched, finishOptions, strictness, lesson().accepts);
      if (result.kind === 'failed') { failFinish(result.issue, shown); return; }
      if (result.kind === 'success') {
        finishStopped = true; finishFailed = false; finishSolved++; queued = [];
        finishNextAt = ticks() + 2500;
        captionText = 'Triple!'; status = `Yes! ${lesson().success} Next board…`;
        return;
      }
      // Suboptimal pieces: keep playing, but say so, with their cells in the softer colour.
      marks = result.warnings.flatMap((w) => w.cells.map((cell) => ({ cell, colour: PLAN_WARNING_OUTLINE })));
      captionText = `Board ${finishBoard} · ${finishMoves} moves`;
      status = result.warnings.length ? `Careful: ${result.warnings.map((w) => `${w.message.replace(/\.$/, '')} (suboptimal)`).join('; ')}.` : finishInstructions;
      const nextMove = queued.shift();
      if (nextMove) finishMove(nextMove, true);
    };
    if (!list.length) { judge(); return; }
    playScenes(list, captionsFor(o), judge);
  }
  function toggleFinishHint(): void { finishHintShown = !finishHintShown; draw(ticks()); }

  // --- Build from scratch ---
  /** What the board looks like it's building, and the line-ups already buzzed for. */
  let guess: BuildGuess | null = null, buzzed = new Set<string>();
  /** Moves made while the last was playing out, and the last move with the board before it, to replay slowly. */
  let queued: Action[] = [], lastMove: { before: Position; action: Action } | null = null;
  let replayWanted = false;
  function replayLast(): void {
    if (!lastMove || !game || replaying) return;
    // Pressed while a move plays out: replay once it (and any moves waiting) have finished.
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
    game = new NavigationGame(SETTINGS, rng.integer(1, 0x7fffffff));
    start = null; upcoming = []; goal = null;
    shown = positionOf(game);
    scenes = []; afterScenes = null; waiting = false; replaying = false; replayWanted = false; queued = []; settleAt = 0; stable = 0; judged = null; lastMove = null; marks = []; arrowRing = null; moves = 0; selected = RINGS - 1; guess = null; buzzed = new Set();
    captionText = '';
    status = 'Build vertical triples from scratch. When the board looks like one is being built, its stars are marked, and a buzz sounds if two of a colour are stacked in rings 1 and 2 or rings 2 and 3 (as the rings sit, or after the turn you’re saving), since one more of that colour would clear them early.';
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
    if (!sure) return;
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
    if (mode === 'build') { buildPositionMove(action); return; }
    if (mode === 'finish') { finishMove(action); return; }
    if (mode === 'donkey') { donkeyMove(action); return; }
    // From scratch: moves made while one plays out wait their turn, as in the game.
    if (busy() && mode === 'scratch') { if (queued.length < 4 && !replaying) queued.push(action); return; }
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
        const nextMove = queued.shift();
        if (nextMove) practiceMove(nextMove);
        else if (replayWanted) { replayWanted = false; replayLast(); }
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

  // --- Donkey from a blank board ---
  /** The move that set the board off, and what it did against a donkey (or a vegas, on that lesson). */
  let donkeyBreak: { before: Position; action: Action; analysis: DonkeyAnalysis } | null = null;
  /** Marks for each scene of a replayed break: the blamed stars follow the move. */
  let sceneMarks: Map<Scene, { cell: number; colour: string }[]> | null = null;
  const BLAME = '#ff4040', TARGET_BLAME = '#ffb040', FIXED = '#40ff70';
  const donkeyGoal = () => lesson().id === 'vegas' ? DONKEY_CHAIN + 1 : DONKEY_CHAIN;
  const donkeyWord = () => lesson().id === 'vegas' ? 'vegas' : 'donkey';
  function newDonkey(): void {
    game = new NavigationGame(SETTINGS, rng.integer(1, 0x7fffffff));
    start = null; upcoming = []; goal = null; donkeyBreak = null; sceneMarks = null;
    shown = positionOf(game);
    scenes = []; afterScenes = null; waiting = false; stepping = false; replaying = false; queued = []; marks = []; arrowRing = null; moves = 0; selected = RINGS - 1;
    captionText = '';
    status = `Build a ${donkeyWord()} on a fresh board. The first move that sets off a double or longer chain ends the board (a single clear doesn’t), and you’ll see what it charted and what to change. Ctrl starts a new board.`;
  }
  function donkeyMove(action: Action): void {
    if (!game || donkeyBreak) return;
    // Moves made while one plays out wait their turn, as in the game.
    if (busy()) { if (queued.length < 4 && !replaying) queued.push(action); return; }
    if (action.kind === 'drop' && game.board.get(game.entry.octant, 0) !== EMPTY) { status = 'That drop would booch the board.'; return; }
    const before = positionOf(game);
    const list = act(game, action);
    if (!list.length) return;
    moves++;
    const o = outcome(list, positionOf(game));
    const g = game;
    const broke = setsOff(o);
    if (broke) queued = [];
    stepping = false;
    playScenes(list, captionsFor(o), () => {
      shown = positionOf(g);
      if (broke) { endDonkey(before, action); return; }
      const nextMove = queued.shift();
      if (nextMove) donkeyMove(nextMove);
    });
  }
  function breakMarks(a: DonkeyAnalysis): { cell: number; colour: string }[] {
    return [...a.stars.map((cell) => ({ cell, colour: BLAME })), ...a.targets.map((cell) => ({ cell, colour: TARGET_BLAME }))];
  }
  function endDonkey(before: Position, action: Action): void {
    const analysis = analyseBreak(before, action, donkeyGoal());
    donkeyBreak = { before, action, analysis };
    game = null; queued = [];
    showBreakBoard();
    status = `${analysis.headline} ${analysis.problem}${analysis.fix ? ` ${analysis.fix.text}` : ''} ${analysis.success ? '' : 'Replay the break to watch it with that ringed. '}Ctrl starts a new board.`;
  }
  /** The board just before the break, with the stars to blame ringed red and targets amber. */
  function showBreakBoard(): void {
    if (!donkeyBreak || busy()) return;
    const { before, action, analysis } = donkeyBreak;
    shown = before; sceneMarks = null;
    marks = breakMarks(analysis);
    arrowRing = action.kind === 'rotate' ? { ring: action.ring, clockwise: action.clockwise } : null;
    captionText = `Before the break: ${moveText(action, action.kind === 'drop' ? before.entry : undefined)}.`;
  }
  /** Plays the break again, slowed, with the blamed stars ringed as they move; or the fixed board. */
  function replayBreak(fixed: boolean, step: boolean): void {
    if (!donkeyBreak || busy()) return;
    const { analysis } = donkeyBreak;
    const fix = analysis.fix;
    if (fixed && !fix) return;
    const p = fixed ? fix!.position : donkeyBreak.before, action = fixed ? fix!.action : donkeyBreak.action;
    replaying = true;
    const { scenes: played, result } = breakScenes(p, action);
    const list = paced(played, gameAt(p));
    const tracked = trackStars(list, fixed ? fix!.cells : analysis.stars);
    const fixedTargets = fixed ? [] : analysis.targets;
    sceneMarks = new Map(list.map((scene) => [scene, [
      ...(tracked.get(scene) ?? []).map((cell) => ({ cell, colour: fixed ? FIXED : BLAME })),
      ...fixedTargets.map((cell) => ({ cell, colour: TARGET_BLAME })),
    ]]));
    const last = list.at(-1);
    if (last && !fixed && analysis.end.length) sceneMarks.set(last, [...(sceneMarks.get(last) ?? []), ...analysis.end.map((cell) => ({ cell, colour: BLAME }))]);
    shown = p; marks = []; arrowRing = null; stepping = step;
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
    if (!bad || buildAt === 0 || found) return;
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
      const colour = scene.cells[t.ring * 8 + t.octant];
      const matches = colour !== -1 && (t.wild || colour === t.colour) && !falling.has(t.ring * 8 + t.octant) && scene.rotation?.ring !== t.ring;
      if (t.wild) {
        const [x, y] = position(t.octant, radius(t.ring));
        ctx.drawImage(images.get('star_wild'), ((matches ? 8 : 0) + (t.octant + 2) % 8) * 56, 0, 56, 56, Math.trunc(x) - 28, Math.trunc(y) - 28, 56, 56);
      } else star(t.colour, t.octant, radius(t.ring), matches, true);
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
      if (angle === o) star(colour, o, r, !!target && (target.wild || target.colour === colour));
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
    const scene: Scene = current?.scene ?? { cells: shown.cells, targets: shown.targets, duration: 0 };
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
      if (playing() && game && !game.finished && mode !== 'scratch' && mode !== 'donkey' && mode !== 'build' && mode !== 'finish') star(game.entry.colour, game.entry.octant, 205);
      if (mode === 'when' && bad && bad.moves[buildAt]?.kind === 'drop') star(bad.boards[buildAt].entry.colour, bad.boards[buildAt].entry.octant, 205);
    }
    // From scratch keeps the next star in view while a move plays out.
    if ((mode === 'scratch' || mode === 'donkey' || (mode === 'build' && !buildStopped) || (mode === 'finish' && !finishStopped)) && game && !game.finished) star(game.entry.colour, game.entry.octant, 205);
    drawCaption(captionText);
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
    if (scenes[0]?.caption) captionText = scenes[0].caption;
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
    if ((next === 'plan' || next === 'build' || next === 'finish') && !hasSteps()) {
      lessonIndex = LESSONS.findIndex((l) => l.id === 'vertical-triple'); momentIndex = 0;
      store.set('lesson', lesson().id); renderText();
    }
    if (next === 'donkey' && lesson().id !== 'donkey' && lesson().id !== 'vegas') {
      lessonIndex = LESSONS.findIndex((l) => l.id === 'donkey'); momentIndex = 0;
      store.set('lesson', lesson().id); renderText();
    }
    mode = next; store.set('mode', mode);
    sceneMarks = null; donkeyBreak = null; replaying = false; stepping = false;
    scenes = []; marks = []; status = ''; mistake = null; bad = null; game = null; start = null;
    waiting = false; afterScenes = null; planNextAt = 0; planPaintWith = null; planPainting = false;
    buildResetPending = false; buildSubmitPending = false; buildNextAt = 0; buildStopped = false; buildFailed = false; buildSolutionShown = false; queued = [];
    if (mode === 'learn') showExample(lesson().moments[momentIndex] ?? lesson().moments[0], (lesson().moments[momentIndex] ?? lesson().moments[0]).label);
    else if (mode === 'steps') newSteps(true);
    else if (mode === 'plan') newPlan();
    else if (mode === 'build') newBuildPosition(true);
    else if (mode === 'finish') newFinish();
    else if (mode === 'practise') newPractice();
    else if (mode === 'scratch') newScratch();
    else if (mode === 'donkey') newDonkey();
    else if (mode === 'when') newBadBuild();
    else newMistake();
  }
  function setLesson(index: number): void {
    lessonIndex = index; momentIndex = 0; store.set('lesson', lesson().id);
    renderText();
    setMode(((mode === 'plan' || mode === 'build' || mode === 'finish') && !hasSteps()) || (mode === 'donkey' && lesson().id !== 'donkey' && lesson().id !== 'vegas') ? 'learn' : mode);
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

  const lessonGroup = panel.group('Lesson');
  lessonGroup.select('Lesson', LESSONS.map((l, value) => ({ value, label: l.title })), () => lessonIndex, setLesson);
  lessonGroup.select('Mode', MODES, () => mode, setMode);
  lessonGroup.note(() => mode === 'build' || mode === 'finish' || (mode === 'plan' && (planCheck || revealedPlan || planNotice)) ? '' : status);

  const rowBreak = () => document.createElement('div');
  panel.settings.group('Debug').toggle('Debug mode', () => debugMode, (on) => {
    debugMode = on; store.set('debugMode', on); exportNotice = '';
  });
  const learn = panel.group('Watch', { hidden: () => mode !== 'learn' });
  learn.button('Play move', () => watch(false), { variant: 'primary', disabled: busy })
    .button('Step', () => watch(true), { disabled: busy, title: 'Play the move one link at a time; press Next (or Space) for each link' })
    .button('Next', next, { disabled: () => !waiting });
  learn.append(rowBreak());
  learn.button('Show board', () => showExample(example, exampleLabel), { disabled: busy, title: 'Back to the board before the move' })
    .button('Next example board', nextMoment, { disabled: busy, title: 'The next of this lesson’s example boards' })
    .button('New example', newExample, { disabled: busy, title: 'The same strategy in new colours and target layouts' });
  learn.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); })
    .toggle('Ring the chain stars', () => ringChain, (on) => { ringChain = on; store.set('ringChain', on); if (!busy()) showExample(example, exampleLabel); }, { title: 'Before the move, ring the stars its clears will use' });

  const steps = panel.group('Step by step', { hidden: () => mode !== 'steps' });
  steps.button('◀ Back', () => showStep(stepAt - 1), { disabled: () => busy() || !stepEx || stepAt === 0 })
    .button('Next step ▶', () => showStep(stepAt + 1), { variant: 'primary', disabled: () => busy() || !stepEx || stepAt === 3 })
    .button('Play move', playSteps, { disabled: () => busy() || !stepEx || (stepAt !== 0 && stepAt !== 3) });
  steps.append(rowBreak());
  steps.button('Show board', () => showStep(stepAt), { disabled: () => busy() || !stepEx, title: 'Back to this step’s board' })
    .button('Next example board', () => { momentIndex = (momentIndex + 1) % lesson().moments.length; newSteps(true); }, { disabled: () => busy() || !hasSteps(), title: 'The next of this lesson’s example boards' })
    .button('New example', () => newSteps(), { disabled: () => busy() || !hasSteps(), title: 'The same strategy in new colours and target layouts' });
  steps.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); });

  const planning = panel.group('Plan a vertical triple', { hidden: () => mode !== 'plan' });
  planning.select('Paint', [...COLOUR_NAMES.map((label, value) => ({ value, label })), { value: EMPTY, label: 'Eraser' }], () => brush, (value) => { brush = value; }, { disabled: () => !!revealedPlan || !!planNextAt });
  planning.button('Show answer', revealPlan, { label: () => revealedPlan ? 'Hide answer' : 'Show answer', disabled: () => !!planNextAt })
    .button('Clear painting', clearPlan, { disabled: () => !!planNextAt })
    .button('New board', newPlan);
  function addControls(group: typeof planning, building = false): void {
  const controlsToggle = document.createElement('button');
  controlsToggle.type = 'button'; controlsToggle.className = 'tutorial-controls-toggle';
  controlsToggle.textContent = 'Show controls'; controlsToggle.setAttribute('aria-expanded', 'false');
  const controlsId = building ? 'tutorial-build-controls' : 'tutorial-plan-controls';
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
        ? `${[1, 2, 3, 4].map((n) => keyLabel(keyFor('navigation', `selectRing${n}`, String(n)))).join('/')} Rings · ${keyLabel(keyFor('navigation', 'ccw', 'arrowleft'))}/${keyLabel(keyFor('navigation', 'cw', 'arrowright'))} Turn · ${keyLabel(keyFor('navigation', 'drop', 'space'))} Drop · Enter Submit`
        : PLAN_PAINT_KEYS.map(({ id, defaultKey, colour }) => `${keyLabel(keyFor('navigation', id, defaultKey))} ${colour === EMPTY ? 'Erase' : COLOUR_NAMES[colour]}`).join(' · ');
      pointer.textContent = building ? 'Click to select, then turn; right-click turns left. After a fail: Space retries, Enter skips.' : 'Hold a key and move to paint. Click/drag also paints; right-click erases.';
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
  building.toggle('Pause on fail', () => pauseBuildOnFail, (on) => {
    pauseBuildOnFail = on; store.set('pauseBuildOnFail', on);
    if (!on && buildFailed) newBuildPosition();
  });
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
  scratch.button('Rotate left', () => practiceMove({ kind: 'rotate', ring: selected, clockwise: false }))
    .button('Rotate right', () => practiceMove({ kind: 'rotate', ring: selected, clockwise: true }))
    .button('Drop star', () => practiceMove({ kind: 'drop' }));
  scratch.append(rowBreak());
  scratch.button('Replay last move slowly', replayLast, { disabled: () => !lastMove, title: 'Play your last move again, slowed down, to see what it set off' });
  scratch.append(rowBreak());
  scratch.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); });

  const donkeyGroup = panel.group('Donkey from a blank board', { hidden: () => mode !== 'donkey' });
  donkeyGroup.button('New board (Ctrl)', newDonkey, { variant: 'primary', title: 'A fresh board, without judging this one' });
  donkeyGroup.append(rowBreak());
  donkeyGroup.button('Rotate left', () => practiceMove({ kind: 'rotate', ring: selected, clockwise: false }), { disabled: () => !!donkeyBreak })
    .button('Rotate right', () => practiceMove({ kind: 'rotate', ring: selected, clockwise: true }), { disabled: () => !!donkeyBreak })
    .button('Drop star', () => practiceMove({ kind: 'drop' }), { disabled: () => !!donkeyBreak });
  donkeyGroup.append(rowBreak());
  donkeyGroup.button('Replay the break', () => replayBreak(false, false), { disabled: () => busy() || !donkeyBreak, title: 'Watch the move that set it off, slowed down, with the stars to blame ringed red' })
    .button('Step through it', () => replayBreak(false, true), { disabled: () => busy() || !donkeyBreak, title: 'One link at a time: press Next (or Space) for each' })
    .button('Next', next, { disabled: () => !waiting });
  donkeyGroup.append(rowBreak());
  donkeyGroup.button('Watch it fixed', () => replayBreak(true, false), { disabled: () => busy() || !donkeyBreak?.analysis.fix, title: 'The same break with the fix made' })
    .button('Board before the break', showBreakBoard, { disabled: () => busy() || !donkeyBreak });
  donkeyGroup.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); });

  const practise = panel.group('Practice', { hidden: () => mode !== 'practise' });
  practise.select('Stage', STAGES, () => stage, (value) => { stage = value; store.set('stage', value); newPractice(); }, { disabled: busy, title: 'How many moves before the board sets the strategy off' });
  practise.button('New board', newPractice, { variant: 'primary', disabled: busy })
    .button('Reset', resetPractice, { disabled: () => busy() || !start })
    .button('Show answer', showAnswer, { disabled: () => busy() || !start });
  practise.append(rowBreak());
  practise.button('Rotate left', () => practiceMove({ kind: 'rotate', ring: selected, clockwise: false }), { disabled: busy })
    .button('Rotate right', () => practiceMove({ kind: 'rotate', ring: selected, clockwise: true }), { disabled: busy })
    .button('Drop star', () => practiceMove({ kind: 'drop' }), { disabled: busy });
  practise.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); })
    .toggle('Show the finished board', () => showGoal, (on) => { showGoal = on; store.set('showGoal', on); }, { hidden: () => stage >= 0 });

  const spot = panel.group('Spot the mistake', { hidden: () => mode !== 'spot' });
  spot.button('New board', () => newMistake(), { variant: 'primary', disabled: busy })
    .button('Vegas one link short', () => newMistake(true), { disabled: busy, hidden: () => lesson().id !== 'vegas', title: 'The vegas example with one star changed, so it charts a donkey: find that star' });
  spot.append(rowBreak());
  spot.button('Watch it go wrong', () => watchMistake(false), { disabled: () => busy() || !mistake })
    .button('Watch it fixed', () => watchMistake(true), { disabled: () => busy() || !mistake || !found });
  spot.append(rowBreak());
  spot.button('Show answer', () => {
    if (!mistake) return;
    found = true; marks = [{ cell: mistake.cell, colour: '#40ff70' }];
    status = `The ${COLOUR_NAMES[mistake.position.cells[mistake.cell]].toLowerCase()} star in ${ringLabel(Math.floor(mistake.cell / 8))} should be ${COLOUR_NAMES[mistake.fix].toLowerCase()}: as it is, it ${spoilText()}.`;
  }, { disabled: () => busy() || !mistake || found });
  spot.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); });

  const when = panel.group('Find the wrong move', { hidden: () => mode !== 'when' });
  when.button('New build', newBadBuild, { variant: 'primary', disabled: busy });
  when.append(rowBreak());
  when.button('◀ Earlier', () => buildStep(-1), { disabled: () => busy() || !bad || buildAt === 0 })
    .button('Later ▶', () => buildStep(1), { disabled: () => busy() || !bad || buildAt >= bad.moves.length });
  when.button('That move was wrong', guessMove, { disabled: () => busy() || !bad || found || buildAt === 0, title: 'The move just played is the one that spoiled the build' });
  when.append(rowBreak());
  when.button('Watch it go wrong', () => watchBuildTrigger(false), { disabled: () => busy() || !bad || buildAt < bad.moves.length })
    .button('Watch it built right', () => watchBuildTrigger(true), { disabled: () => busy() || !bad || !found });
  when.append(rowBreak());
  when.button('Show answer', () => { if (!bad) return; found = true; showBuild(bad.culprit + 1); status = wrongMoveText(); }, { disabled: () => busy() || !bad || found });
  when.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); });

  const debug = panel.group(undefined, { hidden: () => !debugMode });
  debug.button('Export board', () => {
    if (!debugMode || busy()) return;
    const p = shown;
    const data = boardExport(p, {
      lesson: lesson().id, mode, feedback: status, selectedRing: RINGS - selected,
      phase: mode === 'finish' ? finishFailed ? 'failed' : finishStopped ? 'complete' : 'building'
        : mode === 'build' ? buildFailed ? 'failed' : buildStopped ? 'complete' : 'building'
        : mode === 'plan' ? revealedPlan ? 'answer' : 'painting' : 'viewing',
      boardNumber: mode === 'finish' ? finishBoard : mode === 'build' ? buildBoard : mode === 'plan' ? planBoard : undefined,
      seed: mode === 'build' ? buildSeed : game?.seed,
      initialPosition: mode === 'build' ? buildStart ?? undefined : mode === 'finish' ? finishDeal?.position : undefined,
      action: mode === 'learn' ? example.action : undefined,
      validation: mode === 'finish' ? checkBuildPosition(p, finishOptions, true, strictness) : mode === 'build' ? (({ check, turns }) => ({ ...check, ring2Turns: turns }))(checkBuildTurned(p, buildOptions, true, strictness)) : mode === 'plan' ? checkPlan(p) : undefined,
    });
    copyText(data, 'Copy board export:'); exportNotice = 'Board copied. Paste it into chat.';
  }, { disabled: busy, title: 'Copy the board and validation details for chat' });
  debug.note(() => exportNotice);

  panel.controls('dennav-tutorial', [{ id: 'newBoard', label: 'New board (without judging this one)', defaultKey: 'control' }]);

  panel.group('About this strategy', { collapsed: true, hidden: () => mode === 'plan' || mode === 'build' }).append(text);

  setMode(mode);

  const key = (name: string, action: string, fallback: string) => keyMatches(name, 'navigation', action, fallback);
  /** Ctrl: a new board straight away, without judging the one in play. */
  function newBoardShortcut(): void {
    scenes = []; afterScenes = null; waiting = false; stepping = false; replaying = false; queued = []; sceneMarks = null;
    if (mode === 'donkey') newDonkey();
    else if (mode === 'scratch') newScratch();
    else if (mode === 'build') newBuildPosition();
    else if (mode === 'finish') newFinish();
    else if (mode === 'practise') newPractice();
    else if (mode === 'plan') newPlan();
    else if (mode === 'spot') newMistake();
    else if (mode === 'when') newBadBuild();
    else if (mode === 'learn') newExample();
    else if (mode === 'steps' && hasSteps()) newSteps();
  }
  return {
    dispose() { sounds.dispose(); planDetails.remove(); },
    frame(events) {
      for (const event of events) {
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
        if (event.type === 'keydown' && keyMatches(event.key, 'dennav-tutorial', 'newBoard', 'control')) { newBoardShortcut(); continue; }
        if (event.type === 'keydown') {
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
          const cell = cellAt(event.pos as [number, number]);
          if (!cell) continue;
          if (mode === 'spot' && event.button === 1) clickStar(cell.ring * 8 + cell.octant);
          else if (mode === 'steps' && event.button === 1) pickHorizontal(cell.ring * 8 + cell.octant);
          else if (playing()) {
            if (selected !== cell.ring) selected = cell.ring;
            else practiceMove({ kind: 'rotate', ring: selected, clockwise: event.button === 1 });
          }
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
      if (mode === 'plan' && planNextAt && ticks() >= planNextAt) newPlan();
      if (mode === 'build') {
        if (buildResetPending) {
          const failure = status; newBuildPosition(); status = `Last fail: ${failure}`;
        } else if (buildNextAt && ticks() >= buildNextAt) newBuildPosition();
      }
      if (mode === 'finish' && finishNextAt && ticks() >= finishNextAt) newFinish();
      if (mode === 'scratch' && settleAt && ticks() >= settleAt && !busy() && !queued.length) judgeScratch();
      syncPlanDetails();
      draw(ticks());
    },
  };
}) satisfies PuzzleFactory;
