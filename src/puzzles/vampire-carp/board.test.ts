import { describe, expect, it } from 'vitest';
import { CarpentryBoard, Hole, Piece, BoardRandom, PUTTY_TOOL } from './board';
import parity from './carpentry-parity.json';

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
