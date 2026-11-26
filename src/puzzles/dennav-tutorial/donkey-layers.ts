// Donkey lessons 3 and 4: where the lesson 2 base sits under the 3/2/1 targets, and the ring 2 layer
// built on it. The reasoning is in DONKEY-POSITION.md.
//
// Ring 1 is A A B B C C D E. D is the leftover broken by the trigger, E the one kept; the combo
// travels from D away from E (`step` is that direction, 1 or -1, in octants). A1 is the A beside E,
// B1 the B beside A, C1 the C beside B.
import { COLOUR_NAMES } from '../navigation/create';
import { EMPTY, type Target } from '../navigation/logic';
import { INNER, MIDDLE, TOP, type Position } from './engine';
import type { Random } from '../../core/random';
import type { RingJudgement } from './donkey-ring';

const m8 = (o: number) => ((o % 8) + 8) % 8;
const name = (colour: number) => COLOUR_NAMES[colour].toLowerCase();
const plural = (colour: number) => `${name(colour)}s`;
const OCTANTS = [0, 1, 2, 3, 4, 5, 6, 7];
const cell = (ring: number, octant: number) => ring * 8 + m8(octant);

export interface Roles {
  step: 1 | -1;
  D: number; E: number; C2: number; C1: number; B2: number; B1: number; A2: number; A1: number;
  /** The colours: A, B, C, D, E. */
  colours: { A: number; B: number; C: number; D: number; E: number };
}

/** The roles of ring 1 (eight colours) if `d` is the leftover that gets broken, or null if the ring isn't a base. */
export function rolesFor(ring1: number[], d: number): Roles | null {
  const count = (c: number) => ring1.filter((x) => x === c).length;
  if (ring1.includes(EMPTY) || count(ring1[d]) !== 1) return null;
  // E is the other leftover beside D; the combo goes the other way.
  const step: 1 | -1 | null = count(ring1[m8(d - 1)]) === 1 ? 1 : count(ring1[m8(d + 1)]) === 1 ? -1 : null;
  if (step === null) return null;
  const at = (k: number) => m8(d + step * k);
  const r = { step, D: d, E: at(-1), C2: at(1), C1: at(2), B2: at(3), B1: at(4), A2: at(5), A1: at(6) };
  const colours = { A: ring1[r.A1], B: ring1[r.B1], C: ring1[r.C1], D: ring1[r.D], E: ring1[r.E] };
  if (ring1[r.A2] !== colours.A || ring1[r.B2] !== colours.B || ring1[r.C2] !== colours.C) return null;
  return { ...r, colours };
}

/** Both readings of a base: either leftover can be the one broken. */
export function readings(ring1: number[]): Roles[] {
  return OCTANTS.map((d) => rolesFor(ring1, d)).filter((r): r is Roles => r !== null);
}

/**
 * The targets that wait for the last ring 1 clear (A A A), so the constellation can't chart before it:
 * a ring 1 target on A1 that isn't A's colour, a ring 2 target over A1 or A2 that the star there at
 * trigger time doesn't fill, or a ring 3 target over A1 or A2.
 * `ring2AtTrigger(o)` is the ring 2 star over ring 1's octant `o` when the combo goes off (EMPTY if none yet).
 */
export function waitingTargets(targets: Target[], roles: Roles, ring2AtTrigger: (o: number) => number): Target[] {
  return targets.filter((t) => {
    if (t.wild) return false;
    if (t.ring === INNER) return t.octant === roles.A1 && t.colour !== roles.colours.A;
    if (t.octant !== roles.A1 && t.octant !== roles.A2) return false;
    if (t.ring === MIDDLE) return ring2AtTrigger(t.octant) !== t.colour;
    return t.ring === TOP;
  });
}

/**
 * A ring 2 target over E isn't turned wild by the ring 1 clears, so usually the star over E at trigger
 * time has to be its colour already. Not judged: other clears can still reach it (one in 300 generated
 * donkeys did), so this is only a pointer for hints.
 */
export function unfillableOverE(targets: Target[], roles: Roles, ring2AtTrigger: (o: number) => number): Target | null {
  const t = targets.find((x) => x.ring === MIDDLE && x.octant === roles.E && !x.wild);
  if (!t) return null;
  const star = ring2AtTrigger(roles.E);
  return star !== EMPTY && star !== t.colour ? t : null;
}

const ring1Of = (cells: number[]) => OCTANTS.map((o) => cells[cell(INNER, o)]);
const ring2Of = (cells: number[]) => OCTANTS.map((o) => cells[cell(MIDDLE, o)]);

// --- Lesson 3: position the base ---

