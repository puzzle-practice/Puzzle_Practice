import { describe, expect, it } from 'vitest';
import { compressReplay, decodeReplaySettings, decodeReplayBlob, encodeReplayBlob, isPuzzleReplay, packReplay, replayFileName, unpackReplay, type PuzzleReplay, type ReplaySettingsCodec } from './replay';

describe('shareable replay format', () => {
  it('stores and restores an individually gzipped compact replay', async () => {
    if (!globalThis.CompressionStream || !globalThis.DecompressionStream) return;
    const replay: PuzzleReplay = {
      format: 'puzzle-practice-replay', version: 1, puzzle: 'forage', at: 42, duration: 100,
      result: 'Score 8', settings: { mode: 'chaos' }, seed: { board: [1, 2] },
      randomVersion: 1,
      frames: [{ t: 10, mouse: [4, 5], events: [{ type: 'mousedown', button: 1, pos: [4, 5] }] }],
    };
    const stored = await encodeReplayBlob(replay);
    expect(stored.type).toBe('application/gzip');
    expect(await decodeReplayBlob(stored)).toEqual(replay);
  });

  it('does not migrate older uncompressed replay records', async () => {
    const legacy: PuzzleReplay = {
      format: 'puzzle-practice-replay', version: 1, puzzle: 'forage', at: 42, duration: 0,
      result: 'Score 0', settings: {}, seed: {}, frames: [],
    };
    expect(await decodeReplayBlob(new Blob([JSON.stringify(legacy)]))).toBeNull();
    expect(await decodeReplayBlob(new Blob([JSON.stringify(packReplay(legacy))]))).toBeNull();
  });

  it('round-trips compact event tuples and uses fewer bytes than verbose frame objects', () => {
    const replay: PuzzleReplay = {
      format: 'puzzle-practice-replay', version: 1, puzzle: 'vampire-carp', at: 1, duration: 500,
      result: 'Score 1', settings: { mode: 'normal' }, seed: { random: 42 }, frames: [
        { t: 20, mouse: [10, 20], events: [], commands: [] },
        { t: 30, mouse: [12, 22], events: [
          { type: 'mousedown', button: 1, pos: [12, 22] },
          { type: 'keydown', key: 'arrowleft' },
        ], commands: [] },
        { t: 40, mouse: [20, 30], events: [], actions: [{ type: 'forage-act', data: { x: 1, y: 2, ccw: true } }] },
      ],
    };
    const compact = packReplay(replay);
    const expanded = unpackReplay(compact)!;
    expect(compact.version).toBe(2);
    expect(expanded.frames).toEqual([
      { t: 20, mouse: [10, 20], events: [] },
      { t: 30, mouse: [12, 22], events: [
        { type: 'mousedown', button: 1, pos: [12, 22] },
        { type: 'keydown', key: 'arrowleft' },
      ] },
      { t: 40, mouse: [20, 30], events: [], actions: [{ type: 'forage-act', data: { x: 1, y: 2, ccw: true } }] },
    ]);
    expect(new TextEncoder().encode(JSON.stringify(compact)).length).toBeLessThan(new TextEncoder().encode(JSON.stringify(replay)).length);
  });

  it('compresses by dropping cursor-only frames while preserving input and actions', () => {
    const replay: PuzzleReplay = {
      format: 'puzzle-practice-replay', version: 1, puzzle: 'blacksmithing', at: 1, duration: 500,
      result: 'Score 1', settings: {}, seed: {}, frames: [
        { t: 10, mouse: [4, 8], events: [], commands: [] },
        { t: 20, mouse: [10, 20], events: [], commands: [] },
        { t: 30, mouse: [12, 22], events: [{ type: 'mousedown', button: 1, pos: [12, 22] }] },
        { t: 40, mouse: [12, 22], events: [], actions: [{ type: 'strike', data: { x: 1, y: 2 } }] },
      ],
    };
    const compressed = compressReplay(replay);
    // The cursor just before a press stays: a drag that starts with the press comes from there.
    expect(compressed.frames.map((frame) => frame.t)).toEqual([20, 30, 40]);
    expect(compressed.frames[1].events).toHaveLength(1);
    expect(compressed.frames[2].actions).toHaveLength(1);
    expect(replay.frames).toHaveLength(4);
  });

  it.each(['distilling', 'shipwrightery'])('keeps held-mouse paths in %s because the path itself can make swaps', (puzzle) => {
    const replay: PuzzleReplay = {
      format: 'puzzle-practice-replay', version: 1, puzzle, at: 1, duration: 500,
      result: 'Score 1', settings: {}, seed: {}, frames: [
        { t: 10, mouse: [1, 1], events: [{ type: 'mousedown', button: 1, pos: [1, 1] }] },
        { t: 20, mouse: [8, 8], events: [] },
        { t: 30, mouse: [20, 20], events: [{ type: 'mouseup', button: 1, pos: [20, 20] }] },
        { t: 40, mouse: [24, 22], events: [] },
      ],
    };
    expect(compressReplay(replay).frames.map((frame) => frame.t)).toEqual([10, 20, 30]);
  });

  it('keeps Carpentry cursor paths that cross the drag threshold and return before release', () => {
    const replay: PuzzleReplay = {
      format: 'puzzle-practice-replay', version: 1, puzzle: 'vampire-carp', at: 1, duration: 500,
      simulatorVersion: 4, result: 'Stopped', settings: {}, seed: {}, frames: [
        { t: 10, mouse: [100, 100], events: [{ type: 'mousedown', button: 1, pos: [100, 100] }] },
        { t: 20, mouse: [118, 100], events: [] },
        { t: 30, mouse: [100, 100], events: [] },
        { t: 40, mouse: [100, 100], events: [{ type: 'mouseup', button: 1, pos: [100, 100] }] },
        { t: 50, mouse: [160, 100], events: [] },
      ],
    };
    expect(compressReplay(replay).frames).toEqual(replay.frames);
  });

  it('keeps Weaving hover samples because they choose incoming shuttle positions', () => {
    const replay: PuzzleReplay = {
      format: 'puzzle-practice-replay', version: 1, puzzle: 'weaving', at: 1, duration: 500,
      result: 'Stopped', settings: { difficulty: 3 }, seed: 42, frames: [
        { t: 10, mouse: [80, 200], events: [] },
        { t: 20, mouse: [250, 200], events: [] },
        { t: 30, mouse: [250, 200], events: [{ type: 'keydown', key: 'space' }] },
      ],
    };
    expect(compressReplay(replay).frames).toEqual(replay.frames);
  });

  it('accepts a puzzle replay with an opaque custom seed and ordered input', () => {
    const replay = {
      format: 'puzzle-practice-replay', version: 1, puzzle: 'distilling', at: 1, duration: 1200,
      result: 'Score 1.25', settings: { mode: 'Create' }, seed: 'custom-board:8|piece-sequence',
      frames: [
        { t: 0, mouse: [-1, -1], events: [], commands: [] },
        { t: 100, mouse: [240, 170], events: [{ type: 'mousedown', button: 1, pos: [240, 170] }], commands: [] },
      ],
    };
    expect(isPuzzleReplay(replay, 'distilling')).toBe(true);
    expect(isPuzzleReplay(replay, 'treasure-haul')).toBe(false);
    expect(isPuzzleReplay({ ...replay, frames: [...replay.frames].reverse() }, 'distilling')).toBe(false);
  });

  it('accepts puzzle-specific actions in the shared timeline and rejects malformed actions', () => {
    const replay = {
      format: 'puzzle-practice-replay', version: 1, puzzle: 'forage', at: 1, duration: 1200,
      result: 'Score 1', settings: { mode: 'chaos' }, seed: {},
      frames: [{ t: 10, mouse: [20, 30], events: [], actions: [{ type: 'forage-act', data: { x: 2, y: 3, ccw: true } }] }],
    };
    expect(isPuzzleReplay(replay, 'forage')).toBe(true);
    expect(isPuzzleReplay({ ...replay, frames: [{ ...replay.frames[0], actions: [{ type: 3 }] }] }, 'forage')).toBe(false);
  });

  it('treats legacy settings as v1 and migrates without mutating the saved replay', () => {
    const tape: PuzzleReplay = {
      format: 'puzzle-practice-replay', version: 1, puzzle: 'treasure-haul', at: 1, duration: 0,
      result: 'Score 2', settings: { oldRate: 4 }, seed: {}, frames: [],
    };
    const codec: ReplaySettingsCodec = {
      currentVersion: 2,
      migrate: (version, settings) => version === 1 && settings && typeof settings === 'object'
        ? { ...settings, gemRates: [(settings as { oldRate: number }).oldRate, 0] }
        : null,
    };
    expect(decodeReplaySettings(tape, codec)).toEqual({ oldRate: 4, gemRates: [4, 0] });
    expect(tape.settings).toEqual({ oldRate: 4 });
  });

  it('leaves future-schema replays valid for display but refuses to decode them', () => {
    const tape: PuzzleReplay = {
      format: 'puzzle-practice-replay', version: 1, puzzle: 'treasure-haul', at: 1, duration: 0,
      result: 'Score 2', settings: { mode: 'spawn' }, settingsVersion: 3, simulatorVersion: 2, seed: {}, frames: [],
    };
    expect(isPuzzleReplay(tape, 'treasure-haul')).toBe(true);
    expect(decodeReplaySettings(tape, { currentVersion: 2, migrate: () => null })).toBeNull();
  });
});

describe('replay file names', () => {
  it('gives replays recorded in the same minute different names', () => {
    const at = new Date(2026, 9, 15, 18, 4, 5).getTime();
    const first = replayFileName({ puzzle: 'forage', at, runId: '3913611b-b776-4020-ad34-167a43107233' });
    const second = replayFileName({ puzzle: 'forage', at: at + 1500, runId: 'bc96e891-7571-4701-b4cf-7b8d323d7005' });
    expect(first).toBe('forage-replay-2026-10-15_18-04-05-3913611b.json.gz');
    expect(second).toBe('forage-replay-2026-10-15_18-04-06-bc96e891.json.gz');
    expect(replayFileName({ puzzle: 'forage', at: at + 7 })).not.toBe(replayFileName({ puzzle: 'forage', at: at + 8 }));
  });
});
