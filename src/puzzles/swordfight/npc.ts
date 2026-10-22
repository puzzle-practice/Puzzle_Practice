// The opponents. They don't play the puzzle: each one keeps the pieces it's dealt on its board as
// a tally of colours, stacked on its lowest column, and never fuses blocks.
//   - A pair comes every `pairMs`. Plain pieces go on the lowest column (ties: columns 1, 6, 2, 5,
//     3, 4).
//   - A breaker may be stored on the board (`storeChance`, up to `comboMax` at once). Otherwise
//     it shatters about `breakAverage` percent of its colour, more the higher the board is
//     (`heightBoost`), taken evenly from the columns centre first. Stored breakers go off with
//     it, up to `comboMax` of them, each shattering its own colour as the next link of a chain.
//   - Each break is sent as an attack: `strikeShare` percent of the shattered pieces as fused
//     blocks (swords), the rest as loose pieces (sprinkles), with the chain multiplier.
//   - Your attacks land on top of its columns as plain pieces, at most one every few of its pairs.
// AI skill is a preset for all of these. A second kind, GameNpc at the end, uses the game's own AI
// numbers instead: base and maximum destruction, a chain chance, and slowing down when targeted.
import type { Random } from '../../core/random';
import { type Attack, swordFor } from './attack';
import { Board, BREAKER, colour, EMPTY, H, isBreaker, W } from './board';
import type { FighterStats } from './fighter';
import type { Shaft } from './strikes';

export interface NpcStyle {
  /** How often it's dealt a pair, in ms. */
  pairMs: number;
  /** How much of its colour a breaker shatters on average, in percent. */
  breakAverage: number;
  /** How far a break varies either way, in percent (a normal spread). */
  variation: number;
  /** How much more a breaker shatters on a full board than an empty one: 2 doubles it at the top. */
  heightBoost: number;
  /** Chance a breaker is stored instead of used, in percent. */
  storeChance: number;
  /** How many stored breakers it keeps, and sets off with its next break. */
  comboMax: number;
  /** How much of a break is sent as swords rather than sprinkles, in percent. */
  strikeShare: number;
  /** Your attacks land at most once per this many of its pairs. */
  pairsPerAttack: number;
}

/** The least and most of its board an opponent destroys at AI skill 0, 10, 20 ... 100. */
const BASE_DESTROY = [0.07, 0.08, 0.13, 0.18, 0.24, 0.3, 0.38, 0.43, 0.5, 0.55, 0.6];
const MAX_DESTROY = [0.1, 0.25, 0.37, 0.47, 0.52, 0.6, 0.63, 0.65, 0.69, 0.69, 0.7];

/** A destruction table's value at any skill from 0 to 100, blending the entries either side. */
export function destroyAt(table: readonly number[], skill: number): number {
  const at = Math.max(0, Math.min(100, skill)) / 10;
  const below = Math.floor(at);
  const above = Math.min(below + 1, table.length - 1);
  return table[below] + (table[above] - table[below]) * (at - below);
}

/** The experimental opponent's preset for an AI skill from 0 to 100. */
export function skillStyle(aiSkill: number): NpcStyle {
  const skill = aiSkill / 10;
  return {
    pairMs: Math.round(2000 - skill * 125),
    breakAverage: Math.round(100 * destroyAt(BASE_DESTROY, aiSkill)),
    variation: 15,
    heightBoost: Math.round((destroyAt(MAX_DESTROY, aiSkill) / destroyAt(BASE_DESTROY, aiSkill)) * 10) / 10,
    storeChance: Math.round(10 + skill * 4),
    comboMax: Math.floor(skill / 3),
    strikeShare: 50,
    pairsPerAttack: 3,
  };
}

/** Columns for its own pieces and the leftovers of attacks: edges first. Clearing goes the other way. */
const FILL_ORDER = [0, 5, 1, 4, 2, 3];
const CLEAR_ORDER = [3, 2, 4, 1, 5, 0];

/** Fused block shapes it can break, 2x2 up to 6x8. */
const GEM_SHAPES: Array<[number, number]> = [];
for (let h = 2; h <= 8; h++) for (let w = 2; w <= W; w++) GEM_SHAPES.push([w, h]);

