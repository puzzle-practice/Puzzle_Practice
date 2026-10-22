import { seedControls } from '../../core/seeds';
import { Images } from '../../core/assets';
import { SoundBank } from '../../core/audio';
import { copyText, pasteText } from '../../core/clipboard';
import { keyMatches } from '../../core/controls';
import { drawGameText, drawPauseLabel, floatAt, gameFont, gameTextBox, loadGameFont } from '../../core/game-text';
import { historyGroup } from '../../core/history';
import type { InputEvent, Point } from '../../core/input';
import { SessionPause } from '../../core/pause';
import type { PuzzleFactory } from '../../core/puzzle';
import { ReplayRecorder, stateText, type ReplaySettingsCodec } from '../../core/replay';
import { BoardRandom } from '../forage/board';
import { AlchemyBoard, Bottle, colorOf, hasInlet, valid, withColor, MAX_LAYERS, MIN_LAYERS, OVERLAP, GOALS, type Cell, type Drop, type FillGroup } from './logic';
import { Art, position, cellAt, bottleX, slotPosition, ROTATE_MS, DRAIN_STEP_MS, SQUIRT_MS, FADE_MS,
  BELT_MS, BOTTLE_FLIGHT_MS, TEXT_MS, type Drain } from './presentation';
import { addLabel, boardCode, boardIssues, BULBS, bulbOrder, cycleBottle, fill as fillBoard, LABEL_COLORS, LABEL_NAMES, load as loadBoard, makePiece,
  paint as paintSquare, readBoardCode, removeLabel, setBulbs, SHAPE_NAMES, SHAPES, SPECIAL_NAMES } from './create';

const imageUrls = import.meta.glob<string>('./media/*.png', { eager: true, query: '?url', import: 'default' });
const soundUrls = import.meta.glob<string>('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' });
const difficulties = GOALS.map((goal, value) => ({ value,
  label: `${value} — ${value < 2 ? '2' : '3'} primaries; ${MIN_LAYERS[value]}${MAX_LAYERS[value] === MIN_LAYERS[value] ? '' : `–${MAX_LAYERS[value]}`} color${MAX_LAYERS[value] > 1 ? 's' : ''} per bottle; ${goal} bottles`,
}));
const homo = ['', '', 'Double bottle!', 'Triple bottle!', 'Quadruple bottle!', 'Five bottles!', 'Bingo!', 'Donkey!', 'Vegas!', 'Potent Potions!', 'Witch Doctor!', 'Voodoo!'];
const multi = ['', '', 'Double-Double!', 'Toil & Trouble!', 'Fire Burn!', 'Cauldron Bubble!', 'Wicked!', 'Transmutation!'];
type Mode = 'normal' | 'create';
const codec: ReplaySettingsCodec = { currentVersion: 1, simulatorVersion: 2, migrate(version, value) {
  if (version !== 1 || !value || typeof value !== 'object') return null;
  // Replays saved before Freeplay mode existed are Normal.
  const { difficulty, mode = 'normal' } = value as { difficulty: unknown; mode?: unknown };
  return Number.isInteger(difficulty) && Number(difficulty) >= 0 && Number(difficulty) <= 8 && (mode === 'normal' || mode === 'create') ? { difficulty, mode } : null;
} };
/** Freeplay mode paints the single tubes with keys 1-9, 0 and - held over the board, and adds bottle labels with their colors' initials. */
const SHAPE_KEYS = SHAPE_NAMES.slice(0, 11).map((name, shape) => ({ id: `paint${shape + 1}`, label: `Paint ${name.toLowerCase()} (Freeplay)`, defaultKey: '1234567890-'[shape], shape }));
const LABEL_KEYS = LABEL_COLORS.map(color => ({ id: `label${color}`, label: `Add ${LABEL_NAMES[color].toLowerCase()} label (Freeplay)`, defaultKey: LABEL_NAMES[color][0].toLowerCase(), color }));
const bottleAt = ([px, py]: Point) => py >= 480 && py < 555 ? Array.from({ length: 11 }, (_, x) => x).find(x => px >= bottleX(x) && px < bottleX(x) + 36) ?? -1 : -1;
interface Message { text: string; start: number; x: number; y: number; color: string; size: number; sound?: string; duration: number }
interface Squirt { x: number; color: number; start: number }
interface Flight { bottle: Bottle; x: number; slot: number; start: number }
interface Break { image: HTMLCanvasElement; x: number; start: number; velocities: Cell[] }
interface Spark { x: number; y: number; start: number; color: number; frame: number; vx: number; vy: number }
interface GroupAnimation { group: FillGroup; start: number; pour: number; change: number; end: number; applied: boolean; sounded: boolean }
interface Rotation { x: number; y: number; piece: number; start: number; clockwise: boolean }

