import { unlockAudio } from '../../core/audio';
import type { Panel } from '../../core/panel';
import { toScreen, type Screen } from '../../core/screen';
import type { Store } from '../../core/storage';

type Point = readonly [number, number];
type GestureMode = 'swipe' | 'circular';

/** Converts pointer movement into discrete turns, without inertia after release. */
export class RingGesture {
  private previous: Point;
  private angle: number;
  private travel = 0;
  private horizontal = false;

  constructor(private readonly mode: GestureMode, start: Point, private readonly centre: Point, private readonly swipeStep = 32) {
    this.previous = start;
    this.angle = Math.atan2(start[1] - centre[1], start[0] - centre[0]);
  }

  /** Positive turns are clockwise. Distances are in viewport pixels. */
  move(point: Point): number {
    let step: number;
    if (this.mode === 'swipe') {
      const dx = point[0] - this.previous[0], dy = point[1] - this.previous[1];
      if (!this.horizontal) {
        if (Math.abs(dx) < this.swipeStep || Math.abs(dx) < Math.abs(dy) * 1.2) return 0;
        this.horizontal = true;
      }
      this.travel += dx;
      step = this.swipeStep;
    } else {
      // Crossing the centre has no useful rotation direction.
      if (Math.hypot(point[0] - this.centre[0], point[1] - this.centre[1]) < 16) return 0;
      const angle = Math.atan2(point[1] - this.centre[1], point[0] - this.centre[0]);
      this.travel += Math.atan2(Math.sin(angle - this.angle), Math.cos(angle - this.angle));
      this.angle = angle;
      step = Math.PI / 4;
    }
    this.previous = point;
    // Wheel dragging snaps to the nearest octant, with a small dead band at each midpoint.
    const turns = this.mode === 'circular'
      ? Math.abs(this.travel) >= step / 2 + Math.PI / 60 ? Math.round(this.travel / step) : 0
      : Math.trunc((this.travel + Math.sign(this.travel) * 1e-9) / step);
    this.travel -= turns * step;
    return turns;
  }
}

interface MobileState {
  active: boolean;
  settling: boolean;
  painting: boolean;
  rings: number;
  /** Ring indices count from the outside, as in the game. */
  selected: number;
  board: unknown;
  frame: number;
}

