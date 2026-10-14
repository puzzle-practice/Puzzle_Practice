import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { PyRandom } from '../core/pyrandom';
import { Store, exportAll } from '../core/storage';
import { replayWrites, listReplayFiles } from '../core/replay-storage';
import type { PuzzleReplay, ReplayRecorder } from '../core/replay';
import type { PuzzleContext, PuzzleFactory } from '../core/puzzle';
import { createDrill } from './treasure-haul/training';
import { HaulBoard, isChestOrigin, RUBY, EMERALD } from './treasure-haul/logic';
import { FOUR, IronBoard } from './blacksmithing/logic';
import { Match } from './swordfight/match';
import { W as SWORD_COLUMNS } from './swordfight/board';
import { COL_PX as SWORD_COLUMN_PX } from './swordfight/fighter';
import { setWarningTimer } from '../core/audio';

const captured = vi.hoisted(() => ({ recorders: [] as ReplayRecorder[], sounds: [] as string[] }));
vi.mock('../core/replay', async (original) => {
  const module = await original<typeof import('../core/replay')>();
  return { ...module, ReplayRecorder: class extends module.ReplayRecorder {
    constructor(...args: ConstructorParameters<typeof module.ReplayRecorder>) { super(...args); captured.recorders.push(this); }
  } };
});
vi.mock('../core/assets', async (original) => ({
  ...await original<typeof import('../core/assets')>(),
  Images: class { static async load() { return { get: () => ({ width: 450, height: 600 }), has: () => true }; } },
}));
vi.mock('../core/fonts', () => ({ loadFont: async () => {} }));
vi.mock('../core/audio', async (original) => ({
  ...await original<typeof import('../core/audio')>(),
  SoundBank: class {
    constructor(_urls: unknown, private readonly muted = () => false) {}
    play(name: string) { if (!this.muted()) captured.sounds.push(name); }
    dispose() {}
  },
}));

