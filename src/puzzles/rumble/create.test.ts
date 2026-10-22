import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { H } from './board';
import { colourMapping } from './gloves';
import { BLUE, FURBALL, ORANGE, ball, charged, colourOf, isBall, isCharged, isDark } from './pieces';
import {
  MAX_LENGTH, MAX_WIDTH, SimGlove, ballCount, convertBoard, dealBoard, emptyBoard, floating, resetSparks, rollPunch, shaftOf,
  werewolfPiece, furballColours, furballSlots, viewerBoard, viewerBruises, dealInto, snapshotBoard, restoreBoard,
} from './create';
import { Match, type MatchSettings } from './match';
import { DEFAULT_STYLE } from './npc';

describe('Create mode', () => {
  it('deals full rows at 100% density and nothing at 0%', () => {
    const full = dealBoard(new Random(1), 4, 100, false);
    expect(ballCount(full)).toBe(10 + 9 + 10 + 9);
    expect(full.lowest()).toBe(3);
    expect(ballCount(dealBoard(new Random(1), 6, 0, false))).toBe(0);
  });

  it('never deals a ball that is not attached to the top', () => {
    for (let seed = 0; seed < 20; seed++) {
      const b = dealBoard(new Random(seed), 12, 55, false);
      expect(floating(b)).toEqual([]);
      expect(b.lowest()).toBeLessThan(12);
    }
  });

  it('swaps orange for furballs and back, keeping the ball state', () => {
    expect(colourOf(werewolfPiece(ball(ORANGE), true))).toBe(FURBALL);
    expect(colourOf(werewolfPiece(ball(FURBALL), false))).toBe(ORANGE);
    expect(werewolfPiece(ball(BLUE), true)).toBe(ball(BLUE));
    const spark = werewolfPiece(charged(ball(ORANGE)), true);
    expect(isCharged(spark) && colourOf(spark) === FURBALL).toBe(true);
    const b = dealBoard(new Random(3), 8, 100, true);
    const colours = () => {
      const seen = new Set<number>();
      for (let y = 0; y < H; y++) for (let x = 0; x < b.width(y); x++) if (isBall(b.get({ x, y }))) seen.add(colourOf(b.get({ x, y })));
      return seen;
    };
    expect(colours().has(FURBALL)).toBe(true);
    expect(colours().has(ORANGE)).toBe(false);
    convertBoard(b, false);
    expect(colours().has(FURBALL)).toBe(false);
    expect(colours().has(ORANGE)).toBe(true);
  });

  it('gives werewolf punches furballs in place of orange', () => {
    // Bare fists' pattern has orange in its sprinkle rows only; Brass knuckles has it in the punch.
    const plainGlove = new SimGlove(0, 0, false);
    const wolf = new SimGlove(0, 0, true);
    let oranges = 0;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 9; x++) {
        if (colourOf(plainGlove.piece(x, y, true)) === ORANGE) {
          oranges++;
          expect(colourOf(wolf.piece(x, y, true))).toBe(FURBALL);
        }
      }
    }
    expect(oranges).toBeGreaterThan(0);
  });

  it('rolls whatever is left random and keeps what was chosen', () => {
    const rng = new Random(5);
    const lengths = new Set<number>();
    const widths = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const spec = rollPunch(rng, { bludgeon: null, colours: null, size: null, side: 'random', bruises: 0 });
      lengths.add(spec.length);
      widths.add(spec.width);
      expect(spec.colours).toBeLessThanOrEqual(255);
    }
    // Random punches are 3-20 long and 3-9 wide, every size reachable.
    expect([...lengths].sort((a, b) => a - b)).toEqual(Array.from({ length: 18 }, (_, i) => i + 3));
    expect([...widths].sort((a, b) => a - b)).toEqual(Array.from({ length: 7 }, (_, i) => i + 3));
    const fixed = rollPunch(rng, { bludgeon: 7, colours: 42, size: { length: 30, width: 12 }, side: 'left', bruises: 3 });
    expect(fixed).toEqual({ bludgeon: 7, colours: 42, length: MAX_LENGTH, width: MAX_WIDTH, side: 1, bruises: 3 });
  });

  it('lands a punch on the board, pushing its balls down', () => {
    const b = dealBoard(new Random(2), 3, 100, false);
    const before = ballCount(b);
    const spec = rollPunch(new Random(1), { bludgeon: 0, colours: 0, size: { length: 4, width: 6 }, side: 'left', bruises: 0 });
    b.punch(shaftOf(spec), new SimGlove(spec.bludgeon, spec.colours, false));
    expect(ballCount(b)).toBe(before + 24);
    expect(b.lowest()).toBe(6);
  });

  it('tracks charged balls as sparks after an edit', () => {
    const b = emptyBoard(new Random(1));
    b.set({ x: 2, y: 0 }, charged(ball(BLUE)));
    resetSparks(b);
    expect(b.sparks).toEqual([{ x: 2, y: 0 }]);
  });

  it('previews a punch on a copy exactly as it then lands, bruises included', () => {
    const rng = new Random(9);
    const b = dealBoard(rng, 6, 70, false);
    const spec = rollPunch(rng, { bludgeon: 7, colours: 13, size: { length: 7, width: 5 }, side: 'right', bruises: 6 });
    const state = rng.snapshot();
    const copy = b.clone();
    copy.punch(shaftOf(spec), new SimGlove(spec.bludgeon, spec.colours, false));
    rng.restore(state);
    b.punch(shaftOf(spec), new SimGlove(spec.bludgeon, spec.colours, false));
    expect(copy.cells).toEqual(b.cells);
  });

  it('puts the furball in each colour slot of a werewolf punch', () => {
    for (let slot = 0; slot < 5; slot++) {
      const colours = furballColours(0, slot);
      expect(colours % 2).toBe(0);
      expect(colourMapping(colours)[slot]).toBe(ORANGE);
    }
    expect(furballSlots(127)).toBe(1);
    expect(furballSlots(0)).toBe(5);
  });

  it('lands the viewer punches and sprinkle on an empty board, with furballs and no orange', () => {
    const count = (kind: number) => ballCount(viewerBoard(0, kind, 2));
    expect(count(0)).toBe(9 * 15);
    expect(count(1)).toBe(5 * 15);
    expect(count(4)).toBe(18);
    const b = viewerBoard(0, 2, 0);
    let bruised = 0;
    let orange = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < b.width(y); x++) {
        const piece = b.get({ x, y });
        if (isDark(piece)) bruised++;
        if (isBall(piece) && colourOf(piece) === ORANGE) orange++;
      }
    }
    expect(bruised).toBe(viewerBruises(15, 9));
    expect(viewerBruises(15, 9)).toBe(22);
    expect(viewerBruises(15, 5)).toBe(12);
    expect(orange).toBe(0);
    // The seed places the bruises: the same seed repeats, another moves them.
    expect(viewerBoard(3, 3, 4, 7).cells).toEqual(viewerBoard(3, 3, 4, 7).cells);
    expect(viewerBoard(3, 3, 4, 7).cells).not.toEqual(viewerBoard(3, 3, 4, 8).cells);
  });
});


