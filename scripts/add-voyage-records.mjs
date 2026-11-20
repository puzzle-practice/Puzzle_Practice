// Adds records to src/voyage-records/records.json, the one file that holds every global voyage record.
//
// It takes a JSON list of records in records.json's own shape, any category (see docs/records-format.md),
// on its own or after a "Data for the records:" line. That is what My records > "Send N new records" gives
// players to paste to Jice, and what its "Download all my records" file holds. Older messages and files
// ("Data for the records table:", records with "kind" instead of "category") are read too.
//   npm run add-records -- path/to/voyage-records-2026-11-07.json
//   npm run add-records -- path/to/message.txt --dry-run
//   npm run add-records -- path/to/folder
// On Windows, drag the file (or folder) onto add-voyage-records.bat in the repo folder instead.
//
// A folder holds one send-in: the message or export as the only .txt or .json in it, plus the pictures,
// images and videos sent with it, named by the record's number in the message (1.png, 2.jpg, 2-b.png,
// 3.mp4...). A picture whose name doesn't start with a number goes with every record in the file. The
// pictures are copied into public/voyage-records/screenshots/<voyage>/sent/ and set on their record, so
// Global records shows them. See docs/voyage-records-screenshots.md.
//
// It saves the records on a new branch off the latest main, pushes it, and opens a pull request: with the
// GitHub CLI (gh) when it's installed and signed in, else through GitHub's API with the sign-in git pushes with,
// else on GitHub's page in the browser. --no-pr just saves them here; --dry-run only shows what would change.
//
// Each record it replaces is kept, with the one that beat it, in voyage-records-history.jsonl next to this
// repo's package.json. That file stays on this computer: git ignores it.
//
// A record is added when the file has nothing for its voyage, ocean, category and crew size (and forage, for
// "Most points in one forage"), and replaces what's there when its value is higher. A tie or a lower value is
// left out, and the reason is printed.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEN_CATEGORIES, RECORDS_FILE, VOYAGES, denKind, formatRecordsFile, readRecordsFile, tidy, writeRecordsFile } from './records-file.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ignoredPirates = new Set(JSON.parse(readFileSync(join(ROOT, 'src', 'voyage-records', 'ignored-pirates.json'), 'utf8')).map((name) => name.toLowerCase()));
const excludedRuns = JSON.parse(readFileSync(join(ROOT, 'src', 'voyage-records', 'excluded-runs.json'), 'utf8'));
export { RECORDS_FILE };
const PUBLIC = join(ROOT, 'public');
const SHOT_DIRS = { woodhallow: 'woodhallow', cursedIsles: 'cursed-isles', vampireLairs: 'vampire-lairs' };
const PICTURE = /\.(png|jpe?g|gif|webp|mp4|webm|mov|m4v)$/i;
/** GitHub refuses files over 100 MB, so a bigger video can't go in the repo. */
const MAX_FILE_MB = 95;
/** Every record the importer replaced or added, one JSON object per line. Kept on this computer only (it's in .gitignore). */
export const HISTORY = join(ROOT, 'voyage-records-history.jsonl');
const VOYAGE_NAMES = { woodhallow: 'Woodhallow', cursedIsles: 'Cursed Isles', vampireLairs: 'Vampire Lairs' };
/** As MAX_SENT_CREW in src/voyage-records/known-records.ts: bigger crews' den records aren't kept from sends. */
const MAX_CREW = { woodhallow: 12, cursedIsles: 7, vampireLairs: 12 };
/** The line before the data in a copied message, now and in older messages. */
const MARKER = /Data for the (?:records table|sheet records|records):/g;

/**
 * The records in what was sent: the downloaded export ({ records: [...] }), a bare JSON list, or a copied
 * message, whose last part after "Data for the records:" is a JSON list.
 */
export function readSubmission(text) {
  const trimmed = text.replace(/^﻿/, '').trim();
  const markers = [...trimmed.matchAll(MARKER)];
  const last = markers.at(-1);
  const json = last ? trimmed.slice(last.index + last[0].length).trim() : trimmed;
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error(last
      ? `The data after "${last[0]}" is not valid JSON. Was the message copied in full?`
      : 'This is not a records export or a copied records message.');
  }
  const records = Array.isArray(data) ? data : data?.records;
  if (!Array.isArray(records)) throw new Error('No records list found in the file.');
  return records;
}

/**
 * A sent record in records.json's shape: an older export's "kind" becomes its category, a value written as
 * text becomes a number, and the date comes from the time when it's missing. "standing" is dropped.
 */
export function normalise(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  const { kind, standing: _standing, ...out } = record;
  if (out.category === undefined && kind !== undefined) out.category = DEN_CATEGORIES[out.voyage]?.[kind] ?? `kind "${kind}"`;
  if (typeof out.value === 'string' && /^\d+$/.test(out.value.trim())) out.value = Number(out.value);
  if (out.date === undefined && typeof out.time === 'string') out.date = out.time.slice(0, 10);
  return out;
}

