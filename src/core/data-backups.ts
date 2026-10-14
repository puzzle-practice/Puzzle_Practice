import { deletedMarks, exportAll, importAll, mergeBackupFiles, replayMark, scoreRecords } from './storage';
import { deleteReplayFile, isReplayMetadata, listReplayFiles, OperationQueue, readReplayFile, replayChecksum, replayWrites, saveReplayFile, type ReplayMetadata } from './replay-storage';

const BACKUP_FILE = 'puzzle-practice-backup.json';
const CHANGE_EVENT = 'puzzle-practice-data-changed';
type Permission = 'granted' | 'denied' | 'prompt';
interface DirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<Permission>;
  requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<Permission>;
}
interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>;
}
interface SavedHandle { handle: DirectoryHandle; syncing: boolean }
interface DirectoryBackup {
  puzzlePractice: 2;
  saved: string;
  data: Record<string, unknown>;
  replays: ReplayMetadata[];
}
interface PortableBackup extends Omit<DirectoryBackup, 'replays'> {
  replays: Array<{ metadata: ReplayMetadata; data: string }>;
}
export interface DataBackupStatus {
  message: string;
  folderSupported: boolean;
  folderSelected: boolean;
  folderBackupFound: boolean;
  busy: boolean;
}

let handle: DirectoryHandle | null = null;
let syncingFolder = false;
let folderBackupFound = false;
let busy = false;
let message = 'Loading saved data…';
let initialized = false;
let saveTimer = 0;
const queue = new OperationQueue();
const subscribers = new Set<() => void>();
function notify(): void { for (const subscriber of subscribers) subscriber(); }
function directoryPicker(): DirectoryPickerWindow['showDirectoryPicker'] { return (window as DirectoryPickerWindow).showDirectoryPicker; }
/** Bounds decoded tapes in memory, never the saved archive. */
export function replayRetentionLimit(): number { return 10; }
function opfs(): Promise<FileSystemDirectoryHandle> | null { return navigator.storage?.getDirectory?.() ?? null; }
function emptyBackup(): DirectoryBackup { return { puzzlePractice: 2, saved: new Date().toISOString(), data: {}, replays: [] }; }
function currentData(): Record<string, unknown> {
  const data = (JSON.parse(exportAll()) as { data: Record<string, unknown> }).data;
  for (const key of Object.keys(data)) if (key.endsWith(':replays')) delete data[key];
  return data;
}
function settingsJson(data: Record<string, unknown>): string {
  return JSON.stringify({ puzzlePractice: 1, data: Object.fromEntries(Object.entries(data).filter(([key]) => !key.endsWith(':replays'))) });
}
function parseDirectoryBackup(json: string): DirectoryBackup {
  const value = JSON.parse(json) as DirectoryBackup;
  if (value.puzzlePractice !== 2 || !value.data || typeof value.data !== 'object' || Array.isArray(value.data) ||
      !Array.isArray(value.replays) || !value.replays.every(isReplayMetadata)) throw new Error('Unsupported folder backup');
  return value;
}
function replayName(metadata: ReplayMetadata): string { return `${metadata.id.replaceAll(':', '-')}.json.gz`; }

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('puzzle-practice-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function getSavedHandle(): Promise<SavedHandle | null> {
  const db = await openHandleDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('handles', 'readonly').objectStore('handles').get('backup-directory');
      request.onsuccess = () => resolve((request.result as SavedHandle | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
async function saveHandle(value: SavedHandle): Promise<void> {
  const db = await openHandleDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(value, 'backup-directory');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
/** Only a missing file counts as empty. Read failures must not lead to overwrite. */
export async function readBackup(directory: FileSystemDirectoryHandle): Promise<DirectoryBackup | null> {
  try { return parseDirectoryBackup(await (await (await directory.getFileHandle(BACKUP_FILE)).getFile()).text()); }
  catch (error) {
    if ((error as DOMException).name === 'NotFoundError') return null;
    throw error;
  }
}
async function writeFile(directory: FileSystemDirectoryHandle, name: string, data: string | Blob): Promise<void> {
  const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
  try { await writable.write(data); await writable.close(); }
  catch (error) { await writable.abort().catch(() => {}); throw error; }
}
async function readDirectoryReplay(directory: FileSystemDirectoryHandle, metadata: ReplayMetadata): Promise<Blob> {
  const folder = await directory.getDirectoryHandle('replays');
  const file = await (await folder.getFileHandle(replayName(metadata))).getFile();
  if (file.size !== metadata.bytes) throw new Error('Incomplete replay file');
  if (metadata.checksum && await replayChecksum(file) !== metadata.checksum) throw new Error('Damaged replay file');
  return file;
}
/** Caller holds the queue/lock. Commit payloads before publishing their manifest. */
async function writeMergedBackup(directory: FileSystemDirectoryHandle): Promise<void> {
  const old = await readBackup(directory) ?? emptyBackup();
  const deleted = deletedMarks();
  const entries = new Map(old.replays.map((entry) => [entry.id, entry]));
  for (const entry of old.replays) if (deleted.has(replayMark(entry.id))) {
    entries.delete(entry.id);
    try { await (await directory.getDirectoryHandle('replays')).removeEntry(replayName(entry)); } catch { /* Already gone. */ }
  }
  for (const entry of await listReplayFiles()) {
    if (deleted.has(replayMark(entry.id))) continue;
    if (entry.checksum && entries.get(entry.id)?.checksum === entry.checksum) continue;
    const blob = await readReplayFile(entry);
    if (!blob) throw new Error('Missing replay payload');
    const folder = await directory.getDirectoryHandle('replays', { create: true });
    await writeFile(folder, replayName(entry), blob);
    entries.set(entry.id, entry);
  }
  const merged = JSON.parse(mergeBackupFiles(settingsJson(currentData()), settingsJson(old.data))) as { data: Record<string, unknown> };
  const next: DirectoryBackup = { puzzlePractice: 2, saved: new Date().toISOString(), data: merged.data,
    replays: [...entries.values()].sort((a, b) => b.at - a.at) };
  await writeFile(directory, BACKUP_FILE, JSON.stringify(next));
}
/** Web Locks also prevent tabs from interleaving changes to the same archive. */
function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  return queue.run(async () => {
    busy = true;
    notify();
    try { return navigator.locks ? await navigator.locks.request('puzzle-practice-backups', operation) : await operation(); }
    finally { busy = false; notify(); }
  });
}
function enqueueSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void exclusive(async () => {
      await replayWrites.idle();
      let failed = false;
      try { const root = await opfs(); if (root) await writeMergedBackup(root); } catch { failed = true; }
      if (handle && syncingFolder) {
        try {
          if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Reconnect folder');
          await writeMergedBackup(handle);
          folderBackupFound = true;
          message = `Saved automatically to ${handle.name}`;
        } catch { message = 'Saved in this browser. Reconnect the folder or check access to update PC backups.'; }
      } else message = failed ? 'Saved in this browser. The automatic backup could not be updated.' : 'Saved in this browser.';
    }).catch(() => { message = 'The automatic backup could not be updated.'; notify(); });
  }, 350);
}
async function importDirectory(directory: FileSystemDirectoryHandle, backup: DirectoryBackup, keepCurrentSettings = false): Promise<number> {
  const existing = new Set((await listReplayFiles()).map((entry) => entry.id));
  const deleted = new Set([...deletedMarks(), ...(Array.isArray(backup.data['puzzle-practice:deleted']) ? backup.data['puzzle-practice:deleted'] as string[] : [])]);
  for (const metadata of backup.replays) {
    if (!existing.has(metadata.id) && !deleted.has(replayMark(metadata.id))) await saveReplayFile({ metadata, blob: await readDirectoryReplay(directory, metadata) });
  }
  const json = settingsJson(backup.data);
  return importAll(keepCurrentSettings ? mergeBackupFiles(settingsJson(currentData()), json) : json);
}
export async function initializeDataBackups(): Promise<void> {
  if (initialized) return;
  initialized = true;
  // Ask the browser to keep scores and replays under storage pressure (Safari otherwise drops
  // site data after a week without a visit). Browsers may decline; nothing else depends on it.
  void navigator.storage?.persist?.().catch(() => false);
  // Restore before enabling autosave so loading cannot overwrite its own source.
  await exclusive(async () => {
    try {
      const saved = await getSavedHandle();
      if (saved) {
        handle = saved.handle;
        syncingFolder = saved.syncing;
        if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') {
          const backup = await readBackup(handle);
          folderBackupFound = !!backup;
          if (backup && syncingFolder) await importDirectory(handle, backup, Object.keys(currentData()).length > 0);
        }
      }
    } catch { /* Optional folder access; existing files remain untouched. */ }
    try {
      const root = await opfs();
      const backup = root ? await readBackup(root) : null;
      if (root && backup) await importDirectory(root, backup, Object.keys(currentData()).length > 0);
    } catch { /* Normal IndexedDB and settings storage remain usable. */ }
    message = handle ? `Folder ${handle.name} is selected. Use Load or Save to reconnect if needed.` : 'Saved in this browser.';
  });
  window.addEventListener(CHANGE_EVENT, enqueueSave);
  enqueueSave();
}
export function getDataBackupStatus(): DataBackupStatus {
  return { message, folderSupported: !!directoryPicker(), folderSelected: !!handle, folderBackupFound, busy };
}
export function subscribeDataBackupStatus(callback: () => void): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}
/** Metadata only: all archived runs are listed without decompressing their payloads. */
/** Deletes a replay from this browser; backups drop it on their next save (it's listed as deleted). */
export async function deleteReplay(id: string): Promise<void> {
  await replayWrites.run(() => deleteReplayFile(id));
  window.dispatchEvent(new CustomEvent(REPLAY_REMOVED, { detail: id }));
  enqueueSave();
}
export const REPLAY_REMOVED = 'puzzle-practice-replay-removed';

