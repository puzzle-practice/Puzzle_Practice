import { setReplayPirate } from './duty/profile';
import { readReport, showsDutyReport, type DutyReport } from './duty/report';
import type { InputEvent, Point } from './input';
import type { Panel } from './panel';
import { Store } from './storage';
import { readArchivedReplay, readReplayArchive, REPLAY_REMOVED, replayRetentionLimit } from './data-backups';
import { replayId, replayWrites, saveReplayFile, type ReplayMetadata } from './replay-storage';

/** A portable run: puzzle-specific settings and seed data plus the timestamped inputs. */
export interface PuzzleReplay {
  /** Unique even when two tabs start a run during the same millisecond. */
  runId?: string;
  format: 'puzzle-practice-replay';
  /** Version of the shared replay envelope and input timeline. */
  version: 1;
  puzzle: string;
  at: number;
  duration: number;
  /** Original clock origin, so fractional timer arithmetic is identical on every playback. */
  clockStart?: number;
  result: string;
  settings: unknown;
  /** Per-puzzle settings schema. Missing on legacy files and interpreted as version 1. */
  settingsVersion?: number;
  /** Puzzle simulation semantics at recording time; useful when rules change. */
  simulatorVersion?: number;
  /** Opaque replay state; this can be a board snapshot and PRNG state rather than a game seed. */
  seed: unknown;
  frames: ReplayFrame[];
  /** Original simulation frame times, independent of pointer compression and playback speed. */
  steps?: number[];
  /** The duty report the run ended with: who played it, their rating and what they cleared. Older files have none. */
  report?: DutyReport;
  /**
   * State checks: [time, hash of the puzzle's state after the inputs at that time]. Playback
   * compares its own state at the same times, so a replay that drifts from the game it recorded
   * says so instead of quietly showing a different game. Older files have none.
   */
  checks?: Array<[number, number]>;
}

/** Compact on-disk representation; playback expands this back into PuzzleReplay. */
export interface CompactPuzzleReplay {
  runId?: string;
  format: 'puzzle-practice-replay';
  version: 2;
  puzzle: string;
  at: number;
  duration: number;
  clockStart?: number;
  result: string;
  settings: unknown;
  settingsVersion?: number;
  simulatorVersion?: number;
  seed: unknown;
  frames: Array<Array<unknown>>;
  /** Delta-encoded simulation frame times. */
  steps?: number[];
  report?: DutyReport;
  /** Delta-encoded check times, each with its hash. */
  checks?: Array<[number, number]>;
}

/** Puzzle state as text for a replay check: functions are skipped, bigints written out and shared objects written once. */
export function stateText(...values: unknown[]): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(values, (_key, value: unknown) => {
    if (typeof value === 'function') return undefined;
    if (typeof value === 'bigint') return value.toString();
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '^';
      seen.add(value);
    }
    return value;
  });
}

/** FNV-1a: a short, stable hash of a puzzle's state for replay checks. */
export function stateHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

async function transformBytes(bytes: Uint8Array, format: 'gzip', direction: 'compress' | 'decompress'): Promise<Uint8Array> {
  const Stream = direction === 'compress' ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (!Stream) throw new Error(`${format} stream is unavailable`);
  const input = new Blob([bytes.slice().buffer as ArrayBuffer]).stream();
  const output = input.pipeThrough(new Stream(format));
  return new Uint8Array(await new Response(output).arrayBuffer());
}

export async function encodeReplayBlob(tape: PuzzleReplay): Promise<Blob> {
  const bytes = await transformBytes(new TextEncoder().encode(JSON.stringify(packReplay(tape))), 'gzip', 'compress');
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/gzip' });
}

export async function decodeReplayBlob(blob: Blob): Promise<PuzzleReplay | null> {
  try {
    const bytes = await transformBytes(new Uint8Array(await blob.arrayBuffer()), 'gzip', 'decompress');
    const decoded: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isCompactPuzzleReplay(decoded) ? unpackReplay(decoded) : null;
  } catch { return null; }
}

export function replayMetadata(tape: PuzzleReplay, bytes: number): ReplayMetadata {
  return { id: replayId(tape.puzzle, tape.at, tape.runId), ...(tape.runId ? { runId: tape.runId } : {}), puzzle: tape.puzzle, at: tape.at, duration: tape.duration,
    result: tape.result, settingsVersion: tape.settingsVersion ?? 1, simulatorVersion: tape.simulatorVersion ?? 1, bytes };
}

export interface ReplayAction {
  type: string;
  data?: unknown;
}

export interface ReplayFrame {
  t: number;
  mouse: Point;
  events: InputEvent[];
  commands?: string[];
  actions?: ReplayAction[];
}

/** Tuple layout: [t, mouseX, mouseY, mask, events?, commands?, actions?]. */
type CompactFrame = [number, number, number, number, ...unknown[]];
type CompactEvent = [number, number | string, number?, number?];

function isCompactPuzzleReplay(value: unknown): value is CompactPuzzleReplay {
  if (!value || typeof value !== 'object') return false;
  const tape = value as CompactPuzzleReplay;
  return tape.format === 'puzzle-practice-replay' && tape.version === 2 && typeof tape.puzzle === 'string' &&
    Number.isFinite(tape.at) && Number.isFinite(tape.duration) && tape.duration >= 0 && typeof tape.result === 'string' &&
    Array.isArray(tape.frames);
}

