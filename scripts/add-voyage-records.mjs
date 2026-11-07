// Adds the records players send in to src/voyage-records/known-records.json.
//
// Players use My records > "Send N new records", which gives them a message to paste to Jice and a
// "Download all my records" file. Point this at either one, saved as a file:
//   npm run add-records -- path/to/voyage-records-2026-11-07.json
//   npm run add-records -- path/to/message.txt --dry-run
// On Windows, drag the file onto add-voyage-records.bat in the repo folder instead.
//
// Each record it replaces is kept, with the one that beat it, in voyage-records-history.jsonl next to this
// repo's package.json. That file stays on this computer: git ignores it.
//
// A record is added when the table has nothing for its voyage, ocean, crew size and kind, and replaces the
// table's record when it beats it. A tie or a lower value is left out, and the reason is printed.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TABLE = join(ROOT, 'src', 'voyage-records', 'known-records.json');
/** Every record the importer replaced or added, one JSON object per line. Kept on this computer only (it's in .gitignore). */
export const HISTORY = join(ROOT, 'voyage-records-history.jsonl');
const VOYAGES = ['woodhallow', 'cursedIsles', 'vampireLairs'];
const VOYAGE_NAMES = { woodhallow: 'Woodhallow', cursedIsles: 'Cursed Isles', vampireLairs: 'Vampire Lairs' };
const TOP_CHESTS = { woodhallow: 'dire chests', cursedIsles: 'cursed chests', vampireLairs: 'immortal chests' };
/** As MAX_SENT_CREW in src/voyage-records/known-records.ts: bigger crews' records aren't kept from sends. */
const MAX_CREW = { woodhallow: 12, cursedIsles: 7, vampireLairs: 12 };
const MARKER = 'Data for the records table:';

/**
 * The records in what a player sent: the downloaded export ({ records: [...] }), a bare JSON list, or the
 * copied message, whose last part after "Data for the records table:" is a JSON list.
 */
export function readSubmission(text) {
  const trimmed = text.replace(/^﻿/, '').trim();
  const at = trimmed.lastIndexOf(MARKER);
  const json = at >= 0 ? trimmed.slice(at + MARKER.length).trim() : trimmed;
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error(at >= 0
      ? 'The data after "Data for the records table:" is not valid JSON. Was the message copied in full?'
      : 'This is not a records export or a copied records message.');
  }
  const records = Array.isArray(data) ? data : data?.records;
  if (!Array.isArray(records)) throw new Error('No records list found in the file.');
  return records;
}

/** Why a submitted record can't go in the table, or null when it's fine. */
export function recordProblem(record) {
  if (!record || typeof record !== 'object') return 'not a record';
  if (!VOYAGES.includes(record.voyage)) return `unknown voyage "${record.voyage}"`;
  if (typeof record.ocean !== 'string' || !/^[a-z]+$/.test(record.ocean)) return `unknown ocean "${record.ocean}"`;
  if (!Number.isInteger(record.crewSize) || record.crewSize < 1) return 'crew size is missing';
  if (record.crewSize > MAX_CREW[record.voyage]) return `crews over ${MAX_CREW[record.voyage]} aren't sent in (${record.crewSize} pirates)`;
  if (record.kind !== 'score' && record.kind !== 'chests') return `unknown kind "${record.kind}"`;
  if (!Number.isInteger(record.value) || record.value < 0) return 'value is not a whole number';
  if (record.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) return 'date is not YYYY-MM-DD';
  return null;
}

export function describe(record) {
  const ocean = `${record.ocean[0].toUpperCase()}${record.ocean.slice(1)}`;
  const what = record.kind === 'score' ? 'best score' : `most ${TOP_CHESTS[record.voyage]}`;
  return `${VOYAGE_NAMES[record.voyage]} (${ocean}), ${record.crewSize} pirate${record.crewSize === 1 ? '' : 's'}, ${what}: ${record.value}`;
}

