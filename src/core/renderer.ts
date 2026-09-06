import type { Clip, Project, MediaAsset } from '../types';
import { getTransform } from './project';

type Source = HTMLVideoElement | HTMLImageElement;
const sources = new Map<string, Promise<Source>>();
const audioSources = new Map<string, HTMLAudioElement>();
const audioGains = new Map<string, GainNode>();
let audioContext: AudioContext | undefined;
const canvasIds = new WeakMap<HTMLCanvasElement, string>();
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
  return sources.get(key)!;
}
async function seek(video: HTMLVideoElement, time: number) {
  const target = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.001));
  if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      video.removeEventListener('seeked', done);
      reject(new Error('视频定位超时，请重新导入素材。'));
    }, 12000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    video.addEventListener('seeked', done, { once: true });
    video.currentTime = target;
  });
}
const layer = document.createElement('canvas');
export async function renderProject(
  canvas: HTMLCanvasElement,
  project: Project,
  time: number,
  options?: { width?: number; height?: number },
) {
  const width = options?.width ?? project.width,
    height = options?.height ?? project.height;
  if (!canvasIds.has(canvas)) canvasIds.set(canvas, crypto.randomUUID());
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
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
    const asset = project.assets.find((a) => a.id === clip.assetId);
    let source: Source | undefined;
    if (asset) {
      if (asset.missing) throw new Error(`找不到素材 ${asset.name}，请使用“重新链接素材”恢复。`);
      source = await load(asset, `${canvasIds.get(canvas)}:${clip.id}`);
      if (source instanceof HTMLVideoElement)
        await seek(source, clip.inPoint + (time - clip.start) * clip.speed);
    }
    drawClip(ctx, clip, source, time - clip.start, project, width, height);
  }
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
  let fade = 1;
  if (clip.fadeIn > 0) fade = Math.min(fade, local / clip.fadeIn);
  if (clip.fadeOut > 0) fade = Math.min(fade, (clip.duration - local) / clip.fadeOut);
  ctx.save();
  ctx.translate(width / 2 + tr.x * s, height / 2 + tr.y * (height / project.height));
  ctx.rotate((tr.rotation * Math.PI) / 180);
  ctx.scale(tr.scale * (fx.flipX ? -1 : 1), tr.scale * (fx.flipY ? -1 : 1));
  ctx.globalAlpha = Math.max(0, Math.min(1, tr.opacity * fade));
  ctx.filter = `brightness(${fx.brightness}) contrast(${fx.contrast}) saturate(${fx.saturation}) hue-rotate(${fx.hue}deg) blur(${fx.blur * s}px) grayscale(${fx.grayscale}) sepia(${fx.sepia})`;
  let dw = width,
    dh = height;
  if (source) {
    const iw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth,
      ih = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    const fit = Math.min(width / iw, height / ih);
    dw = iw * fit;
    dh = ih * fit;
  }
  if (fx.mask !== 'none') {
    ctx.beginPath();
    if (fx.mask === 'circle')
      ctx.ellipse(
        0,
        0,
        (Math.min(dw, dh) * fx.maskSize) / 2,
        (Math.min(dw, dh) * fx.maskSize) / 2,
        0,
        0,
        Math.PI * 2,
      );
    else
      ctx.rect(
        (-dw * fx.maskSize) / 2,
        (-dh * fx.maskSize) / 2,
        dw * fx.maskSize,
        dh * fx.maskSize,
      );
    ctx.clip();
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
      audioGains.get(clip.id)?.disconnect();
      audioGains.delete(clip.id);
    }
    const local = time - clip.start;
    const target = clip.inPoint + local * clip.speed;
    media.playbackRate = Math.max(0.0625, Math.min(16, clip.speed));
    if (audioContext && !audioGains.has(clip.id)) {
      const gain = audioContext.createGain();
      audioContext.createMediaElementSource(media).connect(gain).connect(audioContext.destination);
      audioGains.set(clip.id, gain);
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
      gain.gain.value = volume;
      media.volume = 1;
    } else media.volume = Math.min(1, volume);
    if (Math.abs(media.currentTime - target) > 0.18) media.currentTime = target;
    if (playing && media.paused) void media.play().catch(() => {});
    if (!playing) media.pause();
  }
  for (const [id, media] of audioSources) if (!playing || !active.has(id)) media.pause();
}
export function clearMediaCache() {
  for (const [, media] of audioSources) {
    media.pause();
    media.removeAttribute('src');
    media.load();
  }
  audioSources.clear();
  for (const gain of audioGains.values()) gain.disconnect();
  audioGains.clear();
  for (const pending of sources.values())
    void pending
      .then((source) => {
        if (source instanceof HTMLVideoElement) {
          source.pause();
          source.removeAttribute('src');
          source.load();
        }
      })
      .catch(() => {});
  sources.clear();
}
