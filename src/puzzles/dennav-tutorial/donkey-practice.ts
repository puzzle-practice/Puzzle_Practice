// Donkey from a blank board: the player builds on a fresh Dennav board until a move sets off a
// clear. That move is the break. It is judged against the donkey (the constellation charting at
// link 5 or later), with what went wrong, the stars to blame, and a fix when one small change works.
import { COLOUR_NAMES, OCTANT_NAMES } from '../navigation/create';
import { NavigationGame, type Scene } from '../navigation/game';
import { EMPTY, type Target } from '../navigation/logic';
import { INNER, RINGS, act, chainName, clonePosition, gameAt, innerCounts, linkStars, outcome, play, positionOf, settled, SETTINGS, type Action, type Outcome, type Position } from './engine';

/**
 * A fresh board for Donkey from scratch. A donkey is built mid-game, so it skips the opening 1/2/1
 * constellation: every constellation, the first included, is 3/2/1.
 */
export const donkeyGame = (seed: number): NavigationGame => new NavigationGame(SETTINGS, seed, undefined, false);

/** The link a donkey charts at; a vegas is one more. */
export const DONKEY_CHAIN = 5;

export interface DonkeyFix {
  kind: 'trigger' | 'recolour' | 'swap' | 'add' | 'remove';
  /** Cells of the board before the break that the fix changes (none for a different trigger). */
  cells: number[];
  position: Position;
  action: Action;
  result: Outcome;
  text: string;
}

export interface DonkeyAnalysis {
  chain: number | null;
  success: boolean;
  /** One line on what the break did. */
  headline: string;
  /** What went wrong, or what went right. */
  problem: string;
  /** Stars on the board before the break to ring (they move with the replay). */
  stars: number[];
  /** Targets to ring: they stay put. */
  targets: number[];
  /** Cells of the board after the break to ring at the end, such as where the ring 1 chain stopped. */
  end: number[];
  fix: DonkeyFix | null;
}

const ringLabel = (ring: number) => `ring ${RINGS - ring}`;
const colourName = (c: number) => COLOUR_NAMES[c].toLowerCase();
export const cellName = (cell: number) => `${ringLabel(Math.floor(cell / 8))} ${OCTANT_NAMES[cell % 8].toLowerCase()}`;
const targetName = (t: Target) => `${t.wild ? 'wild' : colourName(t.colour)} target in ${cellName(t.ring * 8 + t.octant)}`;
const key = (t: Target) => t.ring * 8 + t.octant;
const matched = (cells: number[], t: Target) => cells[key(t)] !== EMPTY && (t.wild || cells[key(t)] === t.colour);
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
const chainWord = (chain: number) => { const name = chainName(chain).toLowerCase(); return `${article(name)} ${name}`; };
export function moveText(action: Action, entry?: { colour: number; octant: number }): string {
  if (action.kind === 'drop') return entry ? `drop ${colourName(entry.colour)} at ${OCTANT_NAMES[entry.octant].toLowerCase()}` : 'drop the star';
  return `turn ${ringLabel(action.ring)} ${action.clockwise ? 'clockwise' : 'anticlockwise'}`;
}

/** The scenes of a move, played on a copy of the position. */
export function breakScenes(p: Position, action: Action): { scenes: Scene[]; result: Outcome } {
  const game = gameAt(p);
  const scenes = act(game, action);
  return { scenes, result: outcome(scenes, positionOf(game)) };
}

/**
 * Whether the move set off a chain of two or more links (a double or longer): the first such move
 * of a practice board ends it. A single clear on its own, or a constellation charted as a single,
 * happens now and then while building and play goes on.
 */
export const setsOff = (o: Outcome): boolean => o.links.some((l) => l.chain >= 2);

const ACTIONS: Action[] = [{ kind: 'drop' }, ...[0, 1, 2, 3].flatMap((ring) => [true, false].map((clockwise): Action => ({ kind: 'rotate', ring, clockwise })))];
const chainOf = (o: Outcome) => o.charted ?? 0;

