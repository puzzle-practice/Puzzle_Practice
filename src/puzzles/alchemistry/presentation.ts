import type { Images } from '../../core/assets';
import { Bottle, colorOf, inlets, specialOf, valid, type Cell, type PathNode } from './logic';

export const ROTATE_MS = 60, DRAIN_STEP_MS = 60, SQUIRT_MS = 450, FADE_MS = 250;
export const BELT_MS = 1000, BOTTLE_FLIGHT_MS = 500, TEXT_MS = 1500;
export const position = (x: number, y: number): Cell => [17 + 37 * x, 63 + 43 * y + (x % 2 === 0 ? 21 : 0)];
export function cellAt([px, py]: Cell): Cell | null {
  const x = Math.floor((px - 17) / 37), y = Math.floor((py - 63 - (x % 2 === 0 ? 21 : 0)) / 43);
  return valid(x, y) ? [x, y] : null;
}
export const bottleX = (column: number): number => 22 + 37 * column;
export const slotPosition = (slot: number): Cell => [114 + slot * 18, 569];
const SHAPES: Record<number, [string, number]> = {
  3: ['extreme_bend', 0], 5: ['bend', 2], 6: ['extreme_bend', 1], 9: ['bar', 0], 10: ['bend', 3],
  11: ['crook_top', 0], 12: ['extreme_bend', 2], 13: ['crook_bottom', 0], 15: ['all_right', 0],
  17: ['bend', 0], 18: ['bar', 1], 19: ['crook_bottom', 4], 20: ['bend', 4], 21: ['symmetric', 0],
  22: ['crook_top', 1], 23: ['peace', 4], 24: ['extreme_bend', 3], 25: ['crook_top', 3],
  26: ['crook_bottom', 1], 27: ['cross', 0], 29: ['peace', 0], 30: ['all_right', 1], 31: ['all_but_one', 0],
  33: ['extreme_bend', 5], 34: ['bend', 1], 36: ['bar', 2], 37: ['crook_top', 5], 38: ['crook_bottom', 5],
  39: ['all_right', 5], 40: ['bend', 5], 41: ['crook_bottom', 3], 42: ['symmetric', 1],
  43: ['peace', 3], 44: ['crook_top', 2], 45: ['cross', 2], 46: ['peace', 5], 47: ['all_but_one', 5],
  48: ['extreme_bend', 4], 50: ['crook_top', 4], 51: ['all_right', 4], 52: ['crook_bottom', 2],
  53: ['peace', 2], 54: ['cross', 1], 55: ['all_but_one', 4], 57: ['all_right', 3], 58: ['peace', 1],
  59: ['all_but_one', 3], 60: ['all_right', 2], 61: ['all_but_one', 2], 62: ['all_but_one', 1], 63: ['all', 0],
};
export interface Drain { node: PathNode; start: number }
export class Art {
  private cache = new Map<number, HTMLCanvasElement>();
  private drainCache = new Map<string, HTMLCanvasElement>();
  constructor(readonly images: Images, readonly ctx: CanvasRenderingContext2D) {}
  draw(name: string, x: number, y: number, frame = 0, width?: number, height?: number, color?: number): void {
    const image = this.images.get(name), w = width ?? image.width, h = height ?? (color === undefined ? image.height : image.height / 10);
    this.ctx.drawImage(image, frame * w, (color ?? 0) * h, w, h, Math.round(x), Math.round(y), w, h);
  }
  private tube(ctx: CanvasRenderingContext2D, piece: number, tube: number, color = colorOf(piece, tube)): void {
    const shape = SHAPES[inlets(piece, tube)];
    if (!shape) return;
    ctx.drawImage(this.images.get(shape[0]), shape[1] * 46, color * 43, 46, 43, 0, 0, 46, 43);
  }
  private drainFrame(piece: number, tube: number, node: PathNode, frame: number): HTMLCanvasElement {
    const key = `${piece}:${tube}:${node.incoming.map(Number).join('')}:${frame}`;
    const cached = this.drainCache.get(key);
    if (cached) return cached;
    const canvas = document.createElement('canvas'); canvas.width = 46; canvas.height = 43;
    const c = canvas.getContext('2d')!;
    if (frame === 0) this.tube(c, piece, tube);
    else {
      this.tube(c, piece, tube, 0);
      if (frame !== 3) {
        const liquid = document.createElement('canvas'); liquid.width = 46; liquid.height = 43;
        const l = liquid.getContext('2d')!; this.tube(l, piece, tube);
        // Liquid retreats from the connected inlets, followed by the central blob.
        const mask = document.createElement('canvas'); mask.width = 46; mask.height = 43;
        const m = mask.getContext('2d')!;
        if (frame === 2) m.drawImage(this.images.get('blob'), 0, 0);
        for (let direction = 0; direction < 6; direction++) if (node.incoming[direction]) {
          m.drawImage(this.images.get('nubs'), direction * 46, 0, 46, 43, 0, 0, 46, 43);
        }
        l.globalCompositeOperation = 'destination-out'; l.drawImage(mask, 0, 0);
        c.drawImage(liquid, 0, 0);
      }
    }
    this.drainCache.set(key, canvas);
    return canvas;
  }
  piece(piece: number, x: number, y: number, angle = 0, drains: Drain[] = [], now = 0, quicksilver = 0): void {
    const ctx = this.ctx;
    let canvas = this.cache.get(piece);
    if (!canvas) {
      canvas = document.createElement('canvas'); canvas.width = 46; canvas.height = 43;
      const c = canvas.getContext('2d')!;
      this.tube(c, piece, 1); this.tube(c, piece, 0);
      this.cache.set(piece, canvas);
    }
    if (drains.length) {
      const copy = document.createElement('canvas'); copy.width = 46; copy.height = 43;
      const c = copy.getContext('2d')!;
      for (const tube of [1, 0]) {
        const drain = drains.find(d => d.node.tube === tube && now >= d.start);
        if (!drain) { this.tube(c, piece, tube); continue; }
        const t = Math.min(3, (now - drain.start) / 20), frame = Math.floor(t), blend = t - frame;
        c.globalAlpha = 1 - blend; c.drawImage(this.drainFrame(piece, tube, drain.node, frame), 0, 0);
        if (blend) { c.globalAlpha = blend; c.drawImage(this.drainFrame(piece, tube, drain.node, frame + 1), 0, 0); }
        c.globalAlpha = 1;
      }
      canvas = copy;
    }
    ctx.save(); ctx.translate(Math.round(x) + 23, Math.round(y) + 21.5);
    if (angle) { ctx.imageSmoothingEnabled = true; ctx.rotate(angle); }
    ctx.drawImage(canvas, -23, -21.5); ctx.restore();
    if (quicksilver > 0) {
      const white = document.createElement('canvas'); white.width = 46; white.height = 43;
      const c = white.getContext('2d')!;
      for (const tube of [1, 0]) if (colorOf(piece, tube) === 9) this.tube(c, piece, tube);
      c.globalCompositeOperation = 'source-in'; c.fillStyle = '#fff'; c.fillRect(0, 0, 46, 43);
      ctx.save(); ctx.globalAlpha = .65 * quicksilver; ctx.drawImage(white, Math.round(x), Math.round(y)); ctx.restore();
    }
    const special = specialOf(piece);
    if (special) this.draw('special_pieces', x, y, special - 1, 46, 43);
  }
  clear(): void { this.cache.clear(); this.drainCache.clear(); }
  bottle(bottle: Bottle, x: number, y = 480, scale = 1): void {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.scale(scale, scale);
    if (bottle.broken) this.draw('bottle_broken', 0, 0);
    else {
      const size = bottle.size;
      this.draw('bottles_empty', 0, 0, size - 1, 36, 75);
      const unfilled = !bottle.full;
      const fillHeight = unfilled ? 9 * size - 3 : 75;
      const color = bottle.next > 0 ? bottle.next : bottle.top;
      ctx.drawImage(this.images.get('bottles_full'), (size - 1) * 36, color * 75 + 75 - fillHeight,
        36, fillHeight, 0, 75 - fillHeight, 36, fillHeight);
      this.draw('bottles_shine', 0, 0, size - 1, 36, 75);
      const name = ['label_single', 'label_double', 'label_triple', 'label_quadruple'][size - 1];
      for (let i = 0; i < size; i++) if (bottle.filled[i] === -1) this.draw(name, 0, 75 - 7 * (i + 1) - 8,
        bottle.required[i] - 2, 36, 9, bottle.required[i]);
    }
    ctx.restore();
  }
  bottleImage(bottle: Bottle): HTMLCanvasElement {
    const canvas = document.createElement('canvas'); canvas.width = 36; canvas.height = 75;
    new Art(this.images, canvas.getContext('2d')!).bottle(bottle, 0, 0);
    return canvas;
  }
  small(bottle: Bottle | null, slot: number): void {
    const [x, y] = slotPosition(slot);
    this.draw('bottles_small', x, y, bottle ? bottle.size - 1 : 4, 18, 24, bottle?.top ?? 0);
    if (bottle && bottle.value > 12) this.draw('bottles_small_sparkles', x, y, bottle.value < 18 ? 0 : bottle.value < 24 ? 1 : 2, 18, 24);
  }
  bulbs(colors: number[]): void {
    let x = 16;
    for (let column = 0; column < 11; column++) {
      const color = colors[column];
      if (column % 2 === 0) {
        this.draw('bulb', x, 28, 0, 48, 52, color);
        this.draw('bulb_markers', x, 28, color === 9 ? 3 : color - 2, 48, 52, color);
        x += 48;
      } else {
        const name = colors[column - 1] !== color ? 'bulb_tube_left' : colors[column + 1] !== color ? 'bulb_tube_right' : 'bulb_tube_middle';
        this.draw(name, x - 2, 42, 0, 30, 17, color); x += 26;
      }
    }
  }
}
