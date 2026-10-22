import { expect, it } from 'vitest';
import { positionLabel } from './presentation';

it('moves a new combo label to the nearest available edge, preserving ties in game order', () => {
  expect(positionLabel({ x: 100, y: 100, width: 20, height: 20 }, [{ x: 100, y: 100, width: 20, height: 20 }]))
    .toEqual({ x: 80, y: 100, width: 20, height: 20 });
});
it('also avoids previously encountered labels when trying a second obstruction', () => {
  const obstacles = [{ x: 100, y: 100, width: 20, height: 20 }, { x: 80, y: 100, width: 20, height: 20 }];
  expect(positionLabel({ x: 100, y: 100, width: 20, height: 20 }, obstacles))
    .toEqual({ x: 100, y: 80, width: 20, height: 20 });
});
it('keeps labels inside the view where space exists', () => {
  expect(positionLabel({ x: -20, y: 590, width: 100, height: 30 }, []))
    .toEqual({ x: 0, y: 570, width: 100, height: 30 });
});
it('preserves the requested position if the view is completely obstructed', () => {
  const rect = { x: 100, y: 100, width: 20, height: 20 };
  expect(positionLabel(rect, [{ x: 0, y: 0, width: 450, height: 600 }])).toEqual(rect);
});
