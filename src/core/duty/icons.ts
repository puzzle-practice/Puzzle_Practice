// Small pictures for what a session cleared, by name, so saved reports keep working when the
// art's file names change. Forage, Treasure Haul and Carpentry use the duty report's own 12x12
// tiles (cursed isle containers, haunted and vampirate chests, coffins); the other puzzles use a
// frame of their own piece art.
import chests from './media/chests.png?url';
import cursedChests from './media/cursed_chests.png?url';
import hauntedChests from './media/haunted_chests.png?url';
import vampirateChests from './media/vampirate_chests.png?url';
import werewolfChests from './media/werewolf_chests.png?url';
import coffins from './media/vampirate_patches.png?url';
import moons from './media/werewolf_moons.png?url';
import moonStars from './media/werewolf_moons_stars.png?url';
import puzzles from './media/puzzles.png?url';
import haulCoin from '../../puzzles/treasure-haul/media/minipiece0.png?url';
import haulRuby from '../../puzzles/treasure-haul/media/minipiece4.png?url';
import haulEmerald from '../../puzzles/treasure-haul/media/minipiece5.png?url';
import swordRed from '../../puzzles/swordfight/media/piece_swords_red.png?url';
import swordGreen from '../../puzzles/swordfight/media/piece_swords_green.png?url';
import swordBlue from '../../puzzles/swordfight/media/piece_swords_blue.png?url';
import swordYellow from '../../puzzles/swordfight/media/piece_swords_yellow.png?url';
import swordStrike from '../../puzzles/swordfight/media/piece_swords_strike.png?url';
import brewWhite from '../../puzzles/distilling/media/piece_white.png?url';
import brewMid from '../../puzzles/distilling/media/piece_mid.png?url';
import brewDark from '../../puzzles/distilling/media/piece_dark.png?url';
import brewSpice from '../../puzzles/distilling/media/piece_spice.png?url';
import carpStars from '../../puzzles/vampire-carp/media/stars.png?url';
import cannonball from './media/cannonball.png?url';
import smithBonus from '../../puzzles/blacksmithing/media/bonus.png?url';
import smithTally from '../../puzzles/blacksmithing/media/tally.png?url';
import smithPerfect from '../../puzzles/swordfight/media/swords/sword11.png?url';
import smithOneOff from '../../puzzles/swordfight/media/swords/sword1.png?url';
import smithFarOff from '../../puzzles/swordfight/media/swords/sword127.png?url';

export interface Icon {
  url: string;
  /** The frame in the image: x, y, width, height. */
  area: [number, number, number, number];
  /** Drawn this tall in a tally (the game's chest tiles are 12). */
  height: number;
  /** In a stack, every copy but the last of each group is drawn as this instead. */
  under?: Icon;
}

const frame = (url: string, w: number, h: number, index = 0, height = 12): Icon => ({ url, area: [index * w, 0, w, h], height });

