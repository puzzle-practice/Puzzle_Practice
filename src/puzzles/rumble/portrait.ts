import { coloursOf, paintLayer, type Zation } from '../../core/duty/paint';
import type { Glove } from './gloves';

/** Portrait dyes use the two four-bit colour indices, independently of the ball pattern. */
export function glovePalette(glove: Pick<Glove, 'type' | 'colours'>, skin: string): Partial<Record<Zation, string>> {
  const colour = glove.colours & 255;
  if (glove.type === 13) return { bones_item: coloursOf('bones_item')[colour % 7], skin };
  return { glove_p: coloursOf('glove_p')[colour >> 4], glove_s: coloursOf('glove_s')[colour & 15], skin };
}

export function paintGlove(image: HTMLImageElement, glove: Glove, skin: string): HTMLCanvasElement {
  const classes: Zation[] = glove.type === 13 ? ['bones_item', 'skin'] : ['glove_p', 'glove_s', 'skin'];
  return paintLayer(image, classes, glovePalette(glove, skin));
}
