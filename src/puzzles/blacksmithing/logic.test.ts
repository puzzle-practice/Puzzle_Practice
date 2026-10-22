import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import {
  BISHOP,
  boardDifficulty,
  Chain,
  doneLevelFor,
  FOUR,
  IronBoard,
  KNIGHT,
  MAX_PERFECT_SIZE,
  ONE,
  perfectBoard,
  perfectPoints,
  piecesFor,
  QUEEN,
  ROOK,
  SIZE,
  spawnWeights,
  THREE,
  TOTAL_HITS,
  TWO,
  weightedIndex,
  WILD,
} from './logic';

/** A board with every square set to `type` (or per square from `at`), all hot. */
function boardOf(difficulty: number, at: (x: number, y: number) => number, seed = 1): IronBoard {
  const rng = new Random(seed);
  const board = new IronBoard(difficulty, () => rng.random());
  for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) board.pieces[x][y].type = at(x, y);
  return board;
}

/** Squares that can be struck after striking (x, y) on a board of all `type`. */
function targets(type: number, x: number, y: number): string[] {
  const board = boardOf(3, () => type);
  board.hit(x, y);
  return board
    .findHittable()
    .map((p) => `${p.x},${p.y}`)
    .sort();
}

describe('moves (IronBoard.isHittable)', () => {
  it('lets numbers move exactly that far in a straight or diagonal line', () => {
    expect(targets(TWO, 2, 2)).toEqual(['0,0', '0,2', '0,4', '2,0', '2,4', '4,0', '4,2', '4,4']);
    expect(targets(FOUR, 0, 0)).toEqual(['0,4', '4,0', '4,4']);
    expect(targets(ONE, 0, 0)).toEqual(['0,1', '1,0', '1,1']);
  });

  it('moves knights in an L', () => {
    expect(targets(KNIGHT, 0, 0)).toEqual(['1,2', '2,1']);
  });

  it('sends rooks, bishops and queens all the way to the edge', () => {
    expect(targets(ROOK, 2, 3)).toEqual(['0,3', '2,0', '2,5', '5,3']);
    // From (2, 3) the diagonals reach the edge at (0, 1), (0, 5), (4, 5) and (5, 0).
    expect(targets(BISHOP, 2, 3)).toEqual(['0,1', '0,5', '4,5', '5,0']);
    expect(targets(QUEEN, 2, 3)).toEqual(['0,1', '0,3', '0,5', '2,0', '2,5', '4,5', '5,0', '5,3']);
  });

  it('lets a rook on an edge strike along that edge, but never the same square', () => {
    expect(targets(ROOK, 5, 2)).toEqual(['0,2', '5,0', '5,5']);
  });

  it('lets a rum jug go anywhere still standing', () => {
    const board = boardOf(3, () => WILD);
    board.hit(0, 0);
    expect(board.findHittable()).toHaveLength(35);
  });

  it('allows any first strike, and never a square already struck three times', () => {
    const board = boardOf(3, () => ONE);
    expect(board.findHittable()).toHaveLength(36);
    board.pieces[1][0].condition = 0;
    board.hit(0, 0);
    board.pieces[0][0].type = ONE;
    expect(board.findHittable().map((p) => `${p.x},${p.y}`).sort()).toEqual(['0,1', '1,1']);
  });
});

describe('chains (data/Chain)', () => {
  const run = (difficulty: number, types: number[]) => {
    let chain = new Chain(difficulty);
    for (const t of types) if (!chain.add(t)) chain = Chain.after(chain, t);
    return chain;
  };

  it('counts repeats of one type, with jugs standing in', () => {
    const chain = run(3, [TWO, TWO, WILD, TWO]);
    expect(chain.isIdentical()).toBe(true);
    expect(chain.size()).toBe(4);
  });

  it('completes a set of four different numbers, in order or not', () => {
    const shuffled = run(3, [FOUR, TWO, THREE, ONE]);
    expect(shuffled.justCompletedSet()).toBe(true);
    expect(shuffled.inNumericSet).toBe(true);
    expect(shuffled.isActiveSetOrdered()).toBe(false);
    expect(run(3, [ONE, TWO, THREE, FOUR]).isActiveSetOrdered()).toBe(true);
    expect(run(3, [FOUR, THREE, WILD, ONE]).isActiveSetOrdered()).toBe(true);
  });

  it('uses sets of three on the first two difficulties', () => {
    expect(run(0, [THREE, ONE, TWO]).justCompletedSet()).toBe(true);
    expect(run(1, [KNIGHT, ROOK, BISHOP]).inChessSet).toBe(true);
  });

  it('chains a chess set after a number set, and starts again on a second number set', () => {
    const chain = run(3, [ONE, TWO, THREE, FOUR, KNIGHT, ROOK, QUEEN, BISHOP]);
    expect(chain.justCompletedSet()).toBe(true);
    expect(chain.numSets()).toBe(2);
    const broken = run(3, [ONE, TWO, THREE, FOUR, TWO]);
    expect(broken.size()).toBe(1);
    expect(broken.numSets()).toBe(0);
  });

  it('keeps the unfinished tail of a set when a repeat breaks it', () => {
    // 1 2 3 then 3: the 3 can't join the set, so the chain restarts from the last 3 as a pair.
    const chain = run(3, [ONE, TWO, THREE, THREE]);
    expect(chain.isIdentical()).toBe(true);
    expect(chain.chain).toEqual([THREE, THREE]);
  });

  it("won't mix numbers and chess pieces in one set", () => {
    const chain = run(3, [ONE, KNIGHT]);
    expect(chain.chain).toEqual([KNIGHT]);
  });
});

