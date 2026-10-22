import type { PunchColumn, PunchMove } from './board';

/** A ball waits for the incoming column to reach it, then follows the diagonal. */
export function punchPosition(move: PunchMove, elapsedSteps: number): number {
  return Math.min(move.to, move.from + Math.max(0, elapsedSteps - move.wait));
}

/** The last ball finishes after both its queue delay and its travel. */
export function punchSteps(column: PunchColumn): number {
  return Math.max(0, ...column.moves.map(m => m.wait + m.to - m.from), ...column.destroyed.map(d => d.step));
}
