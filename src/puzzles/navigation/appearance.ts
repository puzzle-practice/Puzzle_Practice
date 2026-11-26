import type { Images } from '../../core/assets';
import type { Panel } from '../../core/panel';
import { Store } from '../../core/storage';
import { COLOUR_NAMES } from './create';
import { targetLit, type Scene } from './game';
import type { Target } from './logic';

/** Shared by navigation and its tutorial; deliberately outside gameplay/replay settings. */
export function targetAppearance(panel: Panel): () => boolean {
  const store = new Store('navigation');
  let match = store.get<boolean>('matchWildTargetColour', false);
  panel.settings.group('Appearance').toggle('Match wild targets to pieces', () => match, (on) => {
    match = on; store.set('matchWildTargetColour', on);
  });
  return () => match;
}

export function drawTarget(ctx: CanvasRenderingContext2D, images: Images, scene: Scene, target: Target, x: number, y: number, matchWildColour: boolean): void {
  const lit = targetLit(scene, target);
  const direction = (target.octant + 2) % 8;
  const sheet = target.wild ? 'star_wild' : `star_${COLOUR_NAMES[target.colour].toLowerCase()}`;
  const tile = direction + (target.wild ? (lit ? 8 : 0) : (lit ? 24 : 16));
  const left = Math.trunc(x) - 28, top = Math.trunc(y) - 28;
  ctx.drawImage(images.get(sheet), tile * 56, 0, 56, 56, left, top, 56, 56);
  if (!target.wild || !matchWildColour || !lit) return;
  const colour = scene.cells[target.ring * 8 + target.octant];
  // Replace only the centre with the matching target background, keeping the wild rim.
  ctx.save();
  ctx.beginPath(); ctx.arc(left + 28, top + 28, 21, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(images.get(`star_${COLOUR_NAMES[colour].toLowerCase()}`), (24 + direction) * 56, 0, 56, 56, left, top, 56, 56);
  ctx.restore();
}
