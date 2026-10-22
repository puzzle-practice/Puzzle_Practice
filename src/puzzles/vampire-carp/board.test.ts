import { describe, expect, it } from 'vitest';
import { CarpentryBoard, Hole, Piece, BoardRandom, PUTTY_TOOL, tokenOnPiece } from './board';
import parity from './carpentry-parity.json';
import tokenParity from './carpentry-token-parity.json';

interface HoleState {
  id: number;
  size: number;
  used: number;
  grain: boolean;
  knock: [number, number] | null;
  dump: string;
}
interface State {
  tools: number[];
  scroll: [number, number];
  holes: HoleState[];
}
interface Move {
  slot: number;
  orient: number;
  hole: number;
  at: [number, number];
  reopened: number;
  covered: number;
  rank: number;
  after: State;
}

function state(board: CarpentryBoard, scroll: [number, number]): State {
  return {
    tools: [...board.toolbox],
    scroll,
    holes: board.holes.map((h) => ({
      id: h.id,
      size: h.size,
      used: h.piecesUsed,
      grain: h.badGrains === 0,
      knock: h.knock ? [h.knock[0], h.knock[1]] : null,
      dump: `holedata= {${h.dump().replace(/\n/g, '|')}}`,
    })),
  };
}

describe('carpentry board matches reference fixtures', () => {
  // Games played on the real game classes by scripts/parity/CarpentryParity.java.
  for (const game of parity as { seed: number; start: State; moves: Move[] }[]) {
    it(`seed ${game.seed}`, () => {
      const board = new CarpentryBoard(game.seed);
      expect(state(board, [0, 0])).toEqual(game.start);
      let done = 0;
      game.moves.forEach((move, i) => {
        const piece = new Piece(board.toolbox[move.slot], move.orient);
        const reopened = board.pieceWillApply(move.hole);
        board.populateNextTool(move.slot);
        const hole = board.holes[move.hole];
        const covered = hole.placePiece(piece, move.at);
        let scroll: [number, number] = [0, 0];
        let rank = -1;
        if (hole.filled) {
          rank = hole.rank;
          done++;
          scroll = board.checkForNewHoles(17 - done);
        }
        expect({ i, reopened, covered, rank, after: state(board, scroll) }).toEqual({
          i,
          reopened: move.reopened,
          covered: move.covered,
          rank: move.rank,
          after: move.after,
        });
      });
    });
  }
});

describe('pieces', () => {
  it('turn four times back to where they started, and mirror twice', () => {
    for (let o = 0; o < 8; o++) {
      const p = new Piece(6, o);
      for (let i = 0; i < 4; i++) p.rotate(true);
      expect(p.orient).toBe(o);
      p.rotate(true);
      p.rotate(false);
      expect(p.orient).toBe(o);
      p.flip();
      p.flip();
      expect(p.orient).toBe(o);
    }
  });

  it('keep their grain through a half turn and a mirror, not a quarter turn', () => {
    const p = new Piece(6 << 1, 0);
    expect(p.grainKept).toBe(true);
    p.rotate(true);
    expect(p.grainKept).toBe(false);
    p.rotate(true);
    p.flip();
    expect(p.grainKept).toBe(true);
  });
});

describe('vampire holes', () => {
  it('are always 4 high and 9 or 10 wide, 25 cells', () => {
    const rng = new BoardRandom(42);
    const widths = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const h = Hole.random(5, rng, i);
      expect(h.height).toBe(4);
      widths.add(h.width);
      expect(h.holeSquares).toBe(25);
    }
    expect([...widths].sort()).toEqual([10, 9]);
  });

  it('putty fills a region of up to five cells', () => {
    const cells = Array.from({ length: 3 }, () => Array(2).fill(true));
    const hole = Hole.shaped(cells, 1);
    const putty = new Piece(PUTTY_TOOL, 1);
    expect(hole.checkPiece(putty, 0, 0)).toBe(0);
    const small = Hole.shaped([[true, true], [true, false]], 2);
    expect(small.checkPiece(putty, 0, 0)).toBe(3);
    expect(small.placePiece(putty, [0, 0])).toBe(3);
    expect(small.holeSquares).toBe(0);
  });
});

interface TokenHoleState extends HoleState {
  same: boolean;
  tokens: [number, number, number][] | null;
}
interface TokenState {
  tools: number[];
  bonuses: (number[] | null)[];
  scroll: [number, number];
  holes: TokenHoleState[];
}
interface TokenMove extends Omit<Move, 'after'> {
  points: number;
  streak: number;
  token: number;
  tokenAt: [number, number];
  after: TokenState;
}