/**
 * Judges the base's position: ring 1 turned so a target waits for the last clear, and ring 2 one turn
 * before the trigger (its D over ring 1's E). Either leftover may be the one broken.
 */
export function judgeBasePosition(cells: number[], targets: Target[]): RingJudgement {
  const ring1 = ring1Of(cells), ring2 = ring2Of(cells);
  const options = readings(ring1);
  if (!options.length) return { kind: 'fail', message: 'Ring 1 isn’t a donkey base.', cells: [] };
  let ring2Wrong: Roles | null = null;
  for (const roles of options) {
    // One turn before the trigger, ring 2's star over octant o goes over o + step when the combo goes off.
    const atTrigger = (o: number) => ring2[m8(o - roles.step)];
    if (!waitingTargets(targets, roles, atTrigger).length) continue;
    if (ring2[roles.E] === roles.colours.D) return { kind: 'pass' };
    ring2Wrong ??= roles;
  }
  if (ring2Wrong) {
    const d2 = OCTANTS.filter((o) => ring2[o] === ring2Wrong!.colours.D).map((o) => cell(MIDDLE, o));
    return { kind: 'fail', message: `Ring 2’s ${name(ring2Wrong.colours.D)} goes over ring 1’s ${name(ring2Wrong.colours.E)}.`, cells: [...d2, cell(INNER, ring2Wrong.E)] };
  }
  return { kind: 'fail', message: 'Nothing waits for the last clear.', cells: [] };
}

// --- Lesson 4: layer 2 ---

/** A base as dealt: the roles in the dealt turn of the rings, ring 1's colours, and where ring 2's D and E were. */
export interface DealtBase { roles: Roles; ring1: number[]; d2: number; e2: number }

/** How far each ring has turned since the deal, in octants (a star at o is now at o + turn). */
export interface Turns { ring1: number; ring2: number }

/**
 * Judges ring 2 as it is built on a dealt base. Ring 2 is read in the dealt frame: its star at dealt
 * octant x sits over ring 1's x one turn before the trigger and over x + step when the combo goes off.
 * Ring 2 is judged once full (or when `final`); a wrong drop-in star fails at once. Stacks are only
 * warned about (see layer2Warnings): working donkeys often have them, as long as ring 3 doesn't complete them.
 */
export function judgeLayer2(cells: number[], targets: Target[], base: DealtBase, turns: Turns, final = false): RingJudgement {
  const { roles } = base;
  const { A, B, C } = roles.colours;
  const ring2 = (x: number) => cells[cell(MIDDLE, x + turns.ring2)];
  const ring2Cell = (x: number) => cell(MIDDLE, x + turns.ring2);
  const ring1Cell = (o: number) => cell(INNER, o + turns.ring1);
  const isBase = (x: number) => m8(x) === base.d2 || m8(x) === base.e2;
  const dropC = m8(roles.C1 - roles.step), dropB = m8(roles.B1 - roles.step);
  for (const x of OCTANTS) {
    const colour = ring2(x);
    if (colour === EMPTY || isBase(x)) continue;
    const trigger = m8(x + roles.step);
    if (x === dropC && colour !== B) return { kind: 'fail', message: `This one drops in after the ${plural(C)}: it must be ${name(B)}.`, cells: [ring2Cell(x), ring1Cell(trigger)] };
    if (x === dropB && colour !== A) return { kind: 'fail', message: `This one drops in after the ${plural(B)}: it must be ${name(A)}.`, cells: [ring2Cell(x), ring1Cell(trigger)] };
  }
  const empty = OCTANTS.filter((x) => ring2(x) === EMPTY);
  if (empty.length) {
    if (!final) return { kind: 'building' };
    for (const [x, colour, after] of [[dropC, B, C], [dropB, A, B]] as const) {
      if (ring2(x) === EMPTY) return { kind: 'fail', message: `The ${name(colour)} that drops in after the ${plural(after)} is missing.`, cells: [ring2Cell(x)] };
    }
    return { kind: 'fail', message: 'Ring 2 isn’t full.', cells: empty.map(ring2Cell) };
  }
  // Something must still wait for the last clear, with the rings as they are now.
  const now = shiftRoles(roles, turns.ring1);
  const atTrigger = (o: number) => ring2(m8(o - turns.ring1 - roles.step));
  if (!waitingTargets(targets, now, atTrigger).length) {
    const filled = targets.filter((t) => t.ring === MIDDLE && (t.octant === now.A1 || t.octant === now.A2)).map((t) => cell(MIDDLE, t.octant));
    return { kind: 'fail', message: 'Nothing waits for the last clear now.', cells: filled };
  }
  return { kind: 'pass' };
}