export interface NpcHooks {
  nextPair(): [number, number];
  attack(attack: Attack): void;
}

/** What every opponent style has. */
interface BaseStyle {
  pairMs: number;
  strikeShare: number;
  pairsPerAttack: number;
}

/** An opponent that keeps a tally of its pieces; what a breaker does is up to each kind. */
abstract class TallyNpc<S extends BaseStyle> {
  board = new Board();
  out = false;
  stats: FighterStats = { pairs: 0, shattered: 0, bestChain: 0, sent: 0, received: 0, largestReceived: 0, breakerDroughts: [0, 0, 0, 0], swordsSent: 0, biggestSword: 0, shatteredBy: [0, 0, 0, 0] };
  protected nextAt: number;
  private incoming: number[] = [];
  private pairsSinceAttack = 0;

  constructor(readonly index: number, readonly style: S, protected readonly rng: Random, protected readonly hooks: NpcHooks, started: number) {
    this.nextAt = started + style.pairMs;
  }

  /** Attacks waiting to land on it, and how many pieces they hold between them. */
  get queue(): { attacks: number; blocks: number } {
    return { attacks: this.incoming.length, blocks: this.incoming.reduce((n, a) => n + a, 0) };
  }

  receive(shaft: Shaft): void {
    if (this.out) return;
    const amount = shaft.sprinkles + shaft.strikes.reduce((n, s) => n + s.width * s.height, 0);
    if (amount > 0) this.incoming.push(amount);
  }

  update(now: number): void {
    while (!this.out && now >= this.nextAt) {
      this.step();
      this.nextAt += Math.max(50, this.interval());
    }
  }

  /** How long until its next pair. */
  protected interval(): number {
    return this.style.pairMs;
  }

  protected gauss(): number {
    const u = Math.max(1e-12, this.rng.random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rng.random());
  }

  private height(x: number): number {
    let n = 0;
    for (let y = 0; y < H; y++) if (this.board.get(x, y) !== EMPTY) n++;
    return n;
  }

  /** Puts a piece on top of a column; false if it's full. */
  private stack(x: number, piece: number): boolean {
    const h = this.height(x);
    if (h >= H) return false;
    this.board.set(x, H - 1 - h, piece);
    return true;
  }

  /** Lets every column's pieces fall to the bottom. */
  private compact(): void {
    for (let x = 0; x < W; x++) {
      let write = H - 1;
      for (let y = H - 1; y >= 0; y--) {
        const p = this.board.get(x, y);
        if (p === EMPTY) continue;
        if (write !== y) this.board.set(x, write, p);
        write--;
      }
      while (write >= 0) this.board.set(x, write--, EMPTY);
    }
  }

  protected count(c: number): number {
    let n = 0;
    for (const p of this.board.cells) if (p !== EMPTY && !isBreaker(p) && colour(p) === c) n++;
    return n;
  }

  protected stored(): number[] {
    return Array.from(this.board.cells).filter((p) => p !== EMPTY && isBreaker(p));
  }

  /** Takes a stored breaker of colour c off the board. */
  protected useStored(c: number): void {
    const i = this.board.cells.findIndex((p) => p !== EMPTY && isBreaker(p) && colour(p) === c);
    if (i >= 0) this.board.cells[i] = EMPTY;
  }

  /** How much of its colour, in percent, a breaker shatters now. */
  protected abstract breakPercent(): number;

  /**
   * A breaker of colour c arrives: either keep it (push it onto plain to be stacked) or set it
   * off, adding each break's size to breaks in chain order.
   */
  protected abstract breaker(c: number, breaks: number[], plain: number[]): void;

  /** Which link of a chain the ith break of a pair is: the nth break is the nth link. */
  protected link(i: number): number {
    return i + 1;
  }

  /** How full the board is, 0 to 1. */
  protected fill(): number {
    return this.board.cells.filter((p) => p !== EMPTY).length / (W * H);
  }

