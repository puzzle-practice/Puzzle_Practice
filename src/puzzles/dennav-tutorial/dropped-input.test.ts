import { describe, expect, it } from 'vitest';

/**
 * A move made while another plays out is dropped, never kept to play afterwards: the game ignores it.
 * Any lesson that saves input during a move (a push onto a list, a "next move" slot) breaks this.
 * Replay last (R) and Submit may still wait for the move to finish; they aren't moves.
 */
const sources = {
  ...import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../navigation/*.ts', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

describe('dropped input', () => {
  for (const [file, source] of Object.entries(sources)) {
    if (file.endsWith('.test.ts')) continue;
    it(`${file}: keeps no move made during a move`, () => {
      const offenders = source.split('\n').filter((line) => /busy\(\)|scenes\.length/.test(line) && /\.push\(\s*action\b|\bnextMove\b|\bqueued\b/.test(line));
      expect(offenders).toEqual([]);
      expect(source).not.toMatch(/\bqueued\s*[:=]/);
    });
  }
});
