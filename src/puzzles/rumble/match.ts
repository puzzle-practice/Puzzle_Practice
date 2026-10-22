// A rumble: you, fighter 0, and your teammates against the chosen opponents, or you on your own.
// Every pirate plays a real board (fighter.ts), the NPCs' shots picked by npc.ts. What happens between
// boards isn't known exactly, so those rules are settings: the time
// bonus, suppression by enemies on you and the drop-off it sends them, defence bars, and which
// wall a punch comes from.
import { Random } from '../../core/random';
import type { Sent, Shaft } from './board';
import { type Look, lookFor } from '../swordfight/faces';
import { Fighter, type FighterOptions, type SoundName } from './fighter';
import { BLUDGEONS, colourMapping, FISTS_TYPE, Glove, HOOK_TYPE, NPP_BLUDGEONS, WEREWOLF_TYPE } from './gloves';
import { NpcBrain, type NpcStyle } from './npc';
import { SWABBIE_FEMALE_NAMES, SWABBIE_MALE_NAMES, SWABBIE_SURNAMES } from '../swordfight/names';

export type Kind = 'You' | 'Brigand' | 'Barbarian' | 'Skilled swabbie' | 'Custom';

export interface NpcSettings {
  kind: Exclude<Kind, 'You'>;
  skill: number;
  /** A bludgeon type, or null for a random one each fight. Colours are always random. */
  bludgeon: number | null;
}

/** How strikes pass between pirates, approximated. */
export interface FightRules {
  /** Clears grow 20% for each whole minute of the fight. */
  timeBonus: boolean;
  /**
   * Each enemy targeting you, other than the one you're targeting, takes a row off your punches,
   * up to half their length.
   */
  suppression: boolean;
  /** A suppressed punch's drop-off goes as sprinkle to each enemy suppressing it. */
  dropOffToAttackers: boolean;
  /** Clears sent at a teammate fill their defence bar, which soaks up punches at them. */
  defence: boolean;
  /** Squares that fill a defence bar (it can hold twice that, unseen). */
  defenceSquares: number;
  /** Which wall punches come in from. */
  side: 'random' | 'left' | 'right';
}

export interface MatchSettings {
  enemyRoster: NpcSettings[];
  allyRoster: NpcSettings[];
  ai: NpcStyle;
  rules: FightRules;
  /** The "Boxing" variant: one fist in the middle. */
  oneFisted: boolean;
  /** Werewolf rumbling: orange balls are furballs. */
  werewolf: boolean;
  rumless: boolean;
  /** 0 to 100: a blocked row at the top for every 6. */
  damageLevel: number;
  startRows: number;
  /** Your bludgeon: type and colour byte (0-119). */
  bludgeon: [number, number];
}

export interface MatchEvents {
  sound?(name: SoundName | 'game_start' | 'game_over' | 'self_knocked_out' | 'opponent_knocked_out' | 'teammate_knocked_out', fighter: number, at: number): void;
  message?(text: string, fighter: number): void;
}

/** Barbarians play at three quarters of their skill (the game's barbarian skill factor). */
export const BARBARIAN_FACTOR = 0.75;

function nameFor(kind: Kind, female: boolean, rng: Random): string {
  const pick = (list: readonly string[]) => list[rng.integer(0, list.length - 1)];
  const first = pick(female ? SWABBIE_FEMALE_NAMES : SWABBIE_MALE_NAMES);
  switch (kind) {
    case 'Brigand': return `${first} the Brigand`;
    case 'Barbarian': return `${first} the Barbarian`;
    case 'You': return 'You';
    default: return `${first} ${pick(SWABBIE_SURNAMES)}`;
  }
}