/** Whether a changed board could really be waiting for the move: nothing floating, no runs, not charted. */
function waiting(p: Position): boolean { return settled(p); }

/**
 * The smallest change that turns the break into a donkey (or `goal`): a different move on the same
 * board, then one star a different colour, two stars swapped, a star added on top of a column, or
 * one taken off. Within a kind, the longest chain wins.
 */
export function findFix(before: Position, action: Action, goal = DONKEY_CHAIN): DonkeyFix | null {
  const best = (candidates: DonkeyFix[]) => candidates.sort((a, b) => chainOf(b.result) - chainOf(a.result))[0] ?? null;
  const triggers: DonkeyFix[] = [];
  for (const other of ACTIONS) {
    if (JSON.stringify(other) === JSON.stringify(action)) continue;
    if (other.kind === 'drop' && before.cells[before.entry.octant] !== EMPTY) continue;
    const result = play(before, other);
    if (chainOf(result) >= goal) triggers.push({ kind: 'trigger', cells: [], position: before, action: other, result, text: `This board already had it: ${moveText(other, before.entry)} instead would have charted ${chainWord(result.charted!)}.` });
  }
  const trigger = best(triggers);
  if (trigger) return trigger;

  const tryBoard = (cells: number[], changed: number[], text: (r: Outcome) => string, kind: DonkeyFix['kind'], into: DonkeyFix[]) => {
    const position = { ...clonePosition(before), cells };
    // The bag deals two of each colour, so a fix may not leave three of one colour in ring 1.
    if ([...innerCounts(cells).values()].some((n) => n > 2)) return;
    if (!waiting(position)) return;
    if (action.kind === 'drop' && cells[position.entry.octant] !== EMPTY) return;
    const result = play(position, action);
    if (chainOf(result) >= goal) into.push({ kind, cells: changed, position, action, result, text: text(result) });
  };
  const occupied = before.cells.map((c, i) => (c === EMPTY ? -1 : i)).filter((i) => i >= 0);

  const recolours: DonkeyFix[] = [];
  for (const cell of occupied) for (let colour = 0; colour < COLOUR_NAMES.length; colour++) {
    if (colour === before.cells[cell]) continue;
    const cells = [...before.cells]; cells[cell] = colour;
    tryBoard(cells, [cell], (r) => `The ${colourName(before.cells[cell])} star in ${cellName(cell)} should have been ${colourName(colour)}: then it charts ${chainWord(r.charted!)}.`, 'recolour', recolours);
  }
  const recolour = best(recolours);
  if (recolour) return recolour;

  const swaps: DonkeyFix[] = [];
  for (let i = 0; i < occupied.length; i++) for (let j = i + 1; j < occupied.length; j++) {
    const a = occupied[i], b = occupied[j];
    if (before.cells[a] === before.cells[b]) continue;
    const cells = [...before.cells]; [cells[a], cells[b]] = [cells[b], cells[a]];
    tryBoard(cells, [a, b], (r) => `The ${colourName(before.cells[a])} star in ${cellName(a)} and the ${colourName(before.cells[b])} one in ${cellName(b)} are the wrong way round: swapped, it charts ${chainWord(r.charted!)}.`, 'swap', swaps);
  }
  const swap = best(swaps);
  if (swap) return swap;

  // Stars fall inwards, so a column fills from ring 1 out: add on top, or take the top one off.
  const adds: DonkeyFix[] = [], removes: DonkeyFix[] = [];
  for (let octant = 0; octant < 8; octant++) {
    let top = -1;
    for (let ring = RINGS - 1; ring >= 0; ring--) if (before.cells[ring * 8 + octant] !== EMPTY) top = ring;
    const free = top === -1 ? (RINGS - 1) * 8 + octant : top > 0 ? (top - 1) * 8 + octant : -1;
    if (free >= 0) for (let colour = 0; colour < COLOUR_NAMES.length; colour++) {
      const cells = [...before.cells]; cells[free] = colour;
      tryBoard(cells, [free], (r) => `One more star was needed: ${article(colourName(colour))} ${colourName(colour)} in ${cellName(free)} makes it chart ${chainWord(r.charted!)}.`, 'add', adds);
    }
    if (top >= 0) {
      const cell = top * 8 + octant;
      const cells = [...before.cells]; cells[cell] = EMPTY;
      tryBoard(cells, [cell], (r) => `The ${colourName(before.cells[cell])} star in ${cellName(cell)} shouldn't be there: without it, it charts ${chainWord(r.charted!)}.`, 'remove', removes);
    }
  }
  return best(adds) ?? best(removes);
}

