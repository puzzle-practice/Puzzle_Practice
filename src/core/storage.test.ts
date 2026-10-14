import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportAll, importAll, makeRoom, mergeBackupFiles, scoreRecords, storageKind, Store } from './storage';
import { replayId } from './replay-storage';

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
  };
}

describe('full data backups', () => {
  beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('exports all puzzle data and merges score histories and replays without duplicates', () => {
    const store = new Store('forage');
    store.set('replays', [{ at: 10, result: 'Score 5' }]);
    store.set('history:normal', [{ at: 10, score: 5 }]);
    store.set('settings', { mode: 'normal' });
    const backup = exportAll();
    store.set('replays', [{ at: 11, result: 'Score 8' }]);
    store.set('history:normal', [{ at: 11, score: 8 }]);
    store.set('settings', { mode: 'chaos' });

    expect(importAll(backup)).toBe(3);
    expect(store.get('replays', [])).toHaveLength(2);
    expect(store.get<{ at: number }[]>('replays', []).map((item) => item.at)).toEqual([11, 10]);
    expect(store.history('normal')).toHaveLength(2);
    expect(store.history('normal').map((item) => item.at)).toEqual([10, 11]);
    expect(store.get('settings', {})).toEqual({ mode: 'normal' });
    importAll(backup);
    expect(store.get('replays', [])).toHaveLength(2);
    expect(store.history('normal')).toHaveLength(2);
  });

  it('rejects malformed backups and ignores keys outside this app', () => {
    expect(() => importAll('{bad json')).toThrow();
    expect(() => importAll(JSON.stringify({ puzzlePractice: 2, data: {} }))).toThrow();
    const count = importAll(JSON.stringify({ puzzlePractice: 1, data: { unrelated: 'value' } }));
    expect(count).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('keeps older replay archives in the backup file even though browser history is capped', () => {
    const latest = JSON.stringify({ puzzlePractice: 1, data: {
      'puzzle-practice:forage:replays': [{ at: 20, result: 'new' }],
    } });
    const archive = JSON.stringify({ puzzlePractice: 1, data: {
      'puzzle-practice:forage:replays': Array.from({ length: 12 }, (_, i) => ({ at: i + 1, result: 'old' })),
    } });
    const merged = JSON.parse(mergeBackupFiles(latest, archive)) as { data: Record<string, { at: number }[]> };
    expect(merged.data['puzzle-practice:forage:replays']).toHaveLength(13);
    expect(merged.data['puzzle-practice:forage:replays'][0].at).toBe(20);
  });

  it('can cap the retained replay archive to the five newest sessions', () => {
    const latest = JSON.stringify({ puzzlePractice: 1, data: {
      'puzzle-practice:forage:replays': [{ at: 20, result: 'new' }],
    } });
    const archive = JSON.stringify({ puzzlePractice: 1, data: {
      'puzzle-practice:forage:replays': Array.from({ length: 12 }, (_, i) => ({ at: i + 1, result: 'old' })),
    } });
    const merged = JSON.parse(mergeBackupFiles(latest, archive, 5)) as { data: Record<string, { at: number }[]> };
    expect(merged.data['puzzle-practice:forage:replays'].map((item) => item.at)).toEqual([20, 12, 11, 10, 9]);
  });

  it('restores the latest ten replays to browser storage while preserving the complete archive', () => {
    const backup = JSON.stringify({ puzzlePractice: 1, data: {
      'puzzle-practice:forage:replays': Array.from({ length: 12 }, (_, i) => ({ at: i + 1, result: String(i + 1) })),
    } });
    const store = new Store('forage');
    importAll(backup);
    expect(store.get<{ at: number }[]>('replays', []).map((item) => item.at)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  });

  it('keeps the replay link attached to a past game through history storage', () => {
    const store = new Store('forage');
    store.addHistory('ci:test', { score: 12, replayAt: 456 });
    expect(store.history('ci:test')[0]).toMatchObject({ score: 12, replayAt: 456 });
  });

  it('reads numeric scores across settings and puzzles, with exact replay links and no payloads', () => {
    const runId = '12345678-1234-1234-1234-123456789abc';
    const data = {
      'puzzle-practice:distilling:history:Standard:off:50': [{ at: 20, score: 12.5, replayAt: 10, replayId: runId, columns: 12 }],
      'puzzle-practice:forage:history:normal': [{ at: 15, score: 9 }],
      'puzzle-practice:distilling:history:Practice:1-2': [{ at: 25, score: 8, replayAt: 10, replayId: '87654321-4321-4321-4321-cba987654321' }],
      'puzzle-practice:forage:replays': [{ at: 30, score: 100, data: 'not a replay' }],
    };
    const rows = scoreRecords(data);
    expect(rows.map((row) => row.score)).toEqual([9, 12.5, 8]);
    expect(rows[0].replayFileId).toBeUndefined();
    expect(rows[1]).toEqual({ puzzle: 'distilling', settingsKey: 'Standard:off:50', at: 20, score: 12.5,
      stats: { columns: 12 }, replayFileId: replayId('distilling', 10, runId) });
    expect(rows[2].replayFileId).not.toEqual(rows[1].replayFileId);
    expect(scoreRecords(data, 'distilling')).toHaveLength(2);
  });

  it('keeps read-only playback from mutating cached histories or saved settings', () => {
    const store = new Store('forage');
    store.set('settings', { mode: 'normal' });
    store.addHistory('test', { score: 1 });
    store.setReadOnly(true);
    store.addHistory('test', { score: 9 });
    expect(store.set('settings', { mode: 'chaos' })).toBe(false);
    expect(store.history('test').map((game) => game.score)).toEqual([1]);
    expect(store.get('settings', {})).toEqual({ mode: 'normal' });
    store.setReadOnly(false);
    store.addHistory('test', { score: 2 });
    expect(store.history('test').map((game) => game.score)).toEqual([1, 2]);
  });

  it('refreshes histories already cached before a backup is imported', () => {
    const store = new Store('forage');
    expect(store.history('test')).toEqual([]);
    importAll(JSON.stringify({ puzzlePractice: 1, data: {
      'puzzle-practice:forage:history:test': [{ at: 1, score: 3 }],
    } }));
    expect(store.history('test')).toEqual([{ at: 1, score: 3 }]);
  });
});

/** Storage that refuses writes past a size, the way a full browser store does. */
function smallStorage(limit: number) {
  const values = new Map<string, string>();
  const size = () => [...values].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => {
      const old = values.get(key);
      values.set(key, String(value));
      if (size() > limit) {
        if (old === undefined) values.delete(key); else values.set(key, old);
        throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      }
    },
  };
}

describe('when storage is full', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sorts saved keys into settings, histories and old replay lists', () => {
    expect(storageKind('puzzle-practice:global:profile')).toBe('setting');
    expect(storageKind('puzzle-practice:forage:settings')).toBe('setting');
    expect(storageKind('puzzle-practice:forage:history:normal')).toBe('history');
    expect(storageKind('puzzle-practice:forage:replays')).toBe('replays');
  });

  it('gives up old replay lists, then the oldest games, but never settings or the profile', () => {
    vi.stubGlobal('localStorage', smallStorage(1700));
    const global = new Store('global');
    const forage = new Store('forage');
    expect(global.set('profile', { name: 'Anne' })).toBe(true);
    expect(forage.set('replays', [{ at: 1, result: 'x'.repeat(600) }])).toBe(true);
    for (let i = 0; i < 40; i++) forage.addHistory('normal', { score: i });
    expect(localStorage.getItem('puzzle-practice:forage:replays')).toBeNull();
    // The settings write that doesn't fit makes room from the history.
    expect(forage.set('settings', { mode: 'normal', notes: 'y'.repeat(1200) })).toBe(true);
    expect(global.get('profile', null)).toEqual({ name: 'Anne' });
    const games = forage.history('normal');
    expect(games.length).toBeGreaterThan(0);
    expect(games.length).toBeLessThan(40);
    // What's left is the newest games.
    expect(games.at(-1)!.score).toBe(39);
  });

  it('keeps a history that alone is too big by dropping its oldest games', () => {
    vi.stubGlobal('localStorage', smallStorage(1500));
    const store = new Store('distilling');
    for (let i = 0; i < 60; i++) store.addHistory('Standard', { score: i, notes: 'z'.repeat(20) });
    const games = store.history('Standard');
    expect(games.length).toBeLessThan(60);
    expect(games.at(-1)!.score).toBe(59);
    expect(new Store('distilling').history('Standard').at(-1)!.score).toBe(59);
  });

  it('has nothing to trim when only settings are left', () => {
    vi.stubGlobal('localStorage', smallStorage(200));
    new Store('global').set('profile', { name: 'Anne' });
    expect(makeRoom()).toBe(false);
    expect(new Store('global').get('profile', null)).toEqual({ name: 'Anne' });
  });

  it('restores settings and the profile from a backup before its games', () => {
    vi.stubGlobal('localStorage', smallStorage(1200));
    const backup = JSON.stringify({ puzzlePractice: 1, data: {
      'puzzle-practice:forage:history:normal': Array.from({ length: 40 }, (_, i) => ({ at: i, score: i })),
      'puzzle-practice:global:profile': { name: 'Mary', face: {} },
      'puzzle-practice:forage:settings': { mode: 'chaos', notes: 'q'.repeat(300) },
    } });
    importAll(backup);
    expect(new Store('global').get('profile', null)).toEqual({ name: 'Mary', face: {} });
    expect(new Store('forage').get('settings', null)).toMatchObject({ mode: 'chaos' });
  });
});


