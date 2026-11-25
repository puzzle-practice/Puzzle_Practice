import { describe, expect, it } from 'vitest';
import { GameTime } from './game-time';
import { Simulation } from './simulation';

describe('GameTime', () => {
  const setup = (hidden = false) => {
    let real = 1000, virtual = false;
    const sim = new Simulation();
    const time = new GameTime(() => real, () => sim.time, hidden, () => !virtual);
    const steps: number[] = [];
    const frame = () => sim.advance(time.elapsed(), t => steps.push(t));
    return { time, sim, steps, frame, wait: (ms: number) => { real += ms; }, setVirtual: (on: boolean) => { virtual = on; } };
  };

  it('leaves hidden time out, so return does not fast-forward', () => {
    const { time, sim, steps, frame, wait } = setup();
    wait(1000); frame();
    time.hide(); wait(60_000); time.show();
    steps.length = 0;
    wait(20); frame();
    expect(steps).toHaveLength(1);
    expect(sim.time).toBeLessThan(1100);
  });

  it('does not let frames that run while hidden move the game on, so input goes through on return', () => {
    const { time, sim, steps, frame, wait } = setup();
    wait(1000); frame();
    time.hide();
    for (let i = 0; i < 60; i++) { wait(1000); frame(); }
    expect(sim.time).toBeLessThanOrEqual(1000);
    time.show();
    steps.length = 0;
    wait(20); frame();
    expect(steps).toHaveLength(1);
  });

  it('carries on from a video export that ran while hidden instead of waiting for it', () => {
    const { time, sim, steps, frame, wait, setVirtual } = setup();
    wait(1000); frame();
    time.hide();
    setVirtual(true);
    for (let i = 0; i < 30; i++) { wait(1000); frame(); }
    setVirtual(false);
    const exported = sim.time;
    expect(exported).toBeGreaterThan(20_000);
    wait(5000); frame();
    expect(sim.time).toBe(exported);
    time.show();
    steps.length = 0;
    wait(20); frame();
    expect(steps).toHaveLength(1);
  });

  it('stays stopped from a reset while the tab starts hidden', () => {
    const { time, sim, frame, wait } = setup(true);
    wait(500); time.reset(); wait(10_000); frame();
    expect(sim.time).toBe(0);
    time.show(); wait(1000); frame();
    expect(sim.time).toBe(1000);
  });

  it('leaves out a stall that came without the tab hiding, so return does not race through it', () => {
    const { time, sim, steps, frame, wait } = setup();
    wait(1000); frame();
    wait(10 * 60_000); // frames stopped, e.g. a covered Firefox window or a sleeping computer
    expect(time.dropStall()).toBeGreaterThan(0);
    steps.length = 0; frame();
    expect(steps).toHaveLength(1);
    wait(20); frame();
    expect(steps.length).toBeLessThanOrEqual(3);
    expect(sim.time).toBeLessThan(1100);
  });

  it('still catches up on a short hitch', () => {
    const { time, sim, frame, wait } = setup();
    wait(1000); frame();
    wait(500);
    expect(time.dropStall()).toBe(0);
    frame();
    expect(sim.time).toBe(1500);
  });

  it('does not drop time on return from a hidden tab, so the game moves on at once', () => {
    const { time, sim, steps, frame, wait } = setup();
    wait(1000); frame();
    time.hide(); wait(60_000); time.show();
    wait(20);
    expect(time.dropStall()).toBe(0);
    steps.length = 0; frame();
    expect(steps).toHaveLength(1);
    expect(sim.time).toBeGreaterThan(1000);
  });

  it('never cuts a video export short', () => {
    const { time, frame, wait, setVirtual } = setup();
    wait(1000); frame();
    setVirtual(true); wait(30_000);
    expect(time.dropStall()).toBe(0);
  });
});
