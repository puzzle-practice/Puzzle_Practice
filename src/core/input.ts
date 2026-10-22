// Browser input queued until the puzzle's next simulation step.
//
// Game mouse button codes: 1 left, 2 middle, 3 right, 4 wheel up, 5 wheel down.
// Keys use KeyboardEvent.key, lower-cased, with ' ' renamed to 'space' (so 'a', '1',
// 'escape', 'enter', 'backspace', 'arrowleft', ...).
import { unlockAudio } from './audio';
import { isTyping } from './panel';
import { type Screen, toScreen } from './screen';

export type Point = [number, number];

export type InputEvent =
  | { type: 'mousedown' | 'mouseup'; button: number; pos: Point }
  | { type: 'keydown' | 'keyup'; key: string };

export class Input {
  /** Latest mouse position in screen pixels. */
  mouse: Point = [-1, -1];
  private queue: { at: number; event?: InputEvent; mouse: Point }[] = [];
  private pointer: Point = [-1, -1];
  private readonly cleanup: Array<() => void> = [];

  constructor(screen: Screen, private readonly now: () => number = () => performance.now()) {
    const canvas = screen.canvas;
    const listen = <K extends keyof WindowEventMap>(
      target: Window | HTMLElement,
      type: K,
      handler: (event: WindowEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, handler as EventListener, options);
      this.cleanup.push(() => target.removeEventListener(type, handler as EventListener, options));
    };
    const pos = (event: MouseEvent): Point => (this.pointer = toScreen(screen, event.clientX, event.clientY));
    const enqueue = (event?: InputEvent) => this.queue.push({ at: this.now(), event, mouse: [...this.pointer] });

    listen(canvas, 'mousedown', (event) => {
      event.preventDefault();
      canvas.focus();
      unlockAudio();
      enqueue({ type: 'mousedown', button: event.button + 1, pos: pos(event) });
    });
    listen(window, 'mouseup', (event) => {
      enqueue({ type: 'mouseup', button: event.button + 1, pos: pos(event) });
    });
    listen(window, 'mousemove', (event) => {
      pos(event);
      enqueue();
    });
    let wheelDistance = 0;
    listen(
      canvas,
      'wheel',
      (event) => {
        event.preventDefault();
        // One wheel event per notch; trackpads send many small deltas, so accumulate them.
        wheelDistance += event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY : event.deltaY * 40;
        if (Math.abs(wheelDistance) >= 50) {
          const button = wheelDistance < 0 ? 4 : 5;
          const at = pos(event);
          enqueue({ type: 'mousedown', button, pos: at }); enqueue({ type: 'mouseup', button, pos: at });
          wheelDistance = 0;
        }
      },
      { passive: false },
    );
    listen(canvas, 'contextmenu', (event) => event.preventDefault());
    listen(window, 'keydown', (event) => {
      // Typing in the settings panel isn't game input.
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      unlockAudio();
      const key = keyName(event);
      // Keep the page from scrolling while playing, including on held-key auto-repeats.
      if (SCROLL_KEYS.has(key)) event.preventDefault();
      if (event.repeat) return;
      enqueue({ type: 'keydown', key });
    });
    listen(window, 'keyup', (event) => {
      if (isTyping(event.target)) return;
      enqueue({ type: 'keyup', key: keyName(event) });
    });
  }

  /** Return and clear events received since the last call. */
  drain(until = Infinity): InputEvent[] {
    const events: InputEvent[] = [];
    let count = 0;
    for (const entry of this.queue) {
      if (entry.at > until) break;
      this.mouse = [...entry.mouse];
      if (entry.event) events.push(entry.event);
      count++;
    }
    this.queue.splice(0, count);
    return events;
  }

  dispose(): void {
    for (const remove of this.cleanup.splice(0)) remove();
  }
}

/** Keys whose browser default is to scroll the page. */
const SCROLL_KEYS = new Set(['space', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown', 'home', 'end']);

function keyName(event: KeyboardEvent): string {
  // Digits from the number row or keypad both report as the digit.
  return event.key === ' ' ? 'space' : event.key.toLowerCase();
}

/** True if (x, y) lies inside the inclusive box. */
export function within(pos: Point, x1: number, x2: number, y1: number, y2: number): boolean {
  return x1 <= pos[0] && pos[0] <= x2 && y1 <= pos[1] && pos[1] <= y2;
}
