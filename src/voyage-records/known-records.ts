// The current shipwide records: the best any crew has managed, kept by hand in known-records.json.
// A player's voyage that matches one is shown in red on the Voyage Records page.
import table from './known-records.json';
import type { ExpeditionId, NewBest, Run } from './records';

export interface KnownRecord {
  voyage: ExpeditionId;
  /** Lower case, as in a chatlog's file name: emerald, meridian, cerulean, obsidian... */
  ocean: string;
  crewSize: number;
  /** "score" counts chests 3, 2 and 1 (1 each for Vampire Lairs); "chests" counts tier 3 chests only. */
  kind: 'score' | 'chests';
  value: number;
  /** YYYY-MM-DD. When given, a voyage only matches within a day of it, as logs and sheets can differ on the date. */
  date?: string;
  pirates?: string[];
  /** Where the record was read from, e.g. the sheet and tab. */
  source?: string;
}

const VOYAGES: ExpeditionId[] = ['woodhallow', 'cursedIsles', 'vampireLairs'];
const DAY = 86_400_000;

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

/** The player's voyages that set a record still standing in the table. */
export function currentRecords(runs: Iterable<Run>, records: KnownRecord[] = knownRecords): Map<Run, NewBest> {
  const matches = new Map<Run, NewBest>();
  for (const run of runs) {
    const holds = (kind: KnownRecord['kind']) => records.some((record) =>
      record.kind === kind &&
      record.voyage === run.expedition &&
      record.ocean === run.ocean &&
      record.crewSize === run.crewSize &&
      record.value === (kind === 'score' ? run.score : run.loot[0]) &&
      (record.date === undefined || (run.startedAt !== null && Math.abs(Date.parse(record.date) - run.startedAt) < 2 * DAY)));
    const score = holds('score');
    const chests = holds('chests');
    if (score || chests) matches.set(run, { score, chests });
  }
  return matches;
}
