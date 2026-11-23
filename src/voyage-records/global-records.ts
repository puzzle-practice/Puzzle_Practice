// Every global voyage record, from the one file that keeps them: records.json. Each record has the same
// shape, whatever its category; docs/records-format.md describes it. The best score and most tier 3 chests
// for each crew size ("den records") are what My records compares a player's voyages against; the Global
// records page and the records feed show every category.
import file from './records.json';
import type { ExpeditionId } from './records';

export interface GlobalRecord {
  voyage: ExpeditionId;
  /** Lower case, as in a chatlog's file name: emerald, meridian, cerulean, obsidian... */
  ocean: string;
  /** What the record is for, e.g. "Best score" or "Most frays in one entry, one pirate". */
  category: string;
  /** The crew's size, for a category kept for each crew size. Left out where the category isn't split by crew. */
  crewSize?: number;
  /** A whole number: the score, chests, frays, holes... */
  value: number;
  /** YYYY-MM-DD, when known. */
  date?: string;
  /** The date and time the chatlog gives, YYYY-MM-DDTHH:MM:SS (or without the seconds), when known. */
  time?: string;
  pirates?: string[];
  /** Each pirate's own share of the record, in the same order as pirates. */
  pirateScores?: number[];
  /** Chests brought aboard, tier 3 to tier 1, for a den record that came from a chatlog. */
  loot?: [number, number, number];
  /** Everyone who also reached the record, on their own separate runs. */
  everyone?: string[];
  /** Path under public/, e.g. voyage-records/screenshots/vampire-lairs/carp-holes.png. */
  screenshot?: string;
  /** Where the screenshot was hosted before it was copied here. */
  screenshotUrl?: string;
  /** Video proof, which is left on its host. */
  videoUrl?: string;
  /** Further screenshots of the same record, e.g. the rest of an imgur album. */
  more?: string[];
  notes?: string;
  /** Where the record came from, e.g. the sheet and tab. */
  source?: string;
}

export interface RecordSource {
  voyage: ExpeditionId;
  name: string;
  url: string;
}

interface RecordsFile {
  /** When the record sheets were last copied, YYYY-MM-DD. */
  fetched?: string;
  sources: RecordSource[];
  records: GlobalRecord[];
}

/** The categories kept for every crew size from chatlogs: "score" counts chests 3, 2 and 1 (1 each for Vampire Lairs), "chests" counts tier 3 chests. */
export const DEN_CATEGORIES: Record<ExpeditionId, Record<'score' | 'chests', string>> = {
  woodhallow: { score: 'Best score', chests: 'Most dire chests' },
  cursedIsles: { score: 'Best score', chests: 'Most cursed chests' },
  vampireLairs: { score: 'Best score', chests: 'Most immortal chests' },
};

/** "score" or "chests" for a den record, else null. */
export function denKind(record: Pick<GlobalRecord, 'voyage' | 'category'>): 'score' | 'chests' | null {
  const categories = DEN_CATEGORIES[record.voyage];
  if (!categories) return null;
  return record.category === categories.score ? 'score' : record.category === categories.chests ? 'chests' : null;
}

const data = file as RecordsFile;

export const globalRecords = data.records;
export const recordSources = data.sources;
export const recordsFetched = data.fetched ?? null;

const VOYAGES = Object.keys(DEN_CATEGORIES) as ExpeditionId[];

/** Every problem with records.json, so a bad edit fails the tests instead of quietly showing nothing. */
export function recordsProblems(records: unknown[]): string[] {
  const seen = new Set<string>();
  return records.flatMap((value, index) => {
    const record = value as Partial<GlobalRecord>;
    const at = `Record ${index + 1}`;
    const problems: string[] = [];
    if (!VOYAGES.includes(record.voyage as ExpeditionId)) problems.push(`${at}: voyage must be one of ${VOYAGES.join(', ')}`);
    if (typeof record.ocean !== 'string' || !record.ocean || record.ocean !== record.ocean.toLowerCase()) problems.push(`${at}: ocean must be a lower-case name`);
    if (typeof record.category !== 'string' || !record.category) problems.push(`${at}: category is missing`);
    if (!Number.isInteger(record.value) || record.value! < 0) problems.push(`${at}: value must be a whole number`);
    if (record.crewSize !== undefined && (!Number.isInteger(record.crewSize) || record.crewSize < 1)) problems.push(`${at}: crewSize must be a whole number`);
    if (record.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) problems.push(`${at}: date must be YYYY-MM-DD`);
    if (record.time != null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(record.time)) problems.push(`${at}: time must be YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS`);
    if (record.pirateScores !== undefined && (!Array.isArray(record.pirateScores) || record.pirateScores.length !== record.pirates?.length || !record.pirateScores.every(Number.isFinite))) problems.push(`${at}: pirateScores must be one number per pirate`);
    if (record.loot !== undefined && (!Array.isArray(record.loot) || record.loot.length !== 3 || !record.loot.every(Number.isInteger))) problems.push(`${at}: loot must be three whole numbers, tier 3 first`);
    for (const shot of [record.screenshot, ...(record.more ?? [])]) {
      if (shot !== undefined && !/^voyage-records\/screenshots\/[\w./-]+$/.test(shot)) problems.push(`${at}: screenshots must be under voyage-records/screenshots/`);
    }
    if (record.voyage && record.category && denKind(record as GlobalRecord)) {
      if (record.crewSize === undefined) problems.push(`${at}: a ${record.category} record needs a crewSize`);
      const key = JSON.stringify([record.voyage, record.ocean, record.crewSize, record.category]);
      if (seen.has(key)) problems.push(`${at}: there is already a ${record.category} record for this voyage, ocean and crew size`);
      seen.add(key);
    }
    return problems;
  });
}
