import type { Images } from '../../core/assets';
import type { Screen } from '../../core/screen';
import { drawGameText, floatAt, gameTextBox, BOARD_FONT, TEXT_WHITE, TEXT_YELLOW } from '../../core/game-text';
import { colourOf, EMPTY, sparklesOf, type Batten, type Group, type Stage, type WeaveBoard } from './logic';
import { CELL, LEFT, TOP, SHUTTLE_Y, REED_OFFSET, ROW_MS, CLOSE_MS, CLEAR_MS, COLLAPSE_MS,
  FLY_MS, PARTICLE_MS, RETURN_MS, FADE_MS, SHUTTLE_SPEED, KEY_MS, yForRow, clamp01, mousePosition } from './timing';

interface Path { x: number; y: number; toX: number; toY: number; start: number; duration: number }
interface Thread { colour: number; stars: number; x: number; y: number; path?: Path; aboveReed?: boolean }
interface Effect { colour: number; x: number; y: number; start: number; toX: number; toY: number; particles: [number, number][] }
interface Message { text: string; x: number; y: number; start: number; yellow: boolean; small: boolean }
type Grid = Array<Array<Thread | null>>;
const grid = (): Grid => Array.from({ length: 11 }, () => Array<Thread | null>(10).fill(null));
const position = (path: Path, now: number): [number, number] => {
  const t = clamp01((now - path.start) / path.duration);
  return [path.x + Math.trunc((path.toX - path.x) * t), path.y + Math.trunc((path.toY - path.y) * t)];
};

/** Draws the original loom at its 450 × 600 logical size and schedules the reed and threads. */
export class WeavingView {
  private pieces = grid();
  private tasks: Array<{ at: number; run: () => void }> = [];
  private effects: Effect[] = [];
  private messages: Message[] = [];
  private reedY = SHUTTLE_Y + REED_OFFSET;
  private reedPath?: Path;
  private reedFrame = 0;
  private shuttlePath?: Path;
  private shuttleX = LEFT;
  private woodPath?: Path;
  private shakeAt = -Infinity;
  private enteringLeft = false;
  private meter = 0;
  private fadeIn = 0;
  private fadeOut = Infinity;
  private visualRandom: number;
  lockUntil = Infinity;
  offset = 0;
  mouseMode = false;
  lastMouseX = 0;

  constructor(private readonly screen: Screen, private readonly images: Images,
    private readonly sound: (name: string) => void, readonly board: WeaveBoard, now: number, seed: number) {
    this.visualRandom = seed >>> 0 || 1;
    this.fadeIn = now;
    for (let r = 1; r < 11; r++) for (let c = 0; c < 10; c++) {
      const p = board.pieces[r][c];
      if (p !== EMPTY) this.pieces[r][c] = this.thread(p, LEFT + c * CELL, yForRow(r));
    }
    this.at(now + FADE_MS, () => this.deal(now + FADE_MS));
    this.sound('start_game');
  }

  private random(): number {
    let n = this.visualRandom;
    n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
    this.visualRandom = n >>> 0;
    return this.visualRandom / 0x100000000;
  }
  private thread(p: number, x: number, y: number): Thread { return { colour: colourOf(p), stars: sparklesOf(p), x, y }; }
  private at(at: number, run: () => void): void { this.tasks.push({ at, run }); this.tasks.sort((a, b) => a.at - b.at); }
  advance(now: number): void { while (this.tasks.length && this.tasks[0].at <= now) this.tasks.shift()!.run(); }
  ready(now: number): boolean { return now >= this.lockUntil && now < this.fadeOut; }

  private setReed(closed: boolean, at: number): void {
    for (let i = 0; i < 3; i++) this.at(at + i * 30, () => { this.reedFrame = closed ? i : 2 - i; });
  }

