import { seedControls } from '../../core/seeds';
import { Images } from '../../core/assets';
import { SoundBank } from '../../core/audio';
import { copyText, pasteText } from '../../core/clipboard';
import { keyMatches } from '../../core/controls';
import { loadGameFont } from '../../core/game-text';
import { historyGroup } from '../../core/history';
import type { InputEvent, Point } from '../../core/input';
import { SessionPause } from '../../core/pause';
import type { PuzzleFactory } from '../../core/puzzle';
import { ReplayRecorder, stateText, type PuzzleReplay, type ReplaySettingsCodec } from '../../core/replay';
import { copyGrid, difficultyInfo, EMPTY, WeaveBoard } from './logic';
import { WeavingView } from './view';
import { CELL, LEFT, REPEAT_DELAY_MS, REPEAT_MS, TOP } from './timing';
import { boardCode, boardIssues, COLOUR_NAMES, fill as fillBoard, load as loadBoard, paint as paintCell, readBoardCode, setShuttle, thread } from './create';

type Mode = 'normal' | 'create';
const MODES: { value: Mode; label: string }[] = [{ value: 'normal', label: 'Normal' }, { value: 'create', label: 'Freeplay' }];
/** Freeplay mode paints with keys 1-4 held over the loom (red, yellow, blue, green) and clears with 0. */
const PAINT_KEYS = [...COLOUR_NAMES.map((name, colour) => ({ id: `paint${colour + 1}`, label: `Paint ${name.toLowerCase()} (Freeplay)`, defaultKey: String(colour + 1), colour })),
  { id: 'paint0', label: 'Clear thread (Freeplay)', defaultKey: '0', colour: -1 }];
const SHUTTLE_OPTIONS = [{ value: EMPTY, label: 'Empty' },
  ...COLOUR_NAMES.map((label, colour) => ({ value: colour, label })),
  ...COLOUR_NAMES.map((label, colour) => ({ value: thread(colour, true), label: `Sparkly ${label.toLowerCase()}` }))];
/** The loom cell under a point, rows 1-10. */
const cellAt = ([x, y]: Point): [number, number] | null => {
  const col = Math.floor((x - LEFT) / CELL), row = Math.floor((y - TOP) / CELL) + 1;
  return col >= 0 && col < 10 && row >= 1 && row < 11 ? [row, col] : null;
};

