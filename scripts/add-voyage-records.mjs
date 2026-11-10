// Adds the records players send in to src/voyage-records/known-records.json.
//
// Players use My records > "Send N new records", which gives them a message to paste to Jice and a
// "Download all my records" file. Point this at either one, saved as a file:
//   npm run add-records -- path/to/voyage-records-2026-11-07.json
//   npm run add-records -- path/to/message.txt --dry-run
//   npm run add-records -- path/to/folder
// On Windows, drag the file (or folder) onto add-voyage-records.bat in the repo folder instead.
//
// A folder holds one player's send-in: their message or export as the only .txt or .json in it, plus the
// pictures, images and videos they sent, named by the record's number in the message (1.png, 2.jpg,
// 2-b.png, 3.mp4...). A picture whose name doesn't start with a number goes with every record in the file.
// The pictures are copied into public/voyage-records/screenshots/<voyage>/sent/ and listed for their record
// in src/voyage-records/sheet-records.json, so Global records shows them. See docs/voyage-records-screenshots.md.
//
// It saves the records on a new branch off the latest main, pushes it, and opens a pull request: with the
// GitHub CLI (gh) when it's installed and signed in, else through GitHub's API with the sign-in git pushes with,
// else on GitHub's page in the browser. --no-pr just saves them here; --dry-run only shows what would change.
//
// Each record it replaces is kept, with the one that beat it, in voyage-records-history.jsonl next to this
// repo's package.json. That file stays on this computer: git ignores it.
//
// A record is added when the table has nothing for its voyage, ocean, crew size and kind, and replaces the
// table's record when it beats it. A tie or a lower value is left out, and the reason is printed.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TABLE = join(ROOT, 'src', 'voyage-records', 'known-records.json');
/** Where the Global records page looks up each crew-size record's screenshots (its "screenshots" part). */
export const SHEET = join(ROOT, 'src', 'voyage-records', 'sheet-records.json');
const PUBLIC = join(ROOT, 'public');
const SHOT_DIRS = { woodhallow: 'woodhallow', cursedIsles: 'cursed-isles', vampireLairs: 'vampire-lairs' };
const PICTURE = /\.(png|jpe?g|gif|webp|mp4|webm|mov|m4v)$/i;
/** GitHub refuses files over 100 MB, so a bigger video can't go in the repo. */
const MAX_FILE_MB = 95;
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
  for (const [number, record] of submitted.map((sent, index) => [index + 1, sent])) {
    const problem = recordProblem(record);
    if (problem) {
      results.push({ number, outcome: 'skipped', text: `Skipped a record: ${problem}` });
      continue;
    }
    const index = records.findIndex((known) => key(known) === key(record));
    const entry = tableEntry(record, source);
    if (index < 0) {
      records.push(entry);
      results.push({ number, outcome: 'added', text: `Added   ${describe(record)} (no record before)`, record: entry, previous: null });
    } else if (record.value > records[index].value) {
      const previous = records[index];
      records[index] = entry;
      results.push({ number, outcome: 'beaten', text: `Beaten  ${describe(record)} (was ${previous.value})`, record: entry, previous });
    } else {
      const why = record.value === records[index].value ? 'ties the record' : `record is ${records[index].value}`;
      results.push({ number, outcome: 'kept', text: `Kept    ${describe(record)} (${why})`, ...(record.value === records[index].value ? { tie: records[index] } : {}) });
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

/** The key a crew-size record's screenshots are filed under in sheet-records.json, as recordKey in shipwide.ts. */
export function recordKey(record) {
  return `${record.voyage}/${record.ocean}/${record.crewSize}/${record.kind}`;
}

/**
 * The pictures in a send-in folder, by the record number their name starts with ("2.png", "2-b.jpg",
 * "2 (1).mp4"), plus those with no number, which go with every record. Each list is in name order.
 */
export function sortPictures(names) {
  const byNumber = new Map();
  const shared = [];
  const stem = (name) => name.slice(0, name.length - extname(name).length);
  const sorted = names.filter((name) => PICTURE.test(name)).sort((a, b) => stem(a).localeCompare(stem(b), undefined, { numeric: true }) || a.localeCompare(b));
  for (const name of sorted) {
    const match = /^(\d+)(?![\d])/.exec(name);
    if (!match) {
      shared.push(name);
      continue;
    }
    const number = Number(match[1]);
    byNumber.set(number, [...(byNumber.get(number) ?? []), name]);
  }
  return { byNumber, shared };
}

/**
 * Which pictures go with which record: every added or beaten record gets the pictures numbered for it and
 * the shared ones. A record that ties the table gets them too when the table's record has none yet, so
 * pictures sent after the record went up can still be added. Returns { number, record, names } per record.
 */
export function picturesFor(results, pictures, screenshots = {}) {
  const plan = [];
  for (const result of results) {
    const names = [...(pictures.byNumber.get(result.number) ?? []), ...pictures.shared];
    if (!names.length) continue;
    if (result.outcome === 'added' || result.outcome === 'beaten') plan.push({ number: result.number, record: result.record, names });
    else if (result.tie && !screenshots[recordKey(result.tie)]) plan.push({ number: result.number, record: result.tie, names, late: true });
  }
  return plan;
}

/** Where a picture is copied to, under public/: the voyage's sent/ folder, named for the record and the file's contents. */
export function picturePath(record, bytes, name) {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  return `voyage-records/screenshots/${SHOT_DIRS[record.voyage]}/sent/${record.ocean}-${record.crewSize}p-${hash}${extname(name).toLowerCase().replace('.jpeg', '.jpg')}`;
}

/** The screenshots entry for a record: the first picture, then the rest. */
export function screenshotEntry(paths) {
  return paths.length > 1 ? { screenshot: paths[0], more: paths.slice(1) } : { screenshot: paths[0] };
}

/** Every saved file an entry points to. */
function entryFiles(entry) {
  return [entry?.screenshot, ...(entry?.more ?? [])].filter(Boolean);
}

/** One value as sheet-records.json writes it: JSON with a space after each colon and comma. */
function sheetValue(value) {
  if (Array.isArray(value)) return `[${value.map(sheetValue).join(', ')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${sheetValue(item)}`).join(', ')}}`;
  return JSON.stringify(value);
}

/**
 * sheet-records.json with its "screenshots" part replaced, one record per line as the repo keeps it.
 * Everything above that part is left exactly as it was.
 */
export function withScreenshots(text, screenshots) {
  const lines = Object.entries(screenshots).map(([key, entry]) => `    ${JSON.stringify(key)}: ${sheetValue(entry)}`);
  const block = `"screenshots": {\n${lines.join(',\n')}\n  }`;
  const at = text.lastIndexOf('"screenshots": {');
  if (at >= 0) return `${text.slice(0, at)}${block}\n}\n`;
  const end = text.lastIndexOf('}');
  return `${text.slice(0, end).trimEnd()},\n  ${block}\n}\n`;
}

/**
 * The records file in a send-in folder: its only .txt or .json, not counting a README or notes file.
 * Throws when there's none or more than one.
 */
export function submissionIn(folder, names = readdirSync(folder)) {
  // A README or notes file kept with the pictures isn't the player's records.
  const files = names.filter((name) => /\.(txt|json)$/i.test(name) && !/^(readme|notes?)\b/i.test(name));
  if (files.length === 1) return join(folder, files[0]);
  throw new Error(files.length
    ? `More than one .txt or .json in the folder (${files.join(', ')}). Keep only the player's records file there.`
    : 'No .txt or .json records file in the folder. Save the player\'s message or export there.');
}