  private deal(now: number): void {
    const width = 10 - this.board.maxOffset;
    if (this.mouseMode) {
      const p = mousePosition(this.lastMouseX, width, this.board.maxOffset);
      this.offset = p.offset; this.shuttleX = p.x;
    } else {
      // Keyboard play receives a fresh random position on each shuttle.
      this.offset = Math.floor(this.random() * this.board.maxOffset);
      this.shuttleX = LEFT + this.offset * CELL;
    }
    this.enteringLeft = !this.enteringLeft;
    const woodStart = this.enteringLeft ? -312 : 450;
    const woodEnd = this.enteringLeft ? 450 : -312;
    const from = this.enteringLeft ? woodStart - (width - 2) * CELL : woodStart + 312 - 2 * CELL;
    const duration = Math.round(Math.abs(this.shuttleX - from) / SHUTTLE_SPEED);
    this.shuttlePath = { x: from, y: SHUTTLE_Y, toX: this.shuttleX, toY: SHUTTLE_Y, start: now, duration };
    this.woodPath = { x: woodStart, y: SHUTTLE_Y, toX: woodEnd, toY: SHUTTLE_Y, start: now,
      duration: Math.round(762 / SHUTTLE_SPEED) };
    this.pieces[0].fill(null);
    this.board.shuttle.forEach((p, col) => {
      if (p !== EMPTY) this.pieces[0][col + this.offset] = this.thread(p, LEFT + (col + this.offset) * CELL, SHUTTLE_Y);
    });
    this.lockUntil = now + Math.max(duration, this.woodPath.duration);
    this.sound(`shift_${1 + Math.floor(this.random() * 7)}`);
  }

  /** Freeplay mode: shows the board's threads and shuttle as they are now, the shuttle kept where it was if it still fits. */
  refresh(): void {
    for (let r = 1; r < 11; r++) for (let c = 0; c < 10; c++) {
      const p = this.board.pieces[r][c], old = this.pieces[r][c];
      // Threads that stay keep the sparkles they've already lost.
      if (p === EMPTY) this.pieces[r][c] = null;
      else if (!old || old.colour !== colourOf(p) || (sparklesOf(p) === 0) !== (old.stars === 0)) this.pieces[r][c] = this.thread(p, LEFT + c * CELL, yForRow(r));
    }
    this.offset = Math.min(this.offset, this.board.maxOffset);
    this.shuttleX = LEFT + this.offset * CELL;
    this.shuttlePath = undefined;
    this.pieces[0].fill(null);
    this.board.shuttle.forEach((p, col) => {
      if (p !== EMPTY && col + this.offset < 10) this.pieces[0][col + this.offset] = this.thread(p, LEFT + (col + this.offset) * CELL, SHUTTLE_Y);
    });
  }

  moveMouse(x: number, now: number): void {
    if (!this.ready(now)) return;
    this.mouseMode = true; this.lastMouseX = x;
    const p = mousePosition(x, 10 - this.board.maxOffset, this.board.maxOffset);
    this.shift(p.offset, p.x, now, false);
  }
  moveKey(direction: number, now: number): void {
    if (!this.ready(now)) return;
    this.mouseMode = false;
    const offset = Math.max(0, Math.min(this.board.maxOffset, this.offset + direction));
    this.shift(offset, LEFT + offset * CELL, now, true);
  }
  private shift(offset: number, x: number, now: number, animate: boolean): void {
    const oldX = this.shuttlePath ? position(this.shuttlePath, now)[0] : this.shuttleX;
    const difference = offset - this.offset;
    this.pieces[0] = Array.from({ length: 10 }, (_, col) => this.pieces[0][col - difference] ?? null);
    this.offset = offset;
    this.shuttleX = x;
    this.shuttlePath = animate ? { x: oldX, y: SHUTTLE_Y, toX: x, toY: SHUTTLE_Y, start: now, duration: KEY_MS } : undefined;
    if (animate) this.lockUntil = now + KEY_MS;
    if (difference || animate) this.sound(`shift_${1 + Math.floor(this.random() * 7)}`);
  }

