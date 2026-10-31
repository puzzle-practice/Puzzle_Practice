// Renders a replay to an MP4 file in the browser. The replay plays on a virtual clock, one video frame
// at a time, so the video is smooth whatever the computer's speed, and renders as fast as the encoder
// allows rather than at playing speed. Frames are encoded with WebCodecs and muxed by Mediabunny; sounds
// the game played are mixed offline into an audio track.
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, Quality, type VideoCodec, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec } from 'mediabunny';
import { captureSounds, type CapturedSound } from './audio';
import { drawElement } from './dom-raster';
import { watchDrawing } from './draw-fingerprint';
import { advanceVirtualTime, endVirtualTime, frameRunner, realNow, startVirtualTime } from './realtime';

/** How long the duty report stays on screen at the end of the video, in seconds. */
export const REPORT_SECONDS = 5;
const SAMPLE_RATE = 48_000;
/** With a size limit: sound at 128 kbps (64 under 15 MB), the video between these bitrates, aiming 12% under the limit. */
const CAPPED_AUDIO_BITRATE = 128_000, SMALL_CAPPED_AUDIO_BITRATE = 64_000, SMALL_CAP_BYTES = 15_000_000;
const MIN_VIDEO_BITRATE = 100_000;
const MAX_VIDEO_BITRATE = 4_000_000;
const SIZE_MARGIN = 0.88;
/** The codec checks take a Quality as `quality` but a number only as `bitrate`. */
const rate = (value: number | Quality) => typeof value === 'number' ? { bitrate: value } : { quality: value };

export interface VideoExportOptions {
  /** Starts the replay; resolves once it is playing (or failed to start). Runs on the virtual clock. */
  begin(): Promise<void>;
  /** Whether the replay is still playing; the video ends at the first frame it isn't. */
  playing(): boolean;
  /** True to give up: the export rejects with VideoExportCancelled. */
  cancelled(): boolean;
  /** Replay time reached so far, in seconds, for a progress note. */
  onProgress?(seconds: number): void;
  /** What's shown over the board once the replay has ended (its duty report), if anything: it ends the video. */
  endCard?(): HTMLElement | null;
  /** Frames a second; 60 by default. */
  fps?: number;
  /** Largest file to make, in bytes: the video's bitrate is set so it fits. No limit if left out. */
  maxBytes?: number;
  /** How long the video is expected to run, in seconds, to share `maxBytes` out over. */
  expectedSeconds?: number;
  /** Codecs to try, best first; H.264 (plays everywhere) by default, then VP9, AV1, VP8. */
  codecs?: VideoCodec[];
  /** Overrides the video bitrate or quality worked out from the size limit. */
  videoQuality?: number | Quality;
  /**
   * Constant quality instead of a bitrate (lower is better; H.264 takes 0 to 51): same look all through, size
   * varies. Encoders that can't do it fall back to the bitrate the size limit gives; `ReplayVideo.quantizer`
   * says whether it was used.
   */
  quantizer?: number;
  /** Seconds between key frames (full pictures the player can seek to); 10 by default. Each costs a lot of a small file. */
  keyFrameSeconds?: number;
  /**
   * Whole-number upscale, by repeating pixels; 2 by default. Video keeps colour at half resolution and
   * smears fine detail at low bitrates; doubled pixels survive both, and encoders spend a size limit
   * more fully at the bigger size. A 5-minute Navigation replay at 8 MB looked much sharper for it.
   */
  scale?: number;
  /** Longest video to make, in ms of real time, in case a replay never ends. */
  maxMs?: number;
}

export interface ReplayVideo {
  blob: Blob; seconds: number; renderMs: number;
  /** The video bitrate aimed at, when it was set from a size limit. */
  videoBitrate?: number;
  /** The constant quality the video was made at, if the encoder could do it. */
  quantizer?: number;
}

export class VideoExportCancelled extends Error { override name = 'VideoExportCancelled'; }

