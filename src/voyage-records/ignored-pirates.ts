import pirates from './ignored-pirates.json';

/** Shared exclusions for records, in addition to each player's personal ignore list. */
export const ignoredPirates: string[] = pirates;
const names = new Set(ignoredPirates.map((pirate) => pirate.toLowerCase()));

export function hasIgnoredPirate(pirates: string[] = []): boolean {
  return pirates.some((pirate) => names.has(pirate.trim().toLowerCase()));
}
