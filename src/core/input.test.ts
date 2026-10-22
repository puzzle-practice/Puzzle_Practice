import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input } from './input';
import type { Screen } from './screen';

vi.mock('./audio', () => ({ unlockAudio() {} }));
vi.mock('./panel', () => ({ isTyping: () => false }));
afterEach(() => vi.unstubAllGlobals());

describe('timestamped browser input', () => {
  it('keeps future keys and pointer positions out of earlier catch-up steps', () => {
    const browser = new EventTarget(); vi.stubGlobal('window', browser);
    const canvas = Object.assign(new EventTarget(), { focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 450, height: 600 }) });
    let now = 0;
    const input = new Input({ canvas, width: 450, height: 600 } as unknown as Screen, () => now);
    const send = (type: string, properties: Record<string, unknown>) => browser.dispatchEvent(Object.assign(new Event(type), properties));
    now = 20; send('mousemove', { clientX: 100, clientY: 200 });
    now = 25; send('keydown', { key: 'ArrowLeft' });
    now = 40; send('mousemove', { clientX: 300, clientY: 400 });
    now = 45; send('keyup', { key: 'ArrowLeft' });
    expect(input.drain(17)).toEqual([]); expect(input.mouse).toEqual([-1, -1]);
    expect(input.drain(33)).toEqual([{ type: 'keydown', key: 'arrowleft' }]); expect(input.mouse).toEqual([100, 200]);
    expect(input.drain(50)).toEqual([{ type: 'keyup', key: 'arrowleft' }]); expect(input.mouse).toEqual([300, 400]);
    input.dispose();
    now = 60; send('keydown', { key: 'ArrowRight' }); expect(input.drain()).toEqual([]);
  });
});

describe('page scrolling', () => {
  it('blocks scroll keys while playing, including held-key repeats, without queueing repeats', () => {
    const browser = new EventTarget(); vi.stubGlobal('window', browser);
    const canvas = Object.assign(new EventTarget(), { focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 450, height: 600 }) });
    const input = new Input({ canvas, width: 450, height: 600 } as unknown as Screen, () => 0);
    const press = (key: string, repeat = false) => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key, repeat });
      browser.dispatchEvent(event);
      return event.defaultPrevented;
    };
    for (const key of [' ', 'ArrowDown', 'PageDown', 'PageUp', 'Home', 'End']) expect(press(key)).toBe(true);
    expect(press(' ', true)).toBe(true);
    expect(press('a')).toBe(false);
    expect(input.drain().filter((event) => event.type === 'keydown')).toHaveLength(7);
    input.dispose();
  });
});