/**
 * Copies a folder's pictures into public/ and points each record at them in the screenshots table. A beaten
 * record's old pictures are dropped from the table, and deleted when this script saved them and nothing else
 * uses them. Returns the changed screenshots table, the files to commit, and what to print.
 */
function savePictures(folder, results, screenshots) {
  const next = { ...screenshots };
  const notes = [];
  const added = [];
  const pictures = folder ? sortPictures(readdirSync(folder)) : { byNumber: new Map(), shared: [] };
  const plan = picturesFor(results, pictures, screenshots);
  const planned = new Set(plan.map((item) => item.number));
  const dropped = [];
  for (const result of results) {
    if (result.outcome !== 'beaten') continue;
    const key = recordKey(result.record);
    if (!next[key]) continue;
    dropped.push(...entryFiles(next[key]));
    delete next[key];
    if (!planned.has(result.number)) notes.push(`  Record ${result.number} has no picture: its old screenshot was taken off, as it shows the beaten record.`);
  }
  for (const item of plan) {
    const paths = [];
    for (const name of item.names) {
      const from = join(folder, name);
      const size = statSync(from).size / 1024 / 1024;
      if (size > MAX_FILE_MB) {
        notes.push(`  Left out ${name}: at ${Math.round(size)} MB it's too big for GitHub. Upload it to YouTube and add its link as videoUrl instead.`);
        continue;
      }
      const bytes = readFileSync(from);
      const path = picturePath(item.record, bytes, name);
      if (!paths.includes(path)) paths.push(path);
      const to = join(PUBLIC, path);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      if (!added.includes(to)) added.push(to);
    }
    if (!paths.length) continue;
    next[recordKey(item.record)] = screenshotEntry(paths);
    notes.push(`  Record ${item.number}: ${item.names.join(', ')}${item.late ? ' (added to the record already on the table)' : ''}`);
  }
  const unused = new Set(results.filter((result) => result.number && !planned.has(result.number)).map((result) => result.number));
  for (const [number, names] of pictures.byNumber) {
    if (unused.has(number) || !results.some((result) => result.number === number)) notes.push(`  Not used: ${names.join(', ')} (record ${number} ${results.some((result) => result.number === number) ? 'was not added' : 'is not in the file'})`);
  }
  const stillUsed = new Set(Object.values(next).flatMap(entryFiles));
  const removed = [];
  for (const path of dropped) {
    if (!/\/sent\//.test(path) || stillUsed.has(path)) continue;
    const file = join(PUBLIC, path);
    if (existsSync(file)) {
      rmSync(file);
      removed.push(file);
    }
  }
  return { screenshots: next, added, removed, notes, changed: JSON.stringify(next) !== JSON.stringify(screenshots) };
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** owner/repo from a GitHub remote URL, or null. */
export function githubRepo(url) {
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

/** A new branch off the latest main for the records, or a reason it can't be made. */
function startBranch() {
  if (git('status', '--porcelain')) throw new Error(`there are uncommitted changes in ${ROOT}`);
  const previous = git('rev-parse', '--abbrev-ref', 'HEAD');
  git('fetch', 'origin', 'main');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const branch = `records/${stamp}`;
  git('checkout', '-b', branch, 'origin/main');
  return { branch, previous };
}

/** Back to the branch the run started on, brought up to date when it's main. */
function returnTo(previous) {
  git('checkout', previous);
  if (previous === 'main') {
    try {
      git('merge', '--ff-only', 'origin/main');
    } catch {
      // main has its own commits: leave it as it is.
    }
  }
}

function openInBrowser(url) {
  const [command, args] = process.platform === 'win32' ? ['explorer', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // The URL is printed too.
  }
}

/** The GitHub sign-in git already has saved for github.com, without ever prompting for one. */
function savedGithubToken() {
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      cwd: ROOT,
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    });
    return /^password=(.+)$/m.exec(out)?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

/** Creates the pull request through GitHub's API with git's saved sign-in, or returns null if it can't. */
async function apiPullRequest(repo, branch, title, body) {
  const token = savedGithubToken();
  if (!token) return null;
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'add-voyage-records' },
      body: JSON.stringify({ title, head: branch, base: 'main', body }),
    });
    if (!response.ok) return null;
    return (await response.json()).html_url ?? null;
  } catch {
    return null;
  }
}

