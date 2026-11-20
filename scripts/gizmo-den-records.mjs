// Woodhallow duty report records from Gizmo's run exports: the most dire chests and the best forage score a
// whole crew foraged in one duty report, for each crew size. Chatlogs don't show duty reports, so these can't
// come from the Voyage Records page; Gizmo writes one .jsonl per den, one line per duty report, under the
// game's exported_data/<ocean>/runs folder.
//
//   npm run gizmo-records                        reads every run in the game's exported_data folder
//   npm run gizmo-records -- path/to/runs        a folder of runs, or one or more run_*.jsonl files
//   npm run gizmo-records -- path --dry-run      only shows what would change
//
// The records go into src/voyage-records/records.json through add-voyage-records.mjs's merge, so they follow
// the same rules as any record sent in: a duty report replaces the record for its crew size when it beats it
// (a tie keeps the older one), or is added when that crew size has none yet. The Global records page shows
// them as columns of the Woodhallow crew size table, and the records feed lists them with the other records.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeRecords } from './add-voyage-records.mjs';
import { RECORDS_FILE, readRecordsFile, writeRecordsFile } from './records-file.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ignoredPirates = new Set(JSON.parse(readFileSync(join(ROOT, 'src', 'voyage-records', 'ignored-pirates.json'), 'utf8')).map((name) => name.toLowerCase()));
const DEFAULT_EXPORTS = join(process.env.LOCALAPPDATA ?? '', 'Puzzle Pirates', 'app', 'exported_data');

/** The two categories, as records.json and the Global records page name them. */
export const CATEGORIES = {
  chests: 'Most dire chests in one DR',
  score: 'Best forage score in one DR',
};
const ORDER = [CATEGORIES.chests, CATEGORIES.score];

/**
 * Each duty report in one Gizmo run file that has someone foraging. A Foraging row's tokens are the wolf
 * boxes, lunar lockers and dire chests that pirate foraged (its score counts them 1, 2 and 3). The crew is
 * everyone on the report, navigators too, as the den's crew size records count them.
 */
export function readRun(text, file = 'run') {
  return text.split(/\r?\n/).filter((line) => line.trim()).flatMap((line) => {
    const report = JSON.parse(line);
    const rows = Array.isArray(report.rows) ? report.rows : [];
    if (rows.some((row) => ignoredPirates.has(String(row.pirate).trim().toLowerCase()))) return [];
    const foragers = rows
      .filter((row) => row.station === 'Foraging' && Array.isArray(row.tokens))
      .map((row) => ({ pirate: row.pirate, score: row.score, chests: row.tokens[2] ?? 0 }));
    if (!foragers.length || !report.ocean) return [];
    return [{
      file: basename(file),
      ocean: String(report.ocean).toLowerCase(),
      startedAt: report.started_at ?? null,
      started: report.started ?? null,
      crewSize: new Set(rows.map((row) => row.pirate)).size,
      foragers,
      chests: foragers.reduce((sum, row) => sum + row.chests, 0),
      score: foragers.reduce((sum, row) => sum + row.score, 0),
    }];
  });
}

/** The best duty report for each ocean, crew size and kind. The earliest wins a tie. */
export function bestReports(reports) {
  const best = new Map();
  const sorted = [...reports].sort((a, b) => (a.started ?? Infinity) - (b.started ?? Infinity));
  for (const report of sorted) {
    for (const kind of ['chests', 'score']) {
      const key = JSON.stringify([report.ocean, report.crewSize, kind]);
      if (!best.has(key) || report[kind] > best.get(key)[kind]) best.set(key, { ...report, kind });
    }
  }
  return [...best.values()];
}

/** A best duty report as a records.json record: each forager with their own share, biggest first. */
export function toRecord(report) {
  const share = (row) => (report.kind === 'chests' ? row.chests : row.score);
  const foragers = [...report.foragers].sort((a, b) => share(b) - share(a) || a.pirate.localeCompare(b.pirate));
  return {
    voyage: 'woodhallow',
    ocean: report.ocean,
    category: CATEGORIES[report.kind],
    crewSize: report.crewSize,
    value: report[report.kind],
    ...(report.startedAt ? { date: report.startedAt.slice(0, 10) } : {}),
    pirates: foragers.map((row) => row.pirate),
    pirateScores: foragers.map(share),
    source: `Gizmo export ${report.file}${report.startedAt ? `, duty report from ${report.startedAt.slice(11, 19)}` : ''}`,
  };
}

/** The records for the best duty reports in some runs, chests first, then by crew size. */
export function gizmoRecords(reports) {
  return bestReports(reports).map(toRecord)
    .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || a.crewSize - b.crewSize);
}

/** Every run_*.jsonl under a folder (searching its subfolders, e.g. exported_data/emerald/runs). */
function runFiles(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    if (statSync(full).isDirectory()) return runFiles(full);
    return /^run_.*\.jsonl$/i.test(name) ? [full] : [];
  });
}

function main(args) {
  const dryRun = args.includes('--dry-run');
  const paths = args.filter((arg) => !arg.startsWith('--'));
  if (!paths.length) paths.push(DEFAULT_EXPORTS);
  const files = paths.flatMap((path) => {
    if (!existsSync(path)) throw new Error(`Not found: ${path}`);
    return runFiles(path);
  });
  const reports = files.flatMap((file) => readRun(readFileSync(file, 'utf8'), file));
  console.log(`Read ${reports.length} duty reports with foraging from ${files.length} run files.`);
  const data = readRecordsFile();
  // Each record keeps its own source: the run file and duty report it came from.
  const { records, results } = mergeRecords(data.records, gizmoRecords(reports), null);
  for (const result of results) if (result.text) console.log(`  ${result.text}`);
  if (dryRun) return console.log('Dry run: nothing saved.');
  if (!results.some(({ outcome }) => outcome === 'added' || outcome === 'beaten')) return console.log('No new records.');
  writeRecordsFile({ ...data, records });
  console.log(`Saved ${RECORDS_FILE}.`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