describe('history saving and browser sessions', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', fakeStorage()); vi.stubGlobal('sessionStorage', fakeStorage()); });
  afterEach(() => vi.unstubAllGlobals());

  it('tags games with this browser session and keeps them for session stats even when history saving is off', () => {
    const store = new Store('blacksmithing');
    store.addHistory('session-test', { score: 1 });
    const [first] = store.history('session-test');
    expect(typeof first.session).toBe('string');
    new Store('global').set('saveHistory', false);
    store.addHistory('session-test', { score: 2 });
    expect(store.history('session-test').map((g) => g.score)).toEqual([1]);
    expect(store.sessionHistory('session-test').map((g) => g.score)).toEqual([1, 2]);
    expect(store.sessionHistory('session-test').every((g) => g.session === first.session)).toBe(true);
    // Scores exported for graphs don't carry the session id.
    expect(scoreRecords(JSON.parse(exportAll()).data, 'blacksmithing')[0].stats).not.toHaveProperty('session');
  });
});

describe('deleting past games', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', fakeStorage()); vi.stubGlobal('sessionStorage', fakeStorage()); });
  afterEach(() => vi.unstubAllGlobals());

  it('removes a game from history and session stats, and backups and imports leave it out', async () => {
    const { removeGame, DELETED_KEY } = await import('./storage');
    const store = new Store('forage');
    store.addHistory('ci:bin', { score: 3, replayAt: 111, replayId: 'abc' });
    store.addHistory('ci:bin', { score: 5 });
    const backup = exportAll();
    const [first] = store.history('ci:bin');
    expect(removeGame(first)).toBe('forage:111:abc');
    expect(store.history('ci:bin').map((g) => g.score)).toEqual([5]);
    expect(store.sessionHistory('ci:bin').map((g) => g.score)).toEqual([5]);
    // An older backup still has the game: merging and importing it doesn't bring it back.
    const merged = JSON.parse(mergeBackupFiles(exportAll(), backup)).data;
    expect(merged['puzzle-practice:forage:history:ci:bin'].map((g: { score: number }) => g.score)).toEqual([5]);
    expect(merged[DELETED_KEY]).toContain('replay:forage:111:abc');
    importAll(backup);
    expect(store.history('ci:bin').map((g) => g.score)).toEqual([5]);
  });
});
