import type { Images } from '../../core/assets';
import { EMPTY, PULLEYS, ROWS, isLink, linkDirs, rowSize, shapeOf, type Point } from './board';
import { AXES, FADE_MS, REFILL_MS, cellPos, pulleyPos, type RiggingGame, type Scene } from './game';

export const PIECE = 34;
export type RiggingImages = Pick<Images, 'get'>;
/** Where each pulley sheet's wheel sits inside its 250-pixel frame. */
const PULLEY_ORIGINS: readonly [number, number][] = [[125, 198], [71, 174], [72, 76], [125, 52], [178, 76], [179, 174]];
/** The rope coils: a loop every 8 pixels, centred on y = 576. */
export const coilPos = (i: number): [number, number] => [Math.round(207 + (i - 9.5) * 8), 576];
export const WILD_PREVIEW: [number, number] = [316, 576];

const tinted = new Map<string, HTMLCanvasElement>();
let swatches: number[][] | null = null;
/** Each piece's average colour, which the game's splice colouring follows. */
function pieceColours(images: RiggingImages): number[][] {
  if (swatches) return swatches;
  const c = document.createElement('canvas'); c.width = PIECE * 8; c.height = PIECE;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(images.get('pieces'), 0, 0, PIECE * 8, PIECE, 0, 0, PIECE * 8, PIECE);
  swatches = Array.from({ length: 8 }, (_, t) => {
    const d = g.getImageData(t * PIECE, 0, PIECE, PIECE).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    return [r / n, gg / n, b / n];
  });
  return swatches;
}
/** The splice band recoloured: red takes the colour at one end, green the colour at the other (rope beige if unset). */
function spliceBand(images: RiggingImages, type: number, primary: number, secondary: number): HTMLCanvasElement {
  const id = `${type}:${primary}:${secondary}`;
  const cached = tinted.get(id);
  if (cached) return cached;
  const colours = pieceColours(images), rope = [196, 170, 120];
  const p = primary >= 0 && primary < 8 ? colours[primary] : rope, s = secondary >= 0 && secondary < 8 ? colours[secondary] : rope;
  const c = document.createElement('canvas'); c.width = PIECE; c.height = PIECE;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(images.get('splices'), (type - 12) * PIECE, 0, PIECE, PIECE, 0, 0, PIECE, PIECE);
  const data = g.getImageData(0, 0, PIECE, PIECE), d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gr = d[i + 1], b = d[i + 2];
    const target = r > gr + 30 && r > b + 30 ? p : gr > r + 30 && gr > b + 30 ? s : null;
    if (!target) continue;
    const light = Math.max(r, gr) / 200;
    d[i] = Math.min(255, target[0] * light); d[i + 1] = Math.min(255, target[1] * light); d[i + 2] = Math.min(255, target[2] * light);
  }
  g.putImageData(data, 0, 0);
  tinted.set(id, c);
  return c;
}

/** One piece centred on (x, y); a splice's band takes the colours at its two ends. */
export function drawPiece(ctx: CanvasRenderingContext2D, images: RiggingImages, p: number, x: number, y: number,
  alpha = 1, ends: [number, number] = [EMPTY, EMPTY]): void {
  if (p === EMPTY) return;
  const t = p & 15, left = Math.round(x - PIECE / 2), top = Math.round(y - PIECE / 2);
  ctx.save(); ctx.globalAlpha *= alpha;
  ctx.drawImage(images.get('pieces'), t * PIECE, 0, PIECE, PIECE, left, top, PIECE, PIECE);
  if (isLink(p)) ctx.drawImage(spliceBand(images, t, ends[0], ends[1]), left, top);
  const shape = shapeOf(p);
  if (shape) ctx.drawImage(images.get('bonus'), shape * PIECE, 0, PIECE, PIECE, left, top, PIECE, PIECE);
  ctx.restore();
}

