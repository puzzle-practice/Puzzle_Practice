// The game's colourisations (colordefs.xml): how a face layer's skin, hair and cloth are recoloured.
// A layer is painted in source colours; each colour near a class's source colour is shifted by the
// chosen colour's HSV offsets, the way Colorization.recolorColor does it.

import { hairDyes, primaryChromas, secondaryChromas } from './palette';

type Hsv = [number, number, number];

/** The game's colourisation classes: the source colour they replace, how near a colour must be, and each colour's HSV offsets. */
export const ZATIONS = {
  skin: { source: '#C550D7', range: [0.08, 0.4, 1], colours: { darkest: [-0.75, -0.2, -0.45], dark: [-0.75, 0.16, -0.26], medium: [-0.75, -0.05, -0.01], tan: [-0.73, -0.08, -0.03], white: [-0.74, -0.28, -0.02], pale: [-0.72, -0.42, 0], pasty: [-0.72, -0.48, 0] } },
  hair: { source: '#922226', range: [0.05, 0.8, 1], colours: { red: [0.02, -0.1, 0], silver: [0.13, -0.9, -0.15], white: [0.13, -0.9, 0.15], black: [0.6, -0.7, -0.6], darkBrown: [0.1, 0, -0.4], lightBrown: [0.11, -0.2, -0.2], strawberryBlonde: [0.1, -0.1, 0], sandy: [0.13, -0.4, -0.1], blonde: [0.15, -0.4, 0.05], ...hairDyes } },
  textile_p: { source: '#922226', range: [0.07, 0.7, 1], colours: { red: [0, 0.05, 0], brown: [-0.91, -0.2, -0.2], white: [0, -1, 0.1], black: [0, -1, -0.6], grey: [0, -1, -0.2], yellow: [-0.83, -0.2, 0.1], pink: [0.95, -0.2, 0.15], violet: [0.83, -0.1, -0.15], purple: [0.76, 0.05, -0.11], navyBlue: [0.65, -0.2, -0.2], blue: [-0.4, 0, 0], aqua: [0.5, 0, -0.1], lime: [0.32, -0.1, -0.1], green: [0.3, -0.2, -0.4], orange: [0.08, 0, 0.05], maroon: [0, 0.1, -0.3], darkBrown: [-0.91, -0.2, -0.4], gold: [0.125, 0.4, 0.1], ...primaryChromas } },
  textile_s: { source: '#57AC6A', range: [0.1, 0.6, 1], colours: { red: [0.65, 0.05, 0.2], brown: [-0.28, -0.37, -0.1], white: [0.72, -1, 0.2], black: [0.72, -1, -0.5], grey: [0.2, -1, 0], yellow: [0.81, -0.25, 0.2], pink: [0.6, -0.27, 0.25], violet: [-0.55, -0.15, 0.09], purple: [-0.6, 0.1, 0.1], navyBlue: [0.28, -0.27, -0.07], blue: [0.25, -0.15, 0.2], aqua: [0.15, 0, 0.15], lime: [-0.05, -0.1, 0.1], green: [-0.05, -0.25, -0.3], orange: [0.72, 0.04, 0.252], maroon: [0.65, 0.1, -0.2], darkBrown: [-0.28, -0.37, -0.27], gold: [0.76, 0.6, 0.24], ...secondaryChromas } },
  glove_p: { source: '#922226', range: [0.07, 0.7, 1], colours: { brown: [-0.91, -0.2, -0.2], white: [0, -1, 0.1], red: [0, 0.05, 0], orange: [0.08, 0, 0.05], green: [0.3, -0.2, -0.4], blue: [-0.4, 0, 0], darkBrown: [-0.91, -0.2, -0.4], grey: [0, -1, -0.2], maroon: [0, 0.1, -0.3], navyBlue: [0.65, -0.2, -0.2], lime: [0.32, -0.1, -0.1], aqua: [0.5, 0, -0.1], pink: [0.95, -0.2, 0.15], gold: [0.125, 0.4, 0.1], purple: [0.76, 0.05, -0.11], black: [0, -1, -0.6] } },
  glove_s: { source: '#228627', range: [0.1, 0.6, 0.6], colours: { brown: [-0.28, -0.37, -0.1], white: [0.72, -1, 0.2], red: [0.65, 0.05, 0.2], orange: [0.72, 0.04, 0.252], green: [-0.05, -0.25, -0.3], blue: [0.25, -0.15, 0.2], darkBrown: [-0.28, -0.37, -0.27], grey: [0.2, -1, 0], maroon: [0.65, 0.1, -0.2], navyBlue: [0.28, -0.27, -0.07], lime: [-0.05, -0.1, 0.1], aqua: [0.15, 0, 0.15], pink: [0.6, -0.27, 0.25], gold: [0.76, 0.6, 0.24], purple: [-0.6, 0.1, 0.1], black: [0.72, -1, -0.5] } },
  bones_item: { source: '#922226', range: [0.05, 0.8, 0.6], colours: { bleached: [0.1, -0.4, 0], grey: [-0.4, -0.4, -0.1], darkGrey: [0, -0.5, -0.3], olive: [0.2, -0.1, -0.3], moss: [-0.82, -0.2, -0.1], ice: [0.5, -0.2, -0.1], red: [0, 0.1, -0.1] } },
} as const;

