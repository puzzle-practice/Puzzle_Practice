// The current shipwide records: the best any crew has managed, kept in known-records.json.
// On the Voyage Records page, a player's voyage that ties one is yellow and one that beats it is red.
import table from './known-records.json';
import type { ExpeditionId, Run } from './records';

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
