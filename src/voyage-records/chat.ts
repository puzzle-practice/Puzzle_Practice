// Reads a Puzzle Pirates chatlog into timestamped server messages.
export const dayMs = 86_400_000;
export const arrivals = {
  woodhallow: "Hark the dread howlin'! 'Tis Woodhallow Isle, realm o' the wolf-folk!",
  cursedIsles: "Ye land on the island, but an angry mob of its inhabitants stands between ye and yer rightful plunderin'!",
  vampireLairs: 'Welcome to the vampire sanctum.',
};

export type ExpeditionId = keyof typeof arrivals;
export type RunResult = 'Won' | 'Lost' | 'Retreated' | 'Returned';

export interface ChatEvent {
  message: string;
  /** One-based line in the original file, for voyage debug excerpts. */
  line?: number;
  /** The date and time written in the log, as if it were UTC. Null before the first date line. */
  at: number | null;
  /** Milliseconds since midnight, including in undated logs. */
  clock?: number;
}

export interface Fray {
  number: number;
  result: 'Won' | 'Lost' | null;
  survivors: number | null;
  deaths: string[];
  /**
   * In a lost fray, the pirates who fell soon after it began: within two minutes in Woodhallow and
   * one minute in Vampire Lairs. Only death rates read it.
   */
  earlyDeaths?: string[];
  /** Vampire Lairs: who fought this fray, when it differs from the voyage's crew. */
  crew?: string[];
}

export interface RunDetails {
  players: string[];
  crewSize: number | null;
  /** Chests brought aboard, tier 3 to tier 1. */
  loot: [number, number, number];
  fraysWon: number;
  result: RunResult | null;
  frays: Fray[];
}

export const winners = /^Game over\.\s+Winners?: (.+)\.$/;
export const elimination = /^(\S+) is eliminated!$/;
export const pirateName = /^(?!(?:Werewolf|Wolf-kin)$)[\w'-]+$/i;
export const leftVessel = /^(?:The booty has been divided!|Going aboard .+|Ye have left the vessel\.)$/;

export function alphabetize(names: Iterable<string>): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export function* chatEvents(text: string): Generator<ChatEvent> {
  let day: number | null = null;
  let previousClock = 0;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const line = raw.trim();
    const date = /^=+ (\d{4})\/(\d{1,2})\/(\d{1,2}) =+$/.exec(line);
    if (date) {
      day = Date.UTC(+date[1], +date[2] - 1, +date[3]);
      previousClock = 0;
      continue;
    }
    const event = /^\[(\d{2}):(\d{2}):(\d{2})\] (.*)$/.exec(line);
    if (!event) continue;
    const clock = (+event[1] * 3600 + +event[2] * 60 + +event[3]) * 1000;
    if (day !== null && previousClock - clock > dayMs / 2) day += dayMs;
    previousClock = clock;
    yield { message: event[4], at: day === null ? null : day + clock, clock, line: index + 1 };
  }
}

/**
 * Milliseconds from one event to a later one, or null when the log can't tell. Undated logs fall
 * back to the clock, wrapping past midnight.
 */
export function elapsedMs(from: ChatEvent, to: ChatEvent): number | null {
  if (from.at !== null && to.at !== null) return to.at - from.at;
  if (from.clock === undefined || to.clock === undefined) return null;
  return (to.clock - from.clock + dayMs) % dayMs;
}