/** Packs repeated frame property names and event object keys into short positional tuples. */
export function packReplay(tape: PuzzleReplay): CompactPuzzleReplay {
  const frames: CompactFrame[] = tape.frames.map((frame) => {
    let mask = 0;
    if (frame.events.length) mask |= 1;
    if (frame.commands?.length) mask |= 2;
    if (frame.actions?.length) mask |= 4;
    const tuple: CompactFrame = [frame.t, frame.mouse[0], frame.mouse[1], mask];
    if (mask & 1) {
      tuple.push(frame.events.map((event): CompactEvent => {
        if ('key' in event) {
          return [event.type === 'keydown' ? 2 : 3, event.key];
        }
        const code = event.type === 'mousedown' ? 0 : 1;
        return event.pos[0] === frame.mouse[0] && event.pos[1] === frame.mouse[1]
          ? [code, event.button]
          : [code, event.button, event.pos[0], event.pos[1]];
      }));
    }
    if (mask & 2) tuple.push(frame.commands);
    if (mask & 4) tuple.push(frame.actions!.map((action) => action.data === undefined ? [action.type] : [action.type, action.data]));
    return tuple;
  });
  return {
    format: 'puzzle-practice-replay', version: 2, puzzle: tape.puzzle, at: tape.at, duration: tape.duration,
    ...(tape.runId ? { runId: tape.runId } : {}),
    ...(tape.clockStart !== undefined ? { clockStart: tape.clockStart } : {}),
    result: tape.result, settings: tape.settings, ...(tape.settingsVersion ? { settingsVersion: tape.settingsVersion } : {}),
    ...(tape.simulatorVersion ? { simulatorVersion: tape.simulatorVersion } : {}), seed: tape.seed, frames,
    ...(tape.steps ? { steps: tape.steps.map((time, index) => time - (tape.steps![index - 1] ?? 0)) } : {}),
    ...(tape.report ? { report: tape.report } : {}),
    ...(tape.checks?.length ? { checks: tape.checks.map(([time, hash], index): [number, number] => [time - (tape.checks![index - 1]?.[0] ?? 0), hash]) } : {}),
  };
}

/** Expands a current compact file or passes through a legacy v1 replay. */
export function unpackReplay(value: unknown): PuzzleReplay | null {
  if (isPuzzleReplay(value)) return withReport(value, value.report);
  if (!isCompactPuzzleReplay(value)) return null;
  try {
    const frames = value.frames.map((raw): ReplayFrame => {
      const [t, mouseX, mouseY, mask, ...payloads] = raw as CompactFrame;
      if (!Number.isFinite(t) || !Number.isFinite(mouseX) || !Number.isFinite(mouseY) || !Number.isInteger(mask) || mask < 0 || mask > 7) {
        throw new Error('invalid compact frame');
      }
      let payloadIndex = 0;
      let events: InputEvent[] = [];
      let commands: string[] | undefined;
      let actions: ReplayAction[] | undefined;
      if (mask & 1) {
        const packedEvents = payloads[payloadIndex++];
        if (!Array.isArray(packedEvents)) throw new Error('invalid compact events');
        events = packedEvents.map((event): InputEvent => {
          if (!Array.isArray(event)) throw new Error('invalid compact event');
          const [code, value, dx, dy] = event as CompactEvent;
          if (code === 0 || code === 1) {
            if (typeof value !== 'number' || (event.length !== 2 && (typeof dx !== 'number' || typeof dy !== 'number'))) {
              throw new Error('invalid compact mouse event');
            }
            return { type: code === 0 ? 'mousedown' : 'mouseup', button: value, pos: event.length === 2 ? [mouseX, mouseY] : [dx!, dy!] };
          }
          if ((code === 2 || code === 3) && typeof value === 'string') return { type: code === 2 ? 'keydown' : 'keyup', key: value };
          throw new Error('invalid compact keyboard event');
        });
      }
      if (mask & 2) {
        const value = payloads[payloadIndex++];
        if (!Array.isArray(value) || !value.every((command) => typeof command === 'string')) throw new Error('invalid compact commands');
        commands = value as string[];
      }
      if (mask & 4) {
        const value = payloads[payloadIndex++];
        if (!Array.isArray(value)) throw new Error('invalid compact actions');
        actions = value.map((action): ReplayAction => {
          if (!Array.isArray(action) || typeof action[0] !== 'string' || action.length > 2) throw new Error('invalid compact action');
          return action.length === 2 ? { type: action[0], data: action[1] } : { type: action[0] };
        });
      }
      if (payloadIndex !== payloads.length) throw new Error('unexpected compact payload');
      return { t, mouse: [mouseX, mouseY], events, ...(commands ? { commands } : {}), ...(actions ? { actions } : {}) };
    });
    let time = 0;
    const steps = value.steps?.map((delta) => time += delta);
    let checkTime = 0;
    const checks = Array.isArray(value.checks) ? value.checks.map((check): [number, number] => {
      if (!Array.isArray(check) || check.length !== 2 || !Number.isFinite(check[0]) || !Number.isInteger(check[1])) throw new Error('invalid check');
      return [checkTime += check[0], check[1]];
    }) : undefined;
    const replay: PuzzleReplay = {
      format: 'puzzle-practice-replay', version: 1, puzzle: value.puzzle, at: value.at, duration: value.duration,
      result: value.result, settings: value.settings, seed: value.seed, frames,
      ...(value.runId ? { runId: value.runId } : {}),
      ...(value.clockStart !== undefined ? { clockStart: value.clockStart } : {}),
      ...(value.settingsVersion ? { settingsVersion: value.settingsVersion } : {}),
      ...(value.simulatorVersion ? { simulatorVersion: value.simulatorVersion } : {}),
      ...(steps ? { steps } : {}),
      ...(checks?.length ? { checks } : {}),
    };
    return isPuzzleReplay(replay) ? withReport(replay, value.report) : null;
  } catch { return null; }
}

/** A replay keeps its report only if the report reads back cleanly; a damaged one is dropped, not the replay. */
function withReport(tape: PuzzleReplay, report: unknown): PuzzleReplay {
  const { report: _, ...rest } = tape;
  const clean = report === undefined ? null : readReport(report);
  return clean ? { ...rest, report: clean } : rest;
}

