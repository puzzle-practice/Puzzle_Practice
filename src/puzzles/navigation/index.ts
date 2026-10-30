import { seedControls } from '../../core/seeds';
import { Images } from '../../core/assets';
import { drawGameText, drawPauseLabel, floatAt, gameFont, gameFontFor, gameTextBox, loadGameFont, wrapGameText, FLOAT_MS, TEXT_WHITE, TEXT_YELLOW } from '../../core/game-text';
import { SoundBank } from '../../core/audio';
import { SessionPause } from '../../core/pause';
import { TimerWarning } from '../../core/timer-warning';
import { ReplayRecorder, stateText, type ReplaySettingsCodec } from '../../core/replay';
import { historyGroup } from '../../core/history';
import { dutyDesk } from '../../core/duty/desk';
import { EndHold } from '../../core/end-hold';
import { LEARNING } from '../../core/duty/ratings';
import { TEXT } from '../../core/duty/report';
import { keyMatches } from '../../core/controls';
import type { PuzzleFactory } from '../../core/puzzle';
import type { InputEvent } from '../../core/input';
import { NavigationGame, DEFAULT_SETTINGS, DISMISS_DELAYS, NO_TOTALS, addBoard, boardSeed, readSettings, runGoal, readNavigationSeed, settingsKey, isWerewolf, modeLabel, type NavigationSettings, type RunTotals, type Scene } from './game';
import { LEVEL_TARGETS } from './logic';
import { copyText, pasteText } from '../../core/clipboard';
import { boardCode, boardIssues, CLEAR, COLOUR_NAMES, load as loadBoard, OCTANT_NAMES, paintStar, paintTarget, readBoardCode, setEntry, WILD } from './create';

const imageUrls = import.meta.glob<string>('./media/*.png', { eager: true, query: '?url', import: 'default' });
const soundUrls = import.meta.glob<string>('./sounds/*.mp3', { eager: true, query: '?url', import: 'default' });
const COLOURS = ['blue', 'orange', 'red', 'white', 'yellow'];
const CX = 225, CY = 300;
const MODES = ['normal', 'ww-test', 'ww'] as const;
const RULE_OPTIONS = MODES.map(value => ({ value, label: modeLabel(value) }));
const MODE_OPTIONS = [...RULE_OPTIONS, { value: 'create' as const, label: 'Freeplay' }];
/** Freeplay mode paints with each colour's initial held over a cell, X to clear and A for a wild target. */
const PAINT_KEYS = [...COLOUR_NAMES.map((name, colour) => ({ id: `paint${name}`, label: `Paint ${name.toLowerCase()} (Freeplay)`, defaultKey: name[0].toLowerCase(), colour })),
  { id: 'paintClear', label: 'Clear (Freeplay)', defaultKey: 'x', colour: CLEAR }, { id: 'paintWild', label: 'Wild target (Freeplay)', defaultKey: 'a', colour: WILD }];

