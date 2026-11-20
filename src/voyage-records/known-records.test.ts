import { describe, expect, it } from 'vitest';
import { againstRecords, claimedRecords, exportRecords, isExcludedRun, knownRecords, standingFor, toKnownRecord, type KnownRecord } from './known-records';
import { globalRecords, recordsProblems, type GlobalRecord } from './global-records';
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
    expect(recordsProblems(globalRecords)).toEqual([]);
  });

  it('reports bad entries', () => {
    const den: GlobalRecord = { voyage: 'woodhallow', ocean: 'emerald', category: 'Best score', crewSize: 12, value: 2402 };
    expect(recordsProblems([
      den,
      den,
      { ...den, category: 'Most dire chests', voyage: 'woodhallowe', ocean: 'Emerald', crewSize: 0, value: 1.5, date: '23/10/2026' },
      { voyage: 'cursedIsles', ocean: 'emerald', category: 'Best score', value: 1, pirates: ['A'], pirateScores: [1, 2], loot: [1, 2] },
      { voyage: 'cursedIsles', ocean: 'emerald', category: 'X', value: 1, screenshot: 'https://i.imgur.com/a.png' },
    ])).toEqual([
      'Record 2: there is already a Best score record for this voyage, ocean and crew size',
      'Record 3: voyage must be one of woodhallow, cursedIsles, vampireLairs',
      'Record 3: ocean must be a lower-case name',
      'Record 3: value must be a whole number',
      'Record 3: crewSize must be a whole number',
      'Record 3: date must be YYYY-MM-DD',
      'Record 4: pirateScores must be one number per pirate',
      'Record 4: loot must be three whole numbers, tier 3 first',
      'Record 4: a Best score record needs a crewSize',
      'Record 5: screenshots must be under voyage-records/screenshots/',
    ]);
  });

  it('finds the den records among the other categories', () => {
    expect(knownRecords.length).toBeGreaterThan(0);
    expect(toKnownRecord({ voyage: 'cursedIsles', ocean: 'emerald', category: 'Most cursed chests', crewSize: 3, value: 130, pirates: ['A'] }))
      .toEqual({ voyage: 'cursedIsles', ocean: 'emerald', crewSize: 3, kind: 'chests', value: 130, pirates: ['A'] });
    expect(toKnownRecord({ voyage: 'cursedIsles', ocean: 'emerald', category: 'Most cursed chests in one forage', crewSize: 3, value: 30 })).toBeNull();
    expect(toKnownRecord({ voyage: 'woodhallow', ocean: 'emerald', category: 'Most cursed chests', crewSize: 3, value: 30 })).toBeNull();
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
    expect(result.records.map(({ crewSize, category, value, standing }) => [crewSize, category, value, standing])).toEqual([
      [3, 'Best score', 60, 'new'],
      [3, 'Most dire chests', 10, 'new'],
      [12, 'Best score', 2402, 'beat'],
      [12, 'Most dire chests', 160, 'tie'],
    ]);
    expect(result.records[2]).toMatchObject({
      voyage: 'woodhallow', ocean: 'emerald', date: '2026-10-23', time: '2026-10-23T20:00:00',
      pirates: ['Aster', 'Birch'], loot: [157, 420, 1091], source: 'Exported from Aster_emerald_x',
    });
    expect(result.records[3]).toMatchObject({ time: null, loot: [160, 300, 500] });
    expect(result.records[3]).not.toHaveProperty('date');
    expect(recordsProblems(result.records)).toEqual([]);
  });

  it('skips the reviewed chest-only run and submits the next eligible best', () => {
    const excluded = voyage({
      crewSize: 6, startedAt: Date.UTC(2026, 10, 2, 0, 35, 21), loot: [139, 0, 15], score: 432,
      players: ['Rock', 'amizing', 'Cono', 'Kriosussy', 'Mikethyson', 'Mrraffo'],
    });
    const eligible = voyage({ ...excluded, startedAt: Date.UTC(2026, 10, 2, 2), loot: [125, 300, 600], score: 1575 });

    expect(standingFor(excluded, 'chests')).toBeNull();
    expect(againstRecords([excluded, eligible])).toEqual(new Map([[eligible, { score: null, chests: 'beat' }]]));
    expect(exportRecords([excluded], []).records).toEqual([]);
    expect(claimedRecords(exportRecords([excluded, eligible], []))).toMatchObject([{ category: 'Most dire chests', value: 125 }]);
    expect(standingFor({ ...excluded, startedAt: Date.UTC(2026, 10, 3) }, 'chests')).toBe('beat');
  });

  it('excludes ignored crews from standings and sends the next eligible best', () => {
    const excluded = voyage({
      crewSize: 5, startedAt: null, loot: [126, 258, 512], score: 1406,
      players: ['Bkvi', 'Gummybears', 'Mikethyson', 'Xioch', 'zIkAtO'],
    });
    const eligible = voyage({ ...excluded, players: ['Bkvi', 'Gummybears', 'Mikethyson', 'Xioch', 'Aster'], loot: [125, 258, 512], score: 1403 });
    const records = [record({ crewSize: 5, kind: 'chests', value: 100 })];

    expect(standingFor(excluded, 'chests', records)).toBeNull();
    expect(againstRecords([excluded], records).size).toBe(0);
    expect(exportRecords([excluded], [], new Date(), records).records).toEqual([]);
    const exported = exportRecords([excluded, eligible], [], new Date(), records);
    expect(claimedRecords(exported)).toMatchObject([{ category: 'Most dire chests', value: 125 }]);
    expect(claimedRecords({ ...exported, records: exported.records.map((entry) => ({ ...entry, pirates: excluded.players })) })).toEqual([]);
  });

  it('counts the 2026-02-07 Vampire Lairs run as an eligible 12-pirate voyage', () => {
    const crew = ['Chauman', 'Dugtrio', 'Fortunae', 'Gummybears', 'Jezerbell', 'Mystikaxe', 'Piehax', 'Pricus', 'Qays', 'Ragnarlothbr', 'Rustyspoony', 'Swapped'];
    const run = voyage({ expedition: 'vampireLairs', crewSize: 12, startedAt: Date.UTC(2026, 1, 7, 2, 7, 49), players: crew, loot: [68, 109, 253], score: 430 });
    expect(isExcludedRun(run)).toBe(false);
  });
});

