import { describe, expect, it } from 'vitest';
import { arrivals } from './chat';
import { cleanIgnoreList, expectedFamiliars, mergeRuns, oceanFromFileName, parseChatlogFile, parseExpeditionLog, personalBests, recordsByCrewSize, topChestShare, withoutIgnored, type Run } from './records';

function chat(messages: string[]) {
  return ["====== 2026/11/1 ======", ...messages.map((message, index) =>
    `[20:00:${String(index).padStart(2, "0")}] ${message}`)].join("\n");
}

it("Woodhallow marks an early defeat as the den result", () => {
  const [run] = parseExpeditionLog(chat([
    arrivals.woodhallow,
    "Wolf-kin approach!",
    "Get ready!",
    "Aster is eliminated!",
    "Birch is eliminated!",
    "Game over.  Winner: Hunting Wolfe.",
    "The pack has overrun the crew! Ye flee back to the ship.",
  ]));
  expect(run.result).toBe("Lost");
  expect(run.fraysWon).toBe(0);
  expect(run.frays).toEqual([{ number: 1, result: "Lost", survivors: 0, deaths: ["Aster", "Birch"] }]);
});

it("Cursed Isles sums aboard batches, including the final salvage", () => {
  const [run] = parseExpeditionLog(chat([
    arrivals.cursedIsles,
    "Birch is eliminated!",
    "Game over.  Winners: Birch, Aster, Aster's Thrall, Axel Mean.",
    "Ye have taken aboard 4 cursed chests!",
    "Ye have taken aboard 2 fetish jars!",
    "Game over.  Winners: Aster, Birch.",
    "Ye have taken aboard 2 cursed chests!",
    "Aster is eliminated!",
    "Birch is eliminated!",
    "Game over.  Winner: Vicious Cultist.",
    "The islanders reclaimed 5 cursed chests!",
    "Ye have taken aboard 1 cursed chest!",
    "The booty has been divided!",
    "Ye have taken aboard 99 cursed chests!",
  ]));
  expect(run.loot).toEqual([7, 2, 0]);
  expect(run.score).toBe(25);
  expect(run.result).toBe("Lost");
  expect(run.fraysWon).toBe(2);
  expect(run.crewSize).toBe(2);
  expect(run.frays[0].survivors).toBe(1);
  expect(run.frays[0].deaths).toEqual(["Birch"]);
});

it("Vampire Lairs counts frays through the return order and reads the final payout", async () => {
  const text = chat([
    arrivals.vampireLairs,
    "Game over.  Winners: Birch, Aster.",
    "Ye hear the sound of rustling in coffins.",
    "Aster ordered everyone back to the ship!",
    "Aster is eliminated!",
    "Ye hear the sound of rustling in coffins.",
    "Ye have taken aboard 3 blood boxes!",
    "Ye have taken aboard 2 nocturnal lockers!",
    "Ye have taken aboard 1 immortal chest!",
  ]);
  const file = new File([text], "Aster_emerald_x");
  const [run] = await parseChatlogFile(file);
  expect(run.ocean).toBe("emerald");
  expect(run.fraysWon).toBe(2);
  expect(run.result).toBe("Returned");
  expect(run.loot).toEqual([1, 2, 3]);
  expect(run.score).toBe(6);
  expect(run.frays[1].deaths).toEqual(["Aster"]);
});

it("records keep oceans separate and rank chest count and score independently", () => {
  const run = { expedition: "woodhallow", ocean: "emerald", crewSize: 1, loot: [3, 0, 0], score: 9 } as Run;
  const scoreLeader: Run = { ...run, loot: [2, 2, 0], score: 10 };
  const ice: Run = { ...run, ocean: "ice", loot: [12, 0, 0], score: 36 };
  const [emerald, iceGroup] = recordsByCrewSize([run, scoreLeader, ice]);
  expect(emerald.totalTopTierAboard).toBe(5);
  expect(emerald.maxChests).toBe(run);
  expect(emerald.maxScore).toBe(scoreLeader);
  expect(iceGroup.maxChests).toBe(ice);
  expect(() => parseExpeditionLog(chat([
    "It is currently 1:00 PM on the Ice ocean.",
  ]), { ocean: "emerald" })).toThrow(/more than one ocean/);
});

