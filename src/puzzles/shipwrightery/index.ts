import { seedControls } from '../../core/seeds';
import { Images } from '../../core/assets';
import { getWarningTimer, SoundBank } from '../../core/audio';
import { drawGameText, drawPauseLabel, floatAt, gameFont, gameTextBox, loadGameFont } from '../../core/game-text';
import { historyGroup } from '../../core/history';
import { SessionPause } from '../../core/pause';
import { ReplayRecorder, stateText, type ReplaySettingsCodec } from '../../core/replay';
import type { PuzzleFactory } from '../../core/puzzle';
import type { Point, InputEvent } from '../../core/input';
import type { Pattern, Cell } from './logic';
import { positionLabel, type LabelRect } from './presentation';
import {
  ShipSession, ShipBoard, STYLES, SWAP_MS, DIAGONAL_MS, FLASH_MS, GROW_MS,
  RETREAT_MS, CHAIN_WORDS, scoreWord, inBounds,
} from './logic';
import { keyMatches } from '../../core/controls';
import { copyText, pasteText } from '../../core/clipboard';
import { MATERIAL_NAMES, SLOTS, boardCode, boardIssues, cardChoices, fill as fillBoard, load as loadBoard, paint as paintSquare, readBoardCode, setCard } from './create';

const imageUrls = import.meta.glob<string>('./media/*.png', { eager: true, query: '?url', import: 'default' });
const soundUrls = import.meta.glob<string>('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' });
const BX = 95, BY = 52, CELL = 60, PX = 95, PY = 359, CARD = 100;
const TILE = [1, 0, 3, 2, 4];
const COLORS = ['#ffffff', '#fff9d9', '#fff7bd', '#feef9b', '#ffea76', '#97c4c8', '#bde9ed', '#e7fdff'];
const same = (a: Cell | null, b: Cell | null) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
const posOf = (cell: Cell): Point => [BX + CELL * cell[0], BY + CELL * cell[1]];
function boardAt(pos: Point): Cell | null {
  const x = Math.floor((pos[0] - BX) / CELL), y = Math.floor((pos[1] - BY) / CELL);
  return inBounds(x, y) ? [x, y] : null;
}
function slotAt(pos: Point): number {
  const x = Math.floor((pos[0] - PX) / CARD), y = Math.floor((pos[1] - PY) / CARD);
  return x >= 0 && x < 3 && y >= 0 && y < 2 ? y * 3 + x : -1;
}
interface MoveAnim { cell: Cell; type: number; x: number; y: number; start: number; ms: number }
interface PlacementAnim { pattern: Pattern; slot: number; at: Cell; old: number[]; start: number; restored: number }
interface Falling { pattern: Pattern; slot: number; start: number; ms: number }
interface Message extends LabelRect { value: string; size: number; start: number; color: string }
const difficulties = STYLES.map((style, value) => ({ value, label: value === 0 ? '0 — Tutorial' :
  `${value} — ${style.counts.map((count, tier) => `${count} × ${tier + 3}`).join(', ')} pieces${style.gold ? `; ${Math.round(style.gold * 100)}% gold` : ''}` }));
type Mode = 'normal' | 'create';
const MODES: { value: Mode; label: string }[] = [{ value: 'normal', label: 'Normal' }, { value: 'create', label: 'Freeplay' }];
/** Freeplay mode paints with keys 1-5 held over the board: wood, iron, rope, cloth, gold. */
const PAINT_KEYS = MATERIAL_NAMES.map((name, material) => ({ id: `paint${material + 1}`, label: `Paint ${name.toLowerCase()} (Freeplay)`, defaultKey: String(material + 1), material }));
const codec: ReplaySettingsCodec = {
  currentVersion: 1, simulatorVersion: 2,
  migrate(version, value) {
    if (version !== 1 || !value || typeof value !== 'object') return null;
    // Replays saved before Freeplay mode existed are Normal.
    const { difficulty, mode = 'normal' } = value as { difficulty: unknown; mode?: unknown };
    return Number.isInteger(difficulty) && Number(difficulty) >= 0 && Number(difficulty) <= 8 && (mode === 'normal' || mode === 'create') ? { difficulty, mode } : null;
  },
};

