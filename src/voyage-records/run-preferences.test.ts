import { afterEach, expect, it, vi } from 'vitest';
import { ignoredRun, withoutIgnoredRuns } from './run-preferences';
import { exportRecords } from './known-records';
import { loadDebugMode, loadIgnoredRuns, saveDebugMode, saveIgnoredRuns } from './saved';
import { parseExpeditionLog, recordsByCrewSize, type Run } from './records';

const run = (startedAt: number | null, score = 100): Run => ({
  expedition: 'vampireLairs', ocean: 'emerald', startedAt, score,
  crewSize: 2, players: ['Aster', 'Birch'], loot: [1, 2, score - 3],
  fraysWon: 1, result: 'Returned', frays: [],
});

afterEach(() => vi.unstubAllGlobals());

it('keeps an ignored voyage out of records and exports, including after a parser correction', () => {
  const best = run(Date.UTC(2026, 1, 7, 2, 7, 49), 430);
  const next = run(Date.UTC(2026, 1, 8), 90);
  const ignored = [ignoredRun(best)];
  const corrected = { ...best, score: 300, players: ['Birch', 'Aster', 'Cedar'], crewSize: 3 };
  const visible = withoutIgnoredRuns([corrected, next], ignored);
  expect(visible).toEqual([next]);
  expect(recordsByCrewSize(visible)[0].maxScore).toBe(next);
  expect(exportRecords(visible, []).records.every((record) => record.value < 430)).toBe(true);
  expect(withoutIgnoredRuns([corrected, next], [])).toEqual([corrected, next]);
});

it('distinguishes undated voyages by their original excerpt', () => {
  const first = { ...run(null), source: { text: '[01:00:00] Welcome to the vampire sanctum.\n', firstLine: 1, lastLine: 1 } };
  const second = { ...first, source: { ...first.source, text: '[02:00:00] Welcome to the vampire sanctum.\n' } };
  expect(withoutIgnoredRuns([first, second], [ignoredRun(first)])).toEqual([second]);
});

it('remembers ignored voyages and debug mode without storing any raw chatlog', () => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  });
  const voyage = { ...run(Date.UTC(2026, 1, 7)), source: { text: 'original chatlog', firstLine: 1, lastLine: 2 } };
  const ignored = [ignoredRun(voyage)];
  expect(saveIgnoredRuns(ignored)).toBe(true);
  saveDebugMode(true);
  expect(loadIgnoredRuns()).toEqual(ignored);
  expect(loadDebugMode()).toBe(true);
  expect([...data.values()].join('')).not.toContain('original chatlog');
  saveIgnoredRuns([]);
  expect(loadIgnoredRuns()).toEqual([]);
});

it('handles unavailable browser storage', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Blocked'); } });
  expect(loadIgnoredRuns()).toEqual([]);
  expect(loadDebugMode()).toBe(false);
  expect(saveIgnoredRuns([ignoredRun(run(123))])).toBe(false);
});

it('exports one voyage through its final loot, excluding neighbouring voyages and later chat', () => {
  const text = [
    '====== 2026/02/07 ======',
    '[01:59:00] Earlier conversation.',
    '[02:07:49] Welcome to the vampire sanctum.',
    '[02:08:00] Game over.  Winners: Fortunae, Ragnarlothbr.',
    '[02:08:01] Ye hear the sound of rustling in coffins.',
    '[02:09:00] Ye have taken aboard 68 immortal chests!',
    '[02:09:01] Ye have taken aboard 109 nocturnal lockers!',
    '[02:09:02] Ye have taken aboard 253 blood boxes!',
    '[02:09:03] The booty has been divided!',
    '[02:09:04] Later conversation.',
    '[03:00:00] Welcome to the vampire sanctum.',
    '[03:01:00] Game over.  Winners: Aster, Birch.',
    '[03:02:00] Ye have taken aboard 3 blood boxes!',
    '[03:05:00] Unrelated after the parser cutoff.',
  ].join('\r\n');
  const [first, second] = parseExpeditionLog(text, { ocean: 'emerald' });
  expect(first.source?.text).toContain('[02:07:49] Welcome');
  expect(first.source?.text).toContain('253 blood boxes!');
  expect(first.source?.text).not.toMatch(/Earlier conversation|Later conversation|03:00:00/);
  expect(first.source).toMatchObject({ firstLine: 3, lastLine: 9 });
  expect(second.source?.text).not.toContain('Unrelated after');
  expect(parseExpeditionLog(first.source!.text, { ocean: 'emerald' })).toMatchObject([{ startedAt: first.startedAt, loot: first.loot, score: first.score, players: first.players }]);
});

it('retains midnight date changes and non-event lines inside a voyage', () => {
  const text = '====== 2026/02/07 ======\n[23:59:50] Welcome to the vampire sanctum.\n[23:59:51] Game over.  Winners: Aster, Birch.\n====== 2026/02/08 ======\n[00:00:10] Ye have taken aboard 5 blood boxes!\n[00:00:11] The booty has been divided!';
  const [voyage] = parseExpeditionLog(text);
  expect(voyage.source?.text).toContain('====== 2026/02/08 ======');
  expect(parseExpeditionLog(voyage.source!.text)[0]).toMatchObject({ startedAt: voyage.startedAt, loot: [0, 0, 5] });
});
