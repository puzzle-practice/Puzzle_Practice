import { expect, it } from 'vitest';
import type { Images } from '../../core/assets';
import type { Screen } from '../../core/screen';
import fixtures from './gust-parity.json';
import { BLOCKER, CONNECTED, PatchingBoard, SLACK, SPOOL, STRAIGHT, TIE } from './logic';
import { cellAt, center, PatchingView } from './view';

it('maps the 56 px pieces to the original board positions', () => {
  for (let i = 0; i < 42; i++) expect(cellAt(center(i))).toBe(i);
  expect(cellAt([29, 69])).toBe(0);
  expect(cellAt([420, 404])).toBe(41);
  for (const point of [[28, 69], [421, 404], [29, 68], [29, 405]] as [number, number][]) expect(cellAt(point)).toBe(-1);
});

function isolatedBoard(i: number, type = STRAIGHT): PatchingBoard {
  const b = new PatchingBoard(5, 42, false);
  for (let n = 0; n < 42; n++) b.pieces.set(n, { type: n === i ? type : BLOCKER, orientation: n === i ? 1 : 0, tension: n === i ? CONNECTED : SLACK, distance: 43 });
  return b;
}
const viewFor = (b: PatchingBoard) => new PatchingView({} as Screen, {} as Images, () => {}, b, 0, 42);

it('fades only newly connected thread images, leaving cloth full size and immediately visible', () => {
  const b = isolatedBoard(9); b.pieces.get(9)!.tension = SLACK;
  const view = viewFor(b); b.pieces.get(9)!.tension = CONNECTED; b.tiles[9] = CONNECTED;
  view.changed(new Map(), 1000);
  const frames = view.scene(1250), [x, y] = center(9);
  const thread = frames.find(f => f.name === 'straight' && f.x === x && f.y === y)!;
  expect(thread.alpha).toBe(.5); expect(thread.scale).toBe(1);
  const cloth = frames.find(f => f.name === 'tiles' && f.x === x && f.y === y)!;
  expect(cloth.alpha).toBe(1); expect(cloth.scale).toBe(1); expect(cloth.tile).toBe(1);
});

it('fades swap markers without shrinking them and retains image state when swapping', () => {
  const b = isolatedBoard(0), view = viewFor(b);
  b.pieces.set(1, { ...b.pieces.get(0)! });
  view.swapped(0, 1, 1000);
  const markers = view.scene(1375).filter(f => f.name === 'swap_effect');
  expect(markers).toHaveLength(2);
  for (const marker of markers) { expect(marker.alpha).toBe(.5); expect(marker.scale).toBe(1); }
});

it('crossfades replacement layers at full size with the original cell delays', () => {
  const view = viewFor(isolatedBoard(0)); view.setBoard(isolatedBoard(0, 2), 1000);
  const at = (time: number, name: string) => view.scene(time).find(f => f.name === name && f.x === 57 && f.y === 97);
  expect(at(1200, 'straight')!.alpha).toBe(.5);
  expect(at(1265, 'elbow')).toBeUndefined();
  expect(at(1465, 'elbow')!.alpha).toBe(.5);
  expect(at(1665, 'elbow')!.alpha).toBe(1);
  expect(view.scene(1000).filter(f => f.name === 'tiles').slice(-42).every(f => f.alpha === 1)).toBe(true);
  for (const time of [1000, 1100, 1300, 1500, 1700]) expect(view.scene(time).every(f => f.scale === 1)).toBe(true);
});

it('starts loose-end effects at frame zero on each board update', () => {
  const b = isolatedBoard(0); b.loose = [0]; const view = viewFor(b);
  view.changed(new Map(), 1123);
  expect(view.scene(1123).find(f => f.name === 'effect_loose_end')!.tile).toBe(0);
  expect(view.scene(1323).find(f => f.name === 'effect_loose_end')!.tile).toBe(2);
  view.changed(new Map(), 1377);
  expect(view.scene(1377).find(f => f.name === 'effect_loose_end')!.tile).toBe(0);
});

