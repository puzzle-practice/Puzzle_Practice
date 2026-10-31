/**
 * Wall-clock time for the frame loop and replay playback. Normally this is performance.now(), but a
 * video export swaps in a virtual clock it moves forward one video frame at a time, so a replay can be
 * rendered faster (or slower) than it plays and every frame still lands at its exact moment.
 */
let virtual: number | null = null;
/** How far a past virtual clock ran ahead of the real one, so time never runs backwards after it ends. */
let skew = 0;

export const realNow = (): number => virtual ?? performance.now() + skew;
export const isVirtualTime = (): boolean => virtual !== null;

/** Freezes the clock where it is; from now on only advanceVirtualTime moves it. */
export function startVirtualTime(): void { virtual ??= realNow(); }
export function advanceVirtualTime(ms: number): void { if (virtual !== null) virtual += ms; }
/** Back to the real clock, carrying on from the virtual time reached. */
export function endVirtualTime(): void {
  if (virtual === null) return;
  skew = virtual - performance.now();
  virtual = null;
}

/** What the running puzzle draws on and how to run its game up to the current time. */
export interface FrameRunner {
  canvas: HTMLCanvasElement;
  /** Runs every simulation step due by realNow() and paints the result. */
  run(): void;
}
let runner: FrameRunner | null = null;
/** The host registers the puzzle it is running; returns a function that unregisters it. */
export function setFrameRunner(next: FrameRunner): () => void {
  runner = next;
  return () => { if (runner === next) runner = null; };
}
export const frameRunner = (): FrameRunner | null => runner;
