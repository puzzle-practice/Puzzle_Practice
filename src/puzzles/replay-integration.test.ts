import { Random } from '../core/random';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DutyReport } from '../core/duty/report';
import { IDBFactory } from 'fake-indexeddb';
import { Store, exportAll } from '../core/storage';
import { replayWrites, listReplayFiles } from '../core/replay-storage';
import type { PuzzleReplay, ReplayRecorder } from '../core/replay';
import type { PuzzleContext, PuzzleFactory } from '../core/puzzle';
import type { InputEvent } from '../core/input';
import { createDrill } from './treasure-haul/training';
import { HaulBoard, isChestOrigin, RUBY, EMERALD } from './treasure-haul/logic';
import { FOUR, IronBoard } from './blacksmithing/logic';
import { Match } from './swordfight/match';
import { W as SWORD_COLUMNS } from './swordfight/board';
import { COL_PX as SWORD_COLUMN_PX } from './swordfight/fighter';
import { setWarningTimer } from '../core/audio';
import { SailingGame } from './sailing/game';
import { PatchingBoard, movable as patchingMovable } from './patching/logic';
import { CELL as CARP_CELL, COLS as CARP_COLS, Game as CarpentryGame, ROWS as CARP_ROWS, VIEW_X as CARP_X, VIEW_Y as CARP_Y } from './vampire-carp/game';
import { AIM_HISTORY, AIM_LANDING_MS, AIM_MS, AimTrainer } from './rumble/aim';
import { Match as RumbleMatch } from './rumble/match';
import { Glove as RumbleGlove } from './rumble/gloves';
import type { Board, Point } from './rumble/board';
import { GunningGame } from './gunning/game';
import { LOOP, LOOP_SIDES, POWDER, SHOT, WAD } from './gunning/board';

const captured = vi.hoisted(() => ({ recorders: [] as ReplayRecorder[], sounds: [] as string[] }));
vi.mock('../core/replay', async (original) => {
  const module = await original<typeof import('../core/replay')>();
  return { ...module, ReplayRecorder: class extends module.ReplayRecorder {
    constructor(...args: ConstructorParameters<typeof module.ReplayRecorder>) { super(...args); captured.recorders.push(this); }
  } };
});
vi.mock('../core/assets', async (original) => ({
  ...await original<typeof import('../core/assets')>(),
  Images: class { static async load() { return { get: (name: string) => ({ width: 450, height: 600, name }), has: () => true }; } },
}));
vi.mock('../core/fonts', () => ({ loadFont: async () => {} }));
vi.mock('../core/audio', async (original) => ({
  ...await original<typeof import('../core/audio')>(),
  SoundBank: class {
    constructor(_urls: unknown, private readonly muted = () => false) {}
    play(name: string) { if (!this.muted()) captured.sounds.push(name); }
    loop(name: string) { if (!this.muted()) captured.sounds.push(name); return () => {}; }
    dispose() {}
  },
}));

function canvasContext() {
  return new Proxy({
    measureText: (text: string) => ({ width: text.length * 8 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} });
}
function panelHarness(syncTableActions = false) {
  const buttons = new Map<string, () => void>();
  const setters = new Map<string, (value: number) => void>();
  const selections = new Map<string, (value: string | number) => void>();
  const texts = new Map<string, (value: string) => void>();
  const toggles = new Map<string, (value: boolean) => void>();
  const toggleValues = new Map<string, () => boolean>();
  const tables: Array<() => unknown> = [];
  const results: Array<() => unknown> = [];
  const clocks: Array<() => unknown> = [];
  const buttonStates = new Map<string, { disabled?: () => boolean; label?: () => string }>();
  const rowActions = new Map<string, { disabled?: (index: number) => boolean }>();
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
    if (method === 'text') return (name: string, _get: unknown, set: (value: string) => void) => { texts.set(page + ':' + title + ':' + name, set); return group(page, title); };
    if (method === 'toggle') return (name: string, get: () => boolean, set: (value: boolean) => void) => {
      toggles.set(page + ':' + title + ':' + name, set);
      toggleValues.set(page + ':' + title + ':' + name, get);
      return group(page, title);
    };
    if (method === 'stats') return (_header: unknown, get: () => unknown[], _options: unknown, actions: { title: string; disabled?: (index: number) => boolean }[] = []) => {
      actions.forEach(action => rowActions.set(action.title, action));
      const sync = () => {
        const rows = get();
        // The real panel synchronizes row buttons immediately, even on a hidden tab.
        if (syncTableActions) rows.forEach((_row, index) => actions.forEach(action => action.disabled?.(index)));
        return rows;
      };
      if (syncTableActions) sync();
      tables.push(sync);
      return group(page, title);
    };
    return () => group(page, title);
  } });
  const panel = new Proxy({}, { get: (_target, method) => {
    if (method === 'group') return (title = '') => group('Play', title);
    if (method === 'settings' || method === 'seedSettings') return group('Settings');
    if (method === 'controlSettings') return group('Controls');
    if (method === 'tab') return (page: string) => group(page);
    if (method === 'historySection') return (part: string) => group('History', part === 'replays' ? 'Replays' : '');
    if (method === 'results') return (get: () => unknown) => { results.push(get); };
    if (method === 'clock') return (get: () => unknown) => { clocks.push(get); };
    return () => group('Play');
  } });
  return { panel, buttons, setters, selections, texts, toggles, toggleValues, buttonStates, rowActions, stats: () => tables.map((get) => get()), results: () => results.map((get) => get()), clocks: () => clocks.map(get => get()) };
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

/** An aim that lands somewhere other than next to the target. */
function misses(b: Board, fist: number, dir: number, cells: Point[]): boolean {
  const shot = b.shoot(b.path(fist, dir));
  return !!shot && !cells.some(p => b.adjacent(shot.rest, p));
}

describe('Rumble fire inputs', () => {
  async function setup() {
    const updates = vi.spyOn(RumbleMatch.prototype, 'update');
    const store = new Store('rumble'); store.set('mode', 'Create');
    const harness = panelHarness();
    let now = 100;
    const factory = (await import('./rumble/index')).default;
    const ctx = canvasContext() as unknown as CanvasRenderingContext2D;
    const draws = vi.fn();
    ctx.drawImage = draws;
    const screen = new Proxy({ ctx }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const instance = await factory({ screen, input: { mouse: [-1, -1] },
      panel: harness.panel, store, ticks: () => now,
    } as unknown as PuzzleContext);
    harness.buttons.get('Play::Start')!();
    instance.frame([]);
    const f = (updates.mock.contexts.at(-1)! as RumbleMatch).player;
    // Input-boundary checks need a shot that cannot start a random clear animation.
    f.board.cells.fill(0);
    f.board.sparks = [];
    const frame = (at: number, events: InputEvent[] = []) => { now = at; instance.frame(events); };
    return { instance, f, frame, draws };
  }

  it('draws a full board before the punch reaches balls it will destroy', async () => {
    const h = await setup(), b = h.f.board;
    for (let y = 0; y < 19; y++) for (let x = 0; x < b.width(y); x++) b.set({ x, y }, 1);
    const before = b.count();
    const punch = h.f.strikeNow({ from: 0, id: 1, height: 6, width: 9, count: 0, side: 1, blacks: 0, next: 0 },
      new RumbleGlove(127), 100)!;
    expect(punch.result.columns.some(c => c.destroyed.length > 0)).toBe(true);
    h.draws.mockClear();
    h.frame(100);
    const balls = h.draws.mock.calls.filter(args => args[0]?.name?.startsWith('balls-') && args[6] >= 0 && args[6] < 19 * 23);
    expect(balls).toHaveLength(before);
    h.instance.dispose();
  });

  it('draws impact fists above the balls and removes them after the third pulse', async () => {
    const h = await setup();
    h.f.punchHits.push({ side: 1, row: 4, at: 100 });
    h.draws.mockClear();
    h.frame(150);
    const names: string[] = h.draws.mock.calls.map(args => args[0]?.name ?? 'canvas');
    const lastBall = Math.max(...names.map((name, i) => name.startsWith('balls-') ? i : -1));
    expect(names.lastIndexOf('fist_hit')).toBeGreaterThan(lastBall);
    expect(names[names.lastIndexOf('fist_hit') + 1]).toBe('canvas');
    h.draws.mockClear();
    h.frame(400);
    expect(h.draws.mock.calls.some(args => args[0]?.name === 'fist_hit')).toBe(false);
    h.instance.dispose();
  });

  it.each(['mouse', 'keyboard'])('keeps a held %s press across flight and accepts release at the turn boundary', async device => {
    const h = await setup(), pos: [number, number] = [220, 120];
    const down: InputEvent = device === 'mouse' ? { type: 'mousedown', button: 1, pos } : { type: 'keydown', key: 'z' };
    const up: InputEvent = device === 'mouse' ? { type: 'mouseup', button: 1, pos } : { type: 'keyup', key: 'z' };
    h.frame(110, [down, up]);
    const landed = h.f.flight!.end;
    h.frame(120, [down]);
    expect(h.f.charging).toBe(-1);
    h.frame(landed, [up]);
    expect(h.f.stats.shots).toBe(2);
    expect(h.f.flight!.start).toBe(landed);
    h.instance.dispose();
  });

  it.each(['mouse', 'keyboard'])('does not queue a quick %s click during flight', async device => {
    const h = await setup(), pos: [number, number] = [220, 120];
    const down: InputEvent = device === 'mouse' ? { type: 'mousedown', button: 1, pos } : { type: 'keydown', key: 'z' };
    const up: InputEvent = device === 'mouse' ? { type: 'mouseup', button: 1, pos } : { type: 'keyup', key: 'z' };
    h.frame(110, [down, up]);
    const landed = h.f.flight!.end;
    h.frame(120, [down, up]);
    h.frame(landed);
    expect(h.f.stats.shots).toBe(1);
    expect(h.f.charging).toBe(-1);
    h.instance.dispose();
  });
});

describe('Rumble aim trainer sessions', () => {
  async function setup(difficulty?: string) {
    const updates = vi.spyOn(AimTrainer.prototype, 'update');
    const store = new Store('rumble'); store.set('mode', 'Aim trainer');
    if (difficulty) store.set('aimDifficulty', difficulty);
    const harness = panelHarness();
    let now = 100;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./rumble/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel: harness.panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    harness.buttons.get('Play::Start')!();
    instance.frame([]);
    const aim = () => updates.mock.contexts.at(-1)! as AimTrainer;
    const advance = (ms: number) => { now += ms; instance.frame([]); };
    const fire = (hit: boolean) => {
      const t = aim(), f = t.fighter, fist = t.current.fist;
      const [lo, hi] = f.board.ranges[fist];
      const dir = hit ? t.current.angles[0] : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
        .find(d => misses(f.board, fist, d, t.current.cells))!;
      const delta = dir - f.dir[fist], arrow = delta > 0 ? 'arrowleft' : 'arrowright';
      const key = fist === 0 ? 'z' : 'x';
      instance.frame([{ type: 'keydown', key: 'shift' },
        ...Array.from({ length: Math.abs(delta) }, (): InputEvent => ({ type: 'keydown', key: arrow })),
        { type: 'keyup', key: arrow }, { type: 'keyup', key: 'shift' },
        { type: 'keydown', key }, { type: 'keyup', key }]);
    };
    return { ...harness, instance, store, aim, advance, fire };
  }

  it('pauses the countdown and flight, saves connections, and replays the same targets and results', async () => {
    const h = await setup();
    h.fire(true);
    expect(h.aim().fighter.flight).not.toBeNull();
    h.buttons.get('Play::Pause')!();
    const pausedClock = h.clocks();
    h.advance(60000);
    expect(h.clocks()).toEqual(pausedClock);
    expect(h.aim().score).toBe(0);
    h.buttons.get('Play::Pause')!();
    h.advance(3000);
    expect(h.aim().score).toBe(1);
    for (let i = 0; i < 7; i++) { h.fire(true); h.advance(3000); }
    expect(h.aim().boardNumber).toBe(2);
    h.fire(false); h.advance(3000);
    h.advance(AIM_MS - 27000);
    expect(h.aim().result).toBe('Time up');
    expect(h.aim().score).toBe(8);
    expect(h.aim().lives).toBe(2);
    expect(h.results()[0]).toMatchObject({ title: 'Aim trainer · Mixed · Time up' });
    expect(h.store.history(AIM_HISTORY)).toHaveLength(1);
    expect(h.store.history(AIM_HISTORY)[0]).toMatchObject({ score: 8, shots: 9, lives: 2, ms: AIM_MS });
    const recorder = captured.recorders[0], expected = recorder.fingerprint!();
    await replayWrites.idle();
    const before = JSON.parse(exportAll()).data, [tape] = await listReplayFiles('rumble');
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(tape.at, tape.runId)).toBe(true);
    perf.mockReturnValue(tape.duration); h.instance.frame([]);
    expect(recorder.fingerprint!()).toBe(expected);
    expect(JSON.parse(exportAll()).data).toEqual(before);
    expect(captured.sounds).not.toContain('charged');
    h.instance.dispose?.();
  });

  it('ignores the inactive hand and ends on the third miss, then starts with fresh lives', async () => {
    const h = await setup();
    const wrong = h.aim().current.fist === 0 ? 'x' : 'z';
    h.instance.frame([{ type: 'keydown', key: wrong }, { type: 'keyup', key: wrong }]);
    expect(h.aim().shots).toBe(0);
    for (let i = 0; i < 2; i++) { h.fire(false); h.advance(3000); }
    h.fire(false);
    const end = h.aim().fighter.flight!.end;
    h.advance(end - (h.aim().startedAt + 6000));
    expect(h.aim().result).toBe('Out of lives');
    expect(h.aim().landing).toMatchObject({ hit: false });
    expect(h.results()[0]).toBeNull();
    h.advance(AIM_LANDING_MS - 1);
    expect(h.results()[0]).toBeNull();
    h.advance(1);
    expect(h.results()[0]).toMatchObject({ title: 'Aim trainer · Mixed · Out of lives' });
    expect(h.store.history(AIM_HISTORY)[0]).toMatchObject({ score: 0, shots: 3, lives: 0 });
    h.buttons.get('Play::Start')!(); h.instance.frame([]);
    expect(h.aim().lives).toBe(3);
    expect(h.aim().score).toBe(0);
    expect(h.aim().remaining(6000)).toBeGreaterThan(0);
    h.instance.dispose?.();
  });

  it('restores the selected mode after watching trainer footage from Fight', async () => {
    const h = await setup();
    for (let i = 0; i < 3; i++) { h.fire(false); h.advance(3000); }
    await replayWrites.idle();
    const [tape] = await listReplayFiles('rumble');
    h.selections.get('Play::Mode')!('Fight');
    const recorder = captured.recorders[0];
    vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(tape.at, tape.runId)).toBe(true);
    expect(h.clocks()[0]).toMatchObject({ label: 'Time left', countdown: true });
    recorder.stop();
    expect(h.clocks()[0]).toMatchObject({ label: 'Time', ms: 0 });
    expect(h.results()[0]).toBeNull();
    expect(h.store.get('mode', '')).toBe('Fight');
    h.instance.dispose?.();
  });

  it('keeps each difficulty\'s history apart and replays a round at its own difficulty', async () => {
    const h = await setup('Very hard');
    expect(h.aim().difficulty).toBe('Very hard');
    expect(h.aim().current.difficulty).toBe('Very hard');
    for (let i = 0; i < 3; i++) { h.fire(false); h.advance(3000); }
    expect(h.results()[0]).toMatchObject({ title: 'Aim trainer · Very hard · Out of lives' });
    expect(h.store.history(`${AIM_HISTORY}:Very hard`)[0]).toMatchObject({ score: 0, shots: 3, difficulty: 'Very hard' });
    expect(h.store.history(AIM_HISTORY)).toHaveLength(0);
    await replayWrites.idle();
    const [tape] = await listReplayFiles('rumble');
    const recorder = captured.recorders[0], expected = recorder.fingerprint!(), live = h.aim();
    h.selections.get('Play::Difficulty')!('Easy');
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(tape.at, tape.runId)).toBe(true);
    perf.mockReturnValue(tape.duration); h.instance.frame([]);
    expect(h.aim()).not.toBe(live);
    expect(h.aim().difficulty).toBe('Very hard');
    expect(recorder.fingerprint!()).toBe(expected);
    recorder.stop();
    expect(h.store.get('aimDifficulty', '')).toBe('Easy');
    h.buttons.get('Play::Start')!(); h.instance.frame([]);
    expect(h.aim().difficulty).toBe('Easy');
    h.instance.dispose?.();
  });
});

