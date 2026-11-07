import { describe, expect, it } from 'vitest';
import { formatTable, historyLines, mergeRecords, readSubmission } from './add-voyage-records.mjs';

const table = [
  { voyage: 'cursedIsles', ocean: 'emerald', crewSize: 3, kind: 'chests', value: 130, pirates: ['Old'], source: 'sheet' },
  { voyage: 'cursedIsles', ocean: 'emerald', crewSize: 3, kind: 'score', value: 1270, source: 'sheet' },
];
const sent = (fields) => ({ voyage: 'cursedIsles', ocean: 'emerald', crewSize: 3, pirates: ['A', 'B', 'C'], time: '2026-11-03T20:00:00', loot: [1, 1, 1], ...fields });

describe('readSubmission', () => {
  it('reads the downloaded export, a bare list, and the copied message', () => {
    const records = [sent({ kind: 'chests', value: 140 })];
    expect(readSubmission(JSON.stringify({ exported: 'x', logs: [], records }))).toEqual(records);
    expect(readSubmission(`﻿${JSON.stringify(records)}`)).toEqual(records);
    const message = `Hi Jice, I've beaten a voyage record on Puzzle Practice:\n- Cursed Isles ...\n\nData for the records table:\n${JSON.stringify(records)}\n`;
    expect(readSubmission(message)).toEqual(records);
  });

  it('says what is wrong with a cut-off message or a stray file', () => {
    expect(() => readSubmission('Data for the records table:\n[{"voyage":')).toThrow(/copied in full/);
    expect(() => readSubmission('hello')).toThrow(/not a records export/);
  });
});

describe('mergeRecords', () => {
  it('replaces beaten records in place, adds new crew sizes, and keeps ties and lower values', () => {
    const { records, results } = mergeRecords(table, [
      sent({ kind: 'chests', value: 140 }),
      sent({ kind: 'score', value: 1270 }),
      sent({ crewSize: 1, kind: 'score', value: 5 }),
      sent({ kind: 'score', value: 12 }),
      { voyage: 'moon', ocean: 'emerald', crewSize: 1, kind: 'score', value: 1 },
      sent({ crewSize: 8, kind: 'score', value: 99999 }),
    ], 'Sent in');
    expect(records[0]).toEqual({ voyage: 'cursedIsles', ocean: 'emerald', crewSize: 3, kind: 'chests', value: 140, date: '2026-11-03', pirates: ['A', 'B', 'C'], source: 'Sent in' });
    expect(records[1].value).toBe(1270);
    expect(records[2]).toMatchObject({ crewSize: 1, value: 5 });
    expect(records).toHaveLength(3);
    expect(results.map((result) => result.outcome)).toEqual(['beaten', 'kept', 'added', 'kept', 'skipped', 'skipped']);
    expect(results[1].text).toContain('ties the record');
    expect(table[0].value).toBe(130);
  });
});

it('writes the table one record per line, as the repo keeps it', () => {
  expect(formatTable(table)).toBe(`{\n  "records": [\n    ${JSON.stringify(table[0])},\n    ${JSON.stringify(table[1])}\n  ]\n}\n`);
});

it('keeps the replaced record in the history, one line per change', () => {
  const { results } = mergeRecords(table, [sent({ kind: 'chests', value: 140 }), sent({ kind: 'score', value: 12 }), sent({ crewSize: 1, kind: 'score', value: 5 })], 'Sent in');
  const lines = historyLines(results, 'squelchy.txt', new Date('2026-11-07T12:00:00Z')).trim().split('\n').map((line) => JSON.parse(line));
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatchObject({ changedAt: '2026-11-07T12:00:00.000Z', outcome: 'beaten', from: 'squelchy.txt', record: { value: 140 }, previous: table[0] });
  expect(lines[1]).toMatchObject({ outcome: 'added', record: { crewSize: 1, value: 5 }, previous: null });
});