/** The colours at a splice's two ends: the first end's piece colours the red band, the second the green. */
function spliceEnds(game: RiggingGame, cells: number[][], at: Point): [number, number] {
  const v = cells[at.y][at.x];
  if (!isLink(v)) return [EMPTY, EMPTY];
  const [a, b] = linkDirs(v & 15).map(d => game.board.adjacent(at.x, at.y, d, false));
  const colour = (p: Point | null) => p ? cells[p.y][p.x] & 15 : EMPTY;
  return [colour(b), colour(a)];
}

/** A point `t` (0–1) along a path of straight segments, each taking equal time. */
function along(path: [number, number][], t: number): [number, number] {
  const segs = path.length - 1;
  if (segs <= 0) return path[0];
  const f = Math.min(1, Math.max(0, t)) * segs, i = Math.min(segs - 1, Math.floor(f)), u = f - i;
  return [path[i][0] + (path[i + 1][0] - path[i][0]) * u, path[i][1] + (path[i + 1][1] - path[i][1]) * u];
}

/** Where the pieces of a rope being slid sit: they glide with the drag and settle into each whole place. */
export function previewPositions(game: RiggingGame): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const pv = game.preview;
  if (!pv) return out;
  const pts = game.board.slidePoints(pv.at.x, pv.at.y, pv.axis);
  const [ax, ay] = AXES[pv.axis], n = pts.length;
  const pos = pts.map(cellPos);
  const order = [...pos].sort((a, b) => (a[0] * ax + a[1] * ay) - (b[0] * ax + b[1] * ay));
  const g = [order[0][0] - ax / 2, order[0][1] - ay / 2], w = [order[n - 1][0] + ax / 2, order[n - 1][1] + ay / 2];
  const dx = w[0] - g[0], dy = w[1] - g[1], span = Math.hypot(dx, dy);
  const t = pv.offset / span, snapped = Math.round(t * n) / n;
  const pull = Math.sqrt(Math.max(0, 1 - Math.abs(t - snapped) * n * 2));
  pts.forEach((p, i) => {
    const z = dx !== 0 ? (pos[i][0] - g[0]) / dx : (pos[i][1] - g[1]) / dy;
    let u = pull * (snapped + z) + (1 - pull) * (t + z);
    while (u < 0) u++;
    while (u > 1) u--;
    out.set(`${p.x},${p.y}`, [Math.round(g[0] * (1 - u) + w[0] * u), Math.round(g[1] * (1 - u) + w[1] * u)]);
  });
  return out;
}

/** Pulleys sit under the pieces; the active one glows, and the pulling one spins. */
function drawPulleys(ctx: CanvasRenderingContext2D, images: RiggingImages, active: number, glowMs: number, spinning: number, spinMs: number): void {
  const sheet = images.get('pulleys'), glow = images.get('pulley_glow');
  PULLEYS.forEach((_, i) => {
    const [x, y] = pulleyPos(i);
    if (i === active) {
      const frame = Math.min(8, Math.floor(glowMs / 100));
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI * 2 * i / 6);
      ctx.drawImage(glow, frame * 120, 0, 120, 140, -60, -70, 120, 140);
      ctx.restore();
    }
    const frame = i === spinning ? Math.floor(spinMs / 60) % 6 : 0;
    ctx.drawImage(sheet, frame * 250, i * 250, 250, 250, x - PULLEY_ORIGINS[i][0], y - PULLEY_ORIGINS[i][1], 250, 250);
  });
}

