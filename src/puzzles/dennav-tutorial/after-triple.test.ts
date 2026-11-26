import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { EMPTY } from '../navigation/logic';
import { keyMatches } from '../../core/controls';
import { AfterTriplePlay, dealAfterTriple, ring4Needed, ringCount } from './after-triple';
import { EXTRA, INNER, TOP, act, dealtConstellation, gameAt, outcome, positionOf, settled } from './engine';
import { LESSONS } from './lessons';

const verticalTriple = LESSONS.find((l) => l.id === 'vertical-triple')!;

describe('After a triple boards', () => {
  const deals = Array.from({ length: 60 }, (_, i) => dealAfterTriple(new Random(1000 + i)));

  it.each(deals.map((d, i) => [i, d] as const))('seed %i: a settled 3-2-1 board one turn from a vertical triple', (_i, deal) => {
    const { position, action, seed } = deal;
    expect(settled(position)).toBe(true);
    expect(dealtConstellation(position)).toBe(true);
    expect(action.kind).toBe('rotate');
    const game = gameAt(position, seed);
    expect(game.floating).toBe(false);
    const o = outcome(act(game, action), positionOf(game));
    expect(verticalTriple.accepts(o)).toBe(true);
    expect(o.charted).toBe(3);
    // Nothing else goes off: the vertical, the ring 1 clear, then charting.
    expect(o.links.map((l) => l.kind)).toEqual(['run', 'run', 'target']);
    // The next star waits over an open column.
    expect(o.after.cells[EXTRA * 8 + position.entry.octant]).toBe(EMPTY);
  });

  it.each(deals.map((d, i) => [i, d] as const))('seed %i: ring 3 holds 6–8 and ring 4 from x to 8', (_i, deal) => {
    const { position, action, seed, column } = deal;
    const ring3 = ringCount(position.cells, TOP), ring4 = ringCount(position.cells, EXTRA);
    expect(ring3).toBe(deal.ring3);
    expect(ring4).toBe(deal.ring4);
    expect(ring3).toBeGreaterThanOrEqual(6);
    expect(ring3).toBeLessThanOrEqual(8);
    expect(deal.needed).toBeGreaterThanOrEqual(1);
    expect(ring4).toBeGreaterThanOrEqual(deal.needed);
    expect(ring4).toBeLessThanOrEqual(8);
    expect(ring4Needed(position, action, seed, column)?.needed).toBe(deal.needed);
  });

  it('ring 4 counts spread over the whole range', () => {
    const counts = new Set(deals.map((d) => d.ring4));
    expect(counts.has(8)).toBe(true);
    expect(Math.min(...counts)).toBeLessThanOrEqual(3);
    expect(new Set(deals.map((d) => d.ring3)).size).toBe(3);
  });
});

describe('After a triple: play after the break', () => {
  const deal = (seed: number) => dealAfterTriple(new Random(seed));

  it('ignores moves before the break, and takes them once it has gone off', () => {
    const play = new AfterTriplePlay(deal(7));
    expect(play.move({ kind: 'rotate', ring: INNER, clockwise: true })).toEqual([]);
    expect(play.phase).toBe('ready');
    const o = outcome(play.break(), play.deal.position);
    expect(o.charted).toBe(3);
    expect(play.phase).toBe('play');
    // The break plays once only.
    expect(play.break()).toEqual([]);
    // After it: ring turns and drops play out as normal.
    const turn = play.move({ kind: 'rotate', ring: TOP, clockwise: false });
    expect(turn.length).toBeGreaterThan(0);
    expect(turn[0].rotation).toEqual({ ring: TOP, clockwise: false });
    expect(play.move({ kind: 'drop' }).length).toBeGreaterThan(0);
    expect(play.phase).toBe('play');
  });

  it('plays on through many moves, dealing new constellations', () => {
    let charted = 0;
    for (let s = 0; s < 10; s++) {
      const play = new AfterTriplePlay(deal(200 + s));
      play.break();
      const rng = new Random(s);
      let made = 0;
      for (let i = 0; i < 400 && play.phase === 'play'; i++) {
        // Random turns, and a drop whenever the next star has room to come in.
        const open = play.game.board.get(play.game.entry.octant, 0) === EMPTY;
        const action = open && rng.integer(0, 1) ? { kind: 'drop' as const } : { kind: 'rotate' as const, ring: rng.integer(0, 3), clockwise: rng.integer(0, 1) === 1 };
        const before = positionOf(play.game);
        const scenes = play.move(action);
        if (scenes.length) made++;
        charted += outcome(scenes, before).charted ? 1 : 0;
        // A constellation is always up while the board plays on.
        if (play.phase === 'play') expect(play.game.targets.length).toBeGreaterThan(0);
      }
      expect(made).toBeGreaterThan(50);
      if (play.phase === 'booched') {
        // A booched board stays as it is until a new board.
        expect(play.game.booched).toBe(true);
        expect(play.move({ kind: 'rotate', ring: INNER, clockwise: true })).toEqual([]);
        expect(play.move({ kind: 'drop' })).toEqual([]);
      }
    }
    // Play goes on past the triple: later constellations chart too.
    expect(charted).toBeGreaterThan(0);
  });

  it('a booch ends play on the board', () => {
    const play = new AfterTriplePlay(deal(11));
    play.break();
    // Drop until the column under the next star fills and it booches.
    for (let i = 0; i < 200 && play.phase === 'play'; i++) play.move({ kind: 'drop' });
    expect(play.phase).toBe('booched');
    expect(play.move({ kind: 'drop' })).toEqual([]);
  });

  it('R and Ctrl deal a new board mid-play', () => {
    expect(keyMatches('r', 'dennav-tutorial', 'newBoard', 'r', ['control'])).toBe(true);
    expect(keyMatches('control', 'dennav-tutorial', 'newBoard', 'r', ['control'])).toBe(true);
    const rng = new Random(5);
    const first = new AfterTriplePlay(dealAfterTriple(rng));
    first.break();
    first.move({ kind: 'rotate', ring: TOP, clockwise: true });
    const next = new AfterTriplePlay(dealAfterTriple(rng));
    expect(next.phase).toBe('ready');
    expect(next.game.board.cells).toEqual(next.deal.position.cells);
    expect(next.game.board.cells).not.toEqual(first.game.board.cells);
  });
});
