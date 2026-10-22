// A fight: you, fighter 0, and the chosen teammates against the chosen opponents,
// or you on your own. Deals the pairs, passes each attack to its target, and decides when
// the fight is over. How pairs are dealt and when attacks are sent are choices made here.
import { Random } from '../../core/random';
import type { Attack } from './attack';
import { BREAKER } from './board';
import { Fighter, type FighterHooks, type SoundName } from './fighter';
import { type Look, lookFor } from './faces';
import { CULTIST_PREFIXES, HOMUNCULUS_PREFIXES, SWABBIE_FEMALE_NAMES, SWABBIE_MALE_NAMES, SWABBIE_SURNAMES, THRALL_PREFIXES } from './names';
import { GameNpc, type GameStyle, gameSkillStyle, Npc, type NpcStyle, skillStyle } from './npc';
import { PLAIN_SWORDS, type Shaft, type Strike, Sword } from './strikes';

export interface MatchSettings {
  /** Legacy counts for older recordings; individual rosters choose new fights. */
  cultists: number;
  homunculi: number;
  /** Total opponents; none is practice on your own. */
  opponents: number;
  /** Allies on your team: thralls and skilled swabbies. */
  thralls: number;
  swabbies: number;
  /** Legacy skills for older recordings, 0 to 100. */
  cultistSkill: number;
  homunculusSkill: number;
  thrallSkill: number;
  swabbieSkill: number;
  /** Which kind of AI: one that stores breakers for combos, or one on the game's AI numbers. */
  opponentType: 'tally' | 'game';
  /** How each kind of AI plays, apart from what its skill sets. */
  ai: NpcStyle;
  gameAi: GameStyle;
  /** The puzzle difficulty that sets the starting speed (0.01 x (difficulty + 1) pixels per ms). */
  difficulty: number;
  /** Chance a dealt piece is a breaker, in percent. */
  breakers: number;
  /** Your sword (type, primary colour, secondary colour). */
  sword: [number, number, number];
  /** Individual NPCs on each side; omitted by older recordings. */
  enemyRoster?: NpcSettings[];
  allyRoster?: NpcSettings[];
}

export interface NpcSettings {
  kind: Exclude<Kind, 'You'>;
  skill: number;
  /** A sword type, or null to pick a random sword each fight. Colours are always random. */
  sword: number | null;
}

/** Each fighter gets the same pairs in the same order, from a generator seeded alike. */
class Dealer {
  private readonly rng: Random;
  private readonly queue: Array<[number, number]> = [];

  constructor(seed: number, private readonly breakerChance: number) {
    this.rng = new Random(seed);
  }

  private piece(): number {
    const c = this.rng.integer(0, 3);
    return this.rng.random() * 100 < this.breakerChance ? c | BREAKER : c;
  }

  private fill(): void {
    while (this.queue.length < 2) this.queue.push([this.piece(), this.piece()]);
  }

  next(): [number, number] {
    this.fill();
    return this.queue.shift()!;
  }

  peek(): [number, number] {
    this.fill();
    return this.queue[0];
  }

  /** Freeplay mode: the next pair is chosen. */
  replace(pair: [number, number]): void {
    this.fill();
    this.queue[0] = pair;
  }
}

export interface MatchEvents {
  sound?(name: SoundName | 'self_knocked_out' | 'opponent_knocked_out' | 'teammate_knocked_out' | 'win' | 'lose' | 'fanfare', fighter: number): void;
  message?(text: string, fighter: number): void;
}

/** Cultists fight with spears and homunculi with tree trunks; allies with any sword. All in random colours. */
const SPEAR = 16;
const TRUNK = 17;

export type Kind = 'You' | 'Cultist' | 'Homunculus' | 'Thrall' | 'Skilled swabbie' | 'Custom';

/** A name from the game's lists for a kind of pirate. */
function nameFor(kind: Kind, female: boolean, rng: Random): string {
  const pick = (list: readonly string[]) => list[rng.integer(0, list.length - 1)];
  switch (kind) {
    case 'Cultist': return `${pick(CULTIST_PREFIXES)} Cultist`;
    case 'Homunculus': return `${pick(HOMUNCULUS_PREFIXES)} Homunculus`;
    case 'Thrall': return `${pick(THRALL_PREFIXES)} Zombie`;
    case 'Skilled swabbie':
    case 'Custom': return `${pick(female ? SWABBIE_FEMALE_NAMES : SWABBIE_MALE_NAMES)} ${pick(SWABBIE_SURNAMES)}`;
    default: return 'You';
  }
}

/** An AI's style: the chosen kind's settings, with what its skill sets on top. */
export function styleFor(settings: MatchSettings, skill: number): { tally: NpcStyle; game: GameStyle } {
  const t = skillStyle(skill);
  const g = gameSkillStyle(skill);
  return {
    tally: { ...settings.ai, breakAverage: t.breakAverage, heightBoost: t.heightBoost, storeChance: t.storeChance, comboMax: t.comboMax },
    game: { ...settings.gameAi, baseDestroy: g.baseDestroy, maxDestroy: g.maxDestroy, chainChance: g.chainChance },
  };
}

