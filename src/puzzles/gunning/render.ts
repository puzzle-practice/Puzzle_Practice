import type { Images } from '../../core/assets';
import { CANNON_ROWS, CRATE, EMPTY, HOLE, LOADED, LOOP, MAX_HEIGHT, PARTIAL, SWAB_IN, WASHING, WIDTH, type Piece } from './board';
import { BLAST_MS, SMOKE_MS, WASH_MS, type GunningGame } from './game';

/** The game's layout: 32-pixel cells, 17 pixels in from the left, the tallest deck starting 43 down. */
export const CELL = 32, LEFT = 17, TOP = 43;
const CANNON_W = 107, CANNON_H = 43, SMOKE_W = 125, BLAST_W = 50;
export type GunningImages = Pick<Images, 'get'>;

/** Smaller decks sit in the middle of the tallest one. */
export const boardTop = (height: number) => TOP + CELL * Math.floor((MAX_HEIGHT - height) / 2);
export const boardView = (game: GunningGame) => ({ left: LEFT, top: boardTop(game.board.height), cell: CELL });
export const cannonX = (id: number, loop = false) => LEFT + ((loop ? id >= 2 : id % 2 === 0) ? CELL : 9 * CELL - 11);
export const cannonY = (id: number, top: number, loop = false) => (loop ? LOOP.rows[id % 2] : CANNON_ROWS[id >> 1]) * CELL + top - 6;

function tile(ctx: CanvasRenderingContext2D, img: CanvasImageSource, index: number, w: number, h: number, x: number, y: number, alpha = 1): void {
  if (alpha !== 1) { ctx.save(); ctx.globalAlpha = alpha; }
  ctx.drawImage(img, index * w, 0, w, h, x, y, w, h);
  if (alpha !== 1) ctx.restore();
}

/** Rails down each side: plain rows, a three-row block for each cannon row, and rails off the deck above and below. */
function eachRailRow(game: GunningGame, top: number, draw: (kind: number, y: number) => void): number {
  let y = TOP;
  for (; y < top; y += CELL) draw(0, y);
  const rows = game.board.loop ? 2 : game.board.numCannons / 2;
  for (let row = 0, next = 0; row < game.board.height; row++, y += CELL) {
    if (next < rows && row === CANNON_ROWS[next] - 1) { draw(2, y); row += 2; y += 2 * CELL; next++; }
    else draw(1, y);
  }
  const end = y;
  for (const stop = TOP + MAX_HEIGHT * CELL; y < stop; y += CELL) draw(0, y);
  return end;
}

/** Rail tiles in rails.png and rail_shadow.png: [x, y, w, h] for plain-off-deck, plain-on-deck and cannon blocks. */
const RAIL = [[0, 0, 32], [0, 32, 32], [0, 64, 96]];

function piecePosition(game: GunningGame, p: Piece, top: number): [number, number] {
  const t = game.progress;
  let x: number, y: number;
  if (p.half) {
    // Half way toward the cell it wanted, then back.
    const f = t < 0.5 ? t : 1 - t;
    x = p.x + (p.hx - p.x) * f; y = p.y + (p.hy - p.y) * f;
  } else { x = p.x + (p.nx - p.x) * t; y = p.y + (p.ny - p.y) * t; }
  return [LEFT + x * CELL, top + y * CELL];
}

