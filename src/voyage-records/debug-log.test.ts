import { describe, expect, it } from 'vitest';
import { arrivals, type ExpeditionId } from './chat';
import { debugExport, debugLog } from './debug-log';
import { parseExpeditionLog } from './records';

const excluded = [
  'Jice says, "f"',
  'Amizing tells ye, "yer not streamin :p"',
  'Ye told Amizing, "lol"',
  'Amizing is rumbling and might be too busy to respond.',
  'Yer crew member Rudis has logged off.',
  'Yer hearty, Rudis, has logged off.',
  'Oh, ye booched it!',
  'Jice crew chats, "my password is private"',
  'Jice flag officer chats, "private meeting"',
  'Jice broadcasts, "private message"',
  'Jice says, "Game over.  Winners: Aster, Birch."',
  'Ye told Amizing, "Ye have taken aboard 99 immortal chests!"',
  'Ye have taken aboard 99 immortal chests! Secret extra text',
  'Game over.  Winner: email@example.com.',
  'Game over.  Winner: "secret text".',
  'An unknown new server message with private details.',
];

function log(messages: string[]): string {
  return ['====== 2026/11/18 ======', ...messages.map((message, index) => `[21:00:${String(index).padStart(2, '0')}] ${message}`)].join('\r\n');
}

it('excludes chat, tells, presence, puzzle feedback and all unknown messages', () => {
  const text = log([arrivals.vampireLairs, ...excluded, 'Game over.  Winners: Aster, Birch.', 'Ye have taken aboard 3 blood boxes!', 'The booty has been divided!']);
  const filtered = debugLog(text, 'vampireLairs');
  for (const message of excluded) expect(filtered).not.toContain(message);
  expect(filtered).toContain(arrivals.vampireLairs);
  expect(filtered).toContain('Game over.  Winners: Aster, Birch.');
  expect(filtered).toContain('3 blood boxes!');
  expect(filtered.split('\n').filter(Boolean)).toHaveLength(5);
  expect(debugLog(log(excluded), 'vampireLairs')).toBe('');
});

it('removes vessel names and arbitrary suffixes from recognised boundary events', () => {
  const text = log([
    arrivals.woodhallow,
    'The crew falls back to a private place.',
    'Ye retreat to a private place.',
    'A private captain calls the crew back to the ship. Every chest be yers!',
    'Going aboard a private vessel',
  ]);
  const filtered = debugLog(text, 'woodhallow');
  expect(filtered).not.toContain('private');
  expect(filtered).toContain('The crew falls back.');
  expect(filtered).toContain('Ye retreat.');
  expect(filtered).toContain('The captain calls the crew back to the ship. Every chest be yers!');
  expect(filtered).toContain('Ye have left the vessel.');
  expect(debugLog(log(['Ye returned to yer ship with private details']), 'vampireLairs')).toContain('Ye returned to the ship.');
});

describe('reconstructing a run from its filtered export', () => {
  const cases: [ExpeditionId, string[]][] = [
    ['woodhallow', [
      arrivals.woodhallow, 'Wolf-kin approach!', 'Get ready!', 'Birch is eliminated!',
      'Game over.  Winners: Aster, Birch.', "1 o' 2 still standin'! To yer stations!",
      'Beware! More wolven approach!', 'Get ready!', 'Game over.  Winner: Hunting Wolfe.',
      'The pack has overrun the crew! Ye flee back to the ship.',
      'Ye have taken aboard m.werewolf_large_treasure(5)!', 'Ye have taken aboard 10 lunar lockers!',
      'Ye have taken aboard 20 wolf boxes!', 'Going aboard Private Vessel',
    ]],
    ['cursedIsles', [
      arrivals.cursedIsles, 'Birch is eliminated!', "Game over.  Winners: Aster, Birch, Aster's Thrall, Axel Mean.",
      'Ye have taken aboard 4 cursed chests!', 'Ye have taken aboard 2 fetish jars!',
      'Aster is eliminated!', 'Birch is eliminated!', 'Game over.  Winner: Vicious Cultist.',
      'The islanders reclaimed 5 cursed chests!', 'Ye have taken aboard 1 cursed chest!', 'The booty has been divided!',
    ]],
    ['vampireLairs', [
      arrivals.vampireLairs, 'Game over.  Winners: Fortunae, Ragnarlothbr.',
      'Ye hear the sound of rustling in coffins.', 'Fortunae ordered everyone back to the ship!',
      'Fortunae is eliminated!', 'Ye hear the sound of rustling in coffins.',
      'Ye have taken aboard 68 immortal chests!', 'Ye have taken aboard 109 nocturnal lockers!',
      'Ye have taken aboard 253 blood boxes!', 'Ye have left the vessel.',
    ]],
  ];
  for (const [voyage, messages] of cases) {
    it(`keeps the crew, frays, loot, score and result for ${voyage}`, () => {
      const text = log(messages.flatMap((message, index) => [message, excluded[index % excluded.length]]));
      const [original] = parseExpeditionLog(text, { ocean: 'emerald' });
      const filtered = debugLog(original.source!.text, voyage);
      const [reconstructed] = parseExpeditionLog(filtered, { ocean: 'emerald' });
      const { source: _source, ...details } = original;
      expect(reconstructed).toMatchObject(details);
      expect(filtered).not.toMatch(/private|tells ye|Ye told|says,|logged off|booched/);
      expect(debugLog(filtered, voyage)).toBe(filtered);
    });
  }
});

