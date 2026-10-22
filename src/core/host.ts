// Runs one puzzle on a canvas: builds its context, then calls frame() at up to 60 fps.
import { FrameClock } from './frame-clock';
import { loadUiFont } from './fonts';
import { Input } from './input';
import { Panel } from './panel';
import type { PuzzleFactory, PuzzleInstance, PuzzleMeta } from './puzzle';
import { Screen } from './screen';
import { Store } from './storage';
import { Simulation } from './simulation';

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
  let start = performance.now();
  const input = new Input(screen, () => performance.now() - start);
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
  start = performance.now();
  input.drain();
  const catchUp = () => simulation.advance(performance.now() - start, time => clock.frame(() => instance.frame(input.drain(time))));
  // Panel actions use the same logical time even if a display has not painted yet.
  for (const event of ['click', 'change', 'input']) panelRoot.addEventListener(event, catchUp, true);

  let stopped = false;
  let handle = 0;
  const loop = (now: number) => {
    if (stopped) return;
    handle = requestAnimationFrame(loop);
    simulation.advance(now - start, time => clock.frame(() => instance.frame(input.drain(time))));
    panel.sync();
  };
  handle = requestAnimationFrame(loop);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(handle);
      input.dispose();
      for (const event of ['click', 'change', 'input']) panelRoot.removeEventListener(event, catchUp, true);
      instance.dispose?.();
    },
  };
}
