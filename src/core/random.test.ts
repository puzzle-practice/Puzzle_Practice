import { describe, expect, it } from 'vitest';
import { Random } from './random';
import { readSeed, seedFor } from './seeds';

describe('native seed streams', () => {
  it('restores a JSON snapshot after consuming several kinds of draws', () => {
    const a = new Random('portable seed');
    a.random(); a.integer(0, 99); a.bigInteger(0n, 2n ** 64n - 1n);
    const state = JSON.parse(JSON.stringify(a.snapshot()));
    const expected = [a.random(), a.integer(-10, 10), a.shuffle([1, 2, 3, 4]), a.choiceWeighted(['a', 'b'], [1, 3])];
    const b = new Random(0); expect(b.restore(state)).toBe(true);
    expect([b.random(), b.integer(-10, 10), b.shuffle([1, 2, 3, 4]), b.choiceWeighted(['a', 'b'], [1, 3])]).toEqual(expected);
    expect(b.snapshot().algorithm).toBe('xoshiro128ss-v1');
    expect(b.restore({ algorithm: 'xoshiro128ss-v1', words: [0, 0, 0, 0] })).toBe(false);
    expect(b.restore({ ...state, session: { seed: -1, board: 0 } })).toBe(false);
  });
  it('resynchronizes every board independently of previous draws and survives replay restoration', () => {
    const a = new Random(0), b = new Random(0);
    a.beginSession(42); b.beginSession(42);
    for (let board = 0; board < 20; board++) {
      a.nextBoard(); b.nextBoard();
      expect(Array.from({ length: 30 }, () => a.random())).toEqual(Array.from({ length: 30 }, () => b.random()));
      for (let i = 0; i < board * 7; i++) a.random();
      const resumed = new Random(0); expect(resumed.restore(JSON.parse(JSON.stringify(b.snapshot())))).toBe(true);
      b.restore(resumed.snapshot());
    }
  });
  it('rejects removed generator states without changing the native stream', () => {
    const rng = new Random(11), expected = new Random(11);
    expect(rng.restore({ algorithm: 'python-mt19937', words: Array(624).fill(1), index: 0 })).toBe(false);
    expect(rng.random()).toBe(expected.random());
  });
  it('has independent named streams and accepts the complete unsigned seed range', () => {
    expect(seedFor(42, 'pieces', 2)).toBe(seedFor('42', 'pieces', 2));
    expect(seedFor(42, 'pieces', 2)).not.toBe(seedFor(42, 'holes', 2));
    expect(seedFor(42, 'pieces', 2)).not.toBe(seedFor(42, 'pieces', 3));
    expect(readSeed('0')).toBe(0); expect(readSeed('4294967295')).toBe(0xffffffff);
    for (const text of ['-1', '1.5', '4294967296', '12e3', '']) expect(readSeed(text)).toBeNull();
  });
});
