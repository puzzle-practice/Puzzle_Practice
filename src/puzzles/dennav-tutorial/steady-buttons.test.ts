import { describe, expect, it } from 'vitest';

/**
 * Buttons must not grey out while a move plays. A `disabled` check that reads whether a move is playing
 * (busy(), scenes, replaying, waiting) flips on every move, so the button flashes. Keep `disabled` to the
 * state the player can see (a board to step through, a mistake found), and have the handler itself ignore
 * a press while a move plays.
 */
const MOVING = /\bbusy\(\)|\bscenes\b|\breplaying\b|\bwaiting\b/;
const sources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The body of a named helper (`function name(` or `const name = (`), up to its first closing line. */
function helperBody(source: string, name: string): string | null {
  const start = source.search(new RegExp(`(function ${name}\\(|const ${name} = )`));
  if (start < 0) return null;
  const rest = source.slice(start);
  const end = rest.search(/\n {2}\}|;\n/);
  return rest.slice(0, end < 0 ? undefined : end);
}

describe('steady buttons', () => {
  for (const [file, source] of Object.entries(sources)) {
    if (file.endsWith('.test.ts')) continue;
    it(`${file}: no disabled check depends on a move playing`, () => {
      const offenders: string[] = [];
      for (const m of source.matchAll(/disabled:\s*\([^)]*\)\s*=>\s*([^}]*)/g)) {
        const check = m[1];
        if (MOVING.test(check)) { offenders.push(check.trim()); continue; }
        for (const call of check.matchAll(/([A-Za-z_]\w*)\(/g)) {
          const body = helperBody(source, call[1]);
          if (body && MOVING.test(body)) offenders.push(`${check.trim()}  (via ${call[1]})`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});
