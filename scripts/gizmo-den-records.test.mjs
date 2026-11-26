import { describe, expect, it } from 'vitest';
import { mergeRecords } from './add-voyage-records.mjs';
import { CATEGORIES, bestReports, gizmoRecords, readRun, toRecord } from './gizmo-den-records.mjs';

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
  it('skips reports with an ignored pirate, including navigators', () => {
    const excluded = report(Date.UTC(2026, 10, 18), [row('Navigating', 'zIkAtO', [0, 0, 0]), row('Foraging', 'Jice', [0, 0, 999])]);
    expect(readRun(`${run}\n${excluded}`)).toEqual(readRun(run));
  });

  it('reads each duty report with foraging, counting the crew and the dire chests', () => {
    const reports = readRun(run, 'C:/runs/run_x.jsonl');
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({ file: 'run_x.jsonl', ocean: 'emerald', crewSize: 3, chests: 0, score: 47 });
    expect(reports[1]).toMatchObject({ crewSize: 3, chests: 15, score: 19 + 35 + 13 });
  });
});

describe('bestReports and toRecord', () => {
  it('keeps the best report per crew size and kind, each forager with their share', () => {
    const best = bestReports(readRun(run, 'run_x.jsonl')).map(toRecord);
    const chests = best.find((record) => record.category === CATEGORIES.chests);
    expect(chests).toMatchObject({ voyage: 'woodhallow', ocean: 'emerald', crewSize: 3, value: 15, date: '2026-11-10', pirates: ['Jice', 'Cithara', 'Xioch'], pirateScores: [9, 5, 1] });
    expect(best.find((record) => record.category === CATEGORIES.score)).toMatchObject({ value: 67, pirates: ['Jice', 'Cithara', 'Xioch'], pirateScores: [35, 19, 13] });
  });

  it('keeps the earlier report on a tie', () => {
    const tie = [report(2, [row('Foraging', 'Late', [0, 0, 4])]), report(1, [row('Foraging', 'Early', [0, 0, 4])])].join('\n');
    const [chests] = bestReports(readRun(tie)).filter((record) => record.kind === 'chests');
    expect(chests.foragers[0].pirate).toBe('Early');
  });
});

describe("saving through add-records' merge", () => {
  const held = (crewSize, value) => ({ voyage: 'woodhallow', ocean: 'emerald', category: CATEGORIES.chests, crewSize, value, source: 'old' });

  it("beats, adds and keeps like any record sent in, keeping each record's own source", () => {
    const records = [{ voyage: 'woodhallow', ocean: 'emerald', category: 'Most DCs in one forage', value: 23 }, held(3, 10), held(5, 60)];
    const { records: merged, results } = mergeRecords(records, gizmoRecords(readRun(run, 'run_x.jsonl')), null);
    expect(results.map((result) => result.outcome)).toEqual(['beaten', 'added']);
    expect(merged.map((record) => [record.category, record.crewSize ?? null, record.value])).toEqual([
      ['Most DCs in one forage', null, 23],
      [CATEGORIES.chests, 3, 15],
      [CATEGORIES.chests, 5, 60],
      [CATEGORIES.score, 3, 67],
    ]);
    expect(merged[1].source).toBe('Gizmo export run_x.jsonl, duty report from 21:00:00');
    expect(mergeRecords(merged, gizmoRecords(readRun(run)), null).results.map((result) => result.outcome)).toEqual(['kept', 'kept']);
  });
});
