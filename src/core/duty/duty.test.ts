import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { packReplay, unpackReplay, type PuzzleReplay } from '../replay';
import { Store } from '../storage';
import { DEFAULT_FACE, faceLayers, faceOptions, sanitizeFace } from './face';
import { DEFAULT_NAME, loadProfile, saveProfile, sanitizeName, setReplayPirate } from './profile';
import { cutoffsFor, cutoffWords, LEARNING, moodFor, performanceWord, rate, rateOn, type RatingScale } from './ratings';
import { decodeReport, encodeReport, makeReport, readReport, showsDutyReport, SPACE } from './report';
import { stackRows } from './view';
import { recentAverages, sessionAverages } from './desk';
import type { GameRecord } from '../storage';

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
  };
}

beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()));
afterEach(() => {
  setReplayPirate(null);
  vi.unstubAllGlobals();
});

describe('duty ratings', () => {
  const scale: RatingScale = { id: 'test', label: 'Points', cutoffs: [1, 2, 3, 4, 5] };

  it('uses the game words, Gauntlet words for speed and Learning for practice', () => {
    expect(performanceWord(0)).toBe('Booched');
    expect(performanceWord(5)).toBe('Incredible');
    expect(performanceWord(LEARNING)).toBe('Learning');
    expect(performanceWord(12)).toBe('Frenetic');
    expect(cutoffWords(scale)).toEqual(['Poor', 'Fine', 'Good', 'Excellent', 'Incredible']);
    expect(cutoffWords({ ...scale, gauntlet: true })).toEqual(['Lethargic', 'Steady', 'Brisk', 'Swift', 'Frenetic']);
  });

  it('earns one rating for each cut-off reached', () => {
    expect(rate(0.5, scale.cutoffs)).toBe(0);
    expect(rate(1, scale.cutoffs)).toBe(1);
    expect(rate(3.9, scale.cutoffs)).toBe(3);
    expect(rate(99, scale.cutoffs)).toBe(5);
    expect(rate(Number.NaN, scale.cutoffs)).toBe(0);
    expect(rate(0, scale.cutoffs, true)).toBe(7);
    expect(rate(5, scale.cutoffs, true)).toBe(12);
  });

  it('gives each rating the face the game gives it', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(moodFor)).toEqual(['really_sad', 'sad', 'normal', 'happy', 'really_happy', 'really_happy', 'normal']);
    expect([7, 12].map(moodFor)).toEqual(['really_sad', 'really_happy']);
  });

  it("ignores previously saved custom cut-offs", () => {
    const store = new Store('forage');
    expect(cutoffsFor(store, scale)).toEqual([1, 2, 3, 4, 5]);
    store.set('ratingCutoffs:test', [10, 20, 30, 40, 50]);
    expect(rateOn(store, scale, 25)).toBe(5);
    store.set('ratingCutoffs:test', [1, 'x']);
    expect(rateOn(store, scale, 25)).toBe(5);
    expect(rateOn(store, null, 25)).toBe(LEARNING);
    expect(rateOn(store, scale, null)).toBe(LEARNING);
  });
});

describe('pirate profile', () => {
  it('keeps names to letters, spaces, apostrophes and hyphens', () => {
    expect(sanitizeName('  Jack   Sparrow!!1 ')).toBe('Jack Sparrow');
    expect(sanitizeName("O'Malley-Rose")).toBe("O'Malley-Rose");
    expect(sanitizeName('A'.repeat(40))).toHaveLength(20);
    expect(sanitizeName('123')).toBe(DEFAULT_NAME);
    expect(sanitizeName(undefined)).toBe(DEFAULT_NAME);
  });

  it('falls back part by part to parts the game has for that look', () => {
    expect(sanitizeFace(null)).toEqual(DEFAULT_FACE);
    // A woman can't wear the men's crown or have the men's goatee; she keeps the rest.
    const face = sanitizeFace({ ...DEFAULT_FACE, female: true, hat: 'crown', beard: 'goatee', hair: 'curly_long', skin: 'pale', hatColour: 'nope' });
    expect(face).toMatchObject({ female: true, hat: DEFAULT_FACE.hat, beard: '', hair: 'curly_long', skin: 'pale', hatColour: DEFAULT_FACE.hatColour });
    expect(sanitizeFace({ ...DEFAULT_FACE, hat: '' }).hat).toBe('');
    expect(faceOptions(true).hat).toContain('tiara');
    expect(faceOptions(false).beard).toContain('goatee');
  });

  it('layers a face in the game order with the expression for the mood', () => {
    const layers = faceLayers({ ...DEFAULT_FACE, beard: 'goatee', eyepatch: true, hat: 'tricorne' }, 'happy');
    expect(layers.map((l) => l.image)).toEqual(['fmale-head-happy', 'fmale-facialhair-goatee', 'fmale-eyepatch', 'fmale-hair-messy_short', 'fmale-hat-tricorne']);
    expect(layers[0].at).toEqual([14, 19]);
    expect(layers[4].classes).toEqual(['textile_p', 'textile_s']);
  });

  it('saves the profile site-wide and cleans it on the way in and out', () => {
    expect(loadProfile()).toEqual({ name: DEFAULT_NAME, face: DEFAULT_FACE });
    saveProfile({ name: 'Bonny<script>', face: { ...DEFAULT_FACE, hat: 'tricorne' } });
    expect(loadProfile()).toEqual({ name: 'Bonnyscript', face: { ...DEFAULT_FACE, hat: 'tricorne' } });
    expect(JSON.parse(localStorage.getItem('puzzle-practice:global:profile')!).name).toBe('Bonnyscript');
  });
});

