// The contract between the shell and a puzzle. A puzzle is a folder in src/puzzles/ with:
//   meta.ts   – `export default { title, description, ... } satisfies PuzzleMeta`
//   index.ts  – `export default (async (ctx) => { ...; return { frame } }) satisfies PuzzleFactory`
// The shell finds both automatically.
import type { Input, InputEvent } from './input';
import type { Panel } from './panel';
import type { Screen } from './screen';
import type { Store } from './storage';

export interface PuzzleMeta {
  title: string;
  /** One or two sentences for the landing page. */
  description: string;
  /** Controls summary shown under the game. */
  help?: string;
  /** Logical canvas size; defaults to 800×600. Settings go in the panel beside it, not on the canvas. */
  width?: number;
  height?: number;
  /** Lower numbers are listed first on the landing page; it follows the skill order on a Yoweb pirate page. */
  order?: number;
  /** Thumbnail URL for the landing page (import it with `?url`). */
  thumbnail?: string;
}

export interface PuzzleContext {
  screen: Screen;
  input: Input;
  /** HTML controls beside the canvas (modes, options, buttons, scores); see panel.ts. */
  panel: Panel;
  /** Saved settings and scores for this puzzle only. */
  store: Store;
  /** Simulation time in milliseconds, independent of browser rendering frequency. */
  ticks(): number;
  /** Sets an exact simulation time during playback; null resumes a continuous live clock. */
  setReplayTime?(milliseconds: number | null): void;
}

export interface PuzzleInstance {
  /** Called on the fixed 60 Hz simulation timeline, including catch-up steps after a late render. */
  frame(events: InputEvent[]): void;
  /** Called when the player leaves the puzzle. Release anything the puzzle started. */
  dispose?(): void;
}

export type PuzzleFactory = (ctx: PuzzleContext) => PuzzleInstance | Promise<PuzzleInstance>;
