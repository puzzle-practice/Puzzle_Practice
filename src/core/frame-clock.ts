/**
 * The puzzle clock. While a frame runs, every call sees the time the frame started, the way a
 * replay sees it. Without this, the clock would creep on while a busy frame runs, so a game
 * would play slightly differently from its replay and the replay would drift off course.
 */
export class FrameClock {
  private replayTime: number | null = null;
  private liveOffset = 0;
  private frameTime: number | null = null;

  constructor(private readonly realTicks: () => number) {}

  readonly ticks = (): number => this.replayTime ?? (this.frameTime ?? this.realTicks()) + this.liveOffset;

  readonly setReplayTime = (milliseconds: number | null): void => {
    if (milliseconds === null && this.replayTime !== null) this.liveOffset = this.replayTime - this.realTicks();
    this.replayTime = milliseconds;
  };

  /** Runs one frame with the clock held at its start. */
  frame(run: () => void): void {
    this.frameTime = this.realTicks();
    try {
      run();
    } finally {
      this.frameTime = null;
    }
  }
}
