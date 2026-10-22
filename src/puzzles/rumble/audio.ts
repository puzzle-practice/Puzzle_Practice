import type { SoundBank } from '../../core/audio';
import type { Fighter } from './fighter';

type LoopName = 'charging' | 'charged' | 'ball_soon_fire' | 'shake_2';

/** Sustained sounds belong to a gameplay state and stop as soon as that state ends. */
export class RumbleAudio {
  private readonly playing = new Map<LoopName, { stamp: number; stop: () => void }>();

  constructor(private readonly sounds: Pick<SoundBank, 'loop'>) {}

  sync(f: Fighter | null): void {
    const wanted = new Map<LoopName, number>();
    if (f && !f.out && !f.halted) {
      if (f.canFire) {
        if (f.charging >= 0) wanted.set(f.chargedHand ? 'charged' : 'charging', f.chargeStart);
        if (f.warned && f.sandbox.shotTimer) wanted.set('ball_soon_fire', f.controlAt);
      }
      if (f.board.shots === 7) wanted.set('shake_2', f.shotAt);
    }
    for (const [name, sound] of this.playing) {
      if (wanted.get(name) === sound.stamp) continue;
      sound.stop();
      this.playing.delete(name);
    }
    for (const [name, stamp] of wanted) {
      if (!this.playing.has(name)) this.playing.set(name, { stamp, stop: this.sounds.loop(name) });
    }
  }
}
