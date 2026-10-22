import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedControls } from './seeds';
import { Store } from './storage';
import type { Panel } from './panel';

function controls(store = new Store('seed-test')) {
  let toggle!: (on: boolean) => void, text!: (value: string) => void, shown!: () => string;
  const buttons = new Map<string, () => void>();
  const group = {
    toggle: (_label: string, _get: unknown, set: typeof toggle) => { toggle = set; },
    text: (_label: string, get: typeof shown, set: typeof text) => { shown = get; text = set; },
    button: (label: string, action: () => void) => { buttons.set(label, action); },
  };
  const panel = { seedSettings: { group: () => group } } as unknown as Panel;
  const seeds = seedControls(panel, store, () => false);
  return { seeds, store, toggle: (on: boolean) => toggle(on), enter: (value: string) => text(value), shown: () => shown(), buttons };
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  let next = 100;
  vi.stubGlobal('crypto', { getRandomValues: (array: Uint32Array) => { array.fill(next++); return array; } });
});
afterEach(() => vi.unstubAllGlobals());

describe('seed selection and score eligibility', () => {
  it('uses fresh seeds for normal runs and counts their scores', () => {
    const h = controls();
    expect(h.seeds.enabled).toBe(false);
    const first = h.seeds.next();
    expect(h.seeds.next()).not.toBe(first);
    expect(h.store.scoresEnabled).toBe(true);
  });
  it('automatically locks an entered seed, persists it and excludes scores until switched off', () => {
    const h = controls();
    h.enter('42');
    expect(h.seeds.enabled).toBe(true);
    expect(h.seeds.next()).toBe(42);
    expect(h.seeds.next()).toBe(42);
    expect(h.store.scoresEnabled).toBe(false);
    h.store.addHistory('normal', { score: 999 });
    expect(h.store.history('normal')).toEqual([]);
    expect(controls(h.store).seeds.next()).toBe(42);
    h.toggle(false);
    expect(h.seeds.next()).not.toBe(42);
    expect(h.store.scoresEnabled).toBe(true);
  });
  it('locks the displayed automatic seed and keeps the active run eligibility unchanged while editing', () => {
    const h = controls(), seed = h.seeds.next();
    expect(h.shown()).toBe(String(seed));
    h.toggle(true);
    expect(h.store.scoresEnabled).toBe(true);
    expect(h.seeds.next()).toBe(seed);
    expect(h.store.scoresEnabled).toBe(false);
    h.toggle(false);
    expect(h.store.scoresEnabled).toBe(false);
    h.seeds.next();
    expect(h.store.scoresEnabled).toBe(true);
  });
  it('ignores invalid input and treats a generated fixed seed as practice', () => {
    const h = controls();
    for (const invalid of ['', '-1', '1.5', '4294967296', 'hello']) h.enter(invalid);
    expect(h.seeds.enabled).toBe(false);
    h.buttons.get('New')!();
    expect(h.seeds.enabled).toBe(true);
    expect(h.seeds.next()).toBe(Number(h.shown()));
    expect(h.store.scoresEnabled).toBe(false);
  });
});
