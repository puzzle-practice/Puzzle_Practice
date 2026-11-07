// The current shipwide records: the best any crew has managed, kept in known-records.json.
// On the Voyage Records page, a player's voyage that ties one is yellow and one that beats it is red.
import table from './known-records.json';
import { recordsByCrewSize, type ExpeditionId, type Run } from './records';

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

const VOYAGES: ExpeditionId[] = ['woodhallow', 'cursedIsles', 'vampireLairs'];

/** Every problem with the table, so a bad edit fails the tests instead of quietly matching nothing. */
export function tableProblems(records: unknown[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  records.forEach((value, index) => {
    const record = value as Partial<KnownRecord>;
    const at = `Record ${index + 1}`;
    if (!VOYAGES.includes(record.voyage as ExpeditionId)) problems.push(`${at}: voyage must be one of ${VOYAGES.join(', ')}`);
    if (typeof record.ocean !== 'string' || record.ocean !== record.ocean.toLowerCase() || !record.ocean) problems.push(`${at}: ocean must be a lower-case name`);
    if (!Number.isInteger(record.crewSize) || record.crewSize! < 1) problems.push(`${at}: crewSize must be a whole number`);
    if (record.kind !== 'score' && record.kind !== 'chests') problems.push(`${at}: kind must be "score" or "chests"`);
    if (!Number.isInteger(record.value) || record.value! < 0) problems.push(`${at}: value must be a whole number`);
    if (record.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) problems.push(`${at}: date must be YYYY-MM-DD`);
    const key = JSON.stringify([record.voyage, record.ocean, record.crewSize, record.kind]);
    if (seen.has(key)) problems.push(`${at}: there is already a ${record.kind} record for this voyage, ocean and crew size`);
    seen.add(key);
  });
  return problems;
}

export const knownRecords = table.records as KnownRecord[];

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
    const standing = (kind: KnownRecord['kind']): Standing | null => {
      const record = recordFor(run, kind, records);
      if (!record) return null;
      const value = kind === 'score' ? run.score : run.loot[0];
      return value > record.value ? 'beat' : value === record.value ? 'tie' : null;
    };
    const result = { score: standing('score'), chests: standing('chests') };
    if (result.score || result.chests) results.set(run, result);
  }
  return results;
}

/** A personal record as the Export records button writes it: a table entry plus what backs it up. */
export interface ExportedRecord extends KnownRecord {
  /** The date and time written in the chatlog. */
  time: string | null;
  /** Chests brought aboard, tier 3 to tier 1. */
  loot: [number, number, number];
  /** Against the table when exported: "new" where the table has no record for that crew size yet. */
  standing: Standing | 'new' | null;
}

export interface RecordsExport {
  exported: string;
  logs: string[];
  records: ExportedRecord[];
}

/** The player's best score and most tier 3 chests for each voyage, ocean and crew size. */
export function exportRecords(runs: Run[], logs: string[], now = new Date(), records: KnownRecord[] = knownRecords): RecordsExport {
  const exported: ExportedRecord[] = [];
  for (const group of recordsByCrewSize(runs)) {
    if (group.ocean === null) continue;
    for (const kind of ['score', 'chests'] as const) {
      const run = kind === 'score' ? group.maxScore : group.maxChests;
      const value = kind === 'score' ? run.score : run.loot[0];
      const record = recordFor(run, kind, records);
      const time = run.startedAt === null ? null : new Date(run.startedAt).toISOString().slice(0, 19);
      exported.push({
        voyage: run.expedition,
        ocean: group.ocean,
        crewSize: group.crewSize,
        kind,
        value,
        ...(time ? { date: time.slice(0, 10) } : {}),
        pirates: run.players,
        source: `Exported from ${logs.join(', ')}`,
        time,
        loot: run.loot,
        standing: !record ? 'new' : value > record.value ? 'beat' : value === record.value ? 'tie' : null,
      });
    }
  }
  return { exported: now.toISOString(), logs, records: exported };
}

/** How one voyage stands against the record for its crew size: tie, beat, or neither. */
export function standingFor(run: Run, kind: KnownRecord['kind'], records: KnownRecord[] = knownRecords): Standing | null {
  const record = recordFor(run, kind, records);
  if (!record) return null;
  const value = kind === 'score' ? run.score : run.loot[0];
  return value > record.value ? 'beat' : value === record.value ? 'tie' : null;
}

const VOYAGE_NAMES: Record<ExpeditionId, string> = { woodhallow: 'Woodhallow', cursedIsles: 'Cursed Isles', vampireLairs: 'Vampire Lairs' };
const TOP_CHESTS: Record<ExpeditionId, string> = { woodhallow: 'dire chests', cursedIsles: 'cursed chests', vampireLairs: 'immortal chests' };

/** The biggest crew whose records are worth sending in: past this, crews are too rare to keep records for. */
export const MAX_SENT_CREW: Record<ExpeditionId, number> = { woodhallow: 12, cursedIsles: 7, vampireLairs: 12 };

/**
 * The records in an export that beat the table, ready to send to Jice. A tie is already on the table, and
 * crews bigger than MAX_SENT_CREW aren't asked for, so neither is sent.
 */
export function claimedRecords(exported: RecordsExport): ExportedRecord[] {
  return exported.records.filter((record) => record.standing === 'beat' && record.crewSize <= MAX_SENT_CREW[record.voyage]);
}

/**
 * A message to paste to Jice: one readable line per beaten record, then the same records as JSON
 * so they can go straight into known-records.json.
 */
export function recordsMessage(exported: RecordsExport, records: KnownRecord[] = knownRecords): string {
  const claimed = claimedRecords(exported);
  const lines = claimed.map((record) => {
    const standing = records.find((known) =>
      known.voyage === record.voyage && known.ocean === record.ocean && known.crewSize === record.crewSize && known.kind === record.kind);
    const what = record.kind === 'score' ? 'best score' : `most ${TOP_CHESTS[record.voyage]}`;
    const ocean = `${record.ocean[0].toUpperCase()}${record.ocean.slice(1)}`;
    const verb = `beats ${standing?.value ?? '?'}`;
    return `- ${VOYAGE_NAMES[record.voyage]} (${ocean}), ${record.crewSize} pirates, ${what}: ${record.value} (${verb}) on ${record.time ?? record.date ?? 'an unknown date'}. Loot ${record.loot.join('/')}. Crew: ${record.pirates?.join(', ') || 'not in the log'}`;
  });
  const data = claimed.map(({ voyage, ocean, crewSize, kind, value, date, time, pirates, loot }) => ({ voyage, ocean, crewSize, kind, value, date, time, pirates, loot }));
  return [
    `Hi Jice, I've beaten ${claimed.length === 1 ? 'a voyage record' : `${claimed.length} voyage records`} on Puzzle Practice:`,
    ...lines,
    '',
    'Data for the records table:',
    JSON.stringify(data),
  ].join('\n');
}
