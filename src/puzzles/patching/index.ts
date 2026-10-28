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
import { BoardRandom } from '../forage/board';
import { boardCode, boardIssues, fill as fillBoard, FILLABLE, load as loadBoard, paint as paintSquare, PAINTABLE, PIECE_NAMES, readBoardCode, rotate as rotateAny } from './create';
import { difficultyInfo, GROMMET, movable, neighbour, PatchingBoard, SPOOL, TIE } from './logic';
import { cellAt, PatchingView } from './view';

type Mode = 'normal' | 'create';
interface Settings { difficulty: number; wind: number | null; bonusMode: number; mode: Mode }
const DEFAULT: Settings = { difficulty: 0, wind: null, bonusMode: 0, mode: 'normal' };
export function readSettings(value: unknown): Settings | null {
  if (!value || typeof value !== 'object') return null;
  // Settings and replays saved before Freeplay mode existed are Normal.
  const s = { mode: 'normal', ...value } as Partial<Settings>;
  return Number.isInteger(s.difficulty) && s.difficulty! >= 0 && s.difficulty! <= 10 &&
    (s.wind === null || typeof s.wind === 'number' && Number.isInteger(s.wind) && s.wind >= 0 && s.wind <= 300) &&
    Number.isInteger(s.bonusMode) && s.bonusMode! >= 0 && s.bonusMode! <= 2 && (s.mode === 'normal' || s.mode === 'create')
    ? { difficulty: s.difficulty!, wind: s.wind!, bonusMode: s.bonusMode!, mode: s.mode } : null;
}
/** Freeplay mode paints with keys 1-8 held over the board. They take over the number-pad cursor keys there. */
const PAINT_KEYS = PAINTABLE.map((type, n) => ({ id: `paint${n + 1}`, label: `Paint ${PIECE_NAMES[type].toLowerCase()} (Freeplay)`, defaultKey: String(n + 1), type }));
const SPRITES: Record<number, string> = { 1: 'straight', 2: 'elbow', 3: 'tee', 4: 'plus', 5: 'grommets', 6: 'tie_offs', 7: 'blocker', 8: 'spool' };
const validSeed = (seed: unknown): seed is number => typeof seed === 'number' && Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff;
const keyBindings = [
  { id: 'up', label: 'Cursor up', defaultKey: 'w' }, { id: 'right', label: 'Cursor right', defaultKey: 'd' },
  { id: 'down', label: 'Cursor down', defaultKey: 's' }, { id: 'left', label: 'Cursor left', defaultKey: 'a' },
  { id: 'ccw', label: 'Rotate counterclockwise', defaultKey: 'q' }, { id: 'cw', label: 'Rotate clockwise', defaultKey: 'e' },
  { id: 'swap', label: 'Select / swap', defaultKey: 'space' }, { id: 'gust', label: 'Request gust', defaultKey: 'enter' },
  { id: 'pause', label: 'Pause', defaultKey: 'escape' },
];

