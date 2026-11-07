// Shipwide records for the Records page: the crew-size records in known-records.json, plus every other
// record category the two record sheets keep (fastest, most frays, and so on) from sheet-records.json.
// Screenshots are copied into public/voyage-records/screenshots so the page keeps working if a host drops them.
import sheet from './sheet-records.json';
import { knownRecords, type KnownRecord } from './known-records';
import type { ExpeditionId } from './records';

/** A record that isn't a best score or most tier 3 chests for a crew size, as the sheets list it. */
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
  /** Path under public/, e.g. voyage-records/screenshots/vampire/ic-hauled-r12.png. */
  screenshot?: string;
  /** Where the screenshot was hosted before it was copied here. */
  screenshotUrl?: string;
  notes?: string;
  source?: string;
}

export interface SheetSource {
  voyage: ExpeditionId;
  name: string;
  url: string;
}

interface SheetFile {
  fetched?: string;
  sources: SheetSource[];
  records: SheetRecord[];
  /** Screenshots the crew-size records in known-records.json point to, by record key. */
  screenshots?: Record<string, { screenshot?: string; screenshotUrl?: string }>;
}

const data = sheet as SheetFile;

export const sheetSources = data.sources;
export const sheetFetched = data.fetched ?? null;
export const sheetRecords = data.records;

/** The key a crew-size record's screenshot is filed under in sheet-records.json. */
export function recordKey(record: Pick<KnownRecord, 'voyage' | 'ocean' | 'crewSize' | 'kind'>): string {
  return `${record.voyage}/${record.ocean}/${record.crewSize}/${record.kind}`;
}

export interface CrewSizeRow {
  crewSize: number;
  score?: KnownRecord & { screenshot?: string; screenshotUrl?: string };
  chests?: KnownRecord & { screenshot?: string; screenshotUrl?: string };
}

/** Best score and most tier 3 chests side by side, one row per crew size, smallest crew first. */
export function crewSizeRows(voyage: ExpeditionId, ocean: string, records: KnownRecord[] = knownRecords): CrewSizeRow[] {
  const rows = new Map<number, CrewSizeRow>();
  for (const record of records) {
    if (record.voyage !== voyage || record.ocean !== ocean) continue;
    const row = rows.get(record.crewSize) ?? { crewSize: record.crewSize };
    row[record.kind] = { ...record, ...data.screenshots?.[recordKey(record)] };
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

/** Every problem with sheet-records.json, so a bad edit fails the tests. */
export function sheetProblems(records: unknown[]): string[] {
  const voyages: ExpeditionId[] = ['woodhallow', 'cursedIsles', 'vampireLairs'];
  return records.flatMap((value, index) => {
    const record = value as Partial<SheetRecord>;
    const at = `Sheet record ${index + 1}`;
    const problems: string[] = [];
    if (!voyages.includes(record.voyage as ExpeditionId)) problems.push(`${at}: unknown voyage`);
    if (typeof record.ocean !== 'string' || !record.ocean || record.ocean !== record.ocean.toLowerCase()) problems.push(`${at}: ocean must be a lower-case name`);
    if (typeof record.category !== 'string' || !record.category) problems.push(`${at}: category is missing`);
    if (typeof record.value !== 'string') problems.push(`${at}: value must be text`);
    if (record.crewSize !== undefined && (!Number.isInteger(record.crewSize) || record.crewSize < 1)) problems.push(`${at}: crewSize must be a whole number`);
    if (record.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) problems.push(`${at}: date must be YYYY-MM-DD`);
    if (record.screenshot !== undefined && !/^voyage-records\/screenshots\/[\w./-]+$/.test(record.screenshot)) problems.push(`${at}: screenshot must be under voyage-records/screenshots/`);
    return problems;
  });
}