export function drawBoard(ctx: CanvasRenderingContext2D, images: RiggingImages, game: RiggingGame, active: boolean, now: number, glowSince: number): void {
  const scene: Scene | undefined = game.scenes[0], t = game.sceneElapsed;
  const cells = scene?.cells ?? game.board.pieces;
  const pulling = scene?.kind === 'pull' ? scene.pulley! : -1;
  const activePulley = game.busy ? -1 : game.board.nextPulley;
  drawPulleys(ctx, images, active ? activePulley : -1, now - glowSince, pulling, Math.max(0, t - (scene?.delay ?? 0)));
  const moved = previewPositions(game);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < rowSize(y); x++) {
    const k = `${x},${y}`, at = { x, y };
    if (scene?.kind === 'pull' && scene.gone?.has(k) && t >= scene.delay!) continue;
    let alpha = 1;
    if (scene?.kind === 'refill' && scene.gone?.has(k)) continue;
    if (scene?.kind === 'level') alpha = Math.max(0, 1 - t / 400);
    const [px, py] = moved.get(k) ?? cellPos(at);
    drawPiece(ctx, images, cells[y][x], px, py, alpha, spliceEnds(game, cells, at));
  }
  if (scene?.kind === 'pull') {
    if (scene.tar?.length && t < scene.delay!) {
      // Tar splatters over its spot before the pull runs.
      const frame = Math.min(8, Math.floor(t / 100));
      for (const p of scene.tar) { const [x, y] = cellPos(p); ctx.drawImage(images.get('splatter'), frame * 132, 0, 132, 117, x - 66, y - 58, 132, 117); }
    }
    if (t >= scene.delay!) for (const f of scene.flights!) {
      const u = (t - scene.delay!) / f.duration;
      if (u > 1 + FADE_MS / f.duration) continue;
      const [x, y] = along(f.path, u);
      drawPiece(ctx, images, f.piece, x, y, u > 1 ? Math.max(0, 1 - (u - 1) * f.duration / FADE_MS) : 1);
    }
  }
  if (scene?.kind === 'refill') {
    const after = game.board.pieces;
    for (const k of scene.gone!) {
      const [x, y] = k.split(',').map(Number);
      const [px, py] = cellPos({ x, y });
      drawPiece(ctx, images, after[y][x], px, py, Math.min(1, t / REFILL_MS), spliceEnds(game, after, { x, y }));
    }
  }
  if (active && !game.busy) {
    const [x, y] = cellPos(game.cursor);
    ctx.save();
    if (game.selecting) ctx.filter = 'brightness(1.6)';
    ctx.drawImage(images.get('cursor'), x - 20, y - 20);
    ctx.restore();
  }
}

/** The rope coils along the bottom: one loop per piece pulled, a wild at twenty. */
export function drawCoils(ctx: CanvasRenderingContext2D, images: RiggingImages, game: RiggingGame, warning: boolean, now: number): void {
  ctx.drawImage(images.get('cache'), 115, 552);
  const scene = game.scenes[0], coils = Math.min(20, game.coils);
  if (scene?.kind === 'cache') {
    const frame = Math.min(18, Math.floor(game.sceneElapsed / (scene.duration / 19)));
    ctx.drawImage(images.get('cache_clear'), frame * 212, 0, 212, 34, coilPos(0)[0] - 9, 559, 212, 34);
  } else {
    const flash = warning && Math.floor(now / 100) % 2 === 0;
    for (let i = 0; i < coils; i++) {
      const [x, y] = coilPos(i);
      ctx.save(); if (flash && i >= coils - 5) ctx.globalAlpha = 0.35;
      ctx.drawImage(images.get('coil'), x - 9, y - 17);
      ctx.restore();
    }
  }
  drawPiece(ctx, images, 8, WILD_PREVIEW[0], WILD_PREVIEW[1], 0.55);
}

/** Shapes activated by the last pull, waiting round the next pulley. */
export function drawActivated(ctx: CanvasRenderingContext2D, images: RiggingImages, shapes: readonly number[], pulley: number): void {
  const [x, y] = pulleyPos(pulley);
  shapes.forEach((s, i) => {
    const a = Math.PI * 2 * i / shapes.length, r = shapes.length > 1 ? PIECE / 2 : 0;
    const px = x + r * Math.sin(a), py = y + r * Math.cos(a);
    ctx.drawImage(images.get('bonus'), s * PIECE, 0, PIECE, PIECE, px - PIECE / 2, py - PIECE / 2, PIECE, PIECE);
  });
}