function hasIgnoredCrew(record) {
  return Array.isArray(record?.pirates) && record.pirates.some((pirate) => ignoredPirates.has(String(pirate).trim().toLowerCase()));
}

/** Why a record (as normalise gives it) can't go in the file, or null when it's fine. */
export function recordProblem(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return 'not a record';
  if (!VOYAGES.includes(record.voyage)) return `unknown voyage "${record.voyage}"`;
  if (typeof record.ocean !== 'string' || !/^[a-z]+$/.test(record.ocean)) return `unknown ocean "${record.ocean}"`;
  if (typeof record.category !== 'string' || !record.category.trim()) return 'category is missing';
  if (record.category.startsWith('kind "')) return `unknown ${record.category}`;
  const den = denKind(record);
  if (den && record.crewSize === undefined) return 'crew size is missing';
  if (record.crewSize !== undefined && (!Number.isInteger(record.crewSize) || record.crewSize < 1)) return 'crew size is not a whole number';
  if (den && record.crewSize > MAX_CREW[record.voyage]) return `crews over ${MAX_CREW[record.voyage]} aren't sent in (${record.crewSize} pirates)`;
  if (!Number.isInteger(record.value) || record.value < 0) return 'value is not a whole number';
  if (record.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) return 'date is not YYYY-MM-DD';
  if (hasIgnoredCrew(record)) return 'record is not eligible';
  if (den && excludedRuns.some((run) => record.voyage === run.expedition && record.ocean === run.ocean && record.crewSize === run.crewSize &&
    record.date === run.date && Array.isArray(record.loot) && record.loot.length === run.loot.length &&
    record.loot.every((amount, index) => amount === run.loot[index]) && Array.isArray(record.pirates) && record.pirates.length === run.players.length &&
    run.players.every((pirate) => record.pirates.some((name) => String(name).toLowerCase() === pirate.toLowerCase())))) return 'this reviewed voyage is excluded from global records';
  return null;
}

export function describe(record) {
  const ocean = `${record.ocean[0].toUpperCase()}${record.ocean.slice(1)}`;
  const crew = record.crewSize === undefined ? '' : `${record.crewSize} pirate${record.crewSize === 1 ? '' : 's'}, `;
  const what = `${record.category[0].toLowerCase()}${record.category.slice(1)}`;
  const forage = forageOf(record) ? ` (${record.notes})` : '';
  return `${VOYAGE_NAMES[record.voyage]} (${ocean}), ${crew}${what}${forage}: ${record.value}`;
}

/** "Most points in one forage" keeps a record per forage, named in notes ("Forage 3"). */
function forageOf(record) {
  return typeof record.notes === 'string' && /^Forage \d+$/.test(record.notes) ? record.notes : null;
}

/** Records in the same slot compete: same voyage, ocean, category, crew size (or none) and forage. */
export function slotKey(record) {
  return JSON.stringify([record.voyage, record.ocean, record.category, record.crewSize ?? null, forageOf(record)]);
}

/** Where a record for a new slot goes: after its category's smaller crews, else at the start of its category, else after its voyage. */
function insertAt(records, record) {
  const sameCategory = (known) => known.voyage === record.voyage && known.ocean === record.ocean && known.category === record.category;
  const lastIndex = (test) => records.reduce((found, known, index) => (test(known) ? index : found), -1);
  let after = lastIndex((known) => sameCategory(known) && (known.crewSize ?? 0) < (record.crewSize ?? 0));
  if (after < 0) {
    const first = records.findIndex(sameCategory);
    after = first >= 0 ? first - 1 : lastIndex((known) => known.voyage === record.voyage);
  }
  return after < 0 ? records.length : after + 1;
}

/**
 * The records with the sent ones merged in, and what happened to each one. A record that beats its slot
 * replaces it where it stands (ties held there go with it); a record for a new slot goes in with its category.
 * source replaces each sent record's own; null keeps theirs.
 */