/** Each puzzle owns its settings schema and migrations; the replay envelope stays shared. */
export interface ReplaySettingsCodec {
  currentVersion: number;
  simulatorVersion?: number;
  migrate(version: number, settings: unknown): unknown | null;
}

const DEFAULT_SETTINGS_CODEC: ReplaySettingsCodec = {
  currentVersion: 1,
  simulatorVersion: 1,
  migrate: (version, settings) => version === 1 && !!settings && typeof settings === 'object' ? settings : null,
};

/** Decode historical settings without changing the archived replay itself. */
export function decodeReplaySettings(tape: PuzzleReplay, codec: ReplaySettingsCodec): unknown | null {
  const version = tape.settingsVersion ?? 1;
  if (version > codec.currentVersion) return null;
  try { return codec.migrate(version, structuredClone(tape.settings)); }
  catch { return null; }
}

export function compressReplay(tape: PuzzleReplay): PuzzleReplay {
  const heldButtons = new Set<number>();
  const heldKeys = new Set<string>();
  const frames = tape.frames.filter((frame, index) => {
    const wasHeld = heldButtons.size > 0 || heldKeys.size > 0;
    for (const event of frame.events) {
      if (event.type === 'mousedown') heldButtons.add(event.button);
      else if (event.type === 'mouseup') heldButtons.delete(event.button);
      else if (event.type === 'keydown') heldKeys.add(event.key);
      else if (event.type === 'keyup') heldKeys.delete(event.key);
    }
    const meaningful = frame.events.length > 0 || (frame.commands?.length ?? 0) > 0 || (frame.actions?.length ?? 0) > 0;
    // Distilling's held-mouse path causes match swaps and create-mode painting. Carpentry applies
    // a drag at release, so it needs the pickup/release coordinates but not cursor samples between.
    // The last hover sample before a key press establishes keyboard cursor/selection state.
    const beforeKey = tape.frames[index + 1]?.events.some((event) => event.type === 'keydown');
    return meaningful || !!beforeKey || (tape.puzzle === 'distilling' && (wasHeld || heldButtons.size > 0 || heldKeys.size > 0));
  });
  return {
    ...tape,
    frames,
  };
}

export function isPuzzleReplay(value: unknown, puzzle?: string): value is PuzzleReplay {
  if (!value || typeof value !== 'object') return false;
  const r = value as PuzzleReplay;
  if (r.format !== 'puzzle-practice-replay' || r.version !== 1 || typeof r.puzzle !== 'string' ||
      (r.runId !== undefined && (typeof r.runId !== 'string' || !/^[a-f0-9-]{36}$/.test(r.runId))) ||
      (puzzle !== undefined && r.puzzle !== puzzle) || !Number.isFinite(r.at) ||
      !Number.isFinite(r.duration) || r.duration < 0 || typeof r.result !== 'string' ||
      (r.clockStart !== undefined && (!Number.isFinite(r.clockStart) || r.clockStart < 0)) ||
      (r.settingsVersion !== undefined && (!Number.isInteger(r.settingsVersion) || r.settingsVersion < 1)) ||
      (r.simulatorVersion !== undefined && (!Number.isInteger(r.simulatorVersion) || r.simulatorVersion < 1)) ||
      !Array.isArray(r.frames)) return false;
  if (r.checks !== undefined && (!Array.isArray(r.checks) || r.checks.some((check, i) => !Array.isArray(check) || check.length !== 2 ||
      !Number.isFinite(check[0]) || check[0] < 0 || !Number.isInteger(check[1]) || (i > 0 && check[0] < r.checks![i - 1][0])))) return false;
  if (r.steps !== undefined && (!Array.isArray(r.steps) || r.steps.some((t, i) =>
      !Number.isFinite(t) || t < 0 || t > r.duration || (i > 0 && t < r.steps![i - 1])))) return false;
  let previous = -1;
  for (const frame of r.frames) {
    if (!frame || !Number.isFinite(frame.t) || frame.t < previous || frame.t < 0 || frame.t > r.duration ||
        !Array.isArray(frame.mouse) || frame.mouse.length !== 2 || !frame.mouse.every(Number.isFinite) ||
        !Array.isArray(frame.events) || (frame.commands !== undefined && (!Array.isArray(frame.commands) || !frame.commands.every((c) => typeof c === 'string'))) ||
        (frame.actions !== undefined && (!Array.isArray(frame.actions) || !frame.actions.every((a) => !!a && typeof a.type === 'string')))) return false;
    previous = frame.t;
    for (const e of frame.events) {
      if (!e || (e.type !== 'mousedown' && e.type !== 'mouseup' && e.type !== 'keydown' && e.type !== 'keyup')) return false;
      if (e.type === 'keydown' || e.type === 'keyup') {
        if (typeof e.key !== 'string') return false;
      } else if (!('button' in e) || !Number.isFinite(e.button) || !Array.isArray(e.pos) || e.pos.length !== 2 || !e.pos.every(Number.isFinite)) return false;
    }
  }
  return true;
}


interface RoutedReplayFrame {
  events: InputEvent[]; mouse: Point; commands: string[];
  actions: Array<{ t: number; action: ReplayAction }>; elapsed: number; renderOnly: boolean;
}
interface Playback {
  tape: PuzzleReplay; start: number; elapsed: number; lastReal: number; paused: boolean;
  speed: number; frame: number; step: number; mouse: Point; finishPending: boolean;
  clicks: Array<{ t: number; x: number; y: number; button: number }>;
  /** The next state check to compare, and when playback first differed from the recording. */
  check: number; divergedAt: number | null;
}