  reject(now: number): void {
    this.setReed(true, now);
    this.shuttlePath = { x: this.shuttleX, y: SHUTTLE_Y, toX: this.shuttleX, toY: TOP - CELL, start: now, duration: ROW_MS };
    const top = SHUTTLE_Y + REED_OFFSET;
    const bottom = TOP - CELL + REED_OFFSET;
    this.at(now + CLOSE_MS, () => { this.reedPath = { x: 0, y: top, toX: 0, toY: bottom, start: now + CLOSE_MS, duration: ROW_MS }; });
    this.at(now + CLOSE_MS + ROW_MS, () => {
      this.shakeAt = now + CLOSE_MS + ROW_MS;
    });
    this.at(now + CLOSE_MS + 2 * ROW_MS, () => {
      this.shuttlePath = { x: this.shuttleX, y: TOP - CELL, toX: this.shuttleX, toY: SHUTTLE_Y,
        start: now + CLOSE_MS + 2 * ROW_MS, duration: ROW_MS };
      this.reedPath = { x: 0, y: bottom, toX: 0, toY: top, start: now + CLOSE_MS + 2 * ROW_MS, duration: ROW_MS };
    });
    this.setReed(false, now + CLOSE_MS + 3 * ROW_MS);
    this.lockUntil = now + CLOSE_MS * 2 + 3 * ROW_MS;
  }

  batten(result: Batten, now: number, onGroups: (groups: Group[], chain: number) => void, onDone: (at: number) => void): void {
    this.lockUntil = Infinity;
    this.shuttlePath = undefined;
    this.pieces[0].forEach((p, col) => { if (p) { p.x = LEFT + col * CELL; p.y = SHUTTLE_Y; } });
    let at = now;
    let reed = 0;
    let chain = 0;
    for (const stage of result.stages) {
      if (stage.reed !== reed) {
        if (reed === 0) { this.setReed(true, at); at += CLOSE_MS; }
        const start = at;
        const previous = reed;
        this.at(start, () => this.compress(stage, previous, start));
        at += ROW_MS * (stage.reed - reed);
        reed = stage.reed;
      }
      if (stage.groups.length) {
        const start = at;
        const n = ++chain;
        this.at(start, () => {
          this.clear(stage.groups, start);
          this.sound(`piece_destroy_${Math.min(4, n)}`);
          onGroups(stage.groups, n);
          if (n >= 2) this.say(['', '', 'Double!', 'Triple!', 'Bingo!', 'Donkey!', 'Vegas!'][Math.min(n, 6)], 225, 300, start, true);
          if (new Set(stage.groups.map(g => g.colour)).size === 4) this.say('Unbeweavable!', 225, 300, start);
        });
        at += CLEAR_MS;
      }
    }
    const returning = at;
    this.at(returning, () => {
      for (const row of this.pieces) for (const p of row) if (p) p.stars = Math.max(0, p.stars - 1);
      this.meter = Math.min(1, this.board.groupsCleared / this.board.target);
      this.reedPath = { x: 0, y: yForRow(reed) + REED_OFFSET, toX: 0, toY: SHUTTLE_Y + REED_OFFSET,
        start: returning, duration: RETURN_MS };
    });
    at += RETURN_MS;
    this.setReed(false, at);
    this.at(at, () => {
      this.reedY = SHUTTLE_Y + REED_OFFSET;
      if (result.booched) {
        this.deal(at);
        this.at(this.lockUntil, () => this.finish(true, this.lockUntil, onDone));
      } else if (result.complete) this.finish(false, at, onDone);
      else this.deal(at);
    });
  }

