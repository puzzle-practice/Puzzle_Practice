import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Store } from '../../core/storage';
import { replayWrites } from '../../core/replay-storage';
import type { PuzzleContext } from '../../core/puzzle';
import type { InputEvent, Point } from '../../core/input';
import { RIGHT, WIDTH } from './board';
import { GunningGame } from './game';
import { CELL, LEFT, boardTop } from './render';

vi.mock('../../core/assets', async (original) => ({
  ...await original<typeof import('../../core/assets')>(),
  Images: class { static async load() { return { get: () => ({ width: 450, height: 600 }), has: () => true }; } },
}));
vi.mock('../../core/fonts', () => ({ loadFont: async () => {} }));
vi.mock('../../core/audio', async (original) => ({
  ...await original<typeof import('../../core/audio')>(),
  SoundBank: class { play() {} loop() { return () => {}; } dispose() {} },
}));

const canvasContext = () => new Proxy({ measureText: (text: string) => ({ width: text.length * 8 }) },
  { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} });
/** A panel that keeps only its buttons. */
function panelHarness() {
  const buttons = new Map<string, () => void>();
  const group = (page: string, title = ''): any => new Proxy({}, { get: (_target, method) => {
    if (method === 'group') return (name: string) => group(page, name);
    if (method === 'button') return (name: string, action: () => void) => { buttons.set(`${page}:${title}:${name}`, action); return group(page, title); };
    return () => group(page, title);
  } });
  const panel = new Proxy({}, { get: (_target, method) => {
    if (method === 'group') return (title = '') => group('Play', title);
    if (method === 'settings' || method === 'seedSettings') return group('Settings');
    if (method === 'controlSettings') return group('Controls');
    if (method === 'tab') return (page: string) => group(page);
    if (method === 'historySection') return () => group('History');
    return () => group('Play');
  } });
  return { panel, buttons };
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal('navigator', { storage: {} });
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal('document', { createTextNode: (text: string) => ({ textContent: text }), createElement: () => ({
    width: 450, height: 600, getContext: canvasContext, style: {}, setAttribute() {}, addEventListener() {}, replaceChildren() {}, append() {},
  }) });
});
afterEach(async () => {
  await replayWrites.idle();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const step = GunningGame.prototype.step;
async function gunning(settings: object) {
  const store = new Store('gunning'); store.set('settings', { cannons: 4, ...settings });
  const { panel, buttons } = panelHarness();
  let now = 100, live!: GunningGame;
  vi.spyOn(GunningGame.prototype, 'step').mockImplementation(function (this: GunningGame, delta) { live = this; step.call(this, delta); });
  const input = { mouse: [-1, -1] as Point };
  const screen = new Proxy({ ctx: canvasContext() }, { get: (target, key) => key === 'ctx' ? target.ctx : () => ({ width: 0, height: 0 }) });
  const instance = await (await import('./index')).default({ screen, input, panel, store, ticks: () => now,
    setReplayTime: (time: number | null) => { if (time !== null) now = time; } } as unknown as PuzzleContext);
  const frame = (events: InputEvent[] = []) => { now += 25; instance.frame(events); };
  const move = (pos: Point) => { input.mouse = pos; frame(); };
  const click = (down: Point, up = down) => {
    input.mouse = down; frame([{ type: 'mousedown', button: 1, pos: down }]);
    input.mouse = up; frame([{ type: 'mouseup', button: 1, pos: up }]);
  };
  buttons.get('Play::Start')!(); frame();
  const top = boardTop(live.board.height);
  /** A row where column x can take an arrow. */
  const openRow = (x: number) => [...Array(live.board.height).keys()].find(y => live.board.canPlaceArrow(x, y))!;
  return { game: () => live, move, click, top, openRow, dispose: () => instance.dispose?.() };
}

describe('Gunning mouse', () => {
  it('points at the nearest cell from off the deck, so a click there still lays an arrow', async () => {
    const g = await gunning({}), row = g.openRow(0), y = g.top + row * CELL + CELL / 2;
    g.move([5, y]);
    expect(g.game().cursor).toEqual({ x: 0, y: row });
    g.click([5, y]);
    expect(g.game().stats.arrows).toBe(1);
    expect(g.game().board.arrowAt(row * WIDTH)).toBe(g.game().nextArrow);
    g.move([440, g.top - 20]);
    expect(g.game().cursor).toEqual({ x: WIDTH - 1, y: 0 });
    // Beyond the puzzle the mouse leaves the cursor where it was.
    g.move([600, y]);
    expect(g.game().cursor).toEqual({ x: WIDTH - 1, y: 0 });
    g.dispose();
  });

  it.each([true, false])('picks the arrow by dragging only with click and drag on (%s)', async clickDrag => {
    const g = await gunning({ clickDrag }), row = g.openRow(6), from: Point = [LEFT + 6 * CELL + CELL / 2, g.top + row * CELL + CELL / 2];
    const selected = g.game().nextArrow;
    g.click(from, [from[0] + 60, from[1]]);
    expect(g.game().stats.arrows).toBe(1);
    expect(g.game().board.arrowAt(row * WIDTH + 6)).toBe(clickDrag ? RIGHT : selected);
    g.dispose();
  });
});
