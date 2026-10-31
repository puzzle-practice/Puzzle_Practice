import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceVirtualTime, endVirtualTime, frameRunner, isVirtualTime, realNow, setFrameRunner, startVirtualTime } from './realtime';

describe('realtime clock', () => {
  afterEach(() => { endVirtualTime(); vi.restoreAllMocks(); });

  it('holds still on a virtual clock until advanced, then carries on from there', () => {
    let real = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => real);
    const before = realNow();
    startVirtualTime();
    expect(isVirtualTime()).toBe(true);
    real += 500;
    expect(realNow()).toBe(before);
    advanceVirtualTime(5000);
    expect(realNow()).toBe(before + 5000);
    endVirtualTime();
    expect(isVirtualTime()).toBe(false);
    // Rendering ran ahead of the wall clock: time goes on from the virtual time, never backwards.
    expect(realNow()).toBe(before + 5000);
    real += 100;
    expect(realNow()).toBe(before + 5100);
  });

  it('only the runner that registered can unregister itself', () => {
    const canvas = {} as HTMLCanvasElement;
    const first = { canvas, run: () => {} }, second = { canvas, run: () => {} };
    const dropFirst = setFrameRunner(first);
    setFrameRunner(second);
    dropFirst();
    expect(frameRunner()).toBe(second);
  });
});
