import { describe, expect, it } from 'vitest';
import { ChestMeter, ChestSupply, chestPart, chestPiece, EMERALD, EMPTY, H, HaulBoard, isChestOrigin, RUBY, type Run, Scorer, stepMessage, W } from './logic';

/** A board from rows written top to bottom: 0-3 coins, R ruby, E emerald,. empty, C/c a chest's top/bottom. */
function boardFrom(rows: string[], random: () => number = () => 0): HaulBoard {
  const b = new HaulBoard(random);
  rows.forEach((row, i) => {
    const y = H - 1 - i;
    [...row].forEach((ch, x) => {
      let p = EMPTY;
      if (ch >= '0' && ch <= '3') p = Number(ch);
      else if (ch === 'R') p = RUBY;
      else if (ch === 'E') p = EMERALD;
      else if (ch === 'C') p = chestPiece(x > 0 && row[x - 1] === 'C' ? 1 : 0, 0, 0);
      else if (ch === 'c') p = chestPiece(2, 0, 0);
      b.set(x, y, p);
    });
  });
  return b;
}

/** Fills the board with a checkerboard of four colours that has no runs. */
const QUIET = ['01230123', '23012301', '01230123', '23012301', '01230123', '23012301', '01230123', '23012301'];

/** These values first, then Math.random. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => (i < values.length ? values[i++] : Math.random());
}

describe('populate', () => {
  it('keeps chests waiting until the first-clear delay expires', () => {
    const b = boardFrom(QUIET, () => 0.3);
    let now = 0;
    b.chestReady = () => now >= 1000;
    b.chestList.push({ value: 0, size: 0 });
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) b.set(x, y, EMPTY);
    b.step();
    expect(b.cells.filter(isChestOrigin)).toHaveLength(0);
    expect(b.chestList).toHaveLength(1);
    now = 1000;
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) b.set(x, y, EMPTY);
    b.step();
    expect(b.cells.filter(isChestOrigin)).toHaveLength(1);
    expect(b.chestList).toHaveLength(0);
  });

  it('custom gem rates can disable gems or generate only gems', () => {
    const b = new HaulBoard(() => 0.2);
    b.gemRates = [0, 0];
    expect(b.nextPiece()).toBeLessThan(4);
    b.gemRates = [100, 0];
    expect(b.nextPiece()).toBe(RUBY);
    b.gemRates = [0, 100];
    expect(b.nextPiece()).toBe(EMERALD);
  });
  it('deals only coins and never three in a row', () => {
    for (let n = 0; n < 50; n++) {
      const b = new HaulBoard(Math.random);
      b.populate();
      expect(b.cells.every((p) => p >= 0 && p < 4)).toBe(true);
      expect(b.findRuns()).toEqual([]);
    }
  });
});

describe('nextPiece', () => {
  it('gives a ruby or an emerald 2 times in 308 each, else a coin', () => {
    const at = (r: number) => new HaulBoard(() => (r + 0.5) / 308).nextPiece();
    expect([at(0), at(1)]).toEqual([RUBY, RUBY]);
    expect([at(2), at(3)]).toEqual([EMERALD, EMERALD]);
    expect([at(4), at(5), at(6), at(7), at(8), at(307)]).toEqual([0, 1, 2, 3, 0, 3]);
  });
});

describe('ChestMeter', () => {
  it('earns a chest per 200 coins hauled, carrying the rest over', () => {
    const m = new ChestMeter(200);
    expect(m.add(150)).toBe(0);
    expect(m.add(60)).toBe(1);
    expect(m.coins).toBe(10);
    expect(m.add(400)).toBe(2);
    expect(m.coins).toBe(10);
  });
});

describe('earned chest supply', () => {
  const coins = (count: number, delay = 0) => Array.from({ length: count }, () => ({ x: 0, y: 0, piece: 0, delay }));
  const opening = (b: HaulBoard) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) b.set(x, y, EMPTY);
  };
  const spendStartingChest = (supply: ChestSupply) => {
    const initial = boardFrom(QUIET, () => 0.3);
    supply.beginMove(initial, 2);
    supply.release(initial, 1000, () => 0);
    expect(supply.waiting).toBe(0);
  };

  it('waits a full second for the starting chest and for each earned chest', () => {
    const b = boardFrom(QUIET, () => 0.3);
    const supply = new ChestSupply(150, 0);
    supply.beginMove(b, 2);
    supply.release(b, 999, () => 0);
    expect(b.chestList).toHaveLength(0);
    supply.release(b, 1000, () => 0);
    opening(b);
    b.step();
    expect(b.cells.filter(isChestOrigin)).toHaveLength(1);
    supply.addCleared(coins(149), 2000);
    supply.addCleared(coins(1), 2500);
    supply.beginMove(b, 2);
    supply.release(b, 3499, () => 0);
    expect(b.chestList).toHaveLength(0);
    supply.release(b, 3500, () => 0);
    expect(b.chestList).toHaveLength(1);
  });

  it('keeps the chest earned with two on the board out of their haul cascade, then uses the next opening', () => {
    const b = boardFrom(QUIET, () => 0.3);
    const supply = new ChestSupply(150, 0);
    spendStartingChest(supply);
    b.placeChest(0, 7, 0);
    b.placeChest(4, 7, 0);
    supply.addCleared(coins(150), 1000);
    supply.beginMove(b, 2);
    supply.release(b, 3000, () => 0);
    expect(b.step()).toMatchObject({ kind: 'haul', chests: [{ x: 0 }, { x: 4 }] });
    supply.release(b, 4000, () => 0);
    b.step();
    expect(b.cells.filter(isChestOrigin)).toHaveLength(0);
    expect(supply.waiting).toBe(1);
    supply.beginMove(b, 2);
    supply.release(b, 5000, () => 0);
    opening(b);
    b.step();
    expect(b.cells.filter(isChestOrigin)).toHaveLength(1);
    expect(supply.waiting).toBe(0);
  });

  it('uses the opening left by hauling the sole chest in two-chest mode', () => {
    const b = boardFrom(QUIET, () => 0.3);
    const supply = new ChestSupply(150, 0);
    spendStartingChest(supply);
    b.placeChest(0, 7, 0);
    supply.addCleared(coins(150), 1000);
    supply.beginMove(b, 2);
    supply.release(b, 3000, () => 2);
    expect(b.step()).toMatchObject({ kind: 'haul', chests: [{ x: 0 }] });
    const refill = b.step();
    expect(refill).toMatchObject({ kind: 'rise' });
    expect(b.cells.filter(isChestOrigin)).toHaveLength(1);
    expect(supply.waiting).toBe(0);
  });

  it('preserves every award and the coin remainder while full, releasing one per move', () => {
    const b = boardFrom(QUIET, () => 0.3);
    const supply = new ChestSupply(150, 0);
    spendStartingChest(supply);
    b.placeChest(0, 5, 0);
    b.placeChest(4, 5, 0);
    supply.addCleared(coins(317), 1000);
    expect(supply.meter.coins).toBe(17);
    expect(supply.waiting).toBe(2);
    supply.beginMove(b, 2);
    supply.release(b, 3000, () => 0);
    expect(b.chestList).toHaveLength(0);
    b.cells.fill(0);
    supply.beginMove(b, 2);
    supply.release(b, 3000, () => 0);
    supply.release(b, 3000, () => 0);
    expect(b.chestList).toHaveLength(1);
    expect(supply.waiting).toBe(1);
    expect(supply.meter.coins).toBe(17);
  });

  it('ignores gems and chest squares, and starts the delay when the qualifying blast reaches its coin', () => {
    const b = boardFrom(QUIET, () => 0.3);
    const supply = new ChestSupply(1, 0);
    spendStartingChest(supply);
    supply.addCleared([RUBY, EMERALD, chestPiece(0, 0, 0), EMPTY].map((piece) => ({ piece, x: 0, y: 0, delay: 0 })), 1000);
    expect(supply.waiting).toBe(0);
    supply.addCleared(coins(1, 350), 1000);
    supply.beginMove(b, 1);
    supply.release(b, 2349, () => 0);
    expect(b.chestList).toHaveLength(0);
    supply.release(b, 2350, () => 0);
    expect(b.chestList).toHaveLength(1);
  });

  it('counts a chest still waiting for a suitable gap against the board limit', () => {
    const b = boardFrom(QUIET, () => 0.3);
    const supply = new ChestSupply(150, 0);
    supply.beginMove(b, 1);
    supply.release(b, 1000, () => 0);
    supply.addCleared(coins(150), 1000);
    supply.beginMove(b, 1);
    supply.release(b, 3000, () => 0);
    expect(b.chestList).toHaveLength(1);
    expect(supply.waiting).toBe(1);
  });

  it('requires a clear on an empty two-chest board, then waits a full second without needing 150 coins', () => {
    const b = boardFrom(QUIET, () => 0.3);
    const supply = new ChestSupply(150, 0, true);
    supply.beginMove(b, 2);
    supply.release(b, 10000, () => 0);
    expect(b.chestList).toHaveLength(0);
    expect(supply.waiting).toBe(0);
    supply.addCleared(coins(3), 10000);
    supply.release(b, 10999, () => 0);
    expect(b.chestList).toHaveLength(0);
    supply.release(b, 11000, () => 0);
    opening(b);
    b.step();
    expect(b.cells.filter(isChestOrigin)).toHaveLength(1);
    expect(supply.meter.coins).toBe(3);
    expect(supply.waiting).toBe(0);
  });

  it('retains the first clear deadline across moves and respects the blast arrival time', () => {
    const b = boardFrom(QUIET, () => 0.3);
    const supply = new ChestSupply(150, 0, true);
    supply.beginMove(b, 2);
    supply.addCleared(coins(1, 350), 1000);
    supply.beginMove(b, 2);
    supply.addCleared(coins(3), 2000);
    supply.release(b, 2349, () => 0);
    expect(b.chestList).toHaveLength(0);
    supply.release(b, 2350, () => 0);
    expect(b.chestList).toHaveLength(1);
    supply.beginMove(b, 2);
    supply.addCleared(coins(3), 2400);
    supply.release(b, 3400, () => 0);
    expect(b.chestList).toHaveLength(1);
  });

  it('uses the 150-coin rule once a chest is already in play', () => {
    const b = boardFrom(QUIET, () => 0.3);
    b.placeChest(0, 5, 0);
    const supply = new ChestSupply(150, 0, true);
    supply.beginMove(b, 2);
    supply.addCleared(coins(149), 1000);
    supply.release(b, 5000, () => 0);
    expect(b.chestList).toHaveLength(0);
    supply.addCleared(coins(1), 5000);
    supply.release(b, 5999, () => 0);
    expect(b.chestList).toHaveLength(0);
    supply.release(b, 6000, () => 0);
    expect(b.chestList).toHaveLength(1);
    expect(supply.meter.coins).toBe(0);
  });

  it('keeps banked awards out of a full-board haul, then requires a new clear and delay on the vacant board', () => {
    const b = boardFrom(QUIET, () => 0.3);
    b.placeChest(0, 7, 0); b.placeChest(4, 7, 0);
    const supply = new ChestSupply(150, 0, true);
    supply.beginMove(b, 2);
    supply.addCleared(coins(317), 1000);
    expect(b.step()?.kind).toBe('haul');
    supply.addCleared(coins(3), 3000);
    supply.release(b, 5000, () => 0);
    expect(b.chestList).toHaveLength(0);
    supply.beginMove(b, 2);
    supply.release(b, 6000, () => 0);
    expect(b.chestList).toHaveLength(0);
    supply.addCleared(coins(3), 6000);
    supply.release(b, 6999, () => 0);
    expect(b.chestList).toHaveLength(0);
    supply.release(b, 7000, () => 0);
    expect(b.chestList).toHaveLength(1);
    expect(supply.waiting).toBe(1);
    expect(supply.meter.coins).toBe(23);
  });

  it('restarts the clear-and-wait rule after the last chest leaves, with no coin award banked', () => {
    const b = boardFrom(QUIET, () => 0.3);
    b.placeChest(0, 7, 0);
    const supply = new ChestSupply(150, 0, true);
    supply.beginMove(b, 2);
    expect(b.step()?.kind).toBe('haul');
    supply.release(b, 5000, () => 0);
    expect(b.chestList).toHaveLength(0);
    supply.beginMove(b, 2);
    supply.addCleared(coins(3), 5000);
    supply.release(b, 6000, () => 0);
    expect(b.chestList).toHaveLength(1);
    supply.release(b, 7000, () => 0);
    expect(b.chestList).toHaveLength(1);
  });
});

describe('findRuns', () => {
  it('finds rows top down, then columns top down', () => {
    const b = boardFrom(['11120123', ...QUIET.slice(1, 5), '23012300', '01230120', '23012300']);
    expect(b.findRuns()).toEqual([
      { dir: 0, x: 0, y: 7, length: 3 },
      { dir: 1, x: 7, y: 2, length: 3 },
    ]);
  });

  it('never matches gems or chests', () => {
    const b = boardFrom(['RRR0EEE1', ...QUIET.slice(1, 6), 'CC012301', 'cc230123']);
    expect(b.findRuns()).toEqual([]);
  });
});

describe('Scorer', () => {
  const run = (length: number): Run => ({ dir: 0, x: 0, y: 0, length });
  it('scores runs 3, 5 and 8, times 1, 1.25, 1.75 or 2.5 by how many clear at once', () => {
    const s = new Scorer();
    expect(s.scoreRuns([run(3)])).toBe(3);
    expect(s.scoreRuns([run(4)])).toBe(5);
    expect(s.scoreRuns([run(7)])).toBe(8);
    expect(s.scoreRuns([run(3), run(4)])).toBe(10);
    expect(s.scoreRuns([run(5), run(5), run(5)])).toBe(42);
    expect(s.scoreRuns([run(3), run(3), run(3), run(3), run(3)])).toBe(38);
    expect(s.chain).toBe(6);
    expect(s.total).toBe(3 + 5 + 8 + 10 + 42 + 38);
  });

  it('counts a point per square cleared and five per chest square, but runs replace them', () => {
    const s = new Scorer();
    s.clear(0);
    s.clear(chestPiece(0, 0, 0));
    s.clear(EMPTY);
    expect(s.finish()).toBe(6);
    s.clear(1);
    expect(s.scoreRuns([run(3)])).toBe(3);
  });
});

describe('stepMessage', () => {
  const run = (length: number, dir: 0 | 1 = 0): Run => ({ dir, x: 1, y: 2, length });
  it('names the first clear of a move', () => {
    expect(stepMessage([run(3)], 1)).toBeNull();
    expect(stepMessage([run(4)], 1)).toMatchObject({ text: 'Good', sound: null, run: run(4) });
    expect(stepMessage([run(5)], 1)).toMatchObject({ text: 'Shiny!', sound: 'shiny' });
    expect(stepMessage([run(4), run(3)], 1)).toMatchObject({ text: 'Arrr! 3x4!', run: null });
    expect(stepMessage([run(5), run(5)], 1)?.text).toBe('Yarrr! 5x5!');
    expect(stepMessage([run(3), run(3), run(3)], 1)?.text).toBe('Bingo!');
    expect(stepMessage([run(3), run(4), run(3), run(4)], 1)?.text).toBe('Donkey!');
    expect(stepMessage([run(3), run(3), run(5), run(3)], 1)?.text).toBe('Vegas!');
  });

  it('calls out chain reactions on the 2nd, 5th, 8th... step', () => {
    expect(stepMessage([run(3)], 2)).toMatchObject({ text: 'Ching!', kind: 'chain', sound: null });
    expect(stepMessage([run(3)], 3)).toBeNull();
    expect(stepMessage([run(3)], 5)).toMatchObject({ text: 'Cha-Ching!', sound: 'big_combo' });
    expect(stepMessage([run(3)], 8)?.text).toBe('Cha-Ching!');
  });
});

describe('swap', () => {
  it('swaps a square with the one below it', () => {
    const b = boardFrom(QUIET);
    expect(b.swap(0, 7)).toEqual({ kind: 'swap', upper: 0, lower: 2 });
    expect([b.get(0, 7), b.get(0, 6)]).toEqual([2, 0]);
    expect(b.moved).toBe(true);
  });

  it('only animates two identical pieces, which is not a move', () => {
    const b = boardFrom(['0', '0', ...QUIET.slice(2)].map((r, i) => (i < 2 ? r + QUIET[i].slice(1) : r)));
    expect(b.swap(0, 7).kind).toBe('same');
    expect(b.moved).toBe(false);
  });

  it('refuses empty squares and chests, the bottom row and off the board', () => {
    const b = boardFrom(['.1230123', ...QUIET.slice(1, 6), 'CC012301', 'cc230123']);
    expect(b.swap(0, 7).kind).toBe('illegal');
    expect(b.swap(0, 1).kind).toBe('illegal');
    expect(b.swap(2, 0).kind).toBe('illegal');
    expect(b.swap(8, 3).kind).toBe('illegal');
  });

  it('lets one announced chest through per move', () => {
    const b = boardFrom(QUIET);
    b.pending.push({ value: 1, size: 0 }, { value: 2, size: 0 });
    b.swap(0, 7);
    expect(b.chestList).toEqual([{ value: 1, size: 0 }]);
    expect(b.pending).toEqual([{ value: 2, size: 0 }]);
  });
});

describe('gems', () => {
  it('a ruby goes off where it is, clearing its row and column outward at 50ms a square', () => {
    const b = boardFrom(['R1230123', ...QUIET.slice(1)]);
    const r = b.swap(0, 7);
    expect(r.kind).toBe('gem');
    if (r.kind !== 'gem') return;
    expect(r.cleared).toHaveLength(15);
    expect(r.cleared.find((c) => c.x === 0 && c.y === 7)?.delay).toBe(0);
    expect(r.cleared.find((c) => c.x === 7 && c.y === 7)?.delay).toBe(350);
    expect(r.cleared.find((c) => c.x === 0 && c.y === 0)?.delay).toBe(350);
    for (let x = 0; x < W; x++) expect(b.get(x, 7)).toBe(EMPTY);
    for (let y = 0; y < H; y++) expect(b.get(0, y)).toBe(EMPTY);
    expect(b.get(1, 6)).not.toBe(EMPTY);
    // A point per square, as the first step of the move.
    expect(b.scorer.total).toBe(15);
    expect(b.scorer.chain).toBe(1);
  });

  it('a gem in the lower square goes off too, and the ruby wins over an emerald', () => {
    const b = boardFrom([QUIET[0], 'E3012301', 'R1230123', ...QUIET.slice(3)]);
    const r = b.swap(0, 6);
    expect(r).toMatchObject({ kind: 'gem', gem: RUBY, x: 0, y: 5 });
  });

  it('an emerald clears its diagonals and sets off gems in its path, skipping chests', () => {
    const rows = [...QUIET];
    rows[4] = 'CC2301R3'; // a chest at (0..1, 2..3) and a ruby at (6, 3)
    rows[5] = 'cc012301';
    rows[6] = '0123E123'; // emerald at (4, 1)
    const b = boardFrom(rows);
    const r = b.swap(4, 1);
    if (r.kind !== 'gem') throw new Error('expected a gem');
    expect(r.gem).toBe(EMERALD);
    // The emerald's diagonal reaches the ruby two squares away, which clears row 3 and column 6.
    expect(r.cleared.find((c) => c.x === 6 && c.y === 3)).toMatchObject({ piece: RUBY, delay: 100 });
    expect(r.cleared.find((c) => c.x === 6 && c.y === 7)?.delay).toBe(300);
    expect(b.get(2, 3)).toBe(EMPTY);
    expect(b.get(7, 3)).toBe(EMPTY);
    expect(b.get(6, 0)).toBe(EMPTY);
    // Chest squares stay.
    expect(isChestOrigin(b.get(0, 3))).toBe(true);
    expect(chestPart(b.get(1, 2))).toBe(2);
  });
});

describe('placeChest', () => {
  it('puts a whole chest down that floats and hauls like a dealt one', () => {
    const b = boardFrom(QUIET);
    b.placeChest(3, 5, 1);
    expect(isChestOrigin(b.get(3, 5))).toBe(true);
    expect([chestPart(b.get(4, 5)), chestPart(b.get(3, 4)), chestPart(b.get(4, 4))]).toEqual([1, 2, 2]);
    expect(b.findRuns()).toEqual([]);
    expect(b.step()).toBeNull();
  });
});

describe('settling', () => {
  it('floats pieces up, fills from below, then clears runs and pays out the move', () => {
    const rows = [...QUIET];
    rows[0] = '..230123';
    const b = boardFrom(rows, seq([10.5 / 308, 14.5 / 308]));
    b.moved = true;
    const rise = b.step();
    expect(rise?.kind).toBe('rise');
    if (rise?.kind !== 'rise') return;
    // Each column moves up one, and a new coin comes in at the bottom.
    expect(rise.moves.filter((m) => m.fx === 0)).toHaveLength(H);
    expect(rise.moves.find((m) => m.fx === 0 && m.fy === -1)).toMatchObject({ ty: 0, piece: 2 });
    expect(rise.moves.find((m) => m.fx === 1 && m.fy === -1)).toMatchObject({ ty: 0, piece: 2 });
    expect(b.get(0, 7)).toBe(2);
    while (b.step());
    expect(b.cells.every((p) => p !== EMPTY)).toBe(true);
  });

  it('brings a waiting chest in at the bottom instead of coins, and floats it up whole', () => {
    const rows = [...QUIET];
    rows[0] = '...30123';
    rows[1] = '...12301';
    const b = boardFrom(rows, () => 0);
    b.chestList.push({ value: 2, size: 0 });
    let step = b.step();
    // First everything floats up two; the chest comes in under columns 0-1 (or 1-2) at rows 0-1.
    expect(step?.kind).toBe('rise');
    expect(isChestOrigin(b.get(0, 1))).toBe(true);
    expect(b.chestList).toEqual([]);
    expect(b.get(2, 0)).toBe(EMPTY);
    step = b.step();
    expect(step?.kind).toBe('rise');
    expect(b.get(2, 0)).not.toBe(EMPTY);
  });

  it('hauls a chest whose top reaches the top row', () => {
    const rows = [...QUIET];
    rows[0] = 'CC230123';
    rows[1] = 'cc012301';
    const b = boardFrom(rows);
    const step = b.step();
    expect(step).toMatchObject({ kind: 'haul', chests: [{ x: 0 }] });
    expect([b.get(0, 7), b.get(1, 7), b.get(0, 6), b.get(1, 6)]).toEqual([EMPTY, EMPTY, EMPTY, EMPTY]);
    expect(b.step()?.kind).toBe('rise');
  });

  it('scores a swap that lines up a run and its chain reaction', () => {
    // Swapping (0,7) and (0,6) makes 1 1 1 across the top row.
    const b = boardFrom(['21130123', '13012301', ...QUIET.slice(2)], () => 0);
    expect(b.swap(0, 7).kind).toBe('swap');
    const step = b.step();
    expect(step).toMatchObject({ kind: 'match', points: 3, chain: 1, message: null });
    while (b.step());
    expect(b.settle()).toBeGreaterThanOrEqual(3);
    expect(b.scorer.total).toBe(0);
    expect(b.settle()).toBe(0);
  });
});
