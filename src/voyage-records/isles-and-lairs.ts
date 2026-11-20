import { alphabetize, elimination, leftVessel, pirateName, winners, type ChatEvent, type ExpeditionId, type Fray, type RunDetails, type RunResult } from './chat';

const islandLoot = /^Ye have taken aboard (\d+) (cursed chests?|fetish jars?|bone box(?:es)?)!$/i;
const lairLoot = /^Ye have taken aboard (\d+) (immortal chests?|nocturnal lockers?|blood box(?:es)?)!$/i;
const tierIndex: Record<string, number> = { cursed: 0, fetish: 1, bone: 2, immortal: 0, nocturnal: 1, blood: 2 };
const returned = /^Ye (?:abandoned the (?:island|gauntlet|sanctum)|return(?:ed)? to (?:yer|the) (?:ship|vessel))\b/i;
const rustling = "Ye hear the sound of rustling in coffins.";

export function parseIslesOrLair(events: Iterable<ChatEvent>, expedition: ExpeditionId, onEvent?: (event: ChatEvent) => void): RunDetails | null {
  const isLair = expedition === "vampireLairs";
  const lootPattern = isLair ? lairLoot : islandLoot;
  const loot: RunDetails['loot'] = [0, 0, 0];
  // Participants stay null until the end when a fray's crew had to be inferred.
  const frays: (Fray & { participants: string[] | null })[] = [];
  const eliminated = new Set<string>();
  let crew = null as string[] | null;
  // A crew inferred from eliminations alone is only the pirates who happened to die.
  let crewFromWinners = false;
  let result = null as RunResult | null;
  let terminalAt = null as number | null;
  let lootReported = false;
  let wonSinceRustling = false;

  function recordFray(won: boolean, names: string[] | null): void {
    if (names) {
      // The first winner list names the whole crew, including any pirates who were only
      // inferred from earlier frays that ended without one.
      if (!crewFromWinners) crew = alphabetize([...(crew ?? []), ...names]);
      crewFromWinners = true;
    } else if (!crewFromWinners && eliminated.size) {
      crew = alphabetize([...(crew ?? []), ...eliminated]);
    }
    const participants = names ?? (crewFromWinners ? crew : null);
    frays.push({
      number: frays.length + 1,
      result: won ? "Won" : "Lost",
      survivors: null,
      deaths: [...eliminated],
      participants,
    });
    eliminated.clear();
  }

  for (const event of events) {
    const { message, at } = event;
    if (terminalAt !== null && at !== null && at - terminalAt > 120_000) break;
    if (leftVessel.test(message) && (result || lootReported)) {
      onEvent?.(event);
      result ??= "Returned";
      break;
    }
    onEvent?.(event);
    const chest = lootPattern.exec(message);
    if (chest) {
      loot[tierIndex[chest[2].split(" ")[0].toLowerCase()]] += Number(chest[1]);
      lootReported = true;
      if (isLair) {
        result ??= "Returned";
        terminalAt ??= at;
      }
      continue;
    }
    if (result) continue;

    const outcome = winners.exec(message);
    const defeated = elimination.exec(message);
    if (outcome) {
      const pirates = outcome[1].split(", ").filter(name => pirateName.test(name));
      const won = pirates.length > 0;
      recordFray(won, won ? pirates : null);
      wonSinceRustling = won;
      if (!won) {
        result = "Lost";
        terminalAt = at;
      }
    } else if (defeated && pirateName.test(defeated[1])) {
      eliminated.add(defeated[1]);
    } else if (isLair && message === rustling) {
      // The station-period warning also confirms the preceding win after a log gap.
      if (!wonSinceRustling) recordFray(true, null);
      wonSinceRustling = false;
    } else if (!isLair && message.startsWith("The islanders reclaimed ")) {
      recordFray(false, null);
      result = "Lost";
      terminalAt = at;
    } else if (returned.test(message)) {
      result = "Returned";
      terminalAt = at;
    }
  }

  if (!result) return null;
  const players = crew ?? [];
  return {
    players,
    crewSize: players.length || null,
    loot,
    fraysWon: frays.filter(fray => fray.result === "Won").length,
    result,
    frays: frays.map(({ participants, ...fray }) => {
      const present = participants ?? players;
      const deaths = alphabetize(present.filter(name => fray.deaths.includes(name)));
      const survivors = fray.result === "Won" ? (present.length ? present.length - deaths.length : null) : 0;
      return { ...fray, survivors, deaths };
    }),
  };
}