export function mergeRecords(table, submitted, source) {
  const records = table.map((record) => ({ ...record }));
  const results = [];
  for (const [number, sent] of submitted.map((record, index) => [index + 1, record])) {
    const record = normalise(sent);
    const problem = recordProblem(record);
    if (problem) {
      results.push({ number, outcome: 'skipped', text: hasIgnoredCrew(record) ? '' : `Skipped a record: ${problem}` });
      continue;
    }
    const entry = tidy({ ...record, source: source ?? record.source });
    const key = slotKey(record);
    const held = records.flatMap((known, index) => (slotKey(known) === key ? [index] : []));
    if (!held.length) {
      records.splice(insertAt(records, record), 0, entry);
      results.push({ number, outcome: 'added', text: `Added   ${describe(record)} (no record before)`, record: entry, previous: null });
      continue;
    }
    const best = Math.max(...held.map((index) => records[index].value));
    if (record.value > best) {
      const replaced = held.map((index) => records[index]);
      records[held[0]] = entry;
      for (const index of held.slice(1).reverse()) records.splice(index, 1);
      results.push({ number, outcome: 'beaten', text: `Beaten  ${describe(record)} (was ${best})`, record: entry, previous: replaced[0], replaced });
    } else {
      const tie = record.value === best ? records[held.find((index) => records[index].value === best)] : undefined;
      results.push({ number, outcome: 'kept', text: `Kept    ${describe(record)} (${tie ? 'ties the record' : `record is ${best}`})`, ...(tie ? { tie } : {}) });
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

export { formatRecordsFile };

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
 * the shared ones. A record that ties gets them too when the record already there has none yet, so pictures
 * sent after the record went up can still be added. Returns { number, record, names } per record.
 */
export function picturesFor(results, pictures) {
  const plan = [];
  for (const result of results) {
    const names = [...(pictures.byNumber.get(result.number) ?? []), ...pictures.shared];
    if (!names.length) continue;
    if (result.outcome === 'added' || result.outcome === 'beaten') plan.push({ number: result.number, record: result.record, names });
    else if (result.tie && !result.tie.screenshot && !result.tie.videoUrl) plan.push({ number: result.number, record: result.tie, names, late: true });
  }
  return plan;
}

/** Where a picture is copied to, under public/: the voyage's sent/ folder, named for the record and the file's contents. */
export function picturePath(record, bytes, name) {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const crew = record.crewSize === undefined ? '' : `-${record.crewSize}p`;
  return `voyage-records/screenshots/${SHOT_DIRS[record.voyage]}/sent/${record.ocean}${crew}-${hash}${extname(name).toLowerCase().replace('.jpeg', '.jpg')}`;
}

/** A record's picture fields: the first picture, then the rest. */
export function screenshotEntry(paths) {
  return paths.length > 1 ? { screenshot: paths[0], more: paths.slice(1) } : { screenshot: paths[0] };
}

/** Every saved file a record points to. */
function recordFiles(record) {
  return [record?.screenshot, ...(record?.more ?? [])].filter(Boolean);
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
 * Copies a folder's pictures into public/ and sets them on their records (the record objects in the merge's
 * results, which are the ones in the merged list). A beaten record's pictures go with it, and are deleted when
 * this script saved them and nothing else uses them. Returns the files to commit and what to print.
 */
function savePictures(folder, results, records) {
  const notes = [];
  const added = [];
  const pictures = folder ? sortPictures(readdirSync(folder)) : { byNumber: new Map(), shared: [] };
  const plan = picturesFor(results, pictures);
  const planned = new Set(plan.map((item) => item.number));
  const dropped = [];
  for (const result of results) {
    if (result.outcome !== 'beaten') continue;
    const old = (result.replaced ?? [result.previous]).flatMap(recordFiles);
    dropped.push(...old);
    if (old.length && !planned.has(result.number)) notes.push(`  Record ${result.number} has no picture: the old one was taken off, as it shows the beaten record.`);
  }
  let changed = false;
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
    delete item.record.more;
    Object.assign(item.record, screenshotEntry(paths));
    changed = true;
    notes.push(`  Record ${item.number}: ${item.names.join(', ')}${item.late ? ' (added to the record already there)' : ''}`);
  }
  const unused = new Set(results.filter((result) => result.number && !planned.has(result.number)).map((result) => result.number));
  for (const [number, names] of pictures.byNumber) {
    if (unused.has(number) || !results.some((result) => result.number === number)) notes.push(`  Not used: ${names.join(', ')} (record ${number} ${results.some((result) => result.number === number) ? 'was not added' : 'is not in the file'})`);
  }
  const stillUsed = new Set(records.flatMap(recordFiles));
  const removed = [];
  for (const path of dropped) {
    if (!/\/sent\//.test(path) || stillUsed.has(path)) continue;
    const file = join(PUBLIC, path);
    if (existsSync(file)) {
      rmSync(file);
      removed.push(file);
    }
  }
  return { added, removed, notes, changed };
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
    console.error('Usage: npm run add-records -- <records .json, message .txt, or a folder with one and its pictures> [more] [--dry-run] [--no-pr]');
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
  const data = readRecordsFile();
  let table = data.records;
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
    for (const result of merged.results) if (result.text) console.log(`  ${result.text}`);
    if (dryRun) {
      const plan = folder ? picturesFor(merged.results, sortPictures(readdirSync(folder))) : [];
      for (const item of plan) console.log(`  Record ${item.number} would get ${item.names.join(', ')}`);
      picturesChanged ||= plan.length > 0;
    } else {
      const saved = savePictures(folder, merged.results, merged.records);
      if (saved.notes.length) console.log(`  Pictures:\n${saved.notes.join('\n')}`);
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
  writeRecordsFile({ ...data, records: table });
  if (changed) {
    appendFileSync(HISTORY, history);
    console.log(`\nSaved ${count} to src/voyage-records/records.json.`);
    console.log(`The records they replaced are kept in ${HISTORY}.`);
  }
  if (picturesChanged) console.log(`Saved ${pictureFiles.length} picture${pictureFiles.length === 1 ? '' : 's'} for Global records.`);
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
    git('add', RECORDS_FILE, ...pictureFiles, ...removedFiles);
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
