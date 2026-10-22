import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { Board, H, W, type Shaft } from './board';
import { Glove } from './gloves';
import { ball, EMPTY } from './pieces';
import { punchPosition, punchSteps } from './punch';

const makeBoard = (rows: number, damageLevel = 0) => new Board(new Random(1), new Random(2), [new Random(3), new Random(4)], { startRows: rows, damageLevel });
const shaft = (side: number): Shaft => ({ from: 1, id: 1, count: 0, side, height: 6, width: 7, blacks: 0, next: 0 });
const cellKey = (p: { x: number; y: number }) => p.y * W + p.x;

describe('incoming punch animation', () => {
  it.each([0, 1])('retains the original balls at the start, including those destroyed by a punch from side %i', side => {
    const b = makeBoard(H - 2), before = [...b.cells];
    const result = b.punch(shaft(side), new Glove(127));
    const shown = [...b.cells];
    for (const column of result.columns) {
      for (const cell of column.cells) shown[cellKey(cell)] = EMPTY;
      for (const move of column.moves) {
        const position = punchPosition(move, 0);
        if (position >= 0) shown[cellKey(column.cells[position])] = move.piece;
      }
      for (const d of column.destroyed) {
        expect(d.step).toBeGreaterThan(0);
        shown[cellKey(column.cells[d.at])] = d.piece;
      }
    }
    expect(shown).toEqual(before);
    expect(result.columns.some(c => c.destroyed.length > 0)).toBe(true);
  });

  it('queues incoming balls at the entry, then pushes them continuously to their final cells', () => {
    const b = makeBoard(3), result = b.punch(shaft(1), new Glove(127));
    for (const column of result.columns) {
      const steps = punchSteps(column);
      for (const move of column.moves) {
        expect(punchPosition(move, 0)).toBe(move.from);
        expect(punchPosition(move, move.wait)).toBe(move.from);
        expect(punchPosition(move, move.wait + 0.5)).toBe(move.from + 0.5);
        expect(punchPosition(move, steps)).toBe(move.to);
        expect(b.get(column.cells[move.to])).toBe(move.piece);
      }
      expect(steps).toBe(6);
    }
  });

  it('waits for gaps to be consumed before moving a ball further down the board', () => {
    const path = makeBoard(19).punch(shaft(1), new Glove(127)).columns[0].cells;
    const b = makeBoard(0);
    b.set(path[0], ball(0));
    b.set(path[2], ball(4));
    const column = b.punch({ ...shaft(1), height: 3, width: 1 }, new Glove(127)).columns[0];
    const later = column.moves.find(m => m.from === 2)!;
    expect(later.wait).toBe(1);
    expect(punchPosition(later, 0.5)).toBe(2);
    expect(punchPosition(later, 1.5)).toBe(2.5);
  });
});
