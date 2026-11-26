import { describe, expect, it } from 'vitest';
import { RingGesture } from './mobile-controls';

describe('navigation touch gestures', () => {
  it('ignores tap jitter and vertical swipes, then snaps horizontal travel to steps', () => {
    const gesture = new RingGesture('swipe', [100, 100], [0, 0]);
    expect(gesture.move([108, 105])).toBe(0);
    expect(gesture.move([110, 170])).toBe(0);
    expect(gesture.move([132, 110])).toBe(1);
    expect(gesture.move([140, 110])).toBe(0);
    expect(gesture.move([196, 110])).toBe(2);
    expect(gesture.move([164, 110])).toBe(-1);
    expect(gesture.move([164, 110])).toBe(0);
  });

  it('recognises a left swipe from the start', () => {
    const gesture = new RingGesture('swipe', [100, 100], [0, 0]);
    expect(gesture.move([67, 100])).toBe(-1);
  });

  it('turns circular drags in either direction through the angle wrap', () => {
    const point = (degrees: number): [number, number] => [100 * Math.cos(degrees * Math.PI / 180), 100 * Math.sin(degrees * Math.PI / 180)];
    const gesture = new RingGesture('circular', point(170), [0, 0]);
    expect(gesture.move(point(-170))).toBe(0);
    expect(gesture.move(point(-145))).toBe(1);
    expect(gesture.move(point(170))).toBe(-1);
    expect(gesture.move(point(80))).toBe(-2);
  });

  it('ignores circular movement near the centre', () => {
    const gesture = new RingGesture('circular', [100, 0], [0, 0]);
    expect(gesture.move([0, 1])).toBe(0);
    expect(gesture.move([0, 100])).toBe(2);
  });

  it.each([0, 45, 90, 135, 180, 225, 270, 315])('follows the ring clockwise and anticlockwise from %s degrees', start => {
    const point = (degrees: number): [number, number] => [225 + 149 * Math.cos(degrees * Math.PI / 180), 300 + 149 * Math.sin(degrees * Math.PI / 180)];
    for (const direction of [-1, 1]) {
      const gesture = new RingGesture('circular', point(start), [225, 300]);
      let turns = 0;
      for (let angle = 5; angle <= 180; angle += 5) turns += gesture.move(point(start + direction * angle));
      expect(turns).toBe(direction * 4);
    }
  });

  it('snaps close to the pointer without flickering around an octant midpoint', () => {
    const point = (degrees: number): [number, number] => [100 * Math.cos(degrees * Math.PI / 180), 100 * Math.sin(degrees * Math.PI / 180)];
    const gesture = new RingGesture('circular', point(0), [0, 0]);
    expect(gesture.move(point(26))).toBe(1);
    expect(gesture.move(point(23))).toBe(0);
    expect(gesture.move(point(22))).toBe(0);
    expect(gesture.move(point(19))).toBe(-1);
  });
});