describe('Patching sessions', () => {
  it('opens with saved history while replay controls initialize', async () => {
    const store = new Store('patching');
    store.addHistory('difficulty:0:wind:level:tokens:0', { score: 20, cleared: 1, torn: 0, replayAt: 123456, replayId: 'saved-game' });
    const { panel } = panelHarness(true);
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./patching/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => 0 } as unknown as PuzzleContext);
    instance.frame([]); instance.dispose?.();
  });
  it('replays wind, replacement boards, inputs and pause without changing saved history', async () => {
    const store = new Store('patching');
    store.set('settings', { difficulty: 10, wind: 1, bonusMode: 2 });
    const { panel, buttons, setters, stats, results } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const input = { mouse: [-1, -1] };
    const factory = (await import('./patching/index')).default;
    const instance = await factory({ screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    now = 250; instance.frame([{ type: 'keydown', key: 'd' }, { type: 'keydown', key: 'q' }]);
    buttons.get('Play::Pause')!();
    const paused = stats(); now += 60000;
    instance.frame([{ type: 'keydown', key: 'enter' }]);
    expect(stats()).toEqual(paused);
    buttons.get('Play::Pause')!();
    for (let elapsed = 300; elapsed <= 12000; elapsed += 100) { now = 60000 + elapsed; instance.frame([]); }
    buttons.get('Play::Start')!();
    const expected = stats();
    const result = results()[0] as { rows: string[][] };
    expect(Number(result.rows.find(([label]) => label === 'Boards torn')![1])).toBeGreaterThan(1);
    await replayWrites.idle();
    const before = JSON.parse(exportAll()).data;
    const tape = (await listReplayFiles('patching'))[0];
    const recorder = captured.recorders[0];
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(tape.at, tape.runId)).toBe(true);
    perf.mockReturnValue(tape.duration); instance.frame([]);
    expect(stats()).toEqual(expected);
    expect(JSON.parse(exportAll()).data).toEqual(before);
    setters.get('History:Replays:Jump to (s)')!(tape.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    expect(stats()).toEqual(expected);
    buttons.get('History:Replays:Stop')!();
    expect(store.get('settings', null)).toEqual({ difficulty: 10, wind: 1, bonusMode: 2 });
    expect(JSON.parse(exportAll()).data).toEqual(before);
    instance.dispose?.();
  });
  it('distinguishes quick clicks, throttles wheel rotations and repeats held keys at the game rate', async () => {
    vi.stubGlobal('crypto', { randomUUID: crypto.randomUUID.bind(crypto), getRandomValues: (array: Uint32Array) => { array[0] = 42; return array; } });
    const store = new Store('patching'); store.set('settings', { difficulty: 5, wind: 0, bonusMode: 0 });
    const { panel, buttons, results } = panelHarness(); let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./patching/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    const board = new PatchingBoard(5, 42);
    const i = [...board.pieces].find(([, p]) => patchingMovable(p))![0];
    const pos: [number, number] = [57 + i % 7 * 56, 97 + Math.floor(i / 7) * 56];
    instance.frame([{ type: 'mousedown', button: 1, pos }]);
    now = 149; instance.frame([{ type: 'mouseup', button: 1, pos }]);
    now = 200; instance.frame([{ type: 'mousedown', button: 1, pos }]);
    now = 350; instance.frame([{ type: 'mouseup', button: 1, pos }]);
    now = 400; instance.frame([{ type: 'mousedown', button: 5, pos }]);
    now = 549; instance.frame([{ type: 'mousedown', button: 5, pos }]);
    now = 550; instance.frame([{ type: 'mousedown', button: 5, pos }]);
    now = 600; instance.frame([{ type: 'keydown', key: 'e' }]);
    now = 1099; instance.frame([]);
    now = 1100; instance.frame([]);
    now = 1299; instance.frame([]);
    now = 1300; instance.frame([]);
    now = 1301; instance.frame([{ type: 'keyup', key: 'e' }]);
    now = 1800; instance.frame([]);
    buttons.get('Play::Start')!();
    expect((results()[0] as { rows: string[][] }).rows).toContainEqual(['Moves', '6']);
    instance.dispose?.();
  });
});

