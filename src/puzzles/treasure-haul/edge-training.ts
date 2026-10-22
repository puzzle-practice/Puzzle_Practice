import { HaulBoard, H, W, EMERALD, isChestOrigin } from './logic';
import { Random } from '../../core/random';
import type { Drill } from './training';

type Move = [number, number];
type Target = [number, number, number];
interface Position { cells: number[]; refill: number; moves: Move[]; gems: number }

/** Random coin boards are accepted only after finding a complete playable route. */
export function createVariedEdgeDrill(random: () => number): Drill {
  const x = [0, 1, W - 3, W - 2][Math.floor(random() * 4)];
  const y = 1 + Math.floor(random() * 2);
  const emeralds = random() < 0.75 ? 1 + Math.floor(random() * 3) : 0;
  const locked = x < W / 2 ? x : x + 1;
  for (let attempt = 0; attempt < 40; attempt++) {
    let nextPiece = random;
    const board = new HaulBoard(() => nextPiece());
    board.populate(); board.placeChest(x, y, Math.floor(random() * 3)); board.gemRates = [0, 0];
    for (let gem = 0; gem < emeralds; gem++) {
      const positions: Move[] = [];
      for (let gx = 0; gx < W; gx++) for (let gy = 0; gy < H; gy++) {
        const distance = Math.abs(gx - locked);
        if (!distance || board.get(gx, gy) >= 4) continue;
        if ([gy - distance, gy + distance].some((row) => row > y && row < H)) positions.push([gx, gy]);
      }
      // Opposite-wall diagonals are useful too, particularly from the bottom row.
      const remote = positions.filter(([gx]) => gx === (x < W / 2 ? W - 1 : 0));
      const choices = gem === 0 && random() < 0.3 && remote.length ? remote : positions;
      const [gx, gy] = choices[Math.floor(random() * choices.length)];
      board.set(gx, gy, EMERALD);
    }
    const refillRng = new Random(Math.floor(random() * 0x100000000));
    const refills: number[] = [];
    const draw = (index: number) => {
      while (refills.length <= index) refills.push(refillRng.random());
      return refills[index];
    };
    const solution = solve(board, x, emeralds > 0, draw, attempt < 20 ? 8 : 20);
    if (!solution) continue;
    let refill = 0;
    nextPiece = () => draw(refill++);
    return { board, chest: { x, y }, solution, impossible: false };
  }
  throw new Error('Unable to generate a solvable edge drill');
}

/** Colour Cleanup's goal: coins of the colour still above the chest in its two columns (none once it's hauled). */
export function colourAboveChest(cells: readonly number[], chestX: number, colour: number): number {
  const origin = cells.findIndex(isChestOrigin);
  if (origin < 0) return 0;
  let count = 0;
  for (let y = Math.floor(origin / W) + 1; y < H; y++) for (const x of [chestX, chestX + 1]) if (cells[y * W + x] === colour) count++;
  return count;
}

/** Search coin matches and emerald blasts rather than choosing a fixed layout. */
export function solveColourDrill(original: HaulBoard, chestX: number, colour: number, draw: (index: number) => number): Move[] | null {
  return solve(original, chestX, false, draw, 16, colour);
}

