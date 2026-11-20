// Step 4, Finish the Combo: the first bag (10 stars, 2 of each colour) is already placed: ring 1
// full with an accepted plan, two stars in ring 2, rings 3 and 4 empty. The player plays on with
// the same game's next stars and finishes the vertical triple.
import { Random } from '../../core/random';
import { NavigationGame } from '../navigation/game';
import { EMPTY, type Target } from '../navigation/logic';
import { EXTRA, INNER, MIDDLE, SETTINGS, TOP, clonePosition, type Outcome, type Position } from './engine';
import { paintPlan, type PlanningOption } from './planning';
import { buildOptionsFor, checkBuildPosition, type BuildIssue, type Strictness } from './build-position';

/** Stars in the opening: one full bag. */
export const OPENING_STARS = 10;

export interface FinishDeal {
  seed: number;
  opening: boolean;
  /** The opening bag in the order the game dealt it. */
  bag: number[];
  /** The opening position; its entry is the game's 11th star. */
  position: Position;
  plan: PlanningOption;
}

/** A game on `seed` with its first bag already dealt: the next star is the 11th. */
export function finishGame(deal: Pick<FinishDeal, 'seed' | 'opening' | 'position'>): NavigationGame {
  const game = new NavigationGame(SETTINGS, deal.seed, undefined, deal.opening);
  for (let i = 1; i < OPENING_STARS; i++) game.board.nextEntry();
  game.entry = game.board.nextEntry();
  deal.position.cells.forEach((colour, cell) => { game.board.cells[cell] = colour; });
  game.targets = deal.position.targets.map((t) => ({ ...t }));
  return game;
}

/** The first bag of a game on `seed`, in dealing order. */
export function openingBag(seed: number, opening: boolean): number[] {
  const game = new NavigationGame(SETTINGS, seed, undefined, opening);
  return [game.entry.colour, ...Array.from({ length: OPENING_STARS - 1 }, () => game.board.nextEntry().colour)];
}

const key = (t: Target) => t.ring * 8 + t.octant;

/** Targets that won't turn wild in this plan and already hold their colour. */
export function progress(p: Position, plan: PlanningOption): number {
  const wild = new Set(plan.site.wilded.map(key));
  return p.targets.filter((t) => !t.wild && !wild.has(key(t)) && p.cells[key(t)] === t.colour).length;
}

const stable = (p: Position) => {
  const game = new NavigationGame(SETTINGS, 1);
  p.cells.forEach((c, i) => { game.board.cells[i] = c; });
  game.targets = p.targets.map((t) => ({ ...t }));
  return !game.unsettled;
};