  private compress(stage: Stage, previous: number, now: number): void {
    const next = this.pieces.map(row => [...row]);
    for (const m of stage.motions) next[m.row][m.col] = null;
    for (const m of stage.motions) {
      const p = this.pieces[m.row][m.col];
      if (!p) continue;
      p.x = LEFT + m.col * CELL; p.y = yForRow(m.row);
      p.path = { x: p.x, y: p.y, toX: p.x, toY: yForRow(m.to), start: now + (m.delay - previous) * ROW_MS,
        duration: ROW_MS * (m.to - m.row) };
      next[m.to][m.col] = p;
    }
    this.pieces = next;
    this.reedY = yForRow(stage.reed) + REED_OFFSET;
    this.reedPath = { x: 0, y: yForRow(previous) + REED_OFFSET, toX: 0, toY: this.reedY,
      start: now, duration: ROW_MS * (stage.reed - previous) };
  }

  private clear(groups: Group[], now: number): void {
    for (const group of groups) {
      const x = Math.round(group.cells.reduce((sum, [, col]) => sum + LEFT + col * CELL, 0) / group.cells.length);
      const y = Math.round(group.cells.reduce((sum, [row]) => sum + yForRow(row), 0) / group.cells.length);
      let nearest: Thread | null = null, nearestDistance = Infinity;
      for (const [row, col] of group.cells) {
        const p = this.pieces[row][col];
        if (p) {
          p.x = LEFT + col * CELL; p.y = yForRow(row);
          const distance = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (distance < nearestDistance) { nearest = p; nearestDistance = distance; }
          p.path = { x: p.x, y: p.y, toX: x, toY: y, start: now, duration: COLLAPSE_MS };
        }
      }
      if (nearest) nearest.aboveReed = true;
      this.at(now + COLLAPSE_MS, () => {
        for (const [row, col] of group.cells) this.pieces[row][col] = null;
        this.effects.push({ colour: group.colour, x, y, start: now + COLLAPSE_MS, toX: 11 + 23 - 17,
          toY: 11 + Math.round(80 * (1 - this.meter)),
          particles: group.cells.map(() => [(0.3 + this.random() * 0.5) * (this.random() < 0.5 ? -1 : 1), -(0.3 + this.random() * 0.5)]) });
      });
      if (group.cells.length > 8) this.say('Looming Large!', x + CELL / 2, y + CELL / 2, now, false, true);
    }
  }

  private finish(booched: boolean, now: number, onDone: (at: number) => void): void {
    this.fadeOut = now;
    this.lockUntil = Infinity;
    if (booched) this.say('Ye Booched It!', 225, 300, now);
    this.sound(booched ? 'game_over_booch' : 'game_over');
    this.at(now + FADE_MS, () => onDone(now + FADE_MS));
  }
  private say(text: string, x: number, y: number, start: number, yellow = false, small = false): void {
    this.messages.push({ text, x, y, start, yellow, small });
  }