it("Vampire Lairs keeps a defeat when the crew brings loot back", () => {
  const [run] = parseExpeditionLog(chat([
    arrivals.vampireLairs,
    "Aster is eliminated!",
    "Game over.  Winner: Nocturnal Edward.",
    "Ye have taken aboard 2 blood boxes!",
  ]));
  expect(run.result).toBe("Lost");
  expect(run.fraysWon).toBe(0);
  expect(run.frays[0].survivors).toBe(0);
  expect(run.loot).toEqual([0, 0, 2]);
});

it("splits each voyage's tier 3 chests by its own crew, skipping unknown crews", () => {
  const voyage = (top: number, crewSize: number | null) => ({ loot: [top, 50, 50], crewSize }) as Run;
  const share = topChestShare([voyage(100, 5), voyage(30, 2), voyage(90, null)]);
  expect(share).toBe(35);
  expect(expectedFamiliars(share)).toBe(0.035);
});

it("leaves out voyages with an ignored pirate aboard, whatever the capitals", () => {
  const voyage = (...players: string[]) => ({ players }) as Run;
  const kept = voyage("Aster", "Birch");
  expect(withoutIgnored([kept, voyage("Aster", "Cedar")], ["cedar"])).toEqual([kept]);
  expect(withoutIgnored([kept], [])).toEqual([kept]);
});

it("keeps each ignored name once, tidied and sorted", () => {
  expect(cleanIgnoreList([" Birch", "aster", "BIRCH", ""])).toEqual(["aster", "BIRCH"]);
});

it("marks voyages that beat the best so far at their own crew size", () => {
  const voyage = (crewSize: number | null, score: number, chests = 0) =>
    ({ expedition: "woodhallow", ocean: "emerald", crewSize, score, loot: [chests, 0, 0] }) as Run;
  const first = voyage(5, 100, 10), worse = voyage(5, 90, 5), better = voyage(5, 120, 10), tied = voyage(5, 120, 10);
  const moreChests = voyage(5, 110, 12), both = voyage(5, 130, 13);
  const otherCrew = voyage(6, 110, 1), otherBetter = voyage(6, 115, 1), unknown = voyage(null, 999, 99);
  const bests = personalBests([first, worse, otherCrew, better, tied, moreChests, both, otherBetter, unknown]);
  expect([...bests]).toEqual([
    [better, { score: true, chests: false }],
    [moreChests, { score: false, chests: true }],
    [both, { score: true, chests: true }],
    [otherBetter, { score: true, chests: false }],
  ]);
});

it("only game ocean names are read from a file name", () => {
  expect(oceanFromFileName("Aster_emerald_x")).toBe("emerald");
  expect(oceanFromFileName("Aster_emerald_backup_x")).toBe("emerald");
  expect(oceanFromFileName("my_log.txt")).toBe(null);
  expect(oceanFromFileName("chatlog")).toBe(null);
});

describe("mergeRuns", () => {
  const voyage = {
    expedition: "woodhallow", ocean: "emerald", startedAt: 1_000_000, players: ["Aster", "Birch"], crewSize: 2,
    loot: [3, 1, 0], score: 11, fraysWon: 6, result: "Won", frays: [],
  } as Run;

  it("keeps one copy of a voyage seen in two logs and sorts oldest first", () => {
    const earlier: Run = { ...voyage, startedAt: 500_000, loot: [1, 0, 0] };
    const otherPirate: Run = { ...voyage, startedAt: voyage.startedAt! + 4_000 };
    expect(mergeRuns([[earlier, voyage], [otherPirate]])).toEqual([earlier, voyage]);
  });

  it("keeps two voyages that happen to match but sailed later", () => {
    const later: Run = { ...voyage, startedAt: voyage.startedAt! + 3_600_000 };
    expect(mergeRuns([[voyage], [later]])).toEqual([voyage, later]);
  });

  it("keeps two quick matching voyages from one log, and drops both copies from a backup", () => {
    const again: Run = { ...voyage, startedAt: voyage.startedAt! + 60_000 };
    expect(mergeRuns([[voyage, again]])).toEqual([voyage, again]);
    expect(mergeRuns([[voyage, again], [{ ...voyage }, { ...again }]])).toEqual([voyage, again]);
  });

  it("keeps undated voyages, which cannot be matched", () => {
    const undated: Run = { ...voyage, startedAt: null };
    expect(mergeRuns([[undated], [undated]])).toHaveLength(2);
  });
});