/**
 * Opens the pull request: with the GitHub CLI where it's installed and signed in, else through GitHub's API
 * with the sign-in git uses to push, else on GitHub's new pull request page in the browser.
 */
async function openPullRequest(branch, title, body) {
  try {
    const url = execFileSync('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body', body], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    console.log(`Opened a pull request: ${url.split('\n').at(-1)}`);
    return;
  } catch {
    // No gh, or not signed in: try the API next.
  }
  const repo = githubRepo(git('remote', 'get-url', 'origin'));
  if (!repo) {
    console.log(`Pushed ${branch}. Open a pull request for it on GitHub.`);
    return;
  }
  const opened = await apiPullRequest(repo, branch, title, body);
  if (opened) {
    console.log(`Opened a pull request: ${opened}`);
    openInBrowser(opened);
    return;
  }
  const url = `https://github.com/${repo}/compare/main...${encodeURIComponent(branch)}?expand=1&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  console.log(`Pushed ${branch}. Finish the pull request in your browser:\n${url}`);
  openInBrowser(url);
}

async function main(args) {
  const dryRun = args.includes('--dry-run');
  const files = args.filter((arg) => !arg.startsWith('--'));
  if (!files.length) {
    console.error('Usage: npm run add-records -- <export .json, message .txt, or a folder with one and its pictures> [more] [--dry-run] [--no-pr]');
    process.exit(1);
  }
  // Unless told not to, the records go on a new branch off the latest main and into a pull request.
  let pr = null;
  if (!dryRun && !args.includes('--no-pr')) {
    try {
      pr = startBranch();
    } catch (error) {
      console.log(`No pull request this time (${error.message.split('\n')[0]}). Records will only be saved here.`);
    }
  }
  let table = JSON.parse(readFileSync(TABLE, 'utf8')).records;
  const sheetText = readFileSync(SHEET, 'utf8');
  let screenshots = JSON.parse(sheetText).screenshots ?? {};
  let history = '';
  const changes = [];
  const pictureFiles = [];
  const removedFiles = [];
  let picturesChanged = false;
  for (const file of files) {
    let path = resolve(file);
    let folder = null;
    console.log(`\n${path}`);
    let submitted;
    try {
      if (existsSync(path) && statSync(path).isDirectory()) {
        folder = path;
        path = submissionIn(folder);
        console.log(`  Records from ${basename(path)}`);
      }
      submitted = readSubmission(readFileSync(path, 'utf8'));
    } catch (error) {
      console.error(`  ${error.code === 'ENOENT' ? 'File not found.' : error.message}`);
      process.exitCode = 1;
      continue;
    }
    // Each record already lists its own crew, so the source only says when and in which file it came.
    const source = `Sent in ${new Date().toISOString().slice(0, 10)} (${folder ? `${basename(folder)}/` : ''}${basename(path)})`;
    const merged = mergeRecords(table, submitted, source);
    for (const result of merged.results) console.log(`  ${result.text}`);
    if (dryRun) {
      const plan = folder ? picturesFor(merged.results, sortPictures(readdirSync(folder)), screenshots) : [];
      for (const item of plan) console.log(`  Record ${item.number} would get ${item.names.join(', ')}`);
      picturesChanged ||= plan.length > 0;
    } else {
      const saved = savePictures(folder, merged.results, screenshots);
      if (saved.notes.length) console.log(`  Pictures:\n${saved.notes.join('\n')}`);
      screenshots = saved.screenshots;
      pictureFiles.push(...saved.added);
      removedFiles.push(...saved.removed);
      picturesChanged ||= saved.changed;
    }
    table = merged.records;
    history += historyLines(merged.results, path);
    changes.push(...merged.results.filter((result) => result.outcome === 'added' || result.outcome === 'beaten'));
  }
  const changed = changes.length;
  const count = changed ? `${changed} record${changed === 1 ? '' : 's'}` : 'pictures';
  if ((!changed && !picturesChanged) || dryRun) {
    console.log(changed || picturesChanged ? `\n${count} would change. Run again without --dry-run to save.` : '\nNothing new to add.');
    if (pr) {
      returnTo(pr.previous);
      git('branch', '-D', pr.branch);
    }
    return;
  }
  if (changed) {
    writeFileSync(TABLE, formatTable(table));
    appendFileSync(HISTORY, history);
    console.log(`\nSaved ${count} to src/voyage-records/known-records.json.`);
    console.log(`The records they replaced are kept in ${HISTORY}.`);
  }
  if (picturesChanged) {
    writeFileSync(SHEET, withScreenshots(sheetText, screenshots));
    console.log(`Saved ${pictureFiles.length} picture${pictureFiles.length === 1 ? '' : 's'} for Global records.`);
  }
  if (!pr) {
    console.log('Commit and push to put them live.');
    return;
  }
  const title = changed
    ? `Voyage records: ${changed === 1 ? 'a new record' : `${changed} new records`}`
    : 'Voyage records: pictures for records already on the table';
  const lines = changes.map((change) => `- ${change.text.replace(/^(Added|Beaten)\s+/, '')}`);
  if (pictureFiles.length) lines.push(`- ${pictureFiles.length} picture${pictureFiles.length === 1 ? '' : 's'} for Global records`);
  try {
    git('add', TABLE, SHEET, ...pictureFiles, ...removedFiles);
    git('commit', '-m', `${title}\n\n${lines.join('\n')}`);
    git('push', '-u', 'origin', pr.branch);
  } catch (error) {
    console.error(`\nCouldn't commit and push (${error.message.split('\n')[0]}). The records are saved on branch ${pr.branch}; push it yourself.`);
    process.exitCode = 1;
    return;
  }
  await openPullRequest(pr.branch, title, `${lines.join('\n')}\n\nAdded with add-voyage-records from ${files.map((file) => basename(file)).join(', ')}. Check the screenshots before merging.`);
  returnTo(pr.previous);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
