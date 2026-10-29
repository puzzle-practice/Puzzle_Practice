import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { CHECKPOINT_MS, decodeReplayBlob, encodeReplayBlob, replayMetadata, ReplayRecorder, type PuzzleReplay } from './replay';
import { listReplayFiles, replayWrites, saveReplayFile } from './replay-storage';
import { Store } from './storage';
import { currentPirate } from './duty/profile';
import { makeReport } from './duty/report';
import { DEFAULT_FACE } from './duty/face';
import { END_HOLD_MS } from './end-hold';
import type { Panel } from './panel';
import type { InputEvent, Point } from './input';

class Element {
  value = '';
  children: Element[] = [];
  textContent = '';
  setAttribute() {}
  addEventListener() {}
  replaceChildren(...children: Element[]) { this.children = children; }
  click() {}
}

function harness(puzzle = 'distilling') {
  let now = 0;
  const buttons = new Map<string, () => void>();
  const setters = new Map<string, (value: number) => void>();
  let note = () => '';
  const group = {
    append: () => group,
    button: (label: string, action: () => void) => { buttons.set(label, action); return group; },
    range: (label: string, _get: unknown, set: (value: number) => void) => { setters.set(label, set); return group; },
    number: (label: string, _get: unknown, set: (value: number) => void) => { setters.set(label, set); return group; },
    select: (label: string, _options: unknown, _get: unknown, set: (value: number) => void) => { setters.set(label, set); return group; },
    note: (get: () => string) => { note = get; return group; },
  };
  const reports: unknown[] = [];
  const panel = {
    tab: () => ({ group: () => group }),
    historySection: () => group,
    showReport: (report: unknown) => reports.push(report),
    get shownReport() { return reports.at(-1) ?? null; },
  } as unknown as Panel;
  const store = new Store(puzzle);
  let cursor = -1;
  let painting = false;
  let strikes: number[] = [];
  let painted: number[] = [];
  let updates: number[] = [];
  let start = 0;
  let recorder: ReplayRecorder;
  const simulate = (routed: ReturnType<ReplayRecorder['frame']>) => {
    if (routed.renderOnly) return;
    updates.push(now - start);
    for (const event of routed.events) {
      if (event.type === 'keydown' && event.key === 'space') strikes.push(cursor);
      if (event.type === 'keydown' && event.key === '1') painting = true;
      if (event.type === 'keyup' && event.key === '1') painting = false;
    }
    if (painting) painted.push(routed.mouse[0]);
    cursor = routed.mouse[0];
    // Represents a puzzle attempting a score write as it completes a replayed move.
    if (routed.events.length) store.addHistory('test', { score: 1 });
  };
  const pickerIndex = elements.length;
  recorder = new ReplayRecorder(puzzle, store, panel, () => now, () => {
    start = now; cursor = -1; painting = false; strikes = []; painted = []; updates = [];
    recorder.begin({}, {}); // Normal start hooks must not create recordings during restore.
    store.addHistory('test', { score: 100 });
  }, () => store.addHistory('test', { score: 200 }), undefined,
  (time) => { if (time !== null) now = time; },
  () => simulate(recorder.frame([], [-1, -1], now)));
  return {
    recorder, store, buttons, setters, reports, note: () => note(),
    frame: (time: number, events: InputEvent[], mouse: Point) => { now = time; simulate(recorder.frame(events, mouse, now)); },
    finish: (time: number) => { now = time; return recorder.finish('Finished')!; },
    state: () => ({ strikes: [...strikes], painted: [...painted], updates: [...updates] }),
    picker: () => elements[pickerIndex],
  };
}