export default (async ({ screen, input, panel, store, ticks: rawTicks, setReplayTime: rawReplayTime }) => {
  const images = await Images.load(imageUrls);
  await loadGameFont();
  const ctx = screen.ctx, art = new Art(images, ctx), pause = new SessionPause(rawTicks, rawReplayTime), ticks = pause.ticks;
  let replays!: ReplayRecorder;
  const sounds = new SoundBank(soundUrls, () => !!replays && (replays.isSeeking || replays.isAdvancing));
  let difficulty = Math.max(0, Math.min(8, Math.trunc(store.get('difficulty', 4)) || 0));
  let mode: Mode = store.get<Mode>('mode', 'normal') === 'create' ? 'create' : 'normal', liveMode: Mode = 'normal';
  let savedSettings: { difficulty: number; mode: Mode } | null = null;
  /** Freeplay mode: the palette choice a left click places (recorded, so replays click the same way), the special painted pieces get, the key held, the board before the last fill, and pasted-text errors. */
  let paletteShape: number | null = null, paletteLabel: number | null = null, paintSpecial = 0, paintWith: number | null = null, painting = false;
  let setup: { code: string; finished: Bottle[] } | null = null, pasteNote = '';
  let board = new AlchemyBoard(difficulty, 42);
  let running = false, saved = false, outcome = '';
  let startAt = 0, endedAt = 0, fills = 0, broken = 0, labels = 0, bestFill = 0;
  let selected: Cell = [2, 3], lastMouse: Point = [-1, -1];
  let rotation: Rotation | null = null;
  let viewCells = [...board.cells], viewColors = [...board.colors], viewBottles = board.bottles.map(b => b.clone());
  let beltFrom: number[] = [], beltAt = -Infinity;
  let shownFinished: Bottle[] = [];
  let groupAnims: GroupAnimation[] = [], drains: Drain[] = [], squirts: Squirt[] = [], flights: Flight[] = [], breaks: Break[] = [], messages: Message[] = [];
  let drops: Drop[] = [], dropAt = -Infinity, clearAt = Infinity, refillAt = Infinity, settledAt = Infinity, finishAt = Infinity, gleamAt = -Infinity;
  let allConnected = new Set<number>();
  let fxRandom = new BoardRandom(42), sparks: Spark[] = [];
  const active = () => running;
  const busy = (now = ticks()) => groupAnims.length > 0 || now < settledAt || rotation !== null;
  const historyKey = () => `difficulty:${difficulty}`;
  const creating = () => running && liveMode === 'create';

  function reset(seed: number): void {
    pause.resume();
    board = new AlchemyBoard(difficulty, seed, true);
    art.clear(); fxRandom = new BoardRandom(seed ^ 0x71ac5); sparks = [];
    selected = [2, 3]; lastMouse = [-1, -1]; rotation = null;
    viewCells = [...board.cells]; viewColors = [...board.colors]; viewBottles = board.bottles.map(b => b.clone());
    groupAnims = []; drains = []; squirts = []; flights = []; breaks = []; messages = []; drops = [];
    shownFinished = []; allConnected.clear(); beltFrom = []; beltAt = -Infinity;
    clearAt = refillAt = finishAt = Infinity; settledAt = ticks() + BELT_MS; gleamAt = -Infinity; dropAt = -Infinity;
    startAt = ticks(); endedAt = 0; fills = broken = labels = bestFill = 0; saved = false; outcome = '';
    beltFrom = viewBottles.map((_, x) => -bottleX(11 - x)); beltAt = ticks();
  }
  const seedMode = seedControls(panel, store, () => running || !!replays?.isPlaying);

  function start(seed = seedMode.next()): void { seedMode.remember(seed);
    reset(seed); running = true; liveMode = mode; replays?.begin({ difficulty, mode }, seed);
    paletteShape = paletteLabel = paintWith = null; paintSpecial = 0; painting = false; setup = null; pasteNote = '';
  }
  function preview(): void { reset(42); running = false; settledAt = 0; beltAt = -Infinity; }
  function save(result: string): void {
    if (saved) return;
    saved = true; running = false; outcome = result; endedAt = ticks();
    const tape = replays.finish(result);
    // Freeplay is a sandbox and keeps no history.
    if (!replays.isPlaying && liveMode !== 'create') store.addHistory(historyKey(), {
      score: board.score, bottles: board.finished.length, fills, broken, labels, bestFill, result,
      ...(tape ? { replayAt: tape.at, replayId: tape.runId ?? '' } : {}),
    });
  }
  function stop(): void {
    if (!running) return;
    replays.command('stop'); pause.resume();
    groupAnims = []; drains = []; squirts = []; flights = []; drops = []; rotation = null;
    clearAt = refillAt = finishAt = Infinity; settledAt = 0;
    viewCells = [...board.cells]; viewColors = [...board.colors]; viewBottles = board.bottles.map(b => b.clone());
    shownFinished = [...board.finished]; save('Stopped');
  }
  function rotate(clockwise: boolean, now: number): void {
    if (!running || busy(now)) return;
    const [x, y] = selected, piece = board.get(x, y);
    const wasColored = [colorOf(piece), colorOf(piece, 1)];
    if (!board.rotate(x, y, clockwise)) return;
    rotation = { x, y, piece, start: now, clockwise };
    viewCells = [...board.cells];
    sounds.play(clockwise ? 'rotate_cw' : 'rotate_ccw');
    const next = board.get(x, y);
    if (wasColored.some((c, t) => c === 0 && colorOf(next, t) !== 0)) sounds.play('connect_path');
  }
  function addMessage(text: string, start: number, y: number, color: string, size: number, sound?: string, x = 225, duration = TEXT_MS): void {
    messages.push({ text, start, x, y, color, size, sound, duration });
  }
  function fill(now: number): void {
    if (!running || busy(now) || !board.connected) return;
    fills++;
    const originalBottles = [...board.bottles];
    const oldFinished = board.finished.length;
    allConnected = new Set(board.paths.flat().map(n => n.y * 11 + n.x));
    if (creating()) setup = { code: boardCode(board), finished: [...board.finished] };
    const groups = board.fill();
    // Freeplay never finishes: filled slots stay filled and play carries on.
    if (creating()) board.done = false;
    const distinct = new Set<number>();
    let time = now, totalLabels = 0;
    for (const group of groups) {
      const pour = time + (Math.max(0, ...group.path.map(n => n.depth)) + 1) * DRAIN_STEP_MS;
      const bottleResults = group.results.filter(r => r.type >= 2 && r.type <= 4);
      const change = pour + (bottleResults.length ? SQUIRT_MS : 0);
      for (const node of group.path) {
        const start = time + node.depth * DRAIN_STEP_MS;
        drains.push({ node, start });
        if (fxRandom.nextInt(100) < 50) {
          const count = 1 + fxRandom.nextInt(3), [x, y] = position(node.x, node.y);
          for (let i = 0; i < count; i++) sparks.push({ x: x + 23, y: y + 23, start: start + DRAIN_STEP_MS,
            color: colorOf(viewCells[node.y * 11 + node.x], node.tube), frame: fxRandom.nextInt(2),
            vx: (.06 + fxRandom.nextFloat() * .04) * (fxRandom.nextInt(2) ? 1 : -1), vy: -(.07 + fxRandom.nextFloat() * .05) });
        }
      }
      for (const result of bottleResults) {
        squirts.push({ x: result.x, color: result.color, start: pour });
        if (result.type === 2) broken++; else totalLabels++;
      }
      let messageAt = change, lastMessage = change;
      for (const result of group.results) {
        if (result.type < 5) continue;
        messageAt += 200; lastMessage = messageAt + TEXT_MS;
        addMessage(result.type === 5 ? 'Quicksilver!' : result.type === 6 ? 'Bonus!' : 'Multifill!', messageAt, position(result.x, result.y)[1], result.type === 5 ? '#ffff00' : '#ffffff', result.type === 6 ? 30 : 24, 'special_piece', Math.max(60, Math.min(390, position(result.x, result.y)[0] + 23)));
      }
      const count = bottleResults.filter(r => r.type === 3 || r.type === 4).length;
      if (count > 1) {
        messageAt += 500; lastMessage = messageAt + TEXT_MS;
        addMessage(homo[Math.min(11, count)], messageAt, 350, '#fff', gameFont(1 + Math.floor(count / 3)),
          count <= 2 ? 'flask_fill' : count <= 5 ? 'flask_multi_fill' : 'flask_ultimate_fill');
      }
      if (count) {
        if (distinct.size && !distinct.has(group.color)) {
          distinct.add(group.color); messageAt += 500; lastMessage = messageAt + TEXT_MS;
          addMessage(multi[distinct.size], messageAt, 250, '#ffff00', gameFont(2 + Math.floor(distinct.size / 2)), ['','','double_color','triple_color','bingo_color','donkey_color','vegas_color','vegas_color'][distinct.size]);
        } else distinct.add(group.color);
      }
      groupAnims.push({ group, start: time, pour, change, end: lastMessage, applied: false, sounded: false });
      time = lastMessage;
    }
    labels += totalLabels; bestFill = Math.max(bestFill, totalLabels);
    for (const anim of groupAnims) {
      for (const result of anim.group.results) if (result.type === 4 && result.extra === 1 && result.bottle) {
        flights.push({ bottle: result.bottle, x: result.x, slot: board.finished.indexOf(result.bottle), start: anim.change });
      }
    }
    // Retain each original bottle until its own squirt completes.
    for (const anim of groupAnims) for (const result of anim.group.results) if (result.type >= 2 && result.type <= 4) result.bottle ??= originalBottles[result.x];
    if (board.done) {
      finishAt = time + 3000;
      addMessage('Finished!', time, 250, '#fff', 42, undefined, 225, 3000);
      settledAt = finishAt;
    } else {
      clearAt = time; refillAt = time + FADE_MS; settledAt = Infinity;
    }
    // The highest-valued bottles occupy the remaining completion slots.
    shownFinished = board.finished.slice(0, oldFinished);
  }
  function update(now: number): void {
    if (rotation && now >= rotation.start + ROTATE_MS) rotation = null;
    for (const anim of groupAnims) {
      if (now >= anim.start && !anim.sounded) { anim.sounded = true; sounds.play('fill'); }
      if (now >= anim.change && !anim.applied) {
        anim.applied = true;
        for (const result of anim.group.results) {
          if (result.type < 2 || result.type > 4 || !result.bottle) continue;
          const previous = viewBottles[result.x];
          viewBottles[result.x] = result.bottle.clone();
          if (result.type === 2) {
            breaks.push({ image: art.bottleImage(previous), x: result.x, start: anim.change,
              velocities: Array.from({ length: 9 }, (_, part) => [fxRandom.nextFloat() * .16 * (part % 3 < 1 ? -1 : 1), -fxRandom.nextFloat() * .16]) });
            sounds.play('breaking_bottle');
          }
        }
        viewColors = [...board.colors];
      }
    }
    for (const message of messages) if (message.sound && now >= message.start) { sounds.play(message.sound); message.sound = undefined; }
    for (const flight of flights) if (now >= flight.start + BOTTLE_FLIGHT_MS) shownFinished[flight.slot] = flight.bottle;
    if (now >= refillAt) {
      const when = refillAt;
      const remaining = viewBottles.filter(b => !b.full);
      beltFrom = board.bottles.map((_, x) => x < 11 - remaining.length ? -bottleX(11 - remaining.length - x) : bottleX(viewBottles.indexOf(remaining[x - (11 - remaining.length)])));
      beltAt = when; viewBottles = board.bottles.map(b => b.clone());
      shownFinished = [...board.finished];
      drops = board.refill(); dropAt = when;
      viewCells = [...board.cells]; viewColors = [...board.colors];
      settledAt = when + Math.max(0, ...drops.map(d => Math.trunc(Math.abs(d.to - d.from) * 43 / 0.525)));
      refillAt = Infinity; clearAt = Infinity; drains = []; groupAnims = [];
      if (beltFrom.some((x, i) => x !== bottleX(i))) sounds.play('conveyer_action');
      if (board.booched && !creating()) { finishAt = settledAt + 1500; addMessage('Booched Brew!', settledAt, 250, '#fff', gameFont(1)); }
    }
    if (now >= finishAt && running) save(board.booched ? 'Booched Brew' : 'Finished');
    if (now >= settledAt) { drops = []; if (!running) settledAt = 0; }
    messages = messages.filter(m => now < m.start + m.duration);
    sparks = sparks.filter(s => now < s.start + 400);
  }
  /** Freeplay mode: shows an edit straight away. */
  function edited(): void {
    viewCells = [...board.cells]; viewColors = [...board.colors]; viewBottles = board.bottles.map(b => b.clone());
    shownFinished = [...board.finished];
  }
  /** Freeplay mode: a recorded change, applied now and again at the same moment in a replay. */
  function createCommand(command: string, now: number): void {
    if (!creating()) return;
    const [name, value = ''] = command.split(':', 2) as [string, string?];
    if (name === 'palette') {
      paletteShape = value.startsWith('s') ? Number(value.slice(1)) : null;
      paletteLabel = value.startsWith('l') ? Number(value.slice(1)) : null;
      return;
    }
    if (name === 'special') { paintSpecial = Number(value); return; }
    if (busy(now)) return;
    if (name === 'bulbs') setBulbs(board, Number(value));
    else if (name === 'fill-board') fillBoard(board, paletteShape ?? 0, paintSpecial);
    else if (name === 'load' || name === 'generate' || name === 'undo') {
      const code = name === 'load' ? command.slice(5) : name === 'undo' ? setup?.code ?? '' : boardCode(new AlchemyBoard(difficulty, board.rng.nextInt(0x7fffffff)));
      const read = readBoardCode(code);
      if (!read) return;
      if (read.difficulty !== board.difficulty) { difficulty = read.difficulty; board = new AlchemyBoard(difficulty, board.rng.nextInt(0x7fffffff)); }
      loadBoard(board, read);
      board.finished = name === 'undo' && setup ? [...setup.finished] : name === 'undo' ? board.finished : [];
      board.done = false; board.lastCell = [-1, -1];
    } else return;
    edited();
  }
  const record = (command: string) => {
    if (!creating() || replays.isPlaying || pause.paused) return;
    replays.command(command);
    createCommand(command, ticks());
  };
  function paintAt(at: Cell | null, shape: number, now: number): void {
    if (at && !busy(now) && paintSquare(board, at[0], at[1], shape, paintSpecial)) edited();
  }
  /** Freeplay mode: the bottle edits from the pointer and keys. */
  function editBottle(x: number, change: (x: number) => boolean, now: number): boolean {
    if (x < 0 || busy(now)) return false;
    if (change(x)) edited();
    return true;
  }
  function text(value: string, x: number, y: number, size: number, color: string, alpha = 1): void {
    const style = { px: size, fill: color, align: 'center' as const, alpha };
    drawGameText(ctx, value, x, y - gameTextBox(ctx, value, style).h / 2, style);
  }
  function draw(now: number): void {
    art.draw('background', 0, 0);
    art.draw('title', (450 - images.get('title').width) / 2, 0);
    art.bulbs(viewColors);
    ctx.save(); ctx.fillStyle = '#ffffff'; ctx.globalAlpha = .45;
    const [sx, sy] = position(...selected);
    ctx.beginPath(); ctx.ellipse(sx + 23, sy + 21.5, 23, 21.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(16, 62, 420, 433); ctx.clip();
    const quickNodes = board.paths.filter(path => path.length && colorOf(board.get(path[0].x, path[0].y), path[0].tube) === 9).flat();
    for (let y = 0; y < 10; y++) for (let x = 0; x < 11; x++) {
      if (!valid(x, y)) continue;
      let piece = viewCells[y * 11 + x];
      let [px, py] = position(x, y), angle = 0;
      if (rotation && x === rotation.x && y === rotation.y) {
        piece = rotation.piece;
        angle = Math.floor(Math.max(0, now - rotation.start) / 20) * Math.PI / 9 * (rotation.clockwise ? 1 : -1);
      }
      const drop = drops.find(d => d.x === x && d.to === y);
      if (drop) {
        const duration = Math.trunc(Math.abs(drop.to - drop.from) * 43 / 0.525);
        const t = Math.min(1, Math.max(0, (now - dropAt) / duration));
        py = position(x, drop.from)[1] + (py - position(x, drop.from)[1]) * t;
        piece = withColor(withColor(drop.piece, 0, 0), 1, 0);
      }
      ctx.save();
      if (now >= clearAt && allConnected.has(y * 11 + x)) ctx.globalAlpha = Math.max(0, 1 - (now - clearAt) / FADE_MS);
      const quickIndex = quickNodes.findIndex(n => n.x === x && n.y === y);
      const quickTime = quickIndex < 0 ? -1 : (now % (quickNodes.length * 15 + 250)) - quickIndex * 15;
      art.piece(piece, px, py, angle, drains.filter(d => d.node.x === x && d.node.y === y), now,
        !groupAnims.length && !drops.length && quickTime >= 0 && quickTime < 250 ? quickTime / 250 : 0);
      ctx.restore();
    }
    ctx.restore();
    for (let x = 0; x < 11; x++) {
      const piece = viewCells[(x % 2 === 0 ? 8 : 9) * 11 + x];
      const color = hasInlet(piece, 0, 3) ? colorOf(piece) : hasInlet(piece, 1, 3) ? colorOf(piece, 1) : 0;
      const emptied = groupAnims.length && squirts.some(s => s.x === x && now >= s.start);
      art.draw('spout', 28 + 37 * x, x % 2 === 0 ? 469 : 490, 0, 14, 11, emptied || drops.length ? 0 : color);
    }
    for (let x = 0; x < 11; x++) {
      const inFlight = flights.some(f => f.x === x && now >= f.start && now < refillAt);
      if (inFlight && groupAnims.length) continue;
      const t = Math.min(1, Math.max(0, (now - beltAt) / BELT_MS));
      const from = beltFrom[x] ?? bottleX(x), px = from + (bottleX(x) - from) * t;
      art.bottle(viewBottles[x], px);
      if (now >= gleamAt && now < gleamAt + 1500 && viewBottles[x].value > 12 && !viewBottles[x].broken) {
        const frame = Math.floor((now - gleamAt + x * 25) / 85) % 16;
        art.draw('star_twinkle', px - 7, 490 + (x % 3) * 10, frame, 50, 50);
      }
    }
    for (const squirt of squirts) if (now >= squirt.start && now < squirt.start + SQUIRT_MS) {
      art.draw(squirt.x % 2 === 0 ? 'squirt' : 'squirt_sm', bottleX(squirt.x) + 11, 480,
        Math.min(8, Math.floor((now - squirt.start) / 50)), 14, 75, squirt.color);
    }
    for (const flight of flights) if (now >= flight.start && now < flight.start + BOTTLE_FLIGHT_MS) {
      const t = (now - flight.start) / BOTTLE_FLIGHT_MS, [tx, ty] = slotPosition(flight.slot);
      art.bottle(flight.bottle, bottleX(flight.x) + (tx - 9 - bottleX(flight.x)) * t, 480 + (ty - 51 - 480) * t);
    }
    for (let slot = 0; slot < board.goal; slot++) art.small(shownFinished[slot] ?? null, slot);
    for (const b of breaks) if (now < b.start + 700) {
      const ms = now - b.start;
      ctx.save(); ctx.globalAlpha = Math.max(.1, 1 - ms / 700);
      for (let part = 0; part < 9; part++) {
        const x = bottleX(b.x) + (part % 3) * 12 + Math.trunc(b.velocities[part][0] * ms);
        const y = 480 + Math.floor(part / 3) * 25 + Math.trunc(b.velocities[part][1] * ms + .5 * .00004 * ms * ms);
        ctx.drawImage(b.image, (part % 3) * 12, Math.floor(part / 3) * 25, 12, 25, x, y, 12, 25);
      }
      ctx.restore();
    }
    const workingBelt = now >= beltAt && now < beltAt + 1000;
    if (workingBelt) {
      const frame = Math.floor((now - beltAt) / 111) % 3;
      art.draw('rat_run', 383, 571, frame, 49, 23);
      art.draw('gears_left_turning', 5, 567, Math.floor((now - beltAt) / 166) % 3, 24, 27);
      art.draw('gears_right_turning', 432, 568, Math.floor((now - beltAt) / 166) % 3, 14, 27);
    } else if (board.done && now >= finishAt - 3000) { art.draw('rat_done', 383, 571); art.draw('cheese', 407, 584); }
    else art.draw('rat_still', 383, 571);
    const canFill = running && !busy(now) && board.connected;
    art.draw('fill_button', 39, 566, canFill ? 0 : 2, 46, 27);
    for (const spark of sparks) if (now >= spark.start && now < spark.start + 400) {
      const ms = now - spark.start;
      ctx.save(); ctx.globalAlpha = Math.max(.1, 1 - ms / 400);
      art.draw('star_chunks', spark.x + Math.trunc(spark.vx * ms), spark.y + Math.trunc(spark.vy * ms + .5 * .00004 * ms * ms), spark.frame, 28, 28, spark.color);
      ctx.restore();
    }
    for (const message of messages) if (now >= message.start && now < message.start + message.duration) {
      const { dy, alpha } = floatAt(now - message.start, message.duration);
      text(message.text, message.x, message.y + dy, message.size, message.color, alpha);
    }
    if (!running && !saved) drawPauseLabel(ctx, 'Press Start', 225, 270, 416);
    if (pause.paused) { ctx.fillStyle = '#0007'; ctx.fillRect(17, 84, 416, 387); drawPauseLabel(ctx, 'Paused', 225, 277, 416); }
    replays.drawOverlay(ctx);
  }
  function frame(events: InputEvent[]): void {
    const filtered = pause.input(events, 'alchemistry', active());
    if (!filtered) { draw(ticks()); return; }
    const routed = replays.frame(filtered, input.mouse, ticks()), now = ticks();
    if (!routed.renderOnly) {
      update(now);
      for (const command of routed.commands) { if (command === 'stop') stop(); else if (command === 'fill') fill(now); else createCommand(command, now); }
      if (routed.mouse[0] !== lastMouse[0] || routed.mouse[1] !== lastMouse[1]) {
        const at = cellAt(routed.mouse); if (at) selected = at;
        lastMouse = [...routed.mouse];
        const shape = paintWith ?? (painting ? paletteShape : null);
        if (creating() && shape !== null) paintAt(at, shape, now);
      }
      for (const event of routed.events) {
        if (creating()) {
          const key = event.type === 'keydown' || event.type === 'keyup' ? event.key : '';
          const shapeKey = key ? SHAPE_KEYS.find(k => keyMatches(key, 'alchemistry', k.id, k.defaultKey)) : undefined;
          const labelKey = key ? LABEL_KEYS.find(k => keyMatches(key, 'alchemistry', k.id, k.defaultKey)) : undefined;
          if (shapeKey) {
            if (event.type === 'keyup') { if (paintWith === shapeKey.shape) paintWith = null; }
            else { paintWith = shapeKey.shape; paintAt(cellAt(routed.mouse), shapeKey.shape, now); }
            continue;
          }
          if (labelKey) {
            if (event.type === 'keydown') editBottle(bottleAt(routed.mouse), x => addLabel(board, x, labelKey.color), now);
            continue;
          }
          if (event.type === 'mousedown' && event.button === 1 && paletteShape !== null && cellAt(event.pos)) {
            painting = true; paintAt(cellAt(event.pos), paletteShape, now); continue;
          }
          if (event.type === 'mouseup' && event.button === 1 && painting) { painting = false; continue; }
          if (event.type === 'mouseup' && (event.button === 1 || event.button === 3) && bottleAt(event.pos) >= 0) {
            const x = bottleAt(event.pos);
            editBottle(x, event.button === 3 ? x => removeLabel(board, x) : paletteLabel !== null ? x => addLabel(board, x, paletteLabel!) : x => cycleBottle(board, x), now);
            continue;
          }
        }
        if (event.type === 'mouseup' || event.type === 'mousedown' && [4, 5].includes(event.button)) {
          const at = cellAt(event.pos);
          if (at) { selected = at; rotate(event.button !== 1 && event.button !== 4, now); }
          else if (event.type === 'mouseup' && event.button === 1) {
            if (event.pos[0] >= 39 && event.pos[0] < 85 && event.pos[1] >= 566 && event.pos[1] < 593) fill(now);
            else if (event.pos[1] >= 480 && event.pos[1] < 555) gleamAt = now;
          }
        } else if (event.type === 'keydown') {
          if (keyMatches(event.key, 'alchemistry', 'fill', 'space')) fill(now);
          else if (keyMatches(event.key, 'alchemistry', 'clockwise', 'x')) rotate(true, now);
          else if (keyMatches(event.key, 'alchemistry', 'anticlockwise', 'z')) rotate(false, now);
          else {
            const offsets: Record<string, Cell> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
            const offset = offsets[event.key];
            if (offset) { const x = Math.max(0, selected[0] + offset[0]), y = Math.max(0, selected[1] + offset[1]); if (valid(x, y)) selected = [x, y]; }
          }
        }
      }
    }
    if (!replays.isSeeking && !replays.isAdvancing) draw(now);
  }
  const controls = panel.session();
  controls.select('Mode', [{ value: 'normal', label: 'Normal' }, { value: 'create', label: 'Freeplay' }], () => mode, value => {
    mode = value as Mode; store.set('mode', value); preview();
  }, { disabled: () => running || !!replays?.isPlaying });
  panel.settings.group('Game').select('Difficulty', difficulties, () => difficulty, value => {
    difficulty = value; store.set('difficulty', value); preview();
  }, { disabled: () => running || !!replays?.isPlaying });
  controls.button('Start', () => {
    if (replays.isPlaying) { replays.stop(); start(); }
    else if (running) stop(); else start();
  }, { variant: 'primary', label: () => replays?.isPlaying ? 'Start' : running ? 'Stop' : 'Start' });
  pause.install(panel, active);
  panel.controlSettings.group().button('Fill bottles', () => { replays.command('fill'); fill(ticks()); }, { disabled: () => !running || busy() || !board.connected || pause.paused || replays.isPlaying });
  panel.clock(() => running || saved ? { label: 'Session time', ms: (running ? ticks() : endedAt) - startAt } : null);
  panel.score().stats(['', 'Now'], () => [['Score', String(board.score)]]);
  const boardGroup = panel.group('Board');
  boardGroup.note(() => running ? busy() ? 'Filling / settling' : board.connected ? 'A path reaches a bottle — ready to fill' : 'Connect the bulbs to the bottles' : outcome || 'Press Start to begin.');
  // The board's text can be copied in any mode, and pasted, dealt anew or painted while playing in Freeplay.
  const createOnly = () => mode !== 'create';
  const editing = () => !creating() || busy() || pause.paused || replays.isPlaying;
  boardGroup.button('Copy', () => copyText(boardCode(board), 'Copy this board:'), { title: 'Copy the board and bottles as text' });
  boardGroup.button('Paste', () => void pasteText('Paste a board:').then(text => {
    if (text === null) return;
    if (readBoardCode(text)) { pasteNote = ''; record(`load:${text.trim()}`); }
    else pasteNote = 'That isn’t an alchemistry board. Boards copied here start with A.';
  }), { hidden: createOnly, disabled: editing, title: 'Play a board from a pasted copy' });
  boardGroup.button('Generate', () => { record('generate'); copyText(boardCode(board), 'Copy this board:'); },
    { hidden: createOnly, disabled: editing, title: 'Deal a new board and bottles and copy them' });
  const palette = document.createElement('div');
  palette.className = 'piece-palette';
  const paletteButton = (label: string, draw: (art: Art) => void, chosen: () => boolean, value: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-button';
    const icon = document.createElement('canvas');
    icon.width = 46; icon.height = 43;
    icon.setAttribute('aria-hidden', 'true');
    draw(new Art(images, icon.getContext('2d')!));
    button.append(icon, document.createTextNode(label));
    button.addEventListener('click', () => { record(`palette:${chosen() ? '-' : value}`); panel.used(); });
    panel.addSync(() => {
      button.disabled = !creating() || replays.isPlaying;
      button.setAttribute('aria-pressed', String(chosen()));
    });
    palette.append(button);
  };
  SHAPES.forEach((_, shape) => paletteButton(`${shape < 11 ? `${SHAPE_KEYS[shape].defaultKey} · ` : ''}${SHAPE_NAMES[shape]}`,
    a => a.piece(makePiece(shape, 0, 0), 0, 0), () => paletteShape === shape, `s${shape}`));
  LABEL_COLORS.forEach(color => paletteButton(`${LABEL_KEYS[color - 2].defaultKey.toUpperCase()} · ${LABEL_NAMES[color]}`,
    a => a.draw('bottles_small', 14, 9, 0, 18, 24, color), () => paletteLabel === color, `l${color}`));
  boardGroup.append(palette, { hidden: createOnly });
  boardGroup.select('Special', SPECIAL_NAMES.map((label, value) => ({ value, label })), () => paintSpecial, value => record(`special:${value}`),
    { hidden: createOnly, disabled: () => !creating() || replays.isPlaying });
  boardGroup.select('Bulbs', BULBS.map((order, value) => ({ value, label: order.slice(0, board.difficulty < 2 ? 2 : 3).map(c => LABEL_NAMES[c]).join(', ') })),
    () => bulbOrder(board), value => record(`bulbs:${value}`), { hidden: createOnly, disabled: editing });
  boardGroup.button('Fill board', () => record('fill-board'), { hidden: createOnly, disabled: editing, title: 'Make every square the selected tube' });
  boardGroup.button('Before last fill', () => record('undo'), { hidden: createOnly, disabled: () => editing() || !setup, title: 'Put the board back as it was before the last fill' });
  boardGroup.note(() => pasteNote || 'Hold 1–9, 0 or - over a square to paint a tube, or select one above and left-click to place it. Select it again to deselect and rotate. Painted tubes keep the turn of what was there and get the chosen special. Over a bottle, hold R, Y, B, O, P or G (or select a label and click) to add a label on top; right-click takes the top label off, and a left click steps through how many labels are filled, then broken. Freeplay never finishes and keeps no history.', { hidden: createOnly });
  boardGroup.note(() => {
    const issues = boardIssues(board);
    return issues.length ? `Not a board the game could deal: ${issues.join(' ')}` : 'This board could come up in the game.';
  }, { hidden: () => createOnly() || !running });
  panel.settings.group('Rules').hint(() => `Difficulty ${difficulty}: ${OVERLAP[difficulty]}% overlapping tubes. Bonus unlocks at 3; multifill at 5; quicksilver at 6. Fill all ${board.goal} slots to finish. Broken bottles stay on the belt.`);
  panel.settings.group('Fidelity notes').hint(() => 'Tube and bottle probabilities, special-piece accumulation and raw scores follow the game. The independent bottle-color shuffle is seeded for replays. Online difficulty assignment and ocean-wide ratings are unavailable. Particle scatter and gleam positions are approximated. See docs/alchemistry.md for remaining questions.');
  panel.settings.group('Colors').hint(() => 'Red + yellow = orange. Red + blue = purple. Yellow + blue = green. Three primaries make brown sludge and break bottles. Quicksilver fills any bottom label.');
  panel.controls('alchemistry', [
    { id: 'fill', label: 'Fill bottles', defaultKey: 'Space' }, { id: 'clockwise', label: 'Rotate clockwise', defaultKey: 'x' },
    { id: 'anticlockwise', label: 'Rotate anticlockwise', defaultKey: 'z' }, { id: 'pause', label: 'Pause', defaultKey: 'Escape' },
    ...[...SHAPE_KEYS, ...LABEL_KEYS].map(({ id, label, defaultKey }) => ({ id, label, defaultKey })),
  ]);
  historyGroup(panel, () => store.history(historyKey()), [
    { label: 'Score', value: g => String(g.score) }, { label: 'Bottles', value: g => String(g.bottles) },
    { label: 'Fills', value: g => String(g.fills) }, { label: 'Result', value: g => String(g.result) },
  ], 'Past games', { available: g => typeof g.replayAt === 'number' && replays.hasPlayableAt(g.replayAt, typeof g.replayId === 'string' ? g.replayId : undefined),
    play: g => { if (typeof g.replayAt === 'number') replays.playAt(g.replayAt, typeof g.replayId === 'string' ? g.replayId : undefined); } }, false);
  panel.results(() => saved && liveMode !== 'create' ? { title: outcome, rows: [['Score', String(board.score)], ['Bottles completed', `${board.finished.length} / ${board.goal}`], ['Fills', String(fills)], ['Broken bottles', String(broken)]] } : null);
  replays = new ReplayRecorder('alchemistry', store, panel, ticks, tape => {
    savedSettings ??= { difficulty, mode }; ({ difficulty, mode } = tape.settings as { difficulty: number; mode: Mode }); start(tape.seed as number);
  }, () => {
    if (savedSettings !== null) { ({ difficulty, mode } = savedSettings); savedSettings = null; } preview();
  }, seed => Number.isSafeInteger(seed), pause.setReplayTime, () => frame([]), codec, () => !running || replays.isPlaying);
  replays.setStopLive(stop);
  // Taken over, the replay's settings are the game's: the player's own aren't put back afterwards.
  replays.onTakeOver = () => { savedSettings = null; };
  // What decides how the game goes on; replays check it after every recorded input.
  replays.fingerprint = () => stateText(board, running, saved, outcome, startAt, fills, broken, labels, bestFill, selected, rotation,
    dropAt, clearAt, refillAt, settledAt, finishAt);
  preview();
  return { frame, dispose() { replays.dispose(); sounds.dispose(); } };
}) satisfies PuzzleFactory;