function solve(original: HaulBoard, chestX: number, useGem: boolean, draw: (index: number) => number, width: number, goal?: number): Move[] | null {
  let frontier: Position[] = [{ cells: [...original.cells], refill: 0, moves: [], gems: 0 }];
  const seen = new Set<string>();
  const clone = (position: Position) => {
    let refill = position.refill;
    const board = new HaulBoard(() => draw(refill++));
    board.cells.splice(0, board.cells.length, ...position.cells); board.gemRates = [0, 0];
    return { board, refill: () => refill };
  };
  const chestRow = (cells: number[]) => Math.floor(cells.findIndex(isChestOrigin) / W);
  const rank = (position: Position) => {
    if (goal !== undefined) return -colourAboveChest(position.cells, chestX, goal) * 30 - position.moves.length / 10;
    const row = chestRow(position.cells);
    let blocked = 0;
    for (let y = row + 1; y < H; y++) for (const x of [chestX, chestX + 1]) {
      if (position.cells[y * W + x] !== -1) blocked += x < 2 || x >= W - 2 ? 8 : 3;
    }
    return row * 30 - blocked - position.moves.length / 10 + (position.gems ? 2 : 0);
  };
  for (let depth = 0; depth < 16; depth++) {
    const next: Position[] = [];
    for (const position of frontier) {
      const { board } = clone(position);
      const row = chestRow(position.cells);
      const plans: Array<{ targets?: Target[]; gem?: Move }> = [];
      const gems = board.cells.flatMap((piece, i) => piece === EMERALD ? [[i % W, Math.floor(i / W)] as Move] : []);
      for (const [x, y] of gems) plans.push({ gem: [x, Math.max(1, y)] });
      const available = (x: number, y: number, colour: number) => {
        let count = 0;
        for (let below = y; below >= 0; below--) {
          const piece = board.get(x, below);
          if (piece < 0 || piece >= 4) break;
          if (piece === colour) count++;
        }
        return count;
      };
      for (let colour = 0; colour < 4; colour++) {
        for (let x = 0; x < W; x++) for (let top = H - 1; top >= (goal === undefined ? H - 1 : 2); top--) if (available(x, top, colour) >= 3) {
          plans.push({ targets: [[x, top, colour], [x, top - 1, colour], [x, top - 2, colour]] });
        }
        for (let y = H - 1; y > (goal === undefined ? row : -1); y--) for (let x = 0; x < W - 2; x++) {
          if (goal === undefined && !(x <= chestX + 1 && x + 2 >= chestX) && !gems.some(([gx, gy]) => gx >= x && gx <= x + 2 && gy < y)) continue;
          if ([x, x + 1, x + 2].every((column) => available(column, y, colour))) {
            const targets: Target[] = [x, x + 1, x + 2].map((column) => [column, y, colour]);
            plans.push({ targets }, { targets: [...targets].reverse() });
          }
        }
      }
      for (const plan of plans) {
        const trial = clone(position);
        const moves = [...position.moves];
        let gemsUsed = position.gems;
        let cleared = false; let hauled = false; let illegal = false;
        const move = (x: number, y: number) => {
          const result = trial.board.swap(x, y);
          if (result.kind === 'illegal' || result.kind === 'same') { illegal = true; return; }
          moves.push([x, y]);
          if (result.kind === 'gem') { cleared = true; gemsUsed++; }
          let stable = false;
          for (let step = 0; step < 300; step++) {
            const event = trial.board.step();
            if (!event) { stable = true; break; }
            if (event.kind === 'haul') hauled = true;
            if (event.kind === 'match') cleared = true;
          }
          if (!stable) illegal = true;
          trial.board.settle();
        };
        if (plan.gem) move(...plan.gem);
        for (const [x, y, colour] of plan.targets ?? []) {
          let source = y;
          while (source >= 0 && trial.board.get(x, source) !== colour) source--;
          if (source < 0) { illegal = true; break; }
          while (source < y && !cleared && !illegal) move(x, ++source);
          if (cleared || illegal) break;
        }
        if (illegal || !cleared) continue;
        if (goal !== undefined) {
          if (!colourAboveChest(trial.board.cells, chestX, goal)) return moves;
        } else if (hauled) { if (!useGem || gemsUsed) return moves; continue; }
        const candidate = { cells: [...trial.board.cells], refill: trial.refill(), moves, gems: gemsUsed };
        const key = candidate.cells.join(',') + ':' + candidate.refill + ':' + !!gemsUsed;
        if (seen.has(key)) continue;
        seen.add(key); next.push(candidate);
      }
    }
    if (!next.length) return null;
    next.sort((a, b) => rank(b) - rank(a));
    frontier = next.slice(0, width);
  }
  return null;
}
