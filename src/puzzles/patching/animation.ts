/** Presentation primitives shared by the Patching scene and frame comparisons. */
export const clamp = (value: number): number => Math.max(0, Math.min(1, value));
export function fadeIn(elapsed: number, delay = 0, duration = 500): number {
  return elapsed <= delay ? 0 : duration === 0 ? 1 : clamp(Math.fround((elapsed - delay) / duration));
}
export function fadeOut(elapsed: number, delay = 0, duration = 750): number {
  return elapsed <= delay ? 1 : duration === 0 ? 0 : clamp(Math.fround(1 - Math.fround((elapsed - delay) / duration)));
}
/** Only decorative gust strips use this size curve; board pieces remain full size. */
export function windScale(value: number): number {
  const f = Math.fround, boundary = f(.9);
  return value < boundary ? f(f(1.1) * f(value / boundary)) : f(f(1.1) - f(value - boundary));
}
export function travel(from: number, to: number, elapsed: number, duration: number): number {
  return from + Math.trunc(Math.fround((to - from) * Math.fround(clamp(elapsed / duration))));
}
export function animationFrame(elapsed: number, fps: number, count: number, loop = false): number {
  if (elapsed < 0) return -1;
  const frame = Math.floor(elapsed / Math.floor(1000 / fps));
  return !loop && frame >= count ? -1 : frame % count;
}
