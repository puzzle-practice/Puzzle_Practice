import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { BoardRandom, type Cell, Hole, MAX_HOLE } from './board';
import { type CarpentryKind, CELL, COLS, Game, holeCell, type HoleSprite, LEVEL_HOLES, newStats, ROWS, type SoundName, type SpeedConfig, VIEW_X, VIEW_Y } from './game';

/** A greedy player: the placement covering the most open cells, preferring holes with pieces in. */
function bestMove(game: Game): { slot: number; turns: number; flip: boolean; cell: Cell } | null {
  let best: { slot: number; turns: number; flip: boolean; cell: Cell; score: number } | null = null;
  game.tools.forEach((tool, slot) => {
    if (!tool) return;
    for (const flip of [false, true]) {
      for (let turns = 0; turns < 4; turns++) {
        const piece = Object.assign(Object.create(Object.getPrototypeOf(tool.piece)), tool.piece);
        if (flip) piece.flip();
        for (let i = 0; i < turns; i++) piece.rotate(true);
        for (let x = 0; x < COLS; x++) {
          for (let y = 0; y < ROWS; y++) {
            if (game.inToolbox([x, y])) continue;
            const t = game.target([x, y], piece);
            if (!t || t.hole.size === 0 || t.hole.filled) continue;
            const covers = t.hole.checkPiece(piece, t.at[0], t.at[1]);
            if (covers === 0) continue;
            const score = covers * 10 + (t.hole.piecesUsed > 0 ? 5 : 0) - (piece.isPutty ? 30 : 0);
            if (!best || score > best.score) best = { slot, turns, flip, cell: [x, y], score };
          }
        }
      }
    }
  });
  return best;
}

function play(speed: SpeedConfig | null, seed: number, moves: number, kind?: CarpentryKind) {
  const sounds: SoundName[] = [];
  let levels = 0;
  const stats = newStats();
  let now = 0;
  const game = new Game(seed, new BoardRandom(seed), stats, { sound: (s) => sounds.push(s), levelDone: () => levels++ }, speed, new Random(seed), now, kind);
  const tick = (ms: number) => {
    for (let t = 0; t < ms; t += 16) game.update((now += 16));
  };
  tick(1500);
  let placed = 0;
  for (let i = 0; i < moves && levels === 0; i++) {
    while ((game.scrolling || game.levelText) && levels === 0) tick(100);
    if (levels > 0) break;
    const move = bestMove(game);
    if (!move) break;
    game.keyPick(move.slot);
    if (move.flip) game.flip();
    for (let t = 0; t < move.turns; t++) game.rotate(true);
    const px = VIEW_X + move.cell[0] * CELL + 5;
    const py = VIEW_Y + move.cell[1] * CELL + 5;
    game.pointerMove(px, py);
    const before = stats.placed;
    game.pointerDown(1, px, py);
    game.pointerUp(1);
    if (stats.placed > before) placed++;
    tick(1600);
  }
  return { game, stats, sounds, levels, placed };
}

describe('vampire carpentry play', () => {
  it.each([1, 2, 3])('keeps native Speed size %s playable with independent hole and piece streams', size => {
    const { stats } = play({ holes: 2, size, letter: 12 }, 99 + size, 60, { ship: false, difficulty: 8, tokens: 0, independentStreams: true });
    expect(stats.holesFilled).toBeGreaterThan(5);
  });
  it('fills a board of 17 holes, scrolling in new ones, then moves on', () => {
    const { stats, sounds, levels, placed } = play(null, 12345, 400);
    expect(placed).toBeGreaterThan(50);
    expect(stats.holesFilled).toBe(LEVEL_HOLES);
    expect(levels).toBe(1);
    expect(stats.scrolls[0] + stats.scrolls[1]).toBeGreaterThan(3);
    expect(sounds.filter((s) => s.startsWith('hole_m') || s === 'hole_craftsmanship' || s === 'hole_pigs_breakfast').length).toBe(LEVEL_HOLES);
    expect(sounds).toContain('hole_grows');
    expect(stats.grades.reduce((a, b) => a + b, 0)).toBe(LEVEL_HOLES);
  });

  it('speed mode keeps dealing small holes', () => {
    for (const size of [1, 2, 3]) {
      const { stats } = play({ holes: 2, size, letter: 12 }, 99 + size, 60);
      expect(stats.holesFilled, `size ${size}`).toBeGreaterThan(5);
    }
  });
});

