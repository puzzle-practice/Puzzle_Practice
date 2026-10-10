// The player's pirate face, put together the way the game builds its 58x58 face icons: a head
// with the rating's expression, then beard, eyepatch, hair and hat (the face classes' render
// order), each layer at its offset in the frame and recoloured with the game's colourisations.
import { coloursOf, paintLayer, type Zation } from './paint';
import { MOODS, type Mood } from './ratings';

export const FACE = 58;

/** What the player picks on the Settings tab. Empty strings mean none. */
export interface FaceSpec {
  female: boolean;
  skin: string;
  hair: string;
  hairColour: string;
  beard: string;
  eyepatch: boolean;
  hat: string;
  hatColour: string;
  trimColour: string;
}

/** Where each exported layer sits in the 58x58 frame (its trimmed tile's offset). */
const AT: Record<string, [number, number]> = {
  'fmale-head': [14, 19], 'fmale-eyepatch': [17, 25],
  'fmale-hair-dreadlocks': [14, 17], 'fmale-hair-messy_short': [15, 15], 'fmale-hair-ponytail': [16, 16],
  'fmale-hair-princevaliant': [13, 16], 'fmale-hair-spiky': [13, 10], 'fmale-hair-swept_forward': [15, 14],
  'fmale-facialhair-beard_long': [15, 29], 'fmale-facialhair-beard_short': [16, 32], 'fmale-facialhair-braided_goatee': [23, 33],
  'fmale-facialhair-dastardly_stache': [18, 26], 'fmale-facialhair-goatee': [23, 33],
  'fmale-facialhair-handlebar_moustache': [20, 32], 'fmale-facialhair-mutton_chops': [16, 29],
  'fmale-hat-bandana': [16, 13], 'fmale-hat-tricorne': [3, 13], 'fmale-hat-captains': [1, 3], 'fmale-hat-captains_bandana': [1, 3],
  'fmale-hat-feathered': [14, 0], 'fmale-hat-fez': [20, 9], 'fmale-hat-sleepinghat': [15, 9], 'fmale-hat-savvy': [9, 6],
  'fmale-hat-turban': [13, 0], 'fmale-hat-top_hat': [11, 1], 'fmale-hat-picaroon_hat': [1, 2], 'fmale-hat-wizard_hat': [7, 0],
  'fmale-hat-santa': [14, 13], 'fmale-hat-buccaneer': [9, 5], 'fmale-hat-cockade': [0, 9], 'fmale-hat-brigand': [1, 1],
  'fmale-hat-musketeer': [8, 6], 'fmale-hat-crown': [12, 0], 'fmale-hat-rogue_hat': [1, 5],
  'ffemale-head': [16, 18], 'ffemale-eyepatch': [17, 22],
  'ffemale-hair-bob': [14, 14], 'ffemale-hair-curls_medium': [11, 14], 'ffemale-hair-curly_long': [11, 16],
  'ffemale-hair-messy_short': [15, 15], 'ffemale-hair-pigtails': [9, 16], 'ffemale-hair-ponytail': [9, 14],
  'ffemale-hair-princessleia': [11, 17], 'ffemale-hair-spiky': [13, 9], 'ffemale-hair-straight_long': [10, 15],
  'ffemale-hair-up_do': [13, 13],
  'ffemale-facialhair-beard_long': [15, 29], 'ffemale-facialhair-dastardly_stache': [18, 25],
  'ffemale-hat-bandana': [15, 13], 'ffemale-hat-tricorne': [7, 7], 'ffemale-hat-captains': [2, 3], 'ffemale-hat-captains_bandana': [2, 3],
  'ffemale-hat-feathered_small': [7, 3], 'ffemale-hat-sleepinghat': [15, 9], 'ffemale-hat-savvy': [9, 6], 'ffemale-hat-turban': [16, 9],
  'ffemale-hat-top_hat': [11, 0], 'ffemale-hat-picaroon_hat': [4, 3], 'ffemale-hat-wizard_hat': [9, 0], 'ffemale-hat-santa': [14, 11],
  'ffemale-hat-buccaneer': [9, 5], 'ffemale-hat-cockade': [2, 7], 'ffemale-hat-brigand': [4, 1], 'ffemale-hat-widebrimmed': [7, 1],
  'ffemale-hat-tiara': [11, 0], 'ffemale-hat-headwrap': [13, 6], 'ffemale-hat-rogue_hat': [3, 5],
};

const prefix = (female: boolean) => (female ? 'ffemale' : 'fmale');
const partsOf = (female: boolean, part: string) => Object.keys(AT)
  .filter((name) => name.startsWith(`${prefix(female)}-${part}-`))
  .map((name) => name.slice(prefix(female).length + part.length + 2));

