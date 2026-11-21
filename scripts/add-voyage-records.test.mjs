import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { historyLines, mergeRecords, normalise, readSubmission } from './add-voyage-records.mjs';
import { RECORDS_FILE, formatRecordsFile, readRecordsFile } from './records-file.mjs';

const table = [
  { voyage: 'cursedIsles', ocean: 'emerald', category: 'Most cursed chests', crewSize: 3, value: 130, pirates: ['Old'], source: 'sheet' },
  { voyage: 'cursedIsles', ocean: 'emerald', category: 'Best score', crewSize: 3, value: 1270, source: 'sheet' },
];
const sent = (fields) => ({ voyage: 'cursedIsles', ocean: 'emerald', crewSize: 3, pirates: ['A', 'B', 'C'], time: '2026-11-03T20:00:00', loot: [1, 1, 1], ...fields });

describe('readSubmission', () => {
  it('reads the downloaded export, a bare list, and the copied message, old and new', () => {
    const records = [sent({ category: 'Most cursed chests', value: 140 })];
    expect(readSubmission(JSON.stringify({ exported: 'x', logs: [], records }))).toEqual(records);
    expect(readSubmission(`﻿${JSON.stringify(records)}`)).toEqual(records);
    for (const marker of ['Data for the records:', 'Data for the records table:', 'Data for the sheet records:']) {
      const message = `Hi Jice, I've beaten a voyage record on Puzzle Practice:\n- Cursed Isles ...\n\n${marker}\n${JSON.stringify(records)}\n`;
      expect(readSubmission(message)).toEqual(records);
    }
  });

  it('says what is wrong with a cut-off message or a stray file', () => {
    expect(() => readSubmission('Data for the records:\n[{"voyage":')).toThrow(/copied in full/);
    expect(() => readSubmission('hello')).toThrow(/not a records export/);
  });
});

describe('normalise', () => {
  it('turns an older export\'s kind into its category and a text value into a number', () => {
    expect(normalise(sent({ kind: 'chests', value: 140, standing: 'beat' }))).toEqual({
      voyage: 'cursedIsles', ocean: 'emerald', category: 'Most cursed chests', crewSize: 3, value: 140,
      pirates: ['A', 'B', 'C'], time: '2026-11-03T20:00:00', date: '2026-11-03', loot: [1, 1, 1],
    });
    expect(normalise({ voyage: 'woodhallow', kind: 'score' }).category).toBe('Best score');
    expect(normalise({ voyage: 'woodhallow', category: 'Best forage score in one DR', value: '260' }).value).toBe(260);
  });
});

