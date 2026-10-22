import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { boardMatches, COLOURS, fillPuzzle, parseBoard, randomizeColours, scramblePuzzle, type Settings } from './logic';
import { PUZZLES } from './puzzles';

const settings: Settings = {
  mode: 'puzzle', normalRatios: [0.6472, 0.3435, 0.0094], bb: true, fj: true, cc: true,
  eq: true, machete: true, shovel: true, monkey: true, scramble: false, forageLevel: 4, ants: true,
};
const reserveBoard = () => parseBoard(['xxxuuxw', 'wywvvuy', 'uxyyxwv', 'vuxvxxw', 'wwuuyxy', 'wvyyvuu', 'uxuxvwx', 'yxyywxu', 'xuwuxyx', 'wvwwxuu']);

describe('native Forage puzzle generation', () => {
  it('permutes all five colours consistently and preserves special cells', () => {
    const input = parseBoard(['uvwxyuvwxy', 'skghijabcdefmnopqz']);
    const board = randomizeColours(input, new Random(77));
    expect([...board[0].slice(0, 5)].sort()).toEqual([...COLOURS]);
    expect(board[0].slice(0, 5)).toEqual(board[0].slice(5));
    expect(board[1]).toEqual(input[1]);
    expect(randomizeColours(input, new Random(77))).toEqual(board);
  });

  it('fills a stable board with the same seed while retaining every authored cell', () => {
    const generate = (seed: number) => {
      const rng = new Random(seed), reserve = reserveBoard();
      const puzzle = randomizeColours(parseBoard(PUZZLES[3]), rng);
      return { puzzle, board: fillPuzzle(puzzle, reserve, settings, rng), reserve };
    };
    const a = generate(77);
    expect(generate(77)).toEqual(a);
    expect(generate(78).board).not.toEqual(a.board);
    expect(boardMatches(a.board.map(row => [...row]))).toBe(false);
    a.puzzle.forEach((row, r) => row.forEach((cell, c) => {
      if (cell !== 's') expect(a.board[r][c]).toBe(cell);
      else expect(a.board[r][c]).not.toMatch(/[sz]/);
    }));
  });

  it('scrambles reproducibly without moving key cells or special pieces', () => {
    const generate = () => {
      const rng = new Random(78), reserve = reserveBoard();
      const puzzle = randomizeColours(parseBoard(PUZZLES[27]), rng);
      return { puzzle, board: scramblePuzzle(27, puzzle, reserve, { ...settings, scramble: true }, rng), reserve };
    };
    const a = generate();
    expect(generate()).toEqual(a);
    expect(boardMatches(a.board.map(row => [...row]))).toBe(false);
    for (const [r, c] of [[5, 2], [6, 1], [6, 2], [7, 1], [7, 2], [8, 0], [8, 1], [8, 2], [9, 1], [9, 2]]) {
      expect(a.board[r][c]).toBe(a.puzzle[r][c]);
    }
    a.puzzle.forEach((row, r) => row.forEach((cell, c) => {
      if (!'uvwxys'.includes(cell)) expect(a.board[r][c]).toBe(cell);
    }));
  });
});
