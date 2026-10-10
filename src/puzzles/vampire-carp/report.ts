import type { StatPart } from '../../core/stat-cell';
import { PIECE_LETTERS, PIECE_WEIGHTS } from './board';

/** Compare counts with the game's unrounded weighted expectation, out of 95. */
export function piecesDrawn(found: Readonly<Record<string, number>>): StatPart[] {
  const total = Object.values(found).reduce((sum, count) => sum + count, 0);
  const weightTotal = PIECE_WEIGHTS.reduce<number>((sum, weight) => sum + weight, 0);
  return PIECE_LETTERS.map((piece, i) => {
    const letter = piece === '0' ? 'b' : piece;
    const count = found[letter] ?? 0;
    const expected = total * PIECE_WEIGHTS[i] / weightTotal;
    const difference = count - expected;
    return {
      text: `${letter.toUpperCase()}: ${count}`,
      ...(Math.abs(difference) > 2 ? { tone: difference > 0 ? 'positive' as const : 'negative' as const } : {}),
      title: `Expected ${expected.toFixed(2)} from ${total} draws`,
    };
  });
}
