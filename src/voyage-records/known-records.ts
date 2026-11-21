// The best score and most tier 3 chests any crew has managed for each crew size: the den records in
// records.json. On the Voyage Records page, a player's voyage that ties one is yellow and one that beats it is red.
import { byName, recordsByCrewSize, type ExpeditionId, type Run } from './records';
import { DEN_CATEGORIES, denKind, globalRecords, type GlobalRecord } from './global-records';
import { hasIgnoredPirate } from './ignored-pirates';
import reviewedRuns from './excluded-runs.json';

/** A den record as My records compares against it. */
export interface KnownRecord {
  voyage: ExpeditionId;
  /** Lower case, as in a chatlog's file name: emerald, meridian, cerulean, obsidian... */
  ocean: string;
  crewSize: number;
  /** "score" counts chests 3, 2 and 1 (1 each for Vampire Lairs); "chests" counts tier 3 chests only. */
  kind: 'score' | 'chests';
  value: number;
  /** YYYY-MM-DD, when known. */
  date?: string;
  pirates?: string[];
  /** Where the record came from, e.g. the sheet and tab. */
  source?: string;
}

export type Standing = 'tie' | 'beat';

/** How a voyage measures up to the standing records for its voyage, ocean and crew size. */
export interface AgainstRecord {
  score: Standing | null;
  chests: Standing | null;
}

/** A den record from records.json in the shape My records compares against, or null for any other category. */
export function toKnownRecord(record: GlobalRecord): KnownRecord | null {
  const kind = denKind(record);
  if (!kind || record.crewSize === undefined) return null;
  const { voyage, ocean, crewSize, value, date, pirates, source } = record;
  return { voyage, ocean, crewSize, kind, value, ...(date ? { date } : {}), ...(pirates ? { pirates } : {}), ...(source ? { source } : {}) };
}

export const knownRecords: KnownRecord[] = globalRecords.flatMap((record) => toKnownRecord(record) ?? []);

// Reviewed runs that can stay in personal history but are ineligible for global records.
const excludedRuns = reviewedRuns;

export function isExcludedRun(run: Run): boolean {
  if (hasIgnoredPirate(run.players)) return true;
  const { startedAt } = run;
  return startedAt !== null && excludedRuns.some((excluded) =>
    run.expedition === excluded.expedition && run.ocean === excluded.ocean && run.crewSize === excluded.crewSize &&
    run.loot.every((amount, index) => amount === excluded.loot[index]) &&
    new Date(startedAt).toISOString().slice(0, 10) === excluded.date &&
    run.players.length === excluded.players.length &&
    excluded.players.every((pirate) => run.players.some((player) => player.toLowerCase() === pirate.toLowerCase())));
}

export function recordFor(run: Run, kind: KnownRecord['kind'], records: KnownRecord[] = knownRecords): KnownRecord | undefined {
  return records.find((record) =>
    record.kind === kind && record.voyage === run.expedition && record.ocean === run.ocean && record.crewSize === run.crewSize);
}

/**
 * The player's voyages that tie or beat a standing record. A crew size with no record in the table
 * has nothing to tie or beat.
 */
export function againstRecords(runs: Iterable<Run>, records: KnownRecord[] = knownRecords): Map<Run, AgainstRecord> {
  const results = new Map<Run, AgainstRecord>();
  for (const run of runs) {
    const result = {
      score: standingFor(run, 'score', records),
      chests: standingFor(run, 'chests', records),
    };
    if (result.score || result.chests) results.set(run, result);
  }
  return results;
}

/**
 * A personal record as the Export records button writes it: a records.json record (see
 * docs/records-format.md) plus how it stands against the table.
 */
export interface ExportedRecord {
  voyage: ExpeditionId;
  ocean: string;
  /** "Best score", or "Most dire chests" and so on: see DEN_CATEGORIES. */
  category: string;
  crewSize: number;
  value: number;
  date?: string;
  /** The date and time written in the chatlog. */
  time: string | null;
  pirates: string[];
  /** Chests brought aboard, tier 3 to tier 1. */
  loot: [number, number, number];
  source: string;
  /** Against the table when exported: "new" where the table has no record for that crew size yet. */
  standing: Standing | 'new' | null;
}

export interface RecordsExport {
  exported: string;
  logs: string[];
  records: ExportedRecord[];
}

