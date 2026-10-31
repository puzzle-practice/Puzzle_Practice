// Renders a replay to an MP4 file in the browser. The replay plays on a virtual clock, one video frame
// at a time, so the video is smooth whatever the computer's speed, and usually renders faster than it
// plays. Frames are encoded with WebCodecs and muxed by Mediabunny; sounds the game played are mixed
// offline into an audio track.
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec } from 'mediabunny';
import { captureSounds, type CapturedSound } from './audio';
import { advanceVirtualTime, endVirtualTime, frameRunner, realNow, startVirtualTime } from './realtime';

export const VIDEO_FPS = 60;
const SAMPLE_RATE = 48_000;

export interface VideoExportOptions {
  /** Starts the replay; resolves once it is playing (or failed to start). Runs on the virtual clock. */
  begin(): Promise<void>;
  /** Whether the replay is still playing; the video ends at the first frame it isn't. */
  playing(): boolean;
  /** True to give up: the export rejects with VideoExportCancelled. */
  cancelled(): boolean;
  /** Replay time reached so far, in ms, for a progress note. */
  onProgress?(seconds: number): void;
  /** Longest video to make, in ms of real time, in case a replay never ends. */
  maxMs?: number;
}

export class VideoExportCancelled extends Error { override name = 'VideoExportCancelled'; }

export async function exportReplayVideo(options: VideoExportOptions): Promise<Blob> {
  const runner = frameRunner();
  if (!runner) throw new Error('No puzzle is running');
  const { canvas } = runner;
  const { width, height } = canvas;
  const videoCodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'vp8'], { width, height, quality: QUALITY_HIGH, frameRate: VIDEO_FPS });
  if (!videoCodec) throw new Error('This browser cannot encode video');
  const audioCodec = typeof AudioEncoder === 'undefined' ? null
    : await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE, quality: QUALITY_HIGH });

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: videoCodec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: VIDEO_FPS });
  const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  startVirtualTime();
  const stopCapture = captureSounds();
  let sounds: CapturedSound[] = [];
  let startedAt = 0, frames = 0;
  try {
    await options.begin();
    startedAt = realNow();
    const frameMs = 1000 / VIDEO_FPS, maxFrames = Math.ceil((options.maxMs ?? 30 * 60_000) / frameMs);
    while (frames < maxFrames) {
      if (options.cancelled()) throw new VideoExportCancelled();
      if (!options.playing()) break;
      advanceVirtualTime(frameMs);
      runner.run();
      if (options.cancelled()) throw new VideoExportCancelled();
      // The frame that ended the replay has already put the board back: it isn't part of the video.
      if (!options.playing()) break;
      await video.add(frames / VIDEO_FPS, 1 / VIDEO_FPS);
      frames++;
      // Let the page paint the progress note and stay responsive.
      if (frames % 15 === 0) { options.onProgress?.(frames / VIDEO_FPS); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  } finally {
    sounds = stopCapture();
    endVirtualTime();
  }
  if (!frames) { await output.cancel().catch(() => {}); throw new Error('The replay showed no frames'); }

  if (audio) {
    const durationS = frames / VIDEO_FPS;
    await audio.add(await mixSounds(sounds, startedAt, durationS));
  }
  await output.finalize();
  const buffer = (output.target as BufferTarget).buffer!;
  return new Blob([buffer], { type: 'video/mp4' });
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