/** Roles with ring 1 turned `by` octants. */
export function shiftRoles(roles: Roles, by: number): Roles {
  const s = (o: number) => m8(o + by);
  return { ...roles, D: s(roles.D), E: s(roles.E), C2: s(roles.C2), C1: s(roles.C1), B2: s(roles.B2), B1: s(roles.B1), A2: s(roles.A2), A1: s(roles.A1) };
}

/**
 * Ring 2 stars over a ring 1 star of their own colour, with ring 2 where it is when the combo goes off or
 * one turn before. Not fails: a third of that colour in ring 3 is what would set one off early.
 */
export function layer2Warnings(cells: number[], base: DealtBase, turns: Turns): { message: string; cells: number[] }[] {
  const { roles, ring1 } = base;
  const ring2 = (x: number) => cells[cell(MIDDLE, x + turns.ring2)];
  const dropC = m8(roles.C1 - roles.step), dropB = m8(roles.B1 - roles.step);
  const warnings: { message: string; cells: number[] }[] = [];
  for (const x of OCTANTS) {
    const colour = ring2(x);
    if (colour === EMPTY || m8(x) === base.d2 || m8(x) === base.e2) continue;
    const trigger = m8(x + roles.step);
    if (x !== dropC && x !== dropB && colour === ring1[trigger]) {
      warnings.push({ message: `Careful: ${name(colour)} over ${name(colour)} when the combo goes off.`, cells: [cell(MIDDLE, x + turns.ring2), cell(INNER, trigger + turns.ring1)] });
    }
    if (colour === ring1[x]) warnings.push({ message: `Careful: ${name(colour)} over ${name(colour)} one turn before the combo.`, cells: [cell(MIDDLE, x + turns.ring2), cell(INNER, x + turns.ring1)] });
  }
  return warnings;
}

// --- Dealing ---

/**
 * A base under `targets`: ring 1 as a donkey base turned so a target waits for the last clear, and
 * ring 2's D and E one turn before the trigger (D over ring 1's E, E one to three places on, the same
 * way round). Null if no turn of this base suits these targets.
 */
export function dealBase(rng: Random, targets: Target[]): { cells: number[]; base: DealtBase } | null {
  const colours = [0, 1, 2, 3, 4];
  for (let i = 4; i > 0; i--) { const j = rng.integer(0, i); [colours[i], colours[j]] = [colours[j], colours[i]]; }
  const [A, B, C, D, E] = colours;
  const step: 1 | -1 = rng.integer(0, 1) ? 1 : -1;
  const gap = rng.integer(1, 3);
  const turns = OCTANTS.filter(() => true);
  for (let i = 7; i > 0; i--) { const j = rng.integer(0, i); [turns[i], turns[j]] = [turns[j], turns[i]]; }
  for (const d of turns) {
    const ring1 = Array<number>(8).fill(EMPTY);
    [D, C, C, B, B, A, A, E].forEach((c, k) => { ring1[m8(d + step * k)] = c; });
    const roles = rolesFor(ring1, d)!;
    const d2 = roles.E, e2 = m8(roles.E - step * gap);
    const ring2 = Array<number>(8).fill(EMPTY);
    ring2[d2] = D; ring2[e2] = E;
    const atTrigger = (o: number) => ring2[m8(o - step)];
    if (!waitingTargets(targets, roles, atTrigger).length) continue;
    const cells = Array<number>(32).fill(EMPTY);
    ring1.forEach((c, o) => { cells[cell(INNER, o)] = c; });
    ring2.forEach((c, o) => { cells[cell(MIDDLE, o)] = c; });
    return { cells, base: { roles, ring1, d2, e2 } };
  }
  return null;
}

/** The base turned out of position for lesson 3: ring 1 and ring 2 turned so it doesn't pass. */
export function scrambleBase(rng: Random, cells: number[], targets: Target[]): number[] | null {
  for (let tries = 0; tries < 40; tries++) {
    const k1 = rng.integer(0, 7), k2 = rng.integer(0, 7);
    const next = [...cells];
    for (const o of OCTANTS) {
      next[cell(INNER, o + k1)] = cells[cell(INNER, o)];
      next[cell(MIDDLE, o + k2)] = cells[cell(MIDDLE, o)];
    }
    if (judgeBasePosition(next, targets).kind !== 'pass') return next;
  }
  return null;
}

export const positionWith = (p: Position, cells: number[]): Position => ({ ...p, cells: [...cells], targets: p.targets.map((t) => ({ ...t })), entry: { ...p.entry } });