/** The targets of the first constellation matched in each scene of the move, up to charting. */
function matchedBeforeChart(scenes: Scene[]): { scene: Scene; matched: Target[] }[] {
  const out: { scene: Scene; matched: Target[] }[] = [];
  for (const scene of scenes) {
    out.push({ scene, matched: scene.targets.filter((t) => matched(scene.cells, t)) });
    if (scene.clear?.kind === 'target') break;
  }
  return out;
}

/** Judges a break against the donkey: what it charted, why it fell short, and a fix if a small change works. */
export function analyseBreak(before: Position, action: Action, goal = DONKEY_CHAIN): DonkeyAnalysis {
  const { scenes, result } = breakScenes(before, action);
  const chain = result.charted;
  const runsBefore = result.links.filter((l) => l.kind === 'run' && !l.afterChart);
  const inner = runsBefore.filter((l) => l.runs.some((r) => r.direction === 0 && r.ring === INNER)).length;
  const goalWord = goal > DONKEY_CHAIN ? 'vegas' : 'donkey';
  const headline = chain
    ? `${moveText(action, before.entry)[0].toUpperCase()}${moveText(action, before.entry).slice(1)} set it off: ${runsBefore.length} clear${runsBefore.length === 1 ? '' : 's'}, then charted ${chainWord(chain)}.`
    : `${moveText(action, before.entry)[0].toUpperCase()}${moveText(action, before.entry).slice(1)} set off ${runsBefore.length} clear${runsBefore.length === 1 ? '' : 's'}, but the constellation didn't chart.`;
  const analysis: DonkeyAnalysis = { chain, success: (chain ?? 0) >= goal, headline, problem: '', stars: [], targets: [], end: [], fix: null };
  if (analysis.success) {
    analysis.problem = `${goalWord === 'vegas' ? 'Vegas' : 'Donkey'}! The ring 1 chain ran ${inner} clear${inner === 1 ? '' : 's'} round before charting.${result.nextInnerWild ? ' The next constellation starts with ring 1 wild, too.' : ''}`;
    return analysis;
  }

  const firstTargets = scenes[0]?.targets ?? before.targets;
  if (chain) {
    // Charted too soon. A target already holding its own colour when the chain starts never has to
    // wait to go wild; otherwise name the last target to come good, which completed it.
    const steps = matchedBeforeChart(scenes);
    const firstRun = steps.findIndex((s) => s.scene.clear?.kind === 'run');
    const since = (t: Target) => {
      let from = steps.length - 1;
      while (from > 0 && steps[from - 1].matched.some((m) => key(m) === key(t))) from--;
      return from;
    };
    const linkAt = (index: number) => steps.slice(0, index).filter((s) => s.scene.clear?.kind === 'run').length;
    const atChart = steps.at(-1)!.matched;
    const early = atChart.filter((t) => !t.wild && firstRun >= 0 && since(t) <= firstRun);
    const last = [...atChart].sort((x, y) => since(y) - since(x))[0];
    if (early.length) {
      analysis.targets = early.map(key);
      analysis.problem = `It charted at link ${chain}, too early for ${article(goalWord)} ${goalWord}. ${early.length === 1 ? `The ${targetName(early[0])} already held` : `${early.length} targets (${early.map(targetName).join(', ')}) already held`} the right colour when the chain began, so ${early.length === 1 ? 'it' : 'they'} never had to wait to go wild. Put another colour there and the constellation waits for the ring 1 chain.`;
    } else if (last) {
      analysis.targets = [key(last)];
      analysis.problem = `It charted at link ${chain}, too early for ${article(goalWord)} ${goalWord}: the last target to come good was the ${targetName({ ...last, wild: false })}, at link ${linkAt(since(last))}. Keep it wrong until the ring 1 chain has gone round, so it only goes wild at link ${goal - 1} or later.`;
    } else analysis.problem = `It charted at link ${chain}, too early for ${article(goalWord)} ${goalWord}.`;
  } else {
    const after = result.after;
    const open = firstTargets.filter((t) => !matched(after.cells, after.targets.find((a) => key(a) === key(t)) ?? t));
    const firstRun = runsBefore[0];
    if (firstRun && !inner && runsBefore.length === 1) {
      // A clear went off before the donkey was ready: ring the stars that lined up.
      analysis.stars = linkStars(before, action)[0]?.cells ?? [];
      const what = firstRun.runs.map((r) => r.direction === 0 ? `three in a row in ${ringLabel(r.ring)}` : `a column of ${r.length} through rings ${RINGS - r.ring}–${RINGS - (r.ring - r.length + 1)}`).join(' and ');
      analysis.problem = `That set off an early clear, ${what}, before ring 1 was ready to chain. Watch for stars of one colour lining up as you build.`;
    } else if (inner < 3) {
      // The ring 1 chain broke: show what dropped into the last gaps instead of making three.
      const lastRun = runsBefore.at(-1);
      const gaps = lastRun?.scene.clear?.cells.filter((c) => c.ring === INNER).map((c) => c.ring * 8 + c.octant) ?? [];
      analysis.end = gaps.filter((cell) => after.cells[cell] !== EMPTY);
      const dropped = analysis.end.map((cell) => `${colourName(after.cells[cell])} in ${OCTANT_NAMES[cell % 8].toLowerCase()}`).join(', ');
      analysis.problem = runsBefore.length
        ? `The ring 1 chain stopped after link ${runsBefore.length}${inner ? ` (${inner} ring 1 clear${inner === 1 ? '' : 's'})` : ', before ring 1 cleared at all'}. ${dropped ? `What dropped into the gap (${dropped}) didn't make three with the stars beside it.` : 'Nothing dropped into the gap to carry it on.'} A donkey needs each ring 1 clear to drop in the next pair's third star.`
        : 'Nothing cleared.';
    } else analysis.problem = `The chain went ${runsBefore.length} links, but it didn't chart.`;
    if (open.length && !(firstRun && !inner && runsBefore.length === 1)) {
      analysis.targets = open.map(key);
      analysis.problem += ` ${open.length === 1 ? `The ${targetName(open[0])} was` : `${open.length} targets were`} never filled or turned wild${open.length > 1 ? `: ${open.map(targetName).join(', ')}` : ''}.`;
    }
  }

  analysis.fix = findFix(before, action, goal);
  if (analysis.fix?.cells.length) analysis.stars = analysis.fix.cells;
  return analysis;
}

/**
 * Where each of `cells` (stars of the board before the move) sits in every scene of the move: they
 * turn with their ring, fall inwards, and are gone once cleared.
 */
export function trackStars(scenes: Scene[], cells: number[]): Map<Scene, number[]> {
  const at = new Map<number, number>(cells.map((c) => [c, c]));
  const out = new Map<Scene, number[]>();
  for (const scene of scenes) {
    out.set(scene, [...at.values()].filter((c) => c >= 0));
    for (const [id, cell] of at) {
      if (cell < 0) continue;
      let next = cell;
      if (scene.rotation && Math.floor(cell / 8) === scene.rotation.ring) {
        const ring = scene.rotation.ring, octant = cell % 8;
        next = ring * 8 + (octant + (scene.rotation.clockwise ? 7 : 1)) % 8;
      }
      const fall = scene.falls?.find((f) => f.from * 8 + f.octant === cell);
      if (fall) next = fall.ring * 8 + fall.octant;
      if (scene.clear?.cells.some((c) => c.ring * 8 + c.octant === cell)) next = -1;
      at.set(id, next);
    }
  }
  return out;
}
