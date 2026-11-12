// The Dennav tutorial: lessons on each kind of chain, played on the Dennav board.
// Learn watches a move play out link by link; Practice deals the same strategy a few moves early;
// Spot the wrong star hides one wrong star in a board; Find the wrong move spoils a build-up with one bad turn.
import { Images } from '../../core/assets';
import { SoundBank } from '../../core/audio';
import { Random } from '../../core/random';
import { keyMatches } from '../../core/controls';
import type { PuzzleFactory } from '../../core/puzzle';
import { NavigationGame, type Scene } from '../navigation/game';
import { COLOUR_NAMES, OCTANT_NAMES } from '../navigation/create';
import { EMPTY, type Run } from '../navigation/logic';
import {
  RINGS, INNER, MIDDLE, TOP, act, play, runStars, verticalPlan, bestHorizontals, wildedBy, planHorizontal, innerRun, guessBuild, linedUp, SETTINGS, buildUpAtMost, dropEntries, spoilBuild, chainName, fixes, gameAt, generate, makeMistake, outcome, positionOf, scramble,
  type Action, type BadBuild, type BuildGuess, type VerticalPlan, type Example, type Link, type Mistake, type Outcome, type Position,
} from './engine';
import { LESSONS, VEGAS_AS_PLAYED, type Lesson } from './lessons';

const soundUrls = import.meta.glob<string>('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' });
const imageUrls = import.meta.glob<string>('../navigation/media/*.png', { eager: true, query: '?url', import: 'default' });
const COLOURS = ['blue', 'orange', 'red', 'white', 'yellow'];
const CX = 225, CY = 300;
const radius = (ring: number) => 55 + (RINGS - 1 - ring) * 47;
const position = (octant: number, r: number): [number, number] => [CX + Math.cos(octant * Math.PI / 4) * r, CY - Math.sin(octant * Math.PI / 4) * r];
const ringLabel = (ring: number) => `ring ${RINGS - ring}`;

