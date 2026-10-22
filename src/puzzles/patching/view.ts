import type { Images } from '../../core/assets';
import type { Point } from '../../core/input';
import type { Screen } from '../../core/screen';
import { drawGameText, drawPauseLabel, gameTextBox } from '../../core/game-text';
import { BoardRandom } from '../forage/board';
import { animationFrame, clamp, fadeIn, fadeOut, travel, windScale } from './animation';
import { BLOCKER, CONNECTED, CROSS, GROMMET, PatchingBoard, SLACK, SPOOL, STRAIGHT, TAUT, TEE, TIE, TORN, type Piece } from './logic';

export const CELL = 56, LEFT = 29, TOP = 69;
export const center = (i: number): Point => [57 + i % 7 * CELL, 97 + Math.floor(i / 7) * CELL];
export function cellAt([x, y]: Point): number {
  const col = Math.floor((x - LEFT) / CELL), row = Math.floor((y - TOP) / CELL);
  return col < 0 || col >= 7 || row < 0 || row >= 6 ? -1 : col + row * 7;
}
const names = ['tiles', 'straight', 'elbow', 'tee', 'plus', 'grommets', 'tie_offs', 'blocker', 'spool'];
const EFFECT_FRAMES: Record<string, number> = { effect_consume: 15, effect_fireworks: 11, effect_loose_end: 18,
  effect_star: 13, effect_spool_sparkle: 38, effect_sheen_horizontal: 6, effect_wind_left: 28,
  effect_wind_right: 28, effect_pulse_straight: 5, effect_pulse_elbow: 5, effect_pulse_tee: 5,
  effect_pulse_plus: 5, gust_punch: 5, gust_rip: 5, gust_shred: 5 };
export interface SpriteFrame {
  name: string; tile: number; x: number; y: number; w: number; h: number; alpha: number; scale: number; angle: number; layer: number;
}
interface Effect { name: string; x: number; y: number; w: number; h: number; start: number; fps: number; loop?: boolean; angle?: number; layer?: number }
interface Flying { name: string; tile: number; w: number; h: number; start: number; duration: number; x: number; endX: number; y: number; endY: number; scale: number; wind: boolean; flip: boolean }
interface Clear { i: number; at: number; sound: string; grommet: boolean; played: boolean }
interface PieceImage { name: string; tile: number; tension: number; fadeAt: number | null; hidden: boolean }
interface FloatingText { value: string; at: number; x: number; y: number; size: number; align?: CanvasTextAlign }
interface Drag { i: number; from: Point; to: Point }
interface Maneuver { i: number; type: number; at: number }
const imageOf = (p: Piece): PieceImage => ({ name: p.tension === TORN ? 'transparent' : names[p.type],
  tile: p.tension === TORN || p.type === BLOCKER ? 0 : p.type === CROSS ? (p.tension === CONNECTED || p.tension === TAUT ? 1 : 0) :
    p.orientation + (![SPOOL, BLOCKER].includes(p.type) && p.tension !== SLACK ? 4 : 0),
  tension: p.tension, fadeAt: null, hidden: false });

export class PatchingView {
  board: PatchingBoard;
  cursor = 0;
  selected: number | null = null;
  windAt = 0;
  entered = 0;
  completeAt: number | null = null;
  nextAt = Infinity;
  result = '';
  resultAt = Infinity;
  private rng: BoardRandom;
  private effects: Effect[] = [];
  private flying: Flying[] = [];
  private clear: Clear[] = [];
  private pieces: PieceImage[] = [];
  private loose: Effect[] = [];
  private glow: Effect[] = [];
  private swaps: { i: number; at: number }[] = [];
  private outgoing: SpriteFrame[] = [];
  private transitionAt: number | null = null;
  private variants: number[] = [];
  private lastSounds = new Map<string, number>();
  private queuedSounds: { name: string; at: number }[] = [];
  private warning = false;
  private windRight: boolean;
  private grommets = 0;
  private feedbackSound = false;
  private texts: FloatingText[] = [];
  private heldPiece: Drag | null = null;
  private ghost: PieceImage | null = null;
  private removedBonuses = new Set<number>();
  private heldWindMs = 0;
  private maneuvers: Maneuver[] = [];

