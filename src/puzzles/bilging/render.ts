import type { Images } from '../../core/assets';
import { CRAB, EMPTY, HEIGHT, JELLY, WIDTH } from './board';
import { BilgingGame, FADE_MS, PUFFER_BURST_MS, crabDuration, riseDuration, type Scene } from './game';

export const CELL = 45, LEFT = 89, TOP = 46;
export type BilgingImages = Pick<Images, 'get'>;
/** Screen top edge of a board row; rows count up from the bottom. */
export const rowTop = (y: number) => TOP + (HEIGHT - 1 - y) * CELL;
const PUFFER_FRAMES = [0, 1, 2, 3, 2, 1, 4], PUFFER_TIMES = [200, 125, 125, 250, 175, 175, 125];

export function drawPiece(ctx: CanvasRenderingContext2D, images: BilgingImages, p: number, x: number, y: number, alpha = 1, alt = false): void {
  if (p === EMPTY) return;
  const t = p & 15;
  ctx.save(); ctx.globalAlpha = alpha;
  if (t === CRAB) ctx.drawImage(images.get('crab'), 0, 0, CELL, CELL, x, y, CELL, CELL);
  else if (t === JELLY) ctx.drawImage(images.get('jellyfish'), 3 * CELL, 0, CELL, CELL, x, y, CELL, CELL);
  else ctx.drawImage(images.get(alt ? 'pieces_alt' : 'pieces'), t * CELL, 0, CELL, CELL, x, y, CELL, CELL);
  const bonus = (p & 240) >> 4;
  if (bonus) ctx.drawImage(images.get('bonus'), bonus * CELL, 0, CELL, CELL, x, y, CELL, CELL);
  ctx.restore();
}

/** A whole token: the upper half's lower edge above the lower half's upper edge. */
export function drawToken(ctx: CanvasRenderingContext2D, images: BilgingImages, token: number, x: number, y: number, size = CELL): void {
  const sheet = images.get('bonus'), h = CELL / 2, s = size / CELL;
  ctx.drawImage(sheet, (token * 2 + 1) * CELL, h, CELL, h, x, y, size, h * s);
  ctx.drawImage(sheet, token * 2 * CELL, 0, CELL, h, x, y + h * s, size, h * s);
}

function pufferFrame(t: number): number {
  for (let i = 0; i < PUFFER_TIMES.length; i++) { if (t < PUFFER_TIMES[i]) return PUFFER_FRAMES[i]; t -= PUFFER_TIMES[i]; }
  return 4;
}

export function drawBoard(ctx: CanvasRenderingContext2D, images: BilgingImages, game: BilgingGame, active: boolean, alt = false): void {
  const scene: Scene | undefined = game.scenes[0], t = game.sceneElapsed;
  const cells = scene?.cells ?? game.board.cells, water = game.settings.water;
  const piece = (p: number, x: number, y: number, alpha = 1) => drawPiece(ctx, images, p, x, y, alpha, alt);
  ctx.save(); ctx.beginPath(); ctx.rect(LEFT, TOP, WIDTH * CELL, HEIGHT * CELL); ctx.clip();
  const hidden = new Set<number>();
  let shift = (_index: number): [number, number] => [0, 0];
  if (scene?.kind === 'swap' && scene.swap) {
    const { x, y } = scene.swap, f = Math.min(1, t / scene.duration) * CELL, i = y * WIDTH + x;
    shift = index => index === i ? [f, 0] : index === i + 1 ? [-f, 0] : [0, 0];
  }
  if (scene?.kind === 'rise' && scene.rises) {
    // Every piece rises at the same speed, so short moves finish first.
    for (const r of scene.rises) if (r.from >= 0) hidden.add(r.from * WIDTH + r.x);
    for (const r of scene.rises) piece(r.piece, LEFT + r.x * CELL, rowTop(r.from + Math.min(r.to - r.from, t / riseDuration(1))));
  }
  if (scene?.kind === 'level') {
    // Pieces drift up and out before the next board arrives.
    const lift = Math.min(1, t / (scene.duration * 0.6)) * HEIGHT * CELL;
    shift = () => [0, -lift];
  }
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const i = y * WIDTH + x;
    if (hidden.has(i)) continue;
    const [dx, dy] = shift(i);
    piece(cells[i], LEFT + x * CELL + dx, rowTop(y) + dy);
  }
  if (scene?.cleared && scene.kind !== 'crabs') for (const c of scene.cleared) piece(c.piece, LEFT + c.x * CELL, rowTop(c.y), Math.max(0, 1 - t / FADE_MS));
  if (scene?.kind === 'crabs' && scene.cleared) for (const c of scene.cleared) {
    const f = Math.min(1, t / crabDuration(c.x)), to = c.x < WIDTH / 2 ? -1 : WIDTH;
    const frame = Math.floor(t / 125) % 2;
    ctx.drawImage(images.get('crab'), frame * CELL, 0, CELL, CELL, LEFT + (c.x + (to - c.x) * f) * CELL, rowTop(c.y), CELL, CELL);
  }
  const puffer = scene?.kind === 'puffer' ? { at: scene.at!, t } : scene?.kind === 'clear' && scene.at ? { at: scene.at, t: PUFFER_BURST_MS + t } : null;
  if (puffer) {
    const frame = pufferFrame(puffer.t);
    if (frame < 4) ctx.drawImage(images.get('pufferfish'), frame * CELL * 3, 0, CELL * 3, CELL * 3, LEFT + (puffer.at.x - 1) * CELL, rowTop(puffer.at.y + 1), CELL * 3, CELL * 3);
  }
  if (scene?.kind === 'jelly' && scene.at) {
    const frame = Math.min(3, Math.floor(t / (1000 / 6)));
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - t / scene.duration);
    ctx.drawImage(images.get('jellyfish'), frame * CELL, 0, CELL, CELL, LEFT + scene.at.x * CELL, rowTop(scene.at.y), CELL, CELL);
    ctx.restore();
  }
  if (scene?.kind === 'token' && scene.at && scene.token) {
    const f = t / scene.duration;
    ctx.save(); ctx.globalAlpha = 1 - f;
    drawToken(ctx, images, scene.token, LEFT + scene.at.x * CELL, rowTop(scene.at.y) - CELL / 2 - f * 60);
    ctx.restore();
  }
  if (active && !game.busy) {
    const { x, y } = game.cursor;
    ctx.drawImage(images.get('cursor'), LEFT + x * CELL - 2, rowTop(y) - 2);
  }
  ctx.fillStyle = 'rgba(0,75,162,0.6)';
  ctx.fillRect(LEFT, TOP + (HEIGHT - water) * CELL, WIDTH * CELL, water * CELL);
  ctx.restore();
}
