import { describe, expect, it } from 'vitest';
import fixtures from './parity-fixtures.json';
import { ShipBoard, ShipSession, GOLD, TIDE_MS, OVERTIME_MS, STYLES, PATTERNS, type Cell } from './logic';

function snapshot(board: ShipBoard) {
  return { cells: board.cells, patterns: board.available.map(p => p.id), pile: board.pile,
    combo: board.combo, completed: board.completed, available: board.numAvailable };
}
function arrange(board: ShipBoard, slot: number, at: Cell, gold = false): void {
  for (const [t, x, y] of board.available[slot].cells) board.cells[(at[0] + x) * 5 + at[1] + y] = t;
  if (gold) board.cells[at[0] * 5 + at[1]] = GOLD;
}

describe('Shipwrightery game parity', () => {
  for (const fixture of fixtures) it(`matches deals and 16 transitions at difficulty ${fixture.difficulty}, seed ${fixture.seed}`, () => {
    const board = new ShipBoard(fixture.difficulty, fixture.seed);
    expect(snapshot(board)).toEqual(fixture.initial);
    for (const action of fixture.actions) {
      if (action.type === 'expire') board.expire();
      else if (action.type === 'swap') expect(board.swap(action.a! as unknown as Cell, action.b! as unknown as Cell)).toBe(true);
      else {
        arrange(board, action.slot!, action.at! as unknown as Cell, true);
        expect(board.place(action.slot!, action.at! as unknown as Cell)).toBe(action.points);
      }
      expect(snapshot(board)).toEqual(action.after);
    }
  });
});

describe('Shipwrightery rules', () => {
  it('has all 36 fixed patterns and nine difficulty styles', () => {
    expect(PATTERNS).toHaveLength(36);
    expect(STYLES).toHaveLength(9);
    expect(PATTERNS.filter(p => p.tier === 0)).toHaveLength(16);
    expect(PATTERNS.filter(p => p.tier === 1)).toHaveLength(10);
    expect(PATTERNS.filter(p => p.tier === 2)).toHaveLength(10);
  });
  it('uses either neighbor’s movement, while gold is fixed and invalid moves preserve the combo', () => {
    const board = new ShipBoard(8, 42);
    board.cells.fill(3);
    board.cells[0] = 0;
    board.combo = 3;
    expect(board.canSwap([0, 0], [0, 1])).toBe(true);
    expect(board.swap([0, 0], [1, 0])).toBe(false);
    expect(board.combo).toBe(3);
    board.cells[5] = 1;
    expect(board.swap([0, 0], [1, 0])).toBe(true);
    expect(board.combo).toBe(0);
    board.cells[0] = 2;
    expect(board.canSwap([0, 0], [1, 1])).toBe(true);
    board.cells[6] = GOLD;
    expect(board.canSwap([0, 0], [1, 1])).toBe(false);
    expect(board.canSwap([0, 0], [2, 2])).toBe(false);
  });
  it('matches gold, rejects edges and mismatches, and gives no extra points for gold', () => {
    const board = new ShipBoard(8, 42);
    const pattern = board.available[5];
    expect(board.canPlace(5, [0, 0])).toBe(false);
    arrange(board, 5, [2, 2], true);
    expect(board.canPlace(5, [2, 2])).toBe(true);
    expect(board.place(5, [2, 2])).toBe(pattern.points);
    expect(board.completed).toBe(1);
  });
  it('restores one washed-away pattern on the first placement after a swap, not during a combo', () => {
    const board = new ShipBoard(8, 42);
    board.expire(); board.expire();
    arrange(board, 0, [2, 2]); board.place(0, [2, 2]);
    expect(board.numAvailable).toBe(5);
    arrange(board, 0, [2, 2]); board.place(0, [2, 2]);
    expect(board.numAvailable).toBe(5);
    expect(board.combo).toBe(2);
  });
});

describe('Shipwrightery timing', () => {
  it('warns at 60s and 67.5s and loses the last pattern at 75s', () => {
    const s = new ShipSession(8, 42, 0);
    s.update(59_999); expect(s.events).toEqual([]);
    s.update(60_000); expect(s.events).toEqual([{ type: 'warning', level: 1 }]);
    s.update(67_500); expect(s.events.at(-1)).toEqual({ type: 'warning', level: 2 });
    s.update(74_999); expect(s.board.numAvailable).toBe(6);
    s.update(TIDE_MS); expect(s.board.numAvailable).toBe(5);
    expect(s.deadline).toBe(150_000);
    for (let n = 2; n <= 6; n++) s.update(TIDE_MS * n);
    expect(s.failed).toBe(true);
    expect(s.finished).toBe(true);
  });
  it('starts a fresh tide from the frame that notices expiration after a long gap', () => {
    const s = new ShipSession(8, 42, 0);
    s.update(400_000);
    expect(s.board.numAvailable).toBe(5);
    expect(s.deadline).toBe(475_000);
  });
  it('freezes the tide during the 300ms flash and blocks input through the 400ms growth', () => {
    const s = new ShipSession(8, 42, 0);
    arrange(s.board, 0, [2, 2]);
    expect(s.place(0, [2, 2], 0)).toBe(0);
    expect(s.place(0, [2, 2], 60_000)).toBeGreaterThan(0);
    const level = s.progress(60_001);
    expect(s.progress(60_299)).toBe(level);
    s.update(60_300); expect(s.deadline).toBe(135_300);
    expect(s.canAct(60_699)).toBe(false);
    expect(s.canAct(60_700)).toBe(true);
    expect(s.tide(62_300)).toBeCloseTo(2000 / TIDE_MS);
  });
  it('allows only placements in overtime, pauses for each flash, and does not reset its deadline', () => {
    const s = new ShipSession(8, 42, 0);
    s.board.completed = 19;
    arrange(s.board, 0, [2, 2]); s.place(0, [2, 2], 1000);
    s.update(1300);
    expect(s.overtime).toBe(true);
    expect(s.deadline).toBe(1300 + OVERTIME_MS);
    expect(s.swap([0, 0], [1, 0], 2000)).toBe(false);
    arrange(s.board, 0, [2, 2]); s.place(0, [2, 2], 2000);
    s.update(2300);
    expect(s.deadline).toBe(16600);
    s.update(16599); expect(s.finished).toBe(false);
    s.update(16600); expect(s.finished).toBe(true);
    expect(s.failed).toBe(false);
  });
  it('uses the fixed tutorial, no tide and two seconds of overtime', () => {
    const s = new ShipSession(0, 42, 0);
    expect(s.board.goal).toBe(3);
    s.update(1_000_000); expect(s.board.numAvailable).toBe(3);
    expect(s.board.available.map(p => p.id)).toEqual(['cannon', 'rigging', 'sail']);
    expect(s.board.canPlace(0, [1, 0])).toBe(true);
    s.board.completed = 2;
    s.place(0, [1, 0], 1_000_001); s.update(1_000_301);
    expect(s.deadline).toBe(1_002_301);
  });
});
