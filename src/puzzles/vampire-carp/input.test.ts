import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { BoardRandom, Hole } from './board';
import { CELL, Game, holeCell, newStats, VIEW_X, VIEW_Y } from './game';

/** A spacious hole and an X plank: its bounding rectangle has four blank corners. */
function placedX(ship: boolean) {
  const game = new Game(5, new BoardRandom(5), newStats(), { sound() {}, levelDone() {} }, null, new Random(5), 0,
    { ship, difficulty: 5, tokens: 0 });
  game.update(1600);
  const hole = Hole.shaped(Array.from({ length: 7 }, () => Array<boolean>(6).fill(true)), 99);
  expect(game.edit(() => { game.board.holes[0] = hole; return true; })).toBe(true);
  const [hx, hy] = holeCell(0, hole);
  game.holdCheat(9);
  const x = VIEW_X + (hx + 3) * CELL + 5, y = VIEW_Y + (hy + 1) * CELL + 5;
  game.pointerMove(x, y);
  const target = game.target(game.cursor, game.held!.piece)!;
  expect(target.hole).toBe(hole);
  expect(target.hole.checkPiece(game.held!.piece, ...target.at)).toBeGreaterThan(0);
  game.pointerDown(1, x, y); game.pointerUp(1);
  expect(game.tentative).not.toBeNull();
  return { game, hole, x, y, plank: game.tentative!.sprite };
}

describe.each([false, true])('carpentry client input parity (ship: %s)', ship => {
  it('picks up from a blank corner of the plank bounds, then waits for an explicit placement', () => {
    const { game, x, y, plank } = placedX(ship);
    game.pointerMove(x - CELL, y - CELL);
    game.pointerDown(1, x - CELL, y - CELL); game.pointerUp(1);
    expect(game.held).toBe(plank);
    game.update(11600);
    game.pointerMove(x, y);
    game.rotate(true);
    expect(game.held).toBe(plank);
    expect(game.stats.replaced).toBe(0);
    game.pointerDown(1, x, y); game.pointerUp(1);
    expect(game.stats.replaced).toBe(1);
    expect(game.tentativeAt).toBeNull();
  });

  it('starts a drag from a blank corner of the plank bounds', () => {
    const { game, x, y, plank } = placedX(ship);
    game.pointerMove(x - CELL, y - CELL);
    game.pointerDown(1, x - CELL, y - CELL);
    expect(game.held).toBe(plank);
    game.pointerMove(x, y - CELL); game.pointerUp(1);
    expect(game.stats.replaced).toBe(1);
    expect(game.held).toBeNull();
  });

  it('accepts the extra outline pixel at the right and bottom of the native sprite bounds', () => {
    const { game, x, y, plank } = placedX(ship);
    const right = x - 5 + 2 * CELL, bottom = y - 5 + 2 * CELL;
    game.pointerMove(right, bottom); game.pointerDown(1, right, bottom); game.pointerUp(1);
    expect(game.held).toBe(plank);
  });

  it('uses the place key to commit the tentative plank and take the next toolbox piece', () => {
    const { game, hole, x, y, plank } = placedX(ship);
    const next = game.tools[game.selected];
    game.placeKey(x, y);
    expect(game.held).toBe(next);
    expect(game.held).not.toBe(plank);
    expect(game.tentativeAt).toBeNull();
    expect(hole.piecesUsed).toBe(1);
    expect(game.cursor).toEqual(Game.toolCell(game.selected));
  });

  it('allows the place key to take a tool when the pointer is over a hole', () => {
    const { game, x, y } = placedX(ship);
    game.commitTentative();
    game.placeKey(x, y);
    expect(game.held).toBe(game.tools[game.selected]);
    expect(game.held).not.toBeNull();
  });

  it('allows a mouse pickup followed by keyboard rotation and placement', () => {
    const { game, x, y, plank } = placedX(ship);
    game.pointerDown(1, x, y); game.pointerUp(1);
    game.rotate(true); game.flip();
    const orient = plank.piece.orient;
    game.placeKey(x, y);
    expect(game.held).toBeNull();
    expect(game.stats.replaced).toBe(1);
    expect(plank.piece.orient).toBe(orient);
  });

  it('restores the original cursor and orientation before switching tools during an adjustment', () => {
    const { game, x, y, plank } = placedX(ship);
    const original = [...game.tentativeAt!];
    const orient = plank.piece.orient;
    game.pointerDown(1, x, y); game.pointerUp(1);
    game.pointerMove(x + CELL, y); game.rotate(true);
    game.keyPick(1);
    expect(game.cursor).toEqual(original);
    expect(plank.piece.orient).toBe(orient);
    expect(game.held).toBe(game.tools[1]);
    expect(game.stats.replaced).toBe(0);
  });

  it.each([[15, 1], [15, 100], [15, 1000], [16, 1], [16, 100], [16, 1000]])(
    'uses movement rather than elapsed time to recognise a drag (%s px, %s ms)', (distance, elapsed) => {
      const { game, x, y, plank } = placedX(ship);
      game.pointerDown(1, x, y);
      game.update(game.now + elapsed);
      game.pointerMove(x + distance, y); game.pointerUp(1);
      expect(game.stats.replaced).toBe(distance > 15 ? 1 : 0);
      expect(game.held).toBe(distance > 15 ? null : plank);
    },
  );
});
