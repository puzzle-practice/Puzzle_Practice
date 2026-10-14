// A duty report: the game's end-of-duty summary for one pirate. It's plain data so it can be
// saved with a game's history row and its replay, and shown again later exactly as it was.
import { currentPirate, sanitizeProfile, type PirateProfile } from './profile';
import { PERFORMANCE } from './ratings';

/** One kind of thing cleared, e.g. small chests. `icon` names a picture in icons.ts; SPACE is a gap in a row. */
export interface ClearedItem {
  icon: string;
  label: string;
  count: number;
}

export const SPACE = 'space';

/** A row of cleared things under one heading, e.g. 'Crates collected': small, medium, large. */
export interface ClearedGroup {
  label: string;
  items: ClearedItem[];
  /**
   * 'stack' (default): the game's overlapping stacks, one per kind, with the counts beside them.
   * 'row': every one drawn side by side in order, e.g. Distilling's columns as they went up.
   */
  style?: 'stack' | 'row';
  /** The counts go on the score line, as "8 [4, 2, 0]", instead of beside the stack. */
  inScore?: boolean;
}

export interface DutyReport {
  v: 1;
  /** The puzzle's folder name, for its station icon. */
  puzzle: string;
  /** The station heading, e.g. 'Foraging'. */
  station: string;
  /** The mode played, if the puzzle has several. */
  mode?: string;
  pirate: PirateProfile;
  /** The game's performance index (0-12), or our extended tiers (13-17, see ratings.ts). */
  performance: number;
  score: { label: string; value: string };
  cleared: ClearedGroup[];
  /** Too short to rate (e.g. a Normal forage that barely started): shown as Unrated. */
  unrated?: true;
}

/** What a puzzle passes when its session ends; the pirate is filled in. */
export interface ReportInput {
  puzzle: string;
  station: string;
  mode?: string;
  performance: number;
  score: { label: string; value: string };
  cleared?: ClearedGroup[];
  unrated?: boolean;
}

/** Combat and Distilling's practice boards use their own results instead of a duty popup. */
export function showsDutyReport(report: DutyReport): boolean {
  return report.puzzle !== 'swordfight' && !(report.puzzle === 'distilling' && (report.mode === 'Practice' || report.mode === 'Create'));
}

export function makeReport(input: ReportInput): DutyReport {
  return {
    v: 1, puzzle: input.puzzle, station: input.station, ...(input.mode ? { mode: input.mode } : {}),
    pirate: currentPirate(), performance: input.performance, score: { ...input.score },
    cleared: (input.cleared ?? []).map((group) => ({ ...group, items: group.items.map((item) => ({ ...item })) })),
    ...(input.unrated ? { unrated: true as const } : {}),
  };
}

const text = (value: unknown, limit = 80): value is string => typeof value === 'string' && value.length <= limit;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** A saved report checked and cleaned, or null if it isn't one. */
export function readReport(value: unknown): DutyReport | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Partial<DutyReport>;
  if (r.v !== 1 || !text(r.puzzle) || !text(r.station) || (r.mode !== undefined && !text(r.mode)) ||
      !Number.isInteger(r.performance) || r.performance! < 0 || r.performance! >= PERFORMANCE.length ||
      !r.score || !text(r.score.label) || !text(r.score.value) || !Array.isArray(r.cleared) || r.cleared.length > 8) return null;
  const cleared: ClearedGroup[] = [];
  for (const group of r.cleared) {
    if (!group || !text(group.label) || !Array.isArray(group.items) || group.items.length > 400 ||
        (group.style !== undefined && group.style !== 'stack' && group.style !== 'row') ||
        (group.inScore !== undefined && typeof group.inScore !== 'boolean')) return null;
    const items: ClearedItem[] = [];
    for (const item of group.items) {
      if (!item || !text(item.icon) || !text(item.label) || !count(item.count)) return null;
      items.push({ icon: item.icon, label: item.label, count: item.count });
    }
    cleared.push({ label: group.label, items, ...(group.style ? { style: group.style } : {}), ...(group.inScore ? { inScore: true } : {}) });
  }
  return {
    v: 1, puzzle: r.puzzle!, station: r.station!, ...(r.mode !== undefined ? { mode: r.mode } : {}),
    pirate: sanitizeProfile(r.pirate), performance: r.performance!, score: { label: r.score.label, value: r.score.value },
    cleared, ...(r.unrated === true ? { unrated: true as const } : {}),
  };
}

/** History rows hold numbers and strings, so a report is kept there as JSON. */
export const encodeReport = (report: DutyReport): string => JSON.stringify(report);

export function decodeReport(value: unknown): DutyReport | null {
  if (typeof value !== 'string') return null;
  try { return readReport(JSON.parse(value)); } catch { return null; }
}
