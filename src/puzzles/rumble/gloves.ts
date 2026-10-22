// Bludgeons (item/data/Glove): each has a nine-wide pattern whose bottom two rows are its
// sprinkle and the rest its punch. The colour byte permutes the five ball colours and, when odd,
// mirrors the pattern.
import { patternBall } from './pieces';

const FISTS = [
  [4, 4, 3, 3, 3, 1, 1, 0, 0],
  [4, 4, 3, 3, 3, 1, 1, 0, 0],
  [3, 3, 4, 4, 0, 0, 0, 1, 1],
  [3, 3, 4, 4, 0, 0, 0, 1, 1],
  [0, 0, 0, 1, 1, 1, 2, 2, 2],
  [0, 0, 0, 3, 1, 3, 2, 2, 2],
];
const HAMMER = [
  [3, 3, 3, 1, 1, 1, 0, 0, 0],
  [3, 21, 21, 1, 23, 1, 21, 0, 0],
  [3, 21, 21, 1, 4, 4, 24, 0, 0],
  [3, 3, 3, 1, 1, 1, 0, 0, 0],
  [4, 4, 4, 1, 1, 1, 2, 2, 0],
  [0, 4, 0, 1, 1, 1, 0, 2, 0],
];
const BLACKJACK = [
  [2, 0, 0, 0, 1, 1, 1, 1, 3],
  [2, 20, 20, 1, 1, 1, 1, 2, 2],
  [2, 2, 2, 1, 20, 1, 3, 2, 1],
  [0, 0, 2, 1, 1, 3, 3, 2, 1],
  [0, 0, 2, 1, 3, 3, 4, 0, 0],
  [3, 3, 2, 3, 3, 4, 0, 0, 0],
  [1, 1, 3, 3, 3, 2, 2, 2, 2],
  [1, 1, 3, 4, 3, 3, 2, 0, 2],
];
const BELAYING_PIN = [
  [1, 1, 4, 4, 0, 1, 3, 4, 4],
  [2, 2, 2, 2, 0, 1, 3, 4, 4],
  [2, 2, 3, 3, 0, 1, 3, 3, 4],
  [4, 4, 4, 4, 0, 1, 3, 3, 4],
  [2, 2, 0, 0, 0, 1, 1, 3, 4],
  [2, 2, 3, 3, 0, 0, 4, 4, 4],
  [2, 3, 3, 0, 0, 0, 4, 4, 4],
];
const GAUNTLETS = [
  [2, 4, 4, 0, 3, 0, 1, 1, 2],
  [0, 2, 2, 0, 0, 3, 2, 2, 0],
  [0, 2, 2, 3, 0, 0, 2, 2, 0],
  [1, 0, 0, 0, 3, 0, 0, 0, 4],
  [1, 1, 3, 3, 3, 3, 3, 4, 4],
  [1, 1, 1, 3, 3, 3, 4, 4, 4],
  [2, 1, 1, 3, 3, 3, 4, 4, 2],
  [2, 1, 1, 0, 0, 0, 4, 4, 2],
];
const SKULL_RINGS = [
  [1, 21, 3, 0, 0, 0, 2, 4, 24],
  [1, 1, 3, 3, 20, 2, 2, 4, 4],
  [1, 3, 3, 0, 0, 0, 2, 2, 4],
  [1, 1, 22, 2, 0, 3, 3, 4, 4],
  [1, 2, 2, 0, 0, 0, 23, 3, 4],
  [1, 1, 3, 3, 3, 3, 3, 4, 4],
  [2, 1, 1, 3, 2, 3, 4, 4, 2],
];
const ROPE_COILS = [
  [1, 1, 2, 2, 3, 2, 2, 1, 1],
  [2, 2, 3, 3, 4, 3, 3, 2, 2],
  [2, 2, 3, 3, 4, 3, 3, 2, 2],
  [3, 3, 4, 4, 0, 4, 4, 3, 3],
  [3, 3, 4, 4, 0, 4, 4, 3, 3],
  [4, 4, 3, 3, 3, 2, 2, 4, 4],
  [4, 4, 3, 3, 2, 2, 2, 4, 4],
];
const BONE = [
  [4, 1, 1, 0, 0, 2, 2, 1, 1],
  [1, 4, 4, 0, 2, 2, 1, 3, 3],
  [1, 0, 0, 4, 4, 1, 1, 3, 3],
  [0, 0, 2, 2, 1, 4, 4, 0, 0],
  [0, 0, 2, 2, 1, 1, 0, 4, 4],
  [0, 0, 2, 2, 1, 1, 0, 3, 4],
];
const CHAIN = [
  [0, 0, 0, 4, 4, 4, 2, 2, 2],
  [0, 0, 3, 3, 3, 3, 2, 2, 2],
  [3, 3, 3, 4, 4, 3, 2, 3, 3],
  [0, 0, 0, 4, 4, 3, 3, 3, 2],
  [1, 0, 0, 1, 1, 1, 2, 2, 2],
  [1, 1, 0, 1, 2, 1, 2, 2, 0],
];
const GAFF = [
  [4, 4, 3, 3, 3, 1, 1, 0, 0],
  [4, 4, 3, 3, 3, 1, 1, 0, 0],
  [3, 3, 4, 4, 0, 0, 0, 1, 1],
  [3, 3, 4, 4, 0, 0, 3, 1, 1],
  [0, 0, 0, 1, 1, 1, 3, 2, 2],
  [0, 0, 0, 1, 1, 1, 3, 3, 2],
];

