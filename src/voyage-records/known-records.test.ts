import { describe, expect, it } from 'vitest';
import { againstRecords, knownRecords, tableProblems, type KnownRecord } from './known-records';
import type { Run } from './records';

const voyage = (overrides: Partial<Run> = {}) => ({
  expedition: 'woodhallow', ocean: 'emerald', crewSize: 12, startedAt: Date.UTC(2026, 9, 23, 20),
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

describe('againstRecords', () => {
  it('finds voyages that tie or beat the record for their voyage, ocean and crew size', () => {
    const run = voyage();
    expect(againstRecords([run], [record(), record({ kind: 'chests', value: 150 })]))
      .toEqual(new Map([[run, { score: 'tie', chests: 'beat' }]]));
    expect(againstRecords([run], [record({ value: 2500 }), record({ kind: 'chests', value: 157 })]))
      .toEqual(new Map([[run, { score: null, chests: 'tie' }]]));
  });

  it('ignores records for other crews, oceans and voyages, and crew sizes with no record', () => {
    const run = voyage();
    expect(againstRecords([run], [record({ crewSize: 11, value: 1 })]).size).toBe(0);
    expect(againstRecords([run], [record({ ocean: 'meridian', value: 1 })]).size).toBe(0);
    expect(againstRecords([run], [record({ voyage: 'cursedIsles', value: 1 })]).size).toBe(0);
    expect(againstRecords([run], [record({ value: 3000 })]).size).toBe(0);
    expect(againstRecords([run], []).size).toBe(0);
  });
});
