// When a timed session runs out, the board first finishes what it was animating, then stays in view
// a moment before the results cover it, so the player can see how it resolved.

/** How long the settled board shows before its results, in simulation milliseconds. */
export const END_HOLD_MS = 500;

/** Remembers when a session ended on its timer; `holding` stays true until the board has shown long enough. */
export class EndHold {
  private at: number | null = null;

  constructor(private readonly ticks: () => number, private readonly ms = END_HOLD_MS) {}

  /** The session just ended on its timer: keep the board in view. */
  start(): void { this.at = this.ticks(); }

  /** A new session, or an ending whose results show straight away. */
  clear(): void { this.at = null; }

  get holding(): boolean {
    if (this.at === null) return false;
    const now = this.ticks();
    return now >= this.at && now - this.at < this.ms;
  }
}
