// How often each pirate falls per fray, in Woodhallow dens and Vampire Lairs. The page that shows
// these is only reached by its own address (#/death-rates), with no links to it.
import type { ExpeditionId, Run } from './records';

/** Voyages with fewer pirates than this are left out of death rates. */
export const DEATH_RATE_MIN_CREW = 4;

/** The voyages death rates cover. */
export const DEATH_RATE_VOYAGES: ExpeditionId[] = ['woodhallow', 'vampireLairs'];

export interface DeathRate {
  pirate: string;
  /** Voyages counted for this pirate. */
  voyages: number;
  /** Frays counted for this pirate: won frays they fought, and lost frays they fell early in. */
  frays: number;
  /** Of those frays, how many the pirate was eliminated in. */
  died: number;
  /** Deaths per fray counted. */
  rate: number;
}

/**
 * Death rates for one kind of voyage, from voyages with a known crew of at least DEATH_RATE_MIN_CREW.
 * Won frays count for everyone who fought them. A lost fray counts, as one fray and one death, only
 * for pirates who fell early in it (two minutes in Woodhallow, one in Vampire Lairs), since the whole
 * crew falls by the end of a loss. Woodhallow leaves out each den's first fray; Vampire Lairs count
 * every fray. Most frays first, then highest rate, then name.
 */
export function deathRates(runs: Iterable<Run>, expedition: ExpeditionId): DeathRate[] {
  const rates = new Map<string, DeathRate>();
  const rateFor = (pirate: string) => {
    const key = pirate.toLowerCase();
    let rate = rates.get(key);
    if (!rate) {
      rate = { pirate, voyages: 0, frays: 0, died: 0, rate: 0 };
      rates.set(key, rate);
    }
    return rate;
  };
  for (const run of runs) {
    if (run.expedition !== expedition || run.crewSize === null || run.crewSize < DEATH_RATE_MIN_CREW) continue;
    const sailed = new Set<string>();
    for (const fray of run.frays) {
      if (fray.result === null || (expedition === 'woodhallow' && fray.number === 1)) continue;
      const fought = new Map((fray.crew ?? run.players).map(name => [name.toLowerCase(), name]));
      const deaths = new Set((fray.result === 'Won' ? fray.deaths : fray.earlyDeaths ?? []).map(name => name.toLowerCase()));
      for (const [key, name] of fought) {
        sailed.add(name);
        const died = deaths.has(key);
        if (fray.result !== 'Won' && !died) continue;
        const rate = rateFor(name);
        rate.frays++;
        if (died) rate.died++;
      }
    }
    for (const pirate of run.players) sailed.add(pirate);
    const counted = new Set<string>();
    for (const pirate of sailed) {
      const key = pirate.toLowerCase();
      if (counted.has(key)) continue;
      counted.add(key);
      rateFor(pirate).voyages++;
    }
  }
  return [...rates.values()]
    .filter(rate => rate.frays > 0)
    .map(rate => ({ ...rate, rate: rate.died / rate.frays }))
    .sort((a, b) => b.frays - a.frays || b.rate - a.rate || a.pirate.localeCompare(b.pirate));
}

export type DeathRateColumn = 'pirate' | 'voyages' | 'frays' | 'died' | 'rate';

/**
 * Death rates sorted by one column, names A–Z or numbers low first unless descending.
 * Ties fall back to most frays, then name.
 */
export function sortDeathRates(rates: readonly DeathRate[], key: DeathRateColumn, descending: boolean): DeathRate[] {
  return [...rates].sort((a, b) => {
    const order = key === 'pirate' ? a.pirate.localeCompare(b.pirate) : a[key] - b[key];
    return (descending ? -order : order) || b.frays - a.frays || a.pirate.localeCompare(b.pirate);
  });
}

/** The log date of a voyage, YYYY-MM-DD, as the chatlog's day header gives it; null when undated. */
export function voyageDay(run: Run): string | null {
  return run.startedAt === null ? null : new Date(run.startedAt).toISOString().slice(0, 10);
}

/**
 * Whether a voyage started between two log dates (YYYY-MM-DD), both days included. An empty bound
 * is open. Undated voyages only pass when neither bound is set.
 */
export function inDateRange(run: Run, from: string, to: string): boolean {
  if (!from && !to) return true;
  const day = voyageDay(run);
  return day !== null && (!from || day >= from) && (!to || day <= to);
}