describe('board', () => {
  it('cools a square with each strike and restamps it', () => {
    const board = boardOf(3, () => WILD);
    board.hit(0, 0);
    expect(board.pieces[0][0].condition).toBe(2);
    expect(board.numHits).toBe(1);
  });

  it('turns the last square of a layer into a rum jug at the top difficulty only', () => {
    for (const [difficulty, jug] of [
      [3, true],
      [2, false],
    ] as const) {
      const board = boardOf(difficulty, () => WILD);
      for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) board.pieces[x][y].condition = 2;
      board.pieces[3][3].condition = 3;
      board.hit(3, 3);
      expect(board.pieces[3][3].type === WILD).toBe(jug);
    }
  });

  it('ends when nothing can be struck', () => {
    const board = boardOf(3, () => KNIGHT);
    for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) board.pieces[x][y].condition = 1;
    board.pieces[1][2].condition = 0;
    board.pieces[2][1].condition = 0;
    expect(board.hit(0, 0)?.finished).toBe(true);
  });

  it('rates the blade by strikes made', () => {
    expect([0, 77, 78, 91, 92, 101, 102, 107, TOTAL_HITS].map(doneLevelFor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]);
  });

  it('plays out a whole sword without breaking the rules', () => {
    const rng = new Random(7);
    for (let game = 0; game < 50; game++) {
      const board = new IronBoard(game % 4, () => rng.random());
      for (;;) {
        const options = board.findHittable();
        if (!options.length) break;
        const p = options[rng.integer(0, options.length - 1)];
        const before = p.condition;
        expect(board.hit(p.x, p.y)).not.toBeNull();
        expect(p.condition).toBe(before - 1);
      }
      expect(board.numHits).toBeLessThanOrEqual(TOTAL_HITS);
      const left = board.pieces.flat().reduce((n, p) => n + p.condition, 0);
      expect(board.numHits + left).toBe(TOTAL_HITS);
    }
  });
});

describe('spawning (iron/a/a)', () => {
  it('only uses the pieces each difficulty allows', () => {
    const used = (d: number) => [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((t) => spawnWeights(d).some((cell) => cell[t] > 0));
    expect(used(0)).toEqual([ONE, TWO, THREE]);
    expect(used(1)).toEqual([ONE, TWO, THREE, BISHOP, KNIGHT, ROOK]);
    expect(used(2)).toEqual([ONE, TWO, THREE, FOUR, BISHOP, KNIGHT, ROOK, QUEEN]);
    expect(used(3)).toEqual(used(2));
  });

  it('keeps bishops and rooks out of corners and fours out of the middle', () => {
    const w = spawnWeights(2);
    expect(w[0][BISHOP]).toBe(0);
    expect(w[0][ROOK]).toBeCloseTo(0.3 * 2);
    expect(w[2 * 6 + 2][FOUR]).toBe(0);
    expect(spawnWeights(1)[5 * 6 + 5][ROOK]).toBe(0);
  });

  it('maps the four puzzle difficulties onto the board difficulties', () => {
    expect([1, 2, 3, 4].map(boardDifficulty)).toEqual([0, 1, 2, 3]);
  });

  it('picks indices in proportion to their weights', () => {
    expect(weightedIndex([0, 1, 0], () => 0.99)).toBe(1);
    expect(weightedIndex([1, 1], () => 0.49)).toBe(0);
    expect(weightedIndex([1, 1], () => 0.5)).toBe(1);
  });
});

describe('perfect boards', () => {
  it('can always be cleared, at every size and difficulty', () => {
    const rng = new Random(3);
    const random = () => rng.random();
    for (let size = 1; size <= MAX_PERFECT_SIZE; size++) {
      for (let difficulty = 0; difficulty < 4; difficulty++) {
        for (let n = 0; n < 20; n++) {
          const layout = perfectBoard(size, difficulty, random);
          expect(layout.solution).toHaveLength(size * size);
          expect(new Set(layout.solution.map((p) => p.join())).size).toBe(size * size);
          for (const col of layout.types) for (const t of col) expect(piecesFor(difficulty)).toContain(t);
          const board = new IronBoard(difficulty, random, layout);
          for (const [x, y] of layout.solution) expect(board.hit(x, y)).not.toBeNull();
          expect(board.remaining()).toBe(0);
          expect(board.findHittable()).toHaveLength(0);
        }
      }
    }
  });

  it('takes one strike per square and never restamps', () => {
    const rng = new Random(4);
    const layout = perfectBoard(3, 3, () => rng.random());
    const board = new IronBoard(3, () => rng.random(), layout);
    const [x, y] = layout.solution[0];
    const type = board.pieces[x][y].type;
    board.hit(x, y);
    expect(board.pieces[x][y].condition).toBe(0);
    expect(board.pieces[x][y].type).toBe(type);
  });

  it('measures moves on the smaller board, so its edges count for rooks and bishops', () => {
    const board = new IronBoard(3, Math.random, { size: 3, types: [[ROOK, ROOK, ROOK], [ROOK, ROOK, ROOK], [ROOK, ROOK, ROOK]] });
    board.hit(1, 1);
    expect(board.findHittable().map((p) => `${p.x},${p.y}`).sort()).toEqual(['0,1', '1,0', '1,2', '2,1']);
  });

  it('scores 3 for a cleared board, 1 for one square left, otherwise -1', () => {
    expect([0, 1, 2, 9].map(perfectPoints)).toEqual([3, 1, -1, -1]);
  });
});
