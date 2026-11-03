import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  files: [] as { frames: { image: string; at: number; duration: number }[]; cancelled: boolean }[],
  soundStarts: [] as number[],
  captured: [] as { at: number; volume: number; buffer: object }[],
  artReady: vi.fn(async (_card: unknown) => {}),
  disposed: vi.fn(),
}));

vi.mock('mediabunny', () => ({
  QUALITY_HIGH: 1,
  Quality: class {},
  BufferTarget: class { buffer = new ArrayBuffer(1); },
  Mp4OutputFormat: class {},
  Output: class {
    target: unknown;
    file: (typeof state.files)[number];
    constructor(options: { target: unknown }) {
      this.target = options.target;
      this.file = { frames: [], cancelled: false };
      state.files.push(this.file);
    }
    addVideoTrack(video: { frames: unknown }) { video.frames = this.file.frames; }
    addAudioTrack() {}
    async start() {}
    async cancel() { this.file.cancelled = true; }
    async finalize() {}
  },
  CanvasSource: class {
    frames: (typeof state.files)[number]['frames'] = [];
    constructor(private source: { image: string }) {}
    async add(at: number, duration: number) { this.frames.push({ image: this.source.image, at, duration }); }
  },
  AudioBufferSource: class { async add() {} },
  getFirstEncodableVideoCodec: async () => 'avc',
  getFirstEncodableAudioCodec: async () => 'aac',
}));
vi.mock('./audio', () => ({ captureSounds: () => () => state.captured }));
vi.mock('./draw-fingerprint', () => ({ watchDrawing: () => ({ changed: () => false, dispose: state.disposed }) }));
vi.mock('./dom-raster', () => ({
  drawElement: (ctx: { canvas: { image: string } }) => { ctx.canvas.image = 'report'; },
}));
vi.mock('./duty/view', () => ({ waitForReportArt: state.artReady }));

import { exportReplayVideo, REPORT_SECONDS, VideoExportCancelled, type VideoExportOptions } from './video-export';
import { isVirtualTime, realNow, setFrameRunner } from './realtime';

let unregister: () => void;
let playing: boolean;
let draws: number;
let card: HTMLElement;

beforeEach(() => {
  state.files = []; state.soundStarts = []; state.captured = [];
  state.artReady.mockReset().mockResolvedValue(undefined);
  state.disposed.mockClear();
  playing = false; draws = 0;
  card = {} as HTMLElement;
  const game = { width: 450, height: 600, image: 'board', getContext: () => ({}), getBoundingClientRect: () => ({}) };
  unregister = setFrameRunner({ canvas: game as unknown as HTMLCanvasElement, run: () => {
    if (++draws === 4) playing = false;
    game.image = 'gameplay';
  } });
  vi.stubGlobal('document', { createElement: () => {
    const canvas = { width: 0, height: 0, image: '', getContext: () => ctx };
    const ctx = { canvas, imageSmoothingEnabled: false, drawImage: (image: { image: string }) => { canvas.image = image.image; } };
    return canvas;
  } });
  vi.stubGlobal('AudioEncoder', class {});
  vi.stubGlobal('OfflineAudioContext', class {
    destination = {};
    createBufferSource() {
      return { buffer: null, connect() {}, start: (at: number) => state.soundStarts.push(at) };
    }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    async startRendering() { return {}; }
  });
});
afterEach(() => { unregister(); vi.unstubAllGlobals(); });

const options = (extra: Partial<VideoExportOptions> = {}): VideoExportOptions => ({
  begin: async () => {
    playing = true;
    state.captured = [{ at: realNow(), volume: 1, buffer: {} }];
  },
  playing: () => playing,
  cancelled: () => false,
  startCard: async () => card,
  endCard: () => card,
  ...extra,
});

describe('replay video opening report', () => {
  it.each([30, 60])('shows the report at time zero for one frame at %i fps and keeps the ending', async fps => {
    const video = await exportReplayVideo(options({ fps, quantizers: [28, 30] }));
    expect(state.files).toHaveLength(2);
    for (const file of state.files) {
      expect(file.frames[0]).toEqual({ image: 'report', at: 0, duration: 1 / fps });
      // A static first gameplay frame must replace the opening card, even if the drawing hash hasn't changed.
      expect(file.frames[1]).toEqual({ image: 'gameplay', at: 1 / fps, duration: 1 / fps });
      expect(file.frames.find(f => f.at >= 4 / fps)).toEqual({ image: 'report', at: 4 / fps, duration: 1 / fps });
      expect(file.frames.at(-1)!.at + 1 / fps).toBeCloseTo(video.seconds);
      expect(file.frames.every((f, i) => !i || f.at > file.frames[i - 1].at)).toBe(true);
    }
    expect(video.seconds).toBeCloseTo(REPORT_SECONDS + 4 / fps);
    expect(state.soundStarts).toEqual([1 / fps]);
    expect(state.artReady).toHaveBeenCalledTimes(2);
    expect(isVirtualTime()).toBe(false);
  });

  it('leaves gameplay and audio starting at zero when there is no saved report', async () => {
    const video = await exportReplayVideo(options({ startCard: async () => null, endCard: () => null }));
    expect(state.files[0].frames[0]).toEqual({ image: 'gameplay', at: 0, duration: 1 / 60 });
    expect(video.seconds).toBeCloseTo(3 / 60);
    expect(state.soundStarts).toEqual([0]);
    expect(state.artReady).not.toHaveBeenCalled();
  });

  it('waits for the report artwork before encoding the first frame or starting playback', async () => {
    let ready!: () => void;
    const art = new Promise<void>(resolve => { ready = resolve; });
    state.artReady.mockReturnValue(art);
    const begin = vi.fn(async () => { playing = true; });
    const pending = exportReplayVideo(options({ begin, endCard: () => null }));
    await vi.waitFor(() => expect(state.artReady).toHaveBeenCalled());
    expect(state.files[0].frames).toEqual([]);
    expect(begin).not.toHaveBeenCalled();
    ready();
    await pending;
    expect(state.files[0].frames[0].image).toBe('report');
    expect(begin).toHaveBeenCalledOnce();
  });

  it('cancels during report preparation without starting playback and restores the clock', async () => {
    let cancelled = false;
    const begin = vi.fn(async () => {});
    state.artReady.mockImplementation(async () => { cancelled = true; });
    await expect(exportReplayVideo(options({ begin, cancelled: () => cancelled }))).rejects.toBeInstanceOf(VideoExportCancelled);
    expect(begin).not.toHaveBeenCalled();
    expect(state.files[0].cancelled).toBe(true);
    expect(state.files[0].frames).toEqual([]);
    expect(state.disposed).toHaveBeenCalledOnce();
    expect(isVirtualTime()).toBe(false);
  });
});