describe('mergeRecords', () => {
  it('accepts claims from the 2026-02-07 Vampire Lairs run now that it counts 12 pirates', () => {
    const pirates = ['Chauman', 'Dugtrio', 'Fortunae', 'Gummybears', 'Jezerbell', 'Mystikaxe', 'Piehax', 'Pricus', 'Qays', 'Ragnarlothbr', 'Rustyspoony', 'Swapped'];
    const run = { voyage: 'vampireLairs', ocean: 'emerald', crewSize: 12, date: '2026-02-07', time: '2026-02-07T02:07:49', pirates, loot: [68, 109, 253] };
    const submitted = [{ ...run, kind: 'score', value: 430 }, { ...run, category: 'Most immortal chests', value: 68 }];
    expect(mergeRecords([], submitted, 'Sent in').records).toHaveLength(2);
  });

  it('rejects a higher record from an ignored crew without replacing the standing record', () => {
    const { records, results } = mergeRecords(table, [
      sent({ kind: 'chests', value: 999, pirates: ['A', 'zIkAtO', 'C'] }),
    ], 'Sent in');
    expect(records).toEqual(table);
    expect(results).toMatchObject([{ outcome: 'skipped', text: '' }]);
    expect(historyLines(results, 'submission.json')).toBe('');
  });

  it('replaces beaten records in place, adds new crew sizes, and keeps ties and lower values', () => {
    const { records, results } = mergeRecords(table, [
      sent({ kind: 'chests', value: 140 }),
      sent({ category: 'Best score', value: 1270 }),
      sent({ crewSize: 1, kind: 'score', value: 5 }),
      sent({ kind: 'score', value: 12 }),
      { voyage: 'moon', ocean: 'emerald', crewSize: 1, kind: 'score', value: 1 },
      sent({ crewSize: 8, kind: 'score', value: 99999 }),
      sent({ kind: 'speed', value: 1 }),
      sent({ category: 'Best score', crewSize: undefined, value: 1 }),
    ], 'Sent in');
    expect(records[0]).toEqual({
      voyage: 'cursedIsles', ocean: 'emerald', category: 'Most cursed chests', crewSize: 3, value: 140, date: '2026-11-03',
      time: '2026-11-03T20:00:00', pirates: ['A', 'B', 'C'], loot: [1, 1, 1], source: 'Sent in',
    });
    // A new crew size goes in with its category, smaller crews first.
    expect(records[1]).toMatchObject({ category: 'Best score', crewSize: 1, value: 5 });
    expect(records[2].value).toBe(1270);
    expect(records).toHaveLength(3);
    expect(results.map((result) => result.outcome)).toEqual(['beaten', 'kept', 'added', 'kept', 'skipped', 'skipped', 'skipped', 'skipped']);
    expect(results[1].text).toContain('ties the record');
    expect(results[6].text).toContain('unknown kind "speed"');
    expect(results[7].text).toContain('crew size is missing');
    expect(table[0].value).toBe(130);
  });

  it('takes any category: by crew size, for one pirate, or for each forage', () => {
    const records = [
      { voyage: 'woodhallow', ocean: 'emerald', category: 'Most dire chests in one DR', crewSize: 4, value: 44 },
      { voyage: 'woodhallow', ocean: 'emerald', category: 'Most dire chests in one DR', crewSize: 6, value: 72 },
      { voyage: 'cursedIsles', ocean: 'emerald', category: 'Most frays in one entry, one pirate', value: 17, pirates: ['Jice'] },
      { voyage: 'cursedIsles', ocean: 'emerald', category: 'Most frays in one entry, one pirate', value: 17, pirates: ['Rock'] },
      { voyage: 'cursedIsles', ocean: 'emerald', category: 'Most points in one forage, one pirate', value: 35, notes: 'Forage 1' },
      { voyage: 'cursedIsles', ocean: 'emerald', category: 'Most points in one forage, one pirate', value: 30, notes: 'Forage 2' },
      { voyage: 'vampireLairs', ocean: 'emerald', category: 'Most carpentry holes', value: 25 },
    ];
    const { records: merged, results } = mergeRecords(records, [
      { voyage: 'woodhallow', ocean: 'emerald', category: 'Most dire chests in one DR', crewSize: 4, value: '60', pirates: ['A', 'B', 'C', 'D'] },
      { voyage: 'woodhallow', ocean: 'emerald', category: 'Most dire chests in one DR', crewSize: 5, value: 61 },
      { voyage: 'cursedIsles', ocean: 'emerald', category: 'Most frays in one entry, one pirate', value: 18, pirates: ['Xioch'] },
      { voyage: 'cursedIsles', ocean: 'emerald', category: 'Most points in one forage, one pirate', value: 31, notes: 'Forage 2' },
      { voyage: 'vampireLairs', ocean: 'emerald', category: 'Most carpentry holes', value: 25 },
      { voyage: 'vampireLairs', ocean: 'emerald', category: 'Best carpentry score', value: 46 },
    ], null);
    expect(results.map((result) => result.outcome)).toEqual(['beaten', 'added', 'beaten', 'beaten', 'kept', 'added']);
    expect(merged.map((record) => [record.category, record.crewSize ?? record.notes ?? record.pirates?.[0] ?? null, record.value])).toEqual([
      ['Most dire chests in one DR', 4, 60],
      ['Most dire chests in one DR', 5, 61],
      ['Most dire chests in one DR', 6, 72],
      // The tie's two holders give way to the one who beat them.
      ['Most frays in one entry, one pirate', 'Xioch', 18],
      ['Most points in one forage, one pirate', 'Forage 1', 35],
      ['Most points in one forage, one pirate', 'Forage 2', 31],
      ['Most carpentry holes', null, 25],
      ['Best carpentry score', null, 46],
    ]);
    expect(results[2].replaced).toHaveLength(2);
    expect(results[4].tie).toBe(merged[6]);
  });
});

