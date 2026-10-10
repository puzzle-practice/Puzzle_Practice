import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { PyRandom } from '../core/pyrandom';
import { Store, exportAll } from '../core/storage';
import { replayWrites, listReplayFiles } from '../core/replay-storage';
import type { ReplayRecorder } from '../core/replay';
import type { PuzzleContext, PuzzleFactory } from '../core/puzzle';
import { createDrill } from './treasure-haul/training';
import { HaulBoard } from './treasure-haul/logic';

const captured = vi.hoisted(() => ({ recorders: [] as ReplayRecorder[] }));
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
vi.mock('../core/audio', () => ({ SoundBank: class { play() {} dispose() {} } }));

function canvasContext() {
  return new Proxy({
    measureText: (text: string) => ({ width: text.length * 8 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} });
}
function panelHarness() {
  const buttons = new Map<string, () => void>();
  const setters = new Map<string, (value: number) => void>();
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
    if (method === 'number') return (name: string, _get: unknown, set: (value: number) => void) => { setters.set(page + ':' + title + ':' + name, set); return group(page, title); };
    if (method === 'stats') return (_header: unknown, get: () => unknown) => { tables.push(get); return group(page, title); };
    return () => group(page, title);
  } });
  const panel = new Proxy({}, { get: (_target, method) => {
    if (method === 'group') return (title = '') => group('Play', title);
    if (method === 'settings') return group('Settings');
    if (method === 'tab') return (page: string) => group(page);
    if (method === 'results') return (get: () => unknown) => { results.push(get); };
    return () => group('Play');
  } });
  return { panel, buttons, setters, buttonStates, stats: () => tables.map((get) => get()), results: () => results.map((get) => get()) };
}

beforeEach(async () => {
  await replayWrites.idle();
  captured.recorders = [];
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
    if (mode === 'Practice') {
      const games = store.history('Practice:0-0');
      expect(games).toHaveLength(1);
      expect(games[0].duty).toBeUndefined();
    }
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

describe('preset Treasure Haul drills', () => {
  it.each(['emeralds', 'edges'] as const)('%s starts immediately and reproduces its moves during replay', async (pack) => {
    vi.spyOn(PyRandom.prototype, 'seedFromCrypto').mockImplementation(function (this: PyRandom) { this.seed(1234); });
    const store = new Store('treasure-haul');
    store.set('mode', 'clear');
    store.set('clearPack', pack);
    store.set('round', 30);
    // Difficult edge drills must override saved ruby rates, including on refills.
    store.set('gemRates', [100, 0]);
    const { panel, buttons, buttonStates, stats } = panelHarness();
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
    const moves = expected.solution ?? [[0, 7]];
    for (const [x, y] of moves) {
      input.mouse = [44 + x * 45 + 10, 205 + (8 - y) * 45 + 10];
      const before = swaps.mock.calls.length;
      instance.frame([{ type: 'mousedown', button: 1, pos: input.mouse as [number, number] }]);
      expect(swaps.mock.calls[before]).toEqual([x, y]);
      for (let frame = 0; frame < 150; frame++) { now += 50; instance.frame([]); }
    }
    now = 60100;
    for (let frame = 0; frame < 300; frame++) { now += 50; instance.frame([]); }
    await replayWrites.idle();
    const finalStats = stats();
    if (pack === 'edges') expect(finalStats[0]).toContainEqual(['Chests cleared', '1', expect.any(String)]);
    const [replay] = await listReplayFiles('treasure-haul');
    expect(replay.settingsVersion).toBe(3);
    const data = JSON.parse(exportAll()).data;
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await captured.recorders[0].playAt(replay.at, replay.runId)).toBe(true);
    perf.mockReturnValue(replay.duration);
    instance.frame([]);
    expect(stats()).toEqual(finalStats);
    expect(JSON.parse(exportAll()).data).toEqual(data);
    buttons.get('History:Replays:Stop')!();
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
      const coins = Number(result.rows.find(([label]) => label === 'Coins')![1]);
      expect(result.rows).toContainEqual(['Coins toward next chest', `${coins % 150} / 150`]);
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
    expect(stats()).toEqual(expectedStats);
    if (puzzle === 'distilling') expect(results()[0]).not.toBeNull();
    expect(JSON.parse(exportAll()).data).toEqual(data);
    setters.get('History:Replays:Jump to (s)')!(replay.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    // Allow lazy loading/restoration to complete before testing Stop.
    await new Promise((resolve) => setTimeout(resolve, 0));
    buttons.get('History:Replays:Stop')!();
    expect(JSON.parse(exportAll()).data).toEqual(data);
    expect(await listReplayFiles(puzzle)).toHaveLength(1);
    instance.dispose?.();
  });
});
