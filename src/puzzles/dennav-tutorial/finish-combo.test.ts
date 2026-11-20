import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { NavigationGame } from '../navigation/game';
import { EMPTY } from '../navigation/logic';
import { INNER, MIDDLE, SETTINGS, TOP, act, gameAt, outcome, positionOf, type Outcome } from './engine';
import { LESSONS } from './lessons';
import { buildOptionsFor, checkBuildPosition } from './build-position';
import { OPENING_STARS, dealFinish, finishGame, judgeFinish, openingBag, type FinishDeal } from './finish-combo';
import { solveFinish } from './finish-solver';

const lesson = LESSONS.find((l) => l.id === 'vertical-triple')!;
const counts = (colours: number[]) => [0, 1, 2, 3, 4].map((c) => colours.filter((x) => x === c).length);
const deals = new Map<number, FinishDeal>();
const deal = (seed: number) => {
  if (!deals.has(seed)) deals.set(seed, dealFinish(new Random(seed), 'standard', seed === 1));
  return deals.get(seed)!;
};

describe('Finish the Combo', () => {
  it('opens with one bag: 2 of each colour, as the game deals them', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const bag = openingBag(seed * 7919, seed % 2 === 0);
      expect(bag).toHaveLength(OPENING_STARS);
      expect(counts(bag)).toEqual([2, 2, 2, 2, 2]);
    }
  });

  it('deals ring 1 full, two stars in ring 2 and rings 3–4 empty, using exactly the bag', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { position, bag } = deal(seed);
      expect(position.cells.slice(0, 2 * 8).every((c) => c === EMPTY)).toBe(true);
      expect(position.cells.slice(INNER * 8).every((c) => c !== EMPTY)).toBe(true);
      expect(position.cells.slice(MIDDLE * 8, MIDDLE * 8 + 8).filter((c) => c !== EMPTY)).toHaveLength(2);
      expect(counts(position.cells.filter((c) => c !== EMPTY))).toEqual(counts(bag));
    }
  });

  it('deals a stable board passing Build Ring 1 with no warnings, preferring the vertical’s ring 2 star in place', () => {
    let lined = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const { position, plan } = deal(seed);
      expect(gameAt(position).unsettled).toBe(false);
      const check = checkBuildPosition(position, buildOptionsFor(position.targets, 'standard'), true, 'standard');
      expect(check).toMatchObject({ kind: 'complete' });
      expect(check).not.toHaveProperty('warnings');
      if (position.cells[plan.site.vertical[1]] === plan.verticalColour) lined++;
      expect(position.targets.some((t) => t.ring === TOP)).toBe(true);
    }
    expect(lined).toBeGreaterThanOrEqual(6);
  });

  it('plays on with the game’s own 11th star onwards', () => {
    const d = deal(3);
    const fresh = new NavigationGame(SETTINGS, d.seed, undefined, d.opening);
    const stars = [fresh.entry, ...Array.from({ length: 12 }, () => fresh.board.nextEntry())];
    const game = finishGame(d);
    expect(game.entry).toEqual(stars[OPENING_STARS]);
    expect(stars.slice(0, OPENING_STARS).map((s) => s.colour)).toEqual(d.bag);
    expect(d.position.entry).toEqual(stars[OPENING_STARS]);
  });

  it('can be finished: a sequence of the following stars sets off the vertical triple', () => {
    for (const seed of [1, 2, 3]) {
      const d = deal(seed);
      const options = buildOptionsFor(d.position.targets, 'standard');
      const path = solveFinish(d, options, 'standard', lesson.accepts);
      expect(path, `seed ${seed}`).not.toBeNull();
      // Replay it in the real game, star by star.
      const game = finishGame(d);
      let last: Outcome | null = null;
      for (const action of path!) last = outcome(act(game, action), positionOf(game));
      expect(lesson.accepts(last!)).toBe(true);
    }
  }, 60000);

  it('fails a wrong colour on a target that won’t turn wild, and an early clear', () => {
    const d = deal(2);
    const options = buildOptionsFor(d.position.targets, 'standard');
    const quiet: Outcome = { links: [], charted: null, nextInnerWild: false, after: d.position };
    expect(judgeFinish(quiet, d.position, false, options, 'standard', lesson.accepts)).toMatchObject({ kind: 'playing' });
    const wild = new Set(d.plan.site.wilded.map((t) => t.ring * 8 + t.octant));
    const fixed = d.position.targets.find((t) => !wild.has(t.ring * 8 + t.octant) && d.position.cells[t.ring * 8 + t.octant] === EMPTY)!;
    if (fixed) {
      const wrong = { ...d.position, cells: [...d.position.cells] };
      const cell = fixed.ring * 8 + fixed.octant;
      wrong.cells[cell] = (fixed.colour + 1) % 5;
      for (let r = fixed.ring + 1; r < INNER; r++) if (wrong.cells[r * 8 + fixed.octant] === EMPTY) wrong.cells[r * 8 + fixed.octant] = (fixed.colour + 2) % 5;
      expect(judgeFinish(quiet, wrong, false, options, 'standard', lesson.accepts)).toMatchObject({ kind: 'failed', issue: { message: 'Wrong colour on a target outside the wild area.' } });
    }
    expect(judgeFinish({ ...quiet, links: [{ kind: 'run', chain: 1, runs: [], wilded: [], afterChart: false, scene: { cells: [], targets: [], duration: 0 } }] }, d.position, false, options, 'standard', lesson.accepts))
      .toMatchObject({ kind: 'failed', issue: { message: 'That cleared before the combo was ready.' } });
    expect(judgeFinish(quiet, d.position, true, options, 'standard', lesson.accepts)).toMatchObject({ kind: 'failed', issue: { message: 'That drop booched the board.' } });
  });
});
