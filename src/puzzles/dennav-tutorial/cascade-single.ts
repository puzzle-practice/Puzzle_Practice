import { Random } from '../../core/random';
import { NavigationGame } from '../navigation/game';
import { EMPTY } from '../navigation/logic';
import { INNER, MIDDLE, SETTINGS, act, gameAt, outcome, positionOf, type Action, type Position } from './engine';
import type { BuildIssue } from './build-position';

export interface CascadeDropIn { target: number; pair: number[]; above: number; colour: number }
export type CascadeSetupCheck = { kind: 'complete'; dropIns: CascadeDropIn[] } | { kind: 'failed'; issue: BuildIssue };

/** A target disappears on charting; its two neighbours in the triple must survive that clear. */
export function cascadeSites(p: Position): CascadeDropIn[] {
  const targets = new Set(p.targets.map((t) => t.ring * 8 + t.octant));
  const sites: CascadeDropIn[] = [];
  for (const t of p.targets.filter((t) => t.ring === INNER)) {
    const target = INNER * 8 + t.octant, above = MIDDLE * 8 + t.octant;
    // A ring 2 target would remove the drop-in star in the same constellation clear.
    if (targets.has(above)) continue;
    for (let offset = 0; offset < 3; offset++) {
      const triple = Array.from({ length: 3 }, (_, i) => INNER * 8 + (t.octant - offset + i + 8) % 8);
      const pair = triple.filter((cell) => cell !== target);
      const colour = p.cells[pair[0]];
      if (colour === EMPTY || pair.some((cell) => targets.has(cell) || p.cells[cell] !== colour)) continue;
      sites.push({ target, pair, above, colour });
    }
  }
  return sites;
}

export const preparedCascadeDropIns = (p: Position): CascadeDropIn[] => cascadeSites(p).filter((site) => p.cells[site.above] === site.colour);
export const hasInnerWilds = (p: Position): boolean => {
  const inner = p.targets.filter((t) => t.ring === INNER);
  return inner.length > 0 && inner.every((t) => t.wild);
};

/** The setup drills stop before the remaining constellation targets need filling. */
export function checkCascadeSetup(p: Position, opening = false): CascadeSetupCheck {
  if (opening) {
    const missing = Array.from({ length: 8 }, (_, o) => INNER * 8 + o).filter((cell) => p.cells[cell] === EMPTY);
    if (missing.length) return { kind: 'failed', issue: { message: 'Fill ring 1.', cells: missing } };
    const wrong = p.targets.filter((t) => t.ring === INNER && !t.wild && p.cells[INNER * 8 + t.octant] !== t.colour);
    if (wrong.length) return { kind: 'failed', issue: { message: 'Match the ring 1 target.', cells: wrong.map((t) => INNER * 8 + t.octant) } };
  }
  const dropIns = preparedCascadeDropIns(p);
  return dropIns.length ? { kind: 'complete', dropIns } : { kind: 'failed', issue: { message: 'Put the pair’s colour in ring 2 above its drop-in target.', cells: cascadeSites(p).map((s) => s.above) } };
}

export interface CascadeDeal { seed: number; position: Position; solution: Action[] }
export const CASCADE_SETUP_STARS = 14;

/** Resume the same entry stream after the stars used by a generated setup. */
export function cascadeSetupGame(deal: CascadeDeal): NavigationGame {
  const game = new NavigationGame(SETTINGS, deal.seed, undefined, false);
  for (let i = 0; i < CASCADE_SETUP_STARS; i++) game.entry = game.board.nextEntry();
  deal.position.cells.forEach((colour, cell) => { game.board.cells[cell] = colour; });
  game.targets = deal.position.targets.map((t) => ({ ...t }));
  return game;
}

/** Charged 3/2/1 boards with a pair to find and a reachable ring 2 drop-in, not already prepared. */
export function dealCascadeSetup(rng: Random): CascadeDeal {
  for (let attempt = 0; attempt < 400; attempt++) {
    const seed = rng.integer(1, 0x7fffffff);
    const game = new NavigationGame(SETTINGS, seed, undefined, false);
    // A pair and its drop-in need three of a colour, so this reaches into the second bag.
    const bag = [game.entry.colour, ...Array.from({ length: CASCADE_SETUP_STARS - 1 }, () => game.board.nextEntry().colour)];
    game.entry = game.board.nextEntry();
    rng.shuffle(bag);
    for (let o = 0; o < 8; o++) game.board.cells[INNER * 8 + o] = bag[o];
    const columns = rng.shuffle(Array.from({ length: 8 }, (_, o) => o));
    for (let i = 8; i < bag.length; i++) game.board.cells[MIDDLE * 8 + columns[i - 8]] = bag[i];
    // Use the game's charge and adjacency rules: a single followed by a ring 1 cascade.
    game.wild.completed([]);
    game.wild.next(game.targets);
    game.wild.runs([{ direction: 0, ring: INNER, octant: rng.integer(0, 7), length: 3 }], game.targets);
    const position = positionOf(game);
    if (game.unsettled || !cascadeSites(position).length || preparedCascadeDropIns(position).length) continue;
    for (const clockwise of [true, false]) {
      const probe = gameAt(position);
      const solution: Action[] = [];
      for (let steps = 1; steps <= 4; steps++) {
        const action: Action = { kind: 'rotate', ring: MIDDLE, clockwise };
        const scenes = act(probe, action);
        const after = positionOf(probe);
        if (outcome(scenes, after).links.length) break;
        solution.push(action);
        if (preparedCascadeDropIns(after).length) return { seed, position, solution };
      }
    }
  }
  throw new Error('No cascade single setup could be dealt');
}
