import { describe, expect, it } from 'vitest';
import { againstRecords, exportRecords, knownRecords, tableProblems, type KnownRecord } from './known-records';
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

describe('exportRecords', () => {
  it('writes the best score and most chests for each crew size, against the table', () => {
    const best = voyage({ players: ['Aster', 'Birch'] });
    const moreChests = voyage({ loot: [160, 300, 500], score: 1580, startedAt: null });
    const small = voyage({ crewSize: 3, loot: [10, 10, 10], score: 60 });
    const unknownOcean = voyage({ ocean: null });
    const result = exportRecords([best, moreChests, small, unknownOcean], ['Aster_emerald_x'], new Date('2026-11-07T13:00:00Z'), [
      record({ value: 2300 }),
      record({ kind: 'chests', value: 160 }),
    ]);
    expect(result.exported).toBe('2026-11-07T13:00:00.000Z');
    expect(result.logs).toEqual(['Aster_emerald_x']);
    expect(result.records.map(({ crewSize, kind, value, standing }) => [crewSize, kind, value, standing])).toEqual([
      [3, 'score', 60, 'new'],
      [3, 'chests', 10, 'new'],
      [12, 'score', 2402, 'beat'],
      [12, 'chests', 160, 'tie'],
    ]);
    expect(result.records[2]).toMatchObject({
      voyage: 'woodhallow', ocean: 'emerald', date: '2026-10-23', time: '2026-10-23T20:00:00',
      pirates: ['Aster', 'Birch'], loot: [157, 420, 1091], source: 'Exported from Aster_emerald_x',
    });
    expect(result.records[3]).toMatchObject({ time: null, loot: [160, 300, 500] });
    expect(result.records[3]).not.toHaveProperty('date');
    expect(tableProblems(result.records)).toEqual([]);
  });
});