it('retains the right dates when filtered chatter crosses midnight', () => {
  const text = '====== 2026/02/07 ======\n[23:59:50] Welcome to the vampire sanctum.\n[23:59:51] Game over.  Winners: Aster, Birch.\n[00:00:01] Ye told Birch, "private midnight chat"\n[00:00:10] Ye have taken aboard 5 blood boxes!\n[00:00:11] The booty has been divided!';
  const filtered = debugLog(text, 'vampireLairs');
  expect(filtered).toContain('====== 2026/02/08 ======');
  expect(filtered).not.toContain('private');
  const [original] = parseExpeditionLog(text);
  const { source: _source, ...details } = original;
  expect(parseExpeditionLog(filtered)[0]).toMatchObject(details);
});

it('does not export date-header comments, untimestamped text or invalid clock values', () => {
  const text = '====== 2026/11/18 ====== private note\nuntimestamped sensitive note\n[29:00:00] Ye have taken aboard 3 blood boxes!\n[21:00:00] Welcome to the vampire sanctum.';
  expect(debugLog(text, 'vampireLairs')).toBe('[21:00:00] Welcome to the vampire sanctum.\n');
});

it('retains named and numbered enemy eliminations without admitting quoted chat', () => {
  const text = log([
    arrivals.woodhallow,
    'Hunting Wolfe is eliminated!',
    'Wolf-kin 2 is eliminated!',
    'Werewolf is eliminated!',
    'Dr. Acula is eliminated!',
    'Señor Sable is eliminated!',
    'Aster is eliminated!',
    'Jice says, "Hunting Wolfe is eliminated!"',
    'Ye told Amizing, "Dr. Acula is eliminated!"',
    'Hunting Wolfe is eliminated! Secret extra text',
  ]);
  const filtered = debugLog(text, 'woodhallow');
  for (const name of ['Hunting Wolfe', 'Wolf-kin 2', 'Werewolf', 'Dr. Acula', 'Señor Sable', 'Aster']) expect(filtered).toContain(`${name} is eliminated!`);
  expect(filtered).not.toMatch(/says,|Ye told|Secret/);
  expect([...filtered.matchAll(/is eliminated!/g)].length).toBe(6);
});