function canvasContext() {
  return new Proxy({
    measureText: (text: string) => ({ width: text.length * 8 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} });
}
function panelHarness() {
  const buttons = new Map<string, () => void>();
  const setters = new Map<string, (value: number) => void>();
  const selections = new Map<string, (value: string | number) => void>();
  const toggles = new Map<string, (value: boolean) => void>();
  const toggleValues = new Map<string, () => boolean>();
  const tables: Array<() => unknown> = [];
  const results: Array<() => unknown> = [];
  const buttonStates = new Map<string, { disabled?: () => boolean; label?: () => string }>();
  const group = (page: string, title = ''): any => new Proxy({}, { get: (_target, method) => {
    if (method === 'group') return (name: string) => group(page, name);
    if (method === 'button') return (name: string, action: () => void, options: { disabled?: () => boolean; label?: () => string } = {}) => {
      // The real panel evaluates button state immediately, before the factory finishes.
      options.disabled?.();
      options.label?.();
      buttons.set(page + ':' + title + ':' + name, action);
      buttonStates.set(page + ':' + title + ':' + name, options);
      return group(page, title);
    };
    if (method === 'number' || method === 'range') return (name: string, _get: unknown, set: (value: number) => void) => { setters.set(page + ':' + title + ':' + name, set); return group(page, title); };
    if (method === 'select') return (name: string, _options: unknown, _get: unknown, set: (value: string | number) => void) => { selections.set(page + ':' + title + ':' + name, set); return group(page, title); };
    if (method === 'toggle') return (name: string, get: () => boolean, set: (value: boolean) => void) => {
      toggles.set(page + ':' + title + ':' + name, set);
      toggleValues.set(page + ':' + title + ':' + name, get);
      return group(page, title);
    };
    if (method === 'stats') return (_header: unknown, get: () => unknown) => { tables.push(get); return group(page, title); };
    return () => group(page, title);
  } });
  const panel = new Proxy({}, { get: (_target, method) => {
    if (method === 'group') return (title = '') => group('Play', title);
    if (method === 'settings') return group('Settings');
    if (method === 'tab') return (page: string) => group(page);
    if (method === 'historySection') return (part: string) => group('History', part === 'replays' ? 'Replays' : '');
    if (method === 'results') return (get: () => unknown) => { results.push(get); };
    return () => group('Play');
  } });
  return { panel, buttons, setters, selections, toggles, toggleValues, buttonStates, stats: () => tables.map((get) => get()), results: () => results.map((get) => get()) };
}

beforeEach(async () => {
  await replayWrites.idle();
  captured.recorders = [];
  captured.sounds = [];
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal('navigator', { storage: {} });
  // Face layers now load for the player's live Swordfight portrait as well as reports.
  vi.stubGlobal('Image', class {
    width = 58; height = 58;
    onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal('document', { createTextNode: (text: string) => ({ textContent: text }), createElement: () => ({
    width: 450, height: 600, getContext: canvasContext,
    style: {}, setAttribute() {}, addEventListener() {}, replaceChildren() {}, append() {},
  }) });
});

describe('Distilling session dismissal', () => {
  it.each(['Practice', 'Create'])('%s ends without a duty report popup or a saved report', async (mode) => {
    const store = new Store('distilling');
    store.set('mode', mode);
    const { panel, buttons, results } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./distilling/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    now = 1000;
    buttons.get('Play::Start')!();
    expect(results()[0]).toBeNull();
    // Nothing was sent up, so the session isn't kept with the past games.
    if (mode === 'Practice') expect(store.history('Practice:0-0')).toHaveLength(0);
    instance.dispose?.();
  });

  it('counts successful swaps once, excludes paused time and freezes the final rate', async () => {
    const store = new Store('distilling');
    store.set('mode', 'Standard');
    store.set('timerOn', false);
    const { panel, buttons, stats, results } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./distilling/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now } as unknown as PuzzleContext);
    const brew = (window as unknown as { __brew: {
      game: { board: { allSwaps(): [number, number, number, number][] } };
      setCursor(col: number, row: number): void;
      selOrSwap(): void;
    } }).__brew;
    const swap = () => {
      const [ac, ar, bc, br] = brew.game.board.allSwaps()[0];
      brew.setCursor(ac, ar); brew.selOrSwap();
      brew.setCursor(bc, br); brew.selOrSwap();
    };
    buttons.get('Play::Start')!();
    swap();
    now = 2000;
    instance.frame([]);
    expect(stats()[0]).toContainEqual(['Swaps per second', '0.50']);
    buttons.get('Play::Pause')!();
    now = 62000;
    instance.frame([]);
    expect(stats()[0]).toContainEqual(['Swaps per second', '0.50']);
    buttons.get('Play::Pause')!();
    swap();
    now = 64000;
    instance.frame([]);
    buttons.get('Play::Start')!();
    const result = results()[0] as { rows: string[][] };
    expect(result.rows).toContainEqual(['Swaps', '2']);
    expect(result.rows).toContainEqual(['Swaps per second', '0.50']);
    now = 70000;
    expect(stats()[0]).toContainEqual(['Swaps per second', '0.50']);
    instance.dispose?.();
  });

  it.each(['button', 'navigation'] as const)('completes a full-jug Crystal Clear streak through %s without scoring another column', async (ending) => {
    const store = new Store('distilling');
    store.set('mode', 'Seeded');
    store.set('timerOn', false);
    store.set('spawnRates', [0, 0, 0, 0, 1]);
    vi.stubGlobal('navigator', { storage: {}, clipboard: { readText: async () => '8' + '4'.repeat(85) } });
    const { panel, buttons, buttonStates, stats, results } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const context = { screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext;
    const factory = (await import('./distilling/index')).default;
    const instance = await factory(context);
    buttons.get('Play:Seed:Paste')!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    buttons.get('Play::Start')!();
    for (let column = 0; column < 12; column++) {
      now = column * 2000;
      instance.frame([{ type: 'keydown', key: 'x' }]);
      now += 1500;
      instance.frame([]);
    }
    // A Crystal Clear streak can continue beyond a full jug; dismissal should bank its score.
    expect(buttonStates.get('Play::Start')!.label!()).toBe('Dismiss');
    const scoreBefore = stats()[0];
    buttons.get('Play::Pause')!();
    if (ending === 'button') buttons.get('Play::Start')!();
    else instance.dispose?.();
    expect(buttonStates.get('Play::Start')!.label!()).toBe('Start');
    expect(buttonStates.get('Play::Pause')!.label!()).toBe('Pause');
    const result = results()[0] as { rows: string[][] };
    expect(result.rows.find(([name]) => name === 'Columns distilled')![1]).toBe('12');
    expect(result.rows.find(([name]) => name === 'Columns burnt')![1]).toBe('0');
    expect(result.rows.find(([name]) => name === 'Longest crystal chain')![1]).toBe('12');
    expect(result.rows).toContainEqual(['Junk left', '0']);
    expect(result.rows[0]).toEqual((scoreBefore as string[][])[0]);
    await replayWrites.idle();
    const data = JSON.parse(exportAll()).data;
    const histories = Object.entries(data).filter(([key]) => key.includes(':history:'));
    expect(histories).toHaveLength(1);
    expect(histories[0][1]).toHaveLength(1);
    const [replay] = await listReplayFiles('distilling');
    expect(replay).toBeDefined();
    if (ending === 'button') {
      const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
      expect(await captured.recorders[0].playAt(replay.at, replay.runId)).toBe(true);
      perf.mockReturnValue(replay.duration);
      instance.frame([]);
      expect(results()[0]).toEqual(result);
      expect(JSON.parse(exportAll()).data).toEqual(data);
      buttons.get('History:Replays:Stop')!();
      instance.dispose?.();
      expect(JSON.parse(exportAll()).data).toEqual(data);
    }
    expect(await listReplayFiles('distilling')).toHaveLength(1);
  });
});
afterEach(async () => {
  await replayWrites.idle();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('timed puzzle warnings', () => {
  it.each([
    ['forage', { settings: { mode: 'ci', roundSeconds: 0 } }],
    ['blacksmithing', { perfectTimer: 0 }],
    ['treasure-haul', { mode: 'clear', clearPack: 'emeralds', round: 0 }],
    ['vampire-carp', { config: { unlimited: true } }],
  ] as const)('%s has no session warning without a time limit', async (puzzle, settings) => {
    const store = new Store(puzzle);
    for (const [key, value] of Object.entries(settings)) store.set(key, value);
    const { panel, buttons } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./' + puzzle + '/index')).default as PuzzleFactory;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    for (now = 0; now <= 125000; now += 1000) instance.frame([]);
    expect(captured.sounds.filter((name) => name === 'cultist_attack' || name === 'vampire_warning')).toHaveLength(0);
    instance.dispose?.();
  });

  it.each([
    ['forage', 89000, 92000, 'cultist_attack', { settings: { mode: 'ci', roundSeconds: 120 } }],
    ['blacksmithing', 89999, 90000, 'cultist_attack', {}],
    ['treasure-haul', 104999, 105000, 'vampire_warning', { mode: 'clear', clearPack: 'emeralds' }],
    ['vampire-carp', 104999, 105000, 'vampire_warning', {}],
  ] as const)('%s uses remaining session time, excludes pauses and resets on restart', async (puzzle, before, at, sound, settings) => {
    const store = new Store(puzzle);
    for (const [key, value] of Object.entries(settings)) store.set(key, value);
    const { panel, buttons } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./' + puzzle + '/index')).default as PuzzleFactory;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now } as unknown as PuzzleContext);
    const warnings = () => captured.sounds.filter((name) => name === sound);
    const advance = (end: number) => {
      for (; now < end; now = Math.min(end, now + 1000)) instance.frame([]);
      instance.frame([]);
    };
    buttons.get('Play::Start')!();
    advance(before);
    expect(warnings()).toHaveLength(0);
    buttons.get('Play::Pause')!();
    now += 60000;
    instance.frame([]);
    expect(warnings()).toHaveLength(0);
    buttons.get('Play::Pause')!();
    advance(at + 60000);
    expect(warnings()).toHaveLength(1);
    advance(now + 1000);
    expect(warnings()).toHaveLength(1);
    buttons.get('Play::Start')!();
    buttons.get('Play::Start')!();
    setWarningTimer(false);
    advance(now + at);
    expect(warnings()).toHaveLength(1);
    buttons.get('Play::Start')!();
    buttons.get('Play::Start')!();
    setWarningTimer(true);
    advance(now + at);
    expect(warnings()).toHaveLength(2);
    instance.dispose?.();
  });
});

describe('preset Treasure Haul drills', () => {
  it.each(['moving', 'paused', 'haul'] as const)('retries the exact edge board during %s, restores refills and replays without duplicate credit', async (stage) => {
    vi.spyOn(PyRandom.prototype, 'seedFromCrypto').mockImplementation(function (this: PyRandom) { this.seed(1234); });
    const store = new Store('treasure-haul');
    store.set('mode', 'clear'); store.set('clearPack', 'edges'); store.set('round', 120);
    const { panel, buttons, buttonStates, setters, stats, results } = panelHarness();
    let now = 100;
    const input = { mouse: [-1, -1] };
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./treasure-haul/index')).default;
    const boards = vi.spyOn(HaulBoard.prototype, 'populate');
    const instance = await factory({ screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    const first = boards.mock.contexts.at(-1)! as HaulBoard;
    const initial = [...first.cells];
    const rng = new PyRandom(1234);
    const expected = createDrill(() => rng.random(), 'edges');
    expect(initial).toEqual(expected.board.cells);
    boards.mockClear();
    const move = ([x, y]: [number, number]) => {
      input.mouse = [44 + x * 45 + 10, 205 + (8 - y) * 45 + 10];
      instance.frame([{ type: 'mousedown', button: 1, pos: input.mouse as [number, number] }]);
    };
    now = 200;
    if (stage === 'haul') {
      for (let i = 0; i < expected.solution!.length; i++) {
        move(expected.solution![i]);
        if (i < expected.solution!.length - 1) for (let frame = 0; frame < 80; frame++) { now += 50; instance.frame([]); }
      }
      for (let frame = 0; frame < 200 && !(stats()[0] as string[][]).some(([label, value]) => label === 'Chests cleared' && value === '1'); frame++) {
        now += 25; instance.frame([]);
      }
      expect(stats()[0]).toContainEqual(['Chests cleared', '1', expect.any(String)]);
      expect(boards.mock.calls).toHaveLength(0);
    } else move(expected.solution![0]);
    expect(first.cells).not.toEqual(initial);
    if (stage === 'paused') {
      buttons.get('Play::Pause')!();
      now += 5000; instance.frame([]);
    }
    expect(buttonStates.get('Play::Retry')!.disabled!()).toBe(false);
    buttons.get('Play::Retry')!();
    const retried = boards.mock.contexts.at(-1)! as HaulBoard;
    expect(retried).not.toBe(first);
    expect(retried.cells).toEqual(initial);
    expect(stats()[0]).toContainEqual(['Chests cleared', '0', expect.any(String)]);
    if (stage === 'paused') buttons.get('Play::Pause')!();
    for (let frame = 0; frame < 80; frame++) { now += 50; instance.frame([]); }
    expect(retried.cells).toEqual(initial);
    // Play the exact same route. Restoring only the visible pieces would lose
    // the refill stream and could change this route after its first clear.
    for (const swap of expected.solution!) {
      move(swap);
      for (let frame = 0; frame < 80; frame++) { now += 50; instance.frame([]); }
    }
    expect(stats()[0]).toContainEqual(['Chests cleared', '1', expect.any(String)]);
    const nextDrill = [...(boards.mock.contexts.at(-1)! as HaulBoard).cells];
    buttons.get('Play::Retry')!();
    expect((boards.mock.contexts.at(-1)! as HaulBoard).cells).toEqual(nextDrill);
    expect(stats()[0]).toContainEqual(['Chests cleared', '1', expect.any(String)]);
    now = stage === 'paused' ? 125100 : 120100; instance.frame([]);
    expect((results()[0] as { rows: string[][] }).rows).toEqual(expect.arrayContaining([['Time', '120.00s'], ['Chests cleared', '1']]));
    expect(buttonStates.get('Play::Retry')!.disabled!()).toBe(true);
    const finalStats = stats();
    await replayWrites.idle();
    const [replay] = await listReplayFiles('treasure-haul');
    const data = JSON.parse(exportAll()).data;
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    const recorder = captured.recorders[0];
    expect(await recorder.playAt(replay.at, replay.runId)).toBe(true);
    perf.mockReturnValue(replay.duration); instance.frame([]);
    expect(stats()).toEqual(finalStats);
    setters.get('History:Replays:Jump to (s)')!(replay.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    expect(stats()).toEqual(finalStats);
    expect(JSON.parse(exportAll()).data).toEqual(data);
    buttons.get('History:Replays:Stop')!();
    instance.dispose?.();
  });

  it('persists impossible chests, dismisses without credit and restores the setting after replay', async () => {
    vi.spyOn(PyRandom.prototype, 'seedFromCrypto').mockImplementation(function (this: PyRandom) { this.seed(1); });
    const store = new Store('treasure-haul');
    store.set('mode', 'clear'); store.set('clearPack', 'edges'); store.set('round', 30);
    const { panel, buttons, toggles, toggleValues, stats, setters } = panelHarness();
    const setting = 'Settings:Training:Impossible chests';
    let now = 100;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./treasure-haul/index')).default;
    const boards = vi.spyOn(HaulBoard.prototype, 'placeChest');
    const latestBoard = () => boards.mock.contexts.at(-1)! as HaulBoard;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    expect(toggleValues.get(setting)!()).toBe(false);
    toggles.get(setting)!(true);
    expect(store.get('impossibleChests', false)).toBe(true);
    buttons.get('Play::Start')!();
    const initial = [...latestBoard().cells];
    const rng = new PyRandom(1);
    const expected = createDrill(() => rng.random(), 'edges', 5, { impossibleChests: true });
    expect(expected.impossible).toBe(true);
    expect(initial).toEqual(expected.board.cells);
    buttons.get('Play::Retry')!();
    expect(latestBoard().cells).toEqual(initial);
    now = 200; instance.frame([]);
    buttons.get('Play::Dismiss')!();
    for (let frame = 0; frame < 150; frame++) { now += 50; instance.frame([]); }
    const afterDismiss = [...latestBoard().cells];
    expect(afterDismiss).not.toEqual(initial);
    expect(stats()[0]).toContainEqual(['Chests cleared', '0', expect.any(String)]);
    now = 30100; instance.frame([]);
    const finalStats = stats();
    await replayWrites.idle();
    const [replay] = await listReplayFiles('treasure-haul');
    const { readReplayFile } = await import('../core/replay-storage');
    const { decodeReplayBlob } = await import('../core/replay');
    const tape = (await decodeReplayBlob((await readReplayFile(replay))!))!;
    expect(tape).toMatchObject({ settingsVersion: 14, settings: { trainingRules: 8, impossibleChests: true } });
    toggles.get(setting)!(false);
    const data = JSON.parse(exportAll()).data;
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    const recorder = captured.recorders[0];
    expect(await recorder.playAt(replay.at, replay.runId)).toBe(true);
    expect(toggleValues.get(setting)!()).toBe(true);
    expect(latestBoard().cells).toEqual(initial);
    perf.mockReturnValue(replay.duration); instance.frame([]);
    expect(latestBoard().cells).toEqual(afterDismiss);
    expect(stats()).toEqual(finalStats);
    setters.get('History:Replays:Jump to (s)')!(replay.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    expect(latestBoard().cells).toEqual(afterDismiss);
    expect(stats()).toEqual(finalStats);
    expect(JSON.parse(exportAll()).data).toEqual(data);
    buttons.get('History:Replays:Stop')!();
    expect(toggleValues.get(setting)!()).toBe(false);
    expect(store.get('impossibleChests', true)).toBe(false);
    instance.dispose?.();
  });

  it.each(['edges'] as const)('%s starts immediately and reproduces its moves during replay', async (pack) => {
    vi.spyOn(PyRandom.prototype, 'seedFromCrypto').mockImplementation(function (this: PyRandom) { this.seed(1234); });
    const store = new Store('treasure-haul');
    store.set('mode', 'clear');
    store.set('clearPack', pack);
    store.set('round', 300);
    store.set('showEmeraldSightLines', true);
    // Emerald and difficult edge drills override saved ruby rates, including on refills.
    store.set('gemRates', [100, 0]);
    const { panel, buttons, buttonStates, stats, setters } = panelHarness();
    let now = 100;
    const input = { mouse: [-1, -1] };
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const context = { screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext;
    const factory = (await import('./treasure-haul/index')).default;
    const instance = await factory(context);
    const rng = new PyRandom(1234);
    const expected = createDrill(() => rng.random(), pack);
    buttons.get('Play::Start')!();
    expect(buttonStates.get('Play::Dismiss')!.disabled!()).toBe(false);
    const swaps = vi.spyOn(HaulBoard.prototype, 'swap');
    const moves = expected.solution ?? [expected.opening ?? [0, 1]];
    for (const [x, y] of moves) {
      input.mouse = [44 + x * 45 + 10, 205 + (8 - y) * 45 + 10];
      const before = swaps.mock.calls.length;
      instance.frame([{ type: 'mousedown', button: 1, pos: input.mouse as [number, number] }]);
      expect(swaps.mock.calls[before]).toEqual([x, y]);
      for (let frame = 0; frame < 150; frame++) { now += 50; instance.frame([]); }
    }
    now = Math.max(now, 300100);
    for (let frame = 0; frame < 300; frame++) { now += 50; instance.frame([]); }
    await replayWrites.idle();
    const finalStats = stats();
    if (pack === 'edges') expect(finalStats[0]).toContainEqual(['Chests cleared', '1', expect.any(String)]);
    const [replay] = await listReplayFiles('treasure-haul');
    expect(replay.settingsVersion).toBe(14);
    const data = JSON.parse(exportAll()).data;
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await captured.recorders[0].playAt(replay.at, replay.runId)).toBe(true);
    perf.mockReturnValue(replay.duration);
    instance.frame([]);
    expect(stats()).toEqual(finalStats);
    expect(JSON.parse(exportAll()).data).toEqual(data);
    setters.get('History:Replays:Jump to (s)')!(replay.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(captured.recorders[0].isSeeking).toBe(false));
    expect(stats()).toEqual(finalStats);
    expect(JSON.parse(exportAll()).data).toEqual(data);
    buttons.get('History:Replays:Stop')!();
    instance.dispose?.();
  });

  it.each([['emeralds', 5, 2], ['edges', 6, 3], ['edges', 7, 4], ['edges', 8, 4]] as const)('plays historical %s version %i layouts and restores the new pack afterward', async (pack, version, rules) => {
    const { encodeReplayBlob, replayMetadata } = await import('../core/replay');
    const { saveReplayFile } = await import('../core/replay-storage');
    const tape: PuzzleReplay = {
      format: 'puzzle-practice-replay', version: 1, puzzle: 'treasure-haul', at: 1, duration: 0, clockStart: 0,
      settingsVersion: version, simulatorVersion: version, result: 'Historical drill', frames: [], steps: [],
      seed: new PyRandom(7).snapshot(),
      settings: { mode: 'clear', clearPack: pack, roundSecs: 30, spawnDelay: false, gemRates: [0, 0],
        coinsPerChest: 100, chestRules: 4, trainingRules: rules, dismissRules: 2,
        ...(version >= 7 ? { impossibleChests: false } : {}) },
    };
    const blob = await encodeReplayBlob(tape);
    await saveReplayFile({ metadata: replayMetadata(tape, blob.size), blob });
    const boards = vi.spyOn(HaulBoard.prototype, 'populate');
    const store = new Store('treasure-haul');
    store.set('mode', 'clear'); store.set('clearPack', pack);
    const { panel, buttons } = panelHarness();
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./treasure-haul/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => 0 } as unknown as PuzzleContext);
    const recorder = captured.recorders[0];
    await vi.waitFor(() => expect(recorder.hasPlayableAt(tape.at)).toBe(true));
    vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(tape.at)).toBe(true);
    const rng = new PyRandom(7);
    expect((boards.mock.contexts.at(-1)! as HaulBoard).cells).toEqual(createDrill(() => rng.random(), pack, rules).board.cells);
    recorder.stop();
    boards.mockClear();
    buttons.get('Play::Start')!();
    const board = boards.mock.contexts.at(-1)! as HaulBoard;
    if (pack === 'emeralds') {
      for (const x of [0, 7]) expect(Array.from({ length: 8 }, (_, y) => board.get(x, y))).toContain(EMERALD);
    } else expect(Math.floor(board.cells.findIndex(isChestOrigin) / 8)).toBeLessThanOrEqual(2);
    instance.dispose?.();
  });
});

describe('Treasure Haul score display', () => {
  it('keeps progress optional in the sidebar and removes coin scores from every chest-mode result', async () => {
    const store = new Store('treasure-haul');
    const factory = (await import('./treasure-haul/index')).default;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    for (const mode of ['0', 'chests1', 'chests2', 'spawn', 'rubies', 'clear']) {
      store.set('mode', mode);
      const { panel, buttons, toggles, stats, results } = panelHarness();
      const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => 100 } as unknown as PuzzleContext);
      const labels = () => (stats()[0] as string[][]).map(([label]) => label);
      toggles.get('Settings:Display:Show coin progress')!(false);
      toggles.get('Settings:Display:Show waiting chests')!(false);
      expect(labels()).not.toContain('Coins toward next chest');
      expect(labels()).not.toContain('Chests waiting');
      toggles.get('Settings:Display:Show coin progress')!(true);
      if (mode === 'chests1' || mode === 'chests2') expect(labels()).toContain('Coins toward next chest');
      expect(labels()).not.toContain('Chests waiting');
      toggles.get('Settings:Display:Show waiting chests')!(true);
      if (mode === 'chests1' || mode === 'chests2') expect(labels()).toContain('Chests waiting');
      expect(store.get('showCoinProgress', false)).toBe(true);
      expect(store.get('showWaitingChests', false)).toBe(true);
      buttons.get('Play::Start')!();
      buttons.get('Play::Start')!();
      const resultLabels = (results()[0] as { rows: string[][] }).rows.map(([label]) => label);
      expect(resultLabels).not.toContain('Coins toward next chest');
      expect(resultLabels).not.toContain('Chests waiting');
      if (mode === '0') expect(resultLabels).toEqual(expect.arrayContaining(['Points', 'Coins', 'Best move']));
      else for (const label of ['Points', 'Coins', 'Best move']) expect(resultLabels).not.toContain(label);
      instance.dispose?.();
    }
  });
});

describe('Rubies spawn mode', () => {
  it.each([
    { rubies: [2], chestX: 2, points: 1 },
    { rubies: [2, 3], chestX: 2, points: 2 },
    { rubies: [6], chestX: 2, points: 0 },
    { rubies: [2], chestX: 1, points: 0 },
  ])('scores $points for rubies $rubies over chest column $chestX, refreshes and replays', async ({ rubies, chestX, points }) => {
    const training = await import('./treasure-haul/training');
    const create = training.createRubyBoard;
    const boards = vi.spyOn(training, 'createRubyBoard').mockImplementation((random) => {
      const board = create(random);
      for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) board.set(x, y, (x + y) % 4);
      for (const x of rubies) board.set(x, 7, RUBY);
      // An isolated vertical clear starts the one-second chest wait.
      board.set(7, 0, 0); board.set(7, 1, 1); board.set(7, 2, 0); board.set(7, 3, 0);
      // A subsequent swap makes two horizontal threes, opening both chest columns.
      for (const x of [chestX, chestX + 1]) { board.set(x, 2, 0); board.set(x, 1, 1); }
      board.set(chestX + 2, 2, 1); board.set(chestX + 2, 1, 0);
      for (const x of [chestX - 1, chestX + 3]) { board.set(x, 2, 2); board.set(x, 1, 2); }
      expect(board.findRuns()).toHaveLength(0);
      return board;
    });
    vi.spyOn(HaulBoard.prototype, 'findChestPosition').mockImplementation(function (this: HaulBoard) {
      return this.riseDistance(chestX, -1) >= 2 && this.riseDistance(chestX + 1, -1) >= 2 ? chestX : -1;
    });
    const store = new Store('treasure-haul'); store.set('round', 30); store.set('gemRates', [100, 0]);
    const { panel, buttons, selections, setters, stats, results } = panelHarness();
    let now = 100;
    const input = { mouse: [-1, -1] };
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./treasure-haul/index')).default;
    const instance = await factory({ screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    selections.get('Play::Mode')!('rubies');
    expect(store.get('mode', '')).toBe('rubies');
    const swap = (x: number, y: number) => {
      input.mouse = [44 + x * 45 + 10, 205 + (8 - y) * 45 + 10];
      instance.frame([{ type: 'mousedown', button: 1, pos: input.mouse as [number, number] }]);
    };
    buttons.get('Play::Start')!();
    const firstBoard = boards.mock.results[0].value as HaulBoard;
    expect(firstBoard.gemRates).toEqual([0, 0]);
    for (; now <= 5000; now += 25) instance.frame([]);
    // Rubies starts as if the first clear and its one-second wait have already happened.
    expect(firstBoard.chestReady()).toBe(true);
    expect(firstBoard.cells.some(isChestOrigin)).toBe(false);
    const step = HaulBoard.prototype.step;
    let clearAt = 0; let spawnAt = 0;
    vi.spyOn(HaulBoard.prototype, 'step').mockImplementation(function (this: HaulBoard) {
      const result = step.call(this);
      if (this === firstBoard && result?.kind === 'match' && !clearAt) clearAt = now;
      if (this === firstBoard && result?.kind === 'rise' && result.moves.some((move) => isChestOrigin(move.piece) && move.fy < 0)) spawnAt = now;
      return result;
    });
    swap(7, 1);
    while (!clearAt) { now += 25; instance.frame([]); }
    for (let frame = 0; frame < 120; frame++) { now += 25; instance.frame([]); }
    // That clear left no room under the chest columns, so nothing has come in yet.
    expect(spawnAt).toBe(0);
    swap(chestX + 2, 2);
    for (let frame = 0; frame < 250 && boards.mock.calls.length < 2; frame++) { now += 25; instance.frame([]); }
    expect(spawnAt).toBeGreaterThan(clearAt);
    expect(boards.mock.calls).toHaveLength(2);
    expect(stats()[0]).toContainEqual(['Ruby score', String(points), expect.any(String)]);
    buttons.get('Play::Dismiss')!();
    for (let frame = 0; frame < 120; frame++) { now += 25; instance.frame([]); }
    expect(boards.mock.calls).toHaveLength(3);
    expect(stats()[0]).toContainEqual(['Ruby score', String(points), expect.any(String)]);
    now = 35100; instance.frame([]);
    const finalStats = stats();
    expect((results()[0] as { rows: string[][] }).rows).toContainEqual(['Ruby score', String(points)]);
    await replayWrites.idle();
    const [replay] = await listReplayFiles('treasure-haul');
    expect(replay.settingsVersion).toBe(14);
    const data = JSON.parse(exportAll()).data;
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    const recorder = captured.recorders[0];
    expect(await recorder.playAt(replay.at, replay.runId)).toBe(true);
    perf.mockReturnValue(replay.duration); instance.frame([]);
    expect(stats()).toEqual(finalStats);
    setters.get('History:Replays:Jump to (s)')!(replay.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    expect(stats()).toEqual(finalStats);
    expect(JSON.parse(exportAll()).data).toEqual(data);
    buttons.get('History:Replays:Stop')!();
    instance.dispose?.();
  });
});

describe('Treasure Haul vacant-board chest wait', () => {
  it.each([0, 1, 2])('becomes ready while idle with %i starting chests, including pause and replay', async (chests) => {
    vi.spyOn(PyRandom.prototype, 'seedFromCrypto').mockImplementation(function (this: PyRandom) { this.seed(1234); });
    const populate = HaulBoard.prototype.populate;
    const boards = vi.spyOn(HaulBoard.prototype, 'populate').mockImplementation(function (this: HaulBoard) {
      populate.call(this);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) this.set(x, y, (x + 2 * y) % 4);
      if (chests > 0) { this.placeChest(0, 6, 0); this.set(2, 7, RUBY); }
      if (chests === 2) this.placeChest(4, 6, 2);
    });
    let now = 100;
    let lastHaulAt = 0;
    const step = HaulBoard.prototype.step;
    vi.spyOn(HaulBoard.prototype, 'step').mockImplementation(function (this: HaulBoard) {
      const result = step.call(this);
      if (result?.kind === 'haul' && !this.cells.some(isChestOrigin)) lastHaulAt = now;
      return result;
    });
    const store = new Store('treasure-haul'); store.set('mode', 'chests2'); store.set('gemRates', [0, 0]);
    store.set('showWaitingChests', true); store.set('chestCycle', false);
    const { panel, buttons, stats, setters } = panelHarness();
    const input = { mouse: [-1, -1] };
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./treasure-haul/index')).default;
    const context = { screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext;
    let instance = await factory(context);
    buttons.get('Play::Start')!();
    const latestBoard = () => boards.mock.contexts.at(-1)! as HaulBoard;
    const board = latestBoard();
    for (; now < 2100; now += 25) instance.frame([]);
    if (chests) {
      expect(board.chestList).toHaveLength(0);
      input.mouse = [44 + 2 * 45 + 10, 215];
      instance.frame([{ type: 'mousedown', button: 1, pos: input.mouse as [number, number] }]);
      for (let frame = 0; frame < 200 && !lastHaulAt; frame++) { now += 25; instance.frame([]); }
      expect(lastHaulAt).toBeGreaterThan(0);
      expect(board.chestList).toHaveLength(0);
      buttons.get('Play::Pause')!();
      now += 10000; instance.frame([]);
      expect(board.chestList).toHaveLength(0);
      buttons.get('Play::Pause')!();
      // The deadline is a full second of active time after the final haul.
      for (; now < lastHaulAt + 10000 + 1000; now += 25) {
        instance.frame([]);
        expect(board.chestList).toHaveLength(0);
      }
    }
    for (let frame = 0; frame < 200 && !board.chestList.length; frame++) { now += 25; instance.frame([]); }
    expect(board.chestList).toHaveLength(1);
    expect(board.cells.filter(isChestOrigin)).toHaveLength(0);
    for (let frame = 0; frame < 100; frame++) { now += 25; instance.frame([]); }
    expect(board.chestList).toHaveLength(1);
    expect(stats()[0]).toContainEqual(['Chests waiting', '1', expect.any(String)]);
    buttons.get('Play::Start')!();
    const expectedStats = stats();
    await replayWrites.idle();
    const [replay] = await listReplayFiles('treasure-haul');
    expect(replay.settingsVersion).toBe(14);
    const data = JSON.parse(exportAll()).data;
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    const recorder = captured.recorders[0];
    expect(await recorder.playAt(replay.at, replay.runId)).toBe(true);
    perf.mockReturnValue(replay.duration); instance.frame([]);
    expect(stats()).toEqual(expectedStats);
    expect(latestBoard().chestList).toHaveLength(1);
    setters.get('History:Replays:Jump to (s)')!(replay.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    expect(stats()).toEqual(expectedStats);
    expect(JSON.parse(exportAll()).data).toEqual(data);
    buttons.get('History:Replays:Stop')!();
    if (chests === 2) {
      const { decodeReplayBlob, encodeReplayBlob, replayMetadata } = await import('../core/replay');
      const { readReplayFile, saveReplayFile } = await import('../core/replay-storage');
      const tape = (await decodeReplayBlob((await readReplayFile(replay))!))!;
      tape.at++; tape.settingsVersion = 4; tape.simulatorVersion = 4;
      (tape.settings as Record<string, unknown>).chestRules = 3;
      (tape.settings as Record<string, unknown>).trainingRules = 2;
      delete tape.report;
      const blob = await encodeReplayBlob(tape);
      await saveReplayFile({ metadata: replayMetadata(tape, blob.size), blob });
      instance.dispose?.(); instance = await factory(context);
      const oldRecorder = captured.recorders.at(-1)!;
      await vi.waitFor(() => expect(oldRecorder.hasPlayableAt(tape.at, tape.runId)).toBe(true));
      perf.mockReturnValue(0);
      expect(await oldRecorder.playAt(tape.at, tape.runId)).toBe(true);
      perf.mockReturnValue(tape.duration); instance.frame([]);
      expect(latestBoard().chestList).toHaveLength(0);
      expect(JSON.parse(exportAll()).data).toEqual(data);
      buttons.get('History:Replays:Stop')!();
    }
    instance.dispose?.();
  });
});

describe('Treasure Haul dismissal during a cascade', () => {
  it.each(['swap', 'rise', 'haul', 'paused'] as const)('credits the pending haul when dismissed during %s and reproduces it in playback', async (stage) => {
    vi.spyOn(PyRandom.prototype, 'seedFromCrypto').mockImplementation(function (this: PyRandom) { this.seed(1234); });
    const rng = new PyRandom(1234);
    const solution = createDrill(() => rng.random(), 'edges').solution!;
    const store = new Store('treasure-haul');
    store.set('mode', 'clear'); store.set('clearPack', 'edges'); store.set('round', 300);
    const { panel, buttons, buttonStates, stats, results, setters } = panelHarness();
    let now = 100;
    const input = { mouse: [-1, -1] };
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./treasure-haul/index')).default;
    const placements = vi.spyOn(HaulBoard.prototype, 'placeChest');
    const instance = await factory({ screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    const originalBoard = placements.mock.contexts.at(-1)!;
    for (let move = 0; move < solution.length; move++) {
      const [x, y] = solution[move];
      input.mouse = [44 + x * 45 + 10, 205 + (8 - y) * 45 + 10];
      instance.frame([{ type: 'mousedown', button: 1, pos: input.mouse as [number, number] }]);
      if (move < solution.length - 1) for (let frame = 0; frame < 150; frame++) { now += 50; instance.frame([]); }
    }
    const steps = vi.spyOn(HaulBoard.prototype, 'step');
    if (stage === 'rise' || stage === 'haul') {
      let reached = false;
      for (let frame = 0; frame < 150 && !reached; frame++) {
        now += 50; instance.frame([]);
        reached = steps.mock.results.some((result, i) => steps.mock.contexts[i] === originalBoard && result.value &&
          (stage === 'haul' ? result.value.kind === 'haul' : result.value.kind === 'rise' &&
            result.value.moves.some((m: { piece: number; ty: number }) => isChestOrigin(m.piece) && m.ty === 7)));
      }
      expect(reached).toBe(true);
    }
    if (stage === 'paused') buttons.get('Play::Pause')!();
    expect(buttonStates.get('Play::Dismiss')!.disabled!()).toBe(false);
    const before = placements.mock.calls.length;
    buttons.get('Play::Dismiss')!();
    buttons.get('Play::Dismiss')!();
    expect(buttonStates.get('Play::Dismiss')!.label!()).toBe('Dismissing…');
    if (stage === 'paused') {
      now += 5000; instance.frame([]);
      expect(placements.mock.calls).toHaveLength(before);
      buttons.get('Play::Pause')!();
    }
    for (let frame = 0; frame < 150; frame++) { now += 50; instance.frame([]); }
    expect(placements.mock.calls.length).toBeGreaterThan(before);
    expect(buttonStates.get('Play::Dismiss')!.label!()).toBe('Dismiss');
    expect(stats()[0]).toContainEqual(['Chests cleared', '1', expect.any(String)]);
    now = Math.max(now, 300100); instance.frame([]);
    for (let frame = 0; frame < 300 && buttonStates.get('Play::Start')!.label!() === 'Stop'; frame++) { now += 50; instance.frame([]); }
    const finalStats = stats();
    expect((results()[0] as { rows: string[][] }).rows).toContainEqual(['Chests cleared', '1']);
    await replayWrites.idle();
    const [replay] = await listReplayFiles('treasure-haul');
    const data = JSON.parse(exportAll()).data;
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await captured.recorders[0].playAt(replay.at, replay.runId)).toBe(true);
    perf.mockReturnValue(replay.duration); instance.frame([]);
    expect(stats()).toEqual(finalStats);
    expect(JSON.parse(exportAll()).data).toEqual(data);
    const warningsBeforeSeeking = captured.sounds.filter((name) => name === 'cultist_attack' || name === 'vampire_warning');
    setters.get('History:Replays:Jump to (s)')!(replay.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(captured.recorders[0].isSeeking).toBe(false));
    expect(captured.sounds.filter((name) => name === 'cultist_attack' || name === 'vampire_warning')).toEqual(warningsBeforeSeeking);
    expect(stats()).toEqual(finalStats);
    buttons.get('History:Replays:Stop')!();
    instance.dispose?.();
  });

  it('accepts dismissal during the opening animation without restarting the session timer', async () => {
    const store = new Store('treasure-haul'); store.set('round', 30);
    const { panel, buttons, buttonStates, stats, results } = panelHarness();
    let now = 100;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./treasure-haul/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    expect(buttonStates.get('Play::Dismiss')!.disabled!()).toBe(false);
    buttons.get('Play::Dismiss')!();
    now = 2100; instance.frame([]);
    now = 3100; instance.frame([]);
    expect(stats()[0]).toContainEqual(['Chests hauled', '0', expect.any(String)]);
    now = 32100; instance.frame([]);
    expect(buttonStates.get('Play::Start')!.label!()).toBe('Play again');
    expect((results()[0] as { rows: string[][] }).rows).toContainEqual(['Time', '30.00s']);
    instance.dispose?.();
  });

  it('counts both chests in a two-chest blast cascade before replacing the board', async () => {
    const populate = HaulBoard.prototype.populate;
    vi.spyOn(HaulBoard.prototype, 'populate').mockImplementation(function (this: HaulBoard) {
      populate.call(this);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) this.set(x, y, (x + 2 * y) % 4);
      this.placeChest(0, 6, 0); this.placeChest(4, 6, 2); this.set(2, 7, RUBY);
    });
    const store = new Store('treasure-haul'); store.set('gemRates', [0, 0]);
    const { panel, buttons, buttonStates, stats } = panelHarness();
    let now = 100;
    const input = { mouse: [-1, -1] };
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./treasure-haul/index')).default;
    const instance = await factory({ screen, input, panel, store, ticks: () => now } as unknown as PuzzleContext);
    buttons.get('Play::Start')!(); now = 2100; instance.frame([]);
    input.mouse = [44 + 2 * 45 + 10, 215];
    instance.frame([{ type: 'mousedown', button: 1, pos: input.mouse as [number, number] }]);
    expect(buttonStates.get('Play::Dismiss')!.disabled!()).toBe(false);
    buttons.get('Play::Dismiss')!();
    for (let frame = 0; frame < 150; frame++) { now += 50; instance.frame([]); }
    expect(stats()[0]).toContainEqual(['Chests hauled', '2', expect.any(String)]);
    instance.dispose?.();
  });
});

describe('Blacksmithing perfect board scoring', () => {
  it.each([[0, 3], [1, 1], [2, -1]] as const)('scores %i squares left as %i, including negative bests and replays', async (remaining, points) => {
    const populate = IronBoard.prototype.populate;
    vi.spyOn(IronBoard.prototype, 'populate').mockImplementation(function (this: IronBoard) {
      populate.call(this);
      // The final strike is a 4 on a 3x3 board, so no further move is possible.
      this.pieces.flat().forEach((piece, i) => { piece.type = FOUR; piece.condition = i <= remaining ? 1 : 0; });
      this.numHits = 8 - remaining;
    });
    const store = new Store('blacksmithing');
    // No saved settings: a new session should be Perfect board with a two-minute timer.
    const { panel, buttons, setters, stats, results } = panelHarness();
    let now = 0;
    const input = { mouse: [-1, -1] };
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./blacksmithing/index')).default;
    const context = { screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext;
    let instance = await factory(context);
    buttons.get('Play::Start')!();
    for (; now <= 1000; now += 25) instance.frame([]);
    const pos: [number, number] = [162, 177];
    instance.frame([{ type: 'mousedown', button: 1, pos }, { type: 'mouseup', button: 1, pos }]);
    for (; now <= 5000; now += 25) instance.frame([]);
    expect(stats().flat()).toContainEqual(['Points', String(points), '']);
    now = 120000; instance.frame([]);
    expect(results()[0]).toMatchObject({ rows: expect.arrayContaining([['Points', String(points)], ['Boards', '1']]) });
    expect(store.get<Record<string, number>>('perfectTimedBests', {})).toEqual({ '3-4:scoring2': points });
    await replayWrites.idle();
    const replay = (await listReplayFiles('blacksmithing'))[0];
    expect(replay).toMatchObject({ settingsVersion: 2, simulatorVersion: 2, duration: 120000 });
    const data = JSON.parse(exportAll()).data;
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    const recorder = captured.recorders[0];
    expect(await recorder.playAt(replay.at, replay.runId)).toBe(true);
    perf.mockReturnValue(replay.duration); instance.frame([]);
    expect(stats().flat()).toContainEqual(['Points', String(points), String(points)]);
    const warningsBeforeSeeking = captured.sounds.filter((name) => name === 'cultist_attack' || name === 'vampire_warning');
    setters.get('History:Replays:Jump to (s)')!(120);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    expect(captured.sounds.filter((name) => name === 'cultist_attack' || name === 'vampire_warning')).toEqual(warningsBeforeSeeking);
    expect(stats().flat()).toContainEqual(['Points', String(points), String(points)]);
    expect(JSON.parse(exportAll()).data).toEqual(data);
    buttons.get('History:Replays:Stop')!();
    if (remaining === 2) {
      const { decodeReplayBlob, encodeReplayBlob, replayMetadata } = await import('../core/replay');
      const { readReplayFile, saveReplayFile } = await import('../core/replay-storage');
      const tape = (await decodeReplayBlob((await readReplayFile(replay))!))!;
      tape.at++;
      tape.settingsVersion = 1; tape.simulatorVersion = 1;
      delete (tape.settings as Record<string, unknown>).scoringRules;
      delete tape.report;
      tape.result = 'Points 0';
      const blob = await encodeReplayBlob(tape);
      await saveReplayFile({ metadata: replayMetadata(tape, blob.size), blob });
      instance.dispose?.();
      instance = await factory(context);
      const legacyRecorder = captured.recorders.at(-1)!;
      await vi.waitFor(() => expect(legacyRecorder.hasPlayableAt(tape.at, tape.runId)).toBe(true));
      perf.mockReturnValue(0);
      expect(await legacyRecorder.playAt(tape.at, tape.runId)).toBe(true);
      perf.mockReturnValue(tape.duration); instance.frame([]);
      expect(stats().flat()).toContainEqual(['Points', '0', '']);
      buttons.get('History:Replays:Stop')!();
      expect(JSON.parse(exportAll()).data).toEqual(data);
    }
    instance.dispose?.();
  });
});

describe('Swordfight roster settings', () => {
  it('starts 200 enemies, edits the last NPC, and scrolls both lists without losing replay targets', async () => {
    const store = new Store('swordfight');
    const { panel, buttons, setters, selections } = panelHarness();
    let now = 0;
    let match!: Match;
    const update = Match.prototype.update;
    vi.spyOn(Match.prototype, 'update').mockImplementation(function (this: Match, time: number) {
      match = this; update.call(this, time);
    });
    const ctx = canvasContext();
    const fillText = vi.fn();
    Object.assign(ctx, { fillText });
    const screen = new Proxy({ ctx }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./swordfight/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; },
    } as unknown as PuzzleContext);
    setters.get('Settings:Opponents:Number')!(200);
    setters.get('Settings:Teammates:Number')!(199);
    selections.get('Settings:Customise opponent:NPC')!(199);
    selections.get('Settings:Customise opponent:Type')!('Homunculus');
    selections.get('Settings:Customise opponent:Sword')!(11);
    setters.get('Settings:Customise opponent:Skill')!(80);
    const saved = store.get<any>('settings', null);
    expect(saved.enemyRoster).toHaveLength(200);
    expect(saved.allyRoster).toHaveLength(199);
    expect(saved.enemyRoster[199]).toEqual({ kind: 'Homunculus', sword: 11, skill: 80 });
    expect(saved.enemyRoster[0]).toEqual({ kind: 'Cultist', sword: 16, skill: 60 });
    buttons.get('Play::Start')!();
    instance.frame([]);
    expect(match.fighters).toHaveLength(400);
    expect(match.rows.map((rows) => rows.length)).toEqual([200, 200]);
    const range = (x: number) => [...fillText.mock.calls].reverse().find(([text, at]) => at === x && /^\d+–\d+\/200$/.test(text))?.[0];
    const click = (button: number, x: number, y: number) => instance.frame([
      { type: 'mousedown', button, pos: [x, y] }, { type: 'mouseup', button, pos: [x, y] },
    ]);
    expect(range(381)).toBe('1–6/200');
    click(5, 320, 120);
    expect(range(381)).toBe('2–7/200');
    click(1, 320, 110);
    expect(match.target).toBe(match.rows[1][1]);
    click(1, 430, 489);
    expect(range(381)).toBe('8–13/200');
    click(4, 320, 120);
    expect(range(381)).toBe('7–12/200');
    click(5, 20, 120);
    expect(range(69)).toBe('2–7/200');
    expect(range(381)).toBe('7–12/200');
    buttons.get('Play::Pause')!();
    const beforePause = match.fighters.map((fighter) => ({ ...fighter.stats }));
    now = 10_000;
    click(5, 320, 120);
    expect(range(381)).toBe('8–13/200');
    expect(match.fighters.map((fighter) => ({ ...fighter.stats }))).toEqual(beforePause);
    buttons.get('Play::Pause')!();
    click(1, 320, 110);
    expect(match.target).toBe(match.rows[1][7]);
    // Changing targets with the keys reveals targets outside the scrolled window.
    instance.frame(Array.from({ length: 193 }, () => ({ type: 'keydown' as const, key: 's' })));
    expect(match.target).toBe(match.rows[1][0]);
    expect(range(381)).toBe('1–6/200');
    click(1, 430, 489);
    click(1, 320, 110);
    expect(match.target).toBe(match.rows[1][6]);
    now += 1000;
    instance.frame([]);
    buttons.get('Play::Start')!();
    const target = match.target;
    const expected = match.fighters.map((fighter) => ({ ...fighter.stats }));
    await replayWrites.idle();
    const [replay] = await listReplayFiles('swordfight');
    const recorder = captured.recorders[0];
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(replay.at, replay.runId)).toBe(true);
    perf.mockReturnValue(replay.duration);
    instance.frame([]);
    expect(match.target).toBe(target);
    expect(match.fighters.map((fighter) => ({ ...fighter.stats }))).toEqual(expected);
    setters.get('History:Replays:Jump to (s)')!(replay.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    expect(match.target).toBe(target);
    expect(match.fighters.map((fighter) => ({ ...fighter.stats }))).toEqual(expected);
    recorder.stop();
    instance.dispose?.();
  });

  it.each([3, 6])('keeps historical version %s fights and a saved player sword unchanged', async (version) => {
    const store = new Store('swordfight');
    store.set('settings', { cultists: 1, homunculi: 1, opponents: 2, thralls: 1, swabbies: 1,
      cultistSkill: 20, homunculusSkill: 80, thrallSkill: 40, swabbieSkill: 55,
      difficulty: 5, breakers: 12.5, sword: [2, 1, 5] });
    const { panel, buttons } = panelHarness();
    let now = 0;
    let match!: Match;
    const update = Match.prototype.update;
    vi.spyOn(Match.prototype, 'update').mockImplementation(function (this: Match, time: number) {
      match = this; update.call(this, time);
    });
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const context = { screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; },
    } as unknown as PuzzleContext;
    const factory = (await import('./swordfight/index')).default;
    let instance = await factory(context);
    buttons.get('Play::Start')!();
    for (now = 0; now <= 4000; now += 20) instance.frame([]);
    buttons.get('Play::Start')!();
    expect([match.swords[0].type, match.swords[0].primary, match.swords[0].secondary]).toEqual([2, 1, 5]);
    expect(match.settings.enemyRoster?.map((npc) => npc.skill)).toEqual([20, 80]);
    expect(match.settings.allyRoster?.map((npc) => npc.skill)).toEqual([40, 55]);
    const expected = { swords: match.swords, names: match.names, teams: match.teams, stats: match.fighters.map((fighter) => ({ ...fighter.stats })) };
    await replayWrites.idle();
    const [replay] = await listReplayFiles('swordfight');
    const { readReplayFile, saveReplayFile } = await import('../core/replay-storage');
    const { decodeReplayBlob, encodeReplayBlob, replayMetadata } = await import('../core/replay');
    const tape = (await decodeReplayBlob((await readReplayFile(replay))!))!;
    delete (tape.settings as Record<string, unknown>).enemyRoster;
    delete (tape.settings as Record<string, unknown>).allyRoster;
    tape.settingsVersion = version;
    tape.at++;
    const blob = await encodeReplayBlob(tape);
    await saveReplayFile({ blob, metadata: replayMetadata(tape, blob.size) });
    instance.dispose?.();
    instance = await factory(context);
    const recorder = captured.recorders.at(-1)!;
    await vi.waitFor(() => expect(recorder.hasPlayableAt(tape.at, tape.runId)).toBe(true));
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(tape.at, tape.runId)).toBe(true);
    perf.mockReturnValue(tape.duration);
    instance.frame([]);
    expect(match.settings.enemyRoster).toBeUndefined();
    expect(match.settings.allyRoster).toBeUndefined();
    expect({ swords: match.swords, names: match.names, teams: match.teams, stats: match.fighters.map((fighter) => ({ ...fighter.stats })) }).toEqual(expected);
    recorder.stop();
    instance.dispose?.();
  });

  it('copies the first enemy, keeps individual edits independent and restores choices through replay and seeking', async () => {
    const store = new Store('swordfight');
    const { panel, buttons, setters, selections } = panelHarness();
    let now = 0;
    let match!: Match;
    const update = Match.prototype.update;
    vi.spyOn(Match.prototype, 'update').mockImplementation(function (this: Match, time: number) {
      match = this; update.call(this, time);
    });
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./swordfight/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; },
    } as unknown as PuzzleContext);
    setters.get('Settings:Opponents:Number')!(3);
    setters.get('Settings:Teammates:Number')!(1);
    selections.get('Settings:Customise opponent:Type')!('Custom');
    selections.get('Settings:Customise opponent:Sword')!(6);
    setters.get('Settings:Customise opponent:Skill')!(35);
    selections.get('Settings:Customise opponent:NPC')!(2);
    buttons.get('Settings:Customise opponent:Apply first enemy to all')!();
    expect(store.get<any>('settings', null).enemyRoster).toEqual([
      { kind: 'Custom', sword: 6, skill: 35 },
      { kind: 'Custom', sword: 6, skill: 35 },
      { kind: 'Custom', sword: 6, skill: 35 },
    ]);
    selections.get('Settings:Customise opponent:NPC')!(1);
    setters.get('Settings:Customise opponent:Skill')!(70);
    selections.get('Settings:Customise teammate:Type')!('Homunculus');
    selections.get('Settings:Customise teammate:Sword')!(11);
    setters.get('Settings:Customise teammate:Skill')!(75);
    const saved = store.get<any>('settings', null);
    expect(saved.sword).toEqual([11, 4, 4]);
    expect(saved.enemyRoster).toEqual([{ kind: 'Custom', sword: 6, skill: 35 }, { kind: 'Custom', sword: 6, skill: 70 }, { kind: 'Custom', sword: 6, skill: 35 }]);
    expect(saved.allyRoster).toEqual([{ kind: 'Homunculus', sword: 11, skill: 75 }]);
    buttons.get('Play::Start')!();
    for (now = 0; now <= 4000; now += 20) instance.frame([]);
    buttons.get('Play::Start')!();
    const expected = { swords: match.swords, names: match.names, teams: match.teams, stats: match.fighters.map((fighter) => ({ ...fighter.stats })) };
    await replayWrites.idle();
    const [replay] = await listReplayFiles('swordfight');
    expect(replay.settingsVersion).toBe(8);
    const recorder = captured.recorders[0];
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(replay.at, replay.runId)).toBe(true);
    perf.mockReturnValue(replay.duration);
    instance.frame([]);
    expect({ swords: match.swords, names: match.names, teams: match.teams, stats: match.fighters.map((fighter) => ({ ...fighter.stats })) }).toEqual(expected);
    setters.get('History:Replays:Jump to (s)')!(replay.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    expect(match.swords).toEqual(expected.swords);
    expect(match.fighters.map((fighter) => ({ ...fighter.stats }))).toEqual(expected.stats);
    recorder.stop();
    expect(store.get('settings', null)).toEqual(saved);
    instance.dispose?.();
  });
});

