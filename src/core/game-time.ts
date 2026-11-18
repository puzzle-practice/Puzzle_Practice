/**
 * The game's elapsed time, which stops while the tab is hidden. A hidden tab gets few or no
 * animation frames, so if the hidden time counted, the simulation would play the whole gap back
 * as fast catch-up steps on return. The clock reads the moment the tab was hidden until it is
 * shown again, so any frame that still runs while hidden can't move the game on either; if it
 * could, the game would sit frozen on return while the clock caught up with it, and inputs
 * would wait that long to go through.
 */
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