export class Match {
  readonly fighters: Fighter[] = [];
  /** Each NPC's shot picker; null for you. */
  readonly brains: Array<NpcBrain | null> = [];
  readonly gloves: Glove[] = [];
  readonly names: string[] = [];
  readonly kinds: Kind[] = [];
  readonly looks: Look[] = [];
  readonly skills: number[] = [];
  /** Each side's pirates top to bottom as their status rows show them: the knocked out move to the bottom. */
  readonly rows: [number[], number[]] = [[], []];
  readonly teams: number[] = [];
  /** Who each fighter is targeting: an enemy to attack, or a teammate to defend. */
  readonly targets: number[] = [];
  /** Each pirate's defence, in squares. */
  readonly defence: number[] = [];
  result: 'won' | 'lost' | null = null;
  endedAt = 0;
  settledAt = 0;
  private readonly picks: Random;
  private readonly sides: Random;
  private readonly bruiseRng: Random;
  private readonly ids: number[] = [];
  private readonly knockedOut = new Set<number>();

  constructor(readonly settings: MatchSettings, readonly seed: number, readonly startedAt: number, private readonly events: MatchEvents = {}) {
    this.picks = new Random(seed ^ 0x1b873593);
    this.sides = new Random(seed ^ 0x3c6ef372);
    this.bruiseRng = new Random(seed ^ 0x6a09e667);
    const colours = new Random(seed ^ 0x2c1b3c6d);
    const people = new Random(seed ^ 0x68e31da4);
    const roster = [...settings.allyRoster, ...settings.enemyRoster];
    const options: FighterOptions = {
      oneFisted: settings.oneFisted, werewolf: settings.werewolf, damageLevel: settings.damageLevel,
      startRows: settings.startRows, rumless: settings.rumless,
    };
    for (let i = 0; i <= roster.length; i++) {
      const npc = i === 0 ? null : roster[i - 1];
      const kind: Kind = npc ? npc.kind : 'You';
      let glove: Glove;
      if (!npc) glove = new Glove(settings.werewolf ? WEREWOLF_TYPE : settings.bludgeon[0], settings.bludgeon[1]);
      else {
        // Brigands and barbarians fight with what NPPs carry; others with any bludgeon.
        const pool = kind === 'Brigand' || kind === 'Barbarian' ? NPP_BLUDGEONS : BLUDGEONS;
        const type = settings.werewolf ? WEREWOLF_TYPE : npc.bludgeon ?? pool[colours.integer(0, pool.length - 1)];
        glove = new Glove(type, type === FISTS_TYPE || type === HOOK_TYPE ? 0 : colours.integer(0, 119));
      }
      this.gloves.push(glove);
      const female = kind !== 'You' && people.random() < 0.5;
      let name = nameFor(kind, female, people);
      for (let tries = 0; tries < 20 && this.names.includes(name); tries++) name = nameFor(kind, female, people);
      this.names.push(name);
      this.kinds.push(kind);
      this.looks.push(lookFor(kind === 'Skilled swabbie' ? 'Skilled swabbie' : 'Custom', female, people));
      this.skills.push(npc ? (kind === 'Barbarian' ? npc.skill * BARBARIAN_FACTOR : npc.skill) : 100);
      const team = i <= settings.allyRoster.length ? 0 : 1;
      this.teams.push(team);
      this.rows[team].push(i);
      this.defence.push(0);
      this.ids.push(0);
      // Your board is dealt from the fight's seed; each NPC's from its own.
      const base = npc ? (seed + 15485863 * (i + 1)) | 0 : seed;
      const rngs = {
        board: new Random(base), alt: new Random(base + 7919), wobble: new Random(base + 104729),
        fists: [new Random(base ^ 0x51ed27), new Random(base ^ 0x2545f491)] as [Random, Random],
      };
      const fighter = new Fighter(i, rngs, {
        sound: (s, at) => this.events.sound?.(s, i, at),
        sent: (sent, at) => this.send(i, sent, at),
        minutes: (at) => this.minutes(at),
        gloveOf: (from) => this.gloves[from] ?? new Glove(FISTS_TYPE),
      }, options, startedAt);
      this.fighters.push(fighter);
      this.brains.push(npc ? new NpcBrain(fighter, this.skills[i], settings.ai, new Random(base ^ 0x7f4a7c15), () => this.attackers(i).length) : null);
    }
    for (let i = 0; i < this.fighters.length; i++) this.targets.push(-1);
    for (let i = 1; i < this.fighters.length; i++) this.retarget(i);
    this.targets[0] = this.enemiesOf(0)[0] ?? -1;
  }

  get player(): Fighter {
    return this.fighters[0];
  }