describe('duty reports', () => {
  const input = {
    puzzle: 'forage', station: 'Foraging', mode: 'Normal', performance: 4, score: { label: 'Points a move', value: '1.50' },
    cleared: [{ label: 'Crates Collected', items: [{ icon: 'chest-small', label: 'small crates', count: 3 }] }],
  };

  it("puts today's pirate on a new report, or the replay's pirate while one plays", () => {
    saveProfile({ name: 'Anne', face: DEFAULT_FACE });
    expect(makeReport(input).pirate.name).toBe('Anne');
    setReplayPirate({ name: 'Calico', face: { ...DEFAULT_FACE, female: true, hair: 'bob' } });
    expect(makeReport(input).pirate).toMatchObject({ name: 'Calico', face: { female: true, hair: 'bob' } });
    setReplayPirate(null);
    expect(makeReport(input).pirate.name).toBe('Anne');
  });

  it('round-trips through a history row and rejects anything that is not a report', () => {
    const report = makeReport(input);
    expect(decodeReport(encodeReport(report))).toEqual(report);
    expect(decodeReport('{nope')).toBeNull();
    expect(decodeReport(42)).toBeNull();
    expect(readReport({ ...report, performance: 16 })?.performance).toBe(16);
    expect(readReport({ ...report, performance: 17 })?.performance).toBe(17);
    expect(readReport({ ...report, performance: 18 })).toBeNull();
    expect(readReport({ ...report, cleared: [{ label: 'x', items: [{ icon: 'a', label: 'b', count: -1 }] }] })).toBeNull();
    // A damaged pirate is cleaned rather than losing the report.
    expect(readReport({ ...report, pirate: { name: 7 } })?.pirate).toEqual({ name: DEFAULT_NAME, face: DEFAULT_FACE });
  });

  it('travels with a replay; older replays without one still load, and a damaged one is dropped', () => {
    const report = makeReport(input);
    const tape: PuzzleReplay = {
      format: 'puzzle-practice-replay', version: 1, puzzle: 'forage', at: 42, duration: 100,
      result: 'Score 8', settings: {}, seed: {}, frames: [{ t: 10, mouse: [4, 5], events: [] }], report,
    };
    expect(unpackReplay(packReplay(tape))?.report).toEqual(report);
    const { report: _, ...legacy } = tape;
    const old = unpackReplay(packReplay(legacy));
    expect(old).not.toBeNull();
    expect(old && 'report' in old).toBe(false);
    const damaged = unpackReplay({ ...packReplay(legacy), report: { v: 9 } });
    expect(damaged).not.toBeNull();
    expect(damaged && 'report' in damaged).toBe(false);
  });
});

describe("the game's bonus stacks", () => {
  it('fits overlapping tiles into rows no wider than 100 pixels', () => {
    // Twelve-pixel chests: each extra one shows 2px more.
    expect(stackRows([3, 1, 0], 12)).toEqual([[3, 1, 0]]);
    // 45 fit on a row (12 + 2 x 44 = 100); the rest start a new one.
    expect(stackRows([50], 12)).toEqual([[45], [5]]);
    // A kind that fits on a row of its own but not after the others moves down whole.
    expect(stackRows([40, 10], 12)).toEqual([[40, 0], [0, 10]]);
    expect(stackRows([0, 0], 12)).toEqual([[0, 0]]);
  });
});