it('includes actual calculations, duration and enemy evidence in a reparseable export', () => {
  const text = [
    '====== 2026/02/07 ======',
    '[02:07:49] Welcome to the vampire sanctum.',
    '[02:08:00] Nocturnal Edward is eliminated!',
    '[02:08:01] Vampire 2 is eliminated!',
    '[02:08:02] Fortunae is eliminated!',
    '[02:08:03] Game over.  Winners: Fortunae, Ragnarlothbr.',
    '[02:08:05] Ye hear the sound of rustling in coffins.',
    '[02:10:00] Jice tells ye, "sensitive private conversation"',
    '[02:20:00] Ye have taken aboard 68 immortal chests!',
    '[02:20:01] Ye have taken aboard 109 nocturnal lockers!',
    '[02:20:02] Ye have taken aboard 253 blood boxes!',
    '[02:20:03] Going aboard Secret Ship Name',
    '[02:20:30] Ye told Jice, "more private conversation"',
  ].join('\n');
  const [run] = parseExpeditionLog(text, { ocean: 'emerald' });
  const exported = debugExport(run);
  expect(exported).toMatch(/^# Voyage debug export v1/);
  expect(exported).toContain('# Crew size (inferred): 2');
  expect(exported).toContain('# Global record eligibility: Not excluded by current rules (not verification)');
  expect(exported).toContain('# Identified pirates (2): Fortunae, Ragnarlothbr');
  expect(exported).toContain('# Started: 2026-02-07 02:07:49');
  expect(exported).toContain('# Ended: 2026-02-07 02:20:03');
  expect(exported).toContain('# Run length: 00:12:14 (arrival to departure/booty division)');
  expect(exported).toContain('# Loot: Immortal chests=68; Nocturnal lockers=109; Blood boxes=253');
  expect(exported).toContain('# Score: 430; formula: T3 + T2 + T1 = 430');
  expect(exported).toContain('# Frays recorded: 1; wins (including inferred): 1; observed wins: 1; losses: 0; unresolved: 0');
  expect(exported).toContain('# Fray 1: Won; survivors=1; identified pirate deaths=1');
  expect(exported).toContain('# Elimination events: 3; distinct names: 3');
  expect(exported).toContain('NPCs or unidentified pirates): Nocturnal Edward, Vampire 2');
  expect(exported).not.toMatch(/sensitive|private conversation|Secret Ship Name/);
  const { source: _source, ...details } = run;
  expect(parseExpeditionLog(exported, { ocean: 'emerald' })[0]).toMatchObject(details);
});

it('flags changing crew evidence and calculated values that disagree', () => {
  const [parsed] = parseExpeditionLog(log([
    arrivals.vampireLairs,
    'Game over.  Winners: Aster, Birch.',
    'Ye hear the sound of rustling in coffins.',
    'Game over.  Winners: Aster, Birch, Cedar, Dune.',
    'Ye hear the sound of rustling in coffins.',
    'Ye have taken aboard 3 blood boxes!',
  ]), { ocean: 'emerald' });
  const exported = debugExport({ ...parsed, score: 999, fraysWon: 3 });
  expect(exported).toContain('# Score: 999; formula: T3 + T2 + T1 = 3');
  expect(exported).toContain('# Check: Score does not match the loot formula (expected 3).');
  expect(exported).toContain('# Winner-list pirate counts, in order: 2, 4');
  expect(exported).toContain('# Check: Winner-list pirate counts vary: 2, 4.');
  expect(exported).toContain('At least one winner list contains more pirates than the parsed crew size.');
  expect(exported).toContain('1 fray win(s) inferred');
  expect(exported).toContain('recorded span; end not confirmed');
  expect(exported).toContain('No departure/booty-division marker');
});

it('measures across midnight without counting later chatter as voyage duration', () => {
  const [run] = parseExpeditionLog('====== 2026/02/07 ======\n[23:59:50] Welcome to the vampire sanctum.\n[23:59:51] Game over.  Winners: Aster, Birch.\n[00:00:10] Ye have taken aboard 5 blood boxes!\n[00:00:50] Ye told Birch, "private"');
  const exported = debugExport(run);
  expect(exported).toContain('# Last recorded voyage event: 2026-02-08 00:00:10');
  expect(exported).toContain('# Run length: 00:00:20 (recorded span; end not confirmed)');
  expect(exported).not.toContain('private');
});

it('marks missing dates and crew as unknown without exposing unrecognised header values', () => {
  const [run] = parseExpeditionLog('[02:07:49] Welcome to the vampire sanctum.\n[02:20:02] Ye have taken aboard 3 blood boxes!');
  const exported = debugExport({ ...run, ocean: 'private@example.com', players: ['private@example.com\n# secret'], crewSize: null });
  expect(exported).toContain('# Started: Unknown');
  expect(exported).toContain('# Run length: Unknown (arrival or end timestamp missing)');
  expect(exported).toContain('# Crew size (inferred): Unknown');
  expect(exported).toContain('# Ocean: Unknown');
  expect(exported).toContain('No fray details were captured.');
  expect(exported).not.toMatch(/private@example.com|# secret/);
});

describe('additional voyage evidence from the game message bundles', () => {
  const retained: [ExpeditionId, string[]][] = [
    ['woodhallow', [
      'Transformation! 3 werewolves have transformed!',
      'The wolven gather! 30 seconds!',
      'The lair stirs! 20 seconds left to forage!',
      'The next wolven wave will arrive in 5 minutes. Get to it!',
      "The more of ye survive, the longer ye'll have to forage!",
      "Explore further into the forest or retreat! Now's the time to decide.",
      'Aster has ordered a retreat! The crew falls back to the ship.',
      'Birch has abandoned the challenge and gone back to the ship.',
      "Trot back to yer vessel to lick yer wounds n' count yer wolfish winnings.",
    ]],
    ['cursedIsles', [
      'With the islanders subdued, ye may forage their riches till they return.',
      'A larger group of islanders approaches, intent on driving ye back to the sea. Ye stop yer foraging to decide between making yer escape and preparing for the onslaught.',
      'The boarders from the raft disembark as well and prepare to join their brethren in defending the island!',
      'Aster has taken control of a zombie.',
      "Aster's Thrall was defeated and shambles off into the ocean.",
      'Look lively! The cultists are regrouping for another attack!',
      'Aster ordered everyone back aboard the ship!',
      'The islanders reclaimed 3 cursed chests, 2 fetish jars and 1 bone box!',
    ]],
    ['vampireLairs', [
      'Aster ordered everyone back to the ship!',
      'Time to rejoin the ship (mostly) unscathed.',
      'Ye have taken aboard 1 immortal chest, 2 nocturnal lockers, and 3 blood boxes!',
    ]],
  ];
  for (const [voyage, messages] of retained) {
    it(`retains diagnostic phase/crew/loot events for ${voyage} without quoted copies`, () => {
      const filtered = debugLog(log(messages.flatMap((message) => [message, `Jice says, "${message}"`])), voyage);
      for (const message of messages) expect(filtered).toContain(message);
      expect(filtered).not.toContain('Jice says');
    });
  }

  it('keeps combat starts, enemy knockouts and team outcomes for every voyage', () => {
    const messages = ['Puzzle started (2 vs. 4).', 'Puzzle started (Aster, Birch vs. Hunting Wolfe, Wolf-kin 2).', 'Hunting Wolfe was knocked out!', 'Ye be knocked out!', 'Yer team is victorious!', 'Yer team is defeated!', 'Ye be the victor!', 'Ye be defeated!'];
    for (const voyage of ['woodhallow', 'cursedIsles', 'vampireLairs'] as const) {
      const filtered = debugLog(log(messages), voyage);
      for (const message of messages) expect(filtered).toContain(message);
      expect(debugLog(log(['Puzzle started (email@example.com vs. password: secret).', 'Jice tells ye, "Yer team is victorious!"']), voyage)).toBe('');
    }
  });

  it('summarises logged team sizes without assuming which side is the pirate crew', () => {
    const [run] = parseExpeditionLog(log([arrivals.vampireLairs, 'Puzzle started (2 vs. 4).', 'Game over.  Winners: Aster, Birch.', 'Ye have taken aboard 3 blood boxes!']));
    expect(debugExport(run)).toContain('# Combat-start team sizes (sides as logged): 2 vs 4');
  });

  it('keeps combined chest losses intact and flags combined haul reports for review', () => {
    const text = log([arrivals.cursedIsles, 'Game over.  Winners: Aster, Birch.', 'Ye have taken aboard 3 cursed chests and 2 fetish jars!', 'The islanders reclaimed 2 cursed chests and 1 fetish jar!', 'The booty has been divided!']);
    const [run] = parseExpeditionLog(text);
    const exported = debugExport(run);
    expect(exported).toContain('The islanders reclaimed 2 cursed chests and 1 fetish jar!');
    expect(exported).toContain('A combined chest report is present');
    expect(debugLog(log(['The islanders reclaimed 2 cursed chests and private bank details!']), 'cursedIsles')).not.toContain('private');
  });
});