describe('Weaving session replay', () => {
  it('preserves holds, hover, paused time and results without changing history during playback', async () => {
    const store = new Store('weaving');
    store.set('difficulty',5);
    const { panel, buttons, setters, stats, results } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const input = { mouse: [-1,-1] };
    const factory = (await import('./weaving/index')).default;
    const instance = await factory({ screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    for (let t = 0; t < 8000; t += 20) {
      now = t; input.mouse = t < 1900 ? [100,250] : [260,250];
      if (t === 2000) instance.frame([{ type: 'keydown', key: 'space' }]);
      else if (t === 2020) instance.frame([{ type: 'keyup', key: 'space' }]);
      else if (t === 5000) instance.frame([{ type: 'keydown', key: 'arrowleft' }]);
      else if (t === 6200) instance.frame([{ type: 'keyup', key: 'arrowleft' }]);
      else instance.frame([]);
    }
    buttons.get('Play::Pause')!();
    const beforePause = stats();
    now += 10000; instance.frame([]);
    expect(stats()).toEqual(beforePause);
    buttons.get('Play::Pause')!();
    buttons.get('Play::Start')!();
    await replayWrites.idle();
    const expected = results();
    expect(expected[0]).toMatchObject({ title: 'Stopped', rows: expect.arrayContaining([['Shuttles placed','1']]) });
    expect(store.history('difficulty:5')).toHaveLength(1);
    const saved = JSON.parse(exportAll()).data;
    const tape = (await listReplayFiles('weaving'))[0];
    const recorder = captured.recorders[0];
    const perf = vi.spyOn(performance,'now').mockReturnValue(0);
    expect(await recorder.playAt(tape.at,tape.runId)).toBe(true);
    perf.mockReturnValue(tape.duration);
    instance.frame([]);
    expect(results()).toEqual(expected);
    expect(JSON.parse(exportAll()).data).toEqual(saved);
    setters.get('History:Replays:Jump to (s)')!(4);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    await new Promise(resolve => setTimeout(resolve,0));
    buttons.get('History:Replays:Stop')!();
    expect(JSON.parse(exportAll()).data).toEqual(saved);
    instance.dispose?.();
  });
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
    buttons.get('Settings:Seed:Paste')!();
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
    // Pasted boards are practice: keep the replay without adding a PB/history score.
    expect(histories).toHaveLength(0);
    expect(store.scoresEnabled).toBe(false);
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

describe('Carpentry pickup input', () => {
  async function placedPlank(ship = false, settle = 250) {
    const update = vi.spyOn(CarpentryGame.prototype, 'update');
    const store = new Store('vampire-carp');
    store.set('seeded', true); store.set('sessionSeed', 5);
    store.set('config', { ship, difficulty: 5, tokens: 0 });
    const { panel, buttons, setters } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const input = { mouse: [-1, -1] as [number, number] };
    const factory = (await import('./vampire-carp/index')).default;
    const context = { screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext;
    const open = () => factory(context);
    const instance = await open();
    const step = (mouse: [number, number], events: InputEvent[] = [], elapsed = 20) => {
      input.mouse = mouse; now += elapsed; instance.frame(events);
    };
    buttons.get('Play::Start')!();
    now = 1600; instance.frame([]);
    const currentGame = () => update.mock.instances.at(-1)! as CarpentryGame;
    const game = currentGame();
    const slot = game.tools.findIndex(tool => tool && !tool.piece.isPutty);
    step([-1, -1], [{ type: 'keydown', key: String(slot + 1) }]);
    const piece = game.held!.piece;
    // Find a non-finishing placement that can be nudged one cell to the right.
    let at: [number, number] | undefined;
    for (let y = 0; y < CARP_ROWS && !at; y++) for (let x = 0; x < CARP_COLS && !at; x++) {
      const target = game.target([x, y], piece), next = game.target([x + 1, y], piece);
      if (game.inToolbox([x, y]) || !target || !next || target.hole !== next.hole) continue;
      if (target.hole.checkPiece(piece, ...target.at) > 0 && next.hole.checkPiece(piece, ...next.at) > 0 &&
          !target.hole.wouldFinish(piece, ...target.at)) at = [CARP_X + x * CARP_CELL + 5, CARP_Y + y * CARP_CELL + 5];
    }
    expect(at).toBeDefined();
    const pos = at!;
    step(pos, [{ type: 'mousedown', button: 1, pos }, { type: 'mouseup', button: 1, pos }]);
    expect(game.tentative).not.toBeNull();
    if (settle > 0) step(pos, [], settle);
    return { game, pos, step, instance, buttons, setters, recorder: captured.recorders[0], currentGame, open };
  }

  it.each([[false, 50], [false, 100], [false, 200], [true, 50], [true, 100], [true, 200]] as const)(
    'keeps triple clicks from picking up and locking the just-placed plank (ship: %s, spacing: %s ms)', async (ship, spacing) => {
      const { game, pos, step, instance } = await placedPlank(ship, 0);
      const plank = game.tentative!.sprite;
      const clicks: InputEvent[] = [{ type: 'mousedown', button: 1, pos }, { type: 'mouseup', button: 1, pos }];
      step(pos, clicks, spacing); step(pos, clicks, spacing);
      expect(game.tentative?.sprite).toBe(plank);
      expect(game.held).toBeNull();
      expect(game.stats.replaced).toBe(0);
      // Once the burst has stopped, a deliberate pickup is immediately usable.
      step(pos, clicks, 250);
      expect(game.held).toBe(plank);
      game.rotate(true);
      step(pos, clicks);
      expect(game.stats.replaced).toBe(1);
      instance.dispose?.();
    },
  );

  it('ignores multiple repeat clicks delivered together in a single frame', async () => {
    const { game, pos, step, instance } = await placedPlank(false, 0);
    const plank = game.tentative!.sprite;
    const click: InputEvent[] = [{ type: 'mousedown', button: 1, pos }, { type: 'mouseup', button: 1, pos }];
    step(pos, [...click, ...click], 20);
    expect(game.tentative?.sprite).toBe(plank);
    expect(game.stats.replaced).toBe(0);
    instance.dispose?.();
  });

  it.each([249, 250])('allows a fresh pickup at the quiet-period boundary (%s ms)', async elapsed => {
    const { game, pos, step, instance } = await placedPlank(false, 0);
    step(pos, [{ type: 'mousedown', button: 1, pos }, { type: 'mouseup', button: 1, pos }], elapsed);
    expect(game.held !== null).toBe(elapsed >= 250);
    instance.dispose?.();
  });

  it('does not turn an ignored pickup into a drop when its release arrives after the quiet period', async () => {
    const { game, pos, step, instance } = await placedPlank(false, 0);
    const plank = game.tentative!.sprite;
    step(pos, [{ type: 'mousedown', button: 1, pos }], 100);
    const moved: [number, number] = [pos[0] + CARP_CELL, pos[1]];
    step(moved, [{ type: 'mouseup', button: 1, pos: moved }], 300);
    expect(game.tentative?.sprite).toBe(plank);
    expect(game.held).toBeNull();
    expect(game.stats.replaced).toBe(0);
    instance.dispose?.();
  });

  it('keeps toolbox selection and rotation responsive immediately after placement', async () => {
    const { game, step, instance } = await placedPlank(false, 0);
    const slot = game.tools.findIndex((tool, index) => index !== game.selected && tool && !tool.piece.isPutty);
    const tool = game.tools[slot];
    const [x, y] = CarpentryGame.toolCell(slot);
    const pos: [number, number] = [CARP_X + x * CARP_CELL + 5, CARP_Y + y * CARP_CELL + 5];
    step(pos, [{ type: 'mousedown', button: 1, pos }, { type: 'mouseup', button: 1, pos }], 20);
    expect(game.held).toBe(tool);
    step(pos, [{ type: 'keydown', key: 'c' }], 20);
    expect(game.stats.spins).toBe(1);
    expect(game.tentativeAt).toBeNull();
    instance.dispose?.();
  });

  it.each([4, 5])('replays and seeks triple clicks with their recorded timing rules (version %s)', async version => {
    const { pos, step, instance, buttons, setters, recorder, currentGame, open } = await placedPlank(false, 0);
    const click: InputEvent[] = [{ type: 'mousedown', button: 1, pos }, { type: 'mouseup', button: 1, pos }];
    step(pos, click, 100); step(pos, click, 100);
    const tape = recorder.finish('Triple-click regression')!;
    buttons.get('Play::Start')!(); instance.dispose?.();
    await replayWrites.idle();
    if (version === 4) { tape.simulatorVersion = 4; delete tape.checks; }
    const { encodeReplayBlob, replayMetadata } = await import('../core/replay');
    const { saveReplayFile } = await import('../core/replay-storage');
    const blob = await encodeReplayBlob(tape);
    await saveReplayFile({ metadata: replayMetadata(tape, blob.size), blob });
    const reopened = await open(), playback = captured.recorders.at(-1)!;
    await vi.waitFor(() => expect(playback.hasPlayableAt(tape.at, tape.runId)).toBe(true));
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await playback.playAt(tape.at, tape.runId)).toBe(true);
    perf.mockReturnValue(tape.duration); reopened.frame([]);
    expect(currentGame().stats.replaced).toBe(version === 4 ? 1 : 0);
    expect(currentGame().tentative !== null).toBe(version === 5);
    setters.get('History:Replays:Jump to (s)')!(tape.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(playback.isSeeking).toBe(false));
    expect(currentGame().stats.replaced).toBe(version === 4 ? 1 : 0);
    expect(currentGame().tentative !== null).toBe(version === 5);
    expect(playback.divergedAt).toBeNull();
    reopened.dispose?.();
  });

  it.each([[false, false], [false, true], [true, false], [true, true]])('keeps a picked-up plank held when movement follows release (ship: %s, batched pickup: %s)', async (ship, batched) => {
    const { game, pos, step, instance } = await placedPlank(ship);
    const down: InputEvent = { type: 'mousedown', button: 1, pos };
    if (!batched) step(pos, [down]);
    step([pos[0] + CARP_CELL, pos[1]], [...(batched ? [down] : []), { type: 'mouseup', button: 1, pos }]);
    expect(game.held).not.toBeNull();
    expect(game.tentativeAt).not.toBeNull();
    expect(game.stats.replaced).toBe(0);
    // An intentional second click still completes the adjustment.
    const moved: [number, number] = [pos[0] + CARP_CELL, pos[1]];
    step(moved, [{ type: 'mousedown', button: 1, pos: moved }, { type: 'mouseup', button: 1, pos: moved }]);
    expect(game.held).toBeNull();
    expect(game.tentativeAt).toBeNull();
    expect(game.stats.replaced).toBe(1);
    instance.dispose?.();
  });

  it.each([15, 16])('uses the client drag threshold at release even if the pointer moves back before the frame (%s px)', async distance => {
    const { game, pos, step, instance } = await placedPlank();
    step(pos, [{ type: 'mousedown', button: 1, pos }]);
    step(pos, [{ type: 'mouseup', button: 1, pos: [pos[0] + distance, pos[1]] }]);
    expect(game.stats.replaced).toBe(distance > 15 ? 1 : 0);
    expect(game.held === null).toBe(distance > 15);
    instance.dispose?.();
  });

  it('places a drag batched into one frame at the release position', async () => {
    const { game, pos, step, instance } = await placedPlank();
    const at = game.tentativeAt!;
    const target = game.target([at[0] + 1, at[1]], game.tentative!.sprite.piece)!;
    step(pos, [{ type: 'mousedown', button: 1, pos }, { type: 'mouseup', button: 1, pos: [pos[0] + CARP_CELL, pos[1]] }]);
    expect(game.held).toBeNull();
    expect(game.stats.replaced).toBe(1);
    expect(target.hole.tools.at(-1)!.at).toEqual(target.at);
    instance.dispose?.();
  });

  it.each([false, true])('routes the place key directly to the controller action (ship: %s)', async ship => {
    const { game, pos, step, instance } = await placedPlank(ship);
    const plank = game.tentative!.sprite, tool = game.tools[game.selected];
    step(pos, [{ type: 'keydown', key: 'z' }, { type: 'keyup', key: 'z' }]);
    expect(game.held).toBe(tool);
    expect(plank.state).toBe(5);
    expect(game.tentativeAt).toBeNull();
    instance.dispose?.();
  });

  it('replays and seeks the corrected pickup order', async () => {
    const { game, pos, step, instance, buttons, setters, recorder, currentGame } = await placedPlank();
    step(pos, [{ type: 'mousedown', button: 1, pos }]);
    step([pos[0] + CARP_CELL, pos[1]], [{ type: 'mouseup', button: 1, pos }]);
    expect(game.held).not.toBeNull();
    const tape = recorder.finish('Pickup regression')!;
    expect(tape.simulatorVersion).toBe(5);
    buttons.get('Play::Start')!(); // Stop the live session before playback.
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(tape.at, tape.runId)).toBe(true);
    perf.mockReturnValue(tape.duration); instance.frame([]);
    expect(currentGame().held).not.toBeNull();
    expect(currentGame().stats.replaced).toBe(0);
    expect(recorder.divergedAt).toBeNull();
    setters.get('History:Replays:Jump to (s)')!(tape.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    expect(currentGame().held).not.toBeNull();
    expect(currentGame().stats.replaced).toBe(0);
    expect(recorder.divergedAt).toBeNull();
    instance.dispose?.();
  });

  it('preserves the input order when loading and seeking a version 2 replay', async () => {
    const { pos, step, instance, buttons, setters, recorder, currentGame, open } = await placedPlank();
    step(pos, [{ type: 'mousedown', button: 1, pos }]);
    step([pos[0] + CARP_CELL, pos[1]], [{ type: 'mouseup', button: 1, pos }]);
    const tape = recorder.finish('Historical pickup order')!;
    buttons.get('Play::Start')!();
    instance.dispose?.();
    await replayWrites.idle();
    // Store the same timeline with the old semantics. Version 2 committed this pickup.
    tape.simulatorVersion = 2;
    delete tape.checks;
    const { encodeReplayBlob, replayMetadata } = await import('../core/replay');
    const { saveReplayFile } = await import('../core/replay-storage');
    const blob = await encodeReplayBlob(tape);
    await saveReplayFile({ metadata: replayMetadata(tape, blob.size), blob });
    const reopened = await open();
    const historical = captured.recorders.at(-1)!;
    await vi.waitFor(() => expect(historical.hasPlayableAt(tape.at, tape.runId)).toBe(true));
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await historical.playAt(tape.at, tape.runId)).toBe(true);
    perf.mockReturnValue(tape.duration); reopened.frame([]);
    expect(currentGame().held).toBeNull();
    expect(currentGame().stats.replaced).toBe(1);
    setters.get('History:Replays:Jump to (s)')!(tape.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(historical.isSeeking).toBe(false));
    expect(currentGame().held).toBeNull();
    expect(currentGame().stats.replaced).toBe(1);
    reopened.dispose?.();
  });

  it('preserves mouse-style place-key pickup in version 3 replays', async () => {
    const { pos, step, instance, buttons, setters, recorder, currentGame, open } = await placedPlank();
    step(pos, [{ type: 'keydown', key: 'z' }, { type: 'keyup', key: 'z' }]);
    const tape = recorder.finish('Historical place key')!;
    buttons.get('Play::Start')!(); instance.dispose?.();
    await replayWrites.idle();
    tape.simulatorVersion = 3; delete tape.checks;
    const { encodeReplayBlob, replayMetadata } = await import('../core/replay');
    const { saveReplayFile } = await import('../core/replay-storage');
    const blob = await encodeReplayBlob(tape);
    await saveReplayFile({ metadata: replayMetadata(tape, blob.size), blob });
    const reopened = await open(), historical = captured.recorders.at(-1)!;
    await vi.waitFor(() => expect(historical.hasPlayableAt(tape.at, tape.runId)).toBe(true));
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await historical.playAt(tape.at, tape.runId)).toBe(true);
    perf.mockReturnValue(tape.duration); reopened.frame([]);
    expect(currentGame().held).not.toBeNull();
    expect(currentGame().tentativeAt).not.toBeNull();
    setters.get('History:Replays:Jump to (s)')!(tape.duration / 1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(historical.isSeeking).toBe(false));
    expect(currentGame().held).not.toBeNull();
    expect(currentGame().tentativeAt).not.toBeNull();
    reopened.dispose?.();
  });
});

describe('Shipwrightery sessions and replays', () => {
  it('loads with live panel guards, records a drag and completes the tutorial combo in playback', async () => {
    const store = new Store('shipwrightery');
    store.set('difficulty', 0);
    const { panel, buttons, results, clocks } = panelHarness(true);
    let now = 0;
    const input = { mouse: [-1, -1] as [number, number] };
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./shipwrightery/index')).default;
    const instance = await factory({ screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    const click = (x: number, y: number) => {
      input.mouse = [x, y];
      instance.frame([{ type: 'mousedown', button: 1, pos: [x, y] }, { type: 'mouseup', button: 1, pos: [x, y] }]);
    };
    now = 500;
    input.mouse = [365, 202];
    instance.frame([{ type: 'mousedown', button: 1, pos: [...input.mouse] }]);
    now = 520;
    input.mouse = [365, 262];
    instance.frame([]);
    now = 700;
    instance.frame([{ type: 'mouseup', button: 1, pos: [...input.mouse] }]);
    click(145, 409); click(185, 82);
    now = 1400; instance.frame([]);
    click(245, 409); click(125, 262);
    now = 2100; instance.frame([]);
    click(345, 409); click(305, 262);
    now = 2400; instance.frame([]);
    expect(clocks()).toContainEqual(expect.objectContaining({ label: 'Overtime' }));
    now = 4400; instance.frame([]);
    now = 6400; instance.frame([]);
    const result = results()[0] as { rows: string[][] };
    expect(result.rows).toContainEqual(['Points', '18']);
    expect(result.rows).toContainEqual(['Best combo', '3']);
    expect(result.rows).toContainEqual(['Swaps', '1']);
    expect(store.history('difficulty:0')).toHaveLength(1);
    const data = JSON.parse(exportAll()).data;
    await replayWrites.idle();
    const [replay] = await listReplayFiles('shipwrightery');
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await captured.recorders[0].playAt(replay.at, replay.runId)).toBe(true);
    perf.mockReturnValue(replay.duration);
    instance.frame([]);
    expect(results()[0]).toEqual(result);
    expect(JSON.parse(exportAll()).data).toEqual(data);
    buttons.get('History:Replays:Stop')!();
    instance.dispose?.();
  });
});

describe('Sailing Create sessions',()=>{
  it('edits a frozen draft, tries it without timers or recordings, and restores it after play and reopening',async()=>{
    const store=new Store('sailing');store.set('mode','Create');
    store.set('settings',{difficulty:5,tokens:1,desired:3,timerMs:120000,indicatorMax:7.48});
    const {panel,buttons,selections,clocks}=panelHarness();let now=0;
    const screen=new Proxy({ctx:canvasContext()},{get:(target,key)=>key==='ctx'?target.ctx:()=>({width:0,height:0})});
    const factory=(await import('./sailing/index')).default;
    const context={screen,input:{mouse:[-1,-1]},panel,store,ticks:()=>now} as unknown as PuzzleContext;
    const step=vi.spyOn(SailingGame.prototype,'step');
    const instance=await factory(context);
    const click=(x:number,y:number,button=1)=>instance.frame([{type:'mousedown',button,pos:[88+x*34+17,42+y*34+17]}]);
    buttons.get('Play::Start')!();now=999999;instance.frame([]);expect(step).not.toHaveBeenCalled();
    click(0,10); // Default platform: 2 × 2 rope.
    selections.get('Play:Board tools:Tool')!('pair');click(3,12);
    selections.get('Play:Board tools:Tool')!('single');click(0,15);
    selections.get('Play:Board tools:Tool')!('blocker');click(7,14);
    const draft=store.get<any>('createBoard',null);
    expect(draft.targets).toEqual([{x:0,y:11,type:12,enabled:true}]);
    expect(draft.cells[12*8+3]).toBe(4);expect(draft.cells[12*8+4]).toBe(11);
    expect(draft.cells[15*8]).toBe(0);expect(draft.cells[14*8+7]).toBe(5);
    click(7,14,3);expect(store.get<any>('createBoard',null).cells[14*8+7]).toBe(-1);
    buttons.get('Play:Board tools:Undo')!();expect(store.get('createBoard',null)).toEqual(draft);
    buttons.get('Play:Freeplay board:Play board')!();instance.frame([]);
    const game=step.mock.contexts.at(-1)! as SailingGame;
    expect(game.sandbox).toBe(true);expect(game.board.cells).toEqual(draft.cells);
    game.board.set(0,15,8);now+=180000;instance.frame([]);expect(clocks()).toEqual([null]);
    buttons.get('Play:Freeplay board:Back to editor')!();
    expect(store.get('createBoard',null)).toEqual(draft);
    buttons.get('Play:Freeplay board:Play board')!();instance.frame([]);
    expect((step.mock.contexts.at(-1)! as SailingGame).board.cells).toEqual(draft.cells);
    buttons.get('Play::Start')!();instance.dispose?.();
    await replayWrites.idle();expect(await listReplayFiles('sailing')).toHaveLength(0);
    expect(store.history('d5-t1-r3-120000-i7.48')).toHaveLength(0);
    const reopened=await factory(context);buttons.get('Play::Start')!();
    buttons.get('Play:Freeplay board:Play board')!();reopened.frame([]);
    expect((step.mock.contexts.at(-1)! as SailingGame).board.cells).toEqual(draft.cells);
    reopened.dispose?.();
  });
});

describe('Sailing falling input timing',()=>{
  async function sailingHarness(){
    const step=vi.spyOn(SailingGame.prototype,'step');
    vi.spyOn(crypto,'getRandomValues').mockImplementation(values=>{(values as Uint32Array)[0]=42;return values;});
    const {panel,buttons}=panelHarness();let now=0;
    const screen=new Proxy({ctx:canvasContext()},{get:(target,key)=>key==='ctx'?target.ctx:()=>({width:0,height:0})});
    const factory=(await import('./sailing/index')).default;
    const instance=await factory({screen,input:{mouse:[-1,-1]},panel,store:new Store('sailing'),ticks:()=>now} as unknown as PuzzleContext);
    buttons.get('Play::Start')!();instance.frame([]);
    const game=step.mock.contexts.at(-1)! as SailingGame;
    return {instance,game,frame:(ms:number,events:Parameters<typeof instance.frame>[0]=[])=>{now+=ms;instance.frame(events);}};
  }
  it('does not apply a newly pressed Space to time that already elapsed',async()=>{
    const h=await sailingHarness();
    h.frame(1000,[{type:'keydown',key:'space'}]);
    const before=h.game.active!;
    expect(before.y).toBe(-1);expect(before.fraction*34).toBeCloseTo(30,4);
    const pixels=before.y*34+before.fraction*34;
    h.frame(17);
    const after=h.game.active!;
    expect(after.y*34+after.fraction*34-pixels).toBeGreaterThan(12);
    expect(after.y*34+after.fraction*34-pixels).toBeLessThan(15);
    h.instance.dispose?.();
  });
  it('requires a fresh Space press to accelerate the next pair after holding through a landing',async()=>{
    const h=await sailingHarness();h.frame(0,[{type:'keydown',key:'space'}]);
    for(let i=0;i<200&&h.game.moves===0;i++)h.frame(17);
    expect(h.game.moves).toBe(1);
    for(let i=0;i<200&&!h.game.active;i++)h.frame(17);
    const pair=h.game.active!;expect(pair).not.toBeNull();
    for(let i=0;i<35;i++)h.frame(17);
    expect(h.game.active).toBe(pair);expect(pair.y).toBe(-1);expect(pair.fraction).toBeGreaterThan(0.5);
    h.frame(0,[{type:'keyup',key:'space'},{type:'keydown',key:'space'}]);
    for(let i=0;i<200&&h.game.moves===1;i++)h.frame(17);
    expect(h.game.moves).toBe(2);
    h.instance.dispose?.();
  });
  it('lets Left insert a piece between white and blue squares at the board edge',async()=>{
    const h=await sailingHarness();h.game.board.cells.fill(-1);
    h.game.board.targets=[{x:1,y:5,type:12,enabled:true}];
    h.game.board.set(0,4,21);h.game.board.set(0,6,13);
    h.game.active={x:1,y:4,orient:5,pieces:[0,8],fraction:0.75};
    h.frame(0,[{type:'keydown',key:'arrowleft'}]);
    expect(h.game.active).toMatchObject({x:0,y:4,orient:5,fraction:0.75});
    h.frame(300,[{type:'keyup',key:'arrowleft'}]);
    expect(h.game.isLanding).toBe(true);
    h.frame(141);
    expect(h.game.moves).toBe(1);expect(h.game.board.get(0,5)).toBe(4);
    expect(h.game.board.get(0,4)).toBe(21);expect(h.game.board.get(0,6)).toBe(13);
    h.instance.dispose?.();
  });
});

describe('timed puzzle warnings', () => {
  it.each([
    ['forage', { settings: { mode: 'ci', roundSeconds: 0 } }],
    ['blacksmithing', { perfectTimer: 0 }],
    ['treasure-haul', { mode: 'clear', clearPack: 'emeralds', round: 0 }],
    ['vampire-carp', { config: { unlimited: true } }],
    ['shipwrightery', { difficulty: 0 }],
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
    ['shipwrightery', 59999, 60000, 'timer_warning', { difficulty: 8 }],
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
    const store = new Store('treasure-haul'); store.set('seedMode', false); vi.spyOn(crypto, 'getRandomValues').mockImplementation((values: any) => { values.fill(1234); return values; });
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
    const rng = new Random(1234); rng.beginSession(1234); rng.nextBoard();
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
    const store = new Store('treasure-haul'); store.set('seedMode', false); vi.spyOn(crypto, 'getRandomValues').mockImplementation((values: any) => { values.fill(1); return values; });
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
    store.set('sessionSeed', 1); const rng = new Random(1); rng.beginSession(1); rng.nextBoard();
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
    const store = new Store('treasure-haul'); store.set('seedMode', false); vi.spyOn(crypto, 'getRandomValues').mockImplementation((values: any) => { values.fill(1234); return values; });
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
    const rng = new Random(1234); rng.beginSession(1234); rng.nextBoard();
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
      format: 'puzzle-practice-replay', version: 1, randomVersion: 1, puzzle: 'treasure-haul', at: 1, duration: 0, clockStart: 0,
      settingsVersion: version, simulatorVersion: version, result: 'Historical drill', frames: [], steps: [],
      seed: new Random(7).snapshot(),
      settings: { mode: 'clear', clearPack: pack, roundSecs: 30, spawnDelay: false, gemRates: [0, 0],
        coinsPerChest: 100, chestRules: 4, trainingRules: rules, dismissRules: 2,
        ...(version >= 7 ? { impossibleChests: false } : {}) },
    };
    const blob = await encodeReplayBlob(tape);
    await saveReplayFile({ metadata: replayMetadata(tape, blob.size), blob });
    const boards = vi.spyOn(HaulBoard.prototype, 'populate');
    const store = new Store('treasure-haul'); store.set('seedMode', false); vi.spyOn(crypto, 'getRandomValues').mockImplementation((values: any) => { values.fill(1234); return values; });
    store.set('mode', 'clear'); store.set('clearPack', pack);
    const { panel, buttons } = panelHarness();
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./treasure-haul/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => 0 } as unknown as PuzzleContext);
    const recorder = captured.recorders[0];
    await vi.waitFor(() => expect(recorder.hasPlayableAt(tape.at)).toBe(true));
    vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(tape.at)).toBe(true);
    const rng = new Random(7);
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
    const store = new Store('treasure-haul'); store.set('seedMode', false); vi.spyOn(crypto, 'getRandomValues').mockImplementation((values: any) => { values.fill(1234); return values; });
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
    const store = new Store('treasure-haul'); store.set('seedMode', false); vi.spyOn(crypto, 'getRandomValues').mockImplementation((values: any) => { values.fill(1234); return values; }); store.set('round', 30); store.set('gemRates', [100, 0]);
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
    const store = new Store('treasure-haul'); store.set('seedMode', false); vi.spyOn(crypto, 'getRandomValues').mockImplementation((values: any) => { values.fill(1234); return values; }); store.set('mode', 'chests2'); store.set('gemRates', [0, 0]);
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
    const rng = new Random(1234); rng.beginSession(1234); rng.nextBoard();
    const solution = createDrill(() => rng.random(), 'edges').solution!;
    const store = new Store('treasure-haul'); store.set('seedMode', false); vi.spyOn(crypto, 'getRandomValues').mockImplementation((values: any) => { values.fill(1234); return values; });
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
    const store = new Store('treasure-haul'); store.set('seedMode', false); vi.spyOn(crypto, 'getRandomValues').mockImplementation((values: any) => { values.fill(1234); return values; }); store.set('round', 30);
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
    const store = new Store('treasure-haul'); store.set('seedMode', false); vi.spyOn(crypto, 'getRandomValues').mockImplementation((values: any) => { values.fill(1234); return values; }); store.set('gemRates', [0, 0]);
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
    expect(replay).toMatchObject({ settingsVersion: 2, simulatorVersion: 3, duration: 120000 });
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
  it('wraps a long opponent knockout at the board width', async () => {
    const update = Match.prototype.update;
    vi.spyOn(Match.prototype, 'update').mockImplementation(function (this: Match, now: number) {
      const target = this.targets[0];
      this.names[target] = 'Wrathful Cultist';
      this.fighters[target].out = true;
      update.call(this, now);
    });
    const store = new Store('swordfight');
    const { panel, buttons } = panelHarness();
    const ctx = canvasContext() as unknown as CanvasRenderingContext2D;
    // Game text is drawn a glyph at a time: keep the white fill passes (the outline is black).
    const glyphs: Array<{ ch: string; x: number; y: number }> = [];
    Object.assign(ctx, { fillText: (ch: string, x: number, y: number) => { if (ctx.fillStyle === '#ffffff') glyphs.push({ ch, x, y }); } });
    const screen = new Proxy({ ctx }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./swordfight/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => 100 } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    instance.frame([]);
    const { wrapGameText, gameLineHeight } = await import('../core/game-text');
    const boardWidth = SWORD_COLUMNS * SWORD_COLUMN_PX;
    const expected = wrapGameText(ctx, 'Wrathful Cultist was knocked out!', { px: 30 }, boardWidth).split('\n');
    expect(expected).toHaveLength(2);
    const rows = new Map<number, string>();
    for (const g of glyphs) rows.set(g.y, (rows.get(g.y) ?? '') + g.ch);
    // The fill is drawn twice, as the game draws it.
    const lines = [...rows.entries()].map(([y, text]) => [y, text.slice(0, text.length / 2)] as const)
      .filter(([, text]) => text.includes('Wrathful') || text.includes('knocked'));
    expect(lines.map(([, text]) => text)).toEqual(expected.map((line) => line.replaceAll(' ', '')));
    expect(lines[1][0] - lines[0][0]).toBe(gameLineHeight({ px: 30 }));
    instance.dispose?.();
  });
});

describe('Navigation sessions and replay', () => {
  it('keeps the WW score and countdown across repeated Dismiss, excludes pauses and replays the whole run', async () => {
    const { DEFAULT_SETTINGS, settingsKey } = await import('./navigation/game');
    const settings = { ...DEFAULT_SETTINGS, timerMs: 120000 };
    const store = new Store('navigation');
    store.set('settings', settings);
    const { panel, buttons, buttonStates, clocks, results } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./navigation/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    const dismiss = buttons.get('Play::Dismiss')!;
    buttons.get('Play::Start')!();
    expect(clocks()[0]).toMatchObject({ ms: 120000, countdown: true });
    now = 30000; instance.frame([]); dismiss(); instance.frame([]);
    expect(clocks()[0]).toMatchObject({ ms: 90000 });
    now = 50000; instance.frame([]);
    buttons.get('Play::Pause')!();
    now = 60000; dismiss(); instance.frame([]);
    expect(clocks()[0]).toMatchObject({ ms: 70000 });
    expect(buttonStates.get('Play::Pause')!.label!()).toBe('Pause');
    now = 129999; instance.frame([]);
    expect(clocks()[0]).toMatchObject({ ms: 1 });
    expect(results()[0]).toBeNull();
    now = 130000; instance.frame([]);
    expect(clocks()[0]).toMatchObject({ ms: 0 });
    const expected = results()[0];
    expect(expected).not.toBeNull();
    expect(store.history(settingsKey(settings)).at(-1)).toMatchObject({ reason: 'Time up', boards: 3 });
    expect(buttonStates.get('Play::Dismiss')!.disabled!()).toBe(true);
    dismiss();
    expect(results()[0]).toEqual(expected);
    // One run, one history entry and one replay, however many boards it dealt.
    expect(store.history(settingsKey(settings))).toHaveLength(1);
    await replayWrites.idle();
    const files = await listReplayFiles('navigation');
    expect(files).toHaveLength(1);
    const replay = files[0];
    const before = JSON.parse(exportAll()).data;
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await captured.recorders[0].playAt(replay.at, replay.runId)).toBe(true);
    expect(clocks()[0]).toMatchObject({ ms: 120000 });
    perf.mockReturnValue(replay.duration); instance.frame([]);
    expect(clocks()[0]).toMatchObject({ ms: 0 });
    expect(results()[0]).toEqual(expected);
    expect(JSON.parse(exportAll()).data).toEqual(before);
    buttons.get('Play::Start')!();
    expect(clocks()[0]).toMatchObject({ ms: 120000 });
    expect(results()[0]).toBeNull();
    instance.dispose?.();
  });

  it.each(['normal', 'ww'] as const)('%s Dismiss restarts a paused board and a finished board without duplicating history', async mode => {
    const { DEFAULT_SETTINGS, settingsKey } = await import('./navigation/game');
    const settings = { ...DEFAULT_SETTINGS, mode, timerMs: 120000, dismissDelayMs: 0 };
    const store = new Store('navigation');
    store.set('settings', settings);
    const { panel, buttons, buttonStates, stats, results } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./navigation/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now } as unknown as PuzzleContext);
    const dismiss = buttons.get('Play::Dismiss')!;
    expect(buttonStates.get('Play::Dismiss')!.disabled!()).toBe(true);
    buttons.get('Play::Start')!();
    buttons.get('Controls:Controls:Drop star')!();
    now = 200; instance.frame([]);
    now = 500; instance.frame([]);
    buttons.get('Play::Pause')!();
    now = 10500;
    dismiss();
    now += 0; instance.frame([]);
    expect(buttonStates.get('Play::Pause')!.label!()).toBe('Pause');
    expect(buttonStates.get('Play::Start')!.label!()).toBe('Stop');
    expect(results()[0]).toBeNull();
    expect(stats()[0]).toContainEqual(['Points', '0']);
    expect(store.get('settings', null)).toEqual(settings);
    const history = store.history(settingsKey(settings));
    // Normal saves the dismissed board; WW carries on with the run and saves it when it ends.
    expect(history).toHaveLength(mode === 'normal' ? 1 : 0);
    if (mode === 'normal') expect(history[0]).toMatchObject({ reason: 'Dismissed', stars: 1 });

    now += 100; instance.frame([]);
    buttons.get('Play::Start')!();
    expect(results()[0]).toMatchObject({ rows: expect.arrayContaining(mode === 'normal'
      ? [['Stars dropped', '0'], ['Ring rotations', '0'], ['Time', '0.10s']]
      : [['Stars dropped', '1'], ['Boards', '2']]) });
    const saved = mode === 'normal' ? 2 : 1;
    expect(store.history(settingsKey(settings))).toHaveLength(saved);
    dismiss();
    expect(results()[0]).toBeNull();
    expect(store.history(settingsKey(settings))).toHaveLength(saved);
    now += 100; instance.frame([]);
    instance.dispose?.();
    await replayWrites.idle();
    const replays = await listReplayFiles('navigation');
    expect(replays).toHaveLength(saved + 1);
    expect(new Set(replays.map(replay => replay.runId)).size).toBe(saved + 1);
    if (mode === 'normal') expect(replays.map(replay => replay.result)).toContain('Dismissed · 0 points');
  });

  it.each(['normal', 'ww'] as const)('%s Dismiss holds play for the dismiss delay', async mode => {
    const { DEFAULT_SETTINGS, settingsKey } = await import('./navigation/game');
    const settings = { ...DEFAULT_SETTINGS, mode, timerMs: 120000 };
    expect(settings.dismissDelayMs).toBe(1000);
    const store = new Store('navigation');
    store.set('settings', settings);
    const { panel, buttons, buttonStates, results } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./navigation/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    const drop = buttonStates.get('Controls:Controls:Drop star')!;
    buttons.get('Play::Start')!();
    now = 100; instance.frame([]);
    buttons.get('Play::Dismiss')!(); instance.frame([]);
    if (mode === 'normal') {
      // The dismissed run is saved at once; the next one starts after the delay.
      expect(store.history(settingsKey(settings))).toHaveLength(1);
      expect(buttonStates.get('Play::Start')!.label!()).toBe('Start');
      now = 1099; instance.frame([]);
      expect(results()[0]).not.toBeNull();
      now = 1100; instance.frame([]);
      expect(buttonStates.get('Play::Start')!.label!()).toBe('Stop');
      expect(results()[0]).toBeNull();
    } else {
      // The run carries on, but the new board can't be played until the delay has passed.
      expect(drop.disabled!()).toBe(true);
      expect(buttonStates.get('Play::Dismiss')!.disabled!()).toBe(true);
      now = 1099; instance.frame([{ type: 'keydown', key: 'space' }]);
      expect(drop.disabled!()).toBe(true);
      now = 1100; instance.frame([]);
      expect(drop.disabled!()).toBe(false);
      buttons.get('Play::Start')!();
      expect(results()[0]).toMatchObject({ rows: expect.arrayContaining([['Stars dropped', '0'], ['Boards', '2']]) });
    }
    instance.dispose?.();
  });

  it('Slow drop holds each star at the top until Drop is pressed', async () => {
    const { DEFAULT_SETTINGS } = await import('./navigation/game');
    const settings = { ...DEFAULT_SETTINGS, mode: 'normal' as const, timerMs: 0, slowDrop: true };
    const store = new Store('navigation');
    store.set('settings', settings);
    const { panel, buttons, results } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./navigation/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    // Without Slow drop a star lands in about 11 s; here a minute passes and none has.
    for (now = 100; now <= 60000; now += 100) instance.frame([]);
    instance.frame([{ type: 'keydown', key: 'space' }]);
    for (let i = 0; i < 10; i++) { now += 100; instance.frame([]); }
    buttons.get('Play::Start')!();
    expect(results()[0]).toMatchObject({ rows: expect.arrayContaining([['Stars dropped', '1']]) });
    instance.dispose?.();
  });

  it('carries a Normal quota run across Dismiss, as WW carries its runs', async () => {
    const { DEFAULT_SETTINGS, settingsKey } = await import('./navigation/game');
    const settings = { ...DEFAULT_SETTINGS, mode: 'normal' as const, timerMs: 0, clears: true };
    const store = new Store('navigation');
    store.set('settings', settings);
    const { panel, buttons, results } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./navigation/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    buttons.get('Controls:Controls:Drop star')!();
    now = 200; instance.frame([]);
    now = 500; instance.frame([]);
    buttons.get('Play::Dismiss')!(); instance.frame([]);
    expect(results()[0]).toBeNull();
    expect(store.history(settingsKey(settings))).toHaveLength(0);
    now = 700; instance.frame([]);
    buttons.get('Play::Start')!();
    expect(results()[0]).toMatchObject({ rows: expect.arrayContaining([['Stars dropped', '1'], ['Boards', '2'], ['Constellations', '0 / 13']]) });
    expect(store.history(settingsKey(settings))).toEqual([expect.objectContaining({ reason: 'Stopped', boards: 2 })]);
    instance.dispose?.();
  });

  it.each(['normal', 'ww'] as const)('%s loads again with saved history and makes its replay available', async mode => {
    const store = new Store('navigation');
    store.set('settings', { mode, difficulty: 4, extraRing: true, wildTargets: true, timerMs: 0 });
    const first = panelHarness(true);
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./navigation/index')).default;
    const context = { screen, input: { mouse: [-1, -1] }, store, ticks: () => now };
    const instance = await factory({ ...context, panel: first.panel } as unknown as PuzzleContext);
    first.buttons.get('Play::Start')!();
    now = 100; instance.frame([]);
    first.buttons.get('Play::Start')!();
    instance.dispose?.();
    await replayWrites.idle();
    const [replay] = await listReplayFiles('navigation');
    expect(replay).toBeDefined();
    const before = JSON.parse(exportAll()).data;

    const refreshed = panelHarness(true);
    const reloaded = await factory({ ...context, store: new Store('navigation'), panel: refreshed.panel } as unknown as PuzzleContext);
    reloaded.frame([]);
    await vi.waitFor(() => expect(refreshed.rowActions.get('Play this game replay')!.disabled!(0)).toBe(false));
    expect(await captured.recorders[1].playAt(replay.at, replay.runId)).toBe(true);
    expect(JSON.parse(exportAll()).data).toEqual(before);
    reloaded.dispose?.();
  });

  it.each([
    ['normal',false,false], ['ww',false,false], ['ww',false,true], ['ww',true,false], ['ww',true,true],
  ] as const)('%s extraRing=%s wildTargets=%s preserves results through pause, playback, seeking and Stop', async (mode,extraRing,wildTargets) => {
    const store = new Store('navigation');
    const settings = { mode,difficulty:4,extraRing,wildTargets,timerMs:120000 };
    store.set('settings',settings);
    const { panel,buttons,buttonStates,setters,stats,results } = panelHarness();
    let now=0;
    const screen = new Proxy({ ctx:canvasContext() }, { get:(target,key) => key==='ctx'?target.ctx:()=>({ width:0,height:0 }) });
    const factory = (await import('./navigation/index')).default;
    const instance = await factory({ screen,input:{ mouse:[-1,-1] },panel,store,ticks:()=>now,
      setReplayTime:(time:number|null)=>{ if(time!==null) now=time; } } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    let pausedTime=0;
    for(let t=0;t<=120000;t+=100) {
      now=t+pausedTime;
      if(t===300) {
        buttons.get('Play::Pause')!();
        expect(buttonStates.get('Play::Pause')!.label!()).toBe('Resume');
        const before=stats();now+=10000;instance.frame([{ type:'keydown',key:'space' }]);
        expect(stats()).toEqual(before);buttons.get('Play::Pause')!();pausedTime=10000;
      }
      if(t%500===0 && extraRing) buttons.get('Controls:Controls:Drop star')!();
      instance.frame(t%500===0 && !extraRing?[{ type:'keydown',key:'space' }]:[]);
      if(results()[0]) break;
    }
    const expected = results()[0] as { rows:string[][]; report:DutyReport };
    expect(expected).not.toBeNull();
    expect(Number(expected.rows.find(([name])=>name==='Stars dropped')![1])).toBeGreaterThan(0);
    expect(expected.report.mode).toBe(mode==='ww'?'WW':'Normal');
    await replayWrites.idle();
    const data=JSON.parse(exportAll()).data;
    const files=await listReplayFiles('navigation');expect(files).toHaveLength(1);
    const replay=files[0];
    const recorder=captured.recorders[0];
    const perf=vi.spyOn(performance,'now').mockReturnValue(0);
    expect(await recorder.playAt(replay.at,replay.runId)).toBe(true);
    perf.mockReturnValue(replay.duration);instance.frame([]);
    expect((results()[0] as { rows:string[][] }).rows).toEqual(expected.rows);
    expect(JSON.parse(exportAll()).data).toEqual(data);
    setters.get('History:Replays:Jump to (s)')!(replay.duration/2000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(()=>expect(recorder.isSeeking).toBe(false));
    await new Promise(resolve=>setTimeout(resolve,0));
    setters.get('History:Replays:Jump to (s)')!(replay.duration/1000);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(()=>expect(recorder.isSeeking).toBe(false));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect((results()[0] as { rows:string[][] }).rows).toEqual(expected.rows);
    buttons.get('History:Replays:Stop')!();
    expect(store.get('settings',null)).toEqual(settings);
    expect(JSON.parse(exportAll()).data).toEqual(data);
    instance.dispose?.();
  });

  it('records button controls and saves a stopped run once when leaving', async () => {
    const store=new Store('navigation');
    const { panel,buttons,results }=panelHarness();let now=0;
    const screen=new Proxy({ ctx:canvasContext() },{ get:(target,key)=>key==='ctx'?target.ctx:()=>({ width:0,height:0 }) });
    const factory=(await import('./navigation/index')).default;
    const instance=await factory({ screen,input:{ mouse:[-1,-1] },panel,store,ticks:()=>now } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    buttons.get('Controls:Controls:Drop star')!();now=200;instance.frame([]);now=500;instance.frame([]);
    buttons.get('Controls:Controls:Rotate right')!();now=700;instance.frame([]);
    instance.dispose?.();await replayWrites.idle();
    const result=results()[0] as { rows:string[][] };
    expect(result.rows).toContainEqual(['Stars dropped','1']);
    expect(result.rows).toContainEqual(['Ring rotations','1']);
    expect(await listReplayFiles('navigation')).toHaveLength(1);
    const data=JSON.parse(exportAll()).data;
    expect(Object.entries(data).filter(([key])=>key.includes(':history:'))[0][1]).toHaveLength(1);
  });

  it.each([false,true])('keeps the game fall duration with extraRing=%s', async extraRing => {
    const store=new Store('navigation');
    store.set('settings',{ mode:'ww',difficulty:4,extraRing,wildTargets:true,timerMs:0 });
    const { panel,buttons,results }=panelHarness();let now=0;
    const screen=new Proxy({ ctx:canvasContext() },{ get:(target,key)=>key==='ctx'?target.ctx:()=>({ width:0,height:0 }) });
    const factory=(await import('./navigation/index')).default;
    const instance=await factory({ screen,input:{ mouse:[-1,-1] },panel,store,ticks:()=>now } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();now=11100;instance.frame([]);buttons.get('Play::Start')!();
    expect((results()[0] as { rows:string[][] }).rows).toContainEqual(['Stars dropped','0']);
    buttons.get('Play::Start')!();now+=11200;instance.frame([]);buttons.get('Play::Start')!();
    expect((results()[0] as { rows:string[][] }).rows).toContainEqual(['Stars dropped','1']);
    instance.dispose?.();
  });
});

describe('Forage art toggle', () => {
  it.each([undefined, 1, 2])('uses the selected moon limit %s, defaulting to one', async (limit) => {
    const { MoonField } = await import('./forage/werewolf');
    const spawn = vi.spyOn(MoonField.prototype, 'spawn');
    const store = new Store('forage');
    store.set('settings', { mode: 'ci', moons: true, roundSeconds: 0 });
    const { panel, buttons, selections } = panelHarness();
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./forage/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => 0 } as unknown as PuzzleContext);
    const select = selections.get('Settings:Specials:Maximum moons');
    expect(select).toBeDefined();
    if (limit !== undefined) {
      select!(limit);
      expect(store.get('settings', {})).toMatchObject({ maxMoons: limit });
    }
    buttons.get('Play::Start')!();
    expect((spawn.mock.contexts.at(-1) as InstanceType<typeof MoonField>).maxMoons).toBe(limit ?? 1);
    instance.dispose?.();
  });

  it.each([false, true])('swaps the monkey board icon and animation when art is %s', async (art) => {
    const { Forage } = await import('./forage/engine');
    const { WIDTH, HEIGHT, MONKEY } = await import('./forage/board');
    const { Images } = await import('../core/assets');
    vi.spyOn(Images, 'load').mockResolvedValue({ get: (asset: string) => ({ asset, width: 450, height: 600 }), has: () => true } as unknown as InstanceType<typeof Images>);
    const originalAct = Forage.prototype.act;
    vi.spyOn(Forage.prototype, 'act').mockImplementation(function (this: InstanceType<typeof Forage>, x, y, ccw) {
      this.load(Array.from({ length: WIDTH * HEIGHT }, (_, i) => (i % WIDTH + 2 * Math.floor(i / WIDTH)) % 5));
      this.board.setPiece(x, y, MONKEY);
      return originalAct.call(this, x, y, ccw);
    });
    const store = new Store('forage');
    store.set('settings', { mode: 'ci', roundSeconds: 0, moons: false });
    const { panel, buttons, toggles } = panelHarness();
    const blit = vi.fn();
    const ctx = Object.assign(canvasContext(), { drawImage: vi.fn() });
    const screen = new Proxy({ ctx, blit }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => ({ width: 0, height: 0 }) });
    let now = 0;
    const factory = (await import('./forage/index')).default;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now } as unknown as PuzzleContext);
    toggles.get('Settings:Display:Werewolf art')!(art);
    buttons.get('Play::Start')!();
    now = 2000; instance.frame([]);
    blit.mockClear();
    instance.frame([{ type: 'mousedown', button: 1, pos: [77, 60] }]);
    expect(blit.mock.calls.some(([image, , , options]) => image.asset === 'pieces' && options.area[0] === (art ? 9 : 7) * 45)).toBe(true);
    expect(blit.mock.calls.some(([image]) => image.asset === 'wolf_head')).toBe(art);
    expect(ctx.drawImage.mock.calls.some(([image]) => image.asset === 'monkey')).toBe(!art);
    expect(captured.sounds).not.toContain('forage_night');
    instance.dispose?.();
  });
});