  /** Shatters part of a colour, taken evenly from the columns, centre first. */
  protected shatter(c: number): number {
    const matching = this.count(c);
    if (!matching) return 0;
    const percent = Math.max(0, Math.min(100, Math.round(this.breakPercent())));
    const target = Math.round((matching * percent) / 100);
    let removed = 0;
    while (removed < target) {
      let took = false;
      for (const x of CLEAR_ORDER) {
        if (removed >= target) break;
        for (let y = 0; y < H; y++) {
          const p = this.board.get(x, y);
          if (p !== EMPTY && !isBreaker(p) && colour(p) === c) {
            this.board.set(x, y, EMPTY);
            removed++;
            took = true;
            break;
          }
        }
      }
      if (!took) break;
    }
    return removed;
  }

  /** One pair dealt: its pieces stacked or set off, then any of your attacks that are due. */
  private step(): void {
    const pair = this.hooks.nextPair();
    this.stats.pairs++;
    const breaks: number[] = [];
    const plain: number[] = [];
    for (const piece of pair) {
      const c = colour(piece);
      if (!isBreaker(piece)) {
        plain.push(c);
        continue;
      }
      this.breaker(c, breaks, plain);
    }
    if (breaks.length) this.compact();
    // Own pieces go on the lowest column; ties go to the first in FILL_ORDER.
    for (const piece of plain) {
      let best = -1;
      let bestHeight = Infinity;
      for (const x of FILL_ORDER) {
        const h = this.height(x);
        if (h < H && h < bestHeight) {
          best = x;
          bestHeight = h;
        }
      }
      if (best < 0) break;
      this.stack(best, piece);
    }
    this.stats.shattered += breaks.reduce((n, b) => n + b, 0);
    this.stats.bestChain = Math.max(this.stats.bestChain, breaks.length);
    breaks.forEach((cleared, i) => this.send(cleared, this.link(i)));
    this.checkOut();
    if (!this.out) this.landIncoming();
  }

  /** A break as an attack: about strikeShare percent of it as fused blocks, the rest loose. */
  private send(cleared: number, link: number): void {
    // Each attack varies a little around the style, except all-or-nothing styles.
    const base = this.style.strikeShare / 100;
    const share = Math.max(0, Math.min(1, base + this.gauss() * 0.1 * Math.min(1, 4 * base * (1 - base))));
    let budget = Math.round(cleared * share);
    let used = 0;
    const swords: Array<[number, number]> = [];
    while (budget >= 4) {
      const gem = this.pickGem(budget);
      if (!gem) break;
      swords.push(swordFor(gem[0], gem[1], link));
      budget -= gem[0] * gem[1];
      used += gem[0] * gem[1];
    }
    const sprinkles = Math.floor(Math.max(0, cleared - used) / 2) * link;
    if (!swords.length && !sprinkles) return;
    const attack: Attack = { swords, sprinkles };
    this.stats.sent += sprinkles + swords.reduce((n, [w, h]) => n + w * h, 0);
    this.stats.swordsSent += swords.length;
    for (const [w, h] of swords) this.stats.biggestSword = Math.max(this.stats.biggestSword, w * h);
    this.hooks.attack(attack);
  }

  /** Small blocks are most common, two-wide towers and squares a little more so. */
  private pickGem(budget: number): [number, number] | null {
    const weights = GEM_SHAPES.map(([w, h]) => {
      if (w * h > budget) return 0;
      let weight = 1 / Math.pow(w * h, 0.9);
      if (w === 2) weight *= 1.4;
      if (w === h) weight *= 1.2;
      return weight;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    let roll = this.rng.random() * total;
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] <= 0) continue;
      roll -= weights[i];
      if (roll < 0) return GEM_SHAPES[i];
    }
    for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return GEM_SHAPES[i];
    return null;
  }

  /** Your oldest attack lands once enough of its pairs have passed: an even share on every column, leftovers edges first. */
  private landIncoming(): void {
    if (this.pairsSinceAttack < this.style.pairsPerAttack) this.pairsSinceAttack++;
    if (this.pairsSinceAttack < this.style.pairsPerAttack) return;
    const amount = this.incoming.shift();
    if (amount === undefined) return;
    this.pairsSinceAttack = 0;
    this.stats.received += amount;
    this.compact();
    const share = new Array<number>(W).fill(Math.floor(amount / W));
    for (let i = 0; i < amount % W; i++) share[FILL_ORDER[i % W]]++;
    let overflow = 0;
    for (const x of FILL_ORDER) {
      for (let i = 0; i < share[x]; i++) if (!this.stack(x, this.rng.integer(0, 3))) overflow++;
    }
    while (overflow > 0) {
      let fitted = false;
      for (const x of FILL_ORDER) {
        if (overflow === 0) break;
        if (this.stack(x, this.rng.integer(0, 3))) {
          overflow--;
          fitted = true;
        }
      }
      if (!fitted) break;
    }
    this.checkOut();
  }

  /** Knocked out, like you, when the top of its fourth column is filled. */
  private checkOut(): void {
    if (this.board.get(3, 0) !== EMPTY) this.out = true;
  }
}

