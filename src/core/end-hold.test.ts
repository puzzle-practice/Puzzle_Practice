import { describe, expect, it } from 'vitest';
import { EndHold, END_HOLD_MS } from './end-hold';

describe('end hold', () => {
  it('holds the board for half a second after a timed end', () => {
    let now = 1000;
    const hold = new EndHold(() => now);
    expect(hold.holding).toBe(false);
    hold.start();
    expect(hold.holding).toBe(true);
    now += END_HOLD_MS - 1;
    expect(hold.holding).toBe(true);
    now += 1;
    expect(hold.holding).toBe(false);
  });

  it('lets go when cleared or when the clock is rewound before the end', () => {
    let now = 1000;
    const hold = new EndHold(() => now);
    hold.start();
    hold.clear();
    expect(hold.holding).toBe(false);
    hold.start();
    now = 500;
    expect(hold.holding).toBe(false);
  });
});
