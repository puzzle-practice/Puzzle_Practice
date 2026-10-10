// A thin wrapper around a canvas that behaves like a pygame display surface:
// fixed logical size, images blitted at their top-left, text drawn from its top-left.

export type Drawable = HTMLImageElement | HTMLCanvasElement;

/** A font as pygame would render it: a CSS family, a pixel size, and the ascent pygame reports. */
export interface FontSpec {
  family: string;
  px: number;
  ascent: number;
}

export interface BlitOptions {
  /** Source rectangle [x, y, w, h], like pygame's `area` argument. */
  area?: readonly number[];
  /** 0–255, like Surface.set_alpha. */
  alpha?: number;
  /** Mirror horizontally (pygame.transform.flip(img, True, False)). */
  flipX?: boolean;
  /** Counter-clockwise degrees in steps of 90 (pygame.transform.rotate). */
  rotate?: number;
}

export class Screen {
  readonly ctx: CanvasRenderingContext2D;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly width: number,
    readonly height: number,
  ) {
    canvas.width = width;
    canvas.height = height;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  fill(colour: string): void {
    this.ctx.fillStyle = colour;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  rect(x: number, y: number, w: number, h: number, colour: string): void {
    this.ctx.fillStyle = colour;
    this.ctx.fillRect(Math.trunc(x), Math.trunc(y), w, h);
  }

  /** pygame truncates float blit positions to whole pixels; so does this. */
  blit(img: Drawable, x: number, y: number, options: BlitOptions = {}): void {
    const ctx = this.ctx;
    x = Math.trunc(x);
    y = Math.trunc(y);
    const { area, alpha, flipX, rotate = 0 } = options;
    if (alpha !== undefined && alpha <= 0) return;
    const quarterTurns = (((Math.round(rotate / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
    if (!area && !flipX && quarterTurns === 0 && alpha === undefined) {
      ctx.drawImage(img, x, y);
      return;
    }
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha = Math.min(255, alpha) / 255;
    if (area) {
      const [ax, ay, aw, ah] = area.map(Math.trunc);
      if (aw > 0 && ah > 0) ctx.drawImage(img, ax, ay, aw, ah, x, y, aw, ah);
      ctx.restore();
      return;
    }
    const w = img.width;
    const h = img.height;
    // A rotated image keeps its top-left at (x, y), with its bounding box swapped for 90/270.
    const outW = quarterTurns % 2 ? h : w;
    const outH = quarterTurns % 2 ? w : h;
    ctx.translate(x + outW / 2, y + outH / 2);
    ctx.rotate((-quarterTurns * Math.PI) / 2);
    if (flipX) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h / 2);
    ctx.restore();
  }

  /** Draws text with its top-left at (x, y), the way pygame's font.render + blit places it. */
  text(value: string, x: number, y: number, font: FontSpec, colour = '#ffffff', alpha?: number): void {
    const ctx = this.ctx;
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha = Math.max(0, Math.min(255, alpha)) / 255;
    ctx.font = `${font.px}px "${font.family}"`;
    ctx.fillStyle = colour;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, Math.trunc(x), Math.trunc(y) + font.ascent);
    ctx.restore();
  }

  textWidth(value: string, font: FontSpec): number {
    this.ctx.font = `${font.px}px "${font.family}"`;
    return this.ctx.measureText(value).width;
  }
}

/** Converts a viewport mouse position into the screen's logical pixels. */
export function toScreen(screen: Screen, viewportX: number, viewportY: number): [number, number] {
  const rect = screen.canvas.getBoundingClientRect();
  return [
    Math.floor(((viewportX - rect.left) * screen.width) / rect.width),
    Math.floor(((viewportY - rect.top) * screen.height) / rect.height),
  ];
}
