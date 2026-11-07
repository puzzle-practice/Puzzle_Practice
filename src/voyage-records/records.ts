// Personal Woodhallow, Cursed Isles and Vampire Lairs records from Puzzle Pirates chatlogs.
import { arrivals, chatEvents, type ChatEvent, type ExpeditionId, type RunDetails } from './chat';
import { parseIslesOrLair } from './isles-and-lairs';
import { parseWoodhallow } from './woodhallow';

export type { ExpeditionId, Fray, RunResult } from './chat';

export interface Expedition {
  name: string;
  /** Tier 3 to tier 1. */
  chests: [string, string, string];
}

export const expeditions: Record<ExpeditionId, Expedition> = {
  woodhallow: { name: 'Woodhallow', chests: ['Dire chest', 'Lunar locker', 'Wolf box'] },
  cursedIsles: { name: 'Cursed Isles', chests: ['Cursed chest', 'Fetish jar', 'Bone box'] },
  vampireLairs: { name: 'Vampire Lairs', chests: ['Immortal chest', 'Nocturnal locker', 'Blood box'] },
};

export interface Run extends RunDetails {
  expedition: ExpeditionId;
  ocean: string | null;
  startedAt: number | null;
  score: number;
}

export interface CrewRecord {
  expedition: ExpeditionId;
  ocean: string | null;
  crewSize: number;
  runs: number;
  totalTopTierAboard: number;
  maxChests: Run;
  maxScore: Run;
}

const activityByArrival = new Map(Object.entries(arrivals).map(([id, line]) => [line, id as ExpeditionId]));
const serverOcean = /^It is currently .+ on the (\w+) ocean\.$/i;
/** Only game ocean names count, so a file called my_log.txt doesn't read as the "log" ocean. */
const knownOceans = new Set(['cerulean', 'crimson', 'emerald', 'hunter', 'ice', 'jade', 'meridian', 'midnight', 'obsidian', 'opal', 'sage', 'viridian']);
/** Two logs show the same voyage this close together when both pirates were aboard. */
const sameVoyageMs = 10 * 60_000;

export function oceanFromFileName(name: string): string | null {
  const named = /^[^_]+_([a-z]+)(?:_|\.txt$|$)/i.exec(name)?.[1]?.toLowerCase();
  return named && knownOceans.has(named) ? named : null;
}

export async function parseChatlogFile(file: File, { ocean = null }: { ocean?: string | null } = {}): Promise<Run[]> {
  return parseExpeditionLog(await file.text(), { ocean: ocean ?? oceanFromFileName(file.name) });
}

export function parseExpeditionLog(text: string, { ocean = null }: { ocean?: string | null } = {}): Run[] {
  const sections: { expedition: ExpeditionId; startedAt: number | null; events: ChatEvent[] }[] = [];
  const oceans = new Set(ocean ? [ocean.toLowerCase()] : []);
  let section: (typeof sections)[number] | undefined;
  for (const event of chatEvents(text)) {
    const expedition = activityByArrival.get(event.message);
    const reportedOcean = serverOcean.exec(event.message)?.[1];
    if (reportedOcean) oceans.add(reportedOcean.toLowerCase());
    if (expedition) {
      section = { expedition, startedAt: event.at, events: [] };
      sections.push(section);
    } else if (section) {
      section.events.push(event);
    }
  }
  if (oceans.size > 1) throw new Error('The log contains more than one ocean or conflicts with the selected ocean.');
  const [scope = null] = oceans;
  return sections.flatMap(({ expedition, startedAt, events }) => {
    const run = expedition === 'woodhallow'
      ? parseWoodhallow(events)
      : parseIslesOrLair(events, expedition);
    if (!run) return [];
    const [tier3, tier2, tier1] = run.loot;
    // Vampire Lairs hauls count every chest the same.
    const score = expedition === 'vampireLairs' ? tier3 + tier2 + tier1 : 3 * tier3 + 2 * tier2 + tier1;
    return [{ expedition, ocean: scope, startedAt, ...run, score }];
  });
}