export const ICONS: Record<string, Icon> = {
  'chest-small': frame(chests, 12, 12, 0),
  'chest-medium': frame(chests, 12, 12, 1),
  'chest-large': frame(chests, 12, 12, 2),
  // Cursed isle containers: bone box (1x1), fetish jar (2x2), cursed chest (3x2).
  'ci-bone-box': frame(cursedChests, 12, 12, 0),
  'ci-fetish-jar': frame(cursedChests, 12, 12, 1),
  'ci-cursed-chest': frame(cursedChests, 12, 12, 2),
  'haunted-chest-small': frame(hauntedChests, 12, 12, 0),
  'haunted-chest-medium': frame(hauntedChests, 12, 12, 1),
  'haunted-chest-large': frame(hauntedChests, 12, 12, 2),
  'vampirate-chest-small': frame(vampirateChests, 12, 12, 0),
  'vampirate-chest-medium': frame(vampirateChests, 12, 12, 1),
  'vampirate-chest-large': frame(vampirateChests, 12, 12, 2),
  'werewolf-chest-small': frame(werewolfChests, 12, 12, 0),
  'werewolf-chest-medium': frame(werewolfChests, 12, 12, 1),
  'werewolf-chest-large': frame(werewolfChests, 12, 12, 2),
  'haunted-chest': frame(hauntedChests, 12, 12, 2),
  'vampirate-chest': frame(vampirateChests, 12, 12, 2),
  // Coffins Boarded Up, worst to best.
  'coffin-slipshod': frame(coffins, 12, 12, 0),
  'coffin-creaky': frame(coffins, 12, 12, 1),
  'coffin-vampire-proof': frame(coffins, 12, 12, 2),
  // Constellations Charted (Werewolf Isle navigation): the longer the chain, the fuller the moon.
  'moon-crescent': frame(moons, 12, 12, 0),
  'moon-half': frame(moons, 12, 12, 1),
  'moon-full': frame(moons, 12, 12, 2),
  // Past a triple, a full moon with a black plus per step: bingo, donkey, vegas, then a 7-chain.
  // Only the front moon of a stack shows its pluses; the ones behind are plain full moons.
  'moon-bingo': { ...frame(moonStars, 12, 12, 0), under: frame(moons, 12, 12, 2) },
  'moon-donkey': { ...frame(moonStars, 12, 12, 1), under: frame(moons, 12, 12, 2) },
  'moon-vegas': { ...frame(moonStars, 12, 12, 2), under: frame(moons, 12, 12, 2) },
  'moon-seven': { ...frame(moonStars, 12, 12, 3), under: frame(moons, 12, 12, 2) },
  'haul-coin': frame(haulCoin, 23, 23, 0, 14),
  'haul-ruby': frame(haulRuby, 16, 23, 0, 14),
  'haul-emerald': frame(haulEmerald, 16, 23, 0, 14),
  'sword-red': frame(swordRed, 27, 40, 0, 14),
  'sword-green': frame(swordGreen, 27, 40, 0, 14),
  'sword-blue': frame(swordBlue, 27, 40, 0, 14),
  'sword-yellow': frame(swordYellow, 27, 40, 0, 14),
  'sword-strike': frame(swordStrike, 27, 40, 0, 14),
  'brew-white': frame(brewWhite, 40, 40, 0, 14),
  'brew-mid': frame(brewMid, 40, 40, 0, 14),
  'brew-dark': frame(brewDark, 40, 40, 0, 14),
  'brew-spice': frame(brewSpice, 40, 40, 0, 14),
  // Distilling's columns as they went up: one orb each.
  'orb-clear': frame(brewWhite, 40, 40, 0, 10),
  'orb-spicy': frame(brewSpice, 40, 40, 0, 10),
  'orb-bad': frame(brewMid, 40, 40, 0, 10),
  'carp-slipshod': frame(carpStars, 21, 21, 0, 14),
  'carp-creaky': frame(carpStars, 21, 21, 1, 14),
  'carp-vampire-proof': frame(carpStars, 21, 21, 2, 14),
  'smith-number-set': frame(smithBonus, 42, 42, 0, 16),
  'smith-ordered-set': frame(smithBonus, 42, 42, 1, 16),
  'smith-chess-set': frame(smithBonus, 42, 42, 4, 16),
  'smith-chain2': frame(smithTally, 50, 46, 1, 16),
  'smith-chain3': frame(smithTally, 50, 46, 2, 16),
  'smith-chain4': frame(smithTally, 50, 46, 3, 16),
  'smith-chain5': frame(smithTally, 50, 46, 4, 16),
  'smith-chain6': frame(smithTally, 50, 46, 4, 16),
  // Perfect, one off, too far off: Falchion, short sword and stick, from the game's sword icons.
  'smith-perfect': frame(smithPerfect, 30, 58, 0, 30),
  'smith-one-off': frame(smithOneOff, 30, 58, 0, 30),
  'smith-far-off': frame(smithFarOff, 30, 58, 0, 30),
  // The duty report's own 10px cannonball, rather than a scaled puzzle piece.
  cannonball: frame(cannonball, 10, 10, 0, 10),
};

/** The game's puzzle icons (24x24), for the station heading. */
const STATION_ICON: Record<string, number> = { swordfight: 0, 'vampire-carp': 3, gunning: 4, navigation: 5, 'treasure-haul': 10, forage: 14 };

export function stationIcon(puzzle: string): Icon | null {
  const index = STATION_ICON[puzzle];
  return index === undefined ? null : frame(puzzles, 24, 24, index, 24);
}

const images = new Map<string, Promise<HTMLImageElement | null>>();

export function loadIcon(url: string): Promise<HTMLImageElement | null> {
  let loading = images.get(url);
  if (!loading) {
    loading = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    images.set(url, loading);
  }
  return loading;
}

/** An icon's width when drawn at its tally height. */
export const iconWidth = (icon: Icon) => Math.max(1, Math.round((icon.area[2] * icon.height) / icon.area[3]));
