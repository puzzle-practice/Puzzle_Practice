// The Dennav tutorial: lessons on each kind of chain, played on the Dennav board.
// Learn watches a move play out link by link; Practise deals the same strategy a few moves early;
// Spot the wrong star hides one wrong star in a board; Find the wrong move spoils a build-up with one bad turn.
import { Images } from '../../core/assets';
import { Random } from '../../core/random';
import { keyMatches } from '../../core/controls';
import type { PuzzleFactory } from '../../core/puzzle';
import type { NavigationGame, Scene } from '../navigation/game';
import { COLOUR_NAMES, OCTANT_NAMES } from '../navigation/create';
import { EMPTY, type Run } from '../navigation/logic';
import {
  RINGS, act, play, runStars, buildUpAtMost, dropEntries, spoilBuild, chainName, fixes, gameAt, generate, makeMistake, outcome, positionOf, scramble,
  type Action, type BadBuild, type Example, type Link, type Mistake, type Outcome, type Position,
} from './engine';
import { LESSONS, VEGAS_AS_PLAYED, type Lesson } from './lessons';

const imageUrls = import.meta.glob<string>('../navigation/media/*.png', { eager: true, query: '?url', import: 'default' });
const COLOURS = ['blue', 'orange', 'red', 'white', 'yellow'];
const CX = 225, CY = 300;
const radius = (ring: number) => 55 + (RINGS - 1 - ring) * 47;
const position = (octant: number, r: number): [number, number] => [CX + Math.cos(octant * Math.PI / 4) * r, CY - Math.sin(octant * Math.PI / 4) * r];
const ringLabel = (ring: number) => `ring ${RINGS - ring}`;

type Mode = 'learn' | 'practise' | 'spot' | 'when';
const MODES: { value: Mode; label: string }[] = [
  { value: 'learn', label: 'Learn' }, { value: 'practise', label: 'Practise' },
  { value: 'spot', label: 'Spot the wrong star' }, { value: 'when', label: 'Find the wrong move' },
];
/** Practice stages: turns only (0–3 turns before the move), or building up the last few stars (negative: -n moves of build-up). */
const STAGES = [
  ...[0, 1, 2, 3].map((value) => ({ value, label: value ? `${value + 1} moves out (turns only)` : 'One move to go' })),
  ...[3, 5, 8].map((n) => ({ value: -n, label: `Build it: last ${n} stars` })),
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

  const speed = () => (slow ? 2 : 1);
  const busy = () => scenes.length > 0;

  function playScenes(list: Scene[], captions: Map<Scene, string>, done: (() => void) | null = null): void {
    scenes = list.map((scene) => ({ scene, caption: captions.get(scene) }));
    sceneStart = ticks(); waiting = false; afterScenes = done;
    if (scenes[0]?.caption) captionText = scenes[0].caption;
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

  // --- Practise ---
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
      start = dealt.position; solution = dealt.solution;
      resetPractice();
      const drops = solution.filter((a) => a.kind === 'drop').length;
      status = stage < 0
        ? `${l.title}: build it up. ${drops} star${drops === 1 ? '' : 's'} still to come, each falling where the game puts it; turn the rings to take them where they belong, then set it off.`
        : `${l.title}: ${stage ? `${stage + 1} moves` : 'one move'} to set it off. Make the chain happen.`;
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
    captionText = ''; status = '';
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
    if (!game || busy() || mode !== 'practise') return;
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
      playScenes(list.length ? list : [g.scene(400)], captionsFor(o), () => { shown = positionOf(g); if (queue.length) next(); });
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
    playScenes(list.length ? list : [g.scene(250)], captions, () => showBuild(k + 1));
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
  function drawBoard(scene: Scene, progress: number, now: number): void {
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
  function ringMark(cell: number, colour: string): void {
    const [x, y] = position(cell % 8, radius(Math.floor(cell / 8)));
    ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 4; ctx.shadowColor = colour; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(x, y, 25, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
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
    if (mode === 'practise' && game) {
      ctx.save(); ctx.globalAlpha = 0.85;
      ctx.drawImage(images.get('werewolf_rings'), (RINGS - 1 - selected) * 414, 0, 414, 414, CX - 207, CY - 207, 414, 414);
      ctx.restore();
    }
    const current = scenes[0];
    const scene: Scene = current?.scene ?? { cells: shown.cells, targets: shown.targets, duration: 0 };
    const duration = (current?.scene.duration ?? 0) * speed();
    const progress = duration ? Math.min(1, (now - sceneStart) / duration) : 1;
    drawBoard(scene, progress, now);
    if (!current) {
      for (const m of marks) ringMark(m.cell, m.colour);
      if (arrowRing) drawArrow(arrowRing.ring, arrowRing.clockwise);
      if (mode === 'practise' && game && !game.finished) star(game.entry.colour, game.entry.octant, 205);
      if (mode === 'when' && bad && bad.moves[buildAt]?.kind === 'drop') star(bad.boards[buildAt].entry.colour, bad.boards[buildAt].entry.octant, 205);
    }
    drawCaption(captionText);
  }

  /** Plays scenes out: each clear's caption shows while it plays, and stays a moment (or until Next in Step mode). */
  function advance(now: number): void {
    while (scenes.length && !waiting) {
      const current = scenes[0];
      const end = sceneStart + current.scene.duration * speed();
      if (now < end) return;
      if (current.caption && scenes.length > 1) {
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
    else if (mode === 'practise') newPractice();
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

  const practise = panel.group('Practise', { hidden: () => mode !== 'practise' });
  practise.select('Stage', STAGES, () => stage, (value) => { stage = value; store.set('stage', value); newPractice(); }, { disabled: busy, title: 'How many moves before the board sets the strategy off' });
  practise.button('New board', newPractice, { variant: 'primary', disabled: busy })
    .button('Reset', resetPractice, { disabled: () => busy() || !start })
    .button('Show answer', showAnswer, { disabled: () => busy() || !start });
  practise.append(rowBreak());
  practise.button('Rotate left', () => practiceMove({ kind: 'rotate', ring: selected, clockwise: false }), { disabled: busy })
    .button('Rotate right', () => practiceMove({ kind: 'rotate', ring: selected, clockwise: true }), { disabled: busy })
    .button('Drop star', () => practiceMove({ kind: 'drop' }), { disabled: busy });
  practise.toggle('Slow', () => slow, (on) => { slow = on; store.set('slow', on); });

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
    frame(events) {
      for (const event of events) {
        if (event.type === 'keydown') {
          if (key(event.key, 'drop', 'space') && waiting) { next(); continue; }
          if (mode === 'when') {
            if (key(event.key, 'ccw', 'arrowleft')) buildStep(-1);
            else if (key(event.key, 'cw', 'arrowright')) buildStep(1);
            continue;
          }
          if (mode !== 'practise') continue;
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
          else if (mode === 'practise') {
            if (selected !== cell.ring) selected = cell.ring;
            else practiceMove({ kind: 'rotate', ring: selected, clockwise: event.button === 1 });
          }
        }
      }
      advance(ticks());
      draw(ticks());
    },
  };
}) satisfies PuzzleFactory;