/**
 * Oldest first, each voyage once. The same voyage can arrive twice when a backup overlaps a log, or
 * when two of the player's pirates sailed together. Only a match from another log is a repeat: two
 * quick defeats with the same crew and no chests look alike but are separate voyages in one log.
 */
export function mergeRuns(logs: Run[][]): Run[] {
  const sorted = logs
    .flatMap((runs, log) => runs.map(run => ({ run, log })))
    .sort((a, b) => (a.run.startedAt ?? Infinity) - (b.run.startedAt ?? Infinity));
  const kept = new Map<string, { at: number; log: number }[]>();
  return sorted.filter(({ run, log }) => {
    const at = run.startedAt;
    if (at === null) return true;
    const key = JSON.stringify([run.expedition, run.ocean, run.players, run.loot]);
    const matches = kept.get(key) ?? [];
    if (matches.some(match => match.log !== log && at - match.at <= sameVoyageMs)) return false;
    kept.set(key, [...matches, { at, log }]);
    return true;
  }).map(({ run }) => run);
}

/** Roughly how many tier 3 chests were the player's: each voyage's chests split evenly across its crew. */
export function topChestShare(runs: Iterable<Run>): number {
  let share = 0;
  for (const run of runs) if (run.crewSize) share += run.loot[0] / run.crewSize;
  return share;
}

/** One familiar for every 1,000 tier 3 chests won. */
export function expectedFamiliars(share: number): number {
  return share / 1000;
}

/** Each name once, whatever its capitals, in alphabetical order. */
export function cleanIgnoreList(names: string[]): string[] {
  const unique = new Map(names.map(name => name.trim()).filter(Boolean).map(name => [name.toLowerCase(), name]));
  return [...unique.values()].sort((a, b) => a.localeCompare(b));
}

/** Voyages with none of these pirates aboard. Chatlogs and the list can differ in capitals. */
export function withoutIgnored(runs: Run[], ignored: string[]): Run[] {
  const names = new Set(ignored.map(name => name.toLowerCase()));
  return runs.filter(run => !run.players.some(player => names.has(player.toLowerCase())));
}

export interface NewBest {
  score: boolean;
  chests: boolean;
}

/**
 * Voyages that beat the best score or tier 3 chests so far with the same crew size, from runs given
 * oldest first. A crew size's first voyage has nothing to beat, and matching a best doesn't beat it.
 */
export function personalBests(runs: Iterable<Run>): Map<Run, NewBest> {
  const bests = new Map<string, { score: number; chests: number }>();
  const beaten = new Map<Run, NewBest>();
  for (const run of runs) {
    if (run.crewSize === null) continue;
    const key = JSON.stringify([run.expedition, run.ocean, run.crewSize]);
    const best = bests.get(key);
    if (!best) {
      bests.set(key, { score: run.score, chests: run.loot[0] });
      continue;
    }
    const score = run.score > best.score;
    const chests = run.loot[0] > best.chests;
    if (score) best.score = run.score;
    if (chests) best.chests = run.loot[0];
    if (score || chests) beaten.set(run, { score, chests });
  }
  return beaten;
}

export function recordsByCrewSize(runs: Iterable<Run>): CrewRecord[] {
  const groups = new Map<string, CrewRecord>();
  for (const run of runs) {
    if (run.crewSize === null) continue;
    const { expedition, ocean, crewSize } = run;
    const key = JSON.stringify([expedition, ocean, crewSize]);
    let group = groups.get(key);
    if (!group) {
      group = { expedition, ocean, crewSize, runs: 0, totalTopTierAboard: 0, maxChests: run, maxScore: run };
      groups.set(key, group);
    }
    group.runs++;
    group.totalTopTierAboard += run.loot[0];
    if (run.loot[0] > group.maxChests.loot[0]) group.maxChests = run;
    if (run.score > group.maxScore.score) group.maxScore = run;
  }
  return [...groups.values()].sort((a, b) =>
    a.expedition.localeCompare(b.expedition) ||
    (a.ocean ?? '').localeCompare(b.ocean ?? '') ||
    a.crewSize - b.crewSize);
}