export function drawGame(ctx: CanvasRenderingContext2D, images: GunningImages, game: GunningGame, showPieces: boolean): void {
  const board = game.board, top = boardTop(board.height);
  ctx.drawImage(images.get('background'), 0, 0);
  // Behind the pieces: shadows, holes, rails and arrows.
  const railShadow = images.get('rail_shadow');
  eachRailRow(game, top, (kind, y) => { const [, sy, h] = RAIL[kind]; ctx.drawImage(railShadow, 0, sy, 44, h, 3, y - 1, 44, h); });
  for (const c of board.cannons) ctx.drawImage(images.get(c.left ? 'cannon_left_shadow' : 'cannon_right_shadow'), cannonX(c.id, board.loop), cannonY(c.id, top, board.loop));
  const cellAt = (i: number): [number, number] => [LEFT + (i % WIDTH) * CELL, top + Math.floor(i / WIDTH) * CELL];
  board.cells.forEach((raw, i) => { if ((raw & 0xff) === CRATE) ctx.drawImage(images.get('crate_shadow'), ...cellAt(i)); });
  board.cells.forEach((raw, i) => {
    if ((raw & 0xff) !== HOLE) return;
    const [x, y] = cellAt(i);
    tile(ctx, images.get('holes'), i % 3, 52, 52, x - 10, y - 10);
  });
  const rails = images.get('rails');
  const end = eachRailRow(game, top, (kind, y) => {
    const [, sy, h] = RAIL[kind];
    ctx.drawImage(rails, 0, sy, 25, h, 3, y - 1, 25, h);
    ctx.drawImage(rails, 25, sy, 25, h, 422, y - 1, 25, h);
  });
  if (board.height !== MAX_HEIGHT) {
    // The rows the smaller deck doesn't use are shaded.
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 42, 450, top - 44);
    ctx.fillRect(0, end, 450, 586 - end);
  }
  ctx.drawImage(images.get('rail_top'), 0, top - 7);
  ctx.drawImage(images.get('rail_bottom'), 0, end - 12);
  if (showPieces) {
    board.arrows.forEach((i, order) => {
      if (i === -1) return;
      const [x, y] = cellAt(i);
      tile(ctx, images.get('arrows'), board.arrowAt(i) - 10, CELL, CELL, x, y, 1 - 0.25 * order);
    });
    // Pieces on the deck, then the barrel.
    for (const p of board.pieces) if (!p.inCannon) tile(ctx, images.get('pieces'), p.type - 20, CELL, CELL, ...piecePosition(game, p, top));
    for (const barrel of board.barrels) tile(ctx, images.get('barrel'), barrel.frame, 40, 40, Math.floor(barrel.pos * CELL + 0.5) + LEFT - 4, barrel.row * CELL + top - 4);
  }
  board.cells.forEach((raw, i) => { if ((raw & 0xff) === CRATE) tile(ctx, images.get('crates'), i % 4 % 3, CELL, CELL, ...cellAt(i)); });
  if (showPieces) {
    const [x, y] = [LEFT + game.cursor.x * CELL, top + game.cursor.y * CELL];
    tile(ctx, images.get('arrows'), game.nextArrow - 10 + 4, CELL, CELL, x, y);
  }
  // Cannons: clean, in use or fouled; "Loaded!" on a loaded one.
  for (const c of board.cannons) {
    const frame = c.fouled ? 2 : c.state === PARTIAL || c.state === SWAB_IN || c.state === WASHING ? 1 : 0;
    const x = cannonX(c.id, board.loop), y = cannonY(c.id, top, board.loop);
    tile(ctx, images.get(c.left ? 'cannon_left' : 'cannon_right'), frame, CANNON_W, CANNON_H, x, y);
    if (c.state === LOADED) {
      const ready = images.get('ready');
      ctx.drawImage(ready, x + Math.floor((CANNON_W - ready.width) / 2), y + Math.floor((CANNON_H - ready.height) / 2));
    }
  }
  board.cells.forEach((raw, i) => {
    const resting = raw >> 16 & 0xff;
    if (resting) tile(ctx, images.get('pieces'), resting - 20, CELL, CELL, ...cellAt(i));
  });
  // In front: washes, blasts and smoke, and pieces travelling inside a cannon.
  for (const a of game.anims) {
    const t = game.now - a.start, left = board.cannons[a.cannon].left, x = cannonX(a.cannon, board.loop), y = cannonY(a.cannon, top, board.loop);
    if (a.kind === 'wash') {
      tile(ctx, images.get(left ? 'wash_left' : 'wash_right'), Math.min(4, Math.floor(t / (WASH_MS / 5))), CANNON_W, CANNON_H, x, y);
      continue;
    }
    const rowY = (board.loop ? LOOP.rows[a.cannon % 2] : CANNON_ROWS[a.cannon >> 1]) * CELL + top;
    if (t < BLAST_MS) { ctx.drawImage(images.get(left ? 'blast_left' : 'blast_right'), x + (left ? -BLAST_W : CANNON_W), rowY); continue; }
    // The smoke drifts out from the gunport as it fades.
    const alpha = Math.max(0, 1 - (t - BLAST_MS) / SMOKE_MS), start = x - (left ? SMOKE_W - CANNON_W : 0), dir = left ? -1 : 1;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.drawImage(images.get('smoke'), start + dir * Math.floor(SMOKE_W - alpha * SMOKE_W), rowY);
    ctx.restore();
  }
  if (showPieces) for (const p of game.piecesInCannons()) tile(ctx, images.get('pieces'), p.type - 20, CELL, CELL, ...piecePosition(game, p, top));
  if (board.loop && showPieces) drawLoadStatus(ctx, game, top);
}

/** Keep loading availability visible after the fading smoke becomes hard to see. */
function drawLoadStatus(ctx: CanvasRenderingContext2D, game: GunningGame, top: number): void {
  ctx.save();
  for (const c of game.board.cannons) {
    const ready = (c.state === EMPTY || c.state === PARTIAL) && c.slots.slice(c.fouled ? 1 : 0).some(slot => slot === null);
    const x = cannonX(c.id, true), y = cannonY(c.id, top, true);
    if (!ready) {
      ctx.fillStyle = 'rgba(22,16,14,.58)';
      ctx.fillRect(x + 2, y + 6, CANNON_W - 4, CANNON_H - 10);
    }
  }
  ctx.restore();
}