describe('ship carpentry play', () => {
  it('fills a board at its difficulty with ship ratings, points and tokens', () => {
    for (const seed of [7, 8, 9]) {
      const { game, stats, sounds, levels } = play(null, seed, 400, { ship: true, difficulty: 5, tokens: 2 });
      expect(game.levelHoles).toBe(10);
      expect(levels).toBe(1);
      expect(stats.holesFilled).toBe(10);
      expect(stats.ranks.reduce((a, b) => a + b, 0)).toBe(10);
      expect(sounds.some((s) => s === 'hole_fair_job' || s === 'hole_sloppy_work' || s === 'hole_pigs_breakfast' || s === 'hole_craftsmanship' || s === 'hole_masterpiece')).toBe(true);
      expect(game.tools.every((t) => !t || t.piece.isPutty || t.piece.tokens !== null)).toBe(true);
      // Only the pool's shapes come up: never the ring or the star.
      expect(stats.tokens[5] + stats.tokens[6]).toBe(0);
    }
  }, 60000);

  it('a masterpiece hands over its token twice, with the grain and nice set lines', () => {
    const sounds: SoundName[] = [];
    const stats = newStats();
    let now = 0;
    const game = new Game(5, new BoardRandom(5), stats, { sound: (s) => sounds.push(s), levelDone: () => {} }, null, new Random(5), now, { ship: true, difficulty: 5, tokens: 1 });
    for (; now < 1500; now += 16) game.update(now);
    // A hole one I plank fills, with a whole diamond already pieced together beside it.
    const hole = Hole.shaped([[true], [true], [true], [true], [true]], 99);
    const shift = 1 + Math.trunc((MAX_HOLE - 5) / 2);
    const at = [shift + 1, 3];
    hole.tokens = Array.from({ length: 12 }, () => Array<number>(12).fill(0));
    [0, 1, 2, 3].forEach((q) => (hole.tokens![at[0] + (q & 1)][at[1] + (q >> 1)] = (2 << 2) | q));
    const old = game.holeSprites.findIndex((hs) => hs.hole === game.board.holes[0]);
    game.board.holes[0] = hole;
    const [cx, cy] = holeCell(0, hole);
    game.holeSprites[old] = (game as unknown as { holeSprite(h: Hole, pos: Cell): HoleSprite }).holeSprite(hole, [game.view[0] + cx * CELL, game.view[1] + cy * CELL]);
    game.holdCheat(1);
    const px = VIEW_X + (cx + 2) * CELL + 5;
    const py = VIEW_Y + cy * CELL + 5;
    game.pointerMove(px, py);
    game.pointerDown(1, px, py);
    game.pointerUp(1);
    expect(hole.filled).toBe(true);
    expect(stats.ranks[0]).toBe(1);
    // 1 x 2 - 4 for the masterpiece, 1 for the set, 0 for the grain of a size-1 hole.
    expect(stats.points).toBe(-1);
    expect(stats.tokens[2]).toBe(2);
    expect(game.tokenFlyers).toHaveLength(1);
    expect(game.texts.map((t) => t.text)).toEqual(['A Masterpiece!', 'Double Bonus!']);
    expect(game.texts[0].sub).toBe('Grain Bonus.\nNice set.');
    expect(sounds).toContain('grain_bonus');
  });

  it('deals no tokens with tokens off, and the tutorial board at difficulty 0', () => {
    const { game, stats, levels } = play(null, 3, 40, { ship: true, difficulty: 0, tokens: 0 });
    expect(game.levelHoles).toBe(1);
    expect(levels).toBe(1);
    expect(stats.holesFilled).toBe(1);
    expect(game.board.toolTokens.every((t) => t === null)).toBe(true);
  });
});