/** List metadata eagerly; load binary payloads and decoded tapes only when needed. */
export class ReplayRecorder {
  private tapes: ReplayMetadata[] = [];
  private readonly tapeIndices = new Map<string, number>();
  private readonly atIndices = new Map<number, number>();
  private totalBytes = 0;
  private readonly decoded = new Map<string, PuzzleReplay>();
  private readonly blobs = new WeakMap<PuzzleReplay, Promise<Blob>>();
  private readonly compatibility = new Map<string, boolean>();
  private readonly settingsCache = new WeakMap<PuzzleReplay, unknown | null>();
  private recording: PuzzleReplay | null = null;
  private recordStart = 0;
  private previousMouse: Point = [-1, -1];
  private pendingMouse: ReplayFrame | null = null;
  private playback: Playback | null = null;
  private injected: RoutedReplayFrame | null = null;
  private advancing = false;
  private selected = 0;
  private restoring = false;
  private seeking = false;
  private loading = false;
  private disposed = false;
  private request = 0;
  private jumpSeconds = 0;
  private scrubSeconds: number | null = null;
  private replaySpeed = 1;
  private compressRecording = true;
  private replayStorageError = '';
  private lastAt = 0;
  private readonly preferences = new Store('global');
  private readonly mouseButtonsDown = new Set<number>();
  private readonly keysDown = new Set<string>();
  /** When a recorded input's effect still needs checking: the next frame hashes the state it left. */
  private pendingCheck: number | null = null;
  /** When the last replay watched first differed from its recording; null if it never did. */
  divergedAt: number | null = null;
  /**
   * The puzzle's state, as text, for replay checks: anything the inputs change that decides how
   * the game goes on (the board, the score, timers). Without it, replays aren't checked.
   */
  fingerprint: (() => string) | null = null;
  private readonly picker = document.createElement('select');
  private readonly file = document.createElement('input');
  /** Ends the player's own game, the way its Stop button does; set by the puzzle. */
  private stopLive?: () => void;

  constructor(
    private readonly puzzle: string, private readonly store: Store, private readonly panel: Panel,
    private readonly ticks: () => number,
    private readonly restore: (tape: PuzzleReplay) => void,
    private readonly stopRestored?: () => void,
    private readonly validateSeed: (seed: unknown) => boolean = () => true,
    private readonly setReplayTime?: (milliseconds: number | null) => void,
    private readonly stepFrame?: () => void,
    private readonly settingsCodec: ReplaySettingsCodec = DEFAULT_SETTINGS_CODEC,
    private readonly canStartPlayback: () => boolean = () => true,
  ) {
    const group = panel.tab('History').group('Replays', { title: 'Recorded controls and the run setup are included in shareable files' });
    this.picker.className = 'panel-select';
    this.picker.setAttribute('aria-label', 'Replay');
    this.picker.addEventListener('change', () => { this.selected = Number(this.picker.value) || 0; });
    group.append(this.picker);
    group.button('Play', () => {
      if (!this.playback) void this.playSelected(); else this.togglePause();
    }, { label: () => this.loading ? 'Loading…' : !this.playback ? 'Play' : this.playback.paused ? 'Resume' : 'Pause',
      disabled: () => this.loading || !this.tapes.length || !!this.recording || (!this.playback && (!this.canPlay(this.tapes[this.selected]) || !this.canStartPlayback())) })
    .button('Stop', () => this.stopPlayback(), { disabled: () => !this.playback && !this.loading })
    .range('Replay time (s)', () => this.scrubSeconds ?? (this.playback ? this.playback.elapsed / 1000 : this.jumpSeconds), (seconds) => {
      this.jumpSeconds = seconds; this.scrubSeconds = seconds;
    }, { min: 0, maxValue: () => (this.currentTape()?.duration ?? 0) / 1000, step: 0.1,
      formatValue: (seconds) => String(Math.round(seconds)), outputWidth: 4,
      disabled: () => !this.tapes.length || !!this.recording || this.loading,
      onCommit: () => { void this.jumpSelected(); this.scrubSeconds = null; } })
    .button('Save replay file', () => void this.download(), { disabled: () => !this.tapes.length || this.loading })
    .button('Report', () => void this.showSelectedReport(), {
      title: 'Show the duty report this replay ended with', disabled: () => !this.tapes.length || this.loading,
    });
    group.select('Playback speed', [
      { value: 0.25, label: '0.25×' }, { value: 0.5, label: '0.5×' }, { value: 1, label: '1×' },
      { value: 2, label: '2×' }, { value: 4, label: '4×' },
    ], () => this.replaySpeed, (speed) => {
      this.replaySpeed = speed; if (this.playback) this.playback.speed = speed;
    });
    group.number('Jump to (s)', () => this.jumpSeconds, (seconds) => {
      this.jumpSeconds = Math.max(0, Math.min((this.currentTape()?.duration ?? 0) / 1000, seconds));
    }, { min: 0, step: 0.1, disabled: () => !this.tapes.length || this.loading });
    group.button('Jump', () => void this.jumpSelected(), { disabled: () => !this.tapes.length || this.loading || !!this.recording || !this.stepFrame || !this.setReplayTime || !this.canStartPlayback() || !this.canPlay(this.tapes[this.selected]) });
    this.file.type = 'file'; this.file.accept = '.gz,application/gzip'; this.file.hidden = true;
    this.file.addEventListener('change', () => void this.importFile());
    group.button('Open replay file', () => this.file.click()).append(this.file);
    group.note(() => {
      const tape = this.currentTape();
      if (!tape) return this.replayStorageError || 'No replays recorded yet.';
      const drift = this.playback?.divergedAt ?? null;
      const warning = (this.replayStorageError ? ' · ' + this.replayStorageError : '') +
        (drift !== null ? ' · This replay drifted from the game it recorded at ' + (drift / 1000).toFixed(1) + 's' : '');
      return (tape.duration / 1000).toFixed(1) + 's · ' + (tape.bytes / 1024).toFixed(1) + ' KB · ' +
        (this.totalBytes / 1024).toFixed(1) + ' KB archived (' + this.tapes.length + ' replays)' + warning;
    });
    this.syncPicker();
    void this.loadTapes();
    if (typeof window !== 'undefined') window.addEventListener(REPLAY_REMOVED, this.forget);
  }

