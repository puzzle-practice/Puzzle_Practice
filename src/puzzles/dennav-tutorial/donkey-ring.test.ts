import { describe, expect, it } from 'vitest';
import { EMPTY } from '../navigation/logic';
import { judgeDonkeyRing, starsDown } from './donkey-ring';
import { INNER, MIDDLE, act, gameAt, positionOf, readPosition } from './engine';
import { LESSONS } from './lessons';
import { FAIL_PENALTY_S, SESSION_IDLE_MS, endSession, loadModeStats, noteAttempt, noteMove, statsOf, type ModeStats } from './practice-stats';

/**
 * A board with ring 2 (cells 16–23) and ring 1 (cells 24–31) as given, octant 0 first, '.' empty;
 * colours 0 blue, 1 orange, 2 red, 3 white, 4 yellow.
 */
const board = (ring2: string, ring1: string) => [...Array<number>(16).fill(EMPTY), ...[...ring2 + ring1].map((c) => (c === '.' ? EMPTY : Number(c)))];

describe('donkey Build Ring 1 judge', () => {
  it('passes ring 1 as A A B B C C D E with ring 2 holding D . E the same way round, however ring 2 is turned', () => {
    expect(judgeDonkeyRing(board('3.4.....', '00112234')).kind).toBe('pass');
    expect(judgeDonkeyRing(board('....3.4.', '00112234')).kind).toBe('pass');
    expect(judgeDonkeyRing(board('4.....3.', '00112234')).kind).toBe('pass'); // wraps round from octant 6 to 0
    expect(judgeDonkeyRing(board('...4.3..', '22110043')).kind).toBe('pass'); // D and E running the other way round
  });

  it('passes the ring 2 pair side by side or two apart too, in the same order', () => {
    expect(judgeDonkeyRing(board('34......', '00112234')).kind).toBe('pass');
    expect(judgeDonkeyRing(board('3..4....', '00112234')).kind).toBe('pass');
    expect(judgeDonkeyRing(board('.4..3...', '22110043')).kind).toBe('pass');
    expect(judgeDonkeyRing(board('......43', '22110043')).kind).toBe('pass');
    // Jared's board: ring 1 white, orange, orange, red, red, blue, blue, yellow (yellow then white going round),
    // ring 2 yellow at north and white at north-west.
    expect(judgeDonkeyRing(readPosition('N4:..................43....31122004:344,333,363,222,230,172:00').cells).kind).toBe('pass');
  });

  it('passes the ring 1 and ring 2 stars of the Donkey example', () => {
    const example = LESSONS.find((l) => l.id === 'donkey')!.moments[0].position;
    // Ring 1 is 1 0 2 3 3 4 4 1 (D = blue at octant 1, E = red at 2); ring 2's blue and red are at
    // octants 2 and 4. The rest of the example's stars come from later bags, so leave them out.
    const cells = example.cells.map((c, i) => (Math.floor(i / 8) === INNER || i === 16 + 2 || i === 16 + 4 ? c : EMPTY));
    expect([cells[16 + 2], cells[16 + 4]]).toEqual([0, 2]);
    expect(judgeDonkeyRing(cells).kind).toBe('pass');
  });

  it('is judged only once all ten stars are down, unless submitted', () => {
    expect(judgeDonkeyRing(board('........', '00112234')).kind).toBe('building');
    expect(judgeDonkeyRing(board('3.......', '00112234')).kind).toBe('building');
    expect(judgeDonkeyRing(board('3.......', '00112234'), true)).toMatchObject({ kind: 'fail', message: '9 of the 10 stars placed.' });
  });

  it('waits with ten down and a gap in ring 1, so a turn can drop a ring 2 star into it', () => {
    // Ten stars down, ring 1 empty at east, ring 2 holding red (north), blue (north-west) and yellow (south-west).
    const before = readPosition('N4:..................20.4...2330411:322,333,340,230,224,124:33');
    expect(starsDown(before.cells)).toBe(10);
    expect(judgeDonkeyRing(before.cells).kind).toBe('building');
    // Submitting (or dropping an eleventh star) judges it as it stands.
    expect(judgeDonkeyRing(before.cells, true)).toMatchObject({ kind: 'fail', message: 'Ring 1 isn’t full.', cells: [24] });
    const game = gameAt(before);
    act(game, { kind: 'rotate', ring: MIDDLE, clockwise: true });
    expect(judgeDonkeyRing(positionOf(game).cells).kind).toBe('building');
    // The second turn takes the red over the gap: it falls in, ring 1 is full, and it's judged.
    act(game, { kind: 'rotate', ring: MIDDLE, clockwise: true });
    const after = positionOf(game).cells;
    expect(after.slice(24).join()).toBe('2,2,3,3,0,4,1,1');
    expect(judgeDonkeyRing(after).kind).toBe('pass');
  });

  it('fails a second star of a colour that lands away from the first at once', () => {
    expect(judgeDonkeyRing(board('........', '0.0.....'))).toEqual({ kind: 'fail', message: 'The blues aren’t side by side.', cells: [24, 26] });
    expect(judgeDonkeyRing(board('........', '0......0')).kind).toBe('building'); // side by side across east
    expect(judgeDonkeyRing(board('........', '00.1....')).kind).toBe('building');
  });

  it('fails a third star of a colour at once', () => {
    expect(judgeDonkeyRing(board('........', '111.....'))).toEqual({ kind: 'fail', message: 'Three oranges in ring 1.', cells: [24, 25, 26] });
  });

  it('fails ring 1 with a split pair, four pairs, leftovers apart, or a gap', () => {
    expect(judgeDonkeyRing(board('3.4.....', '01012234'))).toMatchObject({ kind: 'fail', message: 'The blues aren’t side by side.', cells: [24, 26] });
    expect(judgeDonkeyRing(board('4.4.....', '00112233'))).toMatchObject({ kind: 'fail', message: 'Four pairs: leave two colours as singles.' });
    expect(judgeDonkeyRing(board('3.4.....', '30011422'))).toMatchObject({ kind: 'fail', message: 'The leftover white and yellow aren’t next to each other.', cells: [24, 29] });
    expect(judgeDonkeyRing(board('3.4.2...', '0011223.')).kind).toBe('building');
    expect(judgeDonkeyRing(board('3.4.2...', '0011223.'), true)).toMatchObject({ kind: 'fail', message: 'Ring 1 isn’t full.', cells: [31] });
  });

  it('fails ring 2 the wrong way round, not one apart, or with other stars', () => {
    expect(judgeDonkeyRing(board('4.3.....', '00112234'))).toMatchObject({ kind: 'fail', message: 'The ring 2 white and yellow are the wrong way round.', cells: [18, 16] });
    // Side by side is fine either way round.
    expect(judgeDonkeyRing(board('43......', '00112234')).kind).toBe('pass');
    expect(judgeDonkeyRing(board('3...4...', '00112234'))).toMatchObject({ kind: 'fail', message: 'The ring 2 white and yellow are opposite each other.', cells: [16, 20] });
    expect(judgeDonkeyRing(board('4..3....', '00112234'))).toMatchObject({ kind: 'fail', message: 'The ring 2 white and yellow are the wrong way round.' });
    expect(judgeDonkeyRing(board('3.0.....', '00112234'))).toMatchObject({ kind: 'fail', message: 'Ring 2 should hold the other white and yellow.' });
    const high = board('3.......', '00112234'); high[8] = 4;
    expect(judgeDonkeyRing(high)).toMatchObject({ kind: 'fail', message: 'Stars above ring 2.', cells: [8] });
  });
});

