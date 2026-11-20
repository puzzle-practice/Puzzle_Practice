// Reading and writing src/voyage-records/records.json, the one file that holds every global voyage record.
// add-voyage-records.mjs and gizmo-den-records.mjs both save through here, so the file keeps one layout:
// one record per line, its fields always in the same order. docs/records-format.md describes the fields.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RECORDS_FILE = join(ROOT, 'src', 'voyage-records', 'records.json');

export const VOYAGES = ['woodhallow', 'cursedIsles', 'vampireLairs'];

/**
 * The categories of the records kept for every crew size from chatlogs, as DEN_CATEGORIES in
 * src/voyage-records/global-records.ts: "score" counts chests 3, 2 and 1 (1 each for Vampire Lairs),
 * "chests" counts tier 3 chests only.
 */
export const DEN_CATEGORIES = {
  woodhallow: { score: 'Best score', chests: 'Most dire chests' },
  cursedIsles: { score: 'Best score', chests: 'Most cursed chests' },
  vampireLairs: { score: 'Best score', chests: 'Most immortal chests' },
};

/** "score" or "chests" for a den record, else null. */
export function denKind(record) {
  const categories = DEN_CATEGORIES[record?.voyage];
  if (!categories) return null;
  return record.category === categories.score ? 'score' : record.category === categories.chests ? 'chests' : null;
}

/** Every field a record can have, in the order the file writes them. */
export const FIELDS = [
  'voyage', 'ocean', 'category', 'crewSize', 'value', 'date', 'time', 'pirates', 'pirateScores', 'loot',
  'everyone', 'screenshot', 'screenshotUrl', 'videoUrl', 'more', 'notes', 'source',
];

/** A record with its known fields in file order and nothing else (an empty list or missing value is left out). */
export function tidy(record) {
  const out = {};
  for (const field of FIELDS) {
    const value = record[field];
    if (value === undefined || value === null || (Array.isArray(value) && !value.length)) continue;
    out[field] = value;
  }
  return out;
}

/** The file as the repo keeps it: its details, then one record per line. */
export function formatRecordsFile({ fetched, sources = [], records = [] }) {
  const list = (items) => items.map((item) => `    ${JSON.stringify(item)}`).join(',\n');
  return [
    '{',
    ...(fetched ? [`  "fetched": ${JSON.stringify(fetched)},`] : []),
    `  "sources": [\n${list(sources)}\n  ],`,
    `  "records": [\n${list(records.map(tidy))}\n  ]`,
    '}',
    '',
  ].join('\n');
}

export function readRecordsFile(path = RECORDS_FILE) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
}

export function writeRecordsFile(data, path = RECORDS_FILE) {
  writeFileSync(path, formatRecordsFile(data));
}