export type Zation = keyof typeof ZATIONS;

/** The colours a class offers, in the game's order. */
export const coloursOf = (z: Zation): string[] => Object.keys(ZATIONS[z].colours);

// java.awt.Color's RGBtoHSB and HSBtoRGB, which the game's colourisation goes through.
export function toHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max ? (max - min) / max : 0;
  if (!s) return [0, 0, v];
  const rc = (max - r) / (max - min);
  const gc = (max - g) / (max - min);
  const bc = (max - b) / (max - min);
  let h = r === max ? bc - gc : g === max ? 2 + rc - bc : 4 + gc - rc;
  h /= 6;
  if (h < 0) h += 1;
  return [h, s, v];
}

export function toRgb([hue, s, v]: Hsv): [number, number, number] {
  if (!s) {
    const c = Math.trunc(v * 255 + 0.5);
    return [c, c, c];
  }
  const h = (hue - Math.floor(hue)) * 6;
  const f = h - Math.floor(h);
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][Math.floor(h)];
  return [Math.trunc(r * 255 + 0.5), Math.trunc(g * 255 + 0.5), Math.trunc(b * 255 + 0.5)];
}

const SHORT_MAX = 32767;
const fixed = (f: number) => Math.trunc(f * SHORT_MAX);

function sourceHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16);
  return toHsv(n >> 16 & 255, n >> 8 & 255, n & 255);
}

interface Shift { source: Hsv; range: readonly number[]; offsets: readonly number[] }

/** Recolours a colour by the first of a layer's colourisations it is near enough to (Colorization.matches / recolorColor). */
export function recolour(hsv: Hsv, zations: readonly Shift[]): Hsv | null {
  for (const z of zations) {
    const d = Math.abs(fixed(hsv[0]) - fixed(z.source[0]));
    if (Math.min(d, SHORT_MAX - d) > z.range[0] * SHORT_MAX) continue;
    if (Math.abs(z.source[1] - hsv[1]) > z.range[1] || Math.abs(z.source[2] - hsv[2]) > z.range[2]) continue;
    let h = hsv[0] + z.offsets[0];
    if (h > 1) h -= 1;
    const clamp = (x: number) => Math.min(Math.max(x, 0), 1);
    return [h, clamp(hsv[1] + z.offsets[1]), clamp(hsv[2] + z.offsets[2])];
  }
  return null;
}

/** A copy of a layer image recoloured by the classes it takes, in the order the game tries them. */
export function paintLayer(img: CanvasImageSource & { width: number; height: number }, classes: readonly Zation[],
  colours: Partial<Record<Zation, string>>): HTMLCanvasElement {
  const part = document.createElement('canvas');
  part.width = img.width;
  part.height = img.height;
  const pc = part.getContext('2d', { willReadFrequently: true })!;
  pc.drawImage(img, 0, 0);
  const zations = classes.flatMap((c) => {
    const colour = colours[c];
    const z = ZATIONS[c];
    const offsets = colour ? (z.colours as Record<string, readonly number[]>)[colour] : undefined;
    return offsets ? [{ source: sourceHsv(z.source), range: z.range, offsets }] : [];
  });
  if (zations.length && part.width && part.height) {
    const data = pc.getImageData(0, 0, part.width, part.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const hsv = recolour(toHsv(px[i], px[i + 1], px[i + 2]), zations);
      if (hsv) [px[i], px[i + 1], px[i + 2]] = toRgb(hsv);
    }
    pc.putImageData(data, 0, 0);
  }
  return part;
}
