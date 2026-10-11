// Runs one puzzle on a canvas: builds its context, then calls frame() at up to 60 fps.
import { FrameClock } from './frame-clock';
import { loadPygameFont } from './fonts';
import { Input } from './input';
import { Panel } from './panel';
import type { PuzzleFactory, PuzzleInstance, PuzzleMeta } from './puzzle';
import { Screen } from './screen';
import { Store } from './storage';

const FRAME_MS = 1000 / 60;

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
  const input = new Input(screen);
  const store = new Store(id);
  const panel = new Panel(panelRoot, canvas);
  panel.onUsed = () => canvas.focus();
  await loadPygameFont();
  const start = performance.now();
  const clock = new FrameClock(() => Math.floor(performance.now() - start));
  const { ticks, setReplayTime } = clock;

  let instance: PuzzleInstance;
  try {
    instance = await factory({ screen, input, panel, store, ticks, setReplayTime });
  } catch (error) {
    input.dispose();
    throw error;
  }

  let stopped = false;
  let handle = 0;
  let last = -Infinity;
  const loop = (now: number) => {
    if (stopped) return;
    handle = requestAnimationFrame(loop);
    // Hold high-refresh displays to 60 fps: several games step animations once per frame.
    if (now - last < FRAME_MS - 2) return;
    last = now;
    clock.frame(() => instance.frame(input.drain()));
    panel.sync();
  };
  handle = requestAnimationFrame(loop);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(handle);
      input.dispose();
      instance.dispose?.();
    },
  };
}