  private minutes(at: number): number {
    return this.settings.rules.timeBonus ? Math.floor((at - this.startedAt) / 60000) : 0;
  }

  get target(): number {
    return this.targets[0];
  }

  enemiesOf(index: number): number[] {
    return this.fighters.filter((f) => this.teams[f.index] !== this.teams[index] && !f.out).map((f) => f.index);
  }

  alive(): number[] {
    return this.enemiesOf(0);
  }

  /** Pirates targeting this one, either side. */
  targeters(index: number): number[] {
    return this.fighters.filter((f) => !f.out && this.targets[f.index] === index).map((f) => f.index);
  }

  /** Enemies targeting this one. */
  attackers(index: number): number[] {
    return this.targeters(index).filter((i) => this.teams[i] !== this.teams[index]);
  }

  /** The first teammate targeting this one. */
  defender(index: number): number {
    return this.targeters(index).find((i) => this.teams[i] === this.teams[index]) ?? -1;
  }

  /** The defence bar, 0 to 100, as the bar shows it. */
  halo(index: number): number {
    if (!this.settings.rules.defence || this.defender(index) < 0) return 0;
    return Math.min(100, Math.floor((this.defence[index] * 100) / Math.max(1, this.settings.rules.defenceSquares)));
  }

  /**
   * Any enemy still in, or a teammate still in who has no defender yet
   * (with defence on). In the one-fisted variant only enemies.
   */
  canTarget(from: number, to: number): boolean {
    const f = this.fighters[to];
    if (!f || f.out || to === from) return false;
    if (this.teams[to] !== this.teams[from]) return true;
    if (!this.settings.rules.defence || this.settings.oneFisted) return false;
    const d = this.defender(to);
    return d < 0 || d === from;
  }

  private retarget(index: number): void {
    if (index === 0) return;
    const enemies = this.enemiesOf(index);
    this.targets[index] = enemies.length ? enemies[this.picks.integer(0, enemies.length - 1)] : -1;
  }

  cycleTarget(step: number): void {
    const alive = this.alive();
    if (!alive.length) return;
    const at = alive.indexOf(this.targets[0]);
    this.targets[0] = alive[((at < 0 ? 0 : at + step) % alive.length + alive.length) % alive.length];
  }

  setTarget(index: number): void {
    if (this.canTarget(0, index)) this.targets[0] = index;
  }

  /** Who suppresses a pirate's punches: enemies targeting them, except the one they're targeting. */
  suppressors(index: number): number[] {
    return this.attackers(index).filter((a) => a !== this.targets[index]);
  }

  /** What a clear does once it leaves the board, approximated. */
  private send(from: number, sent: Sent, at: number): void {
    if (this.result) return;
    const rules = this.settings.rules;
    const sender = this.fighters[from];
    let { height, count } = sent;
    const { width } = sent;
    if (height > 0) {
      // Each suppressor takes a row off, up to half the punch; its drop-off goes to them as sprinkle.
      if (rules.suppression) {
        const suppressors = this.suppressors(from);
        height -= Math.min(suppressors.length, Math.floor(height / 2));
        if (rules.dropOffToAttackers && sent.count > 0) {
          for (const a of suppressors) this.deliver(from, a, { height: 0, width: 0, count: sent.count }, at);
        }
      }
      count = 0;
      sender.stats.punches++;
      sender.stats.punchSquares += width * height;
      sender.stats.biggestPunch = Math.max(sender.stats.biggestPunch, width * height);
    } else sender.stats.sprinkleSent += count;
    const to = this.targets[from];
    if (to < 0 || this.fighters[to].out) return;
    if (this.teams[to] === this.teams[from]) {
      // Defending: the clear goes into the teammate's bar, which can hold twice what shows.
      if (rules.defence) this.defence[to] = Math.min(rules.defenceSquares * 2, this.defence[to] + (height > 0 ? width * height : count));
      return;
    }
    this.deliver(from, to, { height, width, count }, at);
  }

