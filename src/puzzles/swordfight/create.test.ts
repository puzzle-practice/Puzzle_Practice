import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { gameSkillStyle, skillStyle } from './npc';
import { Board, BREAKER, DAMAGE, DAMAGE_HINT, EMPTY, H, isBlock, METAL, W, blockPiece } from './board';
import { boardCode, boardIssues, deal, load, paint, readBoardCode, settle, staged, unfuse } from './create';
import { Match, type MatchSettings } from './match';

const settings: MatchSettings = { cultists: 0, homunculi: 0, opponents: 0, thralls: 0, swabbies: 0, cultistSkill: 60, homunculusSkill: 60, thrallSkill: 50, swabbieSkill: 50, opponentType: 'tally', ai: skillStyle(60), gameAi: gameSkillStyle(60), difficulty: 5, breakers: 12.5, sword: [2, 0, 0] };

describe('swordfight create', () => {
  it('paints pieces that fall and fuse as the game settles them', () => {
    const board = new Board();
    expect(paint(board, 0, 3, 1)).toBe(true);
    expect(board.get(0, H - 1)).toBe(1);
    expect(board.get(0, 3)).toBe(EMPTY);
    paint(board, 1, 0, 1);
    paint(board, 0, 0, 1);
    paint(board, 1, 0, 1);
    // Two by two greens fuse into a block.
    expect(isBlock(board.get(0, H - 1))).toBe(true);
    expect(board.get(0, H - 1)).toBe(blockPiece(1, 0, 1, 2, 2));
    expect(paint(board, 1, H - 1, 1)).toBe(false);
  });

  it('breaks a block when one of its squares is painted', () => {
    const board = new Board();
    board.setBlock(2, 0, H - 1, 3, 2);
    paint(board, 2, H - 2, 0);
    // The red sits on the blue that's left; the four blues fuse again.
    expect(board.get(2, H - 2)).toBe(0);
    expect(board.get(2, H - 1)).toBe(2);
    expect(board.get(0, H - 1)).toBe(blockPiece(2, 0, 1, 2, 2));
    unfuse(board, 0, H - 1);
    expect(board.get(0, H - 1)).toBe(2);
  });

  it('shatters a breaker painted against its colour', () => {
    const board = new Board();
    paint(board, 0, 0, 3);
    paint(board, 0, 0, 3);
    paint(board, 2, 0, 3 | BREAKER);
    expect(board.get(2, H - 1)).toBe(3 | BREAKER);
    paint(board, 0, 0, 3 | BREAKER);
    expect(Array.from(board.cells).filter((p) => p !== EMPTY)).toEqual([3 | BREAKER]);
  });

  it('paints strike damage, which breakers do not shatter', () => {
    expect(staged(2, 'damage')).toBe(2 | DAMAGE);
    expect(staged(2, 'hint')).toBe(2 | DAMAGE_HINT);
    expect(staged(2 | BREAKER, 'damage')).toBe(2 | BREAKER);
    expect(staged(EMPTY, 'hint')).toBe(EMPTY);
    const board = new Board();
    paint(board, 0, 0, staged(0, 'damage'));
    paint(board, 0, 0, BREAKER);
    expect(board.get(0, H - 1)).toBe(DAMAGE);
    expect(board.get(0, H - 2)).toBe(BREAKER);
  });

  it('round-trips boards and pairs through text', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const board = new Board();
      deal(board, new Random(seed), 20);
      board.set(5, 0, METAL);
      board.set(4, 0, 3 | DAMAGE_HINT);
      board.set(3, 1, 1 | DAMAGE);
      const text = boardCode(board, [0, 2 | BREAKER], [3, 1]);
      const read = readBoardCode(text)!;
      expect(read.pair).toEqual([0, 2 | BREAKER]);
      expect(read.next).toEqual([3, 1]);
      const copy = new Board();
      copy.cells.set(read.cells);
      expect(Array.from(copy.cells)).toEqual(Array.from(board.cells));
      expect(readBoardCode(boardCode(board, null, null))!.pair).toBeNull();
    }
    expect(readBoardCode('S..')).toBeNull();
    expect(readBoardCode(`S${'..'.repeat(78)}:rg`)).toBeNull();
  });

  it('settles pasted boards and repairs broken blocks', () => {
    // A lone block tile in mid-air: it falls as a loose piece.
    const read = readBoardCode(`S${'..'.repeat(10)}r5${'..'.repeat(67)}`)!;
    const board = new Board();
    load(board, read);
    expect(board.get(4, H - 1)).toBe(0);
    expect(board.cells.filter((p) => p !== EMPTY).length).toBe(1);
  });

  it('deals settled boards', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const board = new Board();
      deal(board, new Random(seed), 30);
      const settled = board.clone();
      settle(settled);
      expect(Array.from(settled.cells)).toEqual(Array.from(board.cells));
      for (let x = 0; x < W; x++) for (let y = 0; y < H - 6; y++) expect(board.get(x, y)).toBe(EMPTY);
    }
  });

  it('notes boards a fight could not show', () => {
    const board = new Board();
    expect(boardIssues(board, [[0, 1]], 10)).toEqual([]);
    expect(boardIssues(board, [[0, BREAKER]], 0).join(' ')).toContain('0%');
    board.set(3, 0, 1);
    expect(boardIssues(board, [], 10).join(' ')).toContain('knocks ye out');
  });

  it('holds the pair until drop is held, and carries on after a knock-out', () => {
    const m = new Match(settings, 7, 0);
    m.endless = true;
    const f = m.player;
    f.hover = true;
    let now = 0;
    const run = (ms: number) => { for (const end = now + ms; now < end;) { now += 16; m.update(now); } };
    run(500);
    expect(f.pair?.row).toBe(0);
    run(5000);
    expect(f.pair?.row).toBe(0);
    f.setFast(true, now);
    run(200);
    expect(f.pair!.row).toBeGreaterThan(0);
    f.setFast(false, now);
    const row = f.pair!.row;
    run(5000);
    expect(f.pair!.row).toBe(row);
    m.setNext([2, 2]);
    expect(f.next).toEqual([2, 2]);
    f.setFast(true, now);
    run(3000);
    expect(f.pair!.pieces).toEqual([2, 2]);
    // A knocked-out board comes back once it's edited.
    for (let y = 0; y < H; y++) f.board.set(3, y, y % 2 ? 0 : 1);
    f.setFast(true, now);
    run(3000);
    expect(f.out).toBe(true);
    expect(m.result).toBeNull();
    for (let y = 0; y < H; y++) f.board.set(3, y, EMPTY);
    m.edited(now);
    run(100);
    expect(f.out).toBe(false);
    expect(f.pair).not.toBeNull();
    f.redeal([1, 3], now);
    expect(f.pair).toMatchObject({ pieces: [1, 3], row: 0, col: 3, held: 0 });
  });
});