describe('recordsMessage', () => {
  it('lists only beaten records, readable and as data', async () => {
    const { recordsMessage } = await import('./known-records');
    const base = { voyage: 'cursedIsles' as const, ocean: 'emerald', crewSize: 3, pirates: ['A', 'B', 'C'], source: '', loot: [140, 1, 1] as [number, number, number], time: '2026-11-03T20:00:00', date: '2026-11-03' };
    const exported = {
      exported: '2026-11-07T00:00:00Z',
      logs: [],
      records: [
        { ...base, category: 'Most cursed chests', value: 140, standing: 'beat' as const },
        { ...base, category: 'Best score', value: 10, standing: null },
        { ...base, crewSize: 4, category: 'Best score', value: 1800, standing: 'tie' as const },
        { ...base, crewSize: 8, category: 'Best score', value: 9999, standing: 'beat' as const },
      ],
    };
    expect(claimedRecords(exported)).toHaveLength(1);
    const message = recordsMessage(exported);
    expect(message).toContain('Hi Jice');
    expect(message).toContain('1. Cursed Isles (Emerald), 3 pirates, most cursed chests: 140 (beats 130)');
    expect(message).toContain('Crew: A, B, C\n\nData for the records:\n');
    const data = JSON.parse(message.split('\n').at(-1)!);
    expect(data).toEqual([{
      voyage: 'cursedIsles', ocean: 'emerald', category: 'Most cursed chests', crewSize: 3, value: 140,
      date: '2026-11-03', time: '2026-11-03T20:00:00', pirates: ['A', 'B', 'C'], loot: [140, 1, 1],
    }]);
    expect(recordsProblems(data)).toEqual([]);
  });
});
