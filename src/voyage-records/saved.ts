// What the page remembers between visits. The ignore list is a saved setting, so it also travels
// with backups. Browsers never reveal a file's path, so a chatlog is remembered as a file handle:
// Chrome and Edge can keep one in IndexedDB and reopen it, once the player allows it.
import { openHandleDb } from '../core/data-backups';
import { Store } from '../core/storage';

export interface LogHandle extends FileSystemFileHandle {
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>;
}

type PickerWindow = Window & {
  showOpenFilePicker?: (options: { id: string; multiple: boolean }) => Promise<LogHandle[]>;
};

const store = new Store('voyage-records');
const HANDLES_KEY = 'voyage-chatlogs';

export function loadIgnored(): string[] {
  return store.get<string[]>('ignored', []);
}

export function saveIgnored(names: string[]): void {
  store.set('ignored', names);
}

export function canRememberLogs(): boolean {
  return typeof (window as PickerWindow).showOpenFilePicker === 'function';
}

/** Nothing when the player cancels. The picker opens where it was last used. */
export async function pickLogHandles(): Promise<LogHandle[]> {
  try {
    return await (window as PickerWindow).showOpenFilePicker!({ id: 'chatlogs', multiple: true });
  } catch {
    return [];
  }
}

export async function savedLogHandles(): Promise<LogHandle[]> {
  if (!canRememberLogs()) return [];
  try {
    const db = await openHandleDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('handles', 'readonly').objectStore('handles').get(HANDLES_KEY);
        request.onsuccess = () => resolve((request.result as LogHandle[] | undefined) ?? []);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  } catch {
    return [];
  }
}

export async function saveLogHandles(handles: LogHandle[]): Promise<void> {
  if (!canRememberLogs()) return;
  try {
    const db = await openHandleDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handles, HANDLES_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  } catch {
    // Forgetting a chatlog costs one more trip to the file picker, so the page carries on.
  }
}

export async function canReadLog(handle: LogHandle): Promise<boolean> {
  try {
    return await handle.queryPermission({ mode: 'read' }) === 'granted';
  } catch {
    return false;
  }
}

/** Needs a click: the browser asks the player, and may ask once per file. */
export async function askToReadLog(handle: LogHandle): Promise<boolean> {
  try {
    return await handle.requestPermission({ mode: 'read' }) === 'granted';
  } catch {
    return false;
  }
}
