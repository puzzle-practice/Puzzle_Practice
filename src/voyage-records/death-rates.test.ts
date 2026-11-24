import { describe, expect, it } from 'vitest';
import { arrivals } from './chat';
import { deathRates, inDateRange, sortDeathRates, type DeathRate } from './death-rates';
import { parseExpeditionLog, type Run } from './records';

/** Lines at the given clock times (HH:MM:SS) on one log day. */
function timed(lines: [string, string][]): string {
  return ["====== 2026/11/1 ======", ...lines.map(([time, message]) => `[${time}] ${message}`)].join("\n");
}

const crew = ["Aster", "Birch", "Cedar", "Dahlia"];
const won = `Game over.  Winners: ${crew.join(", ")}.`;

function rateOf(rates: DeathRate[], pirate: string) {
  const rate = rates.find(entry => entry.pirate === pirate)!;
  return { voyages: rate.voyages, frays: rate.frays, died: rate.died };
}

describe("Woodhallow death rates", () => {
  const den = timed([
    ["20:00:00", arrivals.woodhallow],
    ["20:00:05", "Wolf-kin approach!"],
    ["20:00:10", "Get ready!"],
    ["20:01:00", "Aster is eliminated!"],
    ["20:03:00", won],
    ["20:03:01", "4 o' 4 still standin'! To yer stations!"],
    ["20:05:00", "Beware! More wolven approach!"],
    ["20:05:05", "Get ready!"],
    ["20:06:00", "Birch is eliminated!"],
    ["20:08:00", won],
    ["20:08:01", "3 o' 4 still standin'! To yer stations!"],
    ["20:10:00", "Wolf-kin approach!"],
    ["20:10:05", "Get ready!"],
    // Within two minutes (plus the five second countdown) of the fray starting.
    ["20:12:09", "Cedar is eliminated!"],
    ["20:13:00", "Aster is eliminated!"],
    ["20:13:01", "Birch is eliminated!"],
    ["20:13:02", "Dahlia is eliminated!"],
    ["20:13:03", "Game over.  Winner: Hunting Wolfe."],
    ["20:13:04", "The pack has overrun the crew! Ye flee back to the ship."],
  ]);

  it("marks early deaths in a lost fray", () => {
    const [run] = parseExpeditionLog(den);
    expect(run.frays[2]).toMatchObject({ result: "Lost", earlyDeaths: ["Cedar"] });
  });

  it("leaves out the first fray, counts wins for everyone and losses only for early deaths", () => {
    const rates = deathRates(parseExpeditionLog(den), "woodhallow");
    expect(rateOf(rates, "Aster")).toEqual({ voyages: 1, frays: 1, died: 0 });
    expect(rateOf(rates, "Birch")).toEqual({ voyages: 1, frays: 1, died: 1 });
    expect(rateOf(rates, "Cedar")).toEqual({ voyages: 1, frays: 2, died: 1 });
    expect(rateOf(rates, "Dahlia")).toEqual({ voyages: 1, frays: 1, died: 0 });
  });

  it("only counts dens of four or more", () => {
    const [run] = parseExpeditionLog(den);
    expect(deathRates([{ ...run, crewSize: 3 }], "woodhallow")).toEqual([]);
    expect(deathRates([{ ...run, crewSize: null }], "woodhallow")).toEqual([]);
    expect(deathRates([run], "vampireLairs")).toEqual([]);
  });
});

describe("Vampire Lairs death rates", () => {
  const lair = timed([
    ["20:00:00", arrivals.vampireLairs],
    ["20:01:10", "Ageless Drac is eliminated!"],
    ["20:01:30", "Aster is eliminated!"],
    ["20:02:00", won],
    ["20:03:48", "Ye hear the sound of rustling in coffins."],
    ["20:05:00", "Stygian Orlok is eliminated!"],
    ["20:05:20", "Birch is eliminated!"],
    ["20:06:00", "Cedar is eliminated!"],
    // More than a minute after the fray's first elimination.
    ["20:06:30", "Aster is eliminated!"],
    ["20:06:40", "Dahlia is eliminated!"],
    ["20:06:41", "Game over.  Winners: Nocturnal Circe, Revenant Mina."],
  ]);

  it("times early deaths from a lost fray's first elimination", () => {
    const [run] = parseExpeditionLog(lair);
    expect(run.result).toBe("Lost");
    expect(run.frays.map(fray => fray.earlyDeaths)).toEqual([undefined, ["Birch", "Cedar"]]);
  });

  it("counts the first fray, and losses only for pirates who fell within a minute", () => {
    const rates = deathRates(parseExpeditionLog(lair), "vampireLairs");
    expect(rateOf(rates, "Aster")).toEqual({ voyages: 1, frays: 1, died: 1 });
    expect(rateOf(rates, "Birch")).toEqual({ voyages: 1, frays: 2, died: 1 });
    expect(rateOf(rates, "Cedar")).toEqual({ voyages: 1, frays: 2, died: 1 });
    expect(rateOf(rates, "Dahlia")).toEqual({ voyages: 1, frays: 1, died: 0 });
  });

  it("counts each won fray for the pirates who fought it", () => {
    const [run] = parseExpeditionLog(timed([
      ["20:00:00", arrivals.vampireLairs],
      ["20:02:00", won],
      ["20:03:48", "Ye hear the sound of rustling in coffins."],
      ["20:06:00", `Game over.  Winners: ${[...crew, "Elm"].join(", ")}.`],
      ["20:07:48", "Ye hear the sound of rustling in coffins."],
      ["20:08:00", "Ye have taken aboard 3 blood boxes!"],
      ["20:08:05", "The booty has been divided!"],
    ]));
    expect(run.frays[1].crew).toEqual([...crew, "Elm"]);
    const rates = deathRates([run], "vampireLairs");
    expect(rateOf(rates, "Aster")).toEqual({ voyages: 1, frays: 2, died: 0 });
    expect(rateOf(rates, "Elm")).toEqual({ voyages: 1, frays: 1, died: 0 });
  });
});

describe("sorting and dates", () => {
  const rates: DeathRate[] = [
    { pirate: "Birch", voyages: 2, frays: 10, died: 1, rate: 0.1 },
    { pirate: "Aster", voyages: 3, frays: 20, died: 2, rate: 0.1 },
    { pirate: "Cedar", voyages: 1, frays: 5, died: 5, rate: 1 },
  ];

  it("sorts by any column, ties falling back to most frays then name", () => {
    expect(sortDeathRates(rates, "rate", true).map(rate => rate.pirate)).toEqual(["Cedar", "Aster", "Birch"]);
    expect(sortDeathRates(rates, "rate", false).map(rate => rate.pirate)).toEqual(["Aster", "Birch", "Cedar"]);
    expect(sortDeathRates(rates, "pirate", false).map(rate => rate.pirate)).toEqual(["Aster", "Birch", "Cedar"]);
  });

  it("keeps voyages between two days, both included", () => {
    const on = (day: string) => ({ startedAt: Date.parse(`${day}T20:00:00Z`) }) as Run;
    expect(inDateRange(on("2026-11-01"), "2026-11-01", "2026-11-02")).toBe(true);
    expect(inDateRange(on("2026-11-03"), "2026-11-01", "2026-11-02")).toBe(false);
    expect(inDateRange(on("2026-11-03"), "2026-11-02", "")).toBe(true);
    expect(inDateRange({ startedAt: null } as Run, "", "")).toBe(true);
    expect(inDateRange({ startedAt: null } as Run, "2026-11-01", "")).toBe(false);
  });
});
