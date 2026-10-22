import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { Board, DIR_PREC, H, W, type Shaft } from './board';
import { colourMapping, Glove } from './gloves';
import { BLUE, CYAN, EMPTY, RED, YELLOW, ball, charged, colourOf, dark, isBall, isCharged, isDark, isLight } from './pieces';

function board(rows = 0, damageLevel = 0): Board {
  return new Board(new Random(1), new Random(2), [new Random(3), new Random(4)], { startRows: rows, damageLevel });
}

function fill(b: Board, rows: string[]): void {
  // Rows of letters: r y o c b, '.' empty, a capital is charged, '#' a dark bruise of red.
  const colours: Record<string, number> = { r: 0, y: 1, o: 2, c: 3, b: 4 };
  rows.forEach((row, y) => {
    [...row.replace(/ /g, '')].forEach((ch, x) => {
      if (ch === '.') return;
      if (ch === '#') b.set({ x, y }, dark(ball(RED)));
      else if (ch === ch.toUpperCase()) b.set({ x, y }, charged(ball(colours[ch.toLowerCase()])));
      else b.set({ x, y }, ball(colours[ch]));
    });
  });
}

const shaft = (s: Partial<Shaft>): Shaft => ({ from: 1, id: 1, count: 0, side: 1, width: 0, height: 0, blacks: 0, next: 0, ...s });

