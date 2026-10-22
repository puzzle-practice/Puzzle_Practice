import { STEP_Y, VIEW_W } from './board';

export const IMPACT_MS = 300;
const TILE = 120;

/** Three yellow pulses: 50ms up to 75% tint, then 50ms back to the original artwork. */
export function impactTint(elapsed: number): number | null {
  if (elapsed < 0 || elapsed >= IMPACT_MS) return null;
  const phase = elapsed % 100;
  return 0.75 * (phase <= 50 ? phase / 50 : (100 - phase) / 50);
}

/** Preserve the sprite's alpha mask while making a solid yellow highlight. */
export function impactHighlight(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#ffff00';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

export function drawImpact(ctx: CanvasRenderingContext2D, artwork: CanvasImageSource, highlight: CanvasImageSource,
  side: number, row: number, elapsed: number): void {
  const tint = impactTint(elapsed);
  if (tint === null) return;
  const right = side === 0;
  const sx = right ? TILE : 0, x = right ? VIEW_W - TILE : 0, y = row * STEP_Y;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.drawImage(artwork, sx, 0, TILE, TILE, x, y, TILE, TILE);
  if (tint > 0) {
    ctx.globalAlpha = tint;
    ctx.drawImage(highlight, sx, 0, TILE, TILE, x, y, TILE, TILE);
  }
  ctx.restore();
}