export class Match {
  readonly fighters: Array<Fighter | Npc | GameNpc> = [];
  readonly swords: Sword[] = [];
  readonly names: string[] = [];
  readonly kinds: Kind[] = [];
  readonly looks: Look[] = [];
  /** Each side's pirates top to bottom as their status rows show them: the knocked out move to the bottom. */
  readonly rows: [number[], number[]] = [[], []];
  /** 0 for your side, 1 for the enemies. */
  readonly teams: number[] = [];
  /** Who each fighter is attacking (TeamPuzzleController targets); targets[0] is yours. */
  readonly targets: number[] = [];
  result: 'won' | 'lost' | null = null;
  endedAt = 0;
  /** When the boards had finished moving after the fight ended. */
  settledAt = 0;
  private readonly strikeIds: Random;
  private readonly picks: Random;
  private readonly shaftIds: number[] = [];
  private readonly knockedOut = new Set<number>();
  private readonly dealers: Dealer[] = [];
  /** Freeplay mode: practice on your own that a knock-out doesn't end. */
  endless = false;

  constructor(readonly settings: MatchSettings, readonly seed: number, readonly startedAt: number, private readonly events: MatchEvents = {}) {
    this.strikeIds = new Random(seed ^ 0x5f3759df);
    this.picks = new Random(seed ^ 0x1b873593);
    const colours = new Random(seed ^ 0x2c1b3c6d);
    const people = new Random(seed ^ 0x68e31da4);
    // You, then your allies, then the enemies.
    const roster = settings.enemyRoster && settings.allyRoster ? [...settings.allyRoster, ...settings.enemyRoster] : null;
    const kinds: Kind[] = roster ? roster.map((npc) => npc.kind) : [
      ...Array<Kind>(settings.thralls).fill('Thrall'), ...Array<Kind>(settings.swabbies).fill('Skilled swabbie'),
      ...Array<Kind>(settings.cultists).fill('Cultist'), ...Array<Kind>(settings.homunculi).fill('Homunculus'),
    ];
    const skills: Record<Exclude<Kind, 'You'>, number> = {
      Cultist: settings.cultistSkill, Homunculus: settings.homunculusSkill, Thrall: settings.thrallSkill, 'Skilled swabbie': settings.swabbieSkill, Custom: 50,
    };
    for (let i = 0; i <= kinds.length; i++) {
      const dealer = new Dealer(seed, settings.breakers);
      this.dealers.push(dealer);
      const kind: Kind = i === 0 ? 'You' : kinds[i - 1];
      let sword: [number, number, number] = settings.sword;
      if (i > 0) {
        const type = roster ? roster[i - 1].sword ?? PLAIN_SWORDS[colours.integer(0, PLAIN_SWORDS.length - 1)]
          : kind === 'Cultist' ? SPEAR : kind === 'Homunculus' ? TRUNK : PLAIN_SWORDS[colours.integer(0, PLAIN_SWORDS.length - 1)];
        sword = [type, colours.integer(0, 7), colours.integer(0, 7)];
      }
      this.swords.push(new Sword(...sword));
      // Homunculi are all alike; the others are men or women, named from the game's lists, no two the same.
      const female = kind !== 'You' && kind !== 'Homunculus' && people.random() < 0.5;
      let name = nameFor(kind, female, people);
      for (let tries = 0; tries < 20 && this.names.includes(name); tries++) name = nameFor(kind, female, people);
      this.names.push(name);
      this.kinds.push(kind);
      this.looks.push(lookFor(kind, female, people));
      const team = roster ? (i <= settings.allyRoster!.length ? 0 : 1)
        : kind === 'You' || kind === 'Thrall' || kind === 'Skilled swabbie' ? 0 : 1;
      this.teams.push(team);
      this.rows[team].push(i);
      this.shaftIds.push(0);
      const hooks: FighterHooks = {
        sound: (name) => this.events.sound?.(name, i),
        message: (text) => this.events.message?.(text, i),
        attack: (attack) => this.send(i, attack),
        nextPair: () => dealer.next(),
        peekPair: () => dealer.peek(),
        swordOf: (from) => this.swords[from] ?? null,
      };
      this.fighters.push(i === 0
        ? new Fighter(i, settings.difficulty, hooks, startedAt)
        : this.ai(i, roster ? roster[i - 1].skill : skills[kind as Exclude<Kind, 'You'>], hooks, seed, startedAt));
    }
    for (let i = 0; i < this.fighters.length; i++) this.targets.push(-1);
    for (let i = 0; i < this.fighters.length; i++) this.retarget(i);
    // You start on the first enemy.
    this.targets[0] = this.enemiesOf(0)[0] ?? -1;
  }

