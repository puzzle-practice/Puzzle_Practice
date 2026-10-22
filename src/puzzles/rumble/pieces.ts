// Rumble's balls, encoded as numbers: bit 0 is set on every ball,
// bits 1-3 are the colour, bit 4 marks a ball still arriving, and bits 5-7 its state.
//   colours: 0 red, 1 yellow, 2 orange, 3 cyan, 4 blue, 5 brown furball (Werewolf rumbling)

export const EMPTY = 0;
/** A cell inside the damage rows at the top of a board. */
export const BLOCKED = -268435457;

export const RED = 0;
export const YELLOW = 1;
export const ORANGE = 2;
export const CYAN = 3;
export const BLUE = 4;
export const FURBALL = 5;
export const COLOUR_NAMES = ['red', 'yellow', 'orange', 'cyan', 'blue', 'brown'] as const;

const STATE = 224;
const CHARGED = 64;
const DARK = 96;
const LIGHT = 128;
const ARRIVING = 16;

export const ball = (colour: number): number => 1 + (colour << 1);
export const colourOf = (piece: number): number => (piece & 14) >> 1;
export const isBall = (piece: number): boolean => piece !== EMPTY && piece !== BLOCKED;

/** A charged ball: in flight or primed as a spark on the board. */
export const isCharged = (piece: number): boolean => (piece & STATE) === CHARGED;
/** A dark bruise: never matches; a pop next to it lightens it. */
export const isDark = (piece: number): boolean => (piece & STATE) === DARK;
/** A light bruise: one more pop next to it and it's an ordinary ball again. */
export const isLight = (piece: number): boolean => (piece & STATE) === LIGHT;
export const isBruise = (piece: number): boolean => isDark(piece) || isLight(piece);
export const isArriving = (piece: number): boolean => (piece & ARRIVING) > 0;

function withState(piece: number, state: number): number {
  return piece === EMPTY || piece === BLOCKED ? piece : (piece & ~STATE) | state;
}

export const plain = (piece: number): number => withState(piece, 0);
export const charged = (piece: number): number => withState(piece, CHARGED);
export const dark = (piece: number): number => withState(piece, DARK);
export const light = (piece: number): number => withState(piece, LIGHT);
export const settled = (piece: number): number => (piece === EMPTY || piece === BLOCKED ? piece : piece & ~ARRIVING);

/**
 * A bludgeon pattern cell as a ball: -1 is a hole, units are the colour, 10s are
 * charged balls (the Fish) and 20s bruises.
 */
export function patternBall(cell: number): number {
  if (cell === -1) return EMPTY;
  const piece = ball(cell % 10);
  switch (Math.floor(cell / 10)) {
    case 1: return charged(piece);
    case 2: return dark(piece);
    default: return piece;
  }
}