/** The tally opponent: stores breakers and sets them off together as a combo; clears grow with its board. */
export class Npc extends TallyNpc<NpcStyle> {
  protected breakPercent(): number {
    const s = this.style;
    // The higher the board, the more it breaks: up to heightBoost times as much when full.
    return (s.breakAverage + this.gauss() * s.variation) * (1 + (s.heightBoost - 1) * this.fill());
  }

  protected breaker(c: number, breaks: number[], plain: number[]): void {
    if (this.stored().length < this.style.comboMax && this.rng.random() * 100 < this.style.storeChance) {
      plain.push(c | BREAKER);
      return;
    }
    // The breaker goes off, then the stored ones with it, each the next link of the chain.
    breaks.push(this.shatter(c) + 1);
    for (const saved of this.stored().slice(0, this.style.comboMax)) {
      const sc = colour(saved);
      this.useStored(sc);
      breaks.push(this.shatter(sc) + 1);
    }
  }
}

/** The game's AI numbers for an opponent. */
export interface GameStyle {
  /** How often it's dealt a pair, in ms, when nobody is targeting it. */
  pairMs: number;
  /** The least and most of its colour a breaker destroys, in percent (the game's base and maximum destruction). */
  baseDestroy: number;
  maxDestroy: number;
  /** Chance a clear is sent as a chained one (a Double, so its swords are twice as long and sprinkles double), in percent. */
  chainChance: number;
  /** How much slower it plays for each pirate attacking it (up to 4), in percent. */
  targetedSlowdown: number;
  strikeShare: number;
  pairsPerAttack: number;
}

/** The game's own numbers at an AI skill from 0 to 100: destruction, chain chance (40% at 100), slowing when targeted. */
export function gameSkillStyle(skill: number): GameStyle {
  return {
    // About one pair every 3 seconds with nobody targeting it, at every skill.
    pairMs: 3000,
    baseDestroy: Math.round(destroyAt(BASE_DESTROY, skill) * 100),
    maxDestroy: Math.round(destroyAt(MAX_DESTROY, skill) * 100),
    chainChance: Math.round((40 * skill) / 100),
    // The game starts slowing an AI at 1 targeter and is slowest at 4: one of 4 steps of up to double.
    targetedSlowdown: 25,
    strikeShare: 50,
    pairsPerAttack: 3,
  };
}

/**
 * The game-numbers opponent: each breaker destroys between the base and maximum destruction of its
 * own colour only, and at the chain chance that clear is sent as a chained one (a Double).
 */
export class GameNpc extends TallyNpc<GameStyle> {
  /** How many pirates are attacking it, which slows it down. */
  targeted: () => number = () => 0;

  protected interval(): number {
    // Slower for each pirate attacking it, up to the game's 4 targeters.
    return this.style.pairMs * (1 + (this.style.targetedSlowdown / 100) * Math.min(this.targeted(), 4));
  }

  protected breakPercent(): number {
    const { baseDestroy, maxDestroy } = this.style;
    return Math.min(baseDestroy, maxDestroy) + this.rng.random() * Math.abs(maxDestroy - baseDestroy);
  }

  /** Each break's chain link, rolled as it's made. */
  private links: number[] = [];

  /** A breaker clears only its own colour; the chain chance makes that clear count as a Double. */
  protected breaker(c: number, breaks: number[]): void {
    if (!breaks.length) this.links = [];
    breaks.push(this.shatter(c) + 1);
    this.links.push(this.rng.random() * 100 < this.style.chainChance ? 2 : 1);
  }

  protected link(i: number): number {
    return this.links[i] ?? 1;
  }
}