export default (async ({ screen, input, panel, store, ticks: rawTicks, setReplayTime: rawReplayTime }) => {
  const pause = new SessionPause(rawTicks, rawReplayTime), { ticks } = pause;
  const images = await Images.load(import.meta.glob<string>('./media/*.png', { eager: true, query: '?url', import: 'default' }));
  await loadGameFont();
  let replays!: ReplayRecorder;
  const sounds = new SoundBank(import.meta.glob<string>('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' }), () => replays?.isSeeking ?? false);
  const playSound = (name: string) => sounds.play(name, name.startsWith('fanfare_') || name === 'grommet_rotate' || name === 'grommet_connected' || name === 'wind_gust' ? .75 : 1);
  let settings = readSettings(store.get('settings', DEFAULT)) ?? { ...DEFAULT };
  let liveSettings = { ...settings }, savedSettings: Settings | null = null;
  let board = new PatchingBoard(settings.difficulty, 42, true, settings.bonusMode);
  let view = new PatchingView(screen, images, playSound, board, 0, 42);
  let running = false, finished = false, startAt = 0, endAt = 0;
  let score = 0, cleared = 0, torn = 0, gusts = 0, moves = 0, tokens = 0;
  let sequence = new BoardRandom(42);
  let lastMouse: Point = [-1, -1], downAt = 0, downButton = 0, wheelAt = -Infinity;
  const held = new Map<string, number>();
  /** Freeplay mode: the palette piece a left click places (recorded, so replays click the same way), the key held, the board to return to after a gust, and pasted-text errors. */
  let paletteType: number | null = null, paintWith: number | null = null, painting = false;
  let setup = '', pasteNote = '';
  const creating = () => running && liveSettings.mode === 'create';
  const busy = () => running || (replays?.isPlaying ?? false);
  const wind = () => liveSettings.mode === 'create' ? 0 : liveSettings.wind ?? difficultyInfo(liveSettings.difficulty).wind;
  const historyKey = () => `difficulty:${settings.difficulty}:wind:${settings.wind ?? 'level'}:tokens:${settings.bonusMode}`;
  const save = () => store.set('settings', settings);
  const resetInput = () => { view.drag = null; view.selected = null; downButton = 0; held.clear(); paintWith = null; painting = false; };
  const seedMode = seedControls(panel, store, () => running || !!replays?.isPlaying);

  function start(seed = seedMode.next()): void { seedMode.remember(seed);
    pause.resume(); liveSettings = { ...settings }; sequence = new BoardRandom(seed ^ 0x7a7c11);
    // Freeplay has no maneuver tokens to earn, so a pasted board needs nothing beyond its pieces.
    board = new PatchingBoard(liveSettings.difficulty, seed, true, liveSettings.mode === 'create' ? 0 : liveSettings.bonusMode);
    view = new PatchingView(screen, images, playSound, board, ticks(), seed ^ 0x76ad);
    paletteType = null; setup = ''; pasteNote = '';
    running = true; finished = false; score = cleared = torn = gusts = moves = tokens = 0;
    startAt = endAt = ticks(); lastMouse = [-1, -1]; wheelAt = -Infinity; resetInput();
    replays.begin(liveSettings, seed); view.play('puzzle_intro', ticks());
  }
  function finish(): void {
    if (!running) return;
    running = false; finished = true; endAt = ticks(); resetInput();
    const tape = replays.finish(`${cleared} patched · ${score} points`);
    // Freeplay is a sandbox and keeps no history.
    if (!replays.isPlaying && liveSettings.mode !== 'create') store.addHistory(historyKey(), { score, cleared, torn, gusts, moves, tokens, duration: Math.max(0, endAt - startAt),
      ...(tape ? { replayAt: tape.at, replayId: tape.runId ?? '' } : {}) });
  }
  function gust(now: number, automatic = false): void {
    if (!running || !view.ready(now)) return;
    if (!automatic && !board.canGust) { view.play('illegal_move', now); return; }
    const active = board.activeBonusTypes, earnedLocs = new Set([...board.bonuses.keys()].filter(i => board.bonusActive(i))), count = earnedLocs.size;
    if (creating()) setup = boardCode(board);
    const result = board.gust();
    score += result.score; gusts++;
    if (result.done) { if (result.torn) torn++; else { cleared++; if (active.size === 1) tokens += count; } }
    if (!result.done) board.update();
    const earned = result.done && !result.torn && active.size === 1 ? [...earnedLocs] : [];
    view.gust(now, result.done, result.torn, result.used, earned);
  }
  /** Advance scheduled events before applying input, including during replay seeking. */
  function advance(now: number): void {
    for (let n = 0; running && n < 10000; n++) {
      const next = view.completeAt === null ? wind() > 0 ? view.windAt + wind() * 1000 : Infinity : view.nextAt;
      if (view.completeAt === null && wind() > 0) {
        const warningAt = Math.max(view.windAt, view.windAt + wind() * 1000 - 9250);
        if (warningAt <= Math.min(next, now)) view.warningWind(warningAt);
      }
      if (next > now) break;
      view.advance(next);
      if (view.completeAt === null) gust(next, true);
      else {
        // Freeplay brings back the board as it was before the gust, so a setup can be tried again.
        const again = creating() ? readBoardCode(setup) : null;
        board = again ? loadBoard(again, sequence.next(32) >>> 0) : new PatchingBoard(liveSettings.difficulty, sequence.next(32) >>> 0, true, liveSettings.bonusMode);
        view.setBoard(board, next); resetInput();
      }
    }
    view.advance(now);
  }
  function rotate(i: number, delta: number, now: number): void {
    const p = board.pieces.get(i);
    if (p && creating() && (p.type === SPOOL || p.type === TIE)) {
      if (rotateAny(board, i, delta)) { view.changed(new Map(), now); view.play('piece_rotate', now); }
      return;
    }
    if (!p || !movable(p)) return;
    const previous = new Map([...board.pieces].map(([n, p]) => [n, p.tension]));
    if (board.rotate(i, delta)) { moves++; view.changed(previous, now); view.play(p.type === GROMMET ? 'grommet_rotate' : 'piece_rotate', now); }
  }
  function swap(a: number, b: number, now: number): void {
    const previous = new Map([...board.pieces].map(([n, p]) => [n, p.tension]));
    if (board.swap(a, b)) { moves++; view.swapped(a, b, now); view.changed(previous, now); }
  }
  function key(key: string, now: number): void {
    const match = (id: string, fallback: string) => keyMatches(key, 'patching', id, fallback);
    let direction = -1;
    if (match('up', 'w') || key === 'arrowup' || key === '8') direction = 0;
    else if (match('right', 'd') || key === 'arrowright' || key === '6') direction = 1;
    else if (match('down', 's') || key === 'arrowdown' || key === '2') direction = 2;
    else if (match('left', 'a') || key === 'arrowleft' || key === '4') direction = 3;
    if (direction >= 0) { const n = neighbour(view.cursor, direction); if (board.inBounds(n)) view.cursor = n; }
    else if (match('cw', 'e') || key === '9') rotate(view.cursor, 1, now);
    else if (match('ccw', 'q') || key === '7') rotate(view.cursor, -1, now);
    else if (match('gust', 'enter')) gust(now);
    else if (match('swap', 'space') || key === '5' || key === '0') {
      if (view.selected === null) { const p = board.pieces.get(view.cursor); if (p && movable(p)) view.selected = view.cursor; }
      else { swap(view.selected, view.cursor, now); view.selected = null; }
    }
  }
  /** Freeplay mode: a recorded change, applied now and again at the same moment in a replay. */
  function createCommand(command: string, now: number): void {
    if (!creating()) return;
    if (command.startsWith('palette:')) { const type = Number(command.slice(8)); paletteType = PAINTABLE.includes(type) ? type : null; return; }
    if (!view.ready(now)) return;
    let next: PatchingBoard | null = null;
    if (command.startsWith('fill:')) { if (fillBoard(board, Number(command.slice(5)))) view.changed(new Map(), now); }
    else if (command.startsWith('load:')) { const read = readBoardCode(command.slice(5)); if (read) next = loadBoard(read, sequence.next(32) >>> 0); }
    else if (command === 'generate') next = new PatchingBoard(board.difficulty, sequence.next(32) >>> 0, true, 0);
    if (next) { board = next; view.setBoard(board, now); resetInput(); }
  }
  const record = (command: string) => {
    if (!creating() || replays.isPlaying || pause.paused) return;
    replays.command(command);
    createCommand(command, ticks());
  };
  function paintAt(i: number, type: number, now: number): void {
    if (i >= 0 && view.ready(now) && !view.drag && paintSquare(board, i, type)) { view.selected = null; view.changed(new Map(), now); view.play('piece_rotate', now); }
  }
  function draw(): void { view.draw(ticks(), wind(), running, pause.paused); }
  function frame(events: InputEvent[]): void {
    const live = pause.input(events, 'patching', running);
    if (live === null) { resetInput(); draw(); return; }
    const routed = replays.frame(live, input.mouse, ticks()); input.mouse = routed.mouse;
    if (!routed.renderOnly) {
      const now = ticks();
      advance(now);
      for (const command of routed.commands) if (command === 'stop') finish(); else createCommand(command, now);
      if (running) {
        const mouse = routed.mouse;
        if (mouse[0] !== lastMouse[0] || mouse[1] !== lastMouse[1]) {
          const i = cellAt(mouse); if (i >= 0 && !view.drag) view.cursor = i;
          if (view.drag) view.drag.to = [...mouse];
          if (creating() && i >= 0 && (paintWith ?? (painting ? paletteType : null)) !== null) paintAt(i, (paintWith ?? paletteType)!, now);
        }
        lastMouse = [...mouse];
      }
      if (running && view.ready(now)) {
        for (const e of routed.events) {
          const paintKey = creating() && (e.type === 'keydown' || e.type === 'keyup') ? PAINT_KEYS.find(k => keyMatches(e.key, 'patching', k.id, k.defaultKey)) : undefined;
          if (paintKey) {
            if (e.type === 'keyup') { if (paintWith === paintKey.type) paintWith = null; }
            else { paintWith = paintKey.type; paintAt(view.cursor, paintKey.type, now); }
          } else if (creating() && paletteType !== null && e.type === 'mousedown' && e.button === 1 && cellAt(e.pos) >= 0) {
            view.cursor = cellAt(e.pos); painting = true; paintAt(view.cursor, paletteType, now);
          } else if (painting && e.type === 'mouseup' && e.button === 1) painting = false;
          else if (e.type === 'keydown') { key(e.key, now); held.set(e.key, now + 500); }
          else if (e.type === 'keyup') held.delete(e.key);
          else if (e.type === 'mousedown') {
            const i = cellAt(e.pos), p = board.pieces.get(i);
            if (e.button === 4 || e.button === 5) {
              const target = view.drag?.i ?? i;
              if (target >= 0 && now - wheelAt >= 150) { view.cursor = target; rotate(target, e.button === 5 ? 1 : -1, now); wheelAt = now; }
            } else if (view.drag && e.button !== downButton) rotate(view.drag.i, e.button === 1 ? -1 : 1, now);
            else if ((e.button === 1 || e.button === 3) && p) {
              view.cursor = i;
              if (p.type === SPOOL) gust(now);
              else if (movable(p)) { view.drag = { i, from: [...e.pos], to: [...e.pos] }; downAt = now; downButton = e.button; }
            }
          } else if (e.type === 'mouseup' && e.button === downButton && view.drag) {
            const from = view.drag.i, to = cellAt(e.pos);
            if (from === to && now - downAt < 150) rotate(from, e.button === 1 ? -1 : 1, now);
            else if (to >= 0 && from !== to) swap(from, to, now);
            view.drag = null; downButton = 0;
          }
          if (!view.ready(now)) { resetInput(); break; }
        }
        for (const [heldKey, repeatAt] of held) if (now >= repeatAt && view.ready(now)) {
          key(heldKey, now);
          held.set(heldKey, repeatAt + (Math.floor((now - repeatAt) / 200) + 1) * 200);
        }
      }
    }
    draw();
  }
  const options = Array.from({ length: 11 }, (_, value) => { const d = difficultyInfo(value); return { value, label: `${value}: ${d.width}×${d.height}, ${d.ties} tie-off${d.ties === 1 ? '' : 's'}${d.blockers ? `, ${d.blockers} blockers` : ''}` }; });
  const setDifficulty = (value: number) => { settings.difficulty = value; save(); };
  const session = panel.session();
  session.select('Mode', [{ value: 'normal', label: 'Normal' }, { value: 'create', label: 'Freeplay' }], () => settings.mode, value => { settings.mode = value as Mode; save(); }, { disabled: busy });
  session.note(() => settings.mode === 'create' ? 'Freeplay has no wind: gust from the spool or Enter, and the board comes back afterwards.' : `Wind every ${settings.wind ?? difficultyInfo(settings.difficulty).wind} seconds${settings.wind === 0 ? ' (disabled)' : ''}.`);
  session.button('Start', () => { if (running) { replays.command('stop'); finish(); } else start(); }, { variant: 'primary', label: () => running ? 'Stop' : 'Start', disabled: () => replays?.isPlaying ?? false });
  pause.install(panel, () => running);
  panel.clock(() => running || finished ? { label: 'Time', ms: Math.max(0, (running ? ticks() : endAt) - startAt) } : null);
  panel.score('Patching').stats(['', 'Now'], () => [['Points', String(score)]]);
  // The board's text can be copied in any mode, and pasted, dealt anew or painted while playing in Freeplay.
  const createOnly = () => settings.mode !== 'create';
  const editing = () => !creating() || !view.ready(ticks()) || pause.paused || replays.isPlaying;
  const boardGroup = panel.group('Board');
  boardGroup.button('Copy', () => copyText(boardCode(board), 'Copy this board:'), { title: 'Copy the board as text' });
  boardGroup.button('Paste', () => void pasteText('Paste a board:').then((text) => {
    if (text === null) return;
    if (readBoardCode(text)) { pasteNote = ''; record(`load:${text.trim()}`); }
    else pasteNote = 'That isn’t a patching board. Boards copied here start with P.';
  }), { hidden: createOnly, disabled: editing, title: 'Play a board from a pasted copy' });
  boardGroup.button('Generate', () => { record('generate'); copyText(boardCode(board), 'Copy this board:'); },
    { hidden: createOnly, disabled: editing, title: 'Deal a new board and copy it' });
  const palette = document.createElement('div');
  palette.className = 'piece-palette';
  PAINTABLE.forEach((type, n) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-button';
    const icon = document.createElement('canvas');
    icon.width = icon.height = 56;
    icon.setAttribute('aria-hidden', 'true');
    icon.getContext('2d')!.drawImage(images.get(SPRITES[type]), 0, 0, 56, 56, 0, 0, 56, 56);
    button.append(icon, document.createTextNode(`${n + 1} · ${PIECE_NAMES[type]}`));
    button.addEventListener('click', () => { record(`palette:${paletteType === type ? -1 : type}`); panel.used(); });
    panel.addSync(() => {
      button.disabled = !creating() || replays.isPlaying;
      button.setAttribute('aria-pressed', String(paletteType === type));
    });
    palette.append(button);
  });
  boardGroup.append(palette, { hidden: createOnly });
  boardGroup.button('Fill board', () => record(`fill:${paletteType !== null && FILLABLE.includes(paletteType) ? paletteType : FILLABLE[0]}`),
    { hidden: createOnly, disabled: editing, title: 'Make every square but the spool and tie-offs the selected piece' });
  boardGroup.note(() => pasteNote, { hidden: createOnly });
  boardGroup.note(() => {
    const issues = boardIssues(board);
    return issues.length ? `Not a board the game could deal: ${issues.join(' ')}` : '';
  }, { hidden: () => createOnly() || !running });
  panel.controlSettings.group('Controls').hint(() => 'Drag to swap. Wheel or Q/E to rotate. WASD or arrows to move; Space to select/swap. Enter or click the spool for a safe gust. Escape pauses.');
  const gameSettings = panel.settings.group('Game');
  gameSettings.select('Difficulty', options, () => settings.difficulty, setDifficulty, { disabled: busy });
  gameSettings.select('Wind', [{ value: 'level', label: 'By difficulty (YPPedia mapping)' }, { value: 'custom', label: 'Custom interval' }, { value: 'off', label: 'No wind' }],
    () => settings.wind === null ? 'level' : settings.wind === 0 ? 'off' : 'custom', value => { settings.wind = value === 'level' ? null : value === 'off' ? 0 : 60; save(); }, { disabled: busy });
  gameSettings.number('Custom seconds', () => settings.wind || 60, value => { settings.wind = Math.max(1, Math.min(300, Math.round(value))); save(); }, { min: 1, max: 300, step: 1, disabled: () => busy() || settings.wind === null || settings.wind === 0 });
  gameSettings.select('Maneuvers', [{ value: 0, label: 'None' }, { value: 1, label: '4 Tokens' }, { value: 2, label: '5 Tokens' }], () => settings.bonusMode, value => { settings.bonusMode = value; save(); }, { disabled: busy });
  gameSettings.hint(() => 'Difficulty stays fixed during practice. Each completed or torn board is followed by a new one.');
  panel.settings.group('Accuracy notes').hint(() => 'Board generation, connections, grommets and raw points follow the game rules. Wind intervals use YPPedia aligned highest to highest, with 75 s for the remaining lower levels. Live rating thresholds and supplied board seeds are unavailable. See docs/PATCHING.md for assumptions and open questions.');
  panel.controls('patching', [...keyBindings, ...PAINT_KEYS.map(({ id, label, defaultKey }) => ({ id, label, defaultKey }))]);
  panel.results(() => finished && liveSettings.mode !== 'create' ? { title: 'Patching practice complete', rows: [['Points', String(score)], ['Boards patched', String(cleared)], ['Boards torn', String(torn)], ['Moves', String(moves)], ['Maneuver tokens', String(tokens)]] } : null);
  historyGroup(panel, () => store.history(historyKey()), [
    { label: 'Points', value: game => String(game.score) }, { label: 'Patched', value: game => String(game.cleared) }, { label: 'Torn', value: game => String(game.torn) },
  ], 'Past sessions', {
    available: game => typeof game.replayAt === 'number' && (replays?.hasPlayableAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined) ?? false),
    play: game => { if (typeof game.replayAt === 'number') void replays.playAt(game.replayAt, typeof game.replayId === 'string' ? game.replayId : undefined); },
  }, false);
  const codec: ReplaySettingsCodec = { currentVersion: 1, simulatorVersion: 2, migrate: (version, value) => version === 1 ? readSettings(value) : null };
  replays = new ReplayRecorder('patching', store, panel, ticks, (tape: PuzzleReplay) => {
    savedSettings ??= { ...settings }; settings = readSettings(tape.settings)!; start(tape.seed as number);
  }, () => {
    running = false; finished = false; resetInput();
    if (savedSettings) { settings = savedSettings; liveSettings = { ...settings }; savedSettings = null; }
    board = new PatchingBoard(settings.difficulty, 42, true, settings.bonusMode);
    view = new PatchingView(screen, images, playSound, board, ticks(), 42);
  }, validSeed, pause.setReplayTime, () => frame([]), codec, () => !busy() || replays.isPlaying);
  replays.setStopLive(finish);
  // Taken over, the replay's settings are the game's: the player's own aren't put back afterwards.
  replays.onTakeOver = () => { savedSettings = null; };
  // What decides how the game goes on; replays check it after every recorded input.
  replays.fingerprint = () => stateText(board, running, finished, startAt, score, cleared, torn, gusts, moves, tokens, sequence,
    view.drag, view.selected, downButton, downAt, wheelAt);
  return { frame, dispose() { if (running) finish(); replays.dispose(); sounds.dispose(); } };
}) satisfies PuzzleFactory;