  private ai(i: number, skill: number, hooks: FighterHooks, seed: number, startedAt: number): Npc | GameNpc {
    const rng = new Random(seed + i * 7919);
    const npcHooks = { nextPair: hooks.nextPair, attack: hooks.attack! };
    const style = styleFor(this.settings, skill);
    if (this.settings.opponentType === 'tally') return new Npc(i, style.tally, rng, npcHooks, startedAt);
    const npc = new GameNpc(i, style.game, rng, npcHooks, startedAt);
    npc.targeted = () => this.targeters(i).length;
    return npc;
  }

  get player(): Fighter {
    return this.fighters[0] as Fighter;
  }

  /** The other side's fighters still standing. */
  enemiesOf(index: number): number[] {
    return this.fighters.filter((f) => this.teams[f.index] !== this.teams[index] && !f.out).map((f) => f.index);
  }

  /** The enemies still standing. */
  alive(): number[] {
    return this.enemiesOf(0);
  }

  /** Who is attacking a fighter. */
  targeters(index: number): number[] {
    return this.fighters.filter((f) => !f.out && this.targets[f.index] === index).map((f) => f.index);
  }

  get target(): number {
    return this.targets[0];
  }

  /** An AI picks a random enemy still standing. */
  private retarget(index: number): void {
    if (index === 0) return;
    const enemies = this.enemiesOf(index);
    this.targets[index] = enemies.length ? enemies[this.picks.integer(0, enemies.length - 1)] : -1;
  }

  /** Steps your target through the enemies still in (target_next_player / target_prev_player). */
  cycleTarget(step: number): void {
    const alive = this.alive();
    if (!alive.length) return;
    const at = alive.indexOf(this.targets[0]);
    this.targets[0] = alive[((at < 0 ? 0 : at + step) % alive.length + alive.length) % alive.length];
  }

  setTarget(index: number): void {
    if (this.alive().includes(index)) this.targets[0] = index;
  }

  private send(from: number, attack: Attack): void {
    if (this.result) return;
    const to = this.targets[from];
    const target = this.fighters[to];
    if (!target || target.out || this.teams[to] === this.teams[from]) return;
    this.shaftIds[from] = (this.shaftIds[from] + 1) & 0xff;
    const strikes: Strike[] = attack.swords.map(([width, height]) => ({
      id: this.strikeIds.integer(0, 255), width, height, x: 0, y: 0, orient: 0, pieces: [],
    }));
    const shaft: Shaft = { from, id: this.shaftIds[from], strikes, sprinkles: attack.sprinkles };
    target.receive(shaft);
  }

  update(now: number): void {
    // After the fight, your board finishes falling and clearing, then everything stops.
    if (this.result) {
      if (this.settledAt) return;
      const player = this.player;
      player.update(now);
      if (player.out || (!player.pair && player.idle(now))) this.settledAt = now;
      return;
    }
    for (const f of this.fighters) f.update(now);
    for (const f of this.fighters) {
      if (!f.out || this.knockedOut.has(f.index)) continue;
      this.knockedOut.add(f.index);
      const row = this.rows[this.teams[f.index]];
      row.splice(row.indexOf(f.index), 1);
      row.push(f.index);
      if (f.index === 0) {
        this.events.message?.('Ye be knocked out!', 0);
        this.events.sound?.('self_knocked_out', 0);
      } else if (this.teams[f.index] === 0) {
        this.events.message?.(`${this.names[f.index]} was knocked out!`, 0);
        this.events.sound?.('teammate_knocked_out', 0);
      } else {
        if (f.index === this.targets[0]) this.events.message?.(`${this.names[f.index]} was knocked out!`, 0);
        this.events.sound?.('opponent_knocked_out', 0);
      }
    }
    // Anyone whose target went down picks another.
    for (let i = 0; i < this.fighters.length; i++) {
      const t = this.targets[i];
      if (t >= 0 && this.fighters[t].out) {
        if (i === 0) this.cycleTarget(1);
        else this.retarget(i);
      }
    }
    if (this.settings.opponents === 0) {
      if (this.player.out && !this.endless) this.finish('lost', now);
      return;
    }
    // A side loses when everyone on it is out; with allies, you can be out and still win.
    if (!this.alive().length) this.finish('won', now);
    else if (!this.enemiesOf(this.alive()[0]).length) this.finish('lost', now);
  }

  /** Freeplay mode: your next pair is these pieces. */
  setNext(pair: [number, number]): void {
    this.dealers[0].replace(pair);
    this.player.next = pair;
  }

  /** Freeplay mode: your board was changed by hand, so a knock-out can be announced again. */
  edited(now: number): void {
    this.knockedOut.delete(0);
    this.player.edited(now);
  }

  private finish(result: 'won' | 'lost', now: number): void {
    this.result = result;
    this.endedAt = now;
    this.player.halted = true;
    if (this.settings.opponents === 0) return;
    this.events.message?.(result === 'won' ? 'Ye be the victor!' : 'Ye be defeated!', 0);
    this.events.sound?.(result === 'won' ? 'win' : 'lose', 0);
  }
}
