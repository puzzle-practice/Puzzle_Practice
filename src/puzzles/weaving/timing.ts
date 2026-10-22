export const CELL = 34;
export const LEFT = 55;
export const SHUTTLE_Y = 178;
export const TOP = 235;
export const REED_OFFSET = -54;
export const CLOSE_MS = 90;
export const ROW_MS = 55;
export const COLLAPSE_MS = 100;
export const FLY_MS = 400;
export const PARTICLE_MS = 200;
export const CLEAR_MS = COLLAPSE_MS + FLY_MS + 200;
export const RETURN_MS = 500;
export const FADE_MS = 250;
export const SHUTTLE_SPEED = 0.7181818;
export const KEY_MS = 75;
export const REPEAT_DELAY_MS = 500;
export const REPEAT_MS = 200;
export const yForRow = (row: number): number => row === 0 ? SHUTTLE_Y : TOP + (row - 1) * CELL;
export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
export function mousePosition(mouseX: number, width: number, maxOffset: number): { offset: number; x: number } {
  const x = Math.max(LEFT, Math.min(LEFT + maxOffset * CELL, mouseX - width * CELL / 2));
  const offset = Math.round((x - LEFT) / CELL);
  const snap = LEFT + offset * CELL;
  const weight = Math.sqrt(1 - Math.min(1, Math.abs(snap - x) * 2 / CELL));
  return { offset, x: Math.round((1 - weight) * x + weight * snap) };
}