export default (async ({ screen, panel, store, input, ticks: rawTicks, setReplayTime: rawReplayTime }) => {
  const images = await Images.load(imageUrls);
  await loadGameFont();
  const pause = new SessionPause(rawTicks, rawReplayTime);
  const ticks = pause.ticks;
  const ctx = screen.ctx;
  const whitePieces = document.createElement('canvas');
  whitePieces.width = 300; whitePieces.height = 60;
  const whiteContext = whitePieces.getContext('2d')!;
  whiteContext.drawImage(images.get('pieces'), 0, 0);
  whiteContext.globalCompositeOperation = 'source-in';
  whiteContext.fillStyle = '#fff'; whiteContext.fillRect(0, 0, 300, 60);
  let replays!: ReplayRecorder;
  const sounds = new SoundBank(soundUrls, () => !!replays && (replays.isSeeking || replays.isAdvancing));
  let difficulty = Math.max(0, Math.min(8, Math.trunc(store.get('difficulty', 8))));
  let mode: Mode = store.get<Mode>('mode', 'normal') === 'create' ? 'create' : 'normal';
  let savedSettings: { difficulty: number; mode: Mode } | null = null;
  /** Freeplay mode: the palette material a left click places (recorded, so replays click the same way), the key held, and pasted-text errors. */
  let paletteMaterial: number | null = null;
  let paintWith: number | null = null;
  let pasteNote = '';
  let session: ShipSession | null = null;
  let preview = new ShipBoard(difficulty, 42);
  let selected: Cell | null = null, held = -1;
  let dragging = false, dragged = false;
  let lastPointer: Point = [-1, -1];
  let moves: MoveAnim[] = [], placements: PlacementAnim[] = [], falling: Falling[] = [], messages: Message[] = [];
  let finishAt = Infinity, saved = false, outcome = '';
  let flagFrom = 249, flagTarget = 249, flagAt = 0, flagMs = 0;
  const historyKey = () => `difficulty:${difficulty}`;
  const creating = () => running() && !!session?.create;
  const board = () => session?.board ?? preview;
  const running = () => !!session && !session.finished;
  const format = (n: number) => n.toFixed(2);
  const average = () => session && session.board.completed ? session.score / session.board.completed : 0;

  function flagY(now: number): number {
    return flagFrom + (flagTarget - flagFrom) * (flagMs ? Math.min(1, Math.max(0, (now - flagAt) / flagMs)) : 1);
  }
  const seedMode = seedControls(panel, store, () => running() || !!replays?.isPlaying);

  function start(seed = seedMode.next()): void { seedMode.remember(seed);
    pause.resume();
    session = new ShipSession(difficulty, seed, ticks(), mode === 'create', true);
    selected = null; held = -1; dragging = dragged = false;
    paletteMaterial = null; paintWith = null; pasteNote = '';
    moves = []; placements = []; falling = []; messages = [];
    finishAt = Infinity; saved = false; outcome = '';
    flagFrom = flagTarget = 249; flagAt = ticks(); flagMs = 0;
    replays?.begin({ difficulty, mode }, seed);
  }
  function showPreview(): void {
    session = null; selected = null; held = -1; dragging = false; saved = false; outcome = '';
    moves = []; placements = []; messages = []; falling = [];
    flagFrom = flagTarget = 249; flagMs = 0;
    preview = new ShipBoard(difficulty, 42);
  }
  function saveResult(result: string): void {
    if (!session || saved) return;
    saved = true; outcome = result;
    const tape = replays.finish(result);
    // Freeplay is a sandbox and keeps no history.
    if (!replays.isPlaying && !session.create) store.addHistory(historyKey(), {
      score: session.score, average: average(), patterns: session.board.completed,
      swaps: session.swaps, combo: session.bestCombo, gold: session.goldUsed, lost: session.lost, result,
      ...(tape ? { replayAt: tape.at, replayId: tape.runId ?? '' } : {}),
    });
  }
  function stop(): void {
    if (!session || session.finished) return;
    pause.resume(); replays.command('stop');
    session.finish(false); session.events.length = 0;
    selected = null; held = -1; dragging = false;
    finishAt = ticks(); saveResult('Stopped');
  }
  function moving(cell: Cell, now: number): boolean {
    return moves.some(s => now < s.start + s.ms && same(s.cell, cell));
  }
  function position(cell: Cell, now: number): Point {
    const move = moves.find(m => same(m.cell, cell));
    const [x, y] = posOf(cell);
    if (!move) return [x, y];
    const t = Math.min(1, (now - move.start) / move.ms);
    return [move.x + (x - move.x) * t, move.y + (y - move.y) * t];
  }
  function movable(cell: Cell, now: number): boolean {
    if (moving(cell, now)) return false;
    return [-1, 0, 1].some(dx => [-1, 0, 1].some(dy => board().canSwap(cell, [cell[0] + dx, cell[1] + dy])));
  }
  function message(value: string, x: number, y: number, size: number, color: string, now: number): Message {
    const { w: width, h: height } = gameTextBox(ctx, value, { px: size });
    const obstacles = messages.filter(m => now < m.start + 1500).map(m => ({ ...m, y: m.y + floatAt(now - m.start).dy }));
    const rect = positionLabel({ x: x - width / 2, y: y - height / 2, width, height }, obstacles);
    const label = { ...rect, value, size, color, start: now };
    messages.push(label);
    return label;
  }
  function swap(to: Cell, now: number, drag: boolean): void {
    if (!session || !selected) return;
    const from = selected, ta = board().get(...from), tb = board().get(...to);
    if (session.swap(from, to, now)) {
      const [ax, ay] = position(from, now), [bx, by] = position(to, now);
      const ms = from[0] !== to[0] && from[1] !== to[1] ? DIAGONAL_MS : SWAP_MS;
      moves = moves.filter(m => !same(m.cell, from) && !same(m.cell, to));
      moves.push({ cell: to, type: ta, x: ax, y: ay, start: now, ms },
        { cell: from, type: tb, x: bx, y: by, start: now, ms });
      selected = drag ? to : null;
      if (drag) dragged = true;
      sounds.play('swap');
    } else if (!drag && movable(to, now)) selected = to;
  }
  function click(pos: Point, now: number): void {
    if (!session?.canAct(now)) return;
    const at = boardAt(pos), slot = slotAt(pos);
    if (held >= 0) {
      if (!at) { held = slot < board().numAvailable && slot !== held ? slot : -1; return; }
      const pattern = board().available[held], old = [...board().cells], placedSlot = held, previous = board().numAvailable;
      const points = session.place(placedSlot, at, now);
      if (!points) return;
      placements.push({ pattern, slot: placedSlot, at, old, start: now, restored: board().numAvailable - previous });
      const combo = board().combo;
      const chain = CHAIN_WORDS[Math.min(6, combo)] ?? '';
      const color = COLORS[(combo - 1) % COLORS.length];
      let chainHeight = 0;
      if (chain) {
        const label = message(chain, 245, 202, gameFont(combo - 1), color, now);
        chainHeight = label.height;
        if (combo > 6) message(String(combo - 5), label.x + label.width + 12, label.y - label.height / 6 + 25, gameFont(Math.min(5, combo - 1) - 2), color, now);
      }
      message(scoreWord(points), 245, 202 + chainHeight, 30, color, now);
      const chainSounds = ['chain_single', 'chain_double', 'chain_triple', 'chain_quadruple', 'chain_five', 'chain_six'];
      sounds.play(board().completed === board().goal ? 'finished_main' : chainSounds[Math.min(combo, 6) - 1]);
      flagFrom = flagY(now); flagTarget = 249 - Math.floor(Math.min(1, board().completed / board().goal) * 240);
      flagAt = now; flagMs = Math.abs(flagTarget - flagFrom) * 20;
      held = -1; selected = null;
    } else if (slot >= 0 && slot < board().numAvailable) {
      held = slot; selected = null;
    } else if (at && !board().endGame) {
      if (same(selected, at)) selected = null;
      else if (selected) swap(at, now, false);
      else if (movable(at, now)) selected = at;
    }
  }
  /** Freeplay mode: a recorded change, applied now and again at the same moment in a replay. */
  function createCommand(command: string): void {
    if (!session || !creating()) return;
    const b = session.board;
    if (command.startsWith('palette:')) {
      const material = Number(command.slice(8));
      paletteMaterial = material >= 0 ? material : null;
      return;
    }
    if (!session.canAct(ticks()) || held >= 0) return;
    if (command.startsWith('fill:')) fillBoard(b, Number(command.slice(5)));
    else if (command.startsWith('card:')) {
      const [slot, id] = command.slice(5).split(',');
      setCard(b, Number(slot), id);
    } else if (command.startsWith('load:')) {
      const read = readBoardCode(command.slice(5));
      if (read) loadBoard(b, read);
    } else if (command === 'generate') {
      const fresh = new ShipBoard(difficulty, b.random.next(31));
      b.cells = fresh.cells; b.available = fresh.available; b.numAvailable = fresh.numAvailable;
      b.pile = fresh.pile; b.pileTotal = fresh.pileTotal; b.combo = 0;
    }
    selected = null;
  }
  const record = (command: string) => {
    if (!creating() || replays.isPlaying || pause.paused) return;
    replays.command(command);
    createCommand(command);
  };
  /** Paints the square under the pointer; recorded input repeats it in a replay. */
  function paintAt(pos: Point, material: number, now: number): void {
    const at = boardAt(pos);
    if (!at || !session?.canAct(now) || held >= 0 || moving(at, now)) return;
    if (paintSquare(session.board, at[0], at[1], material)) selected = null;
  }

  function update(now: number): void {
    if (!session) return;
    session.update(now);
    for (const event of session.events.splice(0)) {
      if (event.type === 'warning' && getWarningTimer()) sounds.play('timer_warning');
      if (event.type === 'expired') {
        falling.push({ pattern: board().available[event.slot], slot: event.slot, start: now,
          ms: Math.abs(600 - (PY + Math.floor(event.slot / 3) * CARD)) * RETREAT_MS / 200 });
        if (held >= board().numAvailable) held = -1;
        sounds.play('pattern_break');
      }
      if (event.type === 'finish') {
        held = -1; selected = null; dragging = false;
        finishAt = now + RETREAT_MS;
        for (let i = 0; i < board().numAvailable; i++) falling.push({ pattern: board().available[i], slot: i, start: now,
          ms: Math.abs(600 - (PY + Math.floor(i / 3) * CARD)) * RETREAT_MS / 200 });
        sounds.play(event.failed ? 'booched' : 'finished_puzzle');
      }
    }
    if (session.finished && now >= finishAt) saveResult(session.failed ? 'Washed out' : 'Finished');
    moves = moves.filter(s => now < s.start + s.ms);
    placements = placements.filter(p => now < p.start + FLASH_MS + GROW_MS + 600);
    falling = falling.filter(p => now < p.start + p.ms);
    messages = messages.filter(m => now < m.start + 1500);
  }
  function tile(type: number, x: number, y: number, small = false, scale = 1, alpha = 1, white = 0): void {
    if (type < 0 || scale <= 0 || alpha <= 0) return;
    const size = small ? 24 : CELL;
    ctx.save(); ctx.globalAlpha = alpha;
    if (scale !== 1) ctx.imageSmoothingEnabled = true;
    const dx = x + size * (1 - scale) / 2, dy = y + size * (1 - scale) / 2;
    ctx.drawImage(images.get(small ? 'pieces_small' : 'pieces'), TILE[type] * size, 0, size, size, dx, dy, size * scale, size * scale);
    if (white > 0) {
      ctx.globalAlpha = alpha * white;
      ctx.drawImage(whitePieces, TILE[type] * 60, 0, 60, 60, dx, dy, size * scale, size * scale);
    }
    ctx.restore();
  }
  /** Outlined game-font text centred on (x, y); pattern names are #B5CAEF. */
  function text(value: string, x: number, y: number, px: number, color = '#b5caef', alpha = 1): void {
    const style = { px, fill: color, align: 'center' as const, alpha };
    drawGameText(ctx, value, x, y - gameTextBox(ctx, value, style).h / 2, style);
  }
  function card(pattern: Pattern, slot: number, scale = 1, offsetY = 0, name = true, shake: Cell = [0, 0]): void {
    const left = PX + (slot % 3) * CARD + 2 + shake[0], top = PY + Math.floor(slot / 3) * CARD + 2 + offsetY + shake[1];
    const xs = pattern.cells.map(([, x]) => x), ys = pattern.cells.map(([, , y]) => y);
    const sx = (4 - (Math.max(0, ...xs) + 1 + Math.min(0, ...xs))) * 12;
    const sy = (4 - (Math.max(0, ...ys) + 1 + Math.min(0, ...ys))) * 12;
    ctx.save(); ctx.translate(left + 48, top + 48); ctx.scale(scale, scale); ctx.translate(-48, -48);
    if (scale !== 1) ctx.imageSmoothingEnabled = true;
    for (const [t, x, y] of pattern.cells) tile(t, sx + x * 24, sy + y * 24, true);
    if (name) text(pattern.id[0].toUpperCase() + pattern.id.slice(1), 48, 48, 24);
    ctx.restore();
  }
  function draw(now: number, mouse: Point): void {
    screen.blit(images.get('background'), 0, 0);
    // The water is behind the sprites and frame. Five independently phased strips animate at 10 fps.
    const tide = session ? session.finished ? Math.min(1, (now - (finishAt - RETREAT_MS)) / RETREAT_MS) : session.tide(now) : 0;
    const waterY = Math.floor(357 + (1 - tide) * 200);
    for (let x = 0; x < 5; x++) screen.blit(images.get('waves'), x * 90, waterY,
      { area: [((Math.floor(now / 100) + [0, 3, 6, 2, 5][x]) % 7) * 90, 0, 90, 43] });
    for (let x = 0; x < 450; x += 9) screen.blit(images.get('water'), x, waterY + 43);
    const b = board();
    const placement = placements.find(p => now < p.start + FLASH_MS + GROW_MS);
    const activeMoves = moves.filter(s => now < s.start + s.ms);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      if (activeMoves.some(s => same(s.cell, [x, y]))) continue;
      const matches = placement?.pattern.cells.some(([, dx, dy]) => placement.at[0] + dx === x && placement.at[1] + dy === y);
      const age = placement ? now - placement.start : 0;
      const type = matches && age < FLASH_MS ? placement!.old[x * 5 + y] : b.get(x, y);
      const scale = matches && age >= FLASH_MS ? Math.min(1, (age - FLASH_MS) / GROW_MS) : 1;
      tile(type, BX + x * CELL, BY + y * CELL, false, scale, 1, matches && age < FLASH_MS ? 0.75 * age / FLASH_MS : 0);
    }
    for (const move of activeMoves) {
      const [x, y] = position(move.cell, now);
      const matches = placement?.pattern.cells.some(([, dx, dy]) => placement.at[0] + dx === move.cell[0] && placement.at[1] + dy === move.cell[1]);
      tile(move.type, x, y, false, 1, 1, matches ? 0.75 * Math.min(1, (now - placement!.start) / FLASH_MS) : 0);
    }
    if (selected && !moving(selected, now)) screen.blit(images.get('cursor'), ...posOf(selected));
    if (!session?.finished) for (let i = 0; i < b.numAvailable; i++) {
      if (i === held) continue;
      const growing = placement && (i === placement.slot || (placement.restored && i >= b.numAvailable - placement.restored));
      const age = placement ? now - placement.start - FLASH_MS : GROW_MS;
      const scale = !session ? 1 : growing ? Math.max(0, Math.min(1, age / GROW_MS)) : Math.min(1, (now - session.started) / GROW_MS);
      const progress = session?.progress(now) ?? 0;
      const jitter = !session?.overtime && ((progress >= 0.8 && progress < 0.8 + 500 / 75000) || progress >= 0.9);
      const sample = Math.floor(now / 100) + i * 37;
      const shake: Cell = jitter ? [(sample * 13 + i) % 3 - 1, (sample * 7 + i * 2) % 3 - 1] : [0, 0];
      card(b.available[i], i, scale, 0, scale === 1, shake);
    }
    for (const p of falling) card(p.pattern, p.slot, 1, (now - p.start) / p.ms * (600 - (PY + Math.floor(p.slot / 3) * CARD)), false);
    screen.blit(images.get('flag'), 0, flagY(now), { area: [(Math.floor(now / 100) % 10) * 70, 0, 70, 58] });
    for (const p of placements) {
      const age = now - p.start - FLASH_MS;
      if (age < 0 || age > 600) continue;
      const t = age / 600;
      for (const [, x, y] of p.pattern.cells) for (let n = 0; n < 5; n++) {
        const angle = n * Math.PI * 2 / 5;
        const radius = 10 + 0.05 * age - 0.5 * 8.333333E-5 * age * age;
        screen.blit(images.get('sparks'), BX + (p.at[0] + x) * CELL + 30 - 19 + Math.sin(angle) * radius,
          BY + (p.at[1] + y) * CELL + 30 - 19 - Math.cos(angle) * radius, { area: [0, 0, 39, 39], alpha: Math.floor(255 * Math.max(0.1, 1 - t)) });
      }
    }
    screen.blit(images.get('frame'), 88, 45);
    for (const m of messages) {
      const { dy, alpha } = floatAt(now - m.start);
      text(m.value, m.x + m.width / 2, m.y + m.height / 2 + dy, m.size, m.color, alpha);
    }
    if (held >= 0 && held < b.numAvailable) {
      for (const [t, x, y] of b.available[held].cells) tile(t, mouse[0] + x * CELL - 30, mouse[1] + y * CELL - 30, false, 1, 0.7);
    }
    if (!session) {
      ctx.fillStyle = '#0009'; ctx.fillRect(110, 161, 270, 80);
      text('Shipwrightery', 245, 185, 36, '#fff2be');
      drawGameText(ctx, mode === 'create' ? 'Start, then paint any board' : 'Press Start to begin', 245, 210, { px: 18, family: 'dialog', bold: true, align: 'center' });
    }
    if (pause.paused) {
      ctx.fillStyle = '#000a'; ctx.fillRect(95, 52, 300, 300);
      drawPauseLabel(ctx, 'Paused', 245, 202, 300);
    }
    replays.drawOverlay(ctx);
  }
  function frame(events: InputEvent[]): void {
    const filtered = pause.input(events, 'shipwrightery', running());
    if (!filtered) { draw(ticks(), input.mouse); return; }
    const routed = replays.frame(filtered, input.mouse, ticks());
    const now = ticks();
    if (!routed.renderOnly) {
      update(now);
      for (const command of routed.commands) {
        if (command === 'stop') stop();
        else createCommand(command);
      }
      if (creating() && paintWith !== null && !same(lastPointer, routed.mouse)) paintAt(routed.mouse, paintWith, now);
      for (const event of routed.events) {
        const paintKey = creating() && (event.type === 'keydown' || event.type === 'keyup') ? PAINT_KEYS.find((k) => keyMatches(event.key, 'shipwrightery', k.id, k.defaultKey)) : undefined;
        if (paintKey) {
          if (event.type === 'keydown') { paintWith = paintKey.material; paintAt(routed.mouse, paintKey.material, now); }
          else if (paintWith === paintKey.material) paintWith = null;
          continue;
        }
        if (creating() && event.type === 'mousedown' && event.button === 1 && paletteMaterial !== null && boardAt(event.pos)) {
          paintAt(event.pos, paletteMaterial, now); dragging = true; dragged = false; lastPointer = [...event.pos];
          continue;
        }
        if (creating() && event.type === 'mousedown' && (event.button === 4 || event.button === 5)) {
          // The wheel cycles the material under the pointer.
          const at = boardAt(event.pos);
          if (at && session) paintAt(event.pos, (session.board.get(...at) + (event.button === 4 ? 1 : 4)) % 5, now);
          continue;
        }
        if (event.type === 'keydown' && event.key === 'r' && !replays.isPlaying) {
          if (running()) stop(); start();
        }
        if (event.type === 'mousedown' && event.button === 3) held = -1;
        if (event.type === 'mousedown' && event.button === 1) {
          click(event.pos, now); dragging = true; dragged = false; lastPointer = [...event.pos];
        }
        if (event.type === 'mouseup' && event.button === 1) {
          if (dragged) selected = null;
          dragging = dragged = false;
        }
      }
      if (creating() && dragging && paletteMaterial !== null && held < 0 && !same(lastPointer, routed.mouse)) paintAt(routed.mouse, paletteMaterial, now);
      else if (dragging && held < 0 && selected && !same(lastPointer, routed.mouse)) {
        const at = boardAt(routed.mouse);
        if (at && !same(selected, at)) {
          const [x, y] = position(at, now);
          if (Math.abs(routed.mouse[0] - (x + 30)) <= 21 && Math.abs(routed.mouse[1] - (y + 30)) <= 21) swap(at, now, true);
        }
      }
      lastPointer = [...routed.mouse];
    }
    if (!replays.isSeeking && !replays.isAdvancing) draw(now, routed.mouse);
  }

  const controls = panel.session();
  controls.select('Mode', MODES, () => mode, value => {
    mode = value; store.set('mode', value); showPreview();
  }, { disabled: () => running() || !!replays?.isPlaying });
  panel.settings.group('Game').select('Difficulty', difficulties, () => difficulty, value => {
    difficulty = value; store.set('difficulty', value); showPreview();
  }, { disabled: () => running() || !!replays?.isPlaying });
  controls.button('Start', () => {
    if (replays.isPlaying) replays.stop();
    if (running()) stop(); else start();
  }, { variant: 'primary', label: () => running() ? 'Stop' : 'Start' });
  pause.install(panel, running);
  panel.clock(() => !session || session.finished || !Number.isFinite(session.deadline) ? null : { label: session.overtime ? 'Overtime' : 'Until tide',
    ms: Math.max(0, session.deadline - ticks()), countdown: true,
    warn: session.warning > 0 || session.overtime });
  panel.score().stats(['', 'Now'], () => [['Points', String(session?.score ?? 0)]]);
  // The board's text can be copied in any mode, and pasted, dealt anew or painted while playing in Freeplay.
  const createOnly = () => mode !== 'create';
  const editing = () => !creating() || !session?.canAct(ticks()) || held >= 0 || pause.paused || !!replays?.isPlaying;
  const boardGroup = panel.group('Board');
  boardGroup.button('Copy', () => copyText(boardCode(board()), 'Copy this board:'), { title: 'Copy the board and its pattern cards' });
  boardGroup.button('Paste', () => void pasteText('Paste a board:').then((text) => {
    if (text === null) return;
    if (readBoardCode(text)) { pasteNote = ''; record(`load:${text.trim()}`); }
    else pasteNote = 'That isn’t a shipwrightery board. Boards copied here start with W.';
  }), { hidden: createOnly, disabled: editing, title: 'Play a board from a pasted copy' });
  boardGroup.button('Generate', () => { record('generate'); copyText(boardCode(board()), 'Copy this board:'); },
    { hidden: createOnly, disabled: editing, title: 'Deal a new board and cards and copy them' });
  const palette = document.createElement('div');
  palette.className = 'piece-palette';
  MATERIAL_NAMES.forEach((name, material) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-button';
    const icon = document.createElement('canvas');
    icon.width = icon.height = CELL;
    icon.setAttribute('aria-hidden', 'true');
    icon.getContext('2d')!.drawImage(images.get('pieces'), TILE[material] * CELL, 0, CELL, CELL, 0, 0, CELL, CELL);
    button.append(icon, document.createTextNode(`${material + 1} · ${name}`));
    button.addEventListener('click', () => { record(`palette:${paletteMaterial === material ? -1 : material}`); panel.used(); });
    panel.addSync(() => {
      button.disabled = !creating() || !!replays?.isPlaying;
      button.setAttribute('aria-pressed', String(paletteMaterial === material));
    });
    palette.append(button);
  });
  boardGroup.append(palette, { hidden: createOnly });
  boardGroup.button('Fill board', () => record(`fill:${paletteMaterial ?? 0}`), { hidden: createOnly, disabled: editing, title: 'Make every square the selected material' });
  /** A pattern's pieces, centred in a square just big enough for them, for the card picker. */
  function patternIcon(pattern: Pattern | undefined): HTMLCanvasElement {
    const icon = document.createElement('canvas');
    icon.setAttribute('aria-hidden', 'true');
    const xs = pattern?.cells.map(([, x]) => x) ?? [0], ys = pattern?.cells.map(([, , y]) => y) ?? [0];
    const w = Math.max(...xs) - Math.min(...xs) + 1, h = Math.max(...ys) - Math.min(...ys) + 1, side = Math.max(w, h, 3);
    icon.width = icon.height = side * 24;
    const left = (side - w) * 12 - Math.min(...xs) * 24, top = (side - h) * 12 - Math.min(...ys) * 24;
    const g = icon.getContext('2d')!;
    for (const [t, x, y] of pattern?.cells ?? []) g.drawImage(images.get('pieces_small'), TILE[t] * 24, 0, 24, 24, left + x * 24, top + y * 24, 24, 24);
    return icon;
  }
  const patternName = (p: Pattern) => p.id[0].toUpperCase() + p.id.slice(1);
  /** The card the picker below changes. */
  let cardSlot = 0;
  const slotRow = document.createElement('div');
  slotRow.className = 'piece-palette card-slots';
  for (let slot = 0; slot < SLOTS; slot++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-button';
    let shown: Pattern | undefined | null = null;
    button.addEventListener('click', () => { cardSlot = slot; panel.used(); });
    panel.addSync(() => {
      const pattern = board().available[slot];
      if (pattern !== shown) {
        shown = pattern;
        button.replaceChildren(patternIcon(pattern), document.createTextNode(`Card ${slot + 1}`));
        button.title = pattern ? patternName(pattern) : '';
      }
      button.hidden = slot >= board().numAvailable;
      button.setAttribute('aria-pressed', String(cardSlot === slot));
    });
    slotRow.append(button);
  }
  boardGroup.append(slotRow, { hidden: createOnly });
  const patternGrid = document.createElement('div');
  patternGrid.className = 'piece-palette card-patterns';
  let gridKey = '';
  let gridButtons: { pattern: Pattern; button: HTMLButtonElement }[] = [];
  panel.addSync(() => {
    if (cardSlot >= board().numAvailable) cardSlot = 0;
    const key = `${difficulty}:${cardSlot}`;
    if (key !== gridKey) {
      gridKey = key;
      gridButtons = cardChoices(difficulty, cardSlot).map((pattern) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'panel-button';
        button.append(patternIcon(pattern), document.createTextNode(patternName(pattern)));
        button.addEventListener('click', () => { record(`card:${cardSlot},${pattern.id}`); panel.used(); });
        return { pattern, button };
      });
      patternGrid.replaceChildren(...gridButtons.map(({ button }) => button));
    }
    const b = board();
    for (const { pattern, button } of gridButtons) {
      const elsewhere = b.available.some((p, i) => i !== cardSlot && i < b.numAvailable && p === pattern);
      button.disabled = editing() || elsewhere;
      button.title = elsewhere ? 'Already on another card' : '';
      button.setAttribute('aria-pressed', String(b.available[cardSlot] === pattern));
    }
  });
  boardGroup.append(patternGrid, { hidden: createOnly });
  boardGroup.note(() => pasteNote, { hidden: createOnly });
  boardGroup.note(() => {
    const issues = boardIssues(board(), difficulty);
    return issues.length ? `Not a board the game could deal: ${issues.join(' ')}` : '';
  }, { hidden: () => createOnly() || !running() });
  panel.controls('shipwrightery', PAINT_KEYS.map(({ id, label, defaultKey }) => ({ id, label, defaultKey })));
  panel.settings.group('Rules').hint(() => 'The tide takes 75 seconds. Each placement resets it; at 20 patterns, finish your combo during 15 seconds of overtime. Tutorial: three patterns, no tide and two seconds of overtime. Gold is fixed and matches any material.');
  panel.settings.group('Scoring').hint(() => 'Pattern points and combo multipliers follow the game. Points / pattern is the raw average. Ocean-wide ratings and difficulty adjustments are unavailable; no estimated rating is assigned.');
  historyGroup(panel, () => store.history(historyKey()), [
    { label: 'Points', value: g => String(g.score) }, { label: '/ pattern', value: g => format(Number(g.average)) },
    { label: 'Combo', value: g => String(g.combo) }, { label: 'Result', value: g => String(g.result) },
  ], 'Past games', undefined, false);
  panel.results(() => !saved ? null : { title: outcome, rows: [
    ['Points', String(session?.score ?? 0)], ['Points / pattern', format(average())],
    ['Patterns placed', String(board().completed)], ['Best combo', String(session?.bestCombo ?? 0)], ['Swaps', String(session?.swaps ?? 0)],
  ] });
  replays = new ReplayRecorder('shipwrightery', store, panel, ticks, tape => {
    savedSettings ??= { difficulty, mode };
    ({ difficulty, mode } = tape.settings as { difficulty: number; mode: Mode });
    start(tape.seed as number);
  }, () => {
    if (savedSettings !== null) { ({ difficulty, mode } = savedSettings); savedSettings = null; }
    showPreview();
  }, seed => Number.isSafeInteger(seed), pause.setReplayTime, () => frame([]), codec, () => !running() || replays.isPlaying);
  replays.setStopLive(stop);
  // Taken over, the replay's settings are the game's: the player's own aren't put back afterwards.
  replays.onTakeOver = () => { savedSettings = null; };
  // What decides how the game goes on; replays check it after every recorded input.
  replays.fingerprint = () => stateText(session, selected, held, dragging, dragged, finishAt, saved, outcome);
  return { frame, dispose() { replays.dispose(); sounds.dispose(); } };
}) satisfies PuzzleFactory;
