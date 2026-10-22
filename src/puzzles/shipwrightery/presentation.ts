export interface LabelRect { x: number; y: number; width: number; height: number }
const intersects = (a: LabelRect, b: LabelRect) => a.x < b.x + b.width && b.x < a.x + a.width &&
  a.y < b.y + b.height && b.y < a.y + a.height;

/** Find the nearest position by trying each edge of the labels that obstruct the requested position. */
export function positionLabel(rect: LabelRect, obstacles: readonly LabelRect[], width = 450, height = 600): LabelRect {
  const choices = [{ ...rect, x: Math.max(0, Math.min(width - rect.width, rect.x)), y: Math.max(0, Math.min(height - rect.height, rect.y)) }];
  const remaining = [...obstacles], blocked: LabelRect[] = [];
  const distance = (r: LabelRect) => (r.x - rect.x) ** 2 + (r.y - rect.y) ** 2;
  while (choices.length) {
    const candidate = choices.shift()!;
    if (candidate.x < 0 || candidate.y < 0 || candidate.x + candidate.width > width || candidate.y + candidate.height > height ||
      blocked.some(r => intersects(candidate, r))) continue;
    const index = remaining.findIndex(r => intersects(candidate, r));
    if (index < 0) return candidate;
    const [obstacle] = remaining.splice(index, 1);
    blocked.push(obstacle);
    choices.push(
      { ...candidate, x: obstacle.x - candidate.width },
      { ...candidate, y: obstacle.y - candidate.height },
      { ...candidate, x: obstacle.x + obstacle.width },
      { ...candidate, y: obstacle.y + obstacle.height },
    );
    choices.sort((a, b) => distance(a) - distance(b));
  }
  return { ...rect };
}
