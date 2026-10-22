import { describe, expect, it } from 'vitest';
import type { Images } from '../../core/assets';
import type { Screen } from '../../core/screen';
import fixtures from './parity.json';
import { colourOf, EMPTY, WeaveBoard } from './logic';
import { CELL, LEFT, mousePosition, SHUTTLE_Y, yForRow } from './timing';
import { WeavingView } from './view';

function drawing() {
  const calls: Array<{ name: string; x: number; y: number; area?: number[] }> = [];
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  const screen = { ctx, blit: (image: { name: string }, x: number, y: number, options?: { area: number[] }) => {
    calls.push({ name: image.name, x, y, area: options?.area });
  } } as unknown as Screen;
  const images = { get: (name: string) => ({ name }) } as unknown as Images;
  return { screen, images, cells: (view: WeavingView, now: number) => {
    calls.length = 0; view.draw(now);
    return calls.filter(call => call.name === 'pieces').map(call => [call.x, call.y, call.area![0] / CELL]).sort();
  } };
}

describe('Weaving animation lifecycle', () => {
  for (const difficulty of [0,3,5,8]) it(`keeps every displayed thread in step through a full level ${difficulty} bolt`, () => {
    const game = fixtures.find(g => g.difficulty === difficulty)!;
    const board = new WeaveBoard(difficulty, BigInt(game.seed));
    const draw = drawing();
    const view = new WeavingView(draw.screen, draw.images, () => {}, board, 0, 42);
    let now = 2000, cleared = 0, ended = 0;
    view.advance(now);
    for (const step of game.steps) {
      expect(view.ready(now)).toBe(true);
      view.moveMouse(LEFT + step.offset * CELL + (10 - board.maxOffset) * CELL / 2, now);
      expect(view.offset).toBe(step.offset);
      const result = board.batten(step.offset);
      view.batten(result, now, groups => { cleared += groups.length; }, () => { ended++; });
      expect(view.ready(now)).toBe(false);
      now += 100000; view.advance(now);
      expect(cleared).toBe(board.groupsCleared);
      const expected: number[][] = [];
      board.pieces.forEach((row, r) => row.forEach((p, c) => {
        const shuttleX = mousePosition(view.lastMouseX,10 - board.maxOffset,board.maxOffset).x;
        if (p !== EMPTY) expected.push([r === 0 ? shuttleX + c * CELL : LEFT + c * CELL,
          r === 0 ? SHUTTLE_Y : yForRow(r), colourOf(p)]);
      }));
      expect(draw.cells(view, now)).toEqual(expected.sort());
      expect(ended).toBe(result.complete || result.booched ? 1 : 0);
    }
  });

  it('blocks input during entry, shifting and rejected placement, then unlocks', () => {
    const board = new WeaveBoard(3, 42);
    const draw = drawing();
    const view = new WeavingView(draw.screen, draw.images, () => {}, board, 0, 42);
    expect(view.ready(0)).toBe(false);
    view.advance(2000);
    expect(view.ready(2000)).toBe(true);
    view.moveKey(1,2000);
    expect(view.ready(2074)).toBe(false);
    expect(view.ready(2075)).toBe(true);
    const before = draw.cells(view,2100);
    view.reject(2100);
    view.advance(2444);
    expect(view.ready(2444)).toBe(false);
    view.advance(2445);
    expect(view.ready(2445)).toBe(true);
    expect(draw.cells(view,2445)).toEqual(before);
  });
});
