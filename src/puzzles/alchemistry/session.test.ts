import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Store } from '../../core/storage';
import { replayWrites, listReplayFiles } from '../../core/replay-storage';
import type { ReplayRecorder } from '../../core/replay';
import type { PuzzleContext } from '../../core/puzzle';
import { AlchemyBoard, Bottle } from './logic';
const captured = vi.hoisted(() => ({ recorders: [] as ReplayRecorder[] }));
vi.mock('../../core/replay', async original => {
  const module = await original<typeof import('../../core/replay')>();
  return { ...module, ReplayRecorder: class extends module.ReplayRecorder {
    constructor(...args: ConstructorParameters<typeof module.ReplayRecorder>) { super(...args); captured.recorders.push(this); }
  } };
});
vi.mock('../../core/assets', () => ({ Images: class { static async load() { return { get: () => ({ width: 450, height: 600 }) }; } } }));
vi.mock('../../core/fonts', () => ({ loadFont: async () => {} }));
vi.mock('../../core/audio', () => ({ SoundBank: class { play() {} dispose() {} } }));
function canvasContext(): CanvasRenderingContext2D {
  return new Proxy({ measureText: (text: string) => ({ width: text.length * 8 }) }, { get: (t, key) => key in t ? t[key as keyof typeof t] : () => {} }) as unknown as CanvasRenderingContext2D;
}
function harness() {
  const buttons = new Map<string, () => void>(), selects = new Map<string, (value: number) => void>();
  const tables: Array<() => string[][]> = [], results: Array<() => unknown> = [];
  const group: any = new Proxy({}, { get: (_, key) => {
    if (key === 'button') return (name: string, fn: () => void, opts: { disabled?: () => boolean; label?: () => string } = {}) => {
      opts.disabled?.(); opts.label?.(); buttons.set(name, fn); return group;
    };
    if (key === 'select') return (name: string, _options: unknown, _get: unknown, set: (value: number) => void) => { selects.set(name, set); return group; };
    if (key === 'stats') return (_header: unknown, get: () => string[][]) => { tables.push(get); return group; };
    return () => group;
  } });
  const panel: any = new Proxy({}, { get: (_, key) => {
    if (key === 'settings' || key === 'seedSettings' || key === 'controlSettings' || key === 'globalSettings') return group;
    if (key === 'results') return (get: () => unknown) => { results.push(get); };
    return () => group;
  } });
  return { panel, buttons, selects, stats: () => tables.flatMap(t => t()), results: () => results.map(r => r()) };
}
beforeEach(async () => {
  await replayWrites.idle(); captured.recorders = [];
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal('navigator', { storage: {} });
  vi.stubGlobal('document', { createElement: () => ({ getContext: canvasContext, style: {}, setAttribute() {}, addEventListener() {}, append() {}, replaceChildren() {} }), createTextNode: (s: string) => s });
});
afterEach(async () => { await replayWrites.idle(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Alchemistry session', () => {
  it('records the chosen difficulty and keeps stopped games separate by difficulty', async () => {
    const h = harness(), store = new Store('alchemistry'); let now = 0;
    const factory = (await import('./index')).default;
    const instance = await factory({ screen: { ctx: canvasContext() }, input: { mouse: [-1, -1] }, panel: h.panel, store, ticks: () => now,
      setReplayTime: (ms: number | null) => { if (ms !== null) now = ms; } } as unknown as PuzzleContext);
    h.selects.get('Difficulty')!(8); h.buttons.get('Start')!();
    now = 1100; instance.frame([{ type: 'keydown', key: 'x' }]);
    now = 1200; instance.frame([]); h.buttons.get('Start')!();
    expect(store.history('difficulty:8')).toHaveLength(1);
    expect(store.history('difficulty:4')).toHaveLength(0);
    expect(store.history('difficulty:8')[0].result).toBe('Stopped');
    expect(h.results()[0]).toMatchObject({ title: 'Stopped' });
    expect(captured.recorders[0].isPlaying).toBe(false);
    instance.dispose?.();
  });
  it('runs fills through their animations, settles, and ends with the game score', async () => {
    // A prepared board routes each bulb straight to a matching single-color bottle.
    const original = AlchemyBoard.prototype.colorBoard;
    let prepared = false;
    vi.spyOn(AlchemyBoard.prototype, 'colorBoard').mockImplementation(function (this: AlchemyBoard) {
      if (prepared && this.finished.length === 0) {
        this.cells.fill(9); this.colors.fill(2); this.baseColors.fill(2);
        this.bottles = Array.from({ length: 11 }, () => { const b = new Bottle(); b.required[0] = 2; return b; });
      }
      return original.call(this);
    });
    const h = harness(), store = new Store('alchemistry'); let now = 0;
    store.set('difficulty', 0);
    const factory = (await import('./index')).default;
    const instance = await factory({ screen: { ctx: canvasContext() }, input: { mouse: [-1, -1] }, panel: h.panel, store, ticks: () => now,
      setReplayTime: (ms: number | null) => { if (ms !== null) now = ms; } } as unknown as PuzzleContext);
    prepared = true; h.buttons.get('Start')!();
    now = 1100; instance.frame([]); h.buttons.get('Fill bottles')!();
    expect(h.stats()).toContainEqual(['Score', expect.any(String)]);
    expect(h.results()[0]).toBeNull();
    for (now = 1200; now <= 30000; now += 50) instance.frame([]);
    expect(store.history('difficulty:0')).toHaveLength(1);
    expect(store.history('difficulty:0')[0]).toMatchObject({ result: 'Finished', fills: 1, bottles: 10, labels: 11 });
    expect(h.results()[0]).toMatchObject({ title: 'Finished' });
    const expected = h.results()[0];
    await replayWrites.idle();
    const [tape] = await listReplayFiles('alchemistry');
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await captured.recorders[0].playAt(tape.at, tape.runId)).toBe(true);
    perf.mockReturnValue(tape.duration); instance.frame([]);
    expect(h.results()[0]).toEqual(expected);
    expect(store.history('difficulty:0')).toHaveLength(1);
    instance.dispose?.();
  });
});
