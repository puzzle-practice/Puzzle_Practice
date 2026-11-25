/**
 * The game's elapsed time, which stops while the tab is hidden. A hidden tab gets few or no
 * animation frames, so if the hidden time counted, the simulation would play the whole gap back
 * as fast catch-up steps on return. The clock reads the moment the tab was hidden until it is
 * shown again, so any frame that still runs while hidden can't move the game on either; if it
 * could, the game would sit frozen on return while the clock caught up with it, and inputs
 * would wait that long to go through.
 *
 * The browser can also stop animation frames without hiding the tab: Firefox does when its window
 * is covered or the computer sleeps or locks. No visibilitychange comes, so the clock can't stop
 * at the time; instead, a frame that finds the simulation more than MAX_BEHIND_MS behind lets go
 * of that time, so the game carries on from where it was rather than racing through the gap.
 */
/** The most game time the simulation catches up on after frames stop; any more is left out. */
export const MAX_BEHIND_MS = 1000;

export class GameTime {
  private start: number;
  private hiddenAt: number | null;

  /**
   * @param now the wall clock
   * @param simulated how far the simulation has run, which the clock never falls behind on return
   * @param frozen false while a video export drives the clock itself, which keeps going while hidden
   */
  constructor(
    private readonly now: () => number,
    private readonly simulated: () => number,
    hidden = false,
    private readonly frozen: () => boolean = () => true,
  ) {
    this.start = now();
    this.hiddenAt = hidden ? this.start : null;
  }

  /** Milliseconds of game time since the last reset. */
  readonly elapsed = (): number => (this.hiddenAt !== null && this.frozen() ? this.hiddenAt : this.now()) - this.start;

  /** Starts the clock from zero now, staying stopped if the tab is hidden. */
  reset(): void {
    this.start = this.now();
    if (this.hiddenAt !== null) this.hiddenAt = this.start;
  }

  /**
   * Leaves out the game time the simulation is behind on, past one step, when that is more than
   * MAX_BEHIND_MS. Returns how many milliseconds it left out. A video export drives the clock
   * itself and is never cut short.
   */
  dropStall(): number {
    if (!this.frozen()) return 0;
    const behind = this.elapsed() - this.simulated();
    if (behind <= MAX_BEHIND_MS) return 0;
    const dropped = behind - Math.ceil(1000 / 60);
    this.start += dropped;
    return dropped;
  }

  hide(): void { this.hiddenAt ??= this.now(); }

  show(): void {
    if (this.hiddenAt === null) return;
    const now = this.now();
    // Carry on from where the clock stopped, or from where the simulation got to if a video
    // export ran it on while the tab was hidden, so the next frame steps and handles input at once.
    this.start = Math.min(this.start + now - this.hiddenAt, now - this.simulated());
    this.hiddenAt = null;
  }
}
