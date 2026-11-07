import { alphabetize, elimination, leftVessel, pirateName, winners, type ChatEvent, type ExpeditionId, type Fray, type RunDetails, type RunResult } from './chat';

const islandLoot = /^Ye have taken aboard (\d+) (cursed chests?|fetish jars?|bone box(?:es)?)!$/i;
const lairLoot = /^Ye have taken aboard (\d+) (immortal chests?|nocturnal lockers?|blood box(?:es)?)!$/i;
const tierIndex: Record<string, number> = { cursed: 0, fetish: 1, bone: 2, immortal: 0, nocturnal: 1, blood: 2 };
const returned = /^Ye (?:abandoned the (?:island|gauntlet|sanctum)|return(?:ed)? to (?:yer|the) (?:ship|vessel))\b/i;
const rustling = "Ye hear the sound of rustling in coffins.";

export function parseIslesOrLair(events: Iterable<ChatEvent>, expedition: ExpeditionId): RunDetails | null {
  const isLair = expedition === "vampireLairs";
  const lootPattern = isLair ? lairLoot : islandLoot;
  const loot: RunDetails['loot'] = [0, 0, 0];
  const frays: Fray[] = [];
  const eliminated = new Set<string>();
  let crew = null as string[] | null;
  let result = null as RunResult | null;
  let terminalAt = null as number | null;
  let lootReported = false;
  let wonSinceRustling = false;

  function recordFray(won: boolean, names: string[] | null): void {
    const participants = names ?? crew ?? [...eliminated];
    if (participants.length) crew ??= alphabetize(participants);
    const deaths = alphabetize(participants.filter(name => eliminated.has(name)));
    const number = frays.length + 1;
    frays.push({
      number,
      result: won ? "Won" : "Lost",
      survivors: won ? (participants.length ? participants.length - deaths.length : null) : 0,
      deaths,
    });
    eliminated.clear();
  }

  for (const { message, at } of events) {
    if (terminalAt !== null && at !== null && at - terminalAt > 120_000) break;
    if (leftVessel.test(message) && (result || lootReported)) {
      result ??= "Returned";
      break;
    }
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
    frays,
  };
}