export async function readReplayArchive(puzzle?: string): Promise<ReplayMetadata[]> {
  const entries = new Map<string, ReplayMetadata>();
  try { for (const entry of await listReplayFiles(puzzle)) entries.set(entry.id, entry); } catch { /* Report on save/load. */ }
  if (handle && syncingFolder && await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied') === 'granted') {
    try {
      const backup = await readBackup(handle);
      const deleted = deletedMarks();
      for (const entry of backup?.replays ?? []) if ((puzzle === undefined || entry.puzzle === puzzle) && !deleted.has(replayMark(entry.id))) {
        if (!entries.has(entry.id)) entries.set(entry.id, entry);
      }
    } catch { message = 'The folder archive could not be read. Browser replays remain available.'; notify(); }
  }
  return [...entries.values()].sort((a, b) => b.at - a.at);
}
export async function readArchivedReplay(metadata: ReplayMetadata): Promise<Blob | null> {
  try { const blob = await readReplayFile(metadata); if (blob) return blob; } catch { /* Try the folder. */ }
  if (handle && syncingFolder && await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return readDirectoryReplay(handle, metadata);
  return null;
}
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
/** Scores alone are enough for graphs; even archived rows need only the small manifests. */
export function exportScoreHistory(): Promise<string> {
  return exclusive(async () => {
    let data = currentData();
    const browserFolder = await opfs();
    const directories: FileSystemDirectoryHandle[] = browserFolder ? [browserFolder] : [];
    if (handle && syncingFolder && await handle.queryPermission({ mode: 'readwrite' }) === 'granted') directories.push(handle);
    for (const directory of directories) {
      const backup = await readBackup(directory);
      if (backup) data = (JSON.parse(mergeBackupFiles(settingsJson(data), settingsJson(backup.data))) as { data: Record<string, unknown> }).data;
    }
    return JSON.stringify({ format: 'puzzle-practice-scores', version: 1,
      saved: new Date().toISOString(), scores: scoreRecords(data) });
  });
}

/** Base64 is used only for portable downloads, never for browser or automatic folder storage. */
export function exportCompleteBackup(): Promise<string> {
  return exclusive(async () => {
    await replayWrites.idle();
    let data = currentData();
    if (handle && syncingFolder && await handle.queryPermission({ mode: 'readwrite' }) === 'granted') {
      const backup = await readBackup(handle);
      if (backup) data = (JSON.parse(mergeBackupFiles(settingsJson(data), settingsJson(backup.data))) as { data: Record<string, unknown> }).data;
    }
    const replays: PortableBackup['replays'] = [];
    for (const metadata of await readReplayArchive()) {
      const blob = await readArchivedReplay(metadata);
      if (!blob) throw new Error('A replay could not be exported');
      replays.push({ metadata, data: toBase64(new Uint8Array(await blob.arrayBuffer())) });
    }
    return JSON.stringify({ puzzlePractice: 2, saved: new Date().toISOString(), data, replays } satisfies PortableBackup);
  });
}
export function importCompleteBackup(json: string): Promise<number> {
  return exclusive(async () => {
    const value = JSON.parse(json) as PortableBackup;
    if (value.puzzlePractice !== 2 || !value.data || typeof value.data !== 'object' || Array.isArray(value.data) || !Array.isArray(value.replays)) throw new Error('Unsupported backup');
    // Validate the entire import before making changes.
    const files = value.replays.map((entry) => {
      if (!entry || !isReplayMetadata(entry.metadata) || typeof entry.data !== 'string') throw new Error('Invalid replay metadata');
      const bytes = fromBase64(entry.data);
      if (bytes.length !== entry.metadata.bytes || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('Invalid compressed replay');
      return { metadata: entry.metadata, blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'application/gzip' }) };
    });
    const { decodeReplayBlob, replayMetadata } = await import('./replay');
    for (const file of files) {
      const tape = await decodeReplayBlob(file.blob);
      if (!tape) throw new Error('Invalid replay payload');
      const actual = replayMetadata(tape, file.blob.size);
      if (actual.id !== file.metadata.id || actual.duration !== file.metadata.duration || actual.result !== file.metadata.result ||
          actual.settingsVersion !== file.metadata.settingsVersion || actual.simulatorVersion !== file.metadata.simulatorVersion ||
          (file.metadata.checksum && await replayChecksum(file.blob) !== file.metadata.checksum)) throw new Error('Invalid replay payload');
    }
    await replayWrites.idle();
    const deleted = new Set([...deletedMarks(), ...(Array.isArray(value.data['puzzle-practice:deleted']) ? value.data['puzzle-practice:deleted'] as string[] : [])]);
    for (const file of files) if (!deleted.has(replayMark(file.metadata.id))) await saveReplayFile(file);
    const count = importAll(settingsJson(value.data));
    message = 'Backup loaded. All replays remain available in this browser.';
    enqueueSave();
    return count + files.length;
  });
}
export async function chooseBackupFolder(): Promise<void> {
  const picker = directoryPicker();
  if (!picker) return;
  try {
    // Picker needs the user gesture; serialize after the user chooses.
    const selected = await picker.call(window, { id: 'puzzle-practice-backup', mode: 'readwrite' });
    await exclusive(async () => {
      const backup = await readBackup(selected);
      handle = selected;
      syncingFolder = !backup;
      folderBackupFound = !!backup;
      await saveHandle({ handle, syncing: syncingFolder });
      message = backup ? `Found a backup in ${handle.name}. Load it to merge, or save this browser’s data while keeping older runs.` : `Connected to ${handle.name}.`;
      if (!backup) enqueueSave();
    });
  } catch (error) {
    if ((error as DOMException).name !== 'AbortError') message = 'The folder could not be connected. Check access and its backup format.';
    notify();
  }
}
async function requestFolderAccess(directory: DirectoryHandle): Promise<void> {
  if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted' &&
      await directory.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Permission denied');
}
export async function loadFromBackupFolder(): Promise<void> {
  const directory = handle;
  if (!directory) return;
  try {
    await requestFolderAccess(directory);
    await exclusive(async () => {
      await replayWrites.idle();
      const backup = await readBackup(directory);
      if (!backup) throw new Error('Backup missing');
      const count = await importDirectory(directory, backup);
      syncingFolder = true;
      folderBackupFound = true;
      await saveHandle({ handle: directory, syncing: true });
      message = `Loaded ${count} saved items from ${directory.name}; future changes will sync automatically.`;
      enqueueSave();
    });
  } catch { message = 'Could not load the backup. Check folder access and try again.'; notify(); }
}
export async function saveToBackupFolder(): Promise<void> {
  const directory = handle;
  if (!directory) return;
  try {
    await requestFolderAccess(directory);
    await exclusive(async () => {
      await replayWrites.idle();
      await writeMergedBackup(directory);
      syncingFolder = true;
      folderBackupFound = true;
      await saveHandle({ handle: directory, syncing: true });
      message = `Saved to ${directory.name}; future changes will sync automatically.`;
    });
  } catch { message = 'Could not save the backup. Check folder access and try again.'; notify(); }
}