/** Pointer gestures and mobile buttons share recorded commands, independent of key remapping. */
export function mobileControls(screen: Screen, panel: Panel, store: Store, state: () => MobileState, command: (value: string) => void): () => void {
  let visible = store.get<boolean>('mobileControls', false) === true;
  let mode: GestureMode = store.get<string>('touchGesture', 'swipe') === 'circular' ? 'circular' : 'swipe';
  let dragging: { pointer: number; ring: number; board: unknown; gesture: RingGesture } | null = null;
  const pendingTurns: Array<{ ring: number; clockwise: boolean; board: unknown }> = [];
  let dispatchedFrame = -1;
  const settings = panel.controlSettings.group('Gestures');
  settings.toggle('Mobile controls', () => visible, on => { visible = on; store.set('mobileControls', on); });
  settings.select('Touch gesture', [{ value: 'swipe', label: 'Swipe left / right' }, { value: 'circular', label: 'Drag around ring' }] as const,
    () => mode, value => { mode = value; store.set('touchGesture', value); cancel(); });

  const canvas = screen.canvas;
  const stage = canvas.parentElement;
  // A detached canvas has no place to mount the controls.
  if (!stage) return () => {};
  const controls = document.createElement('div');
  controls.className = 'navigation-mobile-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Mobile navigation controls');
  canvas.insertAdjacentElement('afterend', controls);
  const buttons: Array<{ button: HTMLButtonElement; ring?: number }> = [];
  const send = (value: string, turn = false) => {
    const current = state();
    if (!current.active || (turn && current.settling)) return;
    unlockAudio();
    command(value);
  };
  const button = (parent: HTMLElement, text: string, label: string, action: () => void, ring?: number) => {
    const node = document.createElement('button');
    node.type = 'button'; node.className = 'panel-button'; node.textContent = text;
    node.setAttribute('aria-label', label); node.title = label;
    node.addEventListener('click', () => { cancel(); action(); canvas.focus({ preventScroll: true }); });
    parent.append(node); buttons.push({ button: node, ring });
    return node;
  };
  const rings = document.createElement('div'); rings.className = 'navigation-mobile-rings';
  for (let ring = 1; ring <= 4; ring++) button(rings, String(ring), `Select ring ${ring}${ring === 1 ? ' (innermost)' : ''}`,
    () => { if (ring <= state().rings) send(`ring:${ring}`); }, ring);
  const pad = document.createElement('div'); pad.className = 'navigation-mobile-pad';
  button(pad, '↑', 'Select outer ring', () => send('ringOut')).classList.add('navigation-mobile-up');
  button(pad, '←', 'Rotate left', () => send('ccw', true)).classList.add('navigation-mobile-left');
  button(pad, 'Drop', 'Drop star', () => send('drop', true)).classList.add('navigation-mobile-drop');
  button(pad, '→', 'Rotate right', () => send('cw', true)).classList.add('navigation-mobile-right');
  button(pad, '↓', 'Select inner ring', () => send('ringIn')).classList.add('navigation-mobile-down');
  controls.append(rings, pad);

  function cancel(clearTurns = true): void {
    if (clearTurns) pendingTurns.length = 0;
    const previous = dragging;
    dragging = null;
    if (previous && canvas.hasPointerCapture(previous.pointer)) canvas.releasePointerCapture(previous.pointer);
  }
  const listeners = new AbortController();
  const listen = (type: string, handler: (event: PointerEvent) => void) => canvas.addEventListener(type, handler as EventListener,
    { signal: listeners.signal, passive: false });
  listen('pointerdown', event => {
    const current = state();
    if (!current.active || current.painting) return;
    if (event.button !== 0) {
      if (event.button === 2) event.preventDefault();
      return;
    }
    // Suppress compatibility mouse input; selection and turns are recorded as commands.
    event.preventDefault();
    if (dragging || !event.isPrimary) return;
    const [x, y] = toScreen(screen, event.clientX, event.clientY);
    const distance = Math.hypot(x - 225, y - 300);
    const spacing = current.rings === 4 ? 47 : 55;
    const radius = 55 + (current.rings - 1) * spacing;
    if (distance < 30 || distance > radius + 28) return;
    const ring = Math.max(1, Math.min(current.rings, 1 + Math.round((distance - 55) / spacing)));
    const bounds = canvas.getBoundingClientRect();
    pendingTurns.length = 0;
    dragging = { pointer: event.pointerId, ring, board: current.board,
      // A mouse or stylus always follows the wheel; touch can use straight swipes instead.
      gesture: new RingGesture(event.pointerType === 'touch' ? mode : 'circular', [event.clientX, event.clientY],
        [bounds.left + 225 * bounds.width / screen.width, bounds.top + 300 * bounds.height / screen.height]) };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    send(`ring:${ring}`);
  });
  const move = (event: PointerEvent) => {
    if (!dragging || event.pointerId !== dragging.pointer) return;
    event.preventDefault();
    const current = state();
    if (!current.active || current.painting || current.board !== dragging.board) { cancel(); return; }
    const turns = dragging.gesture.move([event.clientX, event.clientY]);
    for (let i = 0; i < Math.abs(turns); i++) {
      const previous = pendingTurns.at(-1);
      // Reversing direction cancels turns that have not started yet.
      if (previous && previous.ring === dragging.ring && previous.clockwise !== (turns > 0)) pendingTurns.pop();
      else pendingTurns.push({ ring: dragging.ring, clockwise: turns > 0, board: dragging.board });
    }
  };
  listen('pointermove', move);
  listen('pointerup', event => { if (event.pointerId === dragging?.pointer) { move(event); cancel(false); } });
  listen('pointercancel', event => { if (event.pointerId === dragging?.pointer) cancel(); });
  listen('lostpointercapture', event => { if (event.pointerId === dragging?.pointer) cancel(); });
  panel.addSync(() => {
    const current = state();
    controls.hidden = !visible;
    if (dragging && (!current.active || current.painting || current.board !== dragging.board)) cancel();
    if (!current.active || current.painting || (pendingTurns.length && pendingTurns[0].board !== current.board)) pendingTurns.length = 0;
    // Dispatch one turn per simulation frame, once its preceding animation has settled.
    // These commands are recorded when dispatched, keeping replays independent of pointer speed.
    if (pendingTurns.length && !current.settling && current.frame !== dispatchedFrame) {
      const next = pendingTurns.shift()!;
      send(`turn:${next.ring}:${next.clockwise ? 'cw' : 'ccw'}`, true);
      dispatchedFrame = current.frame;
    }
    for (const { button, ring } of buttons) {
      // Animation changes are handled on press, so buttons do not flash on each turn.
      button.disabled = !current.active || (ring !== undefined && ring > current.rings);
      if (ring !== undefined) button.setAttribute('aria-pressed', String(ring === current.rings - current.selected));
    }
  });
  return () => { cancel(); listeners.abort(); controls.remove(); };
}