  /** A replay was deleted from the History tab: it leaves the list (and stops if it's playing). */
  private readonly forget = (event: Event): void => {
    const id = (event as CustomEvent<string>).detail;
    const index = this.tapeIndices.get(id);
    if (index === undefined) return;
    if (this.playback && replayId(this.puzzle, this.playback.tape.at, this.playback.tape.runId) === id) this.stopPlayback();
    const selectedId = this.tapes[this.selected]?.id;
    this.tapes.splice(index, 1);
    this.decoded.delete(id); this.compatibility.delete(id);
    this.reindex();
    this.selected = Math.max(0, this.tapes.findIndex((entry) => entry.id === selectedId));
    this.syncPicker();
  };

  begin(settings: unknown, seed: unknown, start = this.ticks()): void {
    if (!this.isPlaying) this.closeReplayReport();
    if (this.isPlaying || this.disposed || !this.preferences.get<boolean>('saveReplays', true) ||
        !this.preferences.get<boolean>('saveHistory', true)) return;
    ++this.request;
    this.loading = false;
    if (this.recording) this.finish('Stopped');
    this.compressRecording = this.preferences.get<boolean>('compressReplays', true);
    this.recordStart = start; this.previousMouse = [-1, -1]; this.pendingMouse = null; this.pendingCheck = null;
    this.mouseButtonsDown.clear(); this.keysDown.clear();
    this.lastAt = Math.max(Date.now(), this.lastAt + 1);
    this.recording = { format: 'puzzle-practice-replay', version: 1, puzzle: this.puzzle, at: this.lastAt, duration: 0,
      runId: crypto.randomUUID(),
      clockStart: start,
      settingsVersion: this.settingsCodec.currentVersion, simulatorVersion: this.settingsCodec.simulatorVersion ?? 1,
      result: 'In progress', settings: structuredClone(settings), seed: structuredClone(seed), frames: [], steps: [],
      ...(this.fingerprint ? { checks: [] } : {}) };
  }

  /** Ends the recording; the report, if given, is saved with it. */
  finish(result: string, report?: DutyReport | null): PuzzleReplay | null {
    if (!this.recording || this.isPlaying) return null;
    this.recording.duration = Math.max(this.recording.duration, this.ticks() - this.recordStart);
    this.recording.result = result;
    if (report) this.recording.report = structuredClone(report);
    // A pending check would hash the state partway through the frame that is ending the run.
    this.pendingCheck = null;
    if (this.recording.checks && !this.recording.checks.length) delete this.recording.checks;
    const finished = this.compressRecording ? compressReplay(this.recording) : this.recording;
    this.recording = null; this.pendingMouse = null;
    this.addTape(finished);
    void this.persistTape(finished);
    return finished;
  }
  private addTape(tape: PuzzleReplay): void {
    const entry = replayMetadata(tape, 0);
    this.tapes = [entry, ...this.tapes.filter((item) => item.id !== entry.id)].sort((a, b) => b.at - a.at);
    this.reindex();
    this.remember(entry.id, tape);
    this.compatibility.set(entry.id, this.validateTape(tape));
    this.selected = this.tapes.findIndex((item) => item.id === entry.id);
    this.syncPicker();
  }
  updateSeed(seed: unknown): void { if (this.recording) this.recording.seed = structuredClone(seed); }
  command(command: string, now = this.ticks()): void {
    if (!this.recording) return;
    this.pendingMouse = null;
    const t = Math.max(0, now - this.recordStart);
    this.recording.duration = Math.max(this.recording.duration, t);
    this.recording.frames.push({ t, mouse: [...this.previousMouse], events: [], commands: [command] });
    this.pendingCheck = t;
  }

