import { EMPTY, NaviBoard, NaviTestBoard, WildTargets, TestWildTargets, LEVEL_TARGETS, type Clear, type Fall, type Target } from './logic';

/**
 * `clears` is the untimed run that ends at the difficulty's constellation quota, counted across
 * dismissed boards. With no timer and no `clears`, boards keep dealing constellations until a booch or Stop.
 * `slowDrop` holds each incoming star at the top until Drop is pressed, for practice without the fall.
 */
export interface NavigationSettings { mode: 'normal' | 'ww' | 'ww-test'; difficulty: number; extraRing: boolean; wildTargets: boolean; timerMs: number; clears: boolean; dismissDelayMs: number; slowDrop: boolean;
  /** Freeplay mode paints the board, with no timer, quota or history, and each star waits for Drop. */
  create: boolean }
export const DEFAULT_SETTINGS: NavigationSettings = { mode: 'ww-test', difficulty: 4, extraRing: true, wildTargets: true, timerMs: 120000, clears: false, dismissDelayMs: 1000, slowDrop: false, create: false };
/** How long Dismiss holds play before the next board is dealt. */
export const DISMISS_DELAYS = [0, 500, 1000, 1500, 2000, 3000];
export function readSettings(value: unknown): NavigationSettings | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as NavigationSettings;
  if ((s.mode !== 'normal' && s.mode !== 'ww' && s.mode !== 'ww-test') || !Number.isInteger(s.difficulty) || s.difficulty < 0 || s.difficulty > 9 ||
      typeof s.extraRing !== 'boolean' || typeof s.wildTargets !== 'boolean' || ![0, 120000, 300000].includes(s.timerMs) ||
      (s.clears !== undefined && typeof s.clears !== 'boolean') || (s.clears && s.timerMs !== 0) ||
      (s.dismissDelayMs !== undefined && !DISMISS_DELAYS.includes(s.dismissDelayMs)) ||
      (s.slowDrop !== undefined && typeof s.slowDrop !== 'boolean') || (s.create !== undefined && typeof s.create !== 'boolean')) return null;
  return { mode: s.mode, difficulty: s.difficulty, extraRing: s.extraRing, wildTargets: s.wildTargets, timerMs: s.timerMs, clears: s.clears ?? false,
    dismissDelayMs: s.dismissDelayMs ?? DEFAULT_SETTINGS.dismissDelayMs, slowDrop: s.slowDrop ?? false, create: s.create ?? false };
}
export const isWerewolf = (mode: NavigationSettings['mode']): boolean => mode === 'ww' || mode === 'ww-test';
export const modeLabel = (mode: NavigationSettings['mode']): string => mode === 'ww-test' ? 'Dennav' : mode === 'ww' ? 'Old Dennav' : 'Normal';
export const settingsKey = (s: NavigationSettings): string => `${s.mode}:${s.difficulty}:${isWerewolf(s.mode) && s.extraRing ? 4 : 3}:${isWerewolf(s.mode) && s.wildTargets ? 1 : 0}:${s.timerMs}${s.clears ? ':c' : ''}${s.slowDrop ? ':s' : ''}`;
/** The constellations a run is played to: the quota, except with no timer, which loops. */
export const runGoal = (s: NavigationSettings): number => s.timerMs || s.clears ? LEVEL_TARGETS[s.difficulty] : Infinity;
export interface NavigationSeed { boardSeed: number; timerElapsedMs: number }
export function readNavigationSeed(value: unknown): NavigationSeed | null {
  const seed = typeof value === 'number' ? { boardSeed: value, timerElapsedMs: 0 } : value as NavigationSeed | null;
  if (!seed || typeof seed !== 'object' || !Number.isSafeInteger(seed.boardSeed) || seed.boardSeed < 0 || seed.boardSeed > 0xffffffff ||
      !Number.isSafeInteger(seed.timerElapsedMs) || seed.timerElapsedMs < 0 || seed.timerElapsedMs > 300000) return null;
  return { boardSeed: seed.boardSeed, timerElapsedMs: seed.timerElapsedMs };
}
/** A WW run's later boards come from its first seed, so one replay holds the whole run. */
export function boardSeed(runSeed: number, board: number): number {
  if (!board) return runSeed;
  let h = (runSeed ^ Math.imul(board, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
/** What a run has banked from boards it dismissed. */
export interface RunTotals { points: number; constellations: number; stars: number; moves: number; longestChain: number; moons: number[] }
export const NO_TOTALS: RunTotals = { points: 0, constellations: 0, stars: 0, moves: 0, longestChain: 0, moons: [0, 0, 0] };
export function addBoard(totals: RunTotals, game: NavigationGame): RunTotals {
  return { points: totals.points + game.points, constellations: totals.constellations + game.constellations,
    stars: totals.stars + game.stars, moves: totals.moves + game.moves, longestChain: Math.max(totals.longestChain, game.longestChain),
    moons: totals.moons.map((n, i) => n + game.moons[i]) };
}
export interface Scene {
  cells: number[]; targets: Target[]; duration: number;
  falls?: Fall[]; clear?: Clear; rotation?: { ring: number; clockwise: boolean };
}
export class NavigationGame {
  readonly board: NaviBoard;
  readonly wild: WildTargets;
  targets: Target[];
  entry: { octant: number; colour: number };
  points = 0;
  stars = 0;
  moves = 0;
  constellations = 0;
  runClears = 0;
  longestChain = 0;
  /**
   * Constellations by the chain they were charted in, for the duty report's moons: crescent
   * (no chain), half (a double) and full (a triple or longer). The game files only say a longer
   * chain makes a fuller moon; where the cut-offs fall is our guess.
   */
  readonly moons = [0, 0, 0];
  finished = false;
  booched = false;
  /** `goal` is what this board must chart to end the run; a later board in a quota run gets what's left. */
  constructor(readonly settings: NavigationSettings, readonly seed: number, readonly goal = runGoal(settings)) {
    const rings = isWerewolf(settings.mode) && settings.extraRing ? 4 : 3;
    this.board = settings.mode === 'ww-test' ? new NaviTestBoard(rings, settings.difficulty, seed) : new NaviBoard(rings, settings.difficulty, seed, isWerewolf(settings.mode));
    this.wild = settings.mode === 'ww-test' ? new TestWildTargets(settings.wildTargets, rings) : new WildTargets(isWerewolf(settings.mode) && settings.wildTargets, rings);
    this.targets = this.board.nextConstellation();
    this.entry = this.board.nextEntry();
  }
  scene(duration = 0): Scene { return { cells: [...this.board.cells], targets: this.targets.map(t => ({ ...t })), duration }; }
  rotate(ring: number, clockwise: boolean): Scene[] {
    if (this.finished || ring < 0 || ring >= this.board.rings || this.board.cells.slice(ring*8, ring*8+8).every(p => p === -1)) return [];
    const before = this.scene(100);
    before.rotation = { ring, clockwise };
    this.board.rotate(ring, clockwise);
    this.moves++;
    this.wild.action();
    return [before, ...this.resolve()];
  }
  drop(): Scene[] {
    if (this.finished) return [];
    this.wild.action();
    this.stars++;
    if (this.board.get(this.entry.octant, 0) !== -1) {
      this.booched = this.finished = true;
      return [];
    }
    this.board.set(this.entry.octant, 0, this.entry.colour);
    const steps = this.resolve();
    if (!this.finished) this.entry = this.board.nextEntry();
    return steps;
  }
  /** Whether a star sits above an empty cell, so it falls when gravity next runs. */
  get floating(): boolean {
    const board = this.board;
    for (let octant = 0; octant < 8; octant++) for (let ring = 0; ring + 1 < board.rings; ring++) {
      if (board.get(octant, ring) !== EMPTY && board.get(octant, ring + 1) === EMPTY) return true;
    }
    return false;
  }
  /** Whether a painted board would still change on its own: a floating star, a run of three or a charted constellation. */
  get unsettled(): boolean { return this.floating || this.board.findRuns().length > 0 || this.board.matches(this.targets); }
  /** Freeplay: turns gravity back on for a painted board, playing out the falls and clears with no star dropped. */
  settle(): Scene[] { return this.finished ? [] : this.resolve(); }
  private resolve(): Scene[] {
    const scenes: Scene[] = [];
    let chain = 1;
    for (;;) {
      const before = this.scene(220);
      const falls = this.board.gravity();
      if (falls.length) {
        before.duration = Math.max(...falls.map(f => Math.trunc(56*Math.abs(f.ring-f.from)/0.75)));
        before.falls = falls; scenes.push(before);
      }
      if (this.board.matches(this.targets)) {
        const clearScene = this.scene(500);
        const clear = this.board.clearConstellation(this.targets, chain);
        clearScene.clear = clear;
        scenes.push(clearScene);
        this.points += clear.points;
        this.constellations++;
        this.moons[Math.min(chain, 3) - 1]++;
        this.wild.completed(this.targets);
        this.targets = [];
        chain = 1;
        if (this.constellations >= this.goal) { this.finished = true; break; }
        // The game's constellation animation callback creates the next targets
        // before board evolution resumes, so the following cascade can fill them.
        this.targets = this.board.nextConstellation();
        this.wild.next(this.targets);
        continue;
      }
      const runs = this.board.findRuns();
      if (!runs.length) break;
      const clearScene = this.scene(500);
      const clears = this.board.clearRuns(runs, chain);
      this.wild.runs(runs, this.targets);
      const points = clears.reduce((sum, c) => sum + c.points, 0);
      clearScene.clear = { kind: 'run', cells: clears.flatMap(c => c.cells), points, chain };
      clearScene.targets = this.targets.map(t => ({ ...t }));
      scenes.push(clearScene);
      this.points += points;
      this.runClears += runs.length;
      this.longestChain = Math.max(this.longestChain, chain++);
    }
    if (!this.targets.length && !this.finished) { this.targets = this.board.nextConstellation(); this.wild.next(this.targets); }
    scenes.push(this.scene());
    return scenes;
  }
}