  /** Bruises in an NPC's punch: a chance that grows with its skill, then a share of its squares. */
  private bruises(from: number, squares: number): number {
    const npc = this.brains[from];
    if (!npc || squares <= 0) return 0;
    const style = this.settings.ai;
    if (this.bruiseRng.random() * 100 >= style.bruiseChance * npc.skill / 100) return 0;
    return Math.min(Math.trunc(squares / 2), Math.max(1, Math.round((squares * style.bruiseShare) / 100)));
  }

  private deliver(from: number, to: number, s: { height: number; width: number; count: number }, at: number): void {
    const rules = this.settings.rules;
    let { height } = s;
    // A defended pirate's bar soaks up a punch's squares, taking whole rows off it.
    if (rules.defence && height > 0 && s.width > 0 && this.defender(to) >= 0 && this.defence[to] > 0) {
      const rows = Math.min(height, Math.floor(this.defence[to] / s.width));
      this.defence[to] -= rows * s.width;
      height -= rows;
    }
    const f = this.fighters[to];
    if (!f || f.out) return;
    if (height <= 0 && s.count <= 0) return;
    this.ids[from] = (this.ids[from] + 1) & 0xff;
    const side = rules.side === 'left' ? 1 : rules.side === 'right' ? 0 : this.sides.integer(0, 1);
    const shaft: Shaft = {
      from, id: this.ids[from], count: height > 0 ? 0 : s.count, side, width: s.width, height,
      blacks: this.bruises(from, s.width * height), next: 0,
    };
    f.receive(shaft, at);
  }

  update(now: number): void {
    if (this.result) {
      if (this.settledAt) return;
      const player = this.player;
      player.update(now);
      if (player.out || player.idle(now) || now - this.endedAt > 3000) this.settledAt = now;
      return;
    }
    // An NPC presses and fires between its board's steps.
    for (const f of this.fighters) {
      const brain = this.brains[f.index];
      f.update(now);
      if (brain && !f.out) {
        brain.update(now);
        f.update(now);
      }
    }
    for (const f of this.fighters) {
      if (!f.out || this.knockedOut.has(f.index)) continue;
      this.knockedOut.add(f.index);
      const row = this.rows[this.teams[f.index]];
      row.splice(row.indexOf(f.index), 1);
      row.push(f.index);
      this.defence[f.index] = 0;
      if (f.index === 0) {
        this.events.message?.('Ye be knocked out!', 0);
        this.events.sound?.('self_knocked_out', 0, now);
      } else if (this.teams[f.index] === 0) {
        this.events.message?.(`${this.names[f.index]} was knocked out!`, 0);
        this.events.sound?.('teammate_knocked_out', 0, now);
      } else {
        if (f.index === this.targets[0]) this.events.message?.(`${this.names[f.index]} was knocked out!`, 0);
        this.events.sound?.('opponent_knocked_out', 0, now);
      }
    }
    for (let i = 0; i < this.fighters.length; i++) {
      const t = this.targets[i];
      if (t >= 0 && this.fighters[t].out) {
        if (i === 0) {
          if (this.teams[t] === 0) this.targets[0] = this.alive()[0] ?? -1;
          else this.cycleTarget(1);
        } else this.retarget(i);
      }
    }
    if (!this.settings.enemyRoster.length) {
      if (this.player.out) this.finish('lost', now);
      return;
    }
    if (!this.alive().length) this.finish('won', now);
    else if (!this.enemiesOf(this.alive()[0]).length) this.finish('lost', now);
  }

  private finish(result: 'won' | 'lost', now: number): void {
    this.result = result;
    this.endedAt = now;
    for (const f of this.fighters) if (f.index !== 0) f.halted = true;
    this.player.halted = !this.player.out;
    this.events.sound?.('game_over', 0, now);
    if (!this.settings.enemyRoster.length) return;
    const team = this.settings.allyRoster.length > 0;
    this.events.message?.(result === 'won'
      ? (team ? 'Yer team is victorious!' : 'Ye be the victor!')
      : (team ? 'Yer team is defeated!' : 'Ye be defeated!'), 0);
  }
}

/** A bludgeon's first two colours, for attacker dots: what its colour byte maps red and yellow to. */
export function gloveColours(glove: Glove): [number, number] {
  const map = colourMapping(glove.colours);
  return [map[0], map[1]];
}
