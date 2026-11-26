import { describe, expect, it } from 'vitest';
import { EMPTY } from '../navigation/logic';
import { readPosition, type Position } from './engine';
import { boardExport } from './board-export';

describe('tutorial board exports', () => {
  it('round-trips board pieces, coloured targets and incoming star with debugging context', () => {
    const p: Position = {
      cells: Array<number>(32).fill(EMPTY),
      targets: [{ ring: 3, octant: 5, colour: 2, wild: false }, { ring: 1, octant: 0, colour: 4, wild: false }],
      entry: { colour: 1, octant: 7 },
    };
    p.cells[29] = p.cells[21] = 2;
    const exported = JSON.parse(boardExport(p, {
      lesson: 'vertical-triple', mode: 'build', boardNumber: 17, seed: 514, phase: 'failed', selectedRing: 1,
      feedback: 'Example failure.', validation: { kind: 'failed', issue: { message: 'Example failure.', cells: [29, 21] } },
    }));
    expect(exported.format).toBe('dennav-tutorial-board');
    expect(exported.version).toBe(1);
    expect(readPosition(exported.code)).toEqual(p);
    expect(exported.position).toEqual(p);
    expect(exported.seed).toBe(514);
    expect(exported.boardNumber).toBe(17);
    expect(exported.validation.issue.cells).toEqual([29, 21]);
  });

  it('preserves original colours of wild targets in the exact position data', () => {
    const p: Position = { cells: Array<number>(32).fill(EMPTY), targets: [{ ring: 3, octant: 1, colour: 4, wild: true }], entry: { colour: 0, octant: 0 } };
    const exported = JSON.parse(boardExport(p, { lesson: 'vertical-triple', mode: 'plan', phase: 'painting', selectedRing: 1, feedback: '' }));
    expect(exported.position.targets).toEqual(p.targets);
    expect(p.targets[0].colour).toBe(4);
    expect(exported.code).toContain('31*');
  });
});