describe('Swordfight knockout messages', () => {
  it('wraps a long opponent knockout at normal text width', async () => {
    const update = Match.prototype.update;
    vi.spyOn(Match.prototype, 'update').mockImplementation(function (this: Match, now: number) {
      const target = this.targets[0];
      this.names[target] = 'Wrathful Cultist';
      this.fighters[target].out = true;
      update.call(this, now);
    });
    const store = new Store('swordfight');
    const { panel, buttons } = panelHarness();
    const ctx = canvasContext();
    const fillText = vi.fn();
    Object.assign(ctx, { fillText });
    const screen = new Proxy({ ctx }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./swordfight/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => 100 } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    instance.frame([]);
    const boardWidth = SWORD_COLUMNS * SWORD_COLUMN_PX;
    const lines = fillText.mock.calls.filter((args) => args[1] === boardWidth / 2 && /Wrathful|knocked/.test(args[0]));
    expect(lines.map(([text]) => text).join(' ')).toBe('Wrathful Cultist was knocked out!');
    expect(lines).toHaveLength(2);
    expect(lines.every((args) => args.length === 3 && ctx.measureText(args[0]).width <= boardWidth - 8)).toBe(true);
    expect(lines[1][2] - lines[0][2]).toBe(36);
    instance.dispose?.();
  });
});

