import { alphabetize, elimination, leftVessel, pirateName, winners, type ChatEvent, type RunDetails, type RunResult } from './chat';

interface Round {
  won: boolean | null;
  standing: number | null;
  eliminated: Set<string>;
}

const nextFray = /^(?:Beware! More )?(?:wolf-kin|wolven) approach!$/i;
const finalFray = "We've reached their lair! Almost done!";
const survivors = /^(\d+) o' (\d+) still standin'! (?:To yer stations!|Plunder the lair!)$/;
const aboard = /^Ye have taken aboard (?:(\d+) (dire chests?|lunar lockers?|wolf boxes|wolf box)|m\.werewolf_(small|medium|large)_treasure\((\d+)\))!$/i;
const tierIndex: Record<string, number> = { dire: 0, large: 0, lunar: 1, medium: 1, wolf: 2, small: 2 };

export function parseWoodhallow(events: Iterable<ChatEvent>): RunDetails | null {
  const rounds = Array<Round | null>(6).fill(null);
  const loot: RunDetails['loot'] = [0, 0, 0];
  let crew = null as string[] | null;
  let crewSize = null as number | null;
  let fray = null as Round | null;
  let ended = false;
  let result = null as RunResult | null;
  let terminalAt = null as number | null;

  for (const { message, at } of events) {
    if (ended && leftVessel.test(message)) break;
    if (terminalAt !== null && at !== null && at - terminalAt > 120_000) break;
    const chest = aboard.exec(message);
    if (chest) {
      const kind = (chest[2]?.split(" ")[0] ?? chest[3]).toLowerCase();
      loot[tierIndex[kind]] = Number(chest[1] ?? chest[4]);
      ended = true;
      terminalAt ??= at;
      continue;
    }
    if (message === "The pack has overrun the crew! Ye flee back to the ship.") {
      if (fray && fray.won === null) {
        fray.won = false;
        fray.standing = 0;
        crew ??= [...fray.eliminated];
      }
      result = "Lost";
      ended = true;
      terminalAt ??= at;
      continue;
    }
    if (message.startsWith("The crew falls back") || message.startsWith("Ye retreat")) {
      result = "Retreated";
      ended = true;
      terminalAt ??= at;
      continue;
    }
    if (message === "The lair be plundered! The night be yers!") result = "Won";
    if (message.endsWith("calls the crew back to the ship. Every chest be yers!")) {
      ended = true;
      terminalAt ??= at;
      continue;
    }
    if (ended) continue;

    const winner = winners.exec(message);
    const count = survivors.exec(message);
    const missedStart = (!fray || fray.won !== null) && (message === "Get ready!" || winner);
    if (nextFray.test(message) || message === finalFray || missedStart) {
      const index = message === finalFray ? 5 : rounds.findIndex(round => round === null);
      if (index >= 0) {
        fray = { won: null, standing: null, eliminated: new Set() };
        rounds[index] = fray;
      }
    }
    if (!fray) continue;
    const defeated = elimination.exec(message);
    if (defeated && fray.won === null && pirateName.test(defeated[1])) {
      fray.eliminated.add(defeated[1]);
    } else if (winner && fray.won === null) {
      const names = winner[1].split(", ");
      fray.won = names.every(name => pirateName.test(name));
      if (fray.won) {
        crew ??= names;
        const { eliminated } = fray;
        fray.standing = names.filter(name => !eliminated.has(name)).length;
      } else {
        fray.standing = 0;
        crew ??= [...fray.eliminated];
        result = "Lost";
        ended = true;
        terminalAt ??= at;
      }
    } else if (count) {
      if (message.endsWith("Plunder the lair!") && fray !== rounds[5]) {
        rounds[rounds.indexOf(fray)] = null;
        rounds[5] = fray;
      }
      fray.won = true;
      fray.standing = Number(count[1]);
      crewSize ??= Number(count[2]);
    }
  }
  if (!ended) return null;
  crew = alphabetize(crew ?? []);
  // Reaching a later fray confirms earlier wins even across a gap in the log.
  const fraysWon = Math.max(0, ...rounds.map((round, index) => round ? index + Number(round.won === true) : 0));
  return {
    players: crew,
    crewSize: crewSize ?? (crew.length || null),
    loot,
    fraysWon,
    result: result ?? (rounds[5]?.won ? "Won" : null),
    frays: rounds.flatMap((round, index) => round ? [{
      number: index + 1,
      result: round.won === null ? null : round.won ? "Won" : "Lost",
      survivors: round.standing,
      deaths: crew.filter(name => round.eliminated.has(name)),
    }] : []),
  };
}