describe('practice stats', () => {
  const empty: ModeStats = { current: null, history: [] };

  it('works out fail rate, average completion, average fail and time per pass', () => {
    let s = empty;
    s = noteAttempt(s, 1000, true, 20000);
    s = noteAttempt(s, 2000, true, 10000);
    s = noteAttempt(s, 3000, false, 4000);
    s = noteAttempt(s, 4000, false, 6000);
    const stats = statsOf([s.current!]);
    expect(stats.attempts).toBe(4);
    expect(stats.fails).toBe(2);
    expect(stats.failRate).toBe(0.5);
    expect(stats.completionMs).toBe(15000);
    expect(stats.failAvgMs).toBe(5000);
    // Per pass: (30 s of passes + 10 s of fails + 2 × 4.5 s penalty) / 2 passes.
    expect(stats.totalMs).toBe((30000 + 10000 + 2 * FAIL_PENALTY_S * 1000) / 2);
  });

  it('counts fails at their own time: one pass in five at 1m, fails at 10 s', () => {
    let s = empty;
    for (let i = 0; i < 4; i++) s = noteAttempt(s, i, false, 10000);
    s = noteAttempt(s, 10, true, 60000);
    // 1m + 4 × 10 s + 4 × 4.5 s = 118 s.
    expect(statsOf([s.current!])).toMatchObject({ failRate: 0.8, completionMs: 60000, failAvgMs: 10000, totalMs: 118000 });
  });

  it('adds up the times across sessions', () => {
    let s = empty;
    for (let i = 0; i < 4; i++) s = noteAttempt(s, i, true, 40000);
    s = endSession(s);
    for (let i = 0; i < 20; i++) s = noteAttempt(s, 100 + i, false, 8000);
    const stats = statsOf([...s.history, s.current!]);
    expect(stats.failRate).toBe(20 / 24);
    expect(stats.totalMs).toBe((160000 + 160000 + 20 * 4500) / 4);
  });

  it('leaves sessions saved before fail times were kept out of the time per pass', () => {
    const old = { start: 0, last: 0, attempts: 3, fails: 2, passes: 1, passMs: 30000 };
    expect(statsOf([old])).toMatchObject({ completionMs: 30000, failAvgMs: null, totalMs: null });
    const now = noteAttempt(noteAttempt(empty, 0, false, 5000), 1, true, 20000).current!;
    expect(statsOf([old, now])).toMatchObject({ completionMs: 25000, failAvgMs: 5000, totalMs: 20000 + 5000 + 4500 });
  });

  it('matches the completion average when there are no failures', () => {
    const s = noteAttempt(noteAttempt(empty, 0, true, 10000), 1, true, 20000);
    expect(statsOf([s.current!])).toMatchObject({ completionMs: 15000, totalMs: 15000 });
  });

  it('keeps the fastest and slowest pass, in a session and across sessions', () => {
    let s = noteAttempt(empty, 0, true, 12000);
    s = noteAttempt(s, 1, false);
    s = noteAttempt(s, 2, true, 8000);
    s = noteAttempt(s, 3, true, 20000);
    expect(statsOf([s.current!])).toMatchObject({ fastestMs: 8000, slowestMs: 20000 });
    const later = noteAttempt(noteMove(endSession(s), 10), 11, true, 5000);
    expect(statsOf([...later.history, later.current!])).toMatchObject({ fastestMs: 5000, slowestMs: 20000 });
    // No passes, or a session saved before these were kept: nothing to show.
    expect(statsOf([noteAttempt(empty, 0, false).current!])).toMatchObject({ fastestMs: null, slowestMs: null });
    const old = { start: 0, last: 0, attempts: 2, fails: 0, passes: 2, passMs: 9000 };
    expect(statsOf([old])).toMatchObject({ completionMs: 4500, fastestMs: null, slowestMs: null });
  });

  it('has no times until something passes', () => {
    const stats = statsOf([noteAttempt(empty, 0, false).current!]);
    expect(stats.failRate).toBe(1);
    expect(stats.completionMs).toBeNull();
    expect(stats.totalMs).toBeNull();
    expect(statsOf([]).failRate).toBeNull();
    expect(statsOf([]).totalMs).toBeNull();
  });

  it('ends a session on leaving, on reload, and after 30 idle minutes', () => {
    let s = noteAttempt(empty, 0, true, 5000);
    s = noteMove(s, SESSION_IDLE_MS); // just inside: the same session
    expect(s.history).toHaveLength(0);
    s = noteMove(s, 2 * SESSION_IDLE_MS + 1); // idle too long: a new session
    expect(s.history).toHaveLength(1);
    expect(s.current!.attempts).toBe(0);
    s = noteAttempt(s, 2 * SESSION_IDLE_MS + 2, false);
    const reloaded = loadModeStats(JSON.parse(JSON.stringify(s)));
    expect(reloaded.current).toBeNull();
    expect(reloaded.history.map((h) => h.attempts)).toEqual([1, 1]);
    // A session with nothing attempted isn't kept.
    expect(endSession(noteMove(empty, 0)).history).toHaveLength(0);
  });
});