describe('puzzle completion during replay', () => {
  it.each([
    ['blacksmithing', 500, 20, { mode: 'perfect', perfectTimer: 100 }],
    ['treasure-haul', 62000, 100, { round: 30, gemRates: [50, 50] }],
    ['distilling', 30000, 20, { timerOn: true, timerSeconds: 0.01 }],
    ['vampire-carp', 121000, 1000, {}],
    ['forage', 12000, 20, { settings: { mode: 'ci', roundSeconds: 5 } }],
    ['swordfight', 90000, 20, { settings: { opponents: 1, skill: 5, difficulty: 5, breakers: 12.5, sword: [2, 0, 0], enemySword: [6, 4, 2] } }],
  ] as const)('%s keeps player history unchanged through playback, seeking and Stop', async (puzzle, end, step, settings) => {
    const store = new Store(puzzle);
    if (puzzle === 'treasure-haul') vi.spyOn(PyRandom.prototype, 'seedFromCrypto').mockImplementation(function (this: PyRandom) { this.seed(1234); });
    if (puzzle === 'forage') vi.spyOn(Math, 'random').mockReturnValue(0.123456);
    for (const [key, value] of Object.entries(settings)) store.set(key, value);
    const { panel, buttons, buttonStates, setters, stats, results } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const input = { mouse: [-1, -1] };
    const context = { screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext;
    const factory = (await import('./' + puzzle + '/index')).default as PuzzleFactory;
    const instance = await factory(context);
    const recorder = captured.recorders[0];
    buttons.get('Play::Start')!();
    let pausedWallTime = 0;
    for (let elapsed = 0; elapsed <= end; elapsed += step) {
      now = elapsed + pausedWallTime;
      if (['forage', 'treasure-haul', 'blacksmithing', 'swordfight'].includes(puzzle) && elapsed === step * 5) {
        buttons.get('Play::Pause')!();
        expect(buttonStates.get('Play::Pause')!.label!()).toBe('Resume');
        const beforePause = stats();
        now += 12345;
        instance.frame([{ type: 'keydown', key: 'space' }]);
        expect(stats()).toEqual(beforePause);
        buttons.get('Play::Pause')!();
        expect(buttonStates.get('Play::Pause')!.label!()).toBe('Pause');
        pausedWallTime += 12345;
      }
      if (puzzle === 'treasure-haul' && elapsed === 2000) {
        expect(buttonStates.get('Play::Dismiss')!.disabled!()).toBe(false);
        const beforeDismiss = stats();
        buttons.get('Play::Dismiss')!();
        expect(stats()).toEqual(beforeDismiss);
      }
      if (puzzle === 'treasure-haul' && elapsed > 3000 && elapsed % 500 === 0) {
        const cell = (elapsed / 500) % 56;
        input.mouse = [64 + (cell % 8) * 45 + 10, 205 + Math.floor(cell / 8) * 45 + 10];
        instance.frame([{ type: 'mousedown', button: 1, pos: input.mouse as [number, number] }]);
      } else if (puzzle === 'forage' && elapsed >= 2000 && elapsed <= 8000) {
        const index = Math.floor(elapsed / step) % 54;
        instance.frame([{ type: 'mousedown', button: 1, pos: [67 + (index % 6) * 45 + 10, 50 + Math.floor(index / 6) * 45 + 10] }]);
      } else instance.frame([]);
    }
    await replayWrites.idle();
    const data = JSON.parse(exportAll()).data as Record<string, unknown>;
    const expectedStats = stats();
    const histories = Object.entries(data).filter(([key]) => key.includes(':history:'));
    expect(histories).toHaveLength(1);
    expect(histories[0][1]).toHaveLength(1);
    const replay = (await listReplayFiles(puzzle))[0];
    if (puzzle === 'forage') {
      const result = results()[0] as { averages: string[][]; rows: string[][] };
      expect(result.averages).toContainEqual(['Sessions', '1']);
      const history = (histories[0][1] as { clockwise: number; anticlockwise: number }[])[0];
      expect(history.clockwise).toBe(0);
      expect(history.anticlockwise).toBeGreaterThan(0);
      expect(result.rows).toContainEqual(['Clockwise, anticlockwise', `0, ${history.anticlockwise}`]);
    }
    if (puzzle === 'treasure-haul') {
      const result = results()[0] as { report: { score: {label: string; value: string}; cleared: {items: {icon: string; count: number}[]}[] }; rows: string[][] };
      expect(result.report.score.label).toBe('Chests hauled');
      expect(Number(result.report.score.value)).toBe(result.report.cleared[0].items.reduce((sum, i) => sum + i.count, 0));
      expect(result.report.cleared[0].items.map((i) => i.icon)).toEqual(['vampirate-chest-small', 'vampirate-chest-medium', 'vampirate-chest-large']);
      expect(result.rows.some(([label]) => label === 'Best move')).toBe(false);
      expect(Number(result.rows.find(([label]) => label === 'Rubies spawned')![1])).toBeGreaterThan(0);
      expect(Number(result.rows.find(([label]) => label === 'Emeralds spawned')![1])).toBeGreaterThan(0);
      expect(result.rows.map(([label]) => label)).not.toEqual(expect.arrayContaining(['Points', 'Coins']));
      expect(result.rows.map(([label]) => label)).not.toContain('Coins toward next chest');
      expect(result.rows.map(([label]) => label)).not.toContain('Chests waiting');
    }
    if (puzzle === 'swordfight') {
      buttons.get('Play::View stats')!();
      const result = results()[0] as { report?: unknown; rows: string[][] };
      expect(result.report).toBeUndefined();
      expect(result.rows.map(([label]) => label)).toEqual(expect.arrayContaining([
        'Damage sent per second', 'Damage taken per second', 'Largest attack received',
        ...['red', 'green', 'blue', 'yellow'].map((c) => `Longest ${c} breaker drought`),
      ]));
      buttons.get('Play::View stats')!();
    }
    expect(replay).toBeDefined();
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(replay.at, replay.runId)).toBe(true);
    perf.mockReturnValue(replay.duration);
    instance.frame([]);
    expect(recorder.divergedAt).toBeNull();
    expect(stats()).toEqual(expectedStats);
    if (puzzle === 'distilling') expect(results()[0]).not.toBeNull();
    expect(JSON.parse(exportAll()).data).toEqual(data);
    setters.get('History:Replays:Jump to (s)')!(replay.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    expect(recorder.divergedAt).toBeNull();
    // Allow lazy loading/restoration to complete before testing Stop.
    await new Promise((resolve) => setTimeout(resolve, 0));
    buttons.get('History:Replays:Stop')!();
    expect(JSON.parse(exportAll()).data).toEqual(data);
    expect(await listReplayFiles(puzzle)).toHaveLength(1);
    instance.dispose?.();
  });
});

describe('replays match the live game', () => {
  it.each([
    ['ci', 60],
    ['chaos', 60],
    ['normal', 0],
  ] as const)('forage %s replays to the same score when the clock does not start at 0', async (mode, roundSeconds) => {
    vi.spyOn(Math, 'random').mockImplementation(((rng) => () => rng.random())(new PyRandom(77)));
    const store = new Store('forage');
    store.set('settings', { mode, roundSeconds });
    const { panel, buttons, stats, results } = panelHarness();
    let now = 1234;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const input = { mouse: [-1, -1] };
    const factory = (await import('./forage/index')).default as PuzzleFactory;
    const instance = await factory({ screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    const recorder = captured.recorders[0];
    buttons.get('Play::Start')!();
    const clicks = new PyRandom(5);
    for (let elapsed = 0; elapsed <= 65000 && !results()[0]; elapsed += 17) {
      now += 17;
      if (elapsed % 289 === 0) {
        const index = clicks.randintN(0, 53);
        const pos: [number, number] = [67 + (index % 6) * 45 + 10, 50 + Math.floor(index / 6) * 45 + 10];
        input.mouse = pos;
        instance.frame([{ type: 'mousedown', button: clicks.randintN(0, 1) ? 1 : 3, pos }]);
      } else instance.frame([]);
    }
    if (!results()[0]) buttons.get('Play::Start')!();
    for (let frame = 0; frame < 200; frame++) { now += 17; instance.frame([]); }
    const live = stats();
    await replayWrites.idle();
    const replay = (await listReplayFiles('forage'))[0];
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(replay.at, replay.runId)).toBe(true);
    perf.mockReturnValue(replay.duration + 1);
    instance.frame([]);
    expect(recorder.divergedAt).toBeNull();
    expect(stats()).toEqual(live);
    // Every recorded move was checked against the game's state when it was played.
    expect((await recorder['loadTape']((await listReplayFiles('forage'))[0]))!.checks!.length).toBeGreaterThan(30);
    instance.dispose?.();
  });
});

describe('short Normal forage sessions', () => {
  it('are unrated and keep no replay, best or history', async () => {
    vi.spyOn(Math, 'random').mockImplementation(((rng) => () => rng.random())(new PyRandom(3)));
    const store = new Store('forage');
    store.set('settings', { mode: 'normal' });
    const { panel, buttons, results } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./forage/index')).default as PuzzleFactory;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    // Two moves in about five seconds: 2 x 10 + 5 is under 95.
    for (let elapsed = 0; elapsed < 5000; elapsed += 17) {
      now += 17;
      if (elapsed === 3009 || elapsed === 4012) instance.frame([{ type: 'mousedown', button: 1, pos: [67 + 100, 50 + 200] }]);
      else instance.frame([]);
    }
    // Start reads Dismiss while a Normal board is out.
    buttons.get('Play::Start')!();
    for (let frame = 0; frame < 300; frame++) { now += 17; instance.frame([]); }
    const result = results()[0] as { rows: string[][]; report: { unrated?: boolean } };
    expect(result.rows).toContainEqual(['Rating', 'Unrated: not saved']);
    expect(result.report.unrated).toBe(true);
    await replayWrites.idle();
    expect(await listReplayFiles('forage')).toHaveLength(0);
    expect(Object.keys(JSON.parse(exportAll()).data).filter((key) => key.includes(':history:') || key.includes('normalBest'))).toEqual([]);
    instance.dispose?.();
  });
});

describe('deleting a past game', () => {
  it('removes its history row, its replay file and the replay from the list', async () => {
    vi.spyOn(Math, 'random').mockImplementation(((rng) => () => rng.random())(new PyRandom(9)));
    const { removeGame } = await import('../core/storage');
    const { deleteReplay } = await import('../core/data-backups');
    const store = new Store('forage');
    store.set('settings', { mode: 'ci', roundSeconds: 5 });
    const { panel, buttons } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./forage/index')).default as PuzzleFactory;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    const recorder = captured.recorders[0];
    buttons.get('Play::Start')!();
    for (let elapsed = 0; elapsed <= 9000; elapsed += 20) {
      now = elapsed;
      if (elapsed >= 3000 && elapsed % 400 === 0) instance.frame([{ type: 'mousedown', button: 1, pos: [67 + 100, 50 + 200] }]);
      else instance.frame([]);
    }
    await replayWrites.idle();
    const key = Object.keys(JSON.parse(exportAll()).data).find((k) => k.includes(':history:'))!.split(':history:')[1];
    const [game] = store.history(key);
    expect(recorder.hasPlayableAt(game.replayAt as number, game.replayId as string)).toBe(true);
    const replay = removeGame(game)!;
    await deleteReplay(replay);
    expect(store.history(key)).toHaveLength(0);
    // Earlier tests in this file share the session's games, so look for this one only.
    expect(store.sessionHistory(key).some((g) => g.at === game.at && g.score === game.score)).toBe(false);
    expect(await listReplayFiles('forage')).toHaveLength(0);
    expect(recorder.hasPlayableAt(game.replayAt as number, game.replayId as string)).toBe(false);
    instance.dispose?.();
  });
});

describe('taking over a replay', () => {
  it.each([
    ['forage', { settings: { mode: 'ci', roundSeconds: 30 } }, 33000],
    ['treasure-haul', { round: 30, gemRates: [50, 50] }, 34000],
  ] as const)('%s plays on from the jump point, saves as a game and replays through the take-over', async (puzzle, settings, end) => {
    vi.spyOn(Math, 'random').mockImplementation(((rng) => () => rng.random())(new PyRandom(21)));
    if (puzzle === 'treasure-haul') vi.spyOn(PyRandom.prototype, 'seedFromCrypto').mockImplementation(function (this: PyRandom) { this.seed(4321); });
    const store = new Store(puzzle);
    for (const [key, value] of Object.entries(settings)) store.set(key, value);
    const { panel, buttons, setters, stats } = panelHarness();
    let now = 500;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const input = { mouse: [-1, -1] };
    const factory = (await import('./' + puzzle + '/index')).default as PuzzleFactory;
    const instance = await factory({ screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    const recorder = captured.recorders[0];
    const clicks = new PyRandom(2);
    const click = () => {
      const pos: [number, number] = puzzle === 'forage'
        ? [67 + clicks.randintN(0, 5) * 45 + 10, 50 + clicks.randintN(0, 8) * 45 + 10]
        : [64 + clicks.randintN(0, 7) * 45 + 10, 205 + clicks.randintN(0, 6) * 45 + 10];
      input.mouse = pos;
      instance.frame([{ type: 'mousedown', button: 1, pos }, { type: 'mouseup', button: 1, pos }]);
    };
    const play = (until: number) => { for (let frame = 0; now < until; frame++) { now += 17; if (frame % 23 === 0 && now > 3500) click(); else instance.frame([]); } };
    // Someone else's game, recorded in full.
    buttons.get('Play::Start')!();
    play(500 + end);
    await replayWrites.idle();
    const [theirs] = await listReplayFiles(puzzle);
    // Watch it to 10 seconds, paused, then take over and play on.
    setters.get('History:Replays:Jump to (s)')!(10);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isPlaying).toBe(true));
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    expect(recorder.divergedAt).toBeNull();
    const atTakeOver = stats();
    buttons.get('History:Replays:Take over')!();
    expect(recorder.isPlaying).toBe(false);
    // Play a little, then go back to the replay where it was taken over: nothing is saved.
    play(now + 3000);
    // The same button reads Resume replay after a take-over.
    buttons.get('History:Replays:Take over')!();
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    await vi.waitFor(() => expect(recorder.isPlaying).toBe(true));
    expect(recorder.isPaused).toBe(true);
    expect(recorder.elapsedMs).toBe(10000);
    expect(recorder.divergedAt).toBeNull();
    expect(stats()).toEqual(atTakeOver);
    await replayWrites.idle();
    expect(await listReplayFiles(puzzle)).toHaveLength(1);
    // Take over again and play the game out this time.
    buttons.get('History:Replays:Take over')!();
    expect(recorder.isPlaying).toBe(false);
    play(now + end);
    await replayWrites.idle();
    const live = stats();
    const mine = (await listReplayFiles(puzzle)).find((entry) => entry.id !== theirs.id)!;
    expect(mine.result).toMatch(/taken over at 10s/);
    const histories = Object.entries(JSON.parse(exportAll()).data).filter(([key]) => key.includes(':history:'));
    expect((histories[0][1] as unknown[]).length).toBe(2);
    // The saved game replays from the start, through the take-over, to the same end.
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(mine.at, mine.runId)).toBe(true);
    perf.mockReturnValue(mine.duration);
    instance.frame([]);
    expect(recorder.divergedAt).toBeNull();
    expect(stats()).toEqual(live);
    buttons.get('History:Replays:Stop')!();
    instance.dispose?.();
  });
});

describe('changing a setting mid-game', () => {
  it.each(['forage', 'treasure-haul', 'blacksmithing', 'swordfight'] as const)('%s abandons the game with nothing saved', async (puzzle) => {
    vi.spyOn(Math, 'random').mockImplementation(((rng) => () => rng.random())(new PyRandom(5)));
    const store = new Store(puzzle);
    if (puzzle === 'forage') store.set('settings', { mode: 'ci', roundSeconds: 5 });
    if (puzzle === 'treasure-haul') store.set('round', 30);
    const { panel, buttons, buttonStates } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./' + puzzle + '/index')).default as PuzzleFactory;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    const recorder = captured.recorders[0];
    buttons.get('Play::Start')!();
    for (let frame = 0; frame < 200; frame++) { now += 17; instance.frame(frame % 20 === 10 ? [{ type: 'mousedown', button: 1, pos: [200, 300] }] : []); }
    expect(recorder['canStartPlayback']()).toBe(false);
    recorder.abandon();
    expect(recorder['canStartPlayback']()).toBe(true);
    // Play on past where a round would have ended: the abandoned game never saves.
    for (let frame = 0; frame < 2500; frame++) { now += 17; instance.frame([]); }
    await replayWrites.idle();
    expect(await listReplayFiles(puzzle)).toHaveLength(0);
    expect(Object.keys(JSON.parse(exportAll()).data).filter((key) => key.includes(':history:'))).toEqual([]);
    expect(buttonStates.get('Play::Start')!.label!()).toMatch(/Start|Play again|Fight again|New sword/);
    instance.dispose?.();
  });

  it('distilling keeps no replay of a session that sent nothing up', async () => {
    const store = new Store('distilling');
    store.set('mode', 'Practice');
    const { panel, buttons } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./distilling/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    for (let frame = 0; frame < 60; frame++) { now += 17; instance.frame([]); }
    buttons.get('Play::Start')!();
    await replayWrites.idle();
    expect(await listReplayFiles('distilling')).toHaveLength(0);
    instance.dispose?.();
  });
});
