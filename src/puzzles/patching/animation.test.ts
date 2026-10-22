import { expect, it } from 'vitest';
import samples from './animation-parity.json';
import { fadeIn, fadeOut, travel, windScale } from './animation';

// Samples are measured from the game's animation helpers, including actual opacity and size.
for (const scenario of samples) it(`matches measured ${scenario.mode} frames`, () => {
  for (const frame of scenario.samples) {
    const opacity = scenario.mode === 'connection' ? fadeIn(frame.ms) : scenario.mode === 'swap' ? fadeOut(frame.ms) :
      scenario.mode === 'incoming' ? fadeIn(frame.ms, 265, 400) : scenario.mode === 'outgoing' ? fadeOut(frame.ms, 25, 400) : fadeIn(frame.ms, 0, 700);
    expect(opacity).toBeCloseTo(frame.alpha, 6);
    expect(scenario.mode === 'wind' ? windScale(Math.fround(.6)) : 1).toBeCloseTo(frame.scale, 6);
    expect(scenario.mode === 'wind' ? travel(760, -184, frame.ms, 1000) : 40).toBe(frame.x);
  }
});