it('never resurrects cleared stitches when replacing a completed board', () => {
  const f = fixtures[0], b = new PatchingBoard(5, 42, false);
  f.initial.forEach(([type, orientation, tension, tile], i) => {
    b.pieces.set(i, { type, orientation, tension, distance: 43 }); b.tiles[i] = tile;
    if (type === SPOOL) b.spool = i; if (type === TIE) b.ties.push(i);
  });
  const view = viewFor(b), result = b.gust(); view.gust(1000, result.done, result.torn, result.used);
  view.advance(2900); view.setBoard(isolatedBoard(0, 2), 2900);
  expect(view.scene(3000).filter(f => ['spool', 'straight', 'tie_offs'].includes(f.name))).toEqual([]);
});

it('keeps the pickup ghost unchanged while the held piece rotates and moves above the markers', () => {
  const b = isolatedBoard(0), view = viewFor(b);
  view.drag = { i: 0, from: [57, 97], to: [87, 137] };
  b.pieces.get(0)!.orientation = 2; view.changed(new Map(), 1000);
  const frames = view.scene(1200).filter(f => f.name === 'straight');
  expect(frames).toContainEqual(expect.objectContaining({ x: 57, y: 97, tile: 5, alpha: .5, layer: -4 }));
  expect(frames).toContainEqual(expect.objectContaining({ x: 87, y: 137, tile: 6, alpha: 1, layer: -1 }));
});

it('preserves the cursor across replacement boards and accepts input while the pieces fade', () => {
  const view = viewFor(isolatedBoard(0)); view.cursor = 19;
  view.setBoard(isolatedBoard(0), 1000);
  expect(view.cursor).toBe(19); expect(view.ready(1000)).toBe(true); expect(view.windAt).toBe(1530);
});

it('bursts green tokens into eight stars, holds the flare, then accelerates it away', () => {
  const b = isolatedBoard(0); b.bonuses.set(8, 1); const view = viewFor(b);
  view.gust(1000, true, 0, [], [8]);
  expect(view.scene(1000).filter(f => f.name === 'maneuver_star')).toHaveLength(8);
  expect(view.scene(1000).some(f => ['bonus', 'bonus_green'].includes(f.name))).toBe(false);
  expect(view.scene(1699).find(f => f.name === 'maneuver_flare')).toMatchObject({ x: 85, y: 125 });
  expect(view.scene(1800).find(f => f.name === 'maneuver_flare')!.x).toBeGreaterThan(85);
  expect(view.scene(1900).filter(f => f.name === 'maneuver_star')).toHaveLength(0);
  expect(view.scene(2200).some(f => f.name === 'maneuver_flare')).toBe(false);
});

for (const f of fixtures) it(`schedules scenario ${f.kind} with the game's clear and replacement timings`, () => {
  const board = new PatchingBoard(5, 42, false);
  f.initial.forEach(([type, orientation, tension, tile], i) => {
    board.pieces.set(i, { type, orientation, tension, distance: 43 }); board.tiles[i] = tile;
    if (type === SPOOL) board.spool = i; if (type === TIE) board.ties.push(i);
  });
  const played: string[] = [];
  const view = new PatchingView({} as Screen, {} as Images, name => played.push(name), board, 0, 42);
  const r = board.gust(); view.gust(1000, r.done, r.torn, r.used);
  if (f.kind === 0) {
    expect(view.resultAt).toBe(1400); expect(view.nextAt).toBe(2900);
    view.advance(1199); expect(played).not.toContain('thread_clear');
    view.advance(1200); expect(played).toContain('thread_clear');
    view.advance(1400); expect(played).toContain('tie_off_clear'); expect(played).toContain('fanfare_best');
  } else if (f.kind === 1) {
    expect(view.completeAt).toBeNull(); expect(view.windAt).toBe(1000); expect(played).toContain('grommet_consumed');
  } else {
    expect(view.nextAt).toBe(4000); expect(played).toContain('hole_torn');
  }
});
