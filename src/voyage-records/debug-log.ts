import { arrivals, chatEvents, pirateName, winners, type ExpeditionId } from './chat';
import type { Run } from './records';
import { isExcludedRun } from './known-records';

/** A positive list: unknown messages are never included in a shared debug log. */
export const DEBUG_LOG_INCLUDES = [
  'Voyage dates, times and arrival messages',
  'Fray starts, pirate and enemy eliminations, winners and survivor counts',
  'Combat team sizes, knockouts and team outcomes',
  'Station-period warnings, such as rustling in coffins',
  'Wave timers, transformation counts, crew recalls and individual abandonments',
  'Cursed Isles forage/wave transitions and thrall gains or losses',
  'Chests taken aboard or reclaimed',
  'Victory, defeat, retreat and return events',
  'Departure and booty-division markers, with vessel names removed',
];

const winnerNames = /^Game over\.\s+Winners?: [\w'-]+(?: [\w'-]+)*(?:, [\w'-]+(?: [\w'-]+)*)*\.$/;
// NPC names can have several words, numbers or punctuation such as "Dr. Acula".
// Keep the complete event shape; chat punctuation and arbitrary message suffixes stay excluded.
const eliminated = /^([\p{L}\p{N}_][\p{L}\p{N}\p{M}_'’ .-]*) is eliminated!$/u;
const combatName = String.raw`[\p{L}\p{N}_][\p{L}\p{N}\p{M}_'’ .-]*`;
const combatTeam = `${combatName}(?:, ${combatName})*`;
const combatStarted = new RegExp(`^Puzzle started \\((${combatTeam}) vs\\. (${combatTeam})\\)\\.$`, 'u');
const knockedOut = new RegExp(`^${combatName} was knocked out!$`, 'u');
const genericCombat = new Set([
  'Ye be knocked out!', 'Ye be the victor!', 'Ye be defeated!',
  'Yer team is victorious!', 'Yer team is defeated!',
]);
const chestKinds: Record<ExpeditionId, string> = {
  woodhallow: 'dire chests?|lunar lockers?|wolf boxes|wolf box',
  cursedIsles: 'cursed chests?|fetish jars?|bone box(?:es)?',
  vampireLairs: 'immortal chests?|nocturnal lockers?|blood box(?:es)?',
};
const chestReports = Object.fromEntries(Object.entries(chestKinds).map(([voyage, kinds]) => {
  const chest = `\\d+ (?:${kinds})`;
  const action = voyage === 'cursedIsles' ? '(?:Ye have taken aboard|The islanders reclaimed)' : 'Ye have taken aboard';
  return [voyage, new RegExp(`^${action} ${chest}(?:(?:, and |, | and )${chest})*!$`, 'i')];
})) as Record<ExpeditionId, RegExp>;
const woodhallow = [
  /^(?:Beware! More )?(?:wolf-kin|wolven) approach!$/i,
  /^Get ready!$/,
  /^We've reached their lair! Almost done!$/,
  /^\d+ o' \d+ still standin'! (?:To yer stations!|Plunder the lair!)$/,
  /^Ye have taken aboard (?:\d+ (?:dire chests?|lunar lockers?|wolf boxes|wolf box)|m\.werewolf_(?:small|medium|large)_treasure\(\d+\))!$/i,
  /^The pack has overrun the crew! Ye flee back to the ship\.$/,
  /^The lair be plundered! The night be yers!$/,
  /^The wolven gather! \d+ seconds!$/,
  /^The lair stirs! \d+ seconds left to forage!$/,
  /^Transformation! \d+ werewolves have transformed!$/,
  /^The next wolven wave will arrive in \d+ minutes\. Get to it!$/,
  /^The more of ye survive, the longer ye'll have to forage!$/,
  /^Explore further into the forest or retreat! Now's the time to decide\.$/,
  /^[\w'-]+ has ordered a retreat! The crew falls back to the ship\.$/,
  /^[\w'-]+ has abandoned the challenge and gone back to the ship\.$/,
  /^Trot back to yer vessel to lick yer wounds n' count yer wolfish winnings\.$/,
];
const isles = [
  /^Ye have taken aboard \d+ (?:cursed chests?|fetish jars?|bone box(?:es)?)!$/i,
  /^The islanders reclaimed \d+ (?:cursed chests?|fetish jars?|bone box(?:es)?)!$/i,
  /^With the islanders subdued, ye may forage their riches till they return\.$/,
  /^A larger group of islanders approaches, intent on driving ye back to the sea\. Ye stop yer foraging to decide between making yer escape and preparing for the onslaught\.$/,
  /^The boarders from the raft disembark as well and prepare to join their brethren in defending the island!$/,
  /^[\w'-]+ has taken control of a zombie\.$/,
  new RegExp(`^${combatName} was defeated and shambles off into the ocean\\.$`, 'u'),
  /^Look lively! The cultists are regrouping for another attack!$/,
];
const lairs = [
  /^Ye have taken aboard \d+ (?:immortal chests?|nocturnal lockers?|blood box(?:es)?)!$/i,
  /^Ye hear the sound of rustling in coffins\.$/,
  /^Time to rejoin the ship \(mostly\) unscathed\.$/,
];

function allowedMessage(message: string, voyage: ExpeditionId): string | null {
  if (message === arrivals[voyage] || winnerNames.test(message) || eliminated.test(message)) return message;
  if (combatStarted.test(message) || knockedOut.test(message) || genericCombat.has(message)) return message;
  if (chestReports[voyage].test(message)) return message;
  if (/^[\w'-]+ ordered everyone back (?:to|aboard) the ship!$/.test(message)) return message;
  if (message === 'The booty has been divided!' || message === 'Ye have left the vessel.') return message;
  // Preserve parser boundaries without exporting a vessel name or an arbitrary message suffix.
  if (/^Going aboard .+$/.test(message)) return 'Ye have left the vessel.';
  if (voyage === 'woodhallow') {
    if (woodhallow.some((pattern) => pattern.test(message))) return message;
    if (message.startsWith('The crew falls back')) return 'The crew falls back.';
    if (message.startsWith('Ye retreat')) return 'Ye retreat.';
    if (message.endsWith('calls the crew back to the ship. Every chest be yers!')) return 'The captain calls the crew back to the ship. Every chest be yers!';
  } else {
    if ((voyage === 'vampireLairs' ? lairs : isles).some((pattern) => pattern.test(message))) return message;
    if (/^Ye (?:abandoned the (?:island|gauntlet|sanctum)|return(?:ed)? to (?:yer|the) (?:ship|vessel))\b/i.test(message)) return 'Ye returned to the ship.';
    if (voyage === 'cursedIsles' && message.startsWith('The islanders reclaimed ')) return 'The islanders reclaimed the island.';
  }
  return null;
}

/** Only approved events, never chat, login notifications, file paths or other free text. */
export function debugLog(text: string, voyage: ExpeditionId): string {
  const lines: string[] = [];
  const original = text.split('\n');
  let day: string | null = null;
  for (const event of chatEvents(text)) {
    const message = allowedMessage(event.message, voyage);
    if (message === null) continue;
    const raw = original[event.line! - 1].trim();
    const clock = /^\[((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)\] /.exec(raw)?.[1];
    if (!clock) continue;
    if (event.at !== null) {
      const date = new Date(event.at).toISOString().slice(0, 10);
      if (date !== day) lines.push(`====== ${date.replaceAll('-', '/')} ======`);
      day = date;
    }
    lines.push(`[${clock}] ${message}`);
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

const voyageNames: Record<ExpeditionId, string> = { woodhallow: 'Woodhallow', cursedIsles: 'Cursed Isles', vampireLairs: 'Vampire Lairs' };
const chestNames: Record<ExpeditionId, [string, string, string]> = {
  woodhallow: ['Dire chests', 'Lunar lockers', 'Wolf boxes'],
  cursedIsles: ['Cursed chests', 'Fetish jars', 'Bone boxes'],
  vampireLairs: ['Immortal chests', 'Nocturnal lockers', 'Blood boxes'],
};

function timestamp(at: number | null): string {
  return at === null || !Number.isFinite(at) ? 'Unknown' : new Date(at).toISOString().slice(0, 19).replace('T', ' ');
}

function duration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((value) => String(value).padStart(2, '0')).join(':');
}

/** Adds the actual parsed results, with evidence and limitations, to the same filtered log. */
export function debugExport(run: Run): string {
  const filtered = debugLog(run.source?.text ?? '', run.expedition);
  const events = [...chatEvents(filtered)];
  const arrival = events.find((event) => event.message === arrivals[run.expedition]);
  const last = events.at(-1);
  const hasEndMarker = last !== undefined && (last.message === 'The booty has been divided!' || last.message === 'Ye have left the vessel.');
  const notes: string[] = [];
  const excludedFromRecords = isExcludedRun(run);
  if (excludedFromRecords) notes.push('This voyage is not eligible for global records under the current record rules.');
  const safeCrew = run.players.map((name) => /^[\w'-]+(?: [\w'-]+)*$/.test(name) ? name : '[unrecognised name omitted]');
  const ocean = run.ocean !== null && /^[a-z]+$/i.test(run.ocean) ? run.ocean : 'Unknown';
  const crewSize = run.crewSize ?? 'Unknown';
  const observedWins = run.frays.filter((fray) => fray.result === 'Won').length;
  const lost = run.frays.filter((fray) => fray.result === 'Lost').length;
  const unresolved = run.frays.filter((fray) => fray.result === null).length;
  const eliminations = events.flatMap((event) => {
    const name = eliminated.exec(event.message)?.[1];
    return name ? [name] : [];
  });
  const crewNames = new Set(run.players.map((name) => name.toLowerCase()));
  const outsideCrew = [...new Set(eliminations.filter((name) => !crewNames.has(name.toLowerCase())))];
  const winnerCounts = events.flatMap((event) => {
    const names = winners.exec(event.message)?.[1].split(', ').filter((name) => pirateName.test(name));
    return names?.length ? [names.length] : [];
  });
  const uniqueCounts = [...new Set(winnerCounts)].sort((a, b) => a - b);
  const teamSizes = events.flatMap((event) => {
    const teams = combatStarted.exec(event.message);
    if (!teams) return [];
    const size = (team: string) => /^\d+$/.test(team) ? Number(team) : team.split(', ').length;
    return [`${size(teams[1])} vs ${size(teams[2])}`];
  });
  const expectedScore = run.expedition === 'vampireLairs' ? run.loot[0] + run.loot[1] + run.loot[2] : 3 * run.loot[0] + 2 * run.loot[1] + run.loot[2];
  let length = 'Unknown (arrival or end timestamp missing)';
  if (arrival?.at !== null && arrival?.at !== undefined && last?.at !== null && last?.at !== undefined) {
    const elapsed = last.at - arrival.at;
    if (elapsed >= 0) length = `${duration(elapsed)} (${hasEndMarker ? 'arrival to departure/booty division' : 'recorded span; end not confirmed'})`;
    else notes.push('Event timestamps run backwards; duration could not be calculated.');
  }
  if (!arrival) notes.push('Arrival message missing from the excerpt.');
  else if (arrival.at !== run.startedAt) notes.push('The parsed start time differs from the arrival event timestamp.');
  if (!hasEndMarker) notes.push('No departure/booty-division marker; the recorded span may be shorter than the full voyage.');
  if (run.startedAt === null) notes.push('Voyage date unknown; full duration cannot be calculated reliably.');
  if (run.crewSize === null) notes.push('Crew size could not be determined.');
  else if (run.crewSize !== run.players.length) notes.push(`Crew size (${run.crewSize}) differs from the number of identified pirates (${run.players.length}).`);
  if (uniqueCounts.length > 1) notes.push(`Winner-list pirate counts vary: ${uniqueCounts.join(', ')}.`);
  if (run.crewSize !== null && uniqueCounts.some((size) => size > run.crewSize!)) notes.push('At least one winner list contains more pirates than the parsed crew size.');
  if (run.frays.length === 0) notes.push('No fray details were captured.');
  if (resultUnknownWithRetreat(run, events.map((event) => event.message))) notes.push('A retreat/abandonment message is present, but the parsed result is unknown.');
  if (run.fraysWon > observedWins) notes.push(`${run.fraysWon - observedWins} fray win(s) inferred across log gaps or station warnings.`);
  if (expectedScore !== run.score) notes.push(`Score does not match the loot formula (expected ${expectedScore}).`);
  if (events.some((event) => chestReports[run.expedition].test(event.message) && /, | and /.test(event.message))) notes.push('A combined chest report is present; review whether the current parser counted every chest type.');
  const result = run.result !== null && ['Won', 'Lost', 'Retreated', 'Returned'].includes(run.result) ? run.result : 'Unknown';
  const lines = [
    'Voyage debug export v1',
    'Values below are the current parser output, not verified records.',
    `Voyage: ${voyageNames[run.expedition]}`,
    `Ocean: ${ocean}`,
    'Times: chatlog clock; timezone not recorded',
    `Started: ${timestamp(run.startedAt)}`,
    `${hasEndMarker ? 'Ended' : 'Last recorded voyage event'}: ${timestamp(last?.at ?? null)}`,
    `Run length: ${length}`,
    `Result: ${result}`,
    `Global record eligibility: ${excludedFromRecords ? 'Excluded by current rules' : 'Not excluded by current rules (not verification)'}`,
    `Crew size (inferred): ${crewSize}`,
    `Identified pirates (${run.players.length}): ${safeCrew.join(', ') || 'None'}`,
    `Loot: ${chestNames[run.expedition].map((name, index) => `${name}=${run.loot[index]}`).join('; ')}`,
    `Score: ${run.score}; formula: ${run.expedition === 'vampireLairs' ? 'T3 + T2 + T1' : '3*T3 + 2*T2 + T1'} = ${expectedScore}`,
    `Frays recorded: ${run.frays.length}; wins (including inferred): ${run.fraysWon}; observed wins: ${observedWins}; losses: ${lost}; unresolved: ${unresolved}`,
    `Winner-list pirate counts, in order: ${winnerCounts.join(', ') || 'None captured'}`,
    `Combat-start team sizes (sides as logged): ${teamSizes.join('; ') || 'None captured'}`,
    `Elimination events: ${eliminations.length}; distinct names: ${new Set(eliminations).size}`,
    `Eliminated names outside inferred crew (NPCs or unidentified pirates): ${outsideCrew.join(', ') || 'None'}`,
    ...run.frays.map((fray) => `Fray ${fray.number}: ${fray.result ?? 'Unresolved'}; survivors=${fray.survivors ?? 'Unknown'}; identified pirate deaths=${fray.deaths.length}`),
    `Timestamped events: ${events.length} included; ${[...chatEvents(run.source?.text ?? '')].length - events.length} omitted by the privacy filter`,
    ...notes.map((note) => `Check: ${note}`),
    ...(notes.length ? [] : ['Checks: no inconsistencies detected by these checks']),
    'Filtered voyage events follow. Chat, tells and unrelated messages are omitted.',
  ];
  return `${lines.map((line) => `# ${line}`).join('\n')}\n\n${filtered}`;
}

function resultUnknownWithRetreat(run: Run, messages: string[]): boolean {
  return run.result === null && messages.some((message) => /has ordered a retreat!|has abandoned the challenge/.test(message));
}
