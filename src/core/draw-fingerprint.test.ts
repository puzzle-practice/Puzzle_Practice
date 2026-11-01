import { describe, expect, it } from 'vitest';
import { watchDrawing } from './draw-fingerprint';

/** Just enough of a 2D context: a few drawing calls and one state property, on the prototype as in browsers. */
class FakeContext {
  calls: string[] = [];
  private fill = '#000';
  fillRect(...args: number[]): void { this.calls.push('fillRect ' + args.join()); }
  drawImage(source: unknown): void { this.calls.push('drawImage ' + typeof source); }
  getTransform() { return { toString: () => 'identity' }; }
  get fillStyle(): string { return this.fill; }
  set fillStyle(value: string) { this.fill = value; }
}
const make = () => {
  const ctx = new FakeContext();
  return { ctx, watch: watchDrawing(ctx as unknown as CanvasRenderingContext2D) };
};

describe('watchDrawing', () => {
  it('tells a frame drawn the same as the one before from a changed one', () => {
    const { ctx, watch } = make();
    const frame = (x: number) => { ctx.fillStyle = 'red'; ctx.fillRect(x, 0, 10, 10); };
    frame(0); watch.changed();
    // The second frame starts red where the first started black, so only the third matches the one before.
    frame(0); watch.changed();
    frame(0); expect(watch.changed()).toBe(false);
    frame(1); expect(watch.changed()).toBe(true);
    frame(1); expect(watch.changed()).toBe(false);
    // Drawing still goes through to the real context.
    expect(ctx.calls).toHaveLength(5);
  });

  it('counts the state a frame starts from', () => {
    const { ctx, watch } = make();
    ctx.fillRect(0, 0, 1, 1); watch.changed();
    ctx.fillRect(0, 0, 1, 1); ctx.fillStyle = 'blue'; watch.changed();
    // Same calls as the frame before, but it starts blue where that frame started black.
    ctx.fillRect(0, 0, 1, 1); ctx.fillStyle = 'blue';
    expect(watch.changed()).toBe(true);
  });

  it('treats drawing something whose content it cannot see as a change', () => {
    const { ctx, watch } = make();
    const other = {};
    ctx.drawImage(other); watch.changed();
    ctx.drawImage(other); expect(watch.changed()).toBe(true);
  });

  it('puts the context back when done', () => {
    const { ctx, watch } = make();
    watch.dispose();
    expect(Object.hasOwn(ctx, 'fillRect')).toBe(false);
    expect(Object.hasOwn(ctx, 'fillStyle')).toBe(false);
    ctx.fillStyle = 'green';
    expect(ctx.fillStyle).toBe('green');
  });
});
