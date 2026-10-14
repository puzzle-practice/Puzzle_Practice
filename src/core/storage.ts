// Saved settings and scores, kept in localStorage under one key per puzzle.
// The desktop games wrote YAML files next to the executable; this is the browser's equivalent.
// Every access is guarded: private windows and blocked storage just mean nothing persists.
//
// When storage is full, room is made by trimming in priority order: replays kept in settings
// storage by older versions go first, then the oldest games of the longest histories. Settings,
// key bindings and the pirate profile are never removed to make room.

const PREFIX = 'puzzle-practice:';

/** One finished game: when it ended, its score, and whatever else the puzzle shows about it. */
export interface GameRecord {
  /** Date.now() when the game ended. */
  at: number;
  score: number;
  [stat: string]: number | string;
}

/** A graphable score row, independent of the compressed replay payload. */
export interface ScoreRecord {
  puzzle: string;
  settingsKey: string;
  at: number;
  score: number;
  stats: Record<string, number | string>;
  /** Matches ReplayMetadata.id; absent when the game had no saved replay. */
  replayFileId?: string;
}

/** Reads plain score histories from a browser snapshot or folder manifest, never replay blobs. */
export function scoreRecords(data: Record<string, unknown>, puzzle?: string): ScoreRecord[] {
  const scores: ScoreRecord[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(PREFIX)) continue;
    const marker = key.indexOf(':history:', PREFIX.length);
    if (marker < 0 || !Array.isArray(value)) continue;
    const namespace = key.slice(PREFIX.length, marker);
    if (puzzle !== undefined && namespace !== puzzle) continue;
    const settingsKey = key.slice(marker + ':history:'.length);
    for (const game of value) {
      if (!game || typeof game !== 'object' || !Number.isFinite(game.at) || !Number.isFinite(game.score)) continue;
      const { at, score, replayAt, replayId, duty: _duty, session: _session, ...stats } = game as GameRecord;
      const replayFileId = typeof replayAt === 'number' && Number.isFinite(replayAt)
        ? `${namespace}:${replayAt}${typeof replayId === 'string' && replayId ? `:${replayId}` : ''}` : undefined;
      scores.push({ puzzle: namespace, settingsKey, at, score, stats,
        ...(replayFileId ? { replayFileId } : {}) });
    }
  }
  return scores.sort((a, b) => a.at - b.at || a.puzzle.localeCompare(b.puzzle) || a.settingsKey.localeCompare(b.settingsKey));
}

/**
 * Games and replays the player deleted from the History tab. Backups merge by adding, so without
 * this list a deleted game would come back from a folder or file backup; every merge and import
 * leaves out what's listed. Entries are `game:<history key>@<at>:<score>` and `replay:<replay id>`.
 */
export const DELETED_KEY = `${PREFIX}deleted`;
const gameMark = (key: string, at: number, score: unknown) => `game:${key}@${at}:${score}`;
export const replayMark = (id: string) => `replay:${id}`;
function deletedIn(...values: unknown[]): Set<string> {
  const marks = new Set<string>();
  for (const value of values) if (Array.isArray(value)) for (const mark of value) if (typeof mark === 'string') marks.add(mark);
  return marks;
}
/** Everything deleted in this browser. */
export function deletedMarks(): Set<string> {
  try { return deletedIn(JSON.parse(localStorage.getItem(DELETED_KEY) ?? '[]')); } catch { return new Set(); }
}
function isDeletedGame(marks: Set<string>, key: string, item: unknown): boolean {
  const { at, score } = (item ?? {}) as { at?: unknown; score?: unknown };
  return typeof at === 'number' && marks.has(gameMark(key, at, score));
}

/**
 * Deletes a past game from its history and this session's games, and lists it as deleted so
 * backups don't bring it back. Returns its replay's id, if it had one, for the caller to delete.
 */
