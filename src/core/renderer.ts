import type { Clip, Project, MediaAsset } from '../types';
import { getTransform } from './project';
import { createAudioRouting } from './audio-routing';
import { maskPolygon } from './masks';

type Source = HTMLVideoElement | HTMLImageElement;
const sources = new Map<string, Promise<Source>>();
const audioSources = new Map<string, HTMLAudioElement>();
const audioGains = new Map<string, ReturnType<typeof createAudioRouting>>();
let audioContext: AudioContext | undefined;
const canvasIds = new WeakMap<HTMLCanvasElement, string>();
const renderBuffers = new WeakMap<
  HTMLCanvasElement,
  { canvas: HTMLCanvasElement; busy: boolean }
>();
let cacheEpoch = 0;
function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('预览请求已更新', 'AbortError');
}
function cancellable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkCancelled(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('预览请求已更新', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function load(asset: MediaAsset, clipId: string): Promise<Source> {
  const key = `${clipId}:${asset.url}`;
  if (!sources.has(key))
    sources.set(
      key,
      new Promise((resolve, reject) => {
        const media = asset.kind === 'image' ? new Image() : document.createElement('video');
        media.crossOrigin = 'anonymous';
        const timer = setTimeout(
          () => reject(new Error(`无法读取 ${asset.name}，请检查文件或转为 MP4/H.264。`)),
          15000,
        );
        if (media instanceof HTMLVideoElement) {
          media.muted = true;
          media.preload = 'auto';
          media.playsInline = true;
          media.onloadeddata = () => {
            clearTimeout(timer);
            resolve(media);
          };
        } else
          media.onload = () => {
            clearTimeout(timer);
            resolve(media);
          };
        media.onerror = () => {
          clearTimeout(timer);
          reject(new Error(`素材无法解码：${asset.name}`));
        };
        media.src = asset.url;
      }),
    );
  const pending = sources.get(key)!;
  void pending.catch(() => {
    if (sources.get(key) === pending) sources.delete(key);
  });
  return pending;
}
async function seek(video: HTMLVideoElement, time: number, signal?: AbortSignal) {
  checkCancelled(signal);
  const target = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.001));
  if (!video.seeking && Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2)
    return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('视频定位超时，请重新导入素材。'));
    }, 12000);
    const done = () => {
      if (video.seeking || video.readyState < 2 || Math.abs(video.currentTime - target) > 0.002)
        return;
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error('视频解码失败，请重新导入素材。'));
    };
    const aborted = () => {
      cleanup();
      reject(new DOMException('预览请求已更新', 'AbortError'));
    };
    video.addEventListener('seeked', done);
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
    try {
      video.currentTime = target;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
const layer = document.createElement('canvas');
export interface RenderOptions {
  width?: number;
  height?: number;
  signal?: AbortSignal;
  /** Stable preview ownership; exports default to their own canvas identity. */
  sourceScope?: string;
}
export async function renderProject(
  canvas: HTMLCanvasElement,
  project: Project,
  time: number,
  options?: RenderOptions,
) {
  checkCancelled(options?.signal);
  const epoch = cacheEpoch;
  const width = options?.width ?? project.width,
    height = options?.height ?? project.height;
  if (!canvasIds.has(canvas)) canvasIds.set(canvas, crypto.randomUUID());
  // Nothing touches the visible canvas until every source has decoded and sought.
  let buffer = renderBuffers.get(canvas);
  if (!buffer || buffer.busy) {
    const available = !buffer;
    buffer = { canvas: document.createElement('canvas'), busy: false };
    if (available) renderBuffers.set(canvas, buffer);
  }
  buffer.busy = true;
  try {
    const frame = buffer.canvas;
    if (frame.width !== width) frame.width = width;
    if (frame.height !== height) frame.height = height;
    const ctx = frame.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = project.background;
    ctx.fillRect(0, 0, width, height);
    const ordered = project.tracks
      .filter((t) => !t.hidden && t.kind !== 'audio')
      .slice()
      .reverse()
      .flatMap((track) =>
        project.clips.filter(
          (c) =>
            c.trackId === track.id &&
            c.kind !== 'audio' &&
            time >= c.start &&
            time < c.start + c.duration,
        ),
      );
    for (const clip of ordered) {
      checkCancelled(options?.signal);
      const asset = project.assets.find((a) => a.id === clip.assetId);
      if (asset?.kind === 'audio') continue;
      let source: Source | undefined;
      if (asset) {
        if (asset.missing) throw new Error(`找不到素材 ${asset.name}，请使用“重新链接素材”恢复。`);
        source = await cancellable(
          load(asset, `${options?.sourceScope ?? canvasIds.get(canvas)}:${clip.id}`),
          options?.signal,
        );
        if (source instanceof HTMLVideoElement)
          await seek(source, clip.inPoint + (time - clip.start) * clip.speed, options?.signal);
      }
      checkCancelled(options?.signal);
      drawClip(ctx, clip, source, time - clip.start, project, width, height);
    }
    checkCancelled(options?.signal);
    if (epoch !== cacheEpoch) throw new DOMException('素材缓存已关闭', 'AbortError');
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const target = canvas.getContext('2d')!;
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = 1;
    target.filter = 'none';
    target.globalCompositeOperation = 'copy';
    target.drawImage(frame, 0, 0);
    target.restore();
  } finally {
    buffer.busy = false;
  }
}

/** Latest-only interactive preview. renderProject itself remains strict for export. */
export function createPreviewRenderer() {
  const sourceScope = crypto.randomUUID();
  type Request = {
    canvas: HTMLCanvasElement;
    project: Project;
    time: number;
    width: number;
    height: number;
    promise: Promise<boolean>;
    resolve: (committed: boolean) => void;
    reject: (reason: unknown) => void;
  };
  let pending: Request | undefined,
    active: AbortController | undefined,
    desired: Request | undefined;
  let running = false,
    disposed = false,
    lastCanvas: HTMLCanvasElement | undefined;
  async function pump() {
    if (running || disposed) return;
    running = true;
    try {
      while (pending && !disposed) {
        const request = pending;
        pending = undefined;
        active = new AbortController();
        try {
          await renderProject(request.canvas, request.project, request.time, {
            width: request.width,
            height: request.height,
            sourceScope,
            signal: active.signal,
          });
          lastCanvas = request.canvas;
          request.resolve(true);
        } catch (error) {
          if (active.signal.aborted || disposed) request.resolve(false);
          else {
            if (desired === request) desired = undefined;
            request.reject(error);
          }
        } finally {
          active = undefined;
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    request(
      canvas: HTMLCanvasElement,
      project: Project,
      time: number,
      options?: Pick<RenderOptions, 'width' | 'height'>,
    ): Promise<boolean> {
      if (disposed) return Promise.resolve(false);
      const width = options?.width ?? project.width,
        height = options?.height ?? project.height;
      if (
        desired &&
        desired.canvas === canvas &&
        desired.project === project &&
        desired.time === time &&
        desired.width === width &&
        desired.height === height
      )
        return desired.promise;
      // A remounted preview immediately inherits the most recent complete frame.
      if (lastCanvas && lastCanvas !== canvas) {
        canvas.width = lastCanvas.width;
        canvas.height = lastCanvas.height;
        canvas.getContext('2d')!.drawImage(lastCanvas, 0, 0);
      }
      pending?.resolve(false);
      active?.abort();
      let resolve!: Request['resolve'], reject!: Request['reject'];
      const promise = new Promise<boolean>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      desired = pending = { canvas, project, time, width, height, promise, resolve, reject };
      void pump();
      return promise;
    },
    dispose() {
      disposed = true;
      active?.abort();
      pending?.resolve(false);
      pending = undefined;
      desired = undefined;
      for (const [key, media] of sources)
        if (key.startsWith(`${sourceScope}:`)) {
          sources.delete(key);
          void media.then(releaseSource).catch(() => {});
        }
    },
  };
}
function releaseSource(source: Source) {
  if (source instanceof HTMLVideoElement) {
    source.pause();
    source.removeAttribute('src');
    source.load();
  }
}
const featherLayer = document.createElement('canvas');
const featherAlpha = document.createElement('canvas');
function maskPath(clip: Clip, width: number, height: number, inverse = false) {
  const path = new Path2D();
  if (inverse) path.rect(-10000000, -10000000, 20000000, 20000000);
  const points = maskPolygon(clip.effects, width, height);
  if (points.length) {
    path.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) path.lineTo(point.x, point.y);
    path.closePath();
  }
  return path;
}
function drawClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  source: Source | undefined,
  local: number,
  project: Project,
  width: number,
  height: number,
) {
  const tr = getTransform(clip, local),
    fx = clip.effects,
    s = width / project.width;
  let dw = width,
    dh = height;
  if (source) {
    const iw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth,
      ih = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    const fit = Math.min(width / iw, height / ih);
    dw = iw * fit;
    dh = ih * fit;
  }
  if (fx.mask !== 'none' && (fx.maskFeather ?? 0) > 0) {
    // Composite this clip into its own alpha surface so feathering never erases lower tracks.
    // This synchronous path is shared by preview and strict export frames.
    featherLayer.width = featherAlpha.width = width;
    featherLayer.height = featherAlpha.height = height;
    const content = featherLayer.getContext('2d')!,
      alpha = featherAlpha.getContext('2d')!;
    drawClip(
      content,
      { ...clip, effects: { ...fx, mask: 'none' } },
      source,
      local,
      project,
      width,
      height,
    );
    if (fx.maskInvert) {
      alpha.fillStyle = '#ffffff';
      alpha.fillRect(0, 0, width, height);
      alpha.globalCompositeOperation = 'destination-out';
    }
    alpha.translate(width / 2 + tr.x * s, height / 2 + tr.y * (height / project.height));
    alpha.rotate((tr.rotation * Math.PI) / 180);
    alpha.scale(tr.scale * (fx.flipX ? -1 : 1), tr.scale * (fx.flipY ? -1 : 1));
    alpha.filter = `blur(${(fx.maskFeather ?? 0) * Math.min(dw, dh) * tr.scale}px)`;
    alpha.fillStyle = '#ffffff';
    alpha.fill(maskPath(clip, dw, dh));
    content.globalCompositeOperation = 'destination-in';
    content.drawImage(featherAlpha, 0, 0);
    ctx.drawImage(featherLayer, 0, 0);
    return;
  }
  let fade = 1;
  if (clip.fadeIn > 0) fade = Math.min(fade, local / clip.fadeIn);
  if (clip.fadeOut > 0) fade = Math.min(fade, (clip.duration - local) / clip.fadeOut);
  ctx.save();
  ctx.translate(width / 2 + tr.x * s, height / 2 + tr.y * (height / project.height));
  ctx.rotate((tr.rotation * Math.PI) / 180);
  ctx.scale(tr.scale * (fx.flipX ? -1 : 1), tr.scale * (fx.flipY ? -1 : 1));
  ctx.globalAlpha = Math.max(0, Math.min(1, tr.opacity * fade));
  ctx.filter = `brightness(${fx.brightness}) contrast(${fx.contrast}) saturate(${fx.saturation}) hue-rotate(${fx.hue}deg) blur(${fx.blur * s}px) grayscale(${fx.grayscale}) sepia(${fx.sepia})`;
  if (fx.mask !== 'none') {
    ctx.clip(maskPath(clip, dw, dh, fx.maskInvert), 'evenodd');
  }
  if (clip.kind === 'text' && clip.text) {
    const text = clip.text;
    ctx.textAlign = text.align;
    ctx.textBaseline = 'middle';
    ctx.font = `${text.bold ? '700' : '400'} ${text.fontSize * s}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    const lines = text.text.split('\n');
    const lh = text.fontSize * s * 1.3;
    const max = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (text.background !== 'transparent') {
      ctx.fillStyle = text.background;
      ctx.fillRect(
        (text.align === 'center' ? -max / 2 : text.align === 'right' ? -max : 0) - 18 * s,
        (-lines.length * lh) / 2 - 8 * s,
        max + 36 * s,
        lines.length * lh + 16 * s,
      );
    }
    lines.forEach((line, i) => {
      const y = (i - (lines.length - 1) / 2) * lh;
      if (text.stroke) {
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 5 * s;
        ctx.lineJoin = 'round';
        ctx.strokeText(line, 0, y);
      }
      ctx.fillStyle = text.color;
      ctx.fillText(line, 0, y);
    });
  } else if (source) {
    if (fx.chroma || fx.pixelate > 0) {
      const px = Math.max(1, fx.pixelate * s);
      layer.width = Math.max(1, Math.round(dw / px));
      layer.height = Math.max(1, Math.round(dh / px));
      const lc = layer.getContext('2d', { willReadFrequently: true })!;
      lc.drawImage(source, 0, 0, layer.width, layer.height);
      if (fx.chroma) {
        const data = lc.getImageData(0, 0, layer.width, layer.height);
        const col = fx.chromaColor.match(/[a-f\d]{2}/gi)?.map((h) => parseInt(h, 16)) ?? [
          0, 255, 0,
        ];
        for (let i = 0; i < data.data.length; i += 4) {
          const d = Math.hypot(
            data.data[i] - col[0],
            data.data[i + 1] - col[1],
            data.data[i + 2] - col[2],
          );
          data.data[i + 3] *= Math.max(0, Math.min(1, (d - fx.chromaThreshold) / 30));
        }
        lc.putImageData(data, 0, 0);
      }
      ctx.imageSmoothingEnabled = fx.pixelate === 0;
      ctx.drawImage(layer, -dw / 2, -dh / 2, dw, dh);
    } else ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);
  } else if (clip.kind === 'shape') {
    ctx.fillStyle = clip.color ?? '#254940';
    ctx.fillRect(-width / 2, -height / 2, width, height);
  }
  if (fx.vignette > 0) {
    ctx.filter = 'none';
    const gradient = ctx.createRadialGradient(
      0,
      0,
      Math.min(dw, dh) * 0.2,
      0,
      0,
      Math.max(dw, dh) * 0.65,
    );
    gradient.addColorStop(0, 'transparent');
    gradient.addColorStop(1, `rgba(0,0,0,${fx.vignette})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
  }
  ctx.restore();
}
export function syncAudio(project: Project, time: number, playing: boolean) {
  const active = new Set<string>();
  if (playing && !audioContext) audioContext = new AudioContext();
  if (playing && audioContext?.state === 'suspended') void audioContext.resume();
  for (const clip of project.clips) {
    if (!['video', 'audio'].includes(clip.kind)) continue;
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (track?.muted || time < clip.start || time >= clip.start + clip.duration) continue;
    const asset = project.assets.find((a) => a.id === clip.assetId);
    if (!asset) continue;
    active.add(clip.id);
    let media = audioSources.get(clip.id);
    if (!media || media.src !== asset.url) {
      media?.pause();
      media = new Audio();
      media.crossOrigin = 'anonymous';
      media.src = asset.url;
      media.preload = 'auto';
      audioSources.set(clip.id, media);
      audioGains.get(clip.id)?.dispose();
      audioGains.delete(clip.id);
    }
    const local = time - clip.start;
    const target = clip.inPoint + local * clip.speed;
    media.playbackRate = Math.max(0.0625, Math.min(16, clip.speed));
    if (audioContext && !audioGains.has(clip.id)) {
      const routing = createAudioRouting(
        audioContext,
        audioContext.createMediaElementSource(media),
      );
      routing.output.connect(audioContext.destination);
      audioGains.set(clip.id, routing);
    }
    const fade =
      Math.min(1, clip.fadeIn ? local / clip.fadeIn : 1) *
      Math.min(
        1,
        clip.fadeOut ? (clip.duration - local) / Math.min(clip.duration, clip.fadeOut) : 1,
      );
    const volume = Math.max(0, Math.min(4, getTransform(clip, local).volume * fade));
    const gain = audioGains.get(clip.id);
    if (gain) {
      gain.set(clip.audio, volume);
      media.volume = 1;
    } else media.volume = Math.min(1, volume);
    if (Math.abs(media.currentTime - target) > 0.18) media.currentTime = target;
    if (playing && media.paused) void media.play().catch(() => {});
    if (!playing) media.pause();
  }
  for (const [id, media] of audioSources) if (!playing || !active.has(id)) media.pause();
}
export function clearMediaCache() {
  cacheEpoch++;
  for (const [, media] of audioSources) {
    media.pause();
    media.removeAttribute('src');
    media.load();
  }
  audioSources.clear();
  for (const gain of audioGains.values()) gain.dispose();
  audioGains.clear();
  for (const pending of sources.values()) void pending.then(releaseSource).catch(() => {});
  sources.clear();
}