describe('puzzle completion during replay', () => {
  it.each([['ci', 1], ['werewolf', 1], ['ci', 5]] as const)('preserves historical Forage %s version %s replay rules', async (mode, version) => {
    const { encodeReplayBlob, replayMetadata } = await import('../core/replay');
    const { saveReplayFile } = await import('../core/replay-storage');
    const { MoonField } = await import('./forage/werewolf');
    const spawn = vi.spyOn(MoonField.prototype, 'spawn');
    const tape: PuzzleReplay = {
      format: 'puzzle-practice-replay', version: 1, randomVersion: 1, puzzle: 'forage', at: 123, duration: 12000,
      settingsVersion: 1, simulatorVersion: version, result: 'Historical test',
      settings: { mode, bb: true, fj: true, cc: false, eq: true, machete: true, shovel: true,
        monkey: true, ants: true, scramble: true, forageLevel: 6,
        normalRatios: [0.6472, 0.3435, 0.0094], roundSeconds: 1, pacedChests: true,
        ...(version === 5 ? { moons: true } : {}),
        puzzleId: '0', pickedRandomly: false },
      seed: { format: 'forage-replay-state', seeds: [1, 2], boards: ['42'] },
      frames: [{ t: 0, mouse: [-1, -1], events: [] }, { t: 12000, mouse: [-1, -1], events: [] }],
      steps: [0, 5000, 12000],
    };
    const blob = await encodeReplayBlob(tape);
    await saveReplayFile({ metadata: replayMetadata(tape, blob.size), blob });
    const store = new Store('forage');
    const { panel, results } = panelHarness();
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./forage/index')).default;
    let now = 0;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store,
      ticks: () => now, setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    const recorder = captured.recorders[0];
    await vi.waitFor(() => expect(recorder.hasPlayableAt(tape.at)).toBe(true));
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(tape.at)).toBe(true);
    if (mode === 'werewolf' || version === 5) expect((spawn.mock.contexts.at(-1) as InstanceType<typeof MoonField>).maxMoons).toBe(2);
    perf.mockReturnValue(tape.duration);
    instance.frame([]);
    const report = (results()[0] as { report: DutyReport }).report;
    expect(report.mode).toBe(mode === 'ci' ? 'Gauntlet' : 'Werewolf');
    expect(report.score.label).toBe(mode === 'ci' ? 'Score' : 'Points a move');
    expect(store.get('settings', null)).toBeNull();
    instance.dispose?.();
  });

  it.each([
    ['blacksmithing', 500, 20, { mode: 'perfect', perfectTimer: 100 }],
    ['treasure-haul', 62000, 100, { round: 30, gemRates: [50, 50] }],
    ['distilling', 30000, 20, { timerOn: true, timerSeconds: 0.01 }],
    ['vampire-carp', 121000, 1000, {}],
    ['vampire-carp', 121000, 1000, { config: { ship: true, difficulty: 6, tokens: 2 } }],
    ['forage', 12000, 20, { settings: { mode: 'ci', roundSeconds: 5 } }],
    ['forage', 12000, 20, { settings: { mode: 'ci', roundSeconds: 5, werewolfArt: true, moons: false } }],
    ['forage', 12000, 20, { settings: { mode: 'ci', roundSeconds: 5, werewolfArt: false, moons: true } }],
    ['forage', 12000, 20, { settings: { mode: 'ci', roundSeconds: 5, werewolfArt: true, moons: true } }],
    ['forage', 12000, 20, { settings: { mode: 'ci', roundSeconds: 5, moons: true, maxMoons: 2 } }],
    ['forage', 12000, 20, { settings: { mode: 'werewolf', roundSeconds: 5 } }],
    ['swordfight', 90000, 20, { settings: { opponents: 1, skill: 5, difficulty: 5, breakers: 12.5, sword: [2, 0, 0], enemySword: [6, 4, 2] } }],
  ] as const)('%s keeps player history unchanged through playback, seeking and Stop', async (puzzle, end, step, settings) => {
    const store = new Store(puzzle);
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
      // Session games outlive a test, so a later run with the same settings key counts earlier ones too.
      const sessionGames = store.sessionHistory(histories[0][0].slice(histories[0][0].indexOf(':history:') + ':history:'.length)).length;
      expect(sessionGames).toBeGreaterThanOrEqual(1);
      expect(result.averages).toContainEqual(['Sessions', String(sessionGames)]);
      const history = (histories[0][1] as { clockwise: number; anticlockwise: number }[])[0];
      expect(history.clockwise).toBe(0);
      expect(history.anticlockwise).toBeGreaterThan(0);
      expect(result.rows).toContainEqual(['Clockwise, anticlockwise', `0, ${history.anticlockwise}`]);
      if ('settings' in settings) {
        const savedSettings = store.get<{ werewolfArt: boolean; moons: boolean; maxMoons?: number }>('settings', { werewolfArt: false, moons: false });
        const report = (results()[0] as { report: DutyReport }).report;
        expect(report.mode).toBe('Gauntlet');
        expect(report.score.label).toBe('Score');
        expect(Number(report.score.value)).toBe(report.cleared[0].items.reduce((sum, item, i) => sum + item.count * (i + 1), 0));
        expect(report.cleared[0].items.map((i) => i.icon)).toEqual(savedSettings.werewolfArt
          ? ['werewolf-chest-small', 'werewolf-chest-medium', 'werewolf-chest-large']
          : ['ci-bone-box', 'ci-fetish-jar', 'ci-cursed-chest']);
        expect(histories[0][0]).toContain('ci:');
        expect(histories[0][0].includes(':werewolf-art')).toBe(!!savedSettings.werewolfArt);
        expect(histories[0][0].includes(':moons')).toBe(!!savedSettings.moons);
        if (savedSettings.moons) {
          expect(histories[0][0].endsWith(':moons:1')).toBe(savedSettings.maxMoons !== 2);
          const tape = await recorder['loadTape'](replay);
          expect(tape!.settings).toMatchObject({ maxMoons: savedSettings.maxMoons ?? 1 });
        }
        expect(Object.keys(data).some((k) => k.endsWith(':normalBestPerMove'))).toBe(false);
        expect(replay).toMatchObject({ settingsVersion: 2, simulatorVersion: 6 });
      }
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
    vi.spyOn(Math, 'random').mockImplementation(((rng) => () => rng.random())(new Random(77)));
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
    const clicks = new Random(5);
    for (let elapsed = 0; elapsed <= 65000 && !results()[0]; elapsed += 17) {
      now += 17;
      if (elapsed % 289 === 0) {
        const index = clicks.integer(0, 53);
        const pos: [number, number] = [67 + (index % 6) * 45 + 10, 50 + Math.floor(index / 6) * 45 + 10];
        input.mouse = pos;
        instance.frame([{ type: 'mousedown', button: clicks.integer(0, 1) ? 1 : 3, pos }]);
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
    vi.spyOn(Math, 'random').mockImplementation(((rng) => () => rng.random())(new Random(3)));
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
    vi.spyOn(Math, 'random').mockImplementation(((rng) => () => rng.random())(new Random(9)));
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
    vi.spyOn(Math, 'random').mockImplementation(((rng) => () => rng.random())(new Random(21)));
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
    const clicks = new Random(2);
    const click = () => {
      const pos: [number, number] = puzzle === 'forage'
        ? [67 + clicks.integer(0, 5) * 45 + 10, 50 + clicks.integer(0, 8) * 45 + 10]
        : [64 + clicks.integer(0, 7) * 45 + 10, 205 + clicks.integer(0, 6) * 45 + 10];
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
    // It plays on straight away from the take-over.
    expect(recorder.isPaused).toBe(false);
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
    vi.spyOn(Math, 'random').mockImplementation(((rng) => () => rng.random())(new Random(5)));
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

describe('Gunning loop drill replay', () => {
  it.each([0,1])('scores guns per active minute on side %i and replays firing, refills, arrows and pauses', async side => {
    const store = new Store('gunning');
    store.set('settings', { mode: 'loop', timerMs: 120000, speed: 150 });
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((values: any) => { values.fill(42); return values; });
    const step = GunningGame.prototype.step;
    let live!: GunningGame;
    vi.spyOn(GunningGame.prototype, 'step').mockImplementation(function (this: GunningGame, delta) { live = this; step.call(this, delta); });
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { panel, buttons, setters, stats, results } = panelHarness();
    let now = 100, paused = false;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./gunning/index')).default;
    const drillInput={mouse:[-1,-1] as [number,number]};
    const instance = await factory({ screen, input: drillInput, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    buttons.get('Play::Start')!(); instance.frame([]);
    for (let elapsed = 50; elapsed <= 120000; elapsed += 50) {
      now = 100 + elapsed + (paused ? 5000 : 0);
      const events:InputEvent[]=[];
      const circuit=LOOP_SIDES[side];
      for (const [i,gun] of circuit.guns.entries()) {
        const row=LOOP.rows[i];
        const c = live.board.cannons[gun], need = [POWDER, WAD, SHOT][c.slots.findIndex(slot => slot === null)];
        const pending = live.board.pieces.some(p => p.nx === circuit.front+(circuit.left?1:-1) && p.ny === row);
        const next = live.board.pieces.find(p => p.nx === circuit.front && p.ny === row);
        const key=!pending&&next?.type===need?(circuit.left?'d':'a'):'s',pos:[number,number]=[17+circuit.front*32+16,107+row*32+16];
        drillInput.mouse=pos;
        events.push({type:'keydown',key},{type:'keyup',key},{type:'mousedown',button:1,pos},{type:'mouseup',button:1,pos});
      }
      instance.frame(events);
      if (elapsed === 30000) {
        buttons.get('Play::Pause')!(); const before = stats();
        now += 5000; instance.frame([]); expect(stats()).toEqual(before);
        buttons.get('Play::Pause')!(); paused = true;
      }
    }
    expect(live.stats.loaded).toBeGreaterThan(20);
    expect(live.stats.wrong).toBe(0);
    expect(live.stats.fired).toBe(live.stats.loaded);
    expect(live.now).toBe(120000);
    const result = results()[0] as { rows: string[][] };
    expect(result.rows).toContainEqual(['Guns / minute', (live.stats.loaded / 2).toFixed(2)]);
    expect(store.history('loop-v4-120000')).toHaveLength(1);
    expect(store.history('loop-v4-120000')[0].score).toBe(live.stats.loaded / 2);
    await replayWrites.idle();
    const data = JSON.parse(exportAll()).data, [tape] = await listReplayFiles('gunning');
    const recorder = captured.recorders[0], perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(tape.at, tape.runId)).toBe(true);
    perf.mockReturnValue(tape.duration); instance.frame([]);
    expect(results()[0]).toEqual(result);
    expect(warnings).not.toHaveBeenCalled();
    setters.get('History:Replays:Jump to (s)')!(120);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    expect(results()[0]).toEqual(result);
    expect(JSON.parse(exportAll()).data).toEqual(data);
    buttons.get('History:Replays:Stop')!(); instance.dispose?.();
  });
});

describe('Gunning Freeplay barrel replay', () => {
  it('records dragging and painting the single barrel and replays its new spawning position', async () => {
    const store=new Store('gunning'); store.set('settings',{mode:'create',cannons:4});
    const {panel,buttons}=panelHarness();
    let now=100,live!:GunningGame;
    const step=GunningGame.prototype.step;
    vi.spyOn(GunningGame.prototype,'step').mockImplementation(function(this:GunningGame,delta){live=this;step.call(this,delta);});
    const input={mouse:[-1,-1] as [number,number]};
    const screen=new Proxy({ctx:canvasContext()},{get:(target,key)=>key==='ctx'?target.ctx:()=>({width:0,height:0})});
    const factory=(await import('./gunning/index')).default;
    const instance=await factory({screen,input,panel,store,ticks:()=>now,
      setReplayTime:(time:number|null)=>{if(time!==null)now=time;}} as unknown as PuzzleContext);
    const cell=(x:number,y:number):[number,number]=>[17+x*32+16,107+y*32+16];
    const frame=(events:InputEvent[]=[])=>{now+=25;instance.frame(events);};
    const paint=(key:string,x:number,y:number)=>{input.mouse=cell(x,y);frame([{type:'keydown',key}]);frame([{type:'keyup',key}]);};
    buttons.get('Play::Start')!();
    paint('3',7,4);
    input.mouse=cell(6,6);frame([{type:'mousedown',button:1,pos:input.mouse}]);
    input.mouse=cell(7,4);frame([{type:'mouseup',button:1,pos:input.mouse}]);
    buttons.get('Play:Deck:Freeze')!();frame();
    expect([live.board.barrel.shown,live.board.barrel.row]).toEqual([7,4]);
    buttons.get('Play:Deck:Freeze')!();frame();
    paint('3',7,5);paint('9',7,5);
    buttons.get('Play:Deck:Freeze')!();frame();
    expect([live.board.barrel.shown,live.board.barrel.row]).toEqual([7,5]);
    for(let i=0;i<100;i++)frame();
    const recorder=captured.recorders[0],fingerprint=recorder.fingerprint!();
    buttons.get('Play::Start')!();
    await replayWrites.idle();const [tape]=await listReplayFiles('gunning');
    expect(Object.keys(JSON.parse(exportAll()).data).filter(key=>key.includes(':history:'))).toEqual([]);
    const perf=vi.spyOn(performance,'now').mockReturnValue(0);
    expect(await recorder.playAt(tape.at,tape.runId)).toBe(true);
    perf.mockReturnValue(tape.duration);instance.frame([]);
    expect(recorder.divergedAt).toBeNull();
    expect(recorder.fingerprint!()).toBe(fingerprint);
    buttons.get('History:Replays:Stop')!();instance.dispose?.();
  });
});

describe('seed controls for every puzzle', () => {
  it.each([
    ['bilging', false], ['bilging', true], ['treasure-haul', false], ['treasure-haul', true],
  ] as const)('%s fixed=%s only counts automatic-seed scores, retaining practice replays', async (puzzle, fixed) => {
    const store = new Store(puzzle);
    if (puzzle === 'bilging') store.set('settings', { timerMs: 1000, difficulty: 0 });
    else store.set('round', 30);
    const { panel, buttons, texts } = panelHarness();
    let now = 0;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./' + puzzle + '/index')).default as PuzzleFactory;
    const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now } as unknown as PuzzleContext);
    if (fixed) texts.get('Settings:Seed:Seed')!('42');
    buttons.get('Play::Start')!();
    for (now = 100; now <= 32000; now += 100) instance.frame([]);
    if (puzzle === 'bilging') buttons.get('Play::Start')!();
    await replayWrites.idle();
    const data = JSON.parse(exportAll()).data;
    const history = Object.entries(data).filter(([key]) => key.includes(':history:'));
    expect(history).toHaveLength(fixed ? 0 : 1);
    if (puzzle === 'treasure-haul') expect(Object.keys(store.get('bestPoints', {}))).toHaveLength(fixed ? 0 : 1);
    expect(await listReplayFiles(puzzle)).toHaveLength(1);
    instance.dispose?.();
  });

  it.each(['alchemistry', 'bilging', 'blacksmithing', 'distilling', 'forage', 'gunning', 'navigation', 'patching', 'rigging', 'rumble', 'sailing', 'shipwrightery', 'swordfight', 'treasure-haul', 'vampire-carp', 'weaving'])('%s repeats a shared seed in a fresh puzzle instance', async puzzle => {
    async function play(seed = '123456789') {
      const store = new Store(puzzle);
      if (puzzle === 'distilling') store.set('mode', 'Seeded');
      if (puzzle === 'vampire-carp') store.set('seeded', true);
      if (puzzle === 'forage') store.set('settings', { mode: 'ci', roundSeconds: 30 });
      const { panel, buttons, texts, toggles } = panelHarness();
      let now = 100;
      const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
      const factory = (await import('./' + puzzle + '/index')).default as PuzzleFactory;
      const instance = await factory({ screen, input: { mouse: [-1, -1] }, panel, store, ticks: () => now } as unknown as PuzzleContext);
      if (puzzle === 'distilling') {
        Object.assign(navigator, { clipboard: { readText: async () => '7' + seed } });
        buttons.get('Settings:Seed:Paste')!();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      } else {
        expect(texts.has('Settings:Seed:Seed')).toBe(true);
        texts.get('Settings:Seed:Seed')!(seed);
      }
      buttons.get('Play::Start')!();
      now = 350; instance.frame([]);
      const recorder = captured.recorders.at(-1)!;
      const fingerprint = recorder.fingerprint?.();
      const tape = recorder.finish('Seed comparison');
      expect(tape).not.toBeNull(); expect(tape!.randomVersion).toBe(1);
      expect(store.scoresEnabled).toBe(false); expect(tape!.practice).toBe(true);
      // Changing the switch alone cannot make the current chosen-seed run count.
      toggles.get('Settings:Seed:Fixed seed')!(false);
      expect(store.scoresEnabled).toBe(false);
      buttons.get('Play::Start')!(); // stop the current game
      buttons.get('Play::Start')!(); // start a fresh automatic seed
      expect(store.scoresEnabled).toBe(true);
      instance.dispose?.();
      return { seed: tape!.seed, fingerprint };
    }
    const first = await play();
    expect(await play()).toEqual(first);
    expect((await play('987654321')).seed).not.toEqual(first.seed);
  });
});

describe('Treasure Haul Create mode', () => {
  it('replays painted pieces and the swaps made on them', async () => {
    const populate = HaulBoard.prototype.populate;
    const boards = vi.spyOn(HaulBoard.prototype, 'populate').mockImplementation(function (this: HaulBoard) {
      populate.call(this);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) this.set(x, y, (x + 2 * y) % 4);
    });
    let now = 100;
    const store = new Store('treasure-haul'); store.set('mode', 'create'); store.set('gemRates', [0, 0]);
    const { panel, buttons } = panelHarness();
    const input = { mouse: [-1, -1] as [number, number] };
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const factory = (await import('./treasure-haul/index')).default;
    const instance = await factory({ screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    buttons.get('Play::Start')!();
    const board = () => boards.mock.contexts.at(-1)! as HaulBoard;
    const run = (ms: number) => { for (const end = now + ms; now < end; now += 25) instance.frame([]); };
    run(2000);
    // Hold 5 over the square at (3, 4) to paint a ruby, then click it to set it off.
    input.mouse = [44 + 3 * 45 + 20, 205 + 3 * 45 + 20];
    instance.frame([{ type: 'keydown', key: '5' }]); now += 25;
    instance.frame([{ type: 'keyup', key: '5' }]); now += 25;
    instance.frame([]); now += 25;
    expect(board().get(3, 4)).toBe(RUBY);
    instance.frame([{ type: 'mousedown', button: 1, pos: input.mouse }]); now += 25;
    run(3000);
    expect(board().cells).not.toContain(RUBY);
    const after = [...board().cells];
    buttons.get('Play::Start')!();
    await replayWrites.idle();
    const [replay] = await listReplayFiles('treasure-haul');
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await captured.recorders[0].playAt(replay.at, replay.runId)).toBe(true);
    perf.mockReturnValue(replay.duration); instance.frame([]);
    expect(board().cells).toEqual(after);
    buttons.get('History:Replays:Stop')!();
    instance.dispose?.();
  });
});

describe('every puzzle takes over a replay', () => {
  // Each puzzle with the settings that give it a game long enough to take over at 10 seconds.
  const presets: Record<string, Record<string, unknown>> = {
    alchemistry: {}, bilging: {}, blacksmithing: {}, distilling: { mode: 'Practice' }, forage: { settings: { mode: 'ci', roundSeconds: 60 } },
    gunning: {}, navigation: {}, patching: {}, rigging: {}, rumble: {}, sailing: {}, shipwrightery: {}, swordfight: {},
    'treasure-haul': { round: 60 }, 'vampire-carp': {}, weaving: {},
  };
  const KEYS = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'space', 'a', 's', 'd', 'w', 'z', 'x', 'q', 'e', '1', '2'];
  it.each(Object.keys(presets))('%s skips with the arrow keys, plays on from the take-over, resumes the replay there, and replays its own game without drifting', async (puzzle) => {
    vi.stubGlobal('HTMLInputElement', class {}); vi.stubGlobal('HTMLSelectElement', class {}); vi.stubGlobal('HTMLTextAreaElement', class {});
    vi.spyOn(Math, 'random').mockImplementation(((rng) => () => rng.random())(new Random(31)));
    const store = new Store(puzzle);
    for (const [key, value] of Object.entries(presets[puzzle])) store.set(key, value);
    const { panel, buttons, setters } = panelHarness();
    let now = 500;
    const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
    const input = { mouse: [-1, -1] as [number, number] };
    const factory = (await import('./' + puzzle + '/index')).default as PuzzleFactory;
    const instance = await factory({ screen, input, panel, store, ticks: () => now,
      setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
    const recorder = captured.recorders[0];
    const recording = () => !!recorder['recording'];
    // Clicks, drags, the wheel and keys, a few times a second, all over the board.
    const moves = new Random(7);
    let heldKey: string | null = null, heldButton = false;
    const play = (until: number) => {
      for (let frame = 0; now < until && (recording() || frame === 0); frame++) {
        now += 17;
        const events: InputEvent[] = [];
        if (frame % 3 === 0) input.mouse = [moves.integer(10, 440), moves.integer(40, 590)];
        if (heldKey && moves.random() < 0.3) { events.push({ type: 'keyup', key: heldKey }); heldKey = null; }
        if (heldButton && moves.random() < 0.4) { events.push({ type: 'mouseup', button: 1, pos: [...input.mouse] }); heldButton = false; }
        const roll = moves.random();
        if (roll < 0.08 && !heldButton) { events.push({ type: 'mousedown', button: 1, pos: [...input.mouse] }); heldButton = true; }
        else if (roll < 0.1) events.push({ type: 'mousedown', button: 3, pos: [...input.mouse] }, { type: 'mouseup', button: 3, pos: [...input.mouse] });
        else if (roll < 0.11) events.push({ type: 'mousedown', button: 5, pos: [...input.mouse] }, { type: 'mouseup', button: 5, pos: [...input.mouse] });
        else if (roll < 0.17 && !heldKey) { heldKey = KEYS[moves.integer(0, KEYS.length - 1)]; events.push({ type: 'keydown', key: heldKey }); }
        instance.frame(events);
      }
    };
    const stopLive = () => { if (recording()) recorder['stopLive']!(); };
    buttons.get('Play::Start')!();
    expect(recording()).toBe(true);
    play(now + 20000);
    stopLive();
    await replayWrites.idle();
    const [theirs] = await listReplayFiles(puzzle);
    expect(theirs.duration).toBeGreaterThan(12000);
    // Watch it to 10 seconds, paused, then take over.
    setters.get('History:Replays:Jump to (s)')!(10);
    buttons.get('History:Replays:Jump')!();
    await vi.waitFor(() => expect(recorder.isPlaying).toBe(true));
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    expect(recorder.divergedAt).toBeNull();
    const atTakeOver = recorder.fingerprint!();
    // Right skips a second on; Left skips back to the same game as before.
    window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'ArrowRight' }));
    instance.frame([]);
    expect(recorder.elapsedMs).toBe(11000);
    expect(recorder.isPaused).toBe(true);
    recorder.seekBy(-1000);
    instance.frame([]);
    await vi.waitFor(() => expect(recorder.isSeeking || recorder.elapsedMs !== 10000).toBe(false));
    expect(recorder.fingerprint!()).toBe(atTakeOver);
    expect(recorder.divergedAt).toBeNull();
    expect(recorder.takeOver()).toBe(true);
    expect(recorder.isPlaying).toBe(false);
    expect(recording()).toBe(true);
    play(now + 3000);
    // Resume replay: back to watching from the take-over, with the game played since dropped.
    buttons.get('History:Replays:Take over')!();
    await vi.waitFor(() => expect(recorder.isPlaying).toBe(true));
    await vi.waitFor(() => expect(recorder.isSeeking).toBe(false));
    expect(recorder.elapsedMs).toBe(10000);
    expect(recorder.fingerprint!()).toBe(atTakeOver);
    expect(recorder.divergedAt).toBeNull();
    await replayWrites.idle();
    expect(await listReplayFiles(puzzle)).toHaveLength(1);
    // Take over again and play on, then end the game.
    expect(recorder.takeOver()).toBe(true);
    play(now + 6000);
    stopLive();
    await replayWrites.idle();
    const mine = (await listReplayFiles(puzzle)).find((entry) => entry.id !== theirs.id)!;
    expect(mine.result).toMatch(/taken over at 10s/);
    const tape = (await recorder['loadTape'](mine))!;
    // The player's own inputs after the take-over are in it, and were checked as they were played.
    expect(tape.frames.some((frame) => frame.t > 10000 && (frame.events.length || frame.commands?.length || frame.actions?.length))).toBe(true);
    expect(tape.checks!.some(([t]) => t > 10000)).toBe(true);
    // The saved game replays from the start, through the take-over, as it was played.
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await recorder.playAt(mine.at, mine.runId)).toBe(true);
    perf.mockReturnValue(mine.duration);
    instance.frame([]);
    expect(recorder.divergedAt).toBeNull();
    buttons.get('History:Replays:Stop')!();
    instance.dispose?.();
  });
});