export default (async ({ screen, input, panel, store, ticks: rawTicks, setReplayTime: rawReplayTime }) => {
  const pause = new SessionPause(rawTicks, rawReplayTime);
  const { ticks, setReplayTime } = pause;
  const [images] = await Promise.all([Images.load(imageUrls), loadGameFont()]);
  let replays!: ReplayRecorder;
  const sounds = new SoundBank(soundUrls, () => replays?.isSeeking ?? false);
  const warning = new TimerWarning('gauntlet', () => replays?.isSeeking ?? false);
  const ctx = screen.ctx;
  let settings = readSettings(store.get('settings', DEFAULT_SETTINGS)) ?? { ...DEFAULT_SETTINGS };
  // WW now defaults to the 2-minute timer; move saved WW settings with no timer over once.
  if (!store.get('wwTimerDefault', false)) {
    if (isWerewolf(settings.mode) && settings.timerMs === 0) { settings.timerMs = DEFAULT_SETTINGS.timerMs; store.set('settings', settings); }
    store.set('wwTimerDefault', true);
  }
  let liveSettings = { ...settings };
  let savedSettings: NavigationSettings | null = null;
  let game: NavigationGame | null = null;
  /** In WW and quota runs, Dismiss deals a new board in the same run: its score, stats, timer and constellation count carry on. */
  let runSeed = 0, board = 0;
  let banked: RunTotals = NO_TOTALS;
  const totals = (): RunTotals => game ? addBoard(banked, game) : banked;
  /**
   * From the clears played this run: the longest chain, counting one that ends on a constellation, and
   * constellations charted in a bingo, donkey or vegas (a 4, 5, or 6-or-longer chain). Kept here rather
   * than in the game so replays recorded before these were counted still pass their state checks.
   */
  let longestChain = 0, bigCharts = [0, 0, 0];
  let running = false, finished = false, selected = 0;
  let startTime = 0, endTime = 0;
  let timerElapsedBeforeBoard = 0;
  let incomingRadius = 220, lastTick = 0;
  let fastDrop = false;
  /** Dismiss holds play until then: a new board in the run stays hidden, and a fresh Normal run waits to start. */
  let dealAt = 0, pendingStart: { at: number; timerElapsedMs: number } | null = null;
  const dealing = () => running && ticks() < dealAt;
  let scenes: Scene[] = [], sceneStart = 0;
  let pendingCommands: string[] = [];
  let message = '', messageAt = 0, messagePx = 30, messageFill = TEXT_WHITE;
  /** Freeplay mode: what painting changes, the palette choice a left click paints (recorded, so replays click the same way), the key held, the board as last edited, and pasted-text errors. */
  let layer: 'stars' | 'targets' = 'stars', palette: number | null = null, paintWith: number | null = null, painting = false, setup = '', pasteNote = '';
  let lastMouse: [number, number] = [-1, -1];
  const creating = () => running && liveSettings.create && !!game;
  const duty = dutyDesk(panel, store, 'navigation', 'Navigation', []);
  const busy = () => running || (replays?.isPlaying ?? false);
  const history = () => store.history(settingsKey(settings));
  const radius = (ring: number) => 55 + ((game?.board.rings ?? (isWerewolf(settings.mode) && settings.extraRing ? 4 : 3)) - 1 - ring) * ((game?.board.rings ?? (isWerewolf(settings.mode) && settings.extraRing ? 4 : 3)) === 4 ? 47 : 55);
  const position = (octant: number, r: number): [number, number] => [CX + Math.cos(octant * Math.PI / 4) * r, CY - Math.sin(octant * Math.PI / 4) * r];
  const elapsed = () => Math.max(0, (running ? ticks() : endTime) - startTime);
  const timerElapsed = () => timerElapsedBeforeBoard + elapsed();
  const timeLeft = () => Math.max(0, liveSettings.timerMs - timerElapsed());
  /** Time's up: no more moves, and the run ends once the board has settled. */
  const timeUp = () => running && !!liveSettings.timerMs && !timeLeft();
  const hold = new EndHold(ticks);
    const dismissKeepsRun = () => isWerewolf(liveSettings.mode) || liveSettings.clears;
  const of = (goal: number) => goal === Infinity ? '' : ` / ${goal}`;
  const keepsTimer = () => isWerewolf(liveSettings.mode) && isWerewolf(settings.mode) && liveSettings.timerMs > 0 && settings.timerMs === liveSettings.timerMs;
  const saveSettings = () => store.set('settings', settings);
  const key = (name: string, action: string, fallback: string) => keyMatches(name, 'navigation', action, fallback);

  const seedMode = seedControls(panel, store, () => running || !!replays?.isPlaying);

  function start(seed?: number, timerElapsedMs = 0): void {
    pause.resume();
    if (seed === undefined) seed = seedMode.next(); seedMode.remember(seed);
    // Freeplay has no timer or quota, and each star waits at the top for Drop.
    liveSettings = settings.create ? { ...settings, timerMs: 0, clears: false, slowDrop: true } : { ...settings };
    duty.clear();
    layer = 'stars'; palette = paintWith = null; painting = false; setup = ''; pasteNote = '';
    runSeed = seed; board = 0; banked = NO_TOTALS; longestChain = 0; bigCharts = [0, 0, 0];
    dealAt = 0; pendingStart = null;
    game = new NavigationGame(liveSettings, seed);
    selected = game.board.rings - 1;
    running = true; finished = false; hold.clear();
    startTime = endTime = sceneStart = ticks();
    timerElapsedBeforeBoard = timerElapsedMs;
    incomingRadius = 220; lastTick = ticks();
    scenes = []; pendingCommands = []; fastDrop = false; message = '';
    warning.reset();
    replays.begin(liveSettings, timerElapsedMs ? { boardSeed: seed, timerElapsedMs } : seed);
    sounds.play('fanfare');
  }
  /** A fresh board in the same run (WW or quota-run Dismiss): what the run has scored stays. */
  function nextBoard(): void {
    if (!running || !game || game.finished || timeUp()) return;
    deal('New board');
  }
  /** `opening` is false after a booch: Dennav's next board carries on at 3/2/1 rather than opening on 1/2/1. */
  function deal(note: string, opening = true): void {
    if (!game) return;
    banked = totals();
    board++;
    // A quota run's count carries on; a timed WW board has its own quota.
    game = new NavigationGame(liveSettings, boardSeed(runSeed, board), runGoal(liveSettings) - (liveSettings.clears ? banked.constellations : 0), opening);
    selected = game.board.rings - 1;
    scenes = []; fastDrop = false; incomingRadius = 220;
    message = note; messageAt = ticks(); messagePx = gameFont(3); messageFill = TEXT_WHITE;
    dealAt = liveSettings.dismissDelayMs ? ticks() + liveSettings.dismissDelayMs : 0;
    if (!dealAt) sounds.play('fanfare');
  }
  function end(reason: string): void {
    if (!running || !game) return;
    running = false; finished = true; endTime = ticks(); scenes = [];
    if (reason === 'Time up') hold.start();
    if (reason === 'Booched!') sounds.play('booched');
    const run = totals();
    const report = duty.end({ mode: modeLabel(liveSettings.mode), performance: LEARNING,
      score: { label: 'Points', value: String(run.points) },
      // Werewolf Isle's report shows each constellation as a moon.
      cleared: isWerewolf(liveSettings.mode) ? [{ label: 'Constellations Charted', inScore: true, items: [
        { icon: 'moon-crescent', label: 'crescent moons, charted with no chain', count: run.moons[0] },
        { icon: 'moon-half', label: 'half moons, charted in a double chain', count: run.moons[1] },
        { icon: 'moon-full', label: 'full moons, charted in a triple chain or longer', count: run.moons[2] },
        ...[['bingo', 'bingos'], ['donkey', 'donkeys'], ['vegas', 'vegas']].map(([one, many], i) => ({ icon: TEXT, label: bigCharts[i] === 1 ? one : many, count: bigCharts[i] })),
      ] }] : [] });
    const tape = replays.finish(`${reason} · ${run.points} points`, report);
    // Freeplay is a sandbox and keeps no history.
    if (!replays.isPlaying && !liveSettings.create) store.addHistory(settingsKey(liveSettings), {
      score: run.points, constellations: run.constellations, stars: run.stars, moves: run.moves,
      chain: longestChain, boards: board + 1, seconds: elapsed() / 1000, reason, ...duty.fields(report),
      ...(tape ? { replayAt: tape.at, replayId: tape.runId ?? '' } : {}),
    });
    message = reason; messageAt = ticks(); messagePx = gameFont(1); messageFill = TEXT_WHITE;
  }
  /** A finished board ends the run, except a Dennav or Old Dennav booch, which deals a fresh board in the same run while time is left. */
  function boardDone(): void {
    if (!running || !game) return;
    if (game.booched && isWerewolf(liveSettings.mode) && !liveSettings.create && !liveSettings.boochEnds && !timeUp()) { sounds.play('booched'); deal('Booched! New board', !!liveSettings.boochOpens); }
    else end(game.booched ? 'Booched!' : 'Level complete');
  }
  function startScene(scene: Scene): void {
    if (!scene.clear) return;
    const clear = scene.clear;
    message = clear.kind === 'target' ? `${clear.chain > 1 ? `${clear.chain}× chain! ` : ''}Constellation! +${clear.points}` : `${clear.chain > 1 ? `${clear.chain}× chain! ` : ''}+${clear.points}`;
    messageAt = sceneStart;
    // Chains are 30px yellow; other clears are white and grow with their points (GameFonts.get(points, 300)).
    messagePx = clear.chain > 1 ? gameFont(1) : gameFontFor(clear.points, 300);
    messageFill = clear.chain > 1 ? TEXT_YELLOW : TEXT_WHITE;
    let sound = 'star_destroy';
    if (clear.kind === 'target') {
      const rings = clear.cells.map(c => c.ring);
      sound = rings.length === 1 ? 'constellation_single' : rings.length === 2
        ? (rings[0] === rings[1] ? 'constellation_medium' : 'constellation_small')
        : rings[0] === rings[1] && rings[1] === rings[2] ? 'constellation_huge'
        : new Set(rings.slice(0,3)).size === 3 ? 'constellation_medium' : 'constellation_big';
    }
    sounds.play(sound);
  }
  function queue(steps: Scene[]): void {
    for (const { clear } of steps) if (clear) {
      longestChain = Math.max(longestChain, clear.chain);
      if (clear.kind === 'target' && clear.chain >= 4) bigCharts[Math.min(clear.chain, 6) - 4]++;
    }
    scenes = steps; sceneStart = ticks();
    if (scenes.length) startScene(scenes[0]);
    else if (game?.finished) boardDone();
  }
  function rotate(clockwise: boolean): void {
    if (!running || !game || scenes.length || pause.paused || dealing() || timeUp()) return;
    queue(game.rotate(selected, clockwise));
  }
  function drop(): void {
    if (!running || scenes.length || pause.paused || dealing() || timeUp()) return;
    // A painted Freeplay board waits with gravity off: the first Drop lets it settle and clear, keeping the incoming star.
    if (liveSettings.create && game?.unsettled) { queue(game.settle()); return; }
    fastDrop = true;
  }
  /** The ring and octant under a point on the board, or null. */
  function cellAt([x, y]: [number, number]): { ring: number; octant: number } | null {
    const distance = Math.hypot(x - CX, y - CY);
    if (!game || distance < 30 || distance > radius(0) + 28) return null;
    let ring = 0;
    for (let r = 1; r < game.board.rings; r++) if (Math.abs(radius(r) - distance) < Math.abs(radius(ring) - distance)) ring = r;
    return { ring, octant: ((Math.round(Math.atan2(CY - y, x - CX) / (Math.PI / 4)) % 8) + 8) % 8 };
  }
  /** Freeplay mode: paints the cell under a point with a colour, clear or wild, on the layer being painted. */
  function paintAt(pos: [number, number], colour: number): void {
    const cell = cellAt(pos);
    if (!cell || !game || scenes.length) return;
    const changed = layer === 'targets' ? paintTarget(game, cell.octant, cell.ring, colour) : colour !== WILD && paintStar(game, cell.octant, cell.ring, colour);
    if (changed) { setup = boardCode(game); sounds.play('star_drop'); }
  }
  /** Freeplay mode: a recorded change, applied now and again at the same moment in a replay. */
  function createCommand(command: string): void {
    if (!creating() || !game) return;
    const [name, value = ''] = command.split(':', 2) as [string, string?];
    if (name === 'layer') { layer = value === 'targets' ? 'targets' : 'stars'; return; }
    if (name === 'palette') { palette = value === '' || value === '-' ? null : Number(value); return; }
    if (scenes.length) return;
    if (name === 'entry') { const [colour, octant] = value.split(',').map(Number); setEntry(game, colour, octant); }
    else if (name === 'load' || name === 'reset') {
      const read = readBoardCode(name === 'load' ? command.slice(5) : setup);
      if (!read) return;
      if (read.rings !== game.board.rings) { pasteNote = `That board has ${read.rings} rings. ${read.rings === 4 ? 'Choose Dennav or Old Dennav with the extra ring' : 'Choose Normal, or Dennav or Old Dennav without the extra ring'}, then Start.`; return; }
      loadBoard(game, read);
    } else if (name === 'generate') {
      board++;
      game = new NavigationGame(liveSettings, boardSeed(runSeed, board));
    } else return;
    setup = boardCode(game); incomingRadius = 220;
  }
  function star(colour: number, octant: number, r: number, highlighted = false, target = false, alpha = 1): void {
    const [x, y] = position(octant, r);
    const sheet = images.get(`star_${COLOURS[colour]}`);
    const tile = (target ? (highlighted ? 24 : 16) : highlighted ? 8 : 0) + ((octant + 2) % 8);
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(sheet, tile*56, 0, 56, 56, Math.trunc(x)-28, Math.trunc(y)-28, 56, 56);
    ctx.restore();
  }
  function draw(now: number): void {
    const rings = game?.board.rings ?? (isWerewolf(settings.mode) && settings.extraRing ? 4 : 3);
    screen.blit(images.get(rings === 4 ? 'werewolf_background' : 'background'), 0, 0);
    screen.blit(images.get('title'), 0, 0);
    // The selected ring's highlight: one frame per ring, innermost first; four rings have their own sheet.
    const highlight = rings === 4 ? 414 : 350;
    ctx.save(); ctx.globalAlpha = 0.85;
    ctx.drawImage(images.get(rings === 4 ? 'werewolf_rings' : 'rings'), (rings - 1 - selected)*highlight, 0, highlight, highlight, CX-highlight/2, CY-highlight/2, highlight, highlight);
    ctx.restore();
    const scene = dealing() ? undefined : scenes[0] ?? game?.scene();
    const progress = scene?.duration ? Math.min(1, (now-sceneStart)/scene.duration) : 1;
    const cleared = new Set(scene?.clear?.cells.map(c => c.ring*8+c.octant));
    const falling = new Map(scene?.falls?.map(f => [f.from*8+f.octant, f]));
    if (scene) {
      // Draw targets first so settled and moving stars stay in front of them.
      for (const t of scene.targets) {
        const colour = scene.cells[t.ring*8+t.octant];
        const matches = colour !== -1 && (t.wild || colour === t.colour) && !falling.has(t.ring*8+t.octant) && scene.rotation?.ring !== t.ring;
        if (t.wild) {
          // A wild target is ringed in every colour, lit once any star fills it.
          const [x,y] = position(t.octant,radius(t.ring));
          ctx.drawImage(images.get('star_wild'), ((matches ? 8 : 0) + (t.octant + 2) % 8)*56, 0, 56, 56, Math.trunc(x)-28, Math.trunc(y)-28, 56, 56);
        } else star(t.colour, t.octant, radius(t.ring), matches, true);
      }
      for (let ring = 0; ring < rings; ring++) for (let o = 0; o < 8; o++) {
        const colour = scene.cells[ring*8+o];
        if (colour < 0) continue;
        const target = scene.targets.find(t => t.octant === o && t.ring === ring);
        const fall = falling.get(ring*8+o);
        const fallProgress = fall ? Math.min(1,(now-sceneStart)/Math.trunc(56*Math.abs(fall.ring-fall.from)/0.75)) : progress;
        const r = fall ? radius(fall.from) + (radius(fall.ring)-radius(fall.from))*fallProgress : radius(ring);
        const angle = scene.rotation?.ring === ring ? o + (scene.rotation.clockwise ? -1 : 1)*progress : o;
        // Sprite orientation stays at the starting octant during a turn; only its position moves.
        if (angle === o) star(colour, o, r, !!target && (target.wild || target.colour === colour), false, cleared.has(ring*8+o) ? 1-progress : 1);
        else {
          const [x,y] = position(angle,r);
          ctx.drawImage(images.get(`star_${COLOURS[colour]}`), ((o+2)%8)*56,0,56,56,x-28,y-28,56,56);
        }
      }
    }
    if (running && game && !game.finished && !dealing()) {
      const r = Math.max(radius(0),incomingRadius);
      star(game.entry.colour,game.entry.octant,r);
    }
    if (!running && !finished) drawPauseLabel(ctx, 'Press Start to navigate', CX, CY, 450);
    else if (message && now - messageAt < FLOAT_MS) {
      const style = { px: messagePx, fill: messageFill, align: 'center' as const };
      const text = wrapGameText(ctx, message, style, 450);
      const { dy, alpha } = floatAt(now - messageAt);
      drawGameText(ctx, text, CX, CY - gameTextBox(ctx, text, style).h / 2 + dy, { ...style, alpha });
    }
    replays.drawOverlay(ctx);
  }
  function frame(events: InputEvent[]): void {
    const resumed = pause.input(events, 'navigation', running);
    if (!resumed) return;
    if (pendingStart && !running && ticks() >= pendingStart.at) start(undefined, pendingStart.timerElapsedMs);
    // Buttons join the same simulation frame as keyboard input. Recording the
    // command here keeps playback order identical when a click lands between frames.
    const liveCommands = replays.isPlaying ? [] : pendingCommands.splice(0);
    for (const command of liveCommands) replays.command(command);
    const routed = replays.frame(resumed,input.mouse,ticks());
    if (routed.renderOnly) { draw(ticks()); return; }
    // The incoming star stays put while a dismissed board waits to be dealt.
    let delta = Math.max(0,ticks()-Math.max(lastTick,dealAt));
    lastTick = ticks();
    if (timeUp() && !scenes.length) end('Time up');
    /** Plays out the time since the last step: finished clear animations, then the incoming star's fall. */
    function advance(delta: number): void {
      let now = ticks();
      while (running && scenes.length && now >= sceneStart + scenes[0].duration) {
        sceneStart += scenes[0].duration;
        scenes.shift();
        if (scenes.length) startScene(scenes[0]);
        else {
          if (game?.finished) boardDone();
        }
      }
      if (running && dealAt && !dealing()) { dealAt = 0; sounds.play('fanfare'); }
      if (running && game && !scenes.length && !dealing()) {
        if (liveSettings.timerMs && !timeLeft()) end('Time up');
        // Slow drop: the star waits at the top until Drop is pressed.
        else if ((incomingRadius -= delta*(fastDrop ? 0.5 : liveSettings.slowDrop ? 0 : 0.005)*(220-radius(0))/56) <= radius(0)) {
          sounds.play('star_drop'); fastDrop = false;
          queue(game.drop()); incomingRadius = 220;
        }
      }
    }
    for (const command of [...liveCommands,...routed.commands]) {
      createCommand(command);
      if (command === 'ccw') rotate(false);
      else if (command === 'cw') rotate(true);
      else if (command === 'drop') drop();
      else if (command === 'dismiss') {
        // A replay can carry Dismiss on a later frame than live play saw it: settle the old board
        // first so a star that landed just before the Dismiss isn't held back by the delay.
        if (liveSettings.dismissDelayMs) { advance(delta); delta = 0; }
        nextBoard();
      }
    }
    const mouse = routed.mouse as [number, number];
    if (creating() && (mouse[0] !== lastMouse[0] || mouse[1] !== lastMouse[1])) {
      const colour = paintWith ?? (painting ? palette : null);
      if (colour !== null) paintAt(mouse, colour);
    }
    lastMouse = [mouse[0], mouse[1]];
    for (const event of routed.events) {
      if (!running || timeUp()) continue;
      if (creating()) {
        const paintKey = event.type === 'keydown' || event.type === 'keyup' ? PAINT_KEYS.find(k => key(event.key, k.id, k.defaultKey)) : undefined;
        if (paintKey) {
          if (event.type === 'keyup') { if (paintWith === paintKey.colour) paintWith = null; }
          else { paintWith = paintKey.colour; paintAt(mouse, paintKey.colour); }
          continue;
        }
        if (event.type === 'mousedown' && event.button === 1 && palette !== null && cellAt(event.pos as [number, number])) { painting = true; paintAt(event.pos as [number, number], palette); continue; }
        if (event.type === 'mouseup' && event.button === 1 && painting) { painting = false; continue; }
      }
      if (event.type === 'keydown') {
        if (key(event.key,'ringOut','arrowup')) selected = Math.max(0,selected-1);
        else if (key(event.key,'ringIn','arrowdown')) selected = Math.min((game?.board.rings ?? 3)-1,selected+1);
        else if (key(event.key,'ccw','arrowleft')) rotate(false);
        else if (key(event.key,'cw','arrowright')) rotate(true);
        else if (key(event.key,'drop','space')) drop();
        else {
          // Select ring 1 (the innermost) to 4 directly.
          const ring = [1, 2, 3, 4].findIndex(n => key(event.key, `selectRing${n}`, String(n)));
          if (ring >= 0 && ring < (game?.board.rings ?? 3)) selected = (game?.board.rings ?? 3) - 1 - ring;
        }
      } else if (event.type === 'mousedown' && (event.button === 1 || event.button === 3)) {
        const distance = Math.hypot(event.pos[0]-CX,event.pos[1]-CY);
        if (distance >= 30 && distance <= radius(0)+28) {
          let closest = 0;
          for (let r=1;r<(game?.board.rings ?? 3);r++) if (Math.abs(radius(r)-distance)<Math.abs(radius(closest)-distance)) closest=r;
          if (selected !== closest) selected = closest;
          else rotate(event.button === 1);
        }
      }
    }
    advance(delta);
    if (running && liveSettings.timerMs) warning.update(timeLeft());
    if (!replays.isSeeking && !replays.isAdvancing) draw(ticks());
  }

  panel.clock(() => game ? { label: liveSettings.timerMs ? 'Time left' : 'Time', ms: liveSettings.timerMs ? timeLeft() : elapsed(), countdown: !!liveSettings.timerMs } : null);
  const session = panel.session();
  // Freeplay keeps the last rule set chosen; the Rules setting changes it.
  session.select('Mode', MODE_OPTIONS, () => settings.create ? 'create' : settings.mode, value => {
    settings.create = value === 'create'; if (value !== 'create') settings.mode = value; saveSettings(); selected = isWerewolf(settings.mode) && settings.extraRing ? 3 : 2;
  }, { disabled: busy, title: 'Freeplay lets you paint the stars, targets and incoming star' });
  session.button('Start', () => {
    if (replays.isPlaying) replays.stop();
    pendingStart = null;
    if (running) end('Stopped'); else start();
  }, { variant: 'primary', label: () => running && !replays.isPlaying ? 'Stop' : 'Start' });
  session.button('Dismiss', () => {
    if (!game || replays.isPlaying) return;
    // WW and quota runs: a new board in the same run, recorded so the run's replay deals it too.
    if (running && dismissKeepsRun()) { if (!dealing()) { pause.resume(); pendingCommands.push('dismiss'); } return; }
    const keepTimer = keepsTimer();
    if (keepTimer && !timeLeft()) { if (running) end('Time up'); return; }
    const timerElapsedMs = keepTimer ? timerElapsed() : 0;
    if (running) end('Dismissed');
    // The fresh run starts once the dismiss delay has passed.
    if (settings.dismissDelayMs) pendingStart = { at: ticks() + settings.dismissDelayMs, timerElapsedMs };
    else start(undefined, timerElapsedMs);
  }, { disabled: () => !game || (replays?.isPlaying ?? false) || (keepsTimer() && !timeLeft()) || dealing() || !!pendingStart });
  pause.install(panel, () => running && !replays.isPlaying);
  panel.score().stats(['', 'Now'], () => [['Points', String(totals().points)]]);
  panel.group('Constellations').note(() => !board ? `${game?.constellations ?? 0}${of(game?.goal ?? runGoal(settings))} completed`
    : liveSettings.clears ? `${totals().constellations}${of(runGoal(liveSettings))} completed over ${board + 1} boards`
    : `${game?.constellations ?? 0}${of(game?.goal ?? Infinity)} completed on board ${board + 1} (${totals().constellations} in all)`);
  panel.controlSettings.group('Controls')
    .button('Rotate left', () => pendingCommands.push('ccw'), { disabled: () => !running || scenes.length > 0 || replays.isPlaying || pause.paused || dealing() })
    .button('Rotate right', () => pendingCommands.push('cw'), { disabled: () => !running || scenes.length > 0 || replays.isPlaying || pause.paused || dealing() })
    .button('Drop star', () => pendingCommands.push('drop'), { disabled: () => !running || scenes.length > 0 || replays.isPlaying || pause.paused || dealing() });
  // Freeplay mode's board panel: the board's text, what to paint, and the incoming star.
  const createOnly = () => !settings.create;
  const editing = () => !creating() || scenes.length > 0 || pause.paused || replays.isPlaying;
  const boardGroup = panel.group('Board', { hidden: createOnly });
  boardGroup.button('Copy', () => { if (game) copyText(boardCode(game), 'Copy this board:'); }, { disabled: () => !game, title: 'Copy the stars, targets and incoming star' });
  boardGroup.button('Paste', () => void pasteText('Paste a board:').then(text => {
    if (text === null) return;
    if (readBoardCode(text)) { pasteNote = ''; pendingCommands.push(`load:${text.trim()}`); }
    else pasteNote = 'That isn’t a navigation board. Boards copied here start with N.';
  }), { disabled: editing, title: 'Play a board from a pasted copy' });
  boardGroup.button('Generate', () => pendingCommands.push('generate'), { disabled: editing, title: 'Deal a new board' });
  boardGroup.select('Paint', [{ value: 'stars', label: 'Stars' }, { value: 'targets', label: 'Targets' }], () => layer, value => pendingCommands.push(`layer:${value}`), { disabled: () => !creating() || replays.isPlaying });
  const paletteEl = document.createElement('div');
  paletteEl.className = 'piece-palette';
  PAINT_KEYS.forEach(({ colour, defaultKey }) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'panel-button';
    if (colour >= 0) {
      const icon = document.createElement('canvas'); icon.width = icon.height = 56; icon.setAttribute('aria-hidden', 'true');
      icon.getContext('2d')!.drawImage(images.get(colour === WILD ? 'star_wild' : `star_${COLOURS[colour]}`), 2 * 56, 0, 56, 56, 0, 0, 56, 56);
      button.append(icon);
    }
    button.append(document.createTextNode(`${defaultKey.toUpperCase()} · ${colour === CLEAR ? 'Clear' : colour === WILD ? 'Wild' : COLOUR_NAMES[colour]}`));
    button.addEventListener('click', () => { pendingCommands.push(`palette:${palette === colour ? '-' : colour}`); panel.used(); });
    panel.addSync(() => {
      button.disabled = !creating() || replays.isPlaying || (colour === WILD && layer !== 'targets');
      button.setAttribute('aria-pressed', String(palette === colour));
    });
    paletteEl.append(button);
  });
  boardGroup.append(paletteEl);
  boardGroup.select('Next star', COLOUR_NAMES.map((label, value) => ({ value, label })), () => game?.entry.colour ?? 0, value => pendingCommands.push(`entry:${value},${game?.entry.octant ?? 0}`), { disabled: editing });
  boardGroup.select('Drops at', OCTANT_NAMES.map((label, value) => ({ value, label })), () => game?.entry.octant ?? 0, value => pendingCommands.push(`entry:${game?.entry.colour ?? 0},${value}`), { disabled: editing });
  boardGroup.button('Back to setup', () => pendingCommands.push('reset'), { disabled: () => editing() || !setup, title: 'Put the board back as it was last painted' });
  boardGroup.note(() => pasteNote);
  boardGroup.note(() => {
    const issues = game ? boardIssues(game, isWerewolf(liveSettings.mode), isWerewolf(liveSettings.mode) && liveSettings.wildTargets) : [];
    return issues.length ? `Not a board the game could deal: ${issues.join(' ')}` : '';
  }, { hidden: () => !creating() });
  const options = panel.settings.group('Game');
  options.select('Rules', RULE_OPTIONS, () => settings.mode, mode => { settings.mode = mode; saveSettings(); selected = isWerewolf(mode) && settings.extraRing ? 3 : 2; },
    { disabled: busy, hidden: () => !settings.create, title: 'The rules a Freeplay board is painted and played under' });
  options.select('Difficulty', Array.from({ length: 10 }, (_, value) => ({ value, label: String(value) })), () => settings.difficulty, difficulty => { settings.difficulty = difficulty; saveSettings(); }, { disabled: busy });
  // A quota run is untimed, so it sits with the timers: No timer loops, the quota run ends at the difficulty's quota.
  const timerOptions = LEVEL_TARGETS.map(goal => [{ value: 0, label: 'No timer' }, { value: 'clears' as const, label: `${goal} clears` },
    { value: 120000, label: '2 minutes' }, { value: 300000, label: '5 minutes' }]);
  options.select<number | 'clears'>('Timer', () => timerOptions[settings.difficulty],
  () => settings.clears ? 'clears' : settings.timerMs, value => {
    settings.clears = value === 'clears'; settings.timerMs = value === 'clears' ? 0 : value; saveSettings();
  }, { disabled: busy });
  options.select('Dismiss delay', DISMISS_DELAYS.map(value => ({ value, label: value ? `${value / 1000} s` : 'None' })), () => settings.dismissDelayMs, delay => { settings.dismissDelayMs = delay; saveSettings(); }, { disabled: busy });
  options.toggle('Slow drop', () => settings.slowDrop, on => { settings.slowDrop = on; saveSettings(); }, { disabled: busy, title: 'Each star waits at the top until you press Drop.' });
  options.toggle('Wild targets', () => settings.wildTargets, on => { settings.wildTargets = on; saveSettings(); }, { disabled: busy, hidden: () => !isWerewolf(settings.mode) });
  options.toggle('Extra ring', () => settings.extraRing, on => { settings.extraRing = on; selected = on ? 3 : 2; saveSettings(); }, { disabled: busy, hidden: () => !isWerewolf(settings.mode) });
  options.hint(() => settings.mode === 'ww-test' ? 'Each board starts with 1 inner, 2 middle and 1 outer target, then 3/2/1. Charting counts toward wild-target charging: cascades after charting can make the new inner targets wild and add one extra wild target.' : isWerewolf(settings.mode) ? 'Every constellation has 3 inner, 2 middle and 1 outer target. Chain clears turn adjacent targets wild. Completing a constellation after a clear makes the next inner-ring targets wild.' : 'Fill every target with its matching star colour. Three or more equal stars clear space.');
  options.button('Reset to defaults', () => { settings = { ...DEFAULT_SETTINGS }; selected = 3; saveSettings(); }, { disabled: busy });
  panel.controls('navigation', [
    { id: 'ringOut', label: 'Select outer ring', defaultKey: 'arrowup' },
    { id: 'ringIn', label: 'Select inner ring', defaultKey: 'arrowdown' },
    { id: 'ccw', label: 'Rotate left', defaultKey: 'arrowleft' },
    { id: 'cw', label: 'Rotate right', defaultKey: 'arrowright' },
    { id: 'drop', label: 'Drop star', defaultKey: 'space' },
    { id: 'selectRing1', label: 'Select ring 1 (innermost)', defaultKey: '1' },
    { id: 'selectRing2', label: 'Select ring 2', defaultKey: '2' },
    { id: 'selectRing3', label: 'Select ring 3', defaultKey: '3' },
    { id: 'selectRing4', label: 'Select ring 4', defaultKey: '4' },
    { id: 'pause', label: 'Pause', defaultKey: 'escape' },
    ...PAINT_KEYS.map(({ id, label, defaultKey }) => ({ id, label, defaultKey })),
  ]);
  historyGroup(panel, history, [
    { label: 'Points', value: g => String(g.score) },
    { label: 'Constellations', value: g => String(g.constellations) },
  ], 'Past games', {
    available: g => typeof g.replayAt === 'number' && (replays?.hasPlayableAt(g.replayAt, typeof g.replayId === 'string' ? g.replayId : undefined) ?? false),
    play: g => { if (typeof g.replayAt === 'number') void replays.playAt(g.replayAt, typeof g.replayId === 'string' ? g.replayId : undefined); },
  });
  panel.results(() => finished && !running && !hold.holding && game && !liveSettings.create ? {
    title: 'Navigation results', report: duty.last,
    averages: duty.averages(store.history(settingsKey(liveSettings)), { scoreLabel: 'Points' }),
    rows: [['Points', String(totals().points)],
      ['Constellations', board && !liveSettings.clears ? String(totals().constellations) : `${totals().constellations}${of(runGoal(liveSettings))}`],
      ...(board ? [['Boards', String(board + 1)]] : []),
      ['Stars dropped', String(totals().stars)], ['Ring rotations', String(totals().moves)], ['Longest chain', String(longestChain)], ['Time', `${(elapsed()/1000).toFixed(2)}s`]],
  } : null);
  // Version 1 had no looping: an untimed run then ended at the quota, as a quota run does now.
  // Before version 4 a booch ended every run, Dennav and Old Dennav included.
  // In version 4 the Dennav board a booch dealt opened on 1/2/1 again.
  const codec: ReplaySettingsCodec = { currentVersion: 5, simulatorVersion: 1, migrate: (version, value) => {
    const read = version <= 5 ? readSettings(value) : null;
    if (read?.mode === 'ww-test' && version < 3) return null;
    if (!read || version === 5) return read;
    if (version === 4) return { ...read, boochOpens: true };
    // Version 1 dealt Dismissed boards at once.
    return version === 1 ? { ...read, clears: !read.timerMs, dismissDelayMs: 0, boochEnds: true } : { ...read, boochEnds: true };
  } };
  replays = new ReplayRecorder('navigation', store, panel, ticks, tape => {
    savedSettings ??= { ...settings };
    settings = readSettings(tape.settings)!;
    const seed = readNavigationSeed(tape.seed)!;
    start(seed.boardSeed, seed.timerElapsedMs);
  }, () => {
    running = false; scenes = []; game = null; finished = false; duty.clear();
    dealAt = 0; pendingStart = null;
    board = 0; banked = NO_TOTALS;
    if (savedSettings) { settings = savedSettings; savedSettings = null; }
    selected = isWerewolf(settings.mode) && settings.extraRing ? 3 : 2;
  }, seed => readNavigationSeed(seed) !== null,
  setReplayTime, () => frame([]), codec, () => !running || replays.isPlaying);
  selected = isWerewolf(settings.mode) && settings.extraRing ? 3 : 2;
  // Opening a replay file ends a game in progress, as its Stop button would.
  replays.setStopLive(() => { if (running) end('Stopped'); });
  // Taken over, the replay's settings are the game's: the player's own aren't put back afterwards.
  // Freeplay and games with no timer have no end of their own: their replays are kept however they stop.
  replays.openEnded = () => running && (liveSettings.create || !liveSettings.timerMs);
  // An old replay's booch rule stays with the run taken over, not with the next one started.
  replays.onTakeOver = () => { savedSettings = null; delete settings.boochEnds; delete settings.boochOpens; };
  // What decides how the game goes on; replays check it after every recorded input.
  replays.fingerprint = () => stateText(game, running, finished, selected, runSeed, board, banked, startTime, timerElapsedBeforeBoard,
    incomingRadius, fastDrop, dealAt, scenes, sceneStart);
  return { frame, dispose: () => { if (running) end('Stopped'); replays.dispose(); sounds.dispose(); warning.dispose(); } };
}) satisfies PuzzleFactory;