  draw(now: number): void {
    const { screen, images } = this;
    const ctx = screen.ctx;
    screen.blit(images.get('background'), 0, 0);
    const alpha = Math.min(clamp01((now - this.fadeIn) / FADE_MS), 1 - clamp01((now - this.fadeOut) / FADE_MS));
    const reedY = this.reedPath ? position(this.reedPath, now)[1] : this.reedY;
    for (let col = 0; col < 10; col++) screen.blit(images.get('warp_thread'), LEFT + 14 + col * CELL, 167, { alpha: alpha * 255 });
    screen.blit(images.get('reed_bottom'), 0, reedY, { area: [450 * this.reedFrame, 0, 450, 79] });
    if (this.woodPath && now < this.woodPath.start + this.woodPath.duration) {
      const [x, y] = position(this.woodPath, now);
      screen.blit(images.get('shuttle'), x, y, { flipX: !this.enteringLeft });
    }
    const shuttle = this.shuttlePath ? position(this.shuttlePath, now) : [this.shuttleX, SHUTTLE_Y];
    if (now >= this.shakeAt && now < this.shakeAt + ROW_MS) {
      const jitter = Math.sin(Math.floor(now) * 127.1) * 43758.5453;
      shuttle[0] = this.shuttleX + Math.floor((jitter - Math.floor(jitter)) * 35) - 17;
    }
    for (let row = 0; row < 11; row++) for (let col = 0; col < 10; col++) {
      const p = this.pieces[row][col];
      if (!p || p.aboveReed) continue;
      let [x, y] = p.path ? position(p.path, now) : [p.x, p.y];
      if (row === 0 && !p.path) { x = shuttle[0] + (col - this.offset) * CELL; y = shuttle[1]; }
      screen.blit(images.get('pieces'), x, y, { area: [p.colour * CELL, 0, CELL, CELL], alpha: alpha * 255 });
    }
    const meterY = Math.round(80 * (1 - this.meter));
    ctx.save(); ctx.beginPath(); ctx.rect(11, 11 + meterY, 47, 80 - meterY); ctx.clip();
    screen.blit(images.get('bolt'), 11, 11); screen.blit(images.get('bolt_rim'), 11, 11 + meterY); ctx.restore();
    for (let row = 0; row < 11; row++) for (let col = 0; col < 10; col++) {
      const p = this.pieces[row][col];
      if (!p || !p.stars) continue;
      let [x, y] = p.path ? position(p.path, now) : [p.x, p.y];
      if (row === 0 && !p.path) { x = shuttle[0] + (col - this.offset) * CELL; y = shuttle[1]; }
      // One corner expires after each batten; surviving sparkles loop at 10 fps.
      for (let corner = 4 - p.stars; corner < 4; corner++) {
        screen.blit(images.get('sparklies'), x + Math.round((0.5 + corner % 2) * CELL / 2) - 25,
          y + Math.round((corner < 2 ? 0.5 : 1.5) * CELL / 2) - 25,
          { area: [Math.floor((now - this.fadeIn) / 100) % 16 * 50, 0, 50, 50], alpha: alpha * 255 });
      }
    }
    screen.blit(images.get('reed_top'), 0, reedY, { area: [450 * this.reedFrame, 0, 450, 79] });
    for (const row of this.pieces) for (const p of row) if (p?.aboveReed) {
      const [x, y] = p.path ? position(p.path, now) : [p.x, p.y];
      screen.blit(images.get('pieces'), x, y, { area: [p.colour * CELL, 0, CELL, CELL], alpha: alpha * 255 });
    }
    this.effects = this.effects.filter(effect => now - effect.start < FLY_MS);
    for (const e of this.effects) {
      const age = Math.max(0, now - e.start);
      const t = clamp01(age / FLY_MS);
      const x = e.x + Math.trunc((e.toX - e.x) * t), y = e.y + Math.trunc((e.toY - e.y) * t);
      ctx.save(); ctx.translate(x + CELL / 2, y + CELL / 2); ctx.rotate(-Math.PI * 2 * t);
      const scale = 1 - Math.max(0, age - 80) / 400;
      ctx.scale(scale, scale); ctx.imageSmoothingEnabled = true;
      ctx.drawImage(images.get('sparks'), e.colour * 60, 0, 60, 60, -17, -17, 60, 60); ctx.restore();
      if (age < PARTICLE_MS) for (const [vx, vy] of e.particles) {
        screen.blit(images.get('sparks'), e.x + Math.trunc(vx * age), e.y + Math.trunc(vy * age + 0.00002 * age * age),
          { area: [e.colour * 60, 0, 60, 60], alpha: Math.max(0.1, 1 - age / PARTICLE_MS) * 255 });
      }
    }
    this.messages = this.messages.filter(message => now - message.start < 1500);
    for (const m of this.messages) {
      // Chains and Booched use the 52px board font; large groups are 30px.
      const { dy, alpha } = floatAt(Math.max(0, now - m.start));
      const style = { px: m.small ? 30 : BOARD_FONT, fill: m.yellow ? TEXT_YELLOW : TEXT_WHITE, align: 'center' as const };
      drawGameText(ctx, m.text, m.x, m.y - gameTextBox(ctx, m.text, style).h / 2 + dy, { ...style, alpha });
    }
  }
}