  frame(events: InputEvent[], mouse: Point, now: number): RoutedReplayFrame {
    if (this.injected) return this.injected;
    if (this.playback) {
      const p = this.playback;
      if (p.finishPending) {
        this.stopPlayback();
        // The run is over: show the report it was saved with, as it was then.
        if (p.tape.report && showsDutyReport(p.tape.report)) this.panel.showReport?.(p.tape.report);
        return this.routed([], p.mouse, p.elapsed);
      }
      const realNow = performance.now();
      const target = p.paused ? p.elapsed : Math.min(p.tape.duration, p.elapsed + Math.max(0, realNow - p.lastReal) * p.speed);
      p.lastReal = realNow;
      this.advancePlayback(target);
      this.setReplayTime?.(p.start + p.elapsed);
      if (!p.paused && p.elapsed >= p.tape.duration && p.frame >= p.tape.frames.length) p.finishPending = true;
      // Inputs were applied inside individual simulation steps; the caller paints the final state.
      return { ...this.routed([], p.mouse, p.elapsed), renderOnly: true };
    }
    if (this.recording) {
      const t = Math.max(0, now - this.recordStart);
      // The frame before has finished: hash the state its inputs left, before this frame changes it.
      if (this.pendingCheck !== null && this.fingerprint && this.recording.checks) {
        this.recording.checks.push([this.pendingCheck, stateHash(this.fingerprint())]);
      }
      this.pendingCheck = null;
      this.recording.duration = Math.max(this.recording.duration, t);
      this.recording.steps!.push(t);
      const changed = mouse[0] !== this.previousMouse[0] || mouse[1] !== this.previousMouse[1];
      const wasHeld = this.mouseButtonsDown.size > 0 || this.keysDown.size > 0;
      for (const event of events) {
        if (event.type === 'mousedown') this.mouseButtonsDown.add(event.button);
        else if (event.type === 'mouseup') this.mouseButtonsDown.delete(event.button);
        else if (event.type === 'keydown') this.keysDown.add(event.key);
        else if (event.type === 'keyup') this.keysDown.delete(event.key);
      }
      if (events.some((event) => event.type === 'keydown') && this.pendingMouse) {
        this.recording.frames.push(this.pendingMouse); this.pendingMouse = null;
      }
      const keepPath = this.puzzle === 'distilling' && (wasHeld || this.mouseButtonsDown.size > 0 || this.keysDown.size > 0);
      const frame: ReplayFrame = { t, mouse: [...mouse],
        events: events.map((event) => 'key' in event ? { ...event } : { ...event, pos: [...event.pos] as Point }) };
      if (events.length || (changed && (!this.compressRecording || keepPath))) {
        this.recording.frames.push(frame); this.pendingMouse = null;
        if (events.length) this.pendingCheck = t;
      } else if (changed) this.pendingMouse = frame;
      this.previousMouse = [...mouse];
    }
    return this.routed(events, mouse, 0);
  }
  private routed(events: InputEvent[], mouse: Point, elapsed: number): RoutedReplayFrame {
    return { events, mouse, elapsed, commands: [], actions: [], renderOnly: false };
  }
  /** Normal playback, fast playback and seeking share the same timestamp-ordered stepping. */
  private advancePlayback(target: number): void {
    const p = this.playback;
    if (!p || !this.stepFrame) return;
    this.advancing = true;
    try {
      for (;;) {
        const nextFrame = p.tape.frames[p.frame];
        const stepTime = p.tape.steps ? p.tape.steps[p.step] ?? Infinity : (p.step + 1) * 1000 / 60;
        const time = Math.min(stepTime, nextFrame?.t ?? Infinity);
        if (time > target) break;
        if (stepTime === time) p.step++;
        p.elapsed = time;
        this.setReplayTime?.(p.start + time);
        let routed = this.routed([], p.mouse, time);
        if (nextFrame && nextFrame.t <= time) {
          p.frame++; p.mouse = [...nextFrame.mouse];
          routed = { events: nextFrame.events, mouse: p.mouse, elapsed: time,
            commands: nextFrame.commands ?? [], actions: (nextFrame.actions ?? []).map((action) => ({ t: nextFrame.t, action })), renderOnly: false };
          for (const event of nextFrame.events) if (event.type === 'mousedown' && (event.button === 1 || event.button === 3)) {
            p.clicks.push({ t: time, x: event.pos[0], y: event.pos[1], button: event.button });
          }
        }
        this.injected = routed;
        this.stepFrame();
        this.injected = null;
        this.compareCheck(time);
      }
      p.elapsed = target;
    } finally { this.injected = null; this.advancing = false; }
  }
  /** Playback has run the step at `time`: its state must hash the same as the recording's did. */
  private compareCheck(time: number): void {
    const p = this.playback;
    const checks = p?.tape.checks;
    if (!p || !checks || !this.fingerprint) return;
    while (p.check < checks.length && checks[p.check][0] < time) p.check++;
    if (p.check >= checks.length || checks[p.check][0] !== time) return;
    const [, expected] = checks[p.check++];
    if (p.divergedAt === null && stateHash(this.fingerprint()) !== expected) {
      p.divergedAt = time;
      this.divergedAt = time;
      console.warn(`${this.puzzle} replay drifted from its recording at ${(time / 1000).toFixed(3)}s`);
    }
  }
  action(action: ReplayAction, now = this.ticks()): void {
    if (!this.recording) return;
    this.pendingMouse = null;
    const t = Math.max(0, now - this.recordStart);
    this.pendingCheck = t;
    this.recording.duration = Math.max(this.recording.duration, t);
    const last = this.recording.frames[this.recording.frames.length - 1];
    const frame = last?.t === t ? last : { t, mouse: [...this.previousMouse] as Point, events: [] };
    if (frame !== last) this.recording.frames.push(frame);
    (frame.actions ??= []).push(structuredClone(action));
  }
  cancel(): void { this.recording = null; this.pendingMouse = null; }
  get isPlaying(): boolean { return !!this.playback || this.restoring; }
  /** Closes the replay being watched, e.g. when the player starts a game of their own. */
  stop(): void { if (this.playback || this.loading) this.stopPlayback(); }
  get isPaused(): boolean { return !!this.playback?.paused; }
  get isSeeking(): boolean { return this.seeking; }
  get isAdvancing(): boolean { return this.advancing; }
  get elapsedMs(): number { return this.playback?.elapsed ?? 0; }
  get speed(): number { return this.playback?.speed ?? this.replaySpeed; }
  dispose(): void {
    if (this.disposed) return;
    if (this.playback) this.stopPlayback(); else this.finish('Stopped when leaving puzzle');
    this.disposed = true; ++this.request;
    if (typeof window !== 'undefined') window.removeEventListener(REPLAY_REMOVED, this.forget);
  }
  private stopPlayback(): void {
    ++this.request; this.loading = false;
    // Cleanup is still playback, so it cannot save player scores.
    try { if (this.playback) this.stopRestored?.(); }
    finally {
      this.playback = null;
      this.store.setReadOnly(false);
      this.setReplayTime?.(null);
      if (!this.disposed) this.syncPicker();
    }
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const p = this.playback;
    if (!p || this.seeking || this.advancing) return;
    p.clicks = p.clicks.filter((click) => p.elapsed - click.t < 450);
    ctx.save();
    for (const click of p.clicks) {
      const age = Math.max(0, (p.elapsed - click.t) / 450);
      ctx.globalAlpha = 1 - age; ctx.strokeStyle = click.button === 3 ? '#ffb347' : '#7fd4ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(click.x, click.y, 6 + age * 14, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const [x, y] = p.mouse;
    if (x >= 0) {
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, y + 17); ctx.lineTo(x + 4.5, y + 13);
      ctx.lineTo(x + 7.5, y + 19.5); ctx.lineTo(x + 10, y + 18.5);
      ctx.lineTo(x + 7, y + 12); ctx.lineTo(x + 12, y + 12); ctx.closePath();
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
    }
    ctx.font = '20px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.lineWidth = 4; ctx.strokeStyle = '#1a1020'; ctx.fillStyle = '#fff';
    ctx.strokeText('Replay ' + p.speed + 'x', 444, 6); ctx.fillText('Replay ' + p.speed + 'x', 444, 6); ctx.restore();
  }