let elements: Element[];
beforeEach(async () => {
  await replayWrites.idle();
  vi.stubGlobal('indexedDB', new IDBFactory());
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  elements = [];
  vi.stubGlobal('document', { createElement: () => { const el = new Element(); elements.push(el); return el; } });
});
afterEach(async () => { await replayWrites.idle(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('duty reports with replays', () => {
  it("saves the run's report, plays it back as that pirate and shows the report when it ends", async () => {
    localStorage.setItem('puzzle-practice:global:profile', JSON.stringify({ name: 'Anne', face: DEFAULT_FACE }));
    const h = harness('test');
    h.recorder.begin({}, {});
    h.frame(10, [{ type: 'keydown', key: 'space' }], [1, 0]);
    const report = makeReport({ puzzle: 'test', station: 'Test', performance: 3, score: { label: 'Score', value: '1' } });
    const now = 20;
    const tape = h.recorder.finish('Finished', report)!;
    await replayWrites.idle();
    expect(tape.report).toEqual(report);
    // A new profile since; the replay still shows who played it.
    localStorage.setItem('puzzle-practice:global:profile', JSON.stringify({ name: 'Mary', face: DEFAULT_FACE }));
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await h.recorder.playAt(tape.at)).toBe(true);
    expect(currentPirate().name).toBe('Anne');
    perf.mockReturnValue(now * 10);
    h.recorder.frame([], [-1, -1], 0);
    h.recorder.frame([], [-1, -1], 0);
    // The last board stays in view for a moment before the report covers it.
    expect(h.recorder.isPlaying).toBe(true);
    perf.mockReturnValue(now * 10 + END_HOLD_MS);
    h.recorder.frame([], [-1, -1], 0);
    h.recorder.frame([], [-1, -1], 0);
    expect(h.recorder.isPlaying).toBe(false);
    expect(h.reports.at(-1)).toEqual(report);
    // Starting a game of your own closes it and goes back to today's pirate.
    h.recorder.begin({}, {});
    expect(h.reports.at(-1)).toBeNull();
    expect(currentPirate().name).toBe('Mary');
  });
});

describe('recording and playback regressions', () => {
  it('preserves practice eligibility through compression, playback and take-over', async () => {
    const h = harness('test');
    h.store.setScoresEnabled(false);
    h.recorder.begin({}, {});
    h.frame(10, [{ type: 'keydown', key: 'space' }], [1, 0]);
    const tape = h.finish(20);
    expect(tape.practice).toBe(true);
    expect((await decodeReplayBlob(await encodeReplayBlob(tape)))?.practice).toBe(true);
    await replayWrites.idle();
    h.store.setScoresEnabled(true);
    vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await h.recorder.playAt(tape.at, tape.runId)).toBe(true);
    expect(h.recorder.takeOver()).toBe(true);
    expect(h.store.scoresEnabled).toBe(false);
    h.frame(15, [{ type: 'keydown', key: 'space' }], [2, 0]);
    expect(h.store.history('test')).toEqual([]);
    expect(h.finish(30).practice).toBe(true);
    h.recorder.dispose();
  });

  it('refuses unversioned random streams before restoring the puzzle and retains the saved history', async () => {
    const first = harness('test');
    first.recorder.begin({}, {});
    first.frame(10, [{ type: 'keydown', key: 'space' }], [1, 0]);
    const tape = first.finish(20);
    await replayWrites.idle();
    first.recorder.dispose();
    delete tape.randomVersion;
    const blob = await encodeReplayBlob(tape);
    await saveReplayFile({ metadata: replayMetadata(tape, blob.size), blob });

    const restored = harness('test');
    await vi.waitFor(() => expect(restored.picker().children).toHaveLength(1));
    const history = structuredClone(restored.store.history('test'));
    expect(await restored.recorder.playAt(tape.at, tape.runId)).toBe(false);
    expect(restored.recorder.isPlaying).toBe(false);
    expect(restored.recorder.hasPlayableAt(tape.at, tape.runId)).toBe(false);
    expect(restored.state()).toEqual({ strikes: [], painted: [], updates: [] });
    expect(restored.store.history('test')).toEqual(history);
    expect(restored.note()).toContain('unsupported');
    expect(await listReplayFiles('test')).toHaveLength(1);
    restored.recorder.dispose();
  });

  it('records unheld Weaving mouse movement for shuttle entry positioning', () => {
    const h = harness('weaving');
    h.recorder.begin({ difficulty: 5 },42);
    h.frame(10,[],[80,200]);
    h.frame(20,[],[250,200]);
    h.frame(30,[],[300,200]);
    const tape = h.finish(40);
    expect(tape.frames.map(frame => frame.mouse)).toEqual([[80,200],[250,200],[300,200]]);
  });

  it('keeps distinct runs when two instances start at the same timestamp', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(42);
    const first = harness('test');
    const second = harness('test');
    first.recorder.begin({}, {}); const a = first.finish(10);
    second.recorder.begin({}, {}); const b = second.finish(20);
    await replayWrites.idle();
    expect(a.at).toBe(b.at);
    expect(a.runId).not.toBe(b.runId);
    expect(await listReplayFiles('test')).toHaveLength(2);
  });
  it('keeps keyboard painting paths and hover state, and replays original update times at 4x and during seeking', async () => {
    const h = harness();
    h.recorder.begin({}, {});
    h.frame(10, [], [1, 0]);
    h.frame(20, [{ type: 'keydown', key: 'space' }], [2, 0]);
    h.frame(30, [{ type: 'keyup', key: 'space' }], [2, 0]);
    h.frame(40, [{ type: 'keydown', key: '1' }], [3, 0]);
    h.frame(50, [], [9, 0]);
    h.frame(60, [{ type: 'keyup', key: '1' }], [9, 0]);
    const expected = h.state();
    const history = [...h.store.history('test')];
    const tape = h.finish(60);
    await replayWrites.idle();
    expect(tape.steps).toEqual([10, 20, 30, 40, 50, 60]);
    expect(tape.frames.map((frame) => frame.t)).toContain(50);
    const perf = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(await h.recorder.playAt(tape.at)).toBe(true);
    h.setters.get('Playback speed')!(4);
    perf.mockReturnValue(15);
    h.recorder.frame([], [-1, -1], 0);
    expect(h.state()).toEqual(expected);
    expect(h.store.history('test')).toEqual(history);
    h.setters.get('Jump to (s)')!(0.03);
    h.buttons.get('Jump')!();
    await vi.waitFor(() => expect(h.state().updates).toEqual([10, 20, 30]));
    expect(h.state().strikes).toEqual([1]);
    h.setters.get('Jump to (s)')!(0.06);
    h.buttons.get('Jump')!();
    await vi.waitFor(() => expect(h.state()).toEqual(expected));
    h.buttons.get('Stop')!();
    expect(h.store.history('test')).toEqual(history);
    h.store.addHistory('test', { score: 7 });
    expect(h.store.history('test')).toHaveLength(history.length + 1);
  });

  it('lists every archived run, without decompression, and loads the oldest run on demand', async () => {
    const h = harness('test');
    const runs: PuzzleReplay[] = [];
    for (let i = 0; i < 12; i++) {
      h.recorder.begin({}, {});
      h.frame(i + 1, [], [i, 0]);
      runs.push(h.finish(i + 2));
    }
    await replayWrites.idle();
    const decompress = vi.spyOn(globalThis, 'DecompressionStream');
    const restored = harness('test');
    await vi.waitFor(() => expect(restored.picker().children).toHaveLength(12));
    expect(decompress).not.toHaveBeenCalled();
    expect(restored.recorder.hasPlayableAt(runs[0].at)).toBe(true);
    expect(await restored.recorder.playAt(runs[0].at)).toBe(true);
    expect(decompress).toHaveBeenCalledTimes(1);
    restored.buttons.get('Stop')!();
    await restored.recorder.playAt(runs[0].at);
    expect(decompress).toHaveBeenCalledTimes(1);
    restored.recorder.dispose();
  });

  it('appends saves from successive puzzle instances and finishes recordings on navigation', async () => {
    const first = harness('first');
    first.recorder.begin({}, {});
    first.frame(10, [], [1, 1]);
    first.recorder.dispose();
    const second = harness('second');
    second.recorder.begin({}, {});
    second.frame(20, [], [2, 2]);
    second.recorder.dispose();
    await replayWrites.idle();
    const saved = await listReplayFiles();
    expect(saved.map((entry) => entry.puzzle).sort()).toEqual(['first', 'second']);
    expect(saved.every((entry) => entry.result === 'Stopped when leaving puzzle')).toBe(true);
    expect(localStorage.getItem('puzzle-practice:first:replays')).toBeNull();
  });

  it('keeps an open-ended game abandoned by a setting change, and drops any other', async () => {
    const h = harness();
    h.recorder.begin({}, {});
    h.frame(10, [{ type: 'keydown', key: 'space' }], [1, 1]);
    h.recorder.abandon();
    h.recorder.openEnded = () => true;
    h.recorder.begin({}, {});
    h.frame(20, [{ type: 'keydown', key: 'space' }], [2, 2]);
    h.recorder.abandon();
    await replayWrites.idle();
    expect((await listReplayFiles('distilling')).map((entry) => entry.result)).toEqual(['Stopped']);
  });

  it("saves an open-ended game as it stands every so often; its end replaces that copy, and dropping it removes it", async () => {
    const h = harness();
    h.recorder.openEnded = () => true;
    h.recorder.begin({}, {});
    h.frame(10, [{ type: 'keydown', key: 'space' }], [1, 1]);
    h.frame(CHECKPOINT_MS + 10, [], [2, 2]);
    await replayWrites.idle();
    let saved = await listReplayFiles('distilling');
    expect(saved.map((entry) => entry.result)).toEqual(['Unfinished']);
    expect(saved[0].duration).toBe(CHECKPOINT_MS + 10);
    h.finish(CHECKPOINT_MS + 500);
    await replayWrites.idle();
    saved = await listReplayFiles('distilling');
    expect(saved.map((entry) => entry.result)).toEqual(['Finished']);
    expect(saved[0].duration).toBe(CHECKPOINT_MS + 500);

    h.recorder.begin({}, {}, CHECKPOINT_MS + 1000);
    h.frame(2 * CHECKPOINT_MS + 1000, [{ type: 'keydown', key: 'space' }], [3, 3]);
    await replayWrites.idle();
    expect(await listReplayFiles('distilling')).toHaveLength(2);
    h.recorder.cancel();
    await replayWrites.idle();
    expect((await listReplayFiles('distilling')).map((entry) => entry.result)).toEqual(['Finished']);
  });

  it('serializes compression without losing a later run and encodes each run just once', async () => {
    const h = harness('test');
    const RealStream = globalThis.CompressionStream;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let count = 0;
    // Delay the first encoder at its writable without changing gzip semantics.
    vi.stubGlobal('CompressionStream', class {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<BufferSource>;
      constructor(format: CompressionFormat) {
        const ordinal = ++count;
        const delayed = new TransformStream<BufferSource, BufferSource>({ async transform(chunk, controller) {
          if (ordinal === 1) await gate;
          controller.enqueue(chunk);
        } });
        this.writable = delayed.writable;
        this.readable = delayed.readable.pipeThrough(new RealStream(format));
      }
    });
    h.recorder.begin({}, {}); const first = h.finish(10);
    h.recorder.begin({}, {}); const second = h.finish(20);
    await vi.waitFor(() => expect(count).toBe(1));
    release();
    await replayWrites.idle();
    expect((await listReplayFiles('test')).map((entry) => entry.at)).toEqual([second.at, first.at]);
    expect(count).toBe(2);
  });
});