describe('the board', () => {
  it('alternates 10 and 9 wide rows, flipping with each drop', () => {
    const b = board(3);
    expect(b.width(0)).toBe(10);
    expect(b.width(1)).toBe(9);
    b.drop();
    expect(b.width(0)).toBe(9);
    expect(b.width(1)).toBe(10);
    expect(b.count()).toBe(10 + 9 + 10 + 9);
  });

  it('starts with three rows and blocks a row for every 6 damage levels', () => {
    expect(board(3).count()).toBe(29);
    const damaged = board(3, 60);
    expect(damaged.damage).toBe(10);
    expect(damaged.lowest()).toBe(12);
  });

  it('shoots straight up into an empty board and rests in the top row', () => {
    const b = board();
    const shot = b.shoot(b.path(0, 90 * DIR_PREC));
    expect(shot?.rest.y).toBe(0);
    expect(shot?.rest.x).toBe(1);
  });

  it('bounces off the walls', () => {
    const b = board();
    const path = b.path(0, 20 * DIR_PREC);
    expect(path.length).toBeGreaterThan(2);
    const shot = b.shoot(path)!;
    expect(shot.rest.y).toBe(0);
  });

  it('stops against a ball and rests next to it', () => {
    const b = board();
    fill(b, ['rrrrrrrrrr', 'yyyyyyyyy']);
    const shot = b.shoot(b.path(0, 90 * DIR_PREC))!;
    expect(shot.rest.y).toBe(2);
    expect(b.get(shot.rest)).toBe(EMPTY);
  });

  it('pops three of a colour and drops what no longer hangs from the top', () => {
    const b = board();
    fill(b, ['rr.......', ' b', ' c']);
    b.set({ x: 2, y: 0 }, ball(RED));
    const clear = b.place({ x: 2, y: 0 })!;
    expect(clear.popped).toHaveLength(3);
    expect(clear.grapes.map((p) => p.y).sort()).toEqual([1, 2]);
    b.remove(clear);
    expect(b.count()).toBe(0);
  });

  it('keeps a charged ball as a spark, and the oldest spark sets off every later one', () => {
    const b = board();
    fill(b, ['rr.yy.cc..']);
    b.set({ x: 2, y: 0 }, charged(ball(RED)));
    expect(b.place({ x: 2, y: 0 })).toBeNull();
    b.set({ x: 5, y: 0 }, charged(ball(YELLOW)));
    expect(b.place({ x: 5, y: 0 })).toBeNull();
    expect(b.sparks).toHaveLength(2);
    // A plain red pops the first spark's group, and the yellow spark goes with it.
    b.set({ x: 0, y: 1 }, ball(RED));
    const clear = b.place({ x: 0, y: 1 })!;
    expect(clear.groups).toHaveLength(2);
    expect(b.groupCount(clear)).toBe(2);
    expect(b.sparks).toHaveLength(0);
  });

  it('loses a charge without a group, and turns a broken spark into a bruise', () => {
    const b = board();
    fill(b, ['rr..']);
    b.set({ x: 3, y: 0 }, charged(ball(BLUE)));
    expect(b.place({ x: 3, y: 0 })).toBeNull();
    expect(isCharged(b.get({ x: 3, y: 0 }))).toBe(false);
    b.set({ x: 2, y: 0 }, charged(ball(RED)));
    b.place({ x: 2, y: 0 });
    expect(b.sparks).toHaveLength(1);
    b.set({ x: 0, y: 0 }, EMPTY);
    b.verifySparks();
    expect(isDark(b.get({ x: 2, y: 0 }))).toBe(true);
    expect(b.sparks).toHaveLength(0);
  });

  it('lightens a bruise next to a pop, then clears it', () => {
    const b = board();
    fill(b, ['rr#yyyyyyy', 'c']);
    b.set({ x: 1, y: 1 }, ball(RED));
    b.place({ x: 1, y: 1 });
    expect(isLight(b.get({ x: 2, y: 0 }))).toBe(true);
  });

  it('turns clears into punches and sprinkle with the game’s formulas', () => {
    const b = board();
    const length = (g: number) => b.sent(g, 40, 0).height;
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(length))
      .toEqual([1, 2, 3, 3, 4, 5, 6, 6, 7, 9, 11, 12, 14, 16, 18, 19]);
    // 4 groups, 12 popped and 6 dropped is a 3x8 punch... width (12 + 3*4)/3 = 8.
    expect(b.sent(4, 12, 6)).toMatchObject({ height: 3, width: 8, count: 6 });
    expect(b.sent(1, 3, 12)).toMatchObject({ height: 0, count: 5 });
    // A minute in, everything a punch is made of counts 20% more.
    expect(b.sent(5, 10, 0, 1)).toMatchObject({ height: 4, width: 3 });
    // Only the popped part of sprinkle grows with time.
    expect(b.sent(1, 10, 9, 1)).toMatchObject({ count: 3 + 6 });
  });

  it('keeps a bruise counter: sprinkle raises it, punches lower it', () => {
    const b = board();
    b.sent(1, 3, 12);
    expect(b.bruiseCounter).toBe(5);
    b.sent(4, 12, 6);
    expect(b.bruiseCounter).toBe(5 + 12 - 24);
  });

  it('lands sprinkle under the balls, and 18 collapses to one row of 9', () => {
    const glove = new Glove(0, 0);
    for (const [count, expected] of [[5, 5], [9, 9], [17, 17], [18, 9], [30, 9]]) {
      const b = board(2);
      const before = b.count();
      b.sprinkle(shaft({ count }), glove);
      expect(b.count() - before).toBe(expected);
    }
  });

  it('pushes balls down with a punch and destroys the topmost when there is no room', () => {
    const glove = new Glove(127, 0);
    const b = board(3);
    const before = b.count();
    const result = b.punch(shaft({ width: 3, height: 4 }), glove);
    expect(result.columns).toHaveLength(3);
    expect(b.count()).toBe(before + 12);
    // A full board loses balls to make room: each column has one empty cell above the bottom
    // row, so 5 of its 6 go, and nothing reaches the bottom row.
    const full = board(H - 2);
    const n = full.count();
    const punched = full.punch(shaft({ width: 9, height: 6, side: 0 }), glove);
    expect(full.isDead()).toBe(false);
    expect(full.count()).toBe(n + 9);
    expect(punched.columns.every((c) => c.destroyed.length === 5)).toBe(true);
  });

  it('drops a row on the eighth shot', () => {
    const b = board(1);
    for (let i = 0; i < 7; i++) expect(b.fired()).toBe(false);
    expect(b.fired()).toBe(true);
    expect(b.count()).toBe(19);
  });

  it('deals each fist its own balls', () => {
    const b = board();
    const next = b.peek(0);
    expect(b.take(0)).toBe(next);
    expect(isBall(b.peek(1))).toBe(true);
    expect(colourOf(b.peek(1))).toBeLessThan(5);
  });
});

describe('bludgeons', () => {
  it('permutes the colours by the colour byte', () => {
    expect(colourMapping(0)).toEqual([0, 1, 2, 3, 4]);
    for (let c = 0; c < 120; c++) expect([...colourMapping(c)].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('uses the bottom two rows for sprinkle and repeats the last four rows of a long punch', () => {
    const fists = new Glove(127);
    // Fists: bottom row 0,0,0,3,1,3,2,2,2; the one above 0,0,0,1,1,1,2,2,2.
    expect(fists.cell(3, 0, false)).toBe(1);
    expect(fists.cell(3, 1, false)).toBe(3);
    expect(fists.height).toBe(4);
    expect(fists.cell(0, 4, true)).toBe(fists.cell(0, 0, true));
    const hammer = new Glove(12, 0);
    expect(isDark(hammer.piece(1, 1, true))).toBe(true);
    expect(new Glove(10).piece(4, 3, true)).toBe(EMPTY);
    expect(W).toBe(10);
    expect(CYAN).toBe(3);
  });
});