/** One random layout of the bag around `plan`, biased towards filling targets; null if the bag can't hold the plan. */
function layout(targets: Target[], bag: number[], plan: PlanningOption, rng: Random): number[] | null {
  const pool = [...bag];
  const take = (colour: number) => { const i = pool.indexOf(colour); if (i < 0) return false; pool.splice(i, 1); return true; };
  const cells = paintPlan(plan.site, plan.verticalColour, plan.horizontalColour);
  for (const cell of plan.site.horizontal) if (!take(cells[cell])) return null;
  const wild = new Set(plan.site.wilded.map(key));
  const wantAt = (cell: number) => targets.find((t) => !t.wild && !wild.has(key(t)) && key(t) === cell)?.colour;
  const pick = (cell: number) => {
    const want = wantAt(cell);
    if (want !== undefined && rng.integer(0, 9) < 9 && take(want)) return want;
    const colour = pool[rng.integer(0, pool.length - 1)];
    take(colour);
    return colour;
  };
  // Ring 2: the vertical's next star if there's one left, and one more star.
  const column = plan.site.vertical[1];
  const ring2: number[] = [];
  if (rng.integer(0, 9) < 9 && take(plan.verticalColour)) { cells[column] = plan.verticalColour; ring2.push(column); }
  const free = Array.from({ length: 8 }, (_, o) => MIDDLE * 8 + o).filter((cell) => !ring2.includes(cell));
  while (ring2.length < 2) {
    const open = free.filter((cell) => !ring2.includes(cell));
    const aimed = open.filter((cell) => { const want = wantAt(cell); return want !== undefined && pool.includes(want); });
    const from = aimed.length && rng.integer(0, 3) ? aimed : open;
    ring2.push(from[rng.integer(0, from.length - 1)]);
  }
  const rest = [...Array.from({ length: 8 }, (_, o) => INNER * 8 + o).filter((cell) => cells[cell] === EMPTY), ...ring2.filter((cell) => cells[cell] === EMPTY)];
  // Shuffled, then targets first so their colours aren't used up elsewhere.
  for (let i = rest.length - 1; i > 0; i--) { const j = rng.integer(0, i); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  rest.sort((a, b) => Number(wantAt(b) !== undefined) - Number(wantAt(a) !== undefined));
  for (const cell of rest) cells[cell] = pick(cell);
  return pool.length ? null : cells;
}

/**
 * Deal a Finish the Combo board: the game's own constellation and first bag, laid out with
 * ring 1 full (an accepted plan passing Build Ring 1 at `level`, with no warnings), two stars
 * in ring 2 and rings 3–4 empty; stable, with no unnecessary stacked pairs. Of many tries,
 * keeps the one with the vertical's ring 2 star in place and the most targets filled. A seed
 * that can't do that is skipped for the next one.
 */
export function dealFinish(rng: Random, level: Strictness, opening: boolean, tries = 400): FinishDeal {
  for (let attempt = 0; attempt < 200; attempt++) {
    const seed = rng.integer(1, 0x7fffffff);
    const game = new NavigationGame(SETTINGS, seed, undefined, opening);
    const targets = game.targets;
    const bag = openingBag(seed, opening);
    const options = buildOptionsFor(targets, level);
    let best: { cells: number[]; plan: PlanningOption; score: number } | null = null;
    for (let i = 0; i < tries && options.length; i++) {
      const plan = options[rng.integer(0, options.length - 1)];
      const cells = layout(targets, bag, plan, rng);
      if (!cells) continue;
      const p: Position = { cells, targets: targets.map((t) => ({ ...t })), entry: { colour: 0, octant: 0 } };
      if (!stable(p)) continue;
      const check = checkBuildPosition(p, options, true, level);
      if (check.kind !== 'complete' || check.warnings?.length) continue;
      const score = 10 * Number(cells[check.plan.site.vertical[1]] === check.plan.verticalColour) + progress(p, check.plan);
      if (!best || score > best.score) best = { cells, plan: check.plan, score };
    }
    if (!best) continue;
    const position: Position = { cells: best.cells, targets: targets.map((t) => ({ ...t })), entry: { colour: 0, octant: 0 } };
    position.entry = { ...finishGame({ seed, opening, position }).entry };
    return { seed, opening, bag, position, plan: best.plan };
  }
  throw new Error('No Finish the Combo board could be dealt');
}

export type FinishCheck =
  | { kind: 'playing'; warnings: BuildIssue[] }
  | { kind: 'success' }
  | { kind: 'failed'; issue: BuildIssue };

/** Ring 1 turned `turns` steps (as ring 2 is turned in build-position). */
function turnRing1(p: Position, turns: number): Position {
  const turned = clonePosition(p);
  for (let o = 0; o < 8; o++) turned.cells[INNER * 8 + ((o + turns) % 8 + 8) % 8] = p.cells[INNER * 8 + o];
  return turned;
}

/**
 * Judge a move. Success: it set off the vertical triple (`accepts`). Failure: any other clear
 * or charting, a booch, or the board now failing Build Ring 1's checks at `level` (ring 1 may
 * still be a turn away from its plan, since the last move can be a ring 1 turn).
 */
export function judgeFinish(o: Outcome, after: Position, booched: boolean, options: PlanningOption[], level: Strictness, accepts: (o: Outcome) => boolean): FinishCheck {
  if (o.links.length && accepts(o)) return { kind: 'success' };
  if (booched) return { kind: 'failed', issue: { message: 'That drop booched the board.', cells: [] } };
  if (o.charted !== null) return { kind: 'failed', issue: { message: 'The constellation charted, but not as a vertical triple.', cells: [] } };
  if (o.links.length) {
    const cells = o.links[0].runs.flatMap((r) => Array.from({ length: r.length }, (_, k) => r.direction === 0 ? r.ring * 8 + (r.octant + k) % 8 : (r.ring - k) * 8 + r.octant));
    return { kind: 'failed', issue: { message: 'That cleared before the combo was ready.', cells } };
  }
  for (const turns of [0, 1, -1]) {
    const check = checkBuildPosition(turns ? turnRing1(after, turns) : after, options, true, level);
    if (check.kind === 'building') continue;
    if (check.kind === 'failed') return turns ? { kind: 'failed', issue: { message: check.issue.message, cells: [] } } : check;
    return { kind: 'playing', warnings: turns ? [] : check.warnings ?? [] };
  }
  return { kind: 'failed', issue: { message: 'Ring 1 no longer holds an accepted plan.', cells: Array.from({ length: 8 }, (_, o) => INNER * 8 + o) } };
}

/** The faint finished-board hint: the vertical through rings 1–3, the ring 4 star of the pair's
 * colour above it, and the targets that won't turn wild filled. (The last move is the turn or
 * drop that completes the vertical, so this board itself is never on screen.) */
export function finishHint(p: Position, plan: PlanningOption): Position {
  const hint = clonePosition(p);
  const [, ring2, ring3] = plan.site.vertical;
  hint.cells[ring2] = hint.cells[ring3] = plan.verticalColour;
  hint.cells[EXTRA * 8 + (plan.site.vertical[0] % 8)] = plan.horizontalColour;
  const wild = new Set(plan.site.wilded.map(key));
  for (const t of p.targets) if (!t.wild && !wild.has(key(t)) && (t.ring === TOP || t.ring === MIDDLE)) hint.cells[key(t)] = t.colour;
  return hint;
}