/** Patterns by bludgeon type, top row first. */
const PATTERNS: number[][][] = [
  [
    [4, 4, 2, 2, 0, 3, 3, 1, 1],
    [1, 2, 2, 0, 0, 0, 3, 3, 4],
    [1, 1, 1, 0, 0, 0, 4, 4, 4],
    [1, 2, 2, 0, 0, 0, 3, 3, 4],
    [1, 1, 3, 3, 0, 2, 2, 4, 4],
    [1, 1, 3, 3, 0, 2, 2, 4, 4],
  ],
  SKULL_RINGS,
  [
    [2, 4, 4, 4, 4, 4, 4, 4, 1],
    [2, 2, 2, 2, 4, 1, 1, 1, 1],
    [3, 3, 3, 2, 4, 1, 0, 0, 0],
    [3, 3, 1, 1, 1, 0, 0, 0, 0],
    [0, 0, 0, 2, 2, 2, 4, 4, 4],
    [0, 0, 2, 2, 1, 2, 2, 4, 4],
  ],
  GAUNTLETS,
  CHAIN,
  [
    [1, 1, 1, 3, 3, 4, 0, 0, 0],
    [1, 2, 2, 4, 4, 4, 0, 1, 1],
    [1, 2, 2, 3, 4, 4, 0, 1, 1],
    [1, 1, 2, 3, 3, 3, 0, 0, 1],
    [1, 1, 3, 3, 3, 4, 0, 0, 0],
    [1, 1, 3, 3, 3, 4, 0, 0, 0],
  ],
  ROPE_COILS,
  BLACKJACK,
  GAFF,
  BELAYING_PIN,
  [
    [0, 0, 4, 4, 4, 4, 4, 0, 0],
    [0, 11, 1, 2, -1, 2, 3, 13, 0],
    [0, 1, 1, 2, 2, 2, 3, 3, 0],
    [0, 0, 4, 4, 4, 4, 4, 0, 0],
    [0, 0, 4, 4, 2, 4, 4, 0, 0],
    [0, 0, 4, 4, 2, 4, 4, 0, 0],
    [0, 0, 4, 4, 2, 4, 4, 0, 0],
  ],
  [
    [1, 1, 1, 3, 3, 4, 2, 2, 2],
    [1, -1, 1, 3, 4, 4, 2, -1, 2],
    [2, 2, 2, 4, 4, 0, 1, 1, 1],
    [2, -1, 2, 4, 0, 0, 1, -1, 1],
    [1, 1, 1, 3, 3, 3, 2, 2, 0],
    [1, 1, 1, 3, 3, 3, 2, 0, 0],
  ],
  HAMMER,
  BONE,
  HAMMER,
  BLACKJACK,
  GAUNTLETS,
  SKULL_RINGS,
  ROPE_COILS,
  HAMMER,
  FISTS,
  BONE,
  CHAIN,
  BELAYING_PIN,
  Array.from({ length: 6 }, () => Array<number>(9).fill(5)),
];