export async function exportReplayVideo(options: VideoExportOptions): Promise<ReplayVideo> {
  const began = performance.now();
  const runner = frameRunner();
  if (!runner) throw new Error('No puzzle is running');
  const game = runner.canvas;
  const { width, height } = game;
  const scale = Math.max(1, Math.round(options.scale ?? 2));
  const fps = options.fps ?? 60;
  // A size limit is shared out over the expected length, with some room spare: encoders only aim at a bitrate.
  const capped = !!options.maxBytes && !!options.expectedSeconds;
  const cappedAudio = (options.maxBytes ?? 0) < SMALL_CAP_BYTES ? SMALL_CAPPED_AUDIO_BITRATE : CAPPED_AUDIO_BITRATE;
  const audioBitrate: number | Quality = capped ? cappedAudio : QUALITY_HIGH;
  const videoBitrate: number | Quality = capped
    ? Math.round(Math.max(MIN_VIDEO_BITRATE, Math.min(MAX_VIDEO_BITRATE,
      options.maxBytes! * 8 * SIZE_MARGIN / options.expectedSeconds! - cappedAudio)))
    : QUALITY_HIGH;
  const fallbackBitrate = typeof videoBitrate === 'number' ? videoBitrate : undefined;
  const videoQuality = options.videoQuality ?? (options.quantizer !== undefined
    ? new Quality({ quantizer: options.quantizer, bitrate: fallbackBitrate }) : videoBitrate);
  const videoCodec = await getFirstEncodableVideoCodec(options.codecs ?? ['avc', 'vp9', 'av1', 'vp8'],
    { width: width * scale, height: height * scale, frameRate: fps, ...rate(videoQuality) });
  if (!videoCodec) throw new Error('This browser cannot encode video');
  const audioCodec = typeof AudioEncoder === 'undefined' ? null
    : await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE, ...rate(audioBitrate) });

  // A frame drawn exactly like the one before is left out (the one before is simply shown longer), which
  // skips most of the encoding while the board sits still and about halves the file. It's told from
  // what the game drew rather than by reading pixels back, which would stall the graphics card.
  const drawing = watchDrawing(game.getContext('2d')!);

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  // Each frame that goes in the video is copied to its own canvas (scaled up, if asked, with the pixels
  // kept square and sharp), so it still holds the last frame after the game has moved on.
  const source = document.createElement('canvas');
  source.width = width * scale; source.height = height * scale;
  const sourceCtx = source.getContext('2d')!;
  sourceCtx.imageSmoothingEnabled = false;
  const copy = () => sourceCtx.drawImage(game, 0, 0, source.width, source.height);
  let byQuantizer = false;
  const video = new CanvasSource(source, {
    codec: videoCodec, bitrate: videoQuality, keyFrameInterval: options.keyFrameSeconds ?? 10,
    onEncoderConfig: (config) => { byQuantizer = config.bitrateMode === 'quantizer'; },
  });
  output.addVideoTrack(video, { frameRate: fps });
  const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: audioBitrate }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  startVirtualTime();
  const stopCapture = captureSounds();
  let sounds: CapturedSound[] = [];
  let startedAt = 0, frames = 0, lastAdded = -1;
  try {
    await options.begin();
    startedAt = realNow();
    const frameMs = 1000 / fps, maxFrames = Math.ceil((options.maxMs ?? 30 * 60_000) / frameMs);
    while (frames < maxFrames) {
      if (options.cancelled()) throw new VideoExportCancelled();
      if (!options.playing()) break;
      advanceVirtualTime(frameMs);
      runner.run();
      if (options.cancelled()) throw new VideoExportCancelled();
      // The frame that ended the replay has already put the board back: it isn't part of the video.
      if (!options.playing()) break;
      if (drawing.changed()) { copy(); await video.add(frames / fps, 1 / fps); lastAdded = frames; }
      frames++;
      // Let the page paint the progress note and stay responsive.
      if (frames % 30 === 0) { options.onProgress?.(frames / fps); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  } finally {
    drawing.dispose();
    sounds = stopCapture();
    endVirtualTime();
  }
  if (!frames) { await output.cancel().catch(() => {}); throw new Error('The replay showed no frames'); }
  // A still ending: show the last frame again so the video runs to the end of the replay.
  if (lastAdded < frames - 1) { await video.add((frames - 1) / fps, 1 / fps); }
  let seconds = frames / fps;

  // The duty report shown when the replay ended: give its face and icons a moment to draw, then hold it.
  const card = options.endCard?.();
  if (card) {
    await new Promise(resolve => setTimeout(resolve, 300));
    // The report covers the whole board. It's painted over the last frame, at the video's size.
    const paint = () => drawElement(sourceCtx, card, game.getBoundingClientRect(), source.width);
    paint(); await video.add(seconds, 1 / fps);
    await video.add(seconds + REPORT_SECONDS - 1 / fps, 1 / fps);
    seconds += REPORT_SECONDS;
  }

  if (audio) await audio.add(await mixSounds(sounds, startedAt, seconds));
  await output.finalize();
  const buffer = (output.target as BufferTarget).buffer!;
  return { blob: new Blob([buffer], { type: 'video/mp4' }), seconds, renderMs: performance.now() - began,
    videoBitrate: typeof videoQuality === 'number' ? videoQuality : byQuantizer ? undefined : fallbackBitrate,
    quantizer: byQuantizer ? options.quantizer : undefined };
}

/** Mixes the captured sounds into one stereo track of the video's length, each at its moment. */
async function mixSounds(sounds: CapturedSound[], startedAt: number, durationS: number): Promise<AudioBuffer> {
  const mix = new OfflineAudioContext(2, Math.max(1, Math.ceil(durationS * SAMPLE_RATE)), SAMPLE_RATE);
  for (const sound of sounds) {
    const when = (sound.at - startedAt) / 1000;
    if (when < 0 || when >= durationS || sound.volume <= 0) continue;
    const source = mix.createBufferSource();
    source.buffer = sound.buffer;
    const gain = mix.createGain();
    gain.gain.value = sound.volume;
    source.connect(gain); gain.connect(mix.destination);
    source.start(when);
  }
  return mix.startRendering();
}