  constructor(private screen: Screen, private images: Images, private sound: (name: string) => void, board: PatchingBoard, now: number, seed: number) {
    this.board = board; this.rng = new BoardRandom(seed); this.windRight = this.rng.next(1) !== 0;
    this.windAt = this.entered = now;
    this.initialize(now);
  }
  get drag(): Drag | null { return this.heldPiece; }
  set drag(value: Drag | null) {
    if (value && (!this.heldPiece || this.heldPiece.i !== value.i)) this.ghost = { ...this.pieces[value.i] };
    this.heldPiece = value;
    if (!value) this.ghost = null;
  }
  private initialize(now: number): void {
    this.pieces = Array.from({ length: 42 }, (_, i) => imageOf(this.board.pieces.get(i)!));
    this.variants = Array.from({ length: 42 }, () => this.rng.nextInt(3));
    this.restartLoops(now);
  }
  play(name: string, now: number): void {
    if (now - (this.lastSounds.get(name) ?? -Infinity) >= 200) { this.lastSounds.set(name, now); this.sound(name); }
  }
  ready(now: number): boolean { return this.completeAt === null && now >= this.entered; }
  setBoard(board: PatchingBoard, now: number): void {
    // Capture the visible old layers: cleared stitches must not reappear during the fade.
    this.outgoing = this.boardFrames(now);
    this.transitionAt = now; this.board = board;
    this.entered = now; this.windAt = now + 530;
    this.completeAt = null; this.nextAt = Infinity; this.resultAt = Infinity; this.result = '';
    this.clear = []; this.warning = false; this.feedbackSound = false;
    this.selected = null; this.drag = null; this.grommets = 0; this.removedBonuses.clear();
    this.initialize(now);
  }
  /** Refresh images exactly when a move or gust changes the board's visible state. */
  changed(_before: Map<number, number>, now: number): void {
    for (const [i, p] of this.board.pieces) {
      const old = this.pieces[i], next = imageOf(p);
      if (old.name === next.name && old.tile === next.tile) continue;
      if (p.tension === CONNECTED && old.tension !== CONNECTED) next.fadeAt = now;
      this.pieces[i] = next;
      if (p.type === GROMMET && p.tension === CONNECTED) {
        this.effect('effect_star', ...center(i), 56, 56, now, 25); this.play('grommet_connected', now);
      }
    }
    this.restartLoops(now);
  }
  private restartLoops(now: number): void {
    this.loose = this.completeAt === null ? this.board.loose.map(i => ({ name: 'effect_loose_end', x: center(i)[0], y: center(i)[1], w: 60, h: 60, start: now, fps: 10, loop: true })) : [];
    this.glow = [];
    if (this.completeAt === null && this.board.canGust && this.board.allTiesConnected) {
      const [x, y] = center(this.board.spool), angle = this.board.pieces.get(this.board.spool)!.orientation % 2 === 0 ? 0 : Math.PI / 2;
      this.glow = [{ name: 'effect_sheen_horizontal', x, y, w: 56, h: 56, start: now, fps: 6, loop: true, angle },
        { name: 'effect_spool_sparkle', x, y, w: 56, h: 56, start: now, fps: 10, loop: true, angle, layer: 3 }];
    }
  }
  swapped(a: number, b: number, now: number): void {
    [this.pieces[a], this.pieces[b]] = [this.pieces[b], this.pieces[a]];
    this.swaps.push({ i: a, at: now }, { i: b, at: now }); this.cursor = b; this.play('piece_swap', now);
  }
  private effect(name: string, x: number, y: number, w: number, h: number, start: number, fps: number, angle = 0): void {
    this.effects.push({ name, x, y, w, h, start, fps, angle });
  }
  warningWind(now: number): void {
    if (this.warning) return;
    this.warning = true;
    for (let n = 1; n <= 2; n++) {
      const at = now + this.rng.nextInt(1000);
      this.effect(this.windRight ? 'effect_wind_right' : 'effect_wind_left', 196, n * 175, 450, 125, at, 10 + this.rng.nextInt(10));
      this.queuedSounds.push({ name: 'wind_buildup', at });
    }
  }
  private gustWind(now: number): void {
    const windName = this.windRight ? 'gust_right' : 'gust_left';
    const start = this.windRight ? -184 : 760, end = this.windRight ? 760 : -184;
    const delay = this.rng.nextInt(250);
    for (let n = 1; n <= 3; n++) {
      const y = 20 + n * 119 + this.rng.nextInt(50), duration = 800 + this.rng.nextInt(500);
      const scale = windScale(Math.fround(Math.fround(.3) + Math.fround(this.rng.nextFloat() * Math.fround(.7))));
      this.flying.push({ name: windName, tile: 0, w: 368, h: 119, start: now + delay, duration, x: start, endX: end, y, endY: y, scale, wind: true, flip: false });
      this.queuedSounds.push({ name: 'wind_gust', at: now + delay });
    }
    const sheep = this.rng.nextFloat() > Math.fround(.999);
    const objects: number[] = [];
    if (sheep) objects.push(10);
    else for (let i = 0; i < 10; i++) if (this.rng.nextFloat() < Math.fround(.1)) { objects.push(i); if (objects.length >= 3) break; }
    let y = 100;
    for (const item of objects) {
      y += 100 + this.rng.nextInt(50);
      const endY = y + this.rng.nextInt(50), at = now + delay + this.rng.nextInt(350);
      this.flying.push({ name: item === 10 ? 'item_sheep' : item < 8 ? 'item_set1' : 'item_set2', tile: item === 10 ? 0 : item < 8 ? item : item - 8,
        w: item === 10 ? 222 : item < 8 ? 140 : 180, h: item === 10 ? 128 : item < 8 ? 70 : 90,
        start: at, duration: 1300, x: start, endX: end, y, endY, scale: 1, wind: false, flip: !this.windRight });
      if (sheep) this.queuedSounds.push({ name: 'sheep', at });
    }
    this.windRight = this.rng.next(1) !== 0;
  }
  gust(now: number, done: boolean, torn: number, used: number[], earned: number[] = []): void {
    this.heldWindMs = Math.max(0, now - this.windAt);
    this.drag = null; this.selected = null; this.windAt = now; this.warning = false;
    if (done) this.completeAt = now;
    this.changed(new Map(), now);
    if (!done || torn) this.gustWind(now);
    for (const i of used) { this.effect('effect_consume', ...center(i), 120, 120, now, 20); this.play('grommet_consumed', now); }
    if (!done) return;
    if (torn) {
      for (const [i, p] of this.board.pieces) if (p.tension === TORN) {
        this.effect(['gust_punch', 'gust_rip', 'gust_shred'][this.variants[i]], ...center(i), 56, 56, now, 10);
      }
      this.play('hole_torn', now); this.nextAt = now + 3000;
      // The game leaves the torn cloth visible; there is no additional failure banner.
    } else {
      for (const i of earned) {
        this.removedBonuses.add(i); this.maneuvers.push({ i, type: this.board.bonuses.get(i)!, at: now });
      }
      this.play('board_complete', now); this.board.distances();
      let furthest = 0;
      for (const [i, p] of this.board.pieces) if (p.tension === CONNECTED || p.tension === TAUT) {
        furthest = Math.max(furthest, p.distance);
        const at = now + p.distance * 200;
        const regular = [STRAIGHT, 2, TEE, CROSS].includes(p.type);
        this.effect(regular ? `effect_pulse_${names[p.type]}` : 'effect_fireworks', ...center(i), regular ? 100 : 152, regular ? 100 : 152, at, 10, regular ? p.orientation * Math.PI / 2 : 0);
        this.clear.push({ i, at, sound: p.type === GROMMET ? 'grommet_clear' : p.type === TIE ? 'tie_off_clear' : regular ? 'thread_clear' : '', grommet: p.type === GROMMET, played: false });
      }
      this.clear.sort((a, b) => a.at - b.at);
      const fraction = Math.fround(this.board.numMovableConnected / this.board.numMovable);
      this.result = fraction <= Math.fround(.2) ? 'Patchy Work' : fraction <= .5 ? 'A fine patch!' : fraction <= Math.fround(.8) ? 'Sew Good!' : fraction <= Math.fround(.99) ? 'Master Patcher!' : 'Flawless Masterpiece!';
      this.resultAt = now + furthest * 200; this.nextAt = this.resultAt + 1500;
    }
  }
  advance(now: number): void {
    const events: { name: string; at: number; clear?: Clear }[] = [...this.queuedSounds];
    this.queuedSounds = this.queuedSounds.filter(s => s.at > now);
    for (const item of this.clear) if (!item.played && now >= item.at) events.push({ name: item.sound, at: item.at, clear: item });
    events.sort((a, b) => a.at - b.at);
    for (const event of events) if (event.at <= now) {
      if (event.name) this.play(event.name, event.at);
      if (event.clear) {
        event.clear.played = true;
        if (event.clear.grommet && ++this.grommets > 1) {
          const size = [24, 30, 36, 42][Math.min(3, this.grommets - 2)];
          const value = ['Double!', 'Triple!', 'Bingo!', 'Donkey!', 'Vegas!'][Math.min(this.grommets, 6) - 2];
          this.texts.push({ value, at: event.at, x: 225, y: 150, size });
          if (this.grommets > 6) this.texts.push({ value: String(this.grommets - 5), at: event.at, x: 225 + Math.trunc(gameTextBox(this.screen.ctx, value, { px: size }).w / 2), y: 144, size: 24, align: 'left' });
        }
      }
    }
    if (this.completeAt !== null && !this.board.torn && now >= this.resultAt && !this.feedbackSound) {
      this.feedbackSound = true;
      const fraction = Math.fround(this.board.numMovableConnected / this.board.numMovable);
      this.play(fraction <= Math.fround(.2) ? 'fanfare_very_bad' : fraction <= .5 ? 'fanfare_bad' : fraction <= Math.fround(.8) ? 'fanfare_good' : fraction <= Math.fround(.99) ? 'fanfare_great' : 'fanfare_best', this.resultAt);
      this.texts.push({ value: this.result, at: this.resultAt, x: 225, y: 250, size: this.result === 'Flawless Masterpiece!' ? 36 : this.result === 'Master Patcher!' ? 30 : 24 });
    }
    this.effects = this.effects.filter(e => now < e.start + EFFECT_FRAMES[e.name] * Math.floor(1000 / e.fps));
    this.flying = this.flying.filter(f => now < f.start + f.duration);
    this.swaps = this.swaps.filter(s => now < s.at + 750);
    this.texts = this.texts.filter(t => now < t.at + 1500);
    this.maneuvers = this.maneuvers.filter(m => now < m.at + 1200);
  }
  private frame(name: string, tile: number, x: number, y: number, w: number, h: number, layer: number, alpha = 1, scale = 1, angle = 0): SpriteFrame {
    return { name, tile, x, y, w, h, alpha, scale, angle, layer };
  }
  private boardFrames(now: number): SpriteFrame[] {
    const frames: SpriteFrame[] = [];
    for (let i = 0; i < 42; i++) {
      const [x, y] = center(i), p = this.pieces[i];
      const alpha = this.transitionAt === null ? 1 : fadeIn(now - this.transitionAt, 265 + i % 7 * 25 + Math.floor(i / 7) * 15, 400);
      // Refreshing a board replaces its cloth images immediately, independently of thread fades.
      frames.push(this.frame('tiles', this.board.tiles[i] === TORN ? 2 + this.variants[i] : this.board.tiles[i] === SLACK ? 0 : 1, x, y, 56, 56, -5));
      if (p.hidden || this.clear.some(item => item.i === i && now >= item.at)) continue;
      const opacity = p.fadeAt === null ? alpha : fadeIn(now - p.fadeAt);
      const drag = this.drag?.i === i ? this.drag : null;
      frames.push(this.frame(p.name, p.tile, x + (drag ? drag.to[0] - drag.from[0] : 0), y + (drag ? drag.to[1] - drag.from[1] : 0), 56, 56, drag ? -1 : -4, opacity));
    }
    const activeTypes = this.board.activeBonusTypes;
    for (const [i, type] of this.board.bonuses) if (!this.removedBonuses.has(i)) {
      const [x, y] = center(i), active = this.board.bonusActive(i);
      const alpha = this.transitionAt === null ? 1 : fadeIn(now - this.transitionAt, 265 + i % 7 * 25 + Math.floor(i / 7) * 15, 400);
      frames.push(this.frame(active ? activeTypes.size === 1 ? 'bonus_green' : 'bonus_red' : 'bonus', type, x - 28, y - 28, 34, 34, -2, alpha));
    }
    return frames;
  }
  /** A complete ordered scene, also used for frame-by-frame verification. */
  scene(now: number): SpriteFrame[] {
    const frames: SpriteFrame[] = [];
    if (this.transitionAt !== null) {
      frames.push(this.frame('blank_board', 0, 225, 237, 392, 336, -6, fadeOut(now - this.transitionAt, 530, 0)));
      for (const old of this.outgoing) {
        const i = cellAt([old.x, old.y]), delay = i >= 0 ? i % 7 * 25 + Math.floor(i / 7) * 15 : 0;
        frames.push({ ...old, alpha: fadeOut(now - this.transitionAt, delay, 400) });
      }
    }
    frames.push(...this.boardFrames(now));
    for (const s of this.swaps) frames.push(this.frame('swap_effect', 0, ...center(s.i), 60, 60, -2, fadeOut(now - s.at)));
    for (const e of [...this.loose, ...this.glow, ...this.effects]) {
      const tile = animationFrame(now - e.start, e.fps, EFFECT_FRAMES[e.name], e.loop);
      if (tile >= 0) frames.push(this.frame(e.name, tile, e.x, e.y, e.w, e.h, e.layer ?? 2, 1, 1, e.angle ?? 0));
    }
    for (const f of this.flying) {
      const age = Math.max(0, now - f.start);
      if (age >= f.duration) continue;
      const alpha = f.wind ? now < f.start ? 1 : fadeIn(age, 0, Math.trunc(Math.fround(f.duration * Math.fround(.7)))) : 1;
      frames.push(this.frame(f.name, f.tile, travel(f.x, f.endX, age, f.duration), travel(f.y, f.endY, age, f.duration), f.w, f.h, 2, alpha, f.scale, f.flip ? Math.PI : 0));
    }
    if (this.drag && this.ghost) frames.push(this.frame(this.ghost.name, this.ghost.tile, ...center(this.drag.i), 56, 56, -4, .5));
    for (const m of this.maneuvers) {
      const age = now - m.at;
      if (age < 0 || age >= 1200) continue;
      const [cx, cy] = center(m.i), x = cx - 28, y = cy - 28;
      const angle = Math.atan((300 - y) / (900 - x)), along = Math.max(0, age - 700);
      const f = Math.fround, speed = f(f(.2) + f(along * f(.008)));
      const px = x + Math.round(f(along * f(f(Math.cos(angle)) * speed)));
      const py = y + Math.round(f(along * f(f(Math.sin(angle)) * speed)));
      frames.push(this.frame('maneuver_flare', Math.floor(now / 66) % 25, px, py, 70, 70, 0));
      frames.push(this.frame(`bonus_${['circle', 'diamond', 'plus', 'x', 'o', 'star', 'blade'][m.type - 1]}`, 0, px, py, 34, 34, 0));
      if (age < 900) for (let n = 0; n < 8; n++) {
        const theta = Math.PI * 2 * n / 8;
        frames.push(this.frame('maneuver_star', 0, x + Math.round(f(age * f(Math.cos(theta) * f(.12)))), y + Math.round(f(age * f(Math.sin(theta) * f(.12)))), 30, 30, 0, fadeOut(age, 200, 700)));
      }
    }
    return frames.filter(f => f.alpha > 0 && f.scale > 0 && f.name !== 'transparent').sort((a, b) => a.layer - b.layer);
  }
  private sprite(f: SpriteFrame): void {
    const c = this.screen.ctx;
    c.save(); c.translate(f.x, f.y); c.scale(f.scale, f.scale); c.rotate(f.angle); c.globalAlpha = clamp(f.alpha);
    c.drawImage(this.images.get(f.name), f.tile * f.w, 0, f.w, f.h, -f.w / 2, -f.h / 2, f.w, f.h); c.restore();
  }
  private text(value: string, x: number, y: number, size: number, alpha = 1, align: CanvasTextAlign = 'center'): void {
    drawGameText(this.screen.ctx, value, x, y, { px: size, alpha: clamp(alpha), align: align === 'left' || align === 'start' ? 'left' : align === 'right' || align === 'end' ? 'right' : 'center' });
  }
  draw(now: number, windSeconds: number, running: boolean, paused: boolean): void {
    this.screen.blit(this.images.get(running && !paused ? 'background' : 'background_inactive'), 0, 0);
    const title = this.images.get('title'); this.screen.blit(title, (450 - title.width) / 2, 10);
    for (const f of this.scene(now)) this.sprite(f);
    for (const t of this.texts) {
      const age = now - t.at;
      if (age >= 0 && age < 1500) this.text(t.value, t.x, t.y + Math.trunc(-30 * Math.fround(age / 1500)), t.size, age <= 750 ? 1 : fadeOut(age, 750, 750), t.align);
    }
    if (running) {
      this.sprite(this.frame('cursor', 0, ...center(this.cursor), 40, 40, 0));
      if (this.selected !== null) this.sprite(this.frame('cursor_selected', 0, ...center(this.selected), 40, 40, 0));
    }
    const c = this.screen.ctx;
    c.fillStyle = 'rgb(41,68,103)'; c.fillRect(32, 412, 386, 10);
    const windMs = this.completeAt !== null || now < this.windAt ? this.heldWindMs : Math.max(0, now - this.windAt);
    const t = windSeconds <= 0 ? 0 : clamp(windMs / (windSeconds * 1000));
    const blend = clamp((t - .7) / .3);
    c.fillStyle = `rgb(${Math.round(167 + 83 * blend)},${Math.round(223 - 173 * blend)},${Math.round(251 - 201 * blend)})`; c.fillRect(32, 412, Math.floor(386 * t), 10);
    if (paused) { c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(0, 50, 450, 500); drawPauseLabel(c, 'Paused', 225, 300, 450); }
    if (!running && this.completeAt === null) { c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(29, 69, 392, 336); drawPauseLabel(c, 'Press Start to begin', 225, 237, 392); }
  }
}
