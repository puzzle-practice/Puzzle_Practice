/** Review navigation only: one step on press, then accelerating repeats without a backlog. */
export class HoldScrub {
  private direction: -1 | 1 | null = null;
  private started = 0;
  private next = 0;

  constructor(private readonly step: (direction: -1 | 1) => boolean) {}

  press(direction: -1 | 1, now: number): void {
    this.direction = direction;
    this.started = now;
    this.next = now + 500;
    if (!this.step(direction)) this.stop();
  }

  stop(): void { this.direction = null; }

  tick(now: number): void {
    if (this.direction === null || now < this.next) return;
    if (!this.step(this.direction)) { this.stop(); return; }
    const held = now - this.started;
    this.next = now + (held < 1500 ? 180 : held < 3000 ? 90 : 30);
  }
}
