import { describe, expect, it, vi } from 'vitest';
import { drawImpact, impactTint } from './impact';

describe('incoming punch fists', () => {
  it('pulses yellow three times over solid artwork', () => {
    for (const start of [0, 100, 200]) {
      expect(impactTint(start)).toBe(0);
      expect(impactTint(start + 25)).toBe(0.375);
      expect(impactTint(start + 50)).toBe(0.75);
      expect(impactTint(start + 75)).toBe(0.375);
    }
    expect(impactTint(-1)).toBeNull();
    expect(impactTint(300)).toBeNull();
  });

  it.each([{ side: 1, sx: 0, x: 0 }, { side: 0, sx: 120, x: 144 }])('uses the correct frame on side $side', ({ side, sx, x }) => {
    const artwork = {} as CanvasImageSource, highlight = {} as CanvasImageSource;
    const calls: Array<{ alpha: number; args: unknown[] }> = [];
    const ctx = {
      globalAlpha: 0.2, save: vi.fn(), restore: vi.fn(),
      drawImage(...args: unknown[]) { calls.push({ alpha: this.globalAlpha, args }); },
    };
    drawImpact(ctx as unknown as CanvasRenderingContext2D, artwork, highlight, side, 4, 50);
    expect(calls).toEqual([
      { alpha: 1, args: [artwork, sx, 0, 120, 120, x, 92, 120, 120] },
      { alpha: 0.75, args: [highlight, sx, 0, 120, 120, x, 92, 120, 120] },
    ]);
    expect(ctx.save).toHaveBeenCalledOnce();
    expect(ctx.restore).toHaveBeenCalledOnce();
    calls.length = 0;
    drawImpact(ctx as unknown as CanvasRenderingContext2D, artwork, highlight, side, 4, 300);
    expect(calls).toEqual([]);
  });
});
