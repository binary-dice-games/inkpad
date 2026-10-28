// MIT License © 2026 Carlos Lopez
/**
 * @file Tab capture for the offscreen document (spec/03_tab_streaming). The
 * captured tab is relayed through a canvas so the sent frame rate is exactly
 * the configured one, a downscale is applied, and a still page keeps sending
 * a frame now and then (otherwise the compositor sends none and a viewer who
 * joins later would see nothing). The canvas stream stays the same when the
 * capture is restarted for a new tab shape, so the viewers' video carries on.
 */
import type { VideoSettings } from '@inkpad/defaults';

// Chrome's insertable streams are not in every TypeScript DOM lib.
declare class MediaStreamTrackProcessor {
  constructor(init: { track: MediaStreamTrack });
  readonly readable: ReadableStream<VideoFrame>;
}

/** The largest size the raw capture is asked for. */
const CAPTURE_LIMIT = { width: 1920, height: 1080 };
/** How often the compositor is asked for frames; the sent rate is the settings'. */
const CAPTURE_FPS = 10;
/** A still page is sent again at least this often (ms). */
const REFRESH_MS = 1000;

/**
 * `width x height` scaled down to fit inside `maxWidth x maxHeight`, keeping
 * the aspect, never upscaled; each side an even number of at least 2.
 */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const scale = Math.min(1, maxWidth / w, maxHeight / h);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(w * scale), height: even(h * scale) };
}

export interface Capture {
  /** The video to send to viewers. */
  readonly stream: MediaStream;
  /** The size of the sent frame. */
  size(): { width: number; height: number };
  /**
   * The shared tab changed shape: capture it again with a fresh stream id
   * (Chrome ignores new constraints on a running tab capture).
   * @throws {Error} if Chrome refuses the new capture; the capture is then
   *         lost and the last frame stays on the viewers' screens
   */
  restart(
    getStreamId: () => Promise<string>,
    tab: { width: number; height: number },
  ): Promise<void>;
  /** New frame rate or size limit, effective from the next frame. */
  setVideo(video: VideoSettings): void;
  /** Ends the capture. */
  stop(): void;
}

/** One running tab capture and the loop reading its frames. */
interface Source {
  stop(): void;
}

/**
 * Captures the tab behind `streamId`.
 *
 * @param streamId from `chrome.tabCapture.getMediaStreamId`
 * @param tab the tab's size in CSS pixels
 * @param video frame rate and size limits of the sent video
 * @throws {Error} if Chrome refuses the capture (for example the id was used)
 */
export async function startCapture(
  streamId: string,
  tab: { width: number; height: number },
  video: VideoSettings,
): Promise<Capture> {
  let settings = video;
  const canvas = document.createElement('canvas');
  const out = canvas.captureStream(0);
  const outTrack = out.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  outTrack.contentHint = video.contentHint;
  const context = canvas.getContext('2d');
  let latest: VideoFrame | null = null;
  let lastSent = 0;
  let stopped = false;

  const emit = (): void => {
    if (!latest || !context) {
      return;
    }
    const fit = fitWithin(
      latest.displayWidth,
      latest.displayHeight,
      settings.maxWidth,
      settings.maxHeight,
    );
    if (canvas.width !== fit.width || canvas.height !== fit.height) {
      canvas.width = fit.width;
      canvas.height = fit.height;
    }
    context.drawImage(latest, 0, 0, canvas.width, canvas.height);
    outTrack.requestFrame();
    lastSent = performance.now();
  };

  /** Opens a tab capture sized to `size` and feeds its frames to the relay. */
  const open = async (id: string, size: { width: number; height: number }): Promise<Source> => {
    const raw = fitWithin(size.width, size.height, CAPTURE_LIMIT.width, CAPTURE_LIMIT.height);
    const constraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: id,
          maxWidth: raw.width,
          maxHeight: raw.height,
          maxFrameRate: CAPTURE_FPS,
        },
      },
    };
    const source = await navigator.mediaDevices.getUserMedia(constraints as MediaStreamConstraints);
    const track = source.getVideoTracks()[0];
    if (!track) {
      source.getTracks().forEach((t) => t.stop());
      throw new Error('the tab capture has no video');
    }
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    let closed = false;
    void (async () => {
      while (!closed && !stopped) {
        const { value, done } = await reader.read();
        if (done || !value) {
          return;
        }
        if (closed) {
          value.close();
          return;
        }
        latest?.close();
        latest = value;
        if (performance.now() - lastSent >= 1000 / settings.fps) {
          emit();
        }
      }
    })().catch(() => {});
    return {
      stop() {
        closed = true;
        reader.cancel().catch(() => {});
        source.getTracks().forEach((t) => t.stop());
      },
    };
  };

  let current = await open(streamId, tab);

  // A still page sends no frames of its own: repeat the last one.
  const refresh = setInterval(() => {
    if (performance.now() - lastSent >= Math.min(REFRESH_MS, 1500 / settings.fps)) {
      emit();
    }
  }, REFRESH_MS / 2);

  return {
    stream: out,
    size: () => ({ width: canvas.width, height: canvas.height }),
    async restart(getStreamId, size) {
      // Chrome refuses a second capture of a tab that is still being captured, so the
      // old one stops first; until the new one runs, viewers see the last frame. The
      // tab takes a moment to be released, hence the retries with a fresh id each time.
      current.stop();
      let failure: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          current = await open(await getStreamId(), size);
          return;
        } catch (e) {
          failure = e;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      throw failure;
    },
    setVideo(next) {
      settings = next;
      outTrack.contentHint = next.contentHint;
    },
    stop() {
      stopped = true;
      clearInterval(refresh);
      current.stop();
      latest?.close();
      latest = null;
      out.getTracks().forEach((t) => t.stop());
    },
  };
}
