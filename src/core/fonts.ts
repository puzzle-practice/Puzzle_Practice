// Fonts shared by every puzzle.
import type { FontSpec } from './screen';
import freeSansBoldUrl from './fonts/freesansbold.ttf?url';

const loaded = new Map<string, Promise<void>>();

/** Loads a font file once and registers it under `family`. */
export function loadFont(family: string, url: string): Promise<void> {
  let promise = loaded.get(family);
  if (!promise) {
    const face = new FontFace(family, `url(${url})`);
    promise = face.load().then((f) => {
      document.fonts.add(f);
    });
    loaded.set(family, promise);
  }
  return promise;
}

const UI_FONT = 'Puzzle UI';

/** The shared UI font, scaled to the puzzle artwork with its matching baseline. */
export function uiFont(size: number): FontSpec {
  const px = Math.floor(size * 0.6875);
  return { family: UI_FONT, px, ascent: Math.ceil(px * 0.8) };
}

export function loadUiFont(): Promise<void> {
  return loadFont(UI_FONT, freeSansBoldUrl);
}
