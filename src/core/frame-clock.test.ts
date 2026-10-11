import { describe, expect, it } from 'vitest';
import { FrameClock } from './frame-clock';

describe('FrameClock', () => {
  it('holds the time at the frame start while the frame runs', () => {
    let real = 100;
    const clock = new FrameClock(() => real);
    const seen: number[] = [];
    clock.frame(() => {
      seen.push(clock.ticks());
      real += 7;
      seen.push(clock.ticks());
    });
    expect(seen).toEqual([100, 100]);
    // Between frames (button presses), the clock is live.
    expect(clock.ticks()).toBe(107);
  });

  it('uses replay time while a replay plays, and carries on from it afterwards', () => {
    let real = 1000;
    const clock = new FrameClock(() => real);
    clock.setReplayTime(50);
    clock.frame(() => { real += 5; expect(clock.ticks()).toBe(50); });
    clock.setReplayTime(null);
    expect(clock.ticks()).toBe(50);
    real += 10;
    expect(clock.ticks()).toBe(60);
  });
});
