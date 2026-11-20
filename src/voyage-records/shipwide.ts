// Shipwide records for the Records page, all from records.json: the den records (best score and most tier 3
// chests for each crew size), plus every other category (fastest, most frays, and so on).
// Screenshots are copied into public/voyage-records/screenshots so the page keeps working if a host drops them.
import { denKind, globalRecords, recordSources, recordsFetched, type GlobalRecord, type RecordSource } from './global-records';
import { knownRecords, type KnownRecord } from './known-records';
import type { ExpeditionId } from './records';

/** A record that isn't a best score or most tier 3 chests for a crew size, with its value as the page shows it. */
export interface SheetRecord {
  voyage: ExpeditionId;
  ocean: string;
  /** The heading the sheet files it under, e.g. "Fastest Win". */
  category: string;
  /** Left out where the category isn't split by crew size. */
  crewSize?: number;
  /** As the sheet writes it: "1:42:10", "37 frays", "520". */
  value: string;
  date?: string;
  pirates?: string[];
  /** Each pirate's own share of the record, in the same order as pirates. */
  pirateScores?: number[];
  /** Everyone who also reached the record, on their own separate runs, where the sheet lists them. */
  everyone?: string[];
  /** Path under public/, e.g. voyage-records/screenshots/vampire/ic-hauled-r12.png. */
  screenshot?: string;
  /** Where the screenshot was hosted before it was copied here. */
  screenshotUrl?: string;
  /** Video proof, which is left on its host. */
  videoUrl?: string;
  /** Further screenshots of the same record, e.g. the rest of an imgur album. */
  more?: string[];
  notes?: string;
  source?: string;
}

export type SheetSource = RecordSource;

type Shots = { screenshot?: string; screenshotUrl?: string; more?: string[] };

/** The records of every other category, in the order records.json lists them. */
export const sheetRecords: SheetRecord[] = globalRecords
  .filter((record) => !denKind(record))
  .map(({ time: _time, loot: _loot, ...record }: GlobalRecord) => ({ ...record, value: String(record.value) }));
export const sheetSources = recordSources;
export const sheetFetched = recordsFetched;

/** The screenshots of each den record, by record key. */
const denShots = new Map<string, Shots>(globalRecords.flatMap((record): [string, Shots][] => {
  const kind = denKind(record);
  if (!kind || (!record.screenshot && !record.screenshotUrl && !record.more)) return [];
  const { screenshot, screenshotUrl, more } = record;
  const shots = { ...(screenshot ? { screenshot } : {}), ...(screenshotUrl ? { screenshotUrl } : {}), ...(more ? { more } : {}) };
  return [[recordKey({ voyage: record.voyage, ocean: record.ocean, crewSize: record.crewSize!, kind }), shots]];
}));

/** A den record's key: voyage/ocean/crewSize/kind. The records feed uses it as the record's id. */
export function recordKey(record: Pick<KnownRecord, 'voyage' | 'ocean' | 'crewSize' | 'kind'>): string {
  return `${record.voyage}/${record.ocean}/${record.crewSize}/${record.kind}`;
}

/** The screenshots filed for a crew-size record, if any. */
export function screenshotsFor(record: Pick<KnownRecord, 'voyage' | 'ocean' | 'crewSize' | 'kind'>): Shots | undefined {
  return denShots.get(recordKey(record));
}

export interface CrewSizeRow {
  crewSize: number;
  score?: KnownRecord & { screenshot?: string; screenshotUrl?: string; more?: string[] };
  chests?: KnownRecord & { screenshot?: string; screenshotUrl?: string; more?: string[] };
}

/** Best score and most tier 3 chests side by side, one row per crew size, smallest crew first. */
export function crewSizeRows(voyage: ExpeditionId, ocean: string, records: KnownRecord[] = knownRecords): CrewSizeRow[] {
  const rows = new Map<number, CrewSizeRow>();
  for (const record of records) {
    if (record.voyage !== voyage || record.ocean !== ocean) continue;
    const row = rows.get(record.crewSize) ?? { crewSize: record.crewSize };
    row[record.kind] = { ...record, ...screenshotsFor(record) };
    rows.set(record.crewSize, row);
  }
  return [...rows.values()].sort((a, b) => a.crewSize - b.crewSize);
}

/** The other categories for a voyage, in the order the sheets list them, rows by crew size. */
export function otherCategories(voyage: ExpeditionId, ocean: string, records: SheetRecord[] = sheetRecords): Map<string, SheetRecord[]> {
  const categories = new Map<string, SheetRecord[]>();
  for (const record of records) {
    if (record.voyage !== voyage || record.ocean !== ocean) continue;
    const list = categories.get(record.category) ?? [];
    list.push(record);
    categories.set(record.category, list);
  }
  for (const list of categories.values()) list.sort((a, b) => (a.crewSize ?? 0) - (b.crewSize ?? 0));
  return categories;
}

export function oceansFor(voyage: ExpeditionId): string[] {
  const oceans = new Set<string>();
  for (const record of knownRecords) if (record.voyage === voyage) oceans.add(record.ocean);
  for (const record of sheetRecords) if (record.voyage === voyage) oceans.add(record.ocean);
  return [...oceans].sort();
}