export default (async ({ screen, input, panel, store, ticks: rawTicks, setReplayTime: rawReplayTime }) => {
  const pause = new SessionPause(rawTicks, rawReplayTime);
  const ticks = pause.ticks;
  const images = await Images.load(import.meta.glob<string>('./media/*.png', { eager: true, query: '?url', import: 'default' }));
  await loadGameFont();
  let replays: ReplayRecorder;
  const sounds = new SoundBank(import.meta.glob<string>('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' }),
    () => replays?.isSeeking ?? false);
  const saved = store.get<number>('difficulty', 0);
  let difficulty = Number.isInteger(saved) && saved >= 0 && saved <= 8 ? saved : 0;
  let savedDifficulty: number | null = null;
  let mode: Mode = store.get<Mode>('mode', 'normal') === 'create' ? 'create' : 'normal';
  let savedMode: Mode | null = null;
  /** Freeplay mode: the palette colour a left click paints (-1 clears, null for none), whether paint sparkles,
   * the key held, the loom before the last batten, and pasted-text errors. Palette choices are recorded. */
  let paletteColour: number | null = null, sparkly = false;
  let paintWith: number | null = null, painting = false;
  let setup: number[][] | null = null;
  let pasteNote = '';
  let board: WeaveBoard | null = null;
  let view: WeavingView | null = null;
  let running = false, finished = false;
  let moves = 0, groups = 0, threads = 0, longestChain = 0, largestGroup = 0;
  let startAt = 0, endAt = 0, result = '';
  let lastMouse: Point = [-1, -1];
  let pressed = false;
  const held = new Map<string, number>();
  const busy = () => running || (replays?.isPlaying ?? false);
  const historyKey = () => `difficulty:${difficulty}`;
  const creating = () => running && !!board && board.goal === Infinity;

  function finish(outcome: string, now = ticks()): void {
    if (!running) return;
    running = false; finished = true; result = outcome; endAt = now; pressed = false;
    held.clear();
    if (outcome === 'Stopped') view = null;
    const tape = replays.finish(`${outcome}: ${groups} groups`);
    // Freeplay is a sandbox and keeps no history.
    if (!replays.isPlaying && board?.goal !== Infinity) store.addHistory(historyKey(), { score: groups, moves, threads, longestChain, largestGroup,
      duration: Math.max(0, now - startAt), outcome,
      ...(tape ? { replayAt: tape.at, replayId: tape.runId ?? '' } : {}) });
  }

  const seedMode = seedControls(panel, store, () => running || !!replays?.isPlaying);

  function start(seed = seedMode.next()): void { seedMode.remember(seed);
    pause.resume();
    board = new WeaveBoard(difficulty, seed);
    if (mode === 'create') board.goal = Infinity;
    paletteColour = null; sparkly = false; paintWith = null; painting = false; setup = null; pasteNote = '';
    moves = 0; groups = 0; threads = 0; longestChain = 0; largestGroup = 0;
    running = true; finished = false; result = ''; pressed = false;
    held.clear();
    startAt = endAt = ticks(); lastMouse = [-1, -1];
    replays.begin({ difficulty, mode }, seed);
    view = new WeavingView(screen, images, name => sounds.play(name), board, startAt, seed ^ 0x57ea9e);
  }

  function batten(): void {
    const now = ticks();
    if (!running || !board || !view?.ready(now)) return;
    if (!board.isBattenable(view.offset)) { view.reject(now); return; }
    moves++;
    if (creating()) setup = copyGrid(board.pieces);
    const resolution = board.batten(view.offset);
    // Freeplay carries on past a booch: repaint the loom or shuttle to go on.
    if (creating()) resolution.booched = false;
    view.batten(resolution, now, (clears, chain) => {
      groups += clears.length;
      threads += clears.reduce((sum, group) => sum + group.cells.length, 0);
      largestGroup = Math.max(largestGroup, ...clears.map(group => group.cells.length));
      longestChain = Math.max(longestChain, chain);
    }, at => finish(resolution.booched ? 'Booched' : 'Bolt complete', at));
  }

  /** Freeplay mode: a recorded change, applied now and again at the same moment in a replay. */
  function createCommand(command: string): void {
    if (!creating() || !board || !view) return;
    if (command.startsWith('palette:')) {
      const colour = Number(command.slice(8));
      paletteColour = colour >= -1 && colour <= 3 ? colour : null;
      return;
    }
    if (command.startsWith('sparkly:')) { sparkly = command === 'sparkly:1'; return; }
    if (!view.ready(ticks())) return;
    if (command.startsWith('fill:')) fillBoard(board, Number(command.slice(5)));
    else if (command.startsWith('shuttle:')) {
      const [slot, p] = command.slice(8).split(',').map(Number);
      setShuttle(board, slot, p);
    } else if (command.startsWith('load:')) {
      const read = readBoardCode(command.slice(5));
      if (read) { loadBoard(board, read); difficulty = read.difficulty; if (!replays.isPlaying) store.set('difficulty', difficulty); }
    } else if (command === 'generate') {
      const fresh = new WeaveBoard(board.difficulty, board.rng.next(31));
      board.pieces = fresh.pieces;
    } else if (command === 'setup') {
      if (setup) board.pieces = copyGrid(setup);
    }
    view.refresh();
  }
  const record = (command: string) => {
    if (!creating() || replays.isPlaying || pause.paused) return;
    replays.command(command);
    createCommand(command);
  };
  /** Paints the loom cell under the pointer; recorded input repeats it in a replay. */
  function paintAt(pos: Point, colour: number, now: number): void {
    const at = cellAt(pos);
    if (!at || !board || !view?.ready(now)) return;
    if (paintCell(board, at[0], at[1], thread(colour, sparkly))) view.refresh();
  }

  function frame(events: InputEvent[]): void {
    const live = pause.input(events, 'weaving', running);
    if (live === null) return;
    const routed = replays.frame(live, input.mouse, ticks());
    input.mouse = routed.mouse;
    const now = ticks();
    if (!routed.renderOnly) {
      view?.advance(now);
      for (const command of routed.commands) {
        if (command === 'stop') finish('Stopped');
        else createCommand(command);
      }
      if (running && view) {
        const moved = input.mouse[0] !== lastMouse[0] || input.mouse[1] !== lastMouse[1];
        if (creating() && moved && (paintWith !== null || (painting && paletteColour !== null))) paintAt(input.mouse, paintWith ?? paletteColour!, now);
        // While painting the loom, the shuttle stays where it is.
        else if (moved &&
          input.mouse[0] >= 0 && input.mouse[0] < 450 && input.mouse[1] >= 0 && input.mouse[1] < 600) {
          view.moveMouse(input.mouse[0], now);
        }
        lastMouse = [...input.mouse];
        const keyAction = (key: string): void => {
          if (keyMatches(key, 'weaving', 'left', 'arrowleft')) view?.moveKey(-1, now);
          else if (keyMatches(key, 'weaving', 'right', 'arrowright')) view?.moveKey(1, now);
          else if (keyMatches(key, 'weaving', 'batten', 'space')) batten();
        };
        for (const event of routed.events) {
          const paintKey = creating() && (event.type === 'keydown' || event.type === 'keyup') ? PAINT_KEYS.find(k => keyMatches(event.key, 'weaving', k.id, k.defaultKey)) : undefined;
          if (paintKey) {
            if (event.type === 'keydown') { paintWith = paintKey.colour; paintAt(input.mouse, paintKey.colour, now); }
            else if (paintWith === paintKey.colour) paintWith = null;
            continue;
          }
          if (creating() && event.type === 'mousedown' && event.button === 1 && paletteColour !== null && cellAt(event.pos)) {
            // With a palette colour selected, clicks on the loom paint instead of battening.
            paintAt(event.pos, paletteColour, now); painting = true;
            continue;
          }
          if (painting && event.type === 'mouseup' && event.button === 1) { painting = false; continue; }
          if (event.type === 'keydown') {
            keyAction(event.key);
            held.set(event.key, now + REPEAT_DELAY_MS);
          } else if (event.type === 'keyup') {
            held.delete(event.key);
          } else if (event.type === 'mousedown' && event.button === 1) {
            pressed = view.ready(now) && event.pos[0] >= 0 && event.pos[0] < 450 && event.pos[1] >= 0 && event.pos[1] < 600;
          } else if (event.type === 'mouseup' && event.button === 1) {
            if (pressed && event.pos[0] >= 0 && event.pos[0] < 450 && event.pos[1] >= 0 && event.pos[1] < 600) {
              view.moveMouse(event.pos[0], now);
              batten();
            }
            pressed = false;
          }
        }
        for (const [key, repeatAt] of held) if (now >= repeatAt) {
          keyAction(key);
          held.set(key, repeatAt + (Math.floor((now - repeatAt) / REPEAT_MS) + 1) * REPEAT_MS);
        }
      }
    }
    if (view) view.draw(now);
    else screen.blit(images.get('background'), 0, 0);
  }

  const session = panel.session();
  const options = Array.from({ length: 9 }, (_, value) => {
    const info = difficultyInfo(value);
    return { value, label: `${value}: ${info.colours} colors${value === 0 ? ', pairs' : ''}${info.gaps ? ', gaps' : ''}${info.special ? ', sparkles' : ''}` };
  });
  session.select('Mode', MODES, () => mode, value => { mode = value; store.set('mode', value); }, { disabled: busy });
  session.note(() => mode === 'create' ? 'Freeplay: paint any loom, no goal' : `${difficultyInfo(difficulty).target} groups per bolt`);
  session.button('Start', () => {
    if (running) { replays.command('stop'); finish('Stopped'); }
    else start();
  }, { variant: 'primary', label: () => running ? 'Stop' : 'Start', disabled: () => replays?.isPlaying ?? false });
  pause.install(panel, () => running);
  panel.clock(() => board ? { label: 'Time', ms: Math.max(0, (running ? ticks() : endAt) - startAt) } : null);
  panel.score('Bolt').stats(['', 'Now'], () => [['Groups', board?.goal === Infinity ? String(groups) : `${groups} / ${board?.info.target ?? difficultyInfo(difficulty).target}`]]);
  panel.controlSettings.group('Controls').hint(() => 'Slide the shuttle with the mouse or Left/Right. Click or press Space to batten. Escape pauses.');
  // The loom's text can be copied in any mode, and pasted, dealt anew or painted while weaving in Freeplay.
  const createOnly = () => mode !== 'create';
  const editing = () => !creating() || !view?.ready(ticks()) || pause.paused || !!replays?.isPlaying;
  const loom = panel.group('Loom');
  loom.button('Copy', () => { if (board) copyText(boardCode(board), 'Copy this loom:'); }, { disabled: () => !board, title: 'Copy the loom and its shuttle' });
  loom.button('Paste', () => void pasteText('Paste a loom:').then(text => {
    if (text === null) return;
    if (readBoardCode(text)) { pasteNote = ''; record(`load:${text.trim()}`); }
    else pasteNote = 'That isn’t a weaving loom. Looms copied here start with L.';
  }), { hidden: createOnly, disabled: editing, title: 'Weave a loom from a pasted copy' });
  loom.button('Generate', () => { record('generate'); if (board) copyText(boardCode(board), 'Copy this loom:'); },
    { hidden: createOnly, disabled: editing, title: 'Lay new threads and copy the loom' });
  const palette = document.createElement('div');
  palette.className = 'piece-palette';
  [...COLOUR_NAMES.map((name, colour) => ({ name, colour, key: String(colour + 1) })), { name: 'Clear', colour: -1, key: '0' }].forEach(({ name, colour, key }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-button';
    const icon = document.createElement('canvas');
    icon.width = icon.height = CELL;
    icon.setAttribute('aria-hidden', 'true');
    if (colour >= 0) icon.getContext('2d')!.drawImage(images.get('pieces'), colour * CELL, 0, CELL, CELL, 0, 0, CELL, CELL);
    button.append(icon, document.createTextNode(`${key} · ${name}`));
    button.addEventListener('click', () => { record(`palette:${paletteColour === colour ? 'none' : colour}`); panel.used(); });
    panel.addSync(() => {
      button.disabled = !creating() || !!replays?.isPlaying;
      button.setAttribute('aria-pressed', String(paletteColour === colour));
    });
    palette.append(button);
  });
  loom.append(palette, { hidden: createOnly });
  loom.select('Sparkles', [{ value: 0, label: 'Plain threads' }, { value: 1, label: 'Sparkly threads' }], () => sparkly ? 1 : 0,
    value => record(`sparkly:${value}`), { hidden: createOnly, disabled: () => !creating() || !!replays?.isPlaying });
  loom.button('Fill loom', () => record(`fill:${thread(paletteColour ?? -1, sparkly)}`), { hidden: createOnly, disabled: editing, title: 'Paint every cell with the selected thread, or clear the loom' });
  for (let slot = 0; slot < 4; slot++) {
    loom.select(`Shuttle ${slot + 1}`, SHUTTLE_OPTIONS, () => board?.shuttle[slot] ?? EMPTY, value => record(`shuttle:${slot},${value}`),
      { hidden: createOnly, disabled: editing });
  }
  loom.button('Before last batten', () => record('setup'), { hidden: createOnly, disabled: () => editing() || !setup, title: 'Put the loom back as it was before the last batten' });
  loom.note(() => pasteNote, { hidden: createOnly });
  loom.note(() => {
    if (!board) return '';
    const issues = boardIssues(board);
    return issues.length ? `Not a loom the game could deal: ${issues.join(' ')}` : '';
  }, { hidden: () => createOnly() || !running });
  const settings = panel.settings.group('Difficulty');
  settings.select('Difficulty', options, () => difficulty, value => { difficulty = value; store.set('difficulty', value); }, { disabled: busy });
  settings.hint(() => 'Levels 5–8 have the same visible board rules. Difficulty stays fixed for each practice bolt.');
  panel.settings.group('Accuracy notes').hint(() => 'Offline shuttle draws follow the game’s built-in probabilities. Supplied draw sequences and performance ratings are unverified. Groups, threads and chains are measured directly.');
  panel.controls('weaving', [
    { id: 'left', label: 'Slide left', defaultKey: 'arrowleft' },
    { id: 'right', label: 'Slide right', defaultKey: 'arrowright' },
    { id: 'batten', label: 'Batten', defaultKey: 'space' },
    { id: 'pause', label: 'Pause', defaultKey: 'escape' },
    ...PAINT_KEYS.map(({ id, label, defaultKey }) => ({ id, label, defaultKey })),
  ]);
  panel.results(() => finished ? { title: result, rows: [
    ['Groups cleared', String(groups)], ['Threads cleared', String(threads)], ['Shuttles placed', String(moves)],
    ['Longest chain', String(longestChain)], ['Largest group', String(largestGroup)],
  ] } : null);
  historyGroup(panel, () => store.history(historyKey()), [
    { label: 'Groups', value: game => String(game.score) },
    { label: 'Chain', value: game => String(game.longestChain) },
    { label: 'Result', value: game => String(game.outcome) },
  ], 'Past bolts', {
    available: game => typeof game.replayAt === 'number' && replays.hasPlayableAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined),
    play: game => { if (typeof game.replayAt === 'number') void replays.playAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined); },
  }, false);

  const codec: ReplaySettingsCodec = {
    currentVersion: 1, simulatorVersion: 1,
    migrate(version, value) {
      if (version !== 1 || !value || typeof value !== 'object') return null;
      // Replays saved before Freeplay mode existed are Normal.
      const { difficulty: level, mode: kind = 'normal' } = value as { difficulty?: unknown; mode?: unknown };
      return typeof level === 'number' && Number.isInteger(level) && level >= 0 && level <= 8 && (kind === 'normal' || kind === 'create') ? { difficulty: level, mode: kind } : null;
    },
  };
  replays = new ReplayRecorder('weaving', store, panel, ticks, (tape: PuzzleReplay) => {
    savedDifficulty ??= difficulty;
    savedMode ??= mode;
    ({ difficulty, mode } = tape.settings as { difficulty: number; mode: Mode });
    start(tape.seed as number);
  }, () => {
    running = false; view = null; board = null; finished = false; pressed = false;
    if (savedDifficulty !== null) { difficulty = savedDifficulty; savedDifficulty = null; }
    if (savedMode !== null) { mode = savedMode; savedMode = null; }
  }, seed => typeof seed === 'number' && Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff,
  pause.setReplayTime, () => frame([]), codec, () => !busy() || replays.isPlaying);
  replays.setStopLive(() => finish('Stopped'));
  // Taken over, the replay's settings are the game's: the player's own aren't put back afterwards.
  // Freeplay and games with no timer have no end of their own: their replays are kept however they stop.
  replays.openEnded = creating;
  replays.onTakeOver = () => { savedDifficulty = null; savedMode = null; };
  // What decides how the game goes on; replays check it after every recorded input.
  replays.fingerprint = () => stateText(board, running, finished, moves, groups, threads, longestChain, largestGroup, startAt, pressed);
  return { frame, dispose() { if (running) finish('Stopped'); replays.dispose(); sounds.dispose(); } };
}) satisfies PuzzleFactory;