describe('Create mode in a rumble', () => {
  const solo = (over: Partial<MatchSettings> = {}): MatchSettings => ({
    enemyRoster: [], allyRoster: [], ai: { ...DEFAULT_STYLE },
    rules: { timeBonus: true, suppression: true, dropOffToAttackers: true, defence: true, defenceSquares: 90, side: 'random' },
    oneFisted: false, werewolf: false, rumless: false, damageLevel: 0, startRows: 0, bludgeon: [127, 0], ...over,
  });
  const sandbox = (m: Match, over: Partial<Match['player']['sandbox']> = {}) => Object.assign(m.player.sandbox, { endless: true, shotTimer: false, drops: true, ...over });

  it('deals over a board in play below its damage rows', () => {
    const m = new Match(solo({ damageLevel: 30 }), 3, 0);
    const b = m.player.board;
    expect(b.damage).toBeGreaterThan(0);
    dealInto(b, new Random(5), 4, 100, false);
    expect(ballCount(b)).toBe(10 + 9 + 10 + 9);
    expect(b.lowest()).toBe(b.damage + 3);
    dealInto(b, new Random(5), 0, 0, false);
    expect(b.lowest()).toBe(-1);
  });

  it('undoes to a snapshot, rows and sparks included', () => {
    const m = new Match(solo(), 3, 0);
    const b = m.player.board;
    dealInto(b, new Random(2), 6, 90, false);
    b.set({ x: 0, y: 0 }, charged(ball(BLUE)));
    resetSparks(b);
    const saved = snapshotBoard(b);
    b.drop();
    dealInto(b, new Random(9), 2, 50, false);
    restoreBoard(b, saved);
    expect(b.cells).toEqual(saved.cells);
    expect(b.topLarge).toBe(saved.topLarge);
    expect(b.sparks).toEqual([{ x: 0, y: 0 }]);
  });

  it('lands a punch now exactly as the preview shows it', () => {
    const m = new Match(solo(), 11, 0);
    sandbox(m);
    const b = m.player.board;
    dealInto(b, new Random(4), 6, 85, false);
    const spec = { bludgeon: 3, colours: 17, length: 8, width: 7, side: 1, bruises: 12 };
    const glove = new SimGlove(spec.bludgeon, spec.colours, false);
    const state = b.alt.snapshot();
    const copy = b.clone();
    copy.punch(shaftOf(spec), glove);
    b.alt.restore(state);
    const punch = m.player.strikeNow(shaftOf(spec), glove, 100);
    expect(punch).not.toBeNull();
    expect(b.cells).toEqual(copy.cells);
    // Nothing else lands until it has finished.
    expect(m.player.strikeNow(shaftOf(spec), glove, 101)).toBeNull();
  });

  it('plays on past the bottom row, and only fires when you do without the shot timer', () => {
    const m = new Match(solo(), 21, 0);
    sandbox(m);
    const b = m.player.board;
    dealInto(b, new Random(1), 3, 100, false);
    b.set({ x: 4, y: H - 1 }, ball(BLUE));
    m.player.strikeNow(shaftOf({ bludgeon: 127, colours: 0, length: 3, width: 3, side: 0, bruises: 0 }), new SimGlove(127, 0, false), 0);
    expect(b.isDead()).toBe(true);
    for (let t = 0; t <= 20_000; t += 16) m.update(t);
    expect(m.player.out).toBe(false);
    expect(m.result).toBeNull();
    expect(m.player.stats.shots).toBe(0);
    expect(m.player.phase).toBe('control');
  });

  it('is knocked out by the bottom row when not endless', () => {
    const m = new Match(solo(), 21, 0);
    sandbox(m, { endless: false });
    dealInto(m.player.board, new Random(1), 3, 100, false);
    m.player.board.set({ x: 4, y: H - 1 }, ball(BLUE));
    m.player.strikeNow(shaftOf({ bludgeon: 127, colours: 0, length: 3, width: 3, side: 0, bruises: 0 }), new SimGlove(127, 0, false), 0);
    expect(m.player.out).toBe(true);
  });

  it('keeps the board where it is with drops off', () => {
    const m = new Match(solo(), 8, 0);
    sandbox(m, { drops: false });
    const f = m.player;
    let t = 0;
    for (let shot = 0; shot < 10; shot++) {
      f.press(0, t);
      f.release(0, t + 10);
      for (let i = 0; i < 400 && f.phase !== 'control'; i++) m.update((t += 16));
      t += 16;
    }
    expect(f.stats.shots).toBe(10);
    expect(f.stats.drops).toBe(0);
  });
});
