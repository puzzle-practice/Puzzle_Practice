// What a clear sends to the opponent. Attack construction follows the documented swordfighting rules, so it
// follows YPPedia's Swordfighting page:
//   - every shattered fused block sends a sword strike of the same size, upright when the block is
//     square or taller, lying flat when wider; a 2x2 sends a 1x4 sword and a 3x3 a 2x4 sword;
//     an upright sword wider than 3 turns the extra width into length, and a flat one taller than
//     3 turns the extra height into length
//   - each break sends one sprinkle for every two loose pieces (breakers included), rounded down,
//     working out simultaneous breaks separately and adding them up
//   - the nth clear of a chain multiplies sprinkles by n, and a block's longest side by n
import { type Clear, colour, H, W } from './board';

export interface Attack {
  /** [width, height] of each sword strike. */
  swords: Array<[number, number]>;
  sprinkles: number;
}

export const emptyAttack = (): Attack => ({ swords: [], sprinkles: 0 });

/** The sword a shattered w x h block sends as the nth clear of a chain. */
export function swordFor(w: number, h: number, link: number): [number, number] {
  if (link > 1) {
    if (h >= w) h *= link;
    else w *= link;
  }
  if (w === 2 && h === 2) return [1, 4];
  if (w === 3 && h === 3) return [2, 4];
  if (h >= w) {
    if (w > 3) return [3, h + w - 3];
    return [w, h];
  }
  if (h > 3) return [w + h - 3, 3];
  return [w, h];
}

/** The attack from one clear, the `link`th of its chain (1 for the first). */
export function attackFor(clear: Clear, link: number): Attack {
  const swords = clear.blocks.map((b) => swordFor(b.w, b.h, link));
  // Separate breaks: loose shattered pieces grouped by touching, through any shattered block.
  // A piece counts as loose unless it's in one of the clear's blocks, as the clear counts them.
  const inBlock = (x: number, y: number) => clear.blocks.some((b) => x >= b.x && x < b.x + b.w && y <= b.y && y > b.y - b.h);
  const shattered = new Map<number, { loose: boolean; colour: number }>();
  for (const c of clear.cells) shattered.set(c.y * W + c.x, { loose: !inBlock(c.x, c.y), colour: colour(c.piece) });
  const seen = new Set<number>();
  let sprinkles = 0;
  for (const start of shattered.keys()) {
    if (seen.has(start)) continue;
    let loose = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const i = stack.pop()!;
      const cell = shattered.get(i)!;
      if (cell.loose) loose++;
      const x = i % W;
      const y = Math.floor(i / W);
      for (const [nx, ny] of [[x, y - 1], [x - 1, y], [x, y + 1], [x + 1, y]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        const next = shattered.get(j);
        if (!next || seen.has(j) || next.colour !== cell.colour) continue;
        seen.add(j);
        stack.push(j);
      }
    }
    sprinkles += Math.floor(loose / 2);
  }
  return { swords, sprinkles: sprinkles * link };
}

export function addAttack(total: Attack, more: Attack): void {
  total.swords.push(...more.swords);
  total.sprinkles += more.sprinkles;
}

/** Pieces of damage: sprinkles plus each sword's size. */
export const attackSize = (a: Attack) => a.sprinkles + a.swords.reduce((n, [w, h]) => n + w * h, 0);
