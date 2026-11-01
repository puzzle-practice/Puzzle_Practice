// Watches what a 2D canvas is asked to draw, so a video export can tell that a frame came out the same
// as the one before without reading its pixels back (which stalls the graphics card every frame).
// Each frame's drawing calls, their arguments and the context state they set are folded into a hash:
// the same calls with the same arguments on the same images paint the same pixels. Anything whose
// look the calls don't pin down (drawing another canvas, a video frame or raw pixel data) marks the
// frame as changed, so the check can only ever keep a frame it could have skipped, never drop one.

const METHODS = [
  'arc', 'arcTo', 'beginPath', 'bezierCurveTo', 'clearRect', 'clip', 'closePath', 'drawImage', 'ellipse', 'fill',
  'fillRect', 'fillText', 'lineTo', 'moveTo', 'putImageData', 'quadraticCurveTo', 'rect', 'reset', 'resetTransform',
  'restore', 'rotate', 'roundRect', 'save', 'scale', 'setLineDash', 'setTransform', 'stroke', 'strokeRect',
  'strokeText', 'transform', 'translate',
] as const;
const PROPERTIES = [
  'direction', 'fillStyle', 'filter', 'font', 'fontKerning', 'globalAlpha', 'globalCompositeOperation',
  'imageSmoothingEnabled', 'imageSmoothingQuality', 'letterSpacing', 'lineCap', 'lineDashOffset', 'lineJoin',
  'lineWidth', 'miterLimit', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'strokeStyle',
  'textAlign', 'textBaseline', 'wordSpacing',
] as const;

export interface DrawFingerprint {
  /** True if what was drawn since the last call could differ from the frame before; starts a new frame. */
  changed(): boolean;
  /** Puts the context back as it was. */
  dispose(): void;
}

/** `value instanceof globalThis[name]`, false where the browser has no such class. */
function is<K extends 'HTMLImageElement' | 'CanvasGradient' | 'CanvasPattern' | 'Path2D' | 'DOMMatrix'>(value: object, name: K): value is InstanceType<(typeof globalThis)[K]> {
  const type = (globalThis as Record<string, unknown>)[name];
  return typeof type === 'function' && value instanceof type;
}

export function watchDrawing(ctx: CanvasRenderingContext2D): DrawFingerprint {
  const ids = new WeakMap<object, number>();
  let nextId = 1;
  const idOf = (value: object) => { let id = ids.get(value); if (!id) ids.set(value, id = nextId++); return id; };
  let hash = 0x811c9dc5, dirty = false, previous: number | null = null;
  const mix = (text: string) => {
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
    hash = Math.imul(hash ^ 0x2c, 0x01000193);
  };
  const describe = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return String(value);
    if (is(value, 'HTMLImageElement')) return `img${idOf(value)}:${value.complete ? value.naturalWidth : 'loading'}`;
    if (Array.isArray(value)) return `[${value.map(describe).join(',')}]`;
    // Gradients, patterns and paths are kept and reused, or made afresh (a new id) when they change.
    if (is(value, 'CanvasGradient') || is(value, 'CanvasPattern') || is(value, 'Path2D')) return `o${idOf(value)}`;
    if (is(value, 'DOMMatrix')) return value.toString();
    // Another canvas, a bitmap, a video frame, pixel data: their content isn't in the call.
    dirty = true;
    return 'x';
  };

  const own = ctx as unknown as Record<string, unknown>;
  const proto = Object.getPrototypeOf(ctx) as Record<string, unknown>;
  for (const name of METHODS) {
    const original = proto[name];
    if (typeof original !== 'function') continue;
    own[name] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      mix(name);
      for (const arg of args) mix(describe(arg));
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
  }
  for (const name of PROPERTIES) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ctx), name);
    if (!descriptor?.set || !descriptor.get) continue;
    Object.defineProperty(ctx, name, {
      configurable: true,
      get() { return descriptor.get!.call(this); },
      set(value: unknown) { mix(name); mix(describe(value)); descriptor.set!.call(this, value); },
    });
  }

  // A frame's drawing also depends on the state the frame before left the context in.
  const start = () => {
    hash = 0x811c9dc5; dirty = false;
    for (const name of PROPERTIES) mix(describe(own[name]));
    mix(ctx.getTransform().toString());
  };
  start();

  return {
    changed() {
      const same = !dirty && previous === hash;
      previous = dirty ? null : hash;
      start();
      return !same;
    },
    dispose() {
      for (const name of METHODS) delete own[name];
      for (const name of PROPERTIES) delete own[name];
    },
  };
}