/** The player's best eligible score and most tier 3 chests for each voyage, ocean and crew size. */
export function exportRecords(runs: Run[], logs: string[], now = new Date(), records: KnownRecord[] = knownRecords): RecordsExport {
  const exported: ExportedRecord[] = [];
  for (const group of recordsByCrewSize(runs.filter((run) => !isExcludedRun(run)))) {
    if (group.ocean === null) continue;
    for (const kind of ['score', 'chests'] as const) {
      const run = kind === 'score' ? group.maxScore : group.maxChests;
      const value = kind === 'score' ? run.score : run.loot[0];
      const record = recordFor(run, kind, records);
      const time = run.startedAt === null ? null : new Date(run.startedAt).toISOString().slice(0, 19);
      exported.push({
        voyage: run.expedition,
        ocean: group.ocean,
        category: DEN_CATEGORIES[run.expedition][kind],
        crewSize: group.crewSize,
        value,
        ...(time ? { date: time.slice(0, 10) } : {}),
        time,
        pirates: run.players,
        loot: run.loot,
        source: `Exported from ${logs.join(', ')}`,
        standing: !record ? 'new' : value > record.value ? 'beat' : value === record.value ? 'tie' : null,
      });
    }
  }
  return { exported: now.toISOString(), logs, records: exported };
}

/** How one voyage stands against the record for its crew size: tie, beat, or neither. */
export function standingFor(run: Run, kind: KnownRecord['kind'], records: KnownRecord[] = knownRecords): Standing | null {
  if (isExcludedRun(run)) return null;
  const record = recordFor(run, kind, records);
  if (!record) return null;
  const value = kind === 'score' ? run.score : run.loot[0];
  return value > record.value ? 'beat' : value === record.value ? 'tie' : null;
}

const VOYAGE_NAMES: Record<ExpeditionId, string> = { woodhallow: 'Woodhallow', cursedIsles: 'Cursed Isles', vampireLairs: 'Vampire Lairs' };

/** The biggest crew whose records are worth sending in: past this, crews are too rare to keep records for. */
export const MAX_SENT_CREW: Record<ExpeditionId, number> = { woodhallow: 12, cursedIsles: 7, vampireLairs: 12 };

/**
 * The records in an export that beat the table, ready to send to Jice. A tie is already on the table, and
 * crews bigger than MAX_SENT_CREW aren't asked for, so neither is sent.
 */
export function claimedRecords(exported: RecordsExport): ExportedRecord[] {
  return exported.records.filter((record) => !hasIgnoredPirate(record.pirates) && record.standing === 'beat' && record.crewSize <= MAX_SENT_CREW[record.voyage]);
}

/**
 * A message to paste to Jice: one numbered line per beaten record, then the same records as JSON, in the
 * same order and in the shape records.json keeps (see docs/records-format.md), so npm run add-records can
 * take them as they are. The numbers are what the player's pictures
 * are named by when Jice files them (see docs/voyage-records-screenshots.md).
 */
export function recordsMessage(exported: RecordsExport, records: KnownRecord[] = knownRecords): string {
  const claimed = claimedRecords(exported);
  const lines = claimed.map((record, index) => {
    const standing = records.find((known) =>
      known.voyage === record.voyage && known.ocean === record.ocean && known.crewSize === record.crewSize &&
      DEN_CATEGORIES[known.voyage][known.kind] === record.category);
    const what = `${record.category[0].toLowerCase()}${record.category.slice(1)}`;
    const ocean = `${record.ocean[0].toUpperCase()}${record.ocean.slice(1)}`;
    const verb = `beats ${standing?.value ?? '?'}`;
    return `${index + 1}. ${VOYAGE_NAMES[record.voyage]} (${ocean}), ${record.crewSize} pirates, ${what}: ${record.value} (${verb}) on ${record.time ?? record.date ?? 'an unknown date'}. Loot ${record.loot.join('/')}. Crew: ${byName(record.pirates ?? []).join(', ') || 'not in the log'}`;
  });
  const data = claimed.map(({ voyage, ocean, category, crewSize, value, date, time, pirates, loot }) => ({ voyage, ocean, category, crewSize, value, date, time, pirates, loot }));
  return [
    `Hi Jice, I've beaten ${claimed.length === 1 ? 'a voyage record' : `${claimed.length} voyage records`} on Puzzle Practice:`,
    ...lines,
    '',
    'Data for the records:',
    JSON.stringify(data),
  ].join('\n');
}