/** The table entry for a submitted record: only the fields the table keeps. */
function tableEntry(record, source) {
  const entry = { voyage: record.voyage, ocean: record.ocean, crewSize: record.crewSize, kind: record.kind, value: record.value };
  const date = record.date ?? (typeof record.time === 'string' ? record.time.slice(0, 10) : undefined);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) entry.date = date;
  if (Array.isArray(record.pirates) && record.pirates.length) entry.pirates = record.pirates.map(String);
  entry.source = source;
  return entry;
}

/**
 * The table with the submitted records merged in, and what happened to each one. Beaten records are
 * replaced where they stand; records for a crew size the table didn't have go on the end.
 */
export function mergeRecords(table, submitted, source) {
  const records = table.map((record) => ({ ...record }));
  const results = [];
  const key = (record) => JSON.stringify([record.voyage, record.ocean, record.crewSize, record.kind]);
  for (const record of submitted) {
    const problem = recordProblem(record);
    if (problem) {
      results.push({ outcome: 'skipped', text: `Skipped a record: ${problem}` });
      continue;
    }
    const index = records.findIndex((known) => key(known) === key(record));
    const entry = tableEntry(record, source);
    if (index < 0) {
      records.push(entry);
      results.push({ outcome: 'added', text: `Added   ${describe(record)} (no record before)`, record: entry, previous: null });
    } else if (record.value > records[index].value) {
      const previous = records[index];
      records[index] = entry;
      results.push({ outcome: 'beaten', text: `Beaten  ${describe(record)} (was ${previous.value})`, record: entry, previous });
    } else {
      const why = record.value === records[index].value ? 'ties the record' : `record is ${records[index].value}`;
      results.push({ outcome: 'kept', text: `Kept    ${describe(record)} (${why})` });
    }
  }
  return { records, results };
}

/** History lines for the changes in a merge: when, what came in, and the record it replaced. */
export function historyLines(results, from, at = new Date()) {
  return results
    .filter((result) => result.outcome === 'added' || result.outcome === 'beaten')
    .map((result) => `${JSON.stringify({ changedAt: at.toISOString(), outcome: result.outcome, from, record: result.record, previous: result.previous })}\n`)
    .join('');
}

/** The table as the repo keeps it: one record per line. */
export function formatTable(records) {
  return `{\n  "records": [\n${records.map((record) => `    ${JSON.stringify(record)}`).join(',\n')}\n  ]\n}\n`;
}

function main(args) {
  const dryRun = args.includes('--dry-run');
  const files = args.filter((arg) => !arg.startsWith('--'));
  if (!files.length) {
    console.error('Usage: npm run add-records -- <export .json or message .txt> [more files] [--dry-run]');
    process.exit(1);
  }
  let table = JSON.parse(readFileSync(TABLE, 'utf8')).records;
  let changed = 0;
  let history = '';
  for (const file of files) {
    const path = resolve(file);
    console.log(`\n${path}`);
    let submitted;
    try {
      submitted = readSubmission(readFileSync(path, 'utf8'));
    } catch (error) {
      console.error(`  ${error.code === 'ENOENT' ? 'File not found.' : error.message}`);
      process.exitCode = 1;
      continue;
    }
    const pirates = [...new Set(submitted.flatMap((record) => record?.pirates ?? []))];
    const source = `Sent in ${new Date().toISOString().slice(0, 10)}${pirates.length ? ` by ${pirates.slice(0, 3).join(', ')}${pirates.length > 3 ? ' and crew' : ''}` : ''}`;
    const merged = mergeRecords(table, submitted, source);
    table = merged.records;
    for (const result of merged.results) console.log(`  ${result.text}`);
    history += historyLines(merged.results, path);
    changed += merged.results.filter((result) => result.outcome === 'added' || result.outcome === 'beaten').length;
  }
  if (!changed) {
    console.log('\nNothing new to add.');
  } else if (dryRun) {
    console.log(`\n${changed} record${changed === 1 ? '' : 's'} would change. Run again without --dry-run to save.`);
  } else {
    writeFileSync(TABLE, formatTable(table));
    appendFileSync(HISTORY, history);
    console.log(`\nSaved ${changed} record${changed === 1 ? '' : 's'} to src/voyage-records/known-records.json. Commit and push to put them live.`);
    console.log(`The records they replaced are kept in ${HISTORY}.`);
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
