import { describe, expect, it } from 'vitest';
import { HoldScrub } from './hold-scrub';

describe('held review navigation', () => {
  it('steps once on press and waits half a second before repeating', () => {
    let index = 0;
    const hold = new HoldScrub((by) => { index += by; return true; });
    hold.press(1, 100);
    expect(index).toBe(1);
    hold.tick(599);
    expect(index).toBe(1);
    hold.tick(600);
    expect(index).toBe(2);
    hold.stop();
    hold.tick(2000);
    expect(index).toBe(2);
  });

  it('accelerates in both directions and restarts the delay on a new press', () => {
    for (const direction of [-1, 1] as const) {
      let count = 0;
      const hold = new HoldScrub((by) => { count += by; return true; });
      hold.press(direction, 0);
      const samples: number[] = [];
      for (let time = 10; time <= 4000; time += 10) {
        hold.tick(time);
        if (time % 1000 === 0) samples.push(Math.abs(count));
      }
      expect(samples[3] - samples[2]).toBeGreaterThan(samples[1] - samples[0]);
      expect(samples[1] - samples[0]).toBeGreaterThan(samples[0] - 1);
      hold.press(-direction as -1 | 1, 4000);
      const afterPress = count;
      hold.tick(4499);
      expect(count).toBe(afterPress);
      hold.tick(4500);
      expect(count).toBe(afterPress - direction);
    }
  });

  it('stops at the end and never catches up a backlog after a delayed frame', () => {
    let index = 0, steps = 0;
    const hold = new HoldScrub((by) => {
      steps++;
      const next = Math.max(0, Math.min(3, index + by));
      const moved = next !== index; index = next; return moved;
    });
    hold.press(1, 0);
    hold.tick(10000);
    expect(index).toBe(2);
    hold.tick(10000);
    expect(index).toBe(2);
    hold.tick(10030);
    expect(index).toBe(3);
    hold.tick(10060);
    const stopped = steps;
    hold.tick(20000);
    expect(steps).toBe(stopped);
    expect(index).toBe(3);
  });
});