export const FISTS_TYPE = 127;
export const HOOK_TYPE = 126;
export const WEREWOLF_TYPE = 24;

/** Bludgeon names. */
export const GLOVE_NAMES: Record<number, string> = {
  0: 'Brass knuckles', 1: 'Skull rings', 2: 'Leather gloves', 3: 'Gauntlets', 4: 'Chain', 5: 'Cane',
  6: 'Rope coils', 7: 'Blackjack', 8: 'Gaff', 9: 'Belaying pin', 10: 'Fish', 11: 'Broken bottle',
  12: 'Hammer', 13: 'Skeleton bone', 14: 'War hammer', 15: 'Banana', 16: 'Coconuts', 17: 'Limes',
  18: 'Mango', 19: 'Pineapple', 20: 'Monkey fists', 21: 'Skull club', 22: "Dragon's fist", 23: 'Shovel',
  24: 'Werewolf claws', 126: 'Hook', 127: 'Bare fists',
};

/** Bludgeons a pirate can own, then the bone, the event ones, the hook and bare fists. */
export const BLUDGEONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 23, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 126, 127];
/** What brigands and other NPPs fight with. */
export const NPP_BLUDGEONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 127];

/** The colour byte as a permutation of the five colours. */
export function colourMapping(colours: number): number[] {
  const left = [0, 1, 2, 3, 4];
  const take = (i: number) => left.splice(i, 1)[0];
  let c = colours;
  const map = [0, 0, 0, 0, 0];
  map[0] = take(c % 5);
  c = Math.floor(c / 5);
  map[1] = take(c % 4);
  c = Math.floor(c / 4);
  map[2] = take(c % 3);
  c = Math.floor(c / 3);
  map[3] = take(c % 2);
  map[4] = left[0];
  return map;
}

export class Glove {
  /** Pattern rows bottom first, recoloured and mirrored: rows 0 and 1 are the sprinkle, 2 up the punch. */
  private readonly shaft: number[][];

  constructor(readonly type: number, readonly colours = 0) {
    let pattern: number[][];
    let c = colours & 0xff;
    if (type === FISTS_TYPE) {
      pattern = FISTS;
      c = 0;
    } else if (type === HOOK_TYPE) {
      pattern = PATTERNS[8];
      c = 0;
    } else {
      pattern = PATTERNS[type] ?? FISTS;
    }
    const mirror = c % 2 === 1;
    const map = colourMapping(c);
    this.shaft = pattern.map((_, i) => {
      const row = pattern[pattern.length - i - 1];
      return Array.from({ length: 9 }, (__, x) => {
        const cell = row[mirror ? 8 - x : x];
        if (cell === -1) return -1;
        const unit = cell % 10;
        return map[unit] + (cell - unit);
      });
    });
  }

  get name(): string {
    return GLOVE_NAMES[this.type] ?? 'Bludgeon';
  }

  /** Rows in the punch part of the pattern. */
  get height(): number {
    return this.shaft.length - 2;
  }

  /**
   * The pattern cell for column x, row y of a punch (y from its far end) or a sprinkle; punches
   * longer than the pattern repeat its last (up to) four rows.
   */
  cell(x: number, y: number, strike: boolean): number {
    y = Math.abs(y);
    const h = this.height;
    if (!strike) return this.shaft[(y + 1) % 2][x];
    if (y < h) return this.shaft[y + 2][x];
    const wrap = Math.min(h, 4);
    return this.shaft[(y - h) % wrap + Math.max(h - wrap, 0) + 2][x];
  }

  piece(x: number, y: number, strike: boolean): number {
    return patternBall(this.cell(x, y, strike));
  }
}
