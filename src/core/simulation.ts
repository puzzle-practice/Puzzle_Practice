/** Rendering may be irregular; gameplay always receives the same 60 Hz timeline. */
export class Simulation {
  private step = 0;
  get time(): number { return Math.round(this.step * 1000 / 60); }
  advance(elapsed: number, run: (time: number) => void): void {
    // Retain any debt after a long stall instead of dropping game time or blocking the UI.
    for (let budget = 0; budget < 240 && Math.round((this.step + 1) * 1000 / 60) <= elapsed; budget++) {
      this.step++;
      run(this.time);
    }
  }
}
