// The shell: a landing page listing every puzzle, and a page per puzzle.
// Routing uses the URL hash (#/forage) so it works on GitHub Pages without game rewrites.
import './style.css';
import { runPuzzle, type RunningPuzzle } from './core/host';
import { puzzles } from './core/registry';
import {
  chooseBackupFolder,
  exportCompleteBackup,
  exportScoreHistory,
  getDataBackupStatus,
  initializeDataBackups,
  loadFromBackupFolder,
  importCompleteBackup,
  saveToBackupFolder,
  subscribeDataBackupStatus,
} from './core/data-backups';

const app = document.querySelector<HTMLDivElement>('#app')!;
let running: RunningPuzzle | null = null;
let navigation = 0;
let unsubscribeBackupStatus = () => {};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function showLanding(): void {
  unsubscribeBackupStatus();
  document.title = 'Puzzle Practice';
  const cards = puzzles.map(({ id, meta }) =>
    el(
      'a',
      { className: 'card', href: `#/${id}` },
      ...(meta.thumbnail ? [el('img', { src: meta.thumbnail, alt: '', className: 'thumb' })] : []),
      el('h2', {}, meta.title),
    ),
  );
  app.replaceChildren(
    el('header', { className: 'site' }, el('h1', {}, 'Puzzle Practice'), el('p', {}, 'Practice tools for Puzzle Pirates puzzles. Pick one to play.')),
    el('main', { className: 'grid' }, ...cards),
    backupFooter(),
  );
}

/** Global score, replay, and settings backups are managed from the landing page. */
function backupFooter(): HTMLElement {
  const button = (label: string, onClick: () => void) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'panel-button';
    node.textContent = label;
    node.addEventListener('click', onClick);
    return node;
  };
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.hidden = true;
  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    file.value = '';
    if (!chosen) return;
    try {
      const json = await chosen.text();
      const count = await importCompleteBackup(json);
      window.alert(`Merged ${count} saved item${count === 1 ? '' : 's'}.`);
    } catch {
      window.alert("That file isn't a Puzzle Practice backup.");
    }
  });
  const save = button('Back up', () => void (async () => {
    try {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([await exportCompleteBackup()], { type: 'application/json' }));
      link.download = `puzzle-practice-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch { window.alert('The complete backup could not be exported. Check browser storage and folder access.'); }
  })());
  const restore = button('Restore backup file', () => file.click());
  const scores = button('Export scores', () => void (async () => {
    try {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([await exportScoreHistory()], { type: 'application/json' }));
      link.download = `puzzle-practice-scores-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch { window.alert('Scores could not be exported. Check browser storage and folder access.'); }
  })());
  const chooseFolder = button('Choose PC folder', () => void chooseBackupFolder());
  const loadFolder = button('Load from folder', () => void loadFromBackupFolder());
  const saveFolder = button('Save to folder', () => void saveToBackupFolder());
  const folderButtons = document.createElement('div');
  folderButtons.className = 'panel-buttons';
  folderButtons.append(chooseFolder, loadFolder, saveFolder);
  const fileButtons = document.createElement('div');
  fileButtons.className = 'panel-buttons';
  fileButtons.append(save, restore, scores, file);
  const statusLine = el('p', { className: 'backup-status', role: 'status' });
  statusLine.setAttribute('aria-live', 'polite');
  const syncButtons = () => {
    const status = getDataBackupStatus();
    statusLine.textContent = status.message;
    chooseFolder.disabled = !status.folderSupported || status.busy;
    chooseFolder.textContent = status.folderSupported
      ? status.folderSelected ? 'Choose another folder' : 'Choose PC folder'
      : 'Folder backup unavailable';
    loadFolder.hidden = !status.folderSelected || !status.folderBackupFound;
    saveFolder.hidden = !status.folderSelected;
    loadFolder.disabled = status.busy;
    saveFolder.disabled = status.busy;
  };
  unsubscribeBackupStatus = subscribeDataBackupStatus(syncButtons);
  syncButtons();
  const footer = document.createElement('footer');
  footer.className = 'about backup';
  footer.append(
    statusLine,
    folderButtons,
    fileButtons,
  );
  return footer;
}

async function showPuzzle(id: string): Promise<void> {
  const entry = puzzles.find((p) => p.id === id);
  if (!entry) {
    location.hash = '#/';
    return;
  }
  const ticket = ++navigation;
  const { meta } = entry;
  document.title = `${meta.title} · Puzzle Practice`;
  const canvas = el('canvas', { className: 'game', tabIndex: 0 });
  canvas.style.aspectRatio = `${meta.width ?? 800} / ${meta.height ?? 600}`;
  const status = el('p', { className: 'status' }, 'Loading…');
  const panel = el('aside', { className: 'panel' });
  app.replaceChildren(
    el('header', { className: 'bar' }, el('a', { href: '#/', className: 'back' }, '← All puzzles'), el('h1', {}, meta.title)),
    el(
      'main',
      { className: 'play' },
      el('div', { className: 'stage' }, canvas, status),
      panel,
    ),
    el(
      'footer',
      { className: 'about' },
      el('p', { className: 'credits' }, 'Based on Puzzle Pirates, created by Three Rings Design and now operated by Grey Havens.'),
      el('p', { className: 'credits' }, 'Adaptation by Jice.'),
      el('p', { className: 'credits' }, 'Discord: jeyece.'),
    ),
  );
  try {
    const factory = await entry.load();
    const started = await runPuzzle(canvas, panel, id, meta, factory);
    if (ticket !== navigation) {
      started.stop();
      return;
    }
    running = started;
    status.remove();
    canvas.focus();
  } catch (error) {
    console.error(error);
    if (ticket === navigation) status.textContent = 'This puzzle failed to load. Try reloading the page.';
  }
}

function route(): void {
  unsubscribeBackupStatus();
  running?.stop();
  running = null;
  navigation++;
  const id = location.hash.replace(/^#\/?/, '');
  if (id) void showPuzzle(id);
  else showLanding();
}

let dataReady = false;
window.addEventListener('hashchange', () => { if (dataReady) route(); });
void initializeDataBackups().finally(() => { dataReady = true; route(); });