export function removeGame(game: GameRecord): string | null {
  let replay: string | null = null;
  const marks = deletedMarks();
  const same = (item: unknown) => !!item && typeof item === 'object' && (item as GameRecord).at === game.at && (item as GameRecord).score === game.score;
  for (const key of savedKeys()) {
    if (storageKind(key) !== 'history') continue;
    const games = readArray(key);
    const index = games.findIndex(same);
    if (index < 0) continue;
    games.splice(index, 1);
    writeItem(key, JSON.stringify(games));
    marks.add(gameMark(key, game.at, game.score));
    if (typeof game.replayAt === 'number') {
      const namespace = key.slice(PREFIX.length, key.indexOf(':history:', PREFIX.length));
      replay = `${namespace}:${game.replayAt}${typeof game.replayId === 'string' && game.replayId ? `:${game.replayId}` : ''}`;
      marks.add(replayMark(replay));
    }
  }
  for (const [name, games] of sessionGames) {
    const index = games.findIndex(same);
    if (index < 0) continue;
    games.splice(index, 1);
    try { sessionStorage.setItem(`${SESSION_KEY}:${name}`, JSON.stringify(games)); } catch { /* Memory only. */ }
  }
  writeItem(DELETED_KEY, JSON.stringify([...marks]));
  historyRevision++;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('puzzle-practice-data-changed'));
  return replay;
}

/** The desktop games kept every score per settings key; this keeps the most recent this many. */
const HISTORY_LIMIT = 1000;

/**
 * This browser session: the tab, from when it was opened until it's closed. sessionStorage keeps
 * the id through reloads and gives each new tab or window its own. Session stats count only the
 * games played in it.
 */
const SESSION_KEY = 'puzzle-practice-session';
let pageSession: string | null = null;
export function browserSession(): string {
  if (pageSession) return pageSession;
  const fresh = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
  try {
    pageSession = sessionStorage.getItem(SESSION_KEY) ?? fresh;
    sessionStorage.setItem(SESSION_KEY, pageSession);
  } catch {
    pageSession = fresh;
  }
  return pageSession;
}

/** Whether finished games are added to the History tab (Settings > History); on unless turned off. */
export function savesHistory(): boolean {
  return new Store('global').get<boolean>('saveHistory', true);
}

/** This session's games per puzzle and settings key, kept even when history saving is off. */
const sessionGames = new Map<string, GameRecord[]>();
let historyRevision = 0;

function backupItemKey(item: unknown): string {
  if (item && typeof item === 'object') {
    const replay = item as { puzzle?: unknown; at?: unknown };
    if (typeof replay.puzzle === 'string' && typeof replay.at === 'number' && Number.isFinite(replay.at)) {
      return `replay:${replay.puzzle}:${replay.at}`;
    }
  }
  return JSON.stringify(item) ?? 'null';
}

/** What a saved key holds, which decides what goes first when storage is full. */
export type StorageKind = 'setting' | 'history' | 'replays';

export function storageKind(key: string): StorageKind {
  if (key.endsWith(':replays')) return 'replays';
  if (key.includes(':history:')) return 'history';
  return 'setting';
}

function isQuotaError(error: unknown): boolean {
  const e = error as { name?: string; code?: number } | null;
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
}

function savedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