function tokenState(board: CarpentryBoard, scroll: [number, number]): TokenState {
  const s = state(board, scroll);
  return {
    tools: s.tools,
    bonuses: board.toolTokens.map((t) => (t ? [...t] : null)),
    scroll,
    holes: board.holes.map((h, i) => {
      const tokens: [number, number, number][] = [];
      h.tokens?.forEach((col, x) => col.forEach((v, y) => v && tokens.push([x, y, v])));
      return { ...s.holes[i], same: h.homogenous, tokens: h.tokens ? tokens : null };
    }),
  };
}

describe('ship carpentry and maneuver tokens match reference fixtures', () => {
  // Games played on the test build's own classes by scripts/parity/CarpentryTokenParity.java, at
  // difficulties 0-9 with tokens off, normal shapes, and normal shapes with blades.
  const LEVEL = [1, 1, 4, 6, 8, 10, 12, 15, 17, 20];
  type Game = { seed: number; difficulty: number; mode: number; desired: number; start: TokenState; moves: TokenMove[] };
  for (const game of tokenParity as Game[]) {
    it(`seed ${game.seed}, difficulty ${game.difficulty}, tokens ${game.mode}`, () => {
      const board = new CarpentryBoard(game.seed, game.difficulty, -1, game.mode, game.desired);
      expect(tokenState(board, [0, 0])).toEqual(game.start);
      let done = 0;
      game.moves.forEach((move, i) => {
        const piece = new Piece(board.toolbox[move.slot], move.orient, board.toolTokens[move.slot]);
        const reopened = board.pieceWillApply(move.hole);
        board.populateNextTool(move.slot);
        const hole = board.holes[move.hole];
        const covered = hole.placePiece(piece, move.at);
        let scroll: [number, number] = [0, 0];
        let rank = -1;
        let points = 0;
        let streak = 0;
        let token = 0;
        let tokenAt: [number, number] = [-1, -1];
        if (hole.filled) {
          rank = hole.rank;
          points = hole.computeBonus();
          streak = board.checkPerfectBonus(move.hole);
          const got = hole.takeToken(board.desiredBonus, board.rng);
          if (got) {
            token = got.type;
            tokenAt = got.at;
          }
          done++;
          scroll = board.checkForNewHoles(LEVEL[game.difficulty] - done);
        }
        expect({ i, reopened, covered, rank, points, streak, token, tokenAt, after: tokenState(board, scroll) }).toEqual({
          i,
          reopened: move.reopened,
          covered: move.covered,
          rank: move.rank,
          points: move.points,
          streak: move.streak,
          token: move.token,
          tokenAt: move.tokenAt,
          after: move.after,
        });
      });
    });
  }
});

describe('ship carpentry scoring', () => {
  it('scores a masterpiece, a nice set and the grain like the game', () => {
    const cells = Array.from({ length: 5 }, () => Array(2).fill(true));
    const hole = Hole.shaped(cells, 1);
    // Two I planks lying across, grain kept: a masterpiece of a nice set.
    hole.placePiece(new Piece(1 << 1 | 1, 1), [2, 0]);
    hole.placePiece(new Piece(1 << 1 | 1, 1), [2, 1]);
    expect(hole.filled).toBe(true);
    expect(hole.computeBonus()).toBe(2 * 2 - 4 + 1 + 1);
  });

  it('counts masterpieces in a row until one isn’t', () => {
    const board = new CarpentryBoard(3, 5, -1);
    const perfect = Hole.shaped([[true], [true], [true], [true], [true]], 50);
    perfect.placePiece(new Piece(1 << 1 | 1, 1), [2, 0]);
    board.holes[0] = perfect;
    expect([board.checkPerfectBonus(0), board.checkPerfectBonus(0), board.checkPerfectBonus(0)]).toEqual([0, 1, 2]);
    perfect.piecesUsed++;
    expect(board.checkPerfectBonus(0)).toBe(0);
    perfect.piecesUsed--;
    expect(board.checkPerfectBonus(0)).toBe(0);
  });

  it('puts each token quarter where the turned plank’s cells land', () => {
    // An O-shaped block can't be built from one plank, but a P's 2x2 can hold a whole token.
    for (const corner of [0, 1, -255, -256 + 1]) {
      const token = tokenOnPiece(3, 2, corner);
      const quarters = token.filter(Boolean).length;
      expect(quarters).toBeGreaterThan(0);
      expect(quarters).toBeLessThanOrEqual(4);
    }
    for (let o = 0; o < 8; o++) {
      const p = new Piece(3 << 1, o, tokenOnPiece(3, 2, -1));
      // Wherever the quarters went, they keep their places in one 2x2 block.
      const placed = p.cells().map(([x, y], k) => ({ x, y, v: p.token(k) })).filter((c) => c.v);
      for (const a of placed) {
        expect(a.v >> 2).toBe(2);
        for (const b of placed) {
          expect(b.x - a.x).toBe((b.v & 1) - (a.v & 1));
          expect(b.y - a.y).toBe(((b.v >> 1) & 1) - ((a.v >> 1) & 1));
        }
      }
    }
  });
});
