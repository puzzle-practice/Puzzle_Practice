import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputEvent } from './input';
import type { PuzzleContext } from './puzzle';

const state = vi.hoisted(() => ({ now: 0, virtual: false, runner: null as { run(): void } | null }));
vi.mock('./fonts', () => ({ loadUiFont: async () => {} }));
vi.mock('./audio', () => ({ unlockAudio() {} }));
vi.mock('./panel', () => ({
  isTyping: () => false,
  Panel: class { onUsed = () => {}; sync() {} },
}));
vi.mock('./realtime', () => ({
  realNow: () => state.now,
  isVirtualTime: () => state.virtual,
  setFrameRunner: (runner: { run(): void }) => { state.runner = runner; return () => { state.runner = null; }; },
}));

import { runPuzzle, type RunningPuzzle } from './host';

let browser: EventTarget, doc: EventTarget & { hidden: boolean; focused: boolean; hasFocus(): boolean };
let canvas: HTMLCanvasElement, root: HTMLElement, running: RunningPuzzle | undefined;
let raf: Map<number, FrameRequestCallback>, nextRaf: number;
let frames: { time: number; events: InputEvent[] }[];

beforeEach(() => {
  state.now = 0; state.virtual = false; state.runner = null;
  browser = new EventTarget();
  doc = Object.assign(new EventTarget(), { hidden: false, focused: true, hasFocus() { return this.focused; } });
  canvas = Object.assign(new EventTarget(), {
    width: 450, height: 600, focus() {}, getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 450, height: 600 }),
  }) as unknown as HTMLCanvasElement;
  root = new EventTarget() as unknown as HTMLElement;
  raf = new Map(); nextRaf = 0; frames = [];
  vi.stubGlobal('document', doc); vi.stubGlobal('window', browser);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { raf.set(++nextRaf, callback); return nextRaf; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => raf.delete(id));
});
afterEach(() => { running?.stop(); running = undefined; vi.unstubAllGlobals(); });

async function start() {
  running = await runPuzzle(canvas, root, 'host-test', { title: 'Host test', description: '' },
    (ctx: PuzzleContext) => ({ frame(events) { frames.push({ time: ctx.ticks(), events }); } }));
}
function tick(at: number) {
  state.now = at;
  const callbacks = [...raf.values()]; raf.clear(); callbacks.forEach((callback) => callback(at));
}
function key(name: string, type = 'keydown') {
  browser.dispatchEvent(Object.assign(new Event(type), { key: name }));
}

describe('shared puzzle host activity timing', () => {
  it.each(['hidden', 'blurred'] as const)('does not advance while %s and handles the first returning key on the next step', async (kind) => {
    await start(); tick(20);
    const before = frames.length;
    state.now = 20;
    if (kind === 'hidden') { doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); }
    else { doc.focused = false; browser.dispatchEvent(new Event('blur')); }
    // Browsers can still run throttled animation frames in a background tab/window.
    for (let second = 1; second <= 30; second++) {
      tick(20 + second * 1000);
      if (second === 10) key('ArrowLeft'); // Must not block returning input in the timestamp queue.
    }
    expect(frames).toHaveLength(before);
    if (kind === 'hidden') { doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange')); }
    else { doc.focused = true; browser.dispatchEvent(new Event('focus')); }
    state.now = 30021; key('ArrowRight'); tick(30040);
    expect(frames.at(-1)!.time).toBe(33);
    expect(frames.flatMap((frame) => frame.events)).toContainEqual({ type: 'keydown', key: 'arrowright' });
    expect(frames.flatMap((frame) => frame.events)).not.toContainEqual({ type: 'keydown', key: 'arrowleft' });
  });

  it('excludes overlapping blur and hidden intervals only once, over repeated returns', async () => {
    await start(); tick(20);
    for (let cycle = 0; cycle < 3; cycle++) {
      doc.focused = false; browser.dispatchEvent(new Event('blur'));
      state.now += 5; doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
      tick(state.now + 10000);
      doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
      tick(state.now + 20); // Still blurred: stay paused.
      doc.focused = true; browser.dispatchEvent(new Event('focus'));
      key(String(cycle)); tick(state.now + 20);
    }
    expect(frames.at(-1)!.time).toBe(67);
    expect(frames.flatMap((frame) => frame.events).filter((event) => event.type === 'keydown')).toHaveLength(3);
  });

  it('releases held inputs on return rather than replaying hidden-tab actions', async () => {
    await start(); state.now = 5; key('a'); tick(20);
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    state.now = 5000; key('a', 'keyup'); key('b');
    tick(10000);
    doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
    tick(10020);
    expect(frames.at(-1)!.events).toEqual([{ type: 'keyup', key: 'a' }]);
  });

  it('allows the explicit virtual-clock runner to advance while hidden for video export', async () => {
    await start(); tick(20);
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    state.virtual = true; state.now = 1020;
    state.runner!.run();
    expect(frames.at(-1)!.time).toBe(1017);
    expect(frames).toHaveLength(61);
  });
});
