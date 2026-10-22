import { describe, expect, it } from 'vitest';
import { EMPTY, GAFF, ROWS, RiggingBoard, TAR, WILD, rowSize, type Pull } from './board';
import fixtures from './fixtures/rules.json';

const decode = (s: string) => Array.from({ length: s.length / 2 }, (_, i) => s.slice(i * 2, i * 2 + 2) === '..' ? EMPTY : parseInt(s.slice(i * 2, i * 2 + 2), 16));
type Recorded = [number, number, number[], number[], number, number, number, number, number, number[], number[]];
type Move = [number, number, number, number, number, Recorded | null, number, number, string];

const summary = (r: Pull | null, colours: number) => r && [
  r.count, r.points(colours), [...r.chains()].map(c => c.colour), [...r.chains()].map(c => c.pulled.size), r.isolates.size,
  +r.tarEarned, +r.linked, r.wilds, r.tar.length, [...r.shapes].sort((a, b) => a - b), [...r.maneuvers].sort((a, b) => a - b),
];

describe('Rigging rule reference cases', () => {
  it('recreates 60 starting boards with their random sequence at every difficulty and shape setting', () => {
    for (const f of fixtures.boards) {
      const b = new RiggingBoard(f.seed, f.difficulty, f.mode);
      expect(b.cells(), `seed ${f.seed}`).toEqual(decode(f.cells));
      expect(Array.from({ length: f.next.length }, () => b.rng.nextInt(1000))).toEqual(f.next);
    }
  });
  it('follows every rope the same way, wrapping at the ends', () => {
    const b = new RiggingBoard(1, 0);
    for (const [x, y, dir, pts] of fixtures.slides as [number, number, number, number[]][])
      expect(b.slidePoints(x, y, dir).flatMap(p => [p.x, p.y]), `${x},${y} dir ${dir}`).toEqual(pts);
  });
  it('replays 6,400 recorded slides with pulls, splices, gaffs, tar, enclosed pieces, coils and maneuvers', () => {
    let pulls = 0;
    for (const g of fixtures.games) {
      const b = new RiggingBoard(g.seed, g.difficulty, g.mode);
      expect(b.cells()).toEqual(decode(g.cells));
      for (const [i, [x, y, dir, amount, pulley, result, cache, skips, cells]] of (g.moves as Move[]).entries()) {
        const where = `seed ${g.seed} move ${i}`;
        expect(b.nextPulley, where).toBe(pulley);
        b.slide(x, y, dir, amount);
        const r = b.pullNext();
        expect(summary(r, b.colours), where).toEqual(result);
        expect([b.cache, b.skipsRemaining], where).toEqual([cache, skips]);
        expect(b.cells(), where).toEqual(decode(cells));
        if (r) pulls++;
      }
    }
    expect(pulls).toBeGreaterThan(5000);
  });
});

describe('Rigging board', () => {
  const blank = (difficulty = 0) => {
    const b = new RiggingBoard(5, difficulty);
    let c = 0;
    // A board with no three alike anywhere: colours cycle so neighbours differ.
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < rowSize(y); x++) b.pieces[y][x] = (c++ * 2 + y) % 6;
    return b;
  };
  it('skips a pulley holding a special or fewer than three matches, and loses five loops after three skips', () => {
    const b = blank();
    b.cache = 12;
    b.pieces[0][2] = WILD;
    expect(b.pullNext()).toBeNull();
    expect(b.skipsRemaining).toBe(2);
    expect(b.pullNext()).toBeNull();
    expect(b.pullNext()).toBeNull();
    expect(b.cache).toBe(7);
    expect(b.skipsRemaining).toBe(3);
  });
  it('lets wild, tar and gaff match any colour being pulled', () => {
    for (const special of [WILD, TAR, GAFF]) {
      const b = blank(9);
      const colour = b.pieces[0][2];
      b.pieces[0][3] = special; b.pieces[0][4] = colour;
      const r = b.pullNext()!;
      expect(r.pulled.size, String(special)).toBeGreaterThanOrEqual(3);
    }
  });
  it('scores count^(0.8 + 0.1 × colours) plus link, tar and enclosure bonuses', () => {
    const b = blank(9);
    const colour = b.pieces[0][2];
    b.pieces[0][1] = colour; b.pieces[0][3] = colour; b.pieces[1][3] = colour;
    const r = b.pullNext()!;
    expect(r.count).toBe(4);
    expect(r.points(8)).toBe(Math.floor(4 ** 1.6));
    expect(r.points(6)).toBe(Math.floor(4 ** 1.4));
  });
});
