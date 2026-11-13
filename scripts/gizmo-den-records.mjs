// Woodhallow duty report records from Gizmo's run exports: the most dire chests and the best forage score a
// whole crew foraged in one duty report, for each crew size. Chatlogs don't show duty reports, so these can't
// come from the Voyage Records page; Gizmo writes one .jsonl per den, one line per duty report, under the
// game's exported_data/<ocean>/runs folder.
//
//   npm run gizmo-records                        reads every run in the game's exported_data folder
//   npm run gizmo-records -- path/to/runs        a folder of runs, or one or more run_*.jsonl files
//   npm run gizmo-records -- path --dry-run      only shows what would change
//
// A duty report's record replaces the one in src/voyage-records/sheet-records.json when it beats it (a tie
// keeps the older one), or is added when that crew size has none yet. The Global records page shows them as
// columns of the Woodhallow crew size table, and the records feed lists them with the other sheet records.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SHEET = join(ROOT, 'src', 'voyage-records', 'sheet-records.json');
const DEFAULT_EXPORTS = join(process.env.LOCALAPPDATA ?? '', 'Puzzle Pirates', 'app', 'exported_data');

/** The two categories, as sheet-records.json and the Global records page name them. */
export const CATEGORIES = {
  chests: 'Most dire chests in one DR',
  score: 'Best forage score in one DR',
};

/**
 * Each duty report in one Gizmo run file that has someone foraging. A Foraging row's tokens are the wolf
 * boxes, lunar lockers and dire chests that pirate foraged (its score counts them 1, 2 and 3). The crew is
 * everyone on the report, navigators too, as the den's crew size records count them.
 */
export function readRun(text, file = 'run') {
  return text.split(/\r?\n/).filter((line) => line.trim()).flatMap((line) => {
    const report = JSON.parse(line);
    const rows = Array.isArray(report.rows) ? report.rows : [];
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

/** A best duty report as a sheet-records.json record: each forager with their own share, biggest first. */
export function toSheetRecord(report) {
  const share = (row) => (report.kind === 'chests' ? row.chests : row.score);
  const foragers = [...report.foragers].sort((a, b) => share(b) - share(a) || a.pirate.localeCompare(b.pirate));
  return {
    voyage: 'woodhallow',
    ocean: report.ocean,
    category: CATEGORIES[report.kind],
    crewSize: report.crewSize,
    value: String(report[report.kind]),
    ...(report.startedAt ? { date: report.startedAt.slice(0, 10) } : {}),
    pirates: foragers.map((row) => row.pirate),
    pirateScores: foragers.map(share),
    source: `Gizmo export ${report.file}${report.startedAt ? `, duty report from ${report.startedAt.slice(11, 19)}` : ''}`,
  };
}

/** One value as sheet-records.json writes it: JSON with a space after each colon and comma. */
function sheetValue(value) {
  if (Array.isArray(value)) return `[${value.map(sheetValue).join(', ')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${sheetValue(item)}`).join(', ')}}`;
  return JSON.stringify(value);
}

const ORDER = [CATEGORIES.chests, CATEGORIES.score];
const sameRecord = (a, b) => a.voyage === b.voyage && a.ocean === b.ocean && a.category === b.category && a.crewSize === b.crewSize;

/**
 * sheet-records.json with these records merged in, and what changed. A record replaces the one for its
 * category, ocean and crew size when its value is higher, and is added after the rest of its category (or
 * the voyage's other records) when there is none. Every other line is left as it was.
 */
export function mergeIntoSheet(text, candidates) {
  // Git can check the file out with Windows line endings: keep whichever it has.
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '"records": [');
  const end = lines.findIndex((line, index) => index > start && line.trim().startsWith(']'));
  if (start < 0 || end < 0) throw new Error('Could not find the records list in sheet-records.json.');
  const rows = lines.slice(start + 1, end).map((line) => ({ line: line.replace(/,\s*$/, ''), record: JSON.parse(line.replace(/,\s*$/, '')) }));
  const changes = [];
  for (const record of candidates) {
    const at = rows.findIndex((row) => sameRecord(row.record, record));
    const line = `    ${sheetValue(record)}`;
    if (at >= 0) {
      const old = rows[at].record;
      if (Number(record.value) <= Number(old.value)) {
        changes.push({ record, change: Number(record.value) === Number(old.value) ? 'tie' : 'lower', old });
        continue;
      }
      rows[at] = { line, record };
      changes.push({ record, change: 'beat', old });
      continue;
    }
    const lastIndex = (test) => rows.reduce((found, row, index) => (test(row.record) ? index : found), -1);
    const sameCategory = (row) => row.voyage === record.voyage && row.ocean === record.ocean && row.category === record.category;
    const first = rows.findIndex((row) => sameCategory(row.record));
    let after = lastIndex((row) => sameCategory(row) && row.crewSize < record.crewSize);
    // Smaller than every crew size in its category, it goes first; a new category goes after the voyage's other records.
    if (after < 0) after = first >= 0 ? first - 1 : lastIndex((row) => row.voyage === record.voyage);
    rows.splice(after + 1, 0, { line, record });
    changes.push({ record, change: 'new', old: null });
  }
  const body = rows.map((row, index) => `${row.line}${index < rows.length - 1 ? ',' : ''}`);
  return { text: [...lines.slice(0, start + 1), ...body, ...lines.slice(end)].join(eol), changes };
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
  const candidates = bestReports(reports).map(toSheetRecord)
    .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || a.crewSize - b.crewSize);
  const { text, changes } = mergeIntoSheet(readFileSync(SHEET, 'utf8'), candidates);
  for (const { record, change, old } of changes) {
    const what = `${record.category}, ${record.crewSize} pirate${record.crewSize === 1 ? '' : 's'} (${record.ocean}): ${record.value} on ${record.date ?? '?'}`;
    const note = { new: 'new', beat: `beats ${old?.value}`, tie: `ties ${old?.value}, kept the older one`, lower: `below ${old?.value}, left out` }[change];
    console.log(`  ${what} (${note})`);
  }
  if (dryRun) return console.log('Dry run: nothing saved.');
  if (!changes.some(({ change }) => change === 'new' || change === 'beat')) return console.log('No new records.');
  writeFileSync(SHEET, text);
  console.log(`Saved ${SHEET}.`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
