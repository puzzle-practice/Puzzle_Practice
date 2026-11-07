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
  /** The date and time written in the log, as if it were UTC. Null before the first date line. */
  at: number | null;
}

export interface Fray {
  number: number;
  result: 'Won' | 'Lost' | null;
  survivors: number | null;
  deaths: string[];
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
  for (const raw of text.split('\n')) {
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
    yield { message: event[4], at: day === null ? null : day + clock };
  }
}
