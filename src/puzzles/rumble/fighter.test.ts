import { describe, expect, it } from 'vitest';
import { Random } from '../../core/random';
import { RumbleAudio } from './audio';
import type { Shaft } from './board';
import { AUTO_FIRE_MS, CHARGE_MS, Fighter, type SoundName } from './fighter';
import { Glove } from './gloves';
import { isCharged } from './pieces';

function setup() {
  const heard: Array<{ name: SoundName; at: number }> = [];
  const f = new Fighter(0, {
    board: new Random(1), alt: new Random(2), wobble: new Random(3),
    fists: [new Random(4), new Random(5)],
  }, { gloveOf: () => new Glove(0), sound: (name, at) => heard.push({ name, at }) }, { startRows: 0 }, 0);
  Object.assign(f.sandbox, { endless: true, shotTimer: false });
  return { f, heard };
}

function shoot(f: Fighter, now: number): number {
  f.press(0, now);
  f.release(0, now + 10);
  return f.flight!.end;
}

const attack = (over: Partial<Shaft> = {}): Shaft => ({
  from: 1, id: 1, count: 0, side: 1, width: 3, height: 5, blacks: 0, next: 0, ...over,
});

describe('Rumble fire timing', () => {
  it('ignores a complete click during flight', () => {
    const { f } = setup();
    const landed = shoot(f, 0);
    f.press(1, 30);
    f.release(1, 40);
    f.update(landed);
    expect(f.canFire).toBe(true);
    expect(f.charging).toBe(-1);
    expect(f.stats.shots).toBe(1);
  });

  it('starts a held press when the next turn begins, with a fresh charge timer', () => {
    const { f } = setup();
    const landed = shoot(f, 0);
    f.press(1, 30);
    expect(f.charging).toBe(-1);
    f.update(landed + CHARGE_MS - 1);
    expect(f.charging).toBe(1);
    expect(f.chargeStart).toBe(landed);
    expect(f.chargedHand).toBe(false);
    f.update(landed + CHARGE_MS);
    expect(f.chargedHand).toBe(true);
    f.release(1, landed + CHARGE_MS);
    expect(isCharged(f.flight!.piece)).toBe(true);
  });

  it('fires uncharged if released as control returns, and ignores the other fist while held', () => {
    const { f } = setup();
    const landed = shoot(f, 0);
    f.press(1, 30);
    f.press(0, 40);
    f.update(landed);
    f.release(0, landed);
    expect(f.stats.shots).toBe(1);
    f.release(1, landed);
    expect(f.stats.shots).toBe(2);
    expect(isCharged(f.flight!.piece)).toBe(false);
  });

  it('requires a fresh press after an automatic shot, even if release is in the next turn', () => {
    const { f } = setup();
    f.sandbox.shotTimer = true;
    f.press(1, 0);
    f.update(AUTO_FIRE_MS);
    const landed = f.flight!.end;
    f.update(landed);
    expect(f.charging).toBe(-1);
    f.release(1, landed + 1);
    expect(f.stats.shots).toBe(1);
    f.press(1, landed + 2);
    f.release(1, landed + 3);
    expect(f.stats.shots).toBe(2);
  });

  it('does not credit charge time after the automatic-fire deadline in a late frame', () => {
    const { f } = setup();
    f.sandbox.shotTimer = true;
    f.press(0, AUTO_FIRE_MS - 500);
    f.update(AUTO_FIRE_MS + 500);
    expect(isCharged(f.flight!.piece)).toBe(false);
  });
});

describe('Rumble incoming sounds', () => {
  it('warns at the next turn boundary and plays impact sounds only when the selected punch lands', () => {
    const { f, heard } = setup();
    f.receive(attack(), 20);
    f.update(20);
    expect(f.picked).toHaveLength(0);
    expect(heard).toEqual([]);
    const landed = shoot(f, 30);
    f.update(landed);
    expect(f.stats.received).toBe(0);
    expect(f.warnings).toBe(2);
    expect(heard).toContainEqual({ name: 'shaft_warning_small', at: landed });
    const nextLanding = shoot(f, landed + 1);
    f.update(nextLanding);
    expect(f.punch!.start).toBe(nextLanding);
    expect(f.stats.received).toBe(15);
    expect(heard.some(s => s.name.startsWith('kung_fu'))).toBe(false);
    f.update(nextLanding + 1);
    expect(heard).toContainEqual({ name: 'kung_fu_3', at: nextLanding + 1 });
  });

  it('grades linked warnings by punch height without adding sprinkle rows', () => {
    const { f, heard } = setup();
    f.receive(attack());
    for (let id = 2; id <= 4; id++) f.receive(attack({ id, height: 0, width: 0, count: 8 }));
    f.update(shoot(f, 0));
    expect(f.picked).toHaveLength(4);
    expect(f.warnings).toBe(2 | 8);
    expect(heard.filter(s => s.name.startsWith('shaft_warning')).map(s => s.name)).toEqual(['shaft_warning_small']);
  });
});

describe('Rumble sustained audio', () => {
  function audio() {
    const events: string[] = [];
    const sound = new RumbleAudio({ loop: name => {
      events.push(`start:${name}`);
      return () => events.push(`stop:${name}`);
    } });
    return { sound, events };
  }

  it('switches charging to charged at one second, then stops on release', () => {
    const { f } = setup(), { sound, events } = audio();
    f.press(0, 10);
    sound.sync(f); sound.sync(f);
    f.update(10 + CHARGE_MS - 1); sound.sync(f);
    expect(events).toEqual(['start:charging']);
    f.update(10 + CHARGE_MS); sound.sync(f);
    f.release(0, 10 + CHARGE_MS); sound.sync(f);
    expect(events).toEqual(['start:charging', 'stop:charging', 'start:charged', 'stop:charged']);
  });

  it('stops charging and the shot warning on automatic fire', () => {
    const { f } = setup(), { sound, events } = audio();
    f.sandbox.shotTimer = true;
    f.update(4000); sound.sync(f);
    f.press(0, 4500); sound.sync(f);
    f.update(5000); sound.sync(f);
    expect(events).toEqual(['start:ball_soon_fire', 'start:charging', 'stop:ball_soon_fire', 'stop:charging']);
  });

  it('holds one final-drop warning loop and stops it when a punch resets the shot count', () => {
    const { f } = setup(), { sound, events } = audio();
    f.board.shots = 7;
    sound.sync(f);
    f.update(3000); sound.sync(f);
    expect(events).toEqual(['start:shake_2']);
    f.strikeNow(attack(), new Glove(0), 3001); sound.sync(f);
    expect(events).toEqual(['start:shake_2', 'stop:shake_2']);
  });

  it('cleans up loops on pause, restart, seeking, knockout and match end', () => {
    const { f } = setup(), { sound, events } = audio();
    f.press(0, 10);
    sound.sync(f); sound.sync(null); sound.sync(null); sound.sync(f);
    f.halted = true; sound.sync(f);
    f.halted = false; sound.sync(f);
    f.knockOut(30); sound.sync(f);
    expect(events).toEqual(['start:charging', 'stop:charging', 'start:charging', 'stop:charging', 'start:charging', 'stop:charging']);
  });
});
