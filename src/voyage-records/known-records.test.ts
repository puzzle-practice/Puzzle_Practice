import { describe, expect, it } from 'vitest';
import { currentRecords, knownRecords, tableProblems, type KnownRecord } from './known-records';
import type { Run } from './records';

const day = Date.UTC(2026, 9, 23);
const voyage = (overrides: Partial<Run> = {}) => ({
  expedition: 'woodhallow', ocean: 'emerald', crewSize: 12, startedAt: day + 20 * 3_600_000,
  loot: [157, 420, 1091], score: 2402, players: [], fraysWon: 6, result: 'Won', frays: [],
  ...overrides,
}) as Run;
const record = (overrides: Partial<KnownRecord> = {}): KnownRecord => ({
  voyage: 'woodhallow', ocean: 'emerald', crewSize: 12, kind: 'score', value: 2402, ...overrides,
});

describe('the records table', () => {
  it('has no mistakes', () => {
    expect(tableProblems(knownRecords)).toEqual([]);
  });

  it('reports bad entries', () => {
    expect(tableProblems([
      record(),
      record(),
      { ...record({ kind: 'chests' }), voyage: 'woodhallowe', ocean: 'Emerald', crewSize: 0, value: 1.5, date: '23/10/2026' },
    ])).toEqual([
      'Record 2: there is already a score record for this voyage, ocean and crew size',
      'Record 3: voyage must be one of woodhallow, cursedIsles, vampireLairs',
      'Record 3: ocean must be a lower-case name',
      'Record 3: crewSize must be a whole number',
      'Record 3: value must be a whole number',
      'Record 3: date must be YYYY-MM-DD',
    ]);
  });
});

describe('currentRecords', () => {
  it('matches a voyage that equals a standing record for its voyage, ocean and crew size', () => {
    const run = voyage();
    expect(currentRecords([run], [record(), record({ kind: 'chests', value: 157 })])).toEqual(new Map([[run, { score: true, chests: true }]]));
    expect(currentRecords([run], [record({ kind: 'chests', value: 170 })]).size).toBe(0);
    expect(currentRecords([run], [record({ crewSize: 11 })]).size).toBe(0);
    expect(currentRecords([run], [record({ ocean: 'meridian' })]).size).toBe(0);
  });

  it('only checks the date when the table gives one, allowing a day either way', () => {
    const run = voyage();
    expect(currentRecords([run], [record({ date: '2026-10-24' })]).size).toBe(1);
    expect(currentRecords([run], [record({ date: '2026-10-26' })]).size).toBe(0);
    expect(currentRecords([voyage({ startedAt: null })], [record({ date: '2026-10-23' })]).size).toBe(0);
  });
});
