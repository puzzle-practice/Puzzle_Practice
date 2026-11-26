// Runs one puzzle on a canvas: builds its context, then calls frame() at up to 60 fps.
import { FrameClock } from './frame-clock';
import { GameTime } from './game-time';
import { loadUiFont } from './fonts';
import { Input } from './input';
import { Panel } from './panel';
import type { PuzzleFactory, PuzzleInstance, PuzzleMeta } from './puzzle';
import { Screen } from './screen';
import { Store } from './storage';
import { Simulation } from './simulation';
import { isVirtualTime, realNow, setFrameRunner } from './realtime';

export interface RunningPuzzle {
  stop(): void;
}

export async function runPuzzle(
  canvas: HTMLCanvasElement,
  panelRoot: HTMLElement,
  id: string,
  meta: PuzzleMeta,
  factory: PuzzleFactory,
): Promise<RunningPuzzle> {
  const screen = new Screen(canvas, meta.width ?? 800, meta.height ?? 600);
  const simulation = new Simulation();
  const time = new GameTime(realNow, () => simulation.time, document.hidden, () => !isVirtualTime());
  const input = new Input(screen, time.elapsed);
  const store = new Store(id);
  const panel = new Panel(panelRoot, canvas);
  panel.onUsed = () => canvas.focus();
  await loadUiFont();
  const clock = new FrameClock(() => simulation.time);
  const { ticks, setReplayTime } = clock;

  let instance: PuzzleInstance;
  try {
    instance = await factory({ screen, input, panel, store, ticks, setReplayTime });
  } catch (error) {
    input.dispose();
    throw error;
  }
  time.reset();
  input.drain();
  // A hidden tab stops the game clock (see GameTime). A video export runs on its own clock and
  // keeps going while the tab is hidden.
  const onVisibility = () => { if (document.hidden) time.hide(); else time.show(); };
  document.addEventListener('visibilitychange', onVisibility);
  // When frames stopped without the tab being hidden (a covered window or a sleeping computer),
  // the stalled time is left out rather than played back as a fast burst (see GameTime).
  const catchUp = () => {
    if (time.dropStall() > 0) input.clampTo(time.elapsed());
    simulation.advance(time.elapsed(), at => clock.frame(() => instance.frame(input.drain(at))));
  };
  // A video export steps the game itself, one video frame at a time, while the clock is virtual.
  const unregister = setFrameRunner({ canvas, run: catchUp });
  // Panel actions use the same logical time even if a display has not painted yet.
  for (const event of ['click', 'change', 'input']) panelRoot.addEventListener(event, catchUp, true);

  let stopped = false;
  let handle = 0;
  const loop = () => {
    if (stopped) return;
    handle = requestAnimationFrame(loop);
    if (!isVirtualTime()) catchUp();
    panel.sync();
  };
  handle = requestAnimationFrame(loop);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(handle);
      unregister();
      input.dispose();
      document.removeEventListener('visibilitychange', onVisibility);
      for (const event of ['click', 'change', 'input']) panelRoot.removeEventListener(event, catchUp, true);
      instance.dispose?.();
    },
  };
}
