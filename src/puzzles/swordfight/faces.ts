// Pirates' faces, put together the way the game puts its 58x58 faces together: layers (head, face
// paint, hair, hat) from the game's face bundles, each placed at its offset in the frame and recoloured
// with the game's colourisations (skin, hair and the two cloth dyes).
import { coloursOf, paintLayer, type Zation } from '../../core/duty/paint';
import type { Random } from '../../core/random';

export const FACE = 58;

/** Where each layer's image sits in the 58x58 frame. */
const AT: Record<string, [number, number]> = {
  'fmale-head': [14, 19], 'fmale-head-out': [14, 19], 'fmale-zombie': [15, 18], 'fmale-mercenary': [14, 19],
  'fmale-facepaint': [14, 19], 'fmale-facepaint-out': [14, 19], 'fmale-mask': [2, 0], 'fmale-shako': [10, 1],
  'fmale-hair-messy_short': [15, 15],
  'ffemale-head': [16, 18], 'ffemale-head-out': [16, 18], 'ffemale-zombie': [15, 18], 'ffemale-mercenary': [16, 18],
  'ffemale-facepaint': [15, 20], 'ffemale-facepaint-out': [15, 20], 'ffemale-mask': [5, 5], 'ffemale-shako': [11, 2],
  'ffemale-hair-cultist_top_knot': [25, 16], 'ffemale-hair-ponytail': [9, 14],
  homunculus: [7, 0], 'homunculus-out': [7, 0],
};



/** A layer and the colour classes it takes, in the order the game tries them. */
interface Layer {
  image: string;
  classes: Zation[];
}

export interface Look {
  /** Drawn bottom to top. */
  layers: Layer[];
  /** The same face knocked out, where the game has a passed-out expression. */
  out: Layer[];
  colours: Partial<Record<Zation, string>>;
}

export type FaceKind = 'You' | 'Cultist' | 'Homunculus' | 'Thrall' | 'Skilled swabbie' | 'Custom';

const pick = <T>(rng: Random, list: readonly T[]): T => list[rng.integer(0, list.length - 1)];
const names = coloursOf;

/** How a pirate of a kind looks: man or woman, with random skin, hair and dyes. */
export function lookFor(kind: FaceKind, female: boolean, rng: Random): Look {
  const g = female ? 'ffemale' : 'fmale';
  const head: Zation[] = female ? ['skin'] : ['skin', 'hair'];
  const colours: Look['colours'] = {
    skin: pick(rng, names('skin')), hair: pick(rng, names('hair')),
    textile_p: pick(rng, names('textile_p')), textile_s: pick(rng, names('textile_s')),
  };
  const layer = (image: string, classes: Zation[]): Layer => ({ image, classes });
  switch (kind) {
    case 'Homunculus':
      return { layers: [layer('homunculus', [])], out: [layer('homunculus-out', [])], colours };
    case 'Cultist': {
      const paint: Zation[] = ['skin', 'textile_p', 'textile_s'];
      const hair = female ? [layer('ffemale-hair-cultist_top_knot', ['hair'])] : [];
      return {
        layers: [layer(`${g}-head`, head), layer(`${g}-facepaint`, paint), ...hair],
        out: [layer(`${g}-head-out`, head), layer(`${g}-facepaint-out`, paint), ...hair],
        colours,
      };
    }
    case 'Thrall': {
      // A zombie under an enthralled mask, which hides the hair.
      const layers = [layer(`${g}-zombie`, ['skin']), layer(`${g}-mask`, ['textile_p', 'textile_s'])];
      return { layers, out: layers, colours };
    }
    case 'Skilled swabbie': {
      const hair = female ? [layer('ffemale-hair-ponytail', ['hair'])] : [];
      const layers = [layer(`${g}-mercenary`, head), ...hair, layer(`${g}-shako`, ['textile_p'])];
      return { layers, out: layers, colours };
    }
    case 'Custom': {
      const hair = female ? 'ffemale-hair-ponytail' : 'fmale-hair-messy_short';
      return {
        layers: [layer(`${g}-head`, head), layer(hair, ['hair'])],
        out: [layer(`${g}-head-out`, head), layer(hair, ['hair'])],
        colours,
      };
    }
    default:
      return {
        layers: [layer('fmale-head', ['skin', 'hair']), layer('fmale-hair-messy_short', ['hair'])],
        out: [layer('fmale-head-out', ['skin', 'hair']), layer('fmale-hair-messy_short', ['hair'])],
        colours: { skin: 'tan', hair: 'darkBrown' },
      };
  }
}

/** Draws a face into a new 58x58 canvas. */
export function drawFace(look: Look, out: boolean, image: (name: string) => HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = FACE;
  canvas.height = FACE;
  const ctx = canvas.getContext('2d')!;
  for (const layer of out ? look.out : look.layers) {
    const [x, y] = AT[layer.image];
    ctx.drawImage(paintLayer(image(layer.image), layer.classes, look.colours), x, y);
  }
  return canvas;
}