function readArray(key: string): unknown[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

/**
 * Frees some room: an old replay list first, then the older half of the longest history (all of
 * it if just one game is left). Never touches settings or `keep`. False when nothing is left to trim.
 */
export function makeRoom(keep?: string): boolean {
  const keys = savedKeys().filter((key) => key !== keep);
  const replays = keys.filter((key) => storageKind(key) === 'replays');
  if (replays.length) {
    replays.sort((a, b) => (localStorage.getItem(b)?.length ?? 0) - (localStorage.getItem(a)?.length ?? 0));
    localStorage.removeItem(replays[0]);
    return true;
  }
  let longest: { key: string; games: unknown[] } | null = null;
  for (const key of keys) {
    if (storageKind(key) !== 'history') continue;
    const games = readArray(key);
    if (!longest || games.length > longest.games.length) longest = { key, games };
  }
  if (!longest) return false;
  historyRevision++;
  if (longest.games.length <= 1) localStorage.removeItem(longest.key);
  else localStorage.setItem(longest.key, JSON.stringify(longest.games.slice(Math.ceil(longest.games.length / 2))));
  return true;
}

/** Writes a value, making room as needed; false if it still doesn't fit or storage is unavailable. */
function writeItem(key: string, json: string): boolean {
  for (;;) {
    try {
      localStorage.setItem(key, json);
      return true;
    } catch (error) {
      if (!isQuotaError(error) || !makeRoom(key)) return false;
    }
  }
}

export class Store {
  private readOnly = false;
  /** Replay simulations can read scores/settings but must never persist or mutate histories. */
  setReadOnly(readOnly: boolean): void { this.readOnly = readOnly; }
  /** Histories read so far, so panels can show them every frame without re-reading storage. */
  private readonly histories = new Map<string, GameRecord[]>();
  private historiesRevision = historyRevision;

  constructor(private readonly namespace: string) {}

  private key(name: string): string {
    return `${PREFIX}${this.namespace}:${name}`;
  }

  get<T>(name: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(this.key(name));
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  }

  /**
   * Saves a value; false if storage is unavailable or full. A full store first makes room (see
   * makeRoom); a history that still doesn't fit keeps its newest games.
   */
  set(name: string, value: unknown): boolean {
    if (this.readOnly) return false;
    try {
      const key = this.key(name);
      let saved = writeItem(key, JSON.stringify(value));
      if (!saved && storageKind(key) === 'history' && Array.isArray(value)) {
        while (!saved && value.length > 1) {
          value.splice(0, Math.ceil(value.length / 2));
          saved = writeItem(key, JSON.stringify(value));
        }
      }
      if (saved && typeof window !== 'undefined') window.dispatchEvent(new Event('puzzle-practice-data-changed'));
      return saved;
    } catch {
      // Storage unavailable: keep playing without saving.
      return false;
    }
  }

  /** Every saved game for one settings key, oldest first. */
  history(key: string): readonly GameRecord[] {
    if (this.historiesRevision !== historyRevision) {
      this.histories.clear();
      this.historiesRevision = historyRevision;
    }
    let games = this.histories.get(key);
    if (!games) {
      games = this.get<GameRecord[]>(`history:${key}`, []);
      this.histories.set(key, games);
    }
    return games;
  }

  /**
   * This browser session's games for one settings key, oldest first, for session stats. They're
   * kept for the tab in sessionStorage, so a reload keeps them and history saving can be off.
   */
  sessionHistory(key: string): readonly GameRecord[] {
    const name = `${PREFIX}${this.namespace}:${key}`;
    let games = sessionGames.get(name);
    if (!games) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(`${SESSION_KEY}:${name}`) ?? '[]');
        games = Array.isArray(saved) ? saved : [];
      } catch { games = []; }
      sessionGames.set(name, games);
    }
    return games;
  }

  /**
   * Adds a finished game to this session's games and, unless history saving is off, to its
   * settings key's history. Returns the history.
   */
  addHistory(key: string, game: { score: number; [stat: string]: number | string }): readonly GameRecord[] {
    if (this.readOnly) return this.history(key);
    const record = { at: Date.now(), ...game, session: browserSession() } as GameRecord;
    const session = this.sessionHistory(key) as GameRecord[];
    session.push(record);
    session.splice(0, session.length - HISTORY_LIMIT);
    try { sessionStorage.setItem(`${SESSION_KEY}:${PREFIX}${this.namespace}:${key}`, JSON.stringify(session)); }
    catch { /* No session storage: this page's games still count. */ }
    if (!savesHistory()) return this.history(key);
    const games = this.history(key) as GameRecord[];
    games.push(record);
    games.splice(0, games.length - HISTORY_LIMIT);
    this.set(`history:${key}`, games);
    return games;
  }
}

/** Settings and score histories; binary replay files are exported separately by data-backups. */
export function exportAll(): string {
  const data: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) data[key] = JSON.parse(localStorage.getItem(key)!);
    }
  } catch {
    // Unreadable storage: export what was read.
  }
  return JSON.stringify({ puzzlePractice: 1, saved: new Date().toISOString(), data }, null, 1);
}