type Mode = 'learn' | 'steps' | 'practise' | 'scratch' | 'spot' | 'when';
const MODES: { value: Mode; label: string }[] = [
  { value: 'learn', label: 'Learn' }, { value: 'steps', label: 'Build it step by step' }, { value: 'practise', label: 'Practice' },
  { value: 'scratch', label: 'Build from scratch' },
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

export default (async ({ screen, panel, store, ticks }) => {
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
  const isSlow = () => slow || replaying;
  const speed = () => (isSlow() ? 2 : 1);
  const busy = () => scenes.length > 0;
  /** Modes where the player moves the rings. */
  const playing = () => mode === 'practise' || mode === 'scratch';

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
    showExample(generate(seed, lesson().accepts, rng), 'New example');
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
        : generate(l.moments[rng.integer(0, l.moments.length - 1)], l.accepts, rng);
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

  // --- Build from scratch ---
  /** What the board looks like it's building, and the line-ups already buzzed for. */
  let guess: BuildGuess | null = null, buzzed = new Set<string>();
  /** Moves made while the last was playing out, and the last move with the board before it, to replay slowly. */
  let queued: Action[] = [], lastMove: { before: Position; action: Action } | null = null;
  function replayLast(): void {
    if (!lastMove || busy() || !game) return;
    const g = gameAt(lastMove.before);
    const list = act(g, lastMove.action);
    const o = outcome(list, positionOf(g));
    const live = game;
    replaying = true; stepping = false; marks = []; shown = lastMove.before;
    captionText = `Last move: ${moveText(lastMove.action, lastMove.action.kind === 'drop' ? lastMove.before.entry : undefined)}`;
    playScenes(list, captionsFor(o), () => { replaying = false; shown = positionOf(live); captionText = ''; checkScratch(); });
  }
  function newScratch(): void {
    game = new NavigationGame(SETTINGS, rng.integer(1, 0x7fffffff));
    start = null; upcoming = []; goal = null;
    shown = positionOf(game);
    scenes = []; afterScenes = null; waiting = false; replaying = false; queued = []; settleAt = 0; stable = 0; judged = null; lastMove = null; marks = []; arrowRing = null; moves = 0; selected = RINGS - 1; guess = null; buzzed = new Set();
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
      const ex = generate(seed, l.accepts, rng);
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
      if (mode === 'scratch') { checkScratch(); const nextMove = queued.shift(); if (nextMove) practiceMove(nextMove); return; }
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

  // --- Spot the wrong star ---
  function newMistake(asPlayed = false): void {
    const l = lesson();
    for (let tries = 0; tries < 20; tries++) {
      const ex = asPlayed ? VEGAS_AS_PLAYED : generate(l.moments[rng.integer(0, l.moments.length - 1)], l.accepts, rng);
      const m = asPlayed ? { ...VEGAS_AS_PLAYED, cell: 2 * 8 + 7, fix: 0, result: play(ex.position, ex.action) } : makeMistake(ex, l.accepts, rng);
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
      const ex = generate(l.moments[rng.integer(0, l.moments.length - 1)], l.accepts, rng);
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
      ringMark(m.cell, m.colour, target ? 28 : scene.cells[m.cell] < 0 ? 17 : 0);
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
  /** A glow behind a star, added as light so a target under it still shows. */
  /** `outline`: draw a ring of that radius instead, round a target (so it stays readable) or an empty cell. */
  function ringMark(cell: number, colour: string, outline = 0): void {
    const [x, y] = position(cell % 8, radius(Math.floor(cell / 8)));
    if (outline) {
      ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 4; ctx.shadowColor = colour; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, outline, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      return;
    }
    const glow = ctx.createRadialGradient(x, y, 8, x, y, 30);
    glow.addColorStop(0, colour); glow.addColorStop(0.55, colour); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  /** The finished board, faint, wherever the board in play doesn't match it yet. */
  function drawGoal(target: Position, cells: number[]): void {
    ctx.save(); ctx.globalAlpha = 0.38;
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
    drawBoard(scene, progress, now, current ? [] : marks);
    if (!current && mode === 'practise' && game && goal && showGoal) drawGoal(goal, scene.cells);
    if (!current) {
      if (arrowRing) drawArrow(arrowRing.ring, arrowRing.clockwise);
      if (playing() && game && !game.finished && mode !== 'scratch') star(game.entry.colour, game.entry.octant, 205);
      if (mode === 'when' && bad && bad.moves[buildAt]?.kind === 'drop') star(bad.boards[buildAt].entry.colour, bad.boards[buildAt].entry.octant, 205);
    }
    // From scratch keeps the next star in view while a move plays out.
    if (mode === 'scratch' && game && !game.finished) star(game.entry.colour, game.entry.octant, 205);
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
    mode = next; store.set('mode', mode);
    scenes = []; marks = []; status = ''; mistake = null; bad = null; game = null; start = null;
    waiting = false; afterScenes = null;
    if (mode === 'learn') showExample(lesson().moments[momentIndex] ?? lesson().moments[0], (lesson().moments[momentIndex] ?? lesson().moments[0]).label);
    else if (mode === 'steps') newSteps(true);
    else if (mode === 'practise') newPractice();
    else if (mode === 'scratch') newScratch();
    else if (mode === 'when') newBadBuild();
    else newMistake();
  }
  function setLesson(index: number): void {
    lessonIndex = index; momentIndex = 0; store.set('lesson', lesson().id);
    renderText();
    setMode(mode);
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
  lessonGroup.note(() => status);

  const rowBreak = () => document.createElement('div');
  const learn = panel.group('Watch', { hidden: () => mode !== 'learn' });
  learn.button('Play move', () => watch(false), { variant: 'primary', disabled: busy })
    .button('Step', () => watch(true), { disabled: busy, title: 'Play the move one link at a time; press Next (or Space) for each link' })
    .button('Next', next, { disabled: () => !waiting });
  learn.append(rowBreak());
  learn.button('Show board', () => showExample(example, exampleLabel), { disabled: busy, title: 'Back to the board before the move' })
    .button('Session board', nextMoment, { disabled: busy, title: 'The next board from your replays' })
    .button('New example', newExample, { disabled: busy, title: 'The same strategy in new colours and target layouts' });
  learn.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); })
    .toggle('Ring the chain stars', () => ringChain, (on) => { ringChain = on; store.set('ringChain', on); if (!busy()) showExample(example, exampleLabel); }, { title: 'Before the move, ring the stars its clears will use' });

  const steps = panel.group('Step by step', { hidden: () => mode !== 'steps' });
  steps.button('◀ Back', () => showStep(stepAt - 1), { disabled: () => busy() || !stepEx || stepAt === 0 })
    .button('Next step ▶', () => showStep(stepAt + 1), { variant: 'primary', disabled: () => busy() || !stepEx || stepAt === 3 })
    .button('Play move', playSteps, { disabled: () => busy() || !stepEx || (stepAt !== 0 && stepAt !== 3) });
  steps.append(rowBreak());
  steps.button('Show board', () => showStep(stepAt), { disabled: () => busy() || !stepEx, title: 'Back to this step’s board' })
    .button('Session board', () => { momentIndex = (momentIndex + 1) % lesson().moments.length; newSteps(true); }, { disabled: () => busy() || !hasSteps(), title: 'The next board from your replays' })
    .button('New example', () => newSteps(), { disabled: () => busy() || !hasSteps(), title: 'The same strategy in new colours and target layouts' });
  steps.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); });

  const scratch = panel.group('Build from scratch', { hidden: () => mode !== 'scratch' });
  scratch.button('New board', newScratch, { variant: 'primary' });
  scratch.append(rowBreak());
  scratch.button('Rotate left', () => practiceMove({ kind: 'rotate', ring: selected, clockwise: false }))
    .button('Rotate right', () => practiceMove({ kind: 'rotate', ring: selected, clockwise: true }))
    .button('Drop star', () => practiceMove({ kind: 'drop' }));
  scratch.append(rowBreak());
  scratch.button('Replay last move slowly', replayLast, { disabled: () => busy() || !lastMove, title: 'Play your last move again, slowed down, to see what it set off' });
  scratch.append(rowBreak());
  scratch.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); });

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
    .button('Your vegas board', () => newMistake(true), { disabled: busy, hidden: () => lesson().id !== 'vegas', title: 'Session 3: the board that charted a donkey' });
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

  panel.group('About this strategy', { collapsed: false }).append(text);

  setMode(mode);

  const key = (name: string, action: string, fallback: string) => keyMatches(name, 'navigation', action, fallback);
  return {
    dispose() { sounds.dispose(); },
    frame(events) {
      for (const event of events) {
        if (event.type === 'keydown') {
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
      advance(ticks());
      if (mode === 'scratch' && settleAt && ticks() >= settleAt && !busy() && !queued.length) judgeScratch();
      draw(ticks());
    },
  };
}) satisfies PuzzleFactory;
