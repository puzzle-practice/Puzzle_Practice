import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CATEGORIES, SHEET, bestReports, mergeIntoSheet, readRun, toSheetRecord } from './gizmo-den-records.mjs';

const row = (station, pirate, tokens) => ({ station, pirate, score: tokens[0] + 2 * tokens[1] + 3 * tokens[2], tokens });
const report = (started, rows) => JSON.stringify({
  run: 'run_x', pirate: 'Jice', ocean: 'Emerald', started, started_at: new Date(started).toISOString().slice(0, 23), rows,
});

const run = [
  report(Date.UTC(2026, 10, 10, 20), [row('Navigating', 'Cithara', [3, 1, 0]), row('Foraging', 'Jice', [25, 1, 0]), row('Foraging', 'Xioch', [20, 0, 0])]),
  // Cithara navigates and forages in this one: still one pirate on the crew.
  report(Date.UTC(2026, 10, 10, 21), [row('Navigating', 'Cithara', [1, 0, 0]), row('Foraging', 'Cithara', [0, 2, 5]), row('Foraging', 'Jice', [0, 4, 9]), row('Foraging', 'Xioch', [10, 0, 1])]),
  report(Date.UTC(2026, 10, 10, 22), [row('Navigating', 'Cithara', [1, 0, 0])]),
].join('\n');

describe('readRun', () => {
  it('reads each duty report with foraging, counting the crew and the dire chests', () => {
    const reports = readRun(run, 'C:/runs/run_x.jsonl');
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({ file: 'run_x.jsonl', ocean: 'emerald', crewSize: 3, chests: 0, score: 47 });
    expect(reports[1]).toMatchObject({ crewSize: 3, chests: 15, score: 19 + 35 + 13 });
  });
});

describe('bestReports and toSheetRecord', () => {
  it('keeps the best report per crew size and kind, each forager with their share', () => {
    const best = bestReports(readRun(run, 'run_x.jsonl')).map(toSheetRecord);
    const chests = best.find((record) => record.category === CATEGORIES.chests);
    expect(chests).toMatchObject({ voyage: 'woodhallow', ocean: 'emerald', crewSize: 3, value: '15', date: '2026-11-10', pirates: ['Jice', 'Cithara', 'Xioch'], pirateScores: [9, 5, 1] });
    expect(best.find((record) => record.category === CATEGORIES.score)).toMatchObject({ value: '67', pirates: ['Jice', 'Cithara', 'Xioch'], pirateScores: [35, 19, 13] });
  });

  it('keeps the earlier report on a tie', () => {
    const tie = [report(2, [row('Foraging', 'Late', [0, 0, 4])]), report(1, [row('Foraging', 'Early', [0, 0, 4])])].join('\n');
    const [chests] = bestReports(readRun(tie)).filter((record) => record.kind === 'chests');
    expect(chests.foragers[0].pirate).toBe('Early');
  });
});

describe('mergeIntoSheet', () => {
  const sheet = [
    '{',
    '  "records": [',
    '    {"voyage": "woodhallow", "ocean": "emerald", "category": "Most DCs in one forage", "value": "23"},',
    `    {"voyage": "woodhallow", "ocean": "emerald", "category": "${CATEGORIES.chests}", "crewSize": 5, "value": "60"},`,
    '    {"voyage": "cursedIsles", "ocean": "emerald", "category": "X", "value": "1"}',
    '  ],',
    '  "screenshots": {}',
    '}',
    '',
  ].join('\n');
  const record = (crewSize, value) => ({ voyage: 'woodhallow', ocean: 'emerald', category: CATEGORIES.chests, crewSize, value: String(value) });

  it('replaces a beaten record, adds new crew sizes in order, and leaves ties and lower values', () => {
    const { text, changes } = mergeIntoSheet(sheet, [record(5, 68), record(4, 44), record(6, 72)]);
    expect(changes.map((change) => change.change)).toEqual(['beat', 'new', 'new']);
    const records = JSON.parse(text).records;
    expect(records.map((entry) => entry.crewSize ?? null)).toEqual([null, 4, 5, 6, null]);
    expect(records[2].value).toBe('68');
    expect(text).toContain('"screenshots": {}');
    expect(mergeIntoSheet(sheet, [record(5, 60), record(5, 59)]).changes.map((change) => change.change)).toEqual(['tie', 'lower']);
  });

  it('keeps Windows line endings', () => {
    const windows = mergeIntoSheet(sheet.replaceAll('\n', '\r\n'), [record(4, 44)]).text;
    expect(windows.split('\r\n')).toHaveLength(windows.split('\n').length);
  });

  it('leaves the real sheet unchanged when given its own records', () => {
    const text = readFileSync(SHEET, 'utf8');
    const mine = JSON.parse(text).records.filter((entry) => Object.values(CATEGORIES).includes(entry.category));
    expect(mine.length).toBeGreaterThan(0);
    expect(mergeIntoSheet(text, mine).text).toBe(text);
  });
});