/** The choices for each part, for a man or a woman. */
export function faceOptions(female: boolean) {
  return {
    hair: partsOf(female, 'hair'),
    beard: partsOf(female, 'facialhair'),
    hat: partsOf(female, 'hat'),
    skin: coloursOf('skin'),
    hairColour: coloursOf('hair'),
    cloth: coloursOf('textile_p'),
    trimCloth: coloursOf('textile_s'),
  };
}

export const DEFAULT_FACE: FaceSpec = {
  female: false, skin: 'medium', hair: 'messy_short', hairColour: 'darkBrown', beard: 'handlebar_moustache', eyepatch: true,
  hat: '', hatColour: 'red', trimColour: 'gold',
};

/** A face with every part one the game has, falling back to the defaults part by part. */
export function sanitizeFace(value: unknown): FaceSpec {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof FaceSpec, unknown>>;
  const female = v.female === true;
  const options = faceOptions(female);
  const one = (x: unknown, list: string[], fallback: string, none = false) =>
    typeof x === 'string' && (list.includes(x) || (none && x === '')) ? x : fallback;
  const fallbackHair = options.hair.includes(DEFAULT_FACE.hair) ? DEFAULT_FACE.hair : options.hair[0];
  return {
    female,
    skin: one(v.skin, options.skin, DEFAULT_FACE.skin),
    hair: one(v.hair, options.hair, fallbackHair, true),
    hairColour: one(v.hairColour, options.hairColour, DEFAULT_FACE.hairColour),
    beard: one(v.beard, options.beard, options.beard.includes(DEFAULT_FACE.beard) ? DEFAULT_FACE.beard : '', true),
    eyepatch: typeof v.eyepatch === 'boolean' ? v.eyepatch : DEFAULT_FACE.eyepatch,
    hat: one(v.hat, options.hat, options.hat.includes(DEFAULT_FACE.hat) ? DEFAULT_FACE.hat : '', true),
    hatColour: one(v.hatColour, options.cloth, DEFAULT_FACE.hatColour),
    trimColour: one(v.trimColour, options.trimCloth, DEFAULT_FACE.trimColour),
  };
}

/** The layers a face is drawn from, bottom to top, with the colour classes each one takes. */
export function faceLayers(face: FaceSpec, mood: Mood): Array<{ image: string; at: [number, number]; classes: Zation[] }> {
  const g = prefix(face.female);
  const layers: Array<{ image: string; key: string; classes: Zation[] }> = [
    { image: `${g}-head-${mood}`, key: `${g}-head`, classes: face.female ? ['skin'] : ['skin', 'hair'] },
  ];
  // Facial hair is coloured with the head's colours, as the game does.
  if (face.beard) layers.push({ image: `${g}-facialhair-${face.beard}`, key: `${g}-facialhair-${face.beard}`, classes: ['skin', 'hair'] });
  if (face.eyepatch) layers.push({ image: `${g}-eyepatch`, key: `${g}-eyepatch`, classes: ['textile_p'] });
  if (face.hair) layers.push({ image: `${g}-hair-${face.hair}`, key: `${g}-hair-${face.hair}`, classes: ['hair'] });
  if (face.hat) layers.push({ image: `${g}-hat-${face.hat}`, key: `${g}-hat-${face.hat}`, classes: ['textile_p', 'textile_s'] });
  return layers.filter((l) => AT[l.key]).map((l) => ({ image: l.image, at: AT[l.key], classes: l.classes }));
}

const urls = import.meta.glob<string>('./media/faces/*.png', { eager: true, query: '?url', import: 'default' });
const images = new Map<string, Promise<HTMLImageElement | null>>();

function image(name: string): Promise<HTMLImageElement | null> {
  let loading = images.get(name);
  if (!loading) {
    const url = urls[`./media/faces/${name}.png`];
    loading = url ? new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    }) : Promise.resolve(null);
    images.set(name, loading);
  }
  return loading;
}

/** Draws a face with a mood onto a 58x58 canvas (cleared first), once its layers have loaded. */
export async function drawFaceInto(canvas: HTMLCanvasElement, face: FaceSpec, mood: Mood = 'normal'): Promise<void> {
  const layers = faceLayers(face, MOODS.includes(mood) ? mood : 'normal');
  const loaded = await Promise.all(layers.map((l) => image(l.image)));
  canvas.width = FACE;
  canvas.height = FACE;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, FACE, FACE);
  const colours: Partial<Record<Zation, string>> = {
    skin: face.skin, hair: face.hairColour, textile_p: face.hatColour, textile_s: face.trimColour,
  };
  layers.forEach((layer, i) => {
    const img = loaded[i];
    if (img) ctx.drawImage(paintLayer(img, layer.classes, colours), layer.at[0], layer.at[1]);
  });
}
