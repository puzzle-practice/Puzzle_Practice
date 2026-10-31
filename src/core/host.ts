// Runs one puzzle on a canvas: builds its context, then calls frame() at up to 60 fps.
import { FrameClock } from './frame-clock';
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
  let start = realNow();
  const input = new Input(screen, () => realNow() - start);
  const store = new Store(id);
  const panel = new Panel(panelRoot, canvas);
  panel.onUsed = () => canvas.focus();
  await loadUiFont();
  const simulation = new Simulation();
  const clock = new FrameClock(() => simulation.time);
  const { ticks, setReplayTime } = clock;

  let instance: PuzzleInstance;
  try {
    instance = await factory({ screen, input, panel, store, ticks, setReplayTime });
  } catch (error) {
    input.dispose();
    throw error;
  }
  start = realNow();
  input.drain();
  // A hidden tab gets no animation frames. Leave that time out of the game clock, or on return
  // the simulation would play the whole gap back as fast catch-up steps at up to 240x speed.
  // A video export runs on its own clock and keeps going while the tab is hidden.
  let hiddenAt = document.hidden ? start : null;
  const onVisibility = () => {
    if (isVirtualTime()) { hiddenAt = null; return; }
    if (document.hidden) hiddenAt ??= realNow();
    else if (hiddenAt !== null) { start += realNow() - hiddenAt; hiddenAt = null; }
  };
  document.addEventListener('visibilitychange', onVisibility);
  const catchUp = () => simulation.advance(realNow() - start, time => clock.frame(() => instance.frame(input.drain(time))));
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