it('writes records.json one record per line, its fields in one order', () => {
  const text = formatRecordsFile({ fetched: '2026-11-07', sources: [{ voyage: 'cursedIsles', name: 'CI', url: 'u' }], records: [{ source: 's', value: 1, category: 'X', ocean: 'emerald', voyage: 'cursedIsles', more: [] }] });
  expect(text).toBe('{\n  "fetched": "2026-11-07",\n  "sources": [\n    {"voyage":"cursedIsles","name":"CI","url":"u"}\n  ],\n  "records": [\n    {"voyage":"cursedIsles","ocean":"emerald","category":"X","value":1,"source":"s"}\n  ]\n}\n');
  const file = readFileSync(RECORDS_FILE, 'utf8').replaceAll('\r\n', '\n');
  expect(formatRecordsFile(readRecordsFile())).toBe(file);
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
    const submitted = [
      sent({ kind: 'chests', value: 140 }),
      sent({ kind: 'score', value: 1270 }),
      sent({ crewSize: 1, kind: 'score', value: 5 }),
      sent({ kind: 'score', value: 12 }),
    ];
    const pictures = sortPictures(['1.png', '2.png', '4.png', 'all.png']);
    const { results } = mergeRecords(table, submitted, 'Sent in');
    expect(picturesFor(results, pictures).map(({ number, names, late }) => ({ number, names, late }))).toEqual([
      { number: 1, names: ['1.png', 'all.png'], late: undefined },
      { number: 2, names: ['2.png', 'all.png'], late: true },
      { number: 3, names: ['all.png'], late: undefined },
    ]);
    // The tied score record already has a picture, so it keeps that one.
    const pictured = mergeRecords([table[0], { ...table[1], screenshot: 'x.png' }], submitted, 'Sent in');
    expect(picturesFor(pictured.results, pictures).map((item) => item.number)).toEqual([1, 3]);
  });

  it('names copied pictures by voyage, ocean, crew and contents', async () => {
    const { picturePath } = await import('./add-voyage-records.mjs');
    const path = picturePath({ voyage: 'vampireLairs', ocean: 'emerald', crewSize: 4 }, Buffer.from('a'), 'Shot.JPEG');
    expect(path).toMatch(/^voyage-records\/screenshots\/vampire-lairs\/sent\/emerald-4p-[0-9a-f]{8}\.jpg$/);
    expect(picturePath({ voyage: 'vampireLairs', ocean: 'emerald', crewSize: 4 }, Buffer.from('a'), 'x.jpg')).toBe(path);
    expect(picturePath({ voyage: 'vampireLairs', ocean: 'emerald' }, Buffer.from('a'), 'x.png')).toMatch(/\/sent\/emerald-[0-9a-f]{8}\.png$/);
  });

  it('finds the one records file in the folder', async () => {
    const { submissionIn } = await import('./add-voyage-records.mjs');
    expect(submissionIn('f', ['1.png', 'gummy.txt'])).toMatch(/gummy\.txt$/);
    expect(submissionIn('f', ['1.png', 'README.txt', 'notes.txt', 'record text.txt'])).toMatch(/record text\.txt$/);
    expect(() => submissionIn('f', ['1.png'])).toThrow(/No .txt or .json/);
    expect(() => submissionIn('f', ['a.txt', 'b.json'])).toThrow(/More than one/);
  });
});