/** Merges a browser snapshot into an archive without dropping older score or replay records. */
export function mergeBackupFiles(currentJson: string, archiveJson: string, replayLimit = Number.POSITIVE_INFINITY): string {
  const current = JSON.parse(currentJson) as { puzzlePractice?: number; data?: Record<string, unknown> };
  const archive = JSON.parse(archiveJson) as { puzzlePractice?: number; data?: Record<string, unknown> };
  if (current.puzzlePractice !== 1 || !current.data || archive.puzzlePractice !== 1 || !archive.data) {
    throw new Error('Not a Puzzle Practice backup');
  }
  const data = { ...archive.data, ...current.data };
  const deleted = deletedIn(archive.data[DELETED_KEY], current.data[DELETED_KEY]);
  if (deleted.size) data[DELETED_KEY] = [...deleted];
  for (const [key, value] of Object.entries(data)) {
    if (key.includes(':history:') && Array.isArray(value)) data[key] = value.filter((item) => !isDeletedGame(deleted, key, item));
  }
  for (const [key, incoming] of Object.entries(current.data)) {
    const old = archive.data[key];
    const isReplays = key.endsWith(':replays');
    const isHistory = key.includes(':history:');
    if (!Array.isArray(incoming) || (!isReplays && !isHistory)) continue;
    const unique = new Map<string, unknown>();
    for (const item of [...(Array.isArray(old) ? old : []), ...incoming]) unique.set(isReplays ? backupItemKey(item) : JSON.stringify(item) ?? 'null', item);
    const merged = [...unique.values()];
    if (isReplays) {
      merged.sort((a, b) => Number((b as { at?: number })?.at ?? 0) - Number((a as { at?: number })?.at ?? 0));
      if (Number.isFinite(replayLimit)) merged.splice(Math.max(0, replayLimit));
    } else {
      merged.sort((a, b) => Number((a as { at?: number })?.at ?? 0) - Number((b as { at?: number })?.at ?? 0));
    }
    data[key] = isHistory ? merged.filter((item) => !isDeletedGame(deleted, key, item)) : merged;
  }
  return JSON.stringify({ puzzlePractice: 1, saved: new Date().toISOString(), data }, null, 1);
}

/** Merges a full backup into the current browser data. Repeated imports do not duplicate games/replays. */
export function importAll(json: string, replayLimit = 10): number {
  const parsed = JSON.parse(json) as { puzzlePractice?: number; data?: Record<string, unknown> };
  if (parsed.puzzlePractice !== 1 || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    throw new Error('Not a Puzzle Practice backup');
  }
  let count = 0;
  historyRevision++;
  // Settings and the profile first, so a backup too big for storage gives up games, not settings.
  const order: Record<StorageKind, number> = { setting: 0, history: 1, replays: 2 };
  const entries = Object.entries(parsed.data).sort(([a], [b]) => order[storageKind(a)] - order[storageKind(b)]);
  const deleted = deletedIn([...deletedMarks()], parsed.data[DELETED_KEY]);
  for (const [key, value] of entries) {
    if (!key.startsWith(PREFIX)) continue;
    let next = key === DELETED_KEY ? [...deleted] : value;
    if (Array.isArray(value) && (key.includes(':history:') || key.endsWith(':replays'))) {
      let existing: unknown;
      try { existing = JSON.parse(localStorage.getItem(key) ?? 'null'); }
      catch { /* Replace a corrupt value with the valid backup value. */ }
      const unique = new Map<string, unknown>();
      for (const item of [...(Array.isArray(existing) ? existing : []), ...value]) {
        unique.set(key.endsWith(':replays') ? backupItemKey(item) : JSON.stringify(item) ?? 'null', item);
      }
      let merged = [...unique.values()];
      if (key.endsWith(':replays')) {
        merged.sort((a, b) => Number((b as { at?: number })?.at ?? 0) - Number((a as { at?: number })?.at ?? 0));
        merged = merged.slice(0, replayLimit);
      } else {
        merged.sort((a, b) => Number((a as { at?: number })?.at ?? 0) - Number((b as { at?: number })?.at ?? 0));
        merged = merged.filter((item) => !isDeletedGame(deleted, key, item)).slice(-HISTORY_LIMIT);
      }
      next = merged;
    }
    if (writeItem(key, JSON.stringify(next))) count++;
  }
  historyRevision++;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('puzzle-practice-data-changed'));
  return count;
}
