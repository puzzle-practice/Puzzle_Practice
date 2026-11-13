// The records feed: every standing voyage record as one JSON file, for bots and other sites to read.
// The build writes it to voyage-records.json at the site root (see vite.config.ts). Nothing on the site
// links to it. Its shape is described in docs/voyage-records-feed.md; change FEED_VERSION when a field
// is renamed or removed, so readers can tell.
import { expeditions, type ExpeditionId } from './records';
import { knownRecords, type KnownRecord } from './known-records';
import { recordKey, sheetFetched, sheetRecords, sheetSources, screenshotsFor, type SheetRecord, type SheetSource } from './shipwide';

export const FEED_VERSION = 1;
/** Where the build puts the feed, from the site root. Screenshot paths in it resolve against its URL. */
export const FEED_PATH = 'voyage-records.json';

const TOP_CHESTS: Record<ExpeditionId, string> = { woodhallow: 'Dire chests', cursedIsles: 'Cursed chests', vampireLairs: 'Immortal chests' };

export interface FeedCrewSizeRecord {
  /** Stable for a voyage, ocean, crew size and kind, so a bot can spot a record being beaten. */
  id: string;
  voyage: ExpeditionId;
  ocean: string;
  crewSize: number;
  kind: KnownRecord['kind'];
  /** "Best score" or "Most cursed chests" and so on. */
  label: string;
  value: number;
  date: string | null;
  pirates: string[];
  /** Paths from the site root, e.g. voyage-records/screenshots/woodhallow/sent/1.png. */
  screenshots: string[];
  /** Where a screenshot was hosted before it was copied to the site, when it hasn't been yet. */
  screenshotUrl: string | null;
  source: string | null;
}

export interface FeedOtherRecord {
  id: string;
  voyage: ExpeditionId;
  ocean: string;
  category: string;
  crewSize: number | null;
  /** As the record sheets write it: "1:42:10", "37 frays", "520". */
  value: string;
  date: string | null;
  pirates: string[];
  /** Each pirate's own share, in the same order as pirates, where known. */
  pirateScores: number[] | null;
  /** Everyone who also reached the record on separate runs, where known. */
  everyone: string[] | null;
  screenshots: string[];
  screenshotUrl: string | null;
  videoUrl: string | null;
  notes: string | null;
  source: string | null;
}

export interface RecordsFeed {
  version: number;
  /** When the site was built, as an ISO time. */
  generated: string;
  /** When the record sheets were last copied, YYYY-MM-DD. */
  sheetsFetched: string | null;
  voyages: { id: ExpeditionId; name: string; chests: [string, string, string] }[];
  sources: SheetSource[];
  crewSizeRecords: FeedCrewSizeRecord[];
  otherRecords: FeedOtherRecord[];
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function crewSizeRecord(record: KnownRecord): FeedCrewSizeRecord {
  const shots = screenshotsFor(record);
  return {
    id: recordKey(record),
    voyage: record.voyage,
    ocean: record.ocean,
    crewSize: record.crewSize,
    kind: record.kind,
    label: record.kind === 'score' ? 'Best score' : `Most ${TOP_CHESTS[record.voyage].toLowerCase()}`,
    value: record.value,
    date: record.date ?? null,
    pirates: record.pirates ?? [],
    screenshots: shots?.screenshot ? [shots.screenshot, ...(shots.more ?? [])] : [],
    screenshotUrl: shots?.screenshot ? null : shots?.screenshotUrl ?? null,
    source: record.source ?? null,
  };
}

function otherRecord(record: SheetRecord, id: string): FeedOtherRecord {
  return {
    id,
    voyage: record.voyage,
    ocean: record.ocean,
    category: record.category,
    crewSize: record.crewSize ?? null,
    value: record.value,
    date: record.date ?? null,
    pirates: record.pirates ?? [],
    pirateScores: record.pirateScores ?? null,
    everyone: record.everyone ?? null,
    screenshots: record.screenshot ? [record.screenshot, ...(record.more ?? [])] : [],
    screenshotUrl: record.screenshot ? null : record.screenshotUrl ?? null,
    videoUrl: record.videoUrl ?? null,
    notes: record.notes ?? null,
    source: record.source ?? null,
  };
}

const VOYAGE_ORDER = Object.keys(expeditions) as ExpeditionId[];

/** Every record, in a steady order: voyage, ocean, then crew size (and kind or category). */
export function recordsFeed({
  now = new Date(),
  known = knownRecords,
  other = sheetRecords,
}: { now?: Date; known?: KnownRecord[]; other?: SheetRecord[] } = {}): RecordsFeed {
  const byPlace = (a: { voyage: ExpeditionId; ocean: string }, b: { voyage: ExpeditionId; ocean: string }) =>
    VOYAGE_ORDER.indexOf(a.voyage) - VOYAGE_ORDER.indexOf(b.voyage) || a.ocean.localeCompare(b.ocean);

  const crewSizeRecords = [...known]
    .sort((a, b) => byPlace(a, b) || a.crewSize - b.crewSize || a.kind.localeCompare(b.kind))
    .map(crewSizeRecord);

  // The sheets list some categories more than once (ties, or one row per crew size), so the id counts them.
  const seen = new Map<string, number>();
  const otherRecords = other.map((record) => {
    const base = [record.voyage, record.ocean, slug(record.category), record.crewSize ?? 'any'].join('/');
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return otherRecord(record, count === 1 ? base : `${base}/${count}`);
  });

  return {
    version: FEED_VERSION,
    generated: now.toISOString(),
    sheetsFetched: sheetFetched,
    voyages: VOYAGE_ORDER.map((id) => ({ id, name: expeditions[id].name, chests: expeditions[id].chests })),
    sources: sheetSources,
    crewSizeRecords,
    otherRecords,
  };
}
