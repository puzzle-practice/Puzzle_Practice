// A beam search that finishes a Finish the Combo deal with the game's real upcoming stars.
// Used by the tests to prove dealt boards can be finished.
import { NavigationGame } from '../navigation/game';
import { EMPTY } from '../navigation/logic';
import { EXTRA, INNER, MIDDLE, SETTINGS, TOP, act, outcome, positionOf, type Action, type Outcome, type Position } from './engine';
import type { PlanningOption } from './planning';
import type { Strictness } from './build-position';
import { finishGame, judgeFinish, type FinishDeal } from './finish-combo';

interface State { position: Position; next: number; path: Action[]; score: number }

const ACTIONS: Action[] = [{ kind: 'drop' }, ...[EXTRA, TOP, MIDDLE].flatMap((ring) => [true, false].map((clockwise) => ({ kind: 'rotate' as const, ring, clockwise })))];

/** The next `count` stars after the opening bag. */
export function upcomingStars(deal: FinishDeal, count: number): { colour: number; octant: number }[] {
  const game = finishGame(deal);
  return [{ ...game.entry }, ...Array.from({ length: count - 1 }, () => game.board.nextEntry())];
}

function score(p: Position, plan: PlanningOption): number {
  const column = plan.site.vertical[0] % 8, v = plan.verticalColour, h = plan.horizontalColour;
  const at = (ring: number, o: number) => p.cells[ring * 8 + ((o + 8) % 8)];
  let s = 0;
  if (at(MIDDLE, column) === v) s += 6;
  else if (at(MIDDLE, column + 1) === v || at(MIDDLE, column - 1) === v) s += 3;
  if (at(TOP, column + 1) === v || at(TOP, column - 1) === v) s += 5;
  if (at(TOP, column) !== EMPTY && at(TOP, column) !== v) s += 2;
  if (at(EXTRA, column) === h) s += 8;
  const wild = new Set(plan.site.wilded.map((t) => t.ring * 8 + t.octant));
  for (const t of p.targets) {
    const cell = t.ring * 8 + t.octant;
    if (!wild.has(cell) && p.cells[cell] === t.colour) s += 3;
  }
  // Stars waiting above the horizontal's pair, to refill the wild targets after it clears.
  for (const cell of plan.site.horizontal) if (cell !== plan.site.vertical[0] && at(MIDDLE, cell % 8) !== EMPTY) s += 1;
  // Fewer stars is better: every drop uses up room.
  s -= 0.2 * p.cells.filter((c, i) => c !== EMPTY && i < INNER * 8).length;
  return s;
}

/** Actions that set off the vertical triple from the deal, or null if none was found. */
export function solveFinish(deal: FinishDeal, options: PlanningOption[], level: Strictness, accepts: (o: Outcome) => boolean, width = 400, depth = 60): Action[] | null {
  const stars = upcomingStars(deal, depth + 1);
  let beam: State[] = [{ position: deal.position, next: 0, path: [], score: 0 }];
  const seen = new Set<string>();
  for (let step = 0; step < depth && beam.length; step++) {
    const children: State[] = [];
    for (const state of beam) for (const action of ACTIONS) {
      const game = new NavigationGame(SETTINGS, 1);
      state.position.cells.forEach((c, i) => { game.board.cells[i] = c; });
      game.targets = state.position.targets.map((t) => ({ ...t }));
      game.entry = { ...stars[state.next] };
      const scenes = act(game, action);
      if (!scenes.length && !game.booched) continue;
      const after = positionOf(game);
      const judged = judgeFinish(outcome(scenes, after), after, game.booched, options, level, accepts);
      const path = [...state.path, action];
      if (judged.kind === 'success') return path;
      if (judged.kind === 'failed') continue;
      const next = state.next + (action.kind === 'drop' ? 1 : 0);
      const key = `${after.cells.join()}|${next}`;
      if (seen.has(key)) continue;
      seen.add(key);
      children.push({ position: after, next, path, score: score(after, deal.plan) - 0.05 * path.length });
    }
    children.sort((a, b) => b.score - a.score);
    beam = children.slice(0, width);
  }
  return null;
}
