// Lists local and remote branches, asks which one to run, and starts it:
//   npm run pick              pick a branch and run it
//   npm run pick -- --clean   delete the copies made for earlier picks (ones with edits are kept)
// Your own folder is never checked out, reset or stashed. Any branch other than the one you
// have checked out runs from its own copy in a <this folder>-branches folder next to this one,
// made with git worktree, so uncommitted changes here stay exactly as they are.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

const isWindows = process.platform === 'win32';

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function tryGit(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

function run(command, args, cwd) {
  // npm is npm.cmd on Windows, which only starts through a shell.
  return new Promise((done) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: isWindows });
    child.on('exit', (code) => done(code ?? 1));
  });
}

const root = tryGit(['rev-parse', '--show-toplevel']);
if (!root) {
  console.error('Run this from inside the Puzzle Practice git folder.');
  process.exit(1);
}
// Outside this folder: Vite won't serve files under .git, and copies inside the folder would be
// picked up by this folder's own dev server and tests.
const runsDir = join(dirname(root), `${basename(root)}-branches`);

// git prints D:/... while Node gives d:\... on Windows, so compare normalised paths.
function samePath(a, b) {
  const norm = (p) => (isWindows ? resolve(p).toLowerCase() : resolve(p));
  return norm(a) === norm(b);
}

function pickerWorktrees() {
  const list = git(['worktree', 'list', '--porcelain'], root);
  return list
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
    .filter((path) => samePath(dirname(resolve(path)), runsDir));
}

if (process.argv.includes('--clean')) {
  for (const path of pickerWorktrees()) {
    // Without --force, git refuses to remove a copy that has edits, so nothing unsaved is lost.
    if (tryGit(['worktree', 'remove', path], root) === null) console.log(`Kept ${path} (it has changes).`);
    else console.log(`Removed ${path}`);
  }
  tryGit(['worktree', 'prune'], root);
  process.exit(0);
}

console.log('Fetching branches from GitHub...');
// The private repo isn't always called origin (a clone of the public repo may add it as another
// remote), so use whichever remote points at Puzzle_Practice_Private.
const remotes = git(['remote'], root).split(/\r?\n/).filter(Boolean);
const remote =
  remotes.find((r) => /puzzle_practice_private(\.git)?\/?$/i.test(tryGit(['remote', 'get-url', r], root) ?? '')) ??
  (remotes.includes('origin') ? 'origin' : remotes[0]);
if (!remote) {
  console.error('This folder has no GitHub remote to list branches from.');
  process.exit(1);
}

if (tryGit(['fetch', '--prune', remote], root) === null) console.log('Could not reach GitHub, showing the branches already known.');

const current = tryGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], root);
const format = '%(refname)%09%(objectname)%09%(committerdate:unix)%09%(committerdate:relative)';
const refs = git(['for-each-ref', `--format=${format}`, 'refs/heads', `refs/remotes/${remote}`], root)
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const [ref, sha, time, ago] = line.split('\t');
    return { ref, sha, time: Number(time), ago };
  })
  .filter((r) => r.ref !== `refs/remotes/${remote}/HEAD`);

// One entry per branch name. When a branch exists both here and on GitHub, run whichever is
// newer: GitHub's when the local one is just behind it, the local one otherwise.
const branches = new Map();
for (const r of refs) {
  const local = r.ref.startsWith('refs/heads/');
  const name = local ? r.ref.slice('refs/heads/'.length) : r.ref.slice(`refs/remotes/${remote}/`.length);
  const entry = branches.get(name) ?? { name };
  entry[local ? 'local' : 'remote'] = r;
  branches.set(name, entry);
}
for (const b of branches.values()) {
  const remoteIsAhead =
    b.local && b.remote && b.local.sha !== b.remote.sha &&
    tryGit(['merge-base', '--is-ancestor', b.local.sha, b.remote.sha], root) !== null;
  b.use = !b.local || remoteIsAhead ? b.remote : b.local;
  b.where = !b.local ? 'GitHub only' : !b.remote ? 'local only' : b.local.sha === b.remote.sha ? '' : remoteIsAhead ? 'GitHub is newer' : 'local differs from GitHub';
}
const list = [...branches.values()].sort((a, b) => b.use.time - a.use.time);

const width = Math.max(...list.map((b) => b.name.length));
list.forEach((b, i) => {
  const mark = b.name === current ? '*' : ' ';
  const note = [b.use.ago, b.name === current ? 'checked out here' : '', b.where].filter(Boolean).join(', ');
  console.log(`${String(i + 1).padStart(3)}) ${mark} ${b.name.padEnd(width)}  ${note}`);
});

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question('\nWhich branch? Type its number (Enter to cancel): ')).trim();
rl.close();
const chosen = list[Number(answer) - 1];
if (!answer || !chosen) {
  console.log(answer ? 'No branch with that number.' : 'Cancelled.');
  process.exit(answer ? 1 : 0);
}

let dir = root;
if (chosen.name === current) {
  // Already checked out: run this folder, uncommitted edits included. When GitHub's copy is just
  // ahead of it, move it forward first; git refuses if that would overwrite a file with edits.
  if (chosen.use === chosen.remote && chosen.local) {
    console.log(`\nGitHub has a newer ${chosen.name}, updating this folder to it.`);
    if (tryGit(['merge', '--ff-only', '--quiet', chosen.remote.sha], root) === null) {
      console.log('It could not be updated because files it changes have edits here, so it runs as it is.');
    }
  } else {
    console.log(`\n${chosen.name} is checked out here, running this folder as it is.`);
  }
} else {
  dir = join(runsDir, chosen.name.replace(/[^\w.-]+/g, '_'));
  const sha = chosen.use.sha;
  if (!existsSync(dir)) {
    console.log(`\nMaking a separate copy of ${chosen.name} in ${dir}`);
    tryGit(['worktree', 'prune'], root);
    git(['worktree', 'add', '--detach', dir, sha], root);
  } else if (tryGit(['status', '--porcelain'], dir)) {
    console.log(`\n${dir} has changes made in it, so it is run as it is rather than updated.`);
  } else {
    console.log(`\nUpdating the copy of ${chosen.name} in ${dir}`);
    git(['checkout', '--detach', '--quiet', sha], dir);
  }
}

console.log('Installing packages...');
if ((await run('npm', ['install', '--no-audit', '--no-fund'], dir)) !== 0) {
  console.error('npm install failed. See the messages above.');
  process.exit(1);
}
console.log(`Starting ${chosen.name}. Your browser will open shortly; press Ctrl+C here to stop.`);
process.exit(await run('npm', ['run', 'dev', '--', '--open'], dir));