describe('extended ratings', () => {
  const scale: RatingScale = { id: 'gauntlet', label: 'Score', cutoffs: [3, 6, 9, 12, 15, 20, 25, 30, 35, 40], gauntlet: true };
  it('uses published thresholds, the four named tiers and eyes at 40', () => {
    expect([0, ...scale.cutoffs].map((score) => performanceWord(rate(score, scale.cutoffs, true))))
      .toEqual(['Asleep', 'Lethargic', 'Steady', 'Brisk', 'Swift', 'Frenetic', 'Blazing', 'Breakneck', 'Tempestuous', 'Legendary', '\u{1f440}']);
    expect(performanceWord(rate(39.99, scale.cutoffs, true))).toBe('Legendary');
    expect(performanceWord(rate(100, scale.cutoffs, true))).toBe('\u{1f440}');
    expect(moodFor(17)).toBe('really_happy');
  });
  it('caps new and saved extra ratings when the global switch is off', () => {
    const prefs = new Store('global');
    prefs.set('extraRatings', false);
    expect(rateOn(new Store('forage'), scale, 40)).toBe(12);
    expect(performanceWord(17)).toBe('Frenetic');
    expect(performanceWord(5)).toBe('Incredible');
    const games = [12, 17].map((performance, at) => ({ at, score: 40, duty: encodeReport(makeReport({
      puzzle: 'forage', station: 'Foraging', performance, score: { label: 'Score', value: '40' },
    })) }));
    expect(sessionAverages(games)).toContainEqual(['Average rating', 'Frenetic']);
    prefs.set('extraRatings', true);
    expect(rateOn(new Store('forage'), scale, 40)).toBe(17);
    expect(performanceWord(17)).toBe('\u{1f440}');
  });
});

describe('face colours', () => {
  it('offers hair dye colours for both pirate looks and preserves selected dyes', () => {
    for (const female of [false, true]) {
      expect(faceOptions(female).hairColour).toEqual(expect.arrayContaining(['indigo', 'lightBanshee', 'emerald', 'hotPink']));
      expect(sanitizeFace({ ...DEFAULT_FACE, female, hairColour: 'indigo' }).hairColour).toBe('indigo');
    }
  });
  it('offers chromas independently for primary and trim cloth', () => {
    const options = faceOptions(false);
    expect(options.cloth).toEqual(expect.arrayContaining(['electricBlue', 'neonGreen', 'cream']));
    expect(options.trimCloth).toEqual(expect.arrayContaining(['electricBlue', 'neonGreen', 'cream']));
    expect(sanitizeFace({ ...DEFAULT_FACE, hatColour: 'electricBlue', trimColour: 'cream' })).toMatchObject({ hatColour: 'electricBlue', trimColour: 'cream' });
  });
});

describe('session averages', () => {
  it('averages the score and each cleared kind independently', () => {
    const games = [2, 6].map((count, at) => ({ at, score: count, duty: encodeReport(makeReport({
      puzzle: 'forage', station: 'Foraging', performance: 12, score: { label: 'Score', value: String(count) },
      cleared: [{ label: 'Crates Collected', items: [{ icon: 'ci-bone-box', label: 'bone boxes', count }] }],
    })) }));
    expect(sessionAverages(games)).toEqual([['Sessions', '2'], ['Average score', '4'], ['Best score', '6'], ['Average rating', 'Frenetic'], ['Average crates collected', '[4]']]);
  });
  it('supports fewer-is-better practice scores and empty histories', () => {
    expect(sessionAverages([{ at: 0, score: 8 }, { at: 1, score: 4 }], { scoreLabel: 'Moves', lowerIsBetter: true }))
      .toEqual([['Sessions', '2'], ['Average moves', '6'], ['Best moves', '4']]);
    expect(sessionAverages([])).toEqual([]);
  });
});

describe('ordered report items', () => {
  it('round-trips spacers and counts on the score line', () => {
    const report = makeReport({ puzzle: 'distilling', station: 'Distilling', performance: 16, score: { label: 'Score', value: '35' }, cleared: [
      { label: 'Columns Sent Up', style: 'row', items: [{ icon: 'orb-clear', label: 'clear', count: 4 }, { icon: SPACE, label: '', count: 1 }, { icon: 'orb-bad', label: 'bad', count: 1 }] },
      { label: 'Counts', inScore: true, items: [{ icon: 'ci-bone-box', label: 'bone boxes', count: 4 }] },
    ] });
    expect(decodeReport(encodeReport(report))).toEqual(report);
  });
});

describe('report visibility', () => {
  it('suppresses practice and create popups, including old saved reports', () => {
    for (const mode of ['Practice', 'Create', 'Standard', 'Seeded']) {
      const report = makeReport({ puzzle: 'distilling', station: 'Distilling', mode, performance: LEARNING, score: { label: 'Score', value: '0' } });
      expect(showsDutyReport(decodeReport(encodeReport(report))!)).toBe(mode === 'Standard' || mode === 'Seeded');
    }
  });
});

describe('last sessions', () => {
  it('averages only the latest ten games', () => {
    const games = Array.from({ length: 25 }, (_, i) => ({ at: i, score: i + 1 }) as GameRecord);
    expect(recentAverages(games)).toEqual([['Sessions', '10'], ['Average score', '20.5'], ['Best score', '25']]);
    expect(recentAverages(games.slice(0, 3))[0]).toEqual(['Sessions', '3']);
  });
});
