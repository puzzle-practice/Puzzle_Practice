import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { Board, H } from './board';
import { colourMapping } from './gloves';
import { BLUE, CYAN, FURBALL, ORANGE, RED, ball, charged, colourOf, dark, isBall, isCharged, isDark, light } from './pieces';
import {
  MAX_LENGTH, MAX_WIDTH, SimGlove, ballCount, convertBoard, dealBoard, emptyBoard, floating, resetSparks, rollPunch, shaftOf,
  werewolfPiece, furballColours, furballSlots, viewerBoard, viewerBruises, dealInto, snapshotBoard, restoreBoard,
  applyBoardCode, boardCode, readBoardCode, generateChargedBoard, punchFromClear,
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

  it.each([false, true])('generates a reachable, supported charged chain beneath plain dense rows (werewolf=%s)', werewolf => {
    for (let seed = 0; seed < 30; seed++) {
      const normalRows = [1, 4, 6, 12][seed % 4], density = [5, 35, 65, 100][Math.floor(seed / 4) % 4];
      const b = new Board(new Random(1), new Random(2), [new Random(3), new Random(4)], {
        startRows: 0, werewolf, oneFisted: seed % 2 === 0, damageLevel: seed % 3 === 0 ? 10 : 0,
      });
      const hands = seed % 5 === 0 && werewolf ? [ball(FURBALL), ball(FURBALL)] : [ball(RED), ball(BLUE)];
      const opening = generateChargedBoard(b, new Random(seed), normalRows, 6, density, werewolf, hands);
      expect(opening, `seed ${seed}`).not.toBeNull();
      const firstRow = b.damage + normalRows, lastRow = Math.min(firstRow + 6, H - 1);
      let capacity = 0, filled = 0;
      for (let y = b.damage; y < firstRow; y++) for (let x = 0; x < b.width(y); x++) {
        expect(isBall(b.get({ x, y }))).toBe(true);
        expect(isCharged(b.get({ x, y }))).toBe(false);
      }
      for (let y = firstRow; y < lastRow; y++) for (let x = 0; x < b.width(y); x++) {
        capacity++;
        if (isBall(b.get({ x, y }))) filled++;
      }
      expect(filled).toBe(opening!.filledSlots);
      expect(opening!.availableSlots).toBeLessThan(capacity);
      const wanted = Math.max(3, Math.round(opening!.availableSlots * density / 100));
      expect(filled).toBeLessThanOrEqual(wanted);
      expect(wanted - filled).toBeLessThanOrEqual(4);
      if (density === 100) expect(filled).toBe(opening!.availableSlots);
      expect(b.groupOf(b.sparks[0]).size).toBe(3);
      expect(b.sparks.length).toBeGreaterThan(0);
      expect(b.sparks[0].y).toBe(firstRow);
      for (const spark of b.sparks) {
        expect(spark.y).toBeGreaterThanOrEqual(firstRow);
        expect(isCharged(b.get(spark))).toBe(true);
        expect(colourOf(b.get(spark))).not.toBe(FURBALL);
        expect(b.groupOf(spark).size).toBeGreaterThanOrEqual(3);
      }
      expect(floating(b)).toEqual([]);
      const shot = b.shoot(b.path(opening!.fist, opening!.dir))!;
      const copy = b.clone(); copy.set(shot.rest, ball(opening!.colour));
      expect(copy.place(shot.rest)?.groups).toHaveLength(b.sparks.length);
    }
  });

  it.each([35, 65])('spreads density %s across the charged height rather than shortening it', density => {
    for (let seed = 0; seed < 20; seed++) {
      const b = emptyBoard(new Random(1));
      const opening = generateChargedBoard(b, new Random(seed), 6, 6, density, false, [ball(RED), ball(BLUE)])!;
      expect(opening, `seed ${seed}`).not.toBeNull();
      const rows = Array.from({ length: 6 }, (_, row) => {
        let n = 0;
        for (let x = 0; x < b.width(6 + row); x++) if (isBall(b.get({ x, y: 6 + row }))) n++;
        return n;
      });
      expect(rows.every(n => n > 0), `seed ${seed}: ${rows}`).toBe(true);
      expect(rows.every((n, row) => n < b.width(6 + row)), `seed ${seed}: ${rows}`).toBe(true);
      const centre = rows.reduce((sum, n, row) => sum + n * row, 0) / opening.filledSlots;
      expect(centre, `seed ${seed}: ${rows}`).toBeGreaterThan(1.5);
      expect(b.lowest()).toBe(11);
      expect(floating(b)).toEqual([]);
    }
  });

  it('keeps the older top-growth layout available for existing recorded generation commands', () => {
    const old = emptyBoard(new Random(1)), spread = emptyBoard(new Random(1));
    const legacy = generateChargedBoard(old, new Random(12), 6, 6, 35, false, [ball(RED), ball(BLUE)], 3, 0, false)!;
    const current = generateChargedBoard(spread, new Random(12), 6, 6, 35, false, [ball(RED), ball(BLUE)])!;
    expect(legacy).not.toBeNull(); expect(current).not.toBeNull();
    expect(snapshotBoard(old)).not.toEqual(snapshotBoard(spread));
    expect(spread.lowest()).toBe(11);
  });

  it('exposes the actual new-row bruise chance as clears and drop-off affect the counter', () => {
    const b = emptyBoard(new Random(1));
    expect(b.bruiseChance).toBe(0);
    b.sent(3, 9, 30);
    expect(b.bruiseChance).toBe(3);
    b.sent(3, 9, 0);
    expect(b.bruiseChance).toBe(2);
    b.bruiseCounter = 100; expect(b.bruiseChance).toBe(40);
    b.bruiseCounter = -20; expect(b.bruiseChance).toBe(0);
  });

  it.each([false, true])('keeps the opening at three and drops the selected hanging balls (furball=%s)', werewolf => {
    for (let seed = 0; seed < 12; seed++) {
      const b = new Board(new Random(1), new Random(2), [new Random(3), new Random(4)], { startRows: 0, werewolf });
      const dropOff = [0, 6, 20, 40][seed % 4];
      const opening = generateChargedBoard(b, new Random(seed), 6, 6, 95, werewolf, [ball(RED), ball(BLUE)], 3, dropOff)!;
      expect(opening, `seed ${seed}, drop-off ${dropOff}`).not.toBeNull();
      expect(b.groupOf(b.sparks[0]).size).toBe(3);
      expect(floating(b)).toEqual([]);
      const distribution = new Map<number, number>();
      for (const spark of b.sparks) {
        const size = b.groupOf(spark).size, colour = colourOf(b.get(spark));
        distribution.set(colour, (distribution.get(colour) ?? 0) + size);
        expect(colour).not.toBe(FURBALL);
      }
      expect(distribution.size).toBeGreaterThanOrEqual(3);
      expect(Math.max(...distribution.values()) / opening.filledSlots).toBeLessThan(0.6);
      const shot = b.shoot(b.path(opening.fist, opening.dir))!;
      const copy = b.clone(); copy.set(shot.rest, ball(opening.colour));
      const clear = copy.place(shot.rest)!;
      expect(clear.groups).toHaveLength(b.sparks.length);
      expect(clear.grapes).toHaveLength(dropOff);
      for (const p of clear.grapes) expect(b.groupOf(p).size).toBeLessThanOrEqual(colourOf(b.get(p)) === FURBALL ? 4 : 2);
      if (werewolf) expect(clear.grapes.filter(p => colourOf(b.get(p)) === FURBALL).length).toBeGreaterThanOrEqual(Math.ceil(dropOff * 0.6));
    }
  });

  it('fits a minimal charged state beneath dense rows even with maximum damage', () => {
    const b = new Board(new Random(1), new Random(2), [new Random(3), new Random(4)], { startRows: 0, damageLevel: 100 });
    const opening = generateChargedBoard(b, new Random(3), 1, 6, 100, false, [ball(RED), ball(BLUE)]);
    expect(opening).not.toBeNull();
    expect(b.sparks.every(p => p.y > b.damage && b.groupOf(p).size >= 3)).toBe(true);
    expect(floating(b)).toEqual([]);
  });

  it('uses the requested average group size while preserving every group and its opening', () => {
    const means: number[] = [];
    for (const size of [3, 6, 10]) {
      const averages: number[] = [];
      for (let seed = 0; seed < 20; seed++) {
        const b = emptyBoard(new Random(1));
        const opening = generateChargedBoard(b, new Random(seed), 6, 6, 85, false, [ball(RED), ball(BLUE)], size)!;
        expect(opening).not.toBeNull();
        averages.push(opening.averageGroupSize);
        const sizes = b.sparks.map(p => b.groupOf(p).size);
        expect(sizes.every(n => n >= 3)).toBe(true);
        expect(sizes.reduce((sum, n) => sum + n, 0) / sizes.length).toBe(opening.averageGroupSize);
        const copy = b.clone(), shot = copy.shoot(copy.path(opening.fist, opening.dir))!;
        copy.set(shot.rest, ball(opening.colour));
        expect(copy.place(shot.rest)?.groups).toHaveLength(b.sparks.length);
      }
      const mean = averages.reduce((sum, n) => sum + n, 0) / averages.length;
      expect(Math.abs(mean - size)).toBeLessThan(1.6);
      means.push(mean);
    }
    expect(means[1]).toBeGreaterThan(means[0]);
    expect(means[2]).toBeGreaterThan(means[1]);
  });

  it('keeps the normal bruise cap while permitting an explicit experimental override', () => {
    const capped = emptyBoard(new Random(1)), experimental = emptyBoard(new Random(1));
    const spec = { bludgeon: 127, colours: 0, length: 4, width: 6, side: 1, bruises: 24 };
    capped.punch(shaftOf(spec), new SimGlove(127, 0, false));
    experimental.punch(shaftOf(spec), new SimGlove(127, 0, false), true);
    expect(capped.cells.filter(isDark)).toHaveLength(12);
    expect(experimental.cells.filter(isDark)).toHaveLength(24);
  });

  it('calculates punch growth from time, groups, drop-off and extra matched balls', () => {
    expect(punchFromClear(4, 0, 0, 0)).toMatchObject({ height: 3, width: 4, count: 0 });
    expect(punchFromClear(4, 0, 0, 5)).toMatchObject({ height: 6, width: 4 });
    expect(punchFromClear(4, 12, 0, 0)).toMatchObject({ height: 3, width: 8 });
    expect(punchFromClear(4, 0, 12, 0)).toMatchObject({ height: 3, width: 9 });
    expect(punchFromClear(1, 0, 6, 0)).toMatchObject({ height: 0, width: 0, count: 3 });
    expect(punchFromClear(60, 200, 200, 30)).toMatchObject({ height: H, width: 9 });
  });

  it('repeats charged layouts and opening shots from the same seed, and leaves impossible boards untouched', () => {
    const a = emptyBoard(new Random(1)), b = emptyBoard(new Random(1));
    const opening = generateChargedBoard(a, new Random(12), 6, 6, 65, false, [ball(RED), ball(BLUE)]);
    expect(generateChargedBoard(b, new Random(12), 6, 6, 65, false, [ball(RED), ball(BLUE)])).toEqual(opening);
    expect(snapshotBoard(a)).toEqual(snapshotBoard(b));
    const before = snapshotBoard(a);
    expect(generateChargedBoard(a, new Random(3), H, 6, 65, false, [ball(RED)])).toBeNull();
    expect(snapshotBoard(a)).toEqual(before);
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

describe('Freeplay board codes', () => {
  it('copies and pastes a board with charged balls, bruises and furballs', () => {
    const rng = new Random(5);
    const board = dealBoard(rng, 6, 80, true);
    board.set({ x: 0, y: 0 }, charged(ball(RED)));
    board.set({ x: 1, y: 0 }, dark(ball(BLUE)));
    board.set({ x: 2, y: 0 }, light(ball(FURBALL)));
    resetSparks(board);
    const code = boardCode(board);
    expect(code).toMatch(/^R:0:R5\^/);
    const copy = emptyBoard(new Random(1));
    expect(applyBoardCode(copy, readBoardCode(code)!, true)).toBe(true);
    expect(copy.cells).toEqual(board.cells);
    expect(copy.sparks).toEqual([{ x: 0, y: 0 }]);
  });

  it('keeps which rows are long, and swaps furballs for orange outside werewolf rumbling', () => {
    const board = emptyBoard(new Random(1));
    board.topLarge = 1;
    board.set({ x: 0, y: 0 }, ball(FURBALL));
    board.set({ x: 9, y: 1 }, ball(CYAN));
    const code = boardCode(board);
    expect(code).toBe('R:1:f/.........c');
    const copy = emptyBoard(new Random(2));
    applyBoardCode(copy, readBoardCode(code)!, false);
    expect(copy.topLarge).toBe(1);
    expect(copy.get({ x: 0, y: 0 })).toBe(ball(ORANGE));
    expect(copy.get({ x: 9, y: 1 })).toBe(ball(CYAN));
  });

  it('refuses text that is not a rumble board', () => {
    expect(readBoardCode('S:abc')).toBeNull();
    expect(readBoardCode('R:0:rrrrrrrrrrr')).toBeNull();
    expect(readBoardCode('R:0:rz')).toBeNull();
    expect(readBoardCode('R:0:')).toEqual({ firstLong: true, rows: [] });
  });
});
