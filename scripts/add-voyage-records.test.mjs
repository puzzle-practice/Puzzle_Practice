import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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

it('finds the GitHub repo in a remote URL', async () => {
  const { githubRepo } = await import('./add-voyage-records.mjs');
  expect(githubRepo('https://github.com/puzzle-practice/Puzzle_Practice.git')).toBe('puzzle-practice/Puzzle_Practice');
  expect(githubRepo('git@github.com:puzzle-practice/puzzle_practice')).toBe('puzzle-practice/puzzle_practice');
  expect(githubRepo('https://example.com/x/y')).toBe(null);
});

describe('pictures in a send-in folder', () => {
  it('sorts pictures by the record number they start with, and shares the rest', async () => {
    const { sortPictures } = await import('./add-voyage-records.mjs');
    const { byNumber, shared } = sortPictures(['10.png', '2-b.jpg', '2.png', '1 (1).MP4', 'crew.webp', 'message.txt', 'notes.doc', '12x.png']);
    expect(Object.fromEntries(byNumber)).toEqual({ 1: ['1 (1).MP4'], 2: ['2.png', '2-b.jpg'], 10: ['10.png'], 12: ['12x.png'] });
    expect(shared).toEqual(['crew.webp']);
  });

  it('gives pictures to added and beaten records, and to a tie whose record has none yet', async () => {
    const { picturesFor, sortPictures } = await import('./add-voyage-records.mjs');
    const { results } = mergeRecords(table, [
      sent({ kind: 'chests', value: 140 }),
      sent({ kind: 'score', value: 1270 }),
      sent({ crewSize: 1, kind: 'score', value: 5 }),
      sent({ kind: 'score', value: 12 }),
    ], 'Sent in');
    const pictures = sortPictures(['1.png', '2.png', '4.png', 'all.png']);
    expect(picturesFor(results, pictures).map(({ number, names, late }) => ({ number, names, late }))).toEqual([
      { number: 1, names: ['1.png', 'all.png'], late: undefined },
      { number: 2, names: ['2.png', 'all.png'], late: true },
      { number: 3, names: ['all.png'], late: undefined },
    ]);
    // The tied score record already has a picture, so it keeps that one.
    expect(picturesFor(results, pictures, { 'cursedIsles/emerald/3/score': { screenshot: 'x.png' } }).map((item) => item.number)).toEqual([1, 3]);
  });

  it('names copied pictures by voyage, ocean, crew and contents', async () => {
    const { picturePath } = await import('./add-voyage-records.mjs');
    const path = picturePath({ voyage: 'vampireLairs', ocean: 'emerald', crewSize: 4 }, Buffer.from('a'), 'Shot.JPEG');
    expect(path).toMatch(/^voyage-records\/screenshots\/vampire-lairs\/sent\/emerald-4p-[0-9a-f]{8}\.jpg$/);
    expect(picturePath({ voyage: 'vampireLairs', ocean: 'emerald', crewSize: 4 }, Buffer.from('a'), 'x.jpg')).toBe(path);
  });

  it('finds the one records file in the folder', async () => {
    const { submissionIn } = await import('./add-voyage-records.mjs');
    expect(submissionIn('f', ['1.png', 'gummy.txt'])).toMatch(/gummy\.txt$/);
    expect(() => submissionIn('f', ['1.png'])).toThrow(/No .txt or .json/);
    expect(() => submissionIn('f', ['a.txt', 'b.json'])).toThrow(/More than one/);
  });

  it('rewrites only the screenshots part of sheet-records.json, in the same layout', async () => {
    const { SHEET, screenshotEntry, withScreenshots } = await import('./add-voyage-records.mjs');
    const text = readFileSync(SHEET, 'utf8');
    const { screenshots } = JSON.parse(text);
    expect(withScreenshots(text, screenshots)).toBe(text);
    const next = withScreenshots(text, { ...screenshots, 'woodhallow/emerald/4/score': screenshotEntry(['a.png', 'b.mp4']) });
    expect(next.startsWith(text.slice(0, text.lastIndexOf('"screenshots"')))).toBe(true);
    expect(next).toContain('    "woodhallow/emerald/4/score": {"screenshot": "a.png", "more": ["b.mp4"]}\n  }\n}\n');
    expect(JSON.parse(next).screenshots['woodhallow/emerald/4/score']).toEqual({ screenshot: 'a.png', more: ['b.mp4'] });
  });
});
