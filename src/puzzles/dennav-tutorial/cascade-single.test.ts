import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { EMPTY } from '../navigation/logic';
import { NavigationGame } from '../navigation/game';
import { INNER, MIDDLE, TOP, SETTINGS, act, gameAt, outcome, positionOf, type Position } from './engine';
import { LESSONS } from './lessons';
import { CASCADE_SETUP_STARS, cascadeSites, cascadeSetupGame, checkCascadeSetup, dealCascadeSetup, hasInnerWilds, preparedCascadeDropIns } from './cascade-single';

const opening = (): Position => ({
  cells: [...Array(16).fill(EMPTY), 0, ...Array(7).fill(EMPTY), 1, 0, 2, 3, 4, 2, 1, 0],
  targets: [{ ring: INNER, octant: 0, colour: 1, wild: false }, { ring: MIDDLE, octant: 4, colour: 2, wild: false },
    { ring: MIDDLE, octant: 6, colour: 3, wild: false }, { ring: TOP, octant: 7, colour: 4, wild: false }],
  entry: { colour: 2, octant: 3 },
});

describe('cascade single setup lessons', () => {
  it('accepts a full ring 1 and a ring 2 drop-in without completing the constellation', () => {
    const p = opening();
    expect(gameAt(p).unsettled).toBe(false);
    expect(checkCascadeSetup(p, true).kind).toBe('complete');
    expect(preparedCascadeDropIns(p)).toContainEqual({ target: 24, pair: [31, 25], above: 16, colour: 0 });
    expect(gameAt(p).board.matches(p.targets)).toBe(false);
  });

  it('requires ring 1 full and its opening target matched, and the correct star above the pair', () => {
    const p = opening();
    p.cells[26] = EMPTY;
    expect(checkCascadeSetup(p, true)).toMatchObject({ kind: 'failed', issue: { message: 'Fill ring 1.' } });
    p.cells[26] = 2; p.cells[24] = 3;
    expect(checkCascadeSetup(p, true)).toMatchObject({ kind: 'failed', issue: { message: 'Match the ring 1 target.' } });
    p.cells[24] = 1; p.cells[16] = 4;
    expect(checkCascadeSetup(p, true).kind).toBe('failed');
  });

  it('rejects pairs and drop-in stars which the constellation would remove', () => {
    const p = opening();
    p.targets.push({ ring: INNER, octant: 1, colour: 0, wild: true });
    expect(preparedCascadeDropIns(p)).toHaveLength(0);
    p.targets.pop();
    p.targets.push({ ring: MIDDLE, octant: 0, colour: 0, wild: true });
    expect(cascadeSites(p)).toHaveLength(0);
  });

  it('recognises pairs on one side and either side, including across east', () => {
    const p = opening();
    expect(preparedCascadeDropIns(p)[0].pair).toEqual([31, 25]);
    p.cells[25] = 2; p.cells[30] = 0;
    expect(preparedCascadeDropIns(p)).toContainEqual({ target: 24, pair: [30, 31], above: 16, colour: 0 });
  });

  it('deals stable, charged 3/2/1 boards with varied ring 2 wilds and a reachable, unprepared drop-in', () => {
    const rng = new Random(21), ring2WildCounts = new Set<number>();
    const accepts = LESSONS.find((l) => l.id === 'cascade-single')!.accepts;
    for (let i = 0; i < 60; i++) {
      const deal = dealCascadeSetup(rng);
      const game = cascadeSetupGame(deal);
      expect(positionOf(game)).toEqual(deal.position);
      expect(game.unsettled).toBe(false);
      expect([INNER, MIDDLE, TOP].map((r) => game.targets.filter((t) => t.ring === r).length)).toEqual([3, 2, 1]);
      expect(hasInnerWilds(deal.position)).toBe(true);
      expect(cascadeSites(deal.position).length).toBeGreaterThan(0);
      expect(checkCascadeSetup(deal.position).kind).toBe('failed');
      ring2WildCounts.add(game.targets.filter((t) => t.ring === MIDDLE && t.wild).length);
      for (const action of deal.solution) {
        const scenes = act(game, action);
        expect(outcome(scenes, positionOf(game)).links).toHaveLength(0);
      }
      const prepared = positionOf(game);
      expect(checkCascadeSetup(prepared).kind).toBe('complete');
      // Fill the remaining targets: the actual game must chart a single and cascade in ring 1.
      for (const t of game.targets) if (!t.wild || game.board.cells[t.ring * 8 + t.octant] === EMPTY) game.board.cells[t.ring * 8 + t.octant] = t.colour;
      // Upper targets need support; fill gaps with a different colour to avoid a pre-chart run.
      for (const t of game.targets) for (let r = t.ring + 1; r <= INNER; r++) {
        const cell = r * 8 + t.octant;
        if (game.board.cells[cell] === EMPTY) game.board.cells[cell] = (t.colour + 1) % 5;
      }
      const result = outcome(game.settle(), positionOf(game));
      expect(accepts(result)).toBe(true);
    }
    expect(ring2WildCounts.size).toBeGreaterThan(1);
  });

  it('continues the generated board’s own star sequence', () => {
    const deal = dealCascadeSetup(new Random(9));
    const fresh = new NavigationGame(SETTINGS, deal.seed, undefined, false);
    for (let i = 0; i < CASCADE_SETUP_STARS; i++) fresh.entry = fresh.board.nextEntry();
    const resumed = cascadeSetupGame(deal);
    expect(resumed.entry).toEqual(fresh.entry);
    expect(resumed.board.nextEntry()).toEqual(fresh.board.nextEntry());
  });

  it('detects losing an inner wild while allowing ordinary ring 2 targets', () => {
    const p = dealCascadeSetup(new Random(2)).position;
    expect(hasInnerWilds(p)).toBe(true);
    p.targets.find((t) => t.ring === INNER)!.wild = false;
    expect(hasInnerWilds(p)).toBe(false);
    expect(hasInnerWilds({ ...p, targets: [] })).toBe(false);
  });
});