  async playAt(at: number, runId?: string): Promise<boolean> {
    if (this.recording || !this.canStartPlayback()) return false;
    const index = this.indexFor(at, runId);
    if (index < 0 || !this.canPlay(this.tapes[index])) return false;
    if (this.playback) this.stopPlayback();
    this.selected = index; this.syncPicker(); await this.playSelected();
    return !!this.playback;
  }
  hasPlayableAt(at: number, runId?: string): boolean {
    const tape = this.tapes[this.indexFor(at, runId)];
    return !!tape && this.canPlay(tape) && this.canStartPlayback() && !this.recording && !this.loading;
  }
  private async playSelected(): Promise<void> {
    const entry = this.tapes[this.selected];
    if (!entry || this.recording || !this.canPlay(entry) || !this.canStartPlayback() || this.disposed) return;
    const request = ++this.request; this.loading = true;
    try {
      const tape = await this.loadTape(entry);
      if (request !== this.request || this.disposed || this.recording || !this.canStartPlayback()) return;
      const base = tape?.clockStart ?? 0; this.setReplayTime?.(base);
      if (!tape || !this.restoreTape(tape)) { this.setReplayTime?.(null); return; }
      this.divergedAt = null;
      this.playback = { tape, start: base, elapsed: 0, lastReal: performance.now(), paused: false,
        speed: this.replaySpeed, frame: 0, step: 0, mouse: [-1, -1], finishPending: false, clicks: [], check: 0, divergedAt: null };
      this.jumpSeconds = 0; this.syncPicker();
    } catch { this.replayStorageError = 'This replay could not be loaded. Check browser storage or folder access.'; }
    finally { if (request === this.request) this.loading = false; }
  }
  private async jumpSelected(): Promise<void> {
    if (!this.stepFrame || !this.setReplayTime || this.recording || this.loading || !this.canStartPlayback()) return;
    const entry = this.currentTape();
    if (!entry || !this.canPlay(entry)) return;
    const target = Math.min(entry.duration, Math.max(0, this.jumpSeconds * 1000));
    const paused = this.playback?.paused ?? true;
    const request = ++this.request; this.loading = true;
    try {
      const tape = await this.loadTape(entry);
      if (!tape || request !== this.request || this.disposed || this.recording || !this.canStartPlayback()) return;
      this.seeking = true;
      const base = tape.clockStart ?? 0;
      this.setReplayTime(base);
      if (!this.restoreTape(tape)) { this.setReplayTime(null); return; }
      this.divergedAt = null;
      this.playback = { tape, start: base, elapsed: 0, lastReal: performance.now(), paused,
        speed: this.replaySpeed, frame: 0, step: 0, mouse: [-1, -1], finishPending: false, clicks: [], check: 0, divergedAt: null };
      this.setReplayTime(base); this.advancePlayback(target);
      this.playback.lastReal = performance.now(); this.jumpSeconds = target / 1000; this.syncPicker();
    } catch { this.replayStorageError = 'This replay could not be loaded or reconstructed.'; }
    finally { this.seeking = false; if (request === this.request) this.loading = false; }
  }
  private currentTape(): ReplayMetadata | undefined {
    return this.playback ? this.tapes[this.indexFor(this.playback.tape.at, this.playback.tape.runId)] : this.tapes[this.selected];
  }
  private indexFor(at: number, runId?: string): number {
    return (runId ? this.tapeIndices.get(replayId(this.puzzle, at, runId)) : this.atIndices.get(at)) ?? -1;
  }
  private reindex(): void {
    this.tapeIndices.clear(); this.atIndices.clear(); this.totalBytes = 0;
    this.tapes.forEach((entry, index) => {
      this.tapeIndices.set(entry.id, index);
      if (!this.atIndices.has(entry.at)) this.atIndices.set(entry.at, index);
      this.totalBytes += entry.bytes;
    });
  }
  private async loadTapes(): Promise<void> {
    try {
      const archived = await readReplayArchive(this.puzzle);
      if (this.disposed) return;
      const selectedId = this.tapes[this.selected]?.id;
      const all = new Map(archived.map((entry) => [entry.id, entry]));
      for (const entry of this.tapes) all.set(entry.id, entry);
      this.tapes = [...all.values()].sort((a, b) => b.at - a.at);
      this.reindex();
      this.lastAt = Math.max(this.lastAt, this.tapes[0]?.at ?? 0);
      const index = this.tapes.findIndex((entry) => entry.id === selectedId);
      this.selected = index >= 0 ? index : Math.min(this.selected, Math.max(0, this.tapes.length - 1));
      this.syncPicker();
    } catch { this.replayStorageError = 'The replay archive could not be listed.'; }
  }
  private blob(tape: PuzzleReplay): Promise<Blob> {
    let blob = this.blobs.get(tape);
    if (!blob) { blob = encodeReplayBlob(tape); this.blobs.set(tape, blob); }
    return blob;
  }
  private persistTape(tape: PuzzleReplay): Promise<void> {
    // Queue before compression, so exports/navigation can wait for pending recordings.
    return replayWrites.run(async () => {
      const blob = await this.blob(tape);
      const metadata = await saveReplayFile({ metadata: replayMetadata(tape, blob.size), blob });
      const index = this.tapeIndices.get(metadata.id);
      if (index !== undefined) {
        this.totalBytes += metadata.bytes - this.tapes[index].bytes;
        this.tapes[index] = metadata;
      }
      this.replayStorageError = '';
    }).catch(() => { this.replayStorageError = 'This replay could not be saved. Keep a replay file before leaving.'; });
  }
  private remember(id: string, tape: PuzzleReplay): void {
    this.decoded.delete(id); this.decoded.set(id, tape);
    while (this.decoded.size > replayRetentionLimit()) this.decoded.delete(this.decoded.keys().next().value!);
  }
  private async loadTape(entry: ReplayMetadata): Promise<PuzzleReplay | null> {
    const cached = this.decoded.get(entry.id);
    if (cached) { this.remember(entry.id, cached); return cached; }
    const blob = await readArchivedReplay(entry);
    const tape = blob ? await decodeReplayBlob(blob) : null;
    if (!tape || tape.puzzle !== this.puzzle || tape.at !== entry.at || tape.runId !== entry.runId || !this.validateTape(tape)) {
      this.compatibility.set(entry.id, false);
      this.replayStorageError = 'This replay is damaged or unsupported by this version.'; this.syncPicker();
      return null;
    }
    this.blobs.set(tape, Promise.resolve(blob!)); this.remember(entry.id, tape); this.compatibility.set(entry.id, true);
    return tape;
  }
  private migratedSettings(tape: PuzzleReplay): unknown | null {
    if (!this.settingsCache.has(tape)) this.settingsCache.set(tape, decodeReplaySettings(tape, this.settingsCodec));
    return this.settingsCache.get(tape) ?? null;
  }
  private validateTape(tape: PuzzleReplay): boolean {
    return this.validateSeed(tape.seed) && this.migratedSettings(tape) !== null &&
      (tape.simulatorVersion ?? 1) <= (this.settingsCodec.simulatorVersion ?? 1);
  }
  private canPlay(entry: ReplayMetadata | undefined): boolean {
    return !!entry && this.compatibility.get(entry.id) !== false &&
      entry.settingsVersion <= this.settingsCodec.currentVersion && entry.simulatorVersion <= (this.settingsCodec.simulatorVersion ?? 1);
  }
  private restoreTape(tape: PuzzleReplay): boolean {
    this.restoring = true;
    this.store.setReadOnly(true);
    let restored = false;
    try {
      const settings = this.migratedSettings(tape);
      if (settings === null || !this.validateTape(tape)) return false;
      this.closeReplayReport();
      setReplayPirate(tape.report?.pirate ?? null);
      this.restore({ ...tape, settings: structuredClone(settings), settingsVersion: this.settingsCodec.currentVersion });
      restored = true;
      return true;
    } catch { this.replayStorageError = 'This replay could not be started. Its settings or state are unsupported.'; return false; }
    finally {
      if (!restored) { this.stopRestored?.(); this.store.setReadOnly(false); }
      this.restoring = false;
    }
  }
  /** A live game is starting: reports go back to today's pirate, and a replay's report closes. */
  private closeReplayReport(): void {
    setReplayPirate(null);
    if (this.panel.shownReport) this.panel.showReport?.(null);
  }
  private async showSelectedReport(): Promise<void> {
    const entry = this.tapes[this.selected];
    if (!entry) return;
    try {
      const tape = await this.loadTape(entry);
      if (tape?.report && showsDutyReport(tape.report)) this.panel.showReport?.(tape.report);
      else this.replayStorageError = 'This replay was saved without a duty report.';
    } catch { this.replayStorageError = 'This replay could not be loaded.'; }
  }
  private togglePause(): void {
    const p = this.playback;
    if (!p) return;
    p.paused = !p.paused; p.lastReal = performance.now();
  }
  private syncPicker(): void {
    this.picker.replaceChildren(...this.tapes.map((entry, index) => {
      const option = document.createElement('option'); option.value = String(index);
      const date = new Date(entry.at);
      const compatibility = this.canPlay(entry) ? '' : ' · Unsupported by this version';
      option.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + entry.result + compatibility;
      return option;
    }));
    this.picker.disabled = !this.tapes.length || !!this.playback || this.loading; this.picker.value = String(this.selected);
  }
  private async download(): Promise<void> {
    const entry = this.tapes[this.selected];
    if (!entry) return;
    try {
      const tape = this.decoded.get(entry.id);
      const blob = tape ? await this.blob(tape) : await readArchivedReplay(entry);
      if (!blob) throw new Error('Missing replay');
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = this.puzzle + '-replay-' + new Date(entry.at).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json.gz';
      a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { this.replayStorageError = 'The replay file could not be exported.'; }
  }
  private async importFile(): Promise<void> {
    const chosen = this.file.files?.[0]; this.file.value = '';
    if (!chosen) return;
    try {
      const tape = await decodeReplayBlob(chosen);
      if (!tape || tape.puzzle !== this.puzzle || !this.validateTape(tape)) throw new Error('Unsupported replay');
      this.blobs.set(tape, Promise.resolve(chosen)); this.addTape(tape); await this.persistTape(tape);
      await this.playOpened(tape);
    } catch { window.alert("That file isn't a supported compressed " + this.puzzle + ' replay.'); }
  }
  /** The puzzle's way to end a game of the player's own, so an opened replay file can take over. */
  setStopLive(stop: () => void): void { this.stopLive = stop; }
  /** An opened file plays straight away: the replay or game on the board ends first. */
  private async playOpened(tape: PuzzleReplay): Promise<void> {
    if (this.disposed) return;
    if (this.playback || this.loading) this.stopPlayback();
    if (this.recording || !this.canStartPlayback()) this.stopLive?.();
    if (this.recording) this.finish('Stopped');
    await this.playAt(tape.at, tape.runId);
  }
}
