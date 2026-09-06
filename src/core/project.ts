import type {
  AnimProperty,
  Clip,
  Easing,
  Effects,
  Keyframe,
  Project,
  TextStyle,
  Transform,
} from '../types';

const properties: AnimProperty[] = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'];
const easings: Easing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'];
const MAX_TIME = 24 * 60 * 60;
const EPS = 1e-8;
const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const defaultTransform = (): Transform => ({
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  volume: 1,
});
export const defaultEffects = (): Effects => ({
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hue: 0,
  blur: 0,
  grayscale: 0,
  sepia: 0,
  vignette: 0,
  pixelate: 0,
  chroma: false,
  chromaColor: '#00ff00',
  chromaThreshold: 80,
  flipX: false,
  flipY: false,
  mask: 'none',
  maskSize: 1,
});
const defaultText = (): TextStyle => ({
  text: '添加文字',
  fontSize: 72,
  color: '#ffffff',
  background: 'transparent',
  align: 'center',
  bold: true,
  stroke: true,
});

export function createProject(): Project {
  return {
    version: 1,
    id: uid(),
    name: '未命名项目',
    width: 1920,
    height: 1080,
    fps: 30,
    background: '#101014',
    assets: [],
    clips: [],
    tracks: [
      { id: 'overlay', name: '叠加', kind: 'overlay', muted: false, hidden: false, locked: false },
      { id: 'video', name: '画面', kind: 'video', muted: false, hidden: false, locked: false },
      { id: 'audio', name: '音频', kind: 'audio', muted: false, hidden: false, locked: false },
    ],
  };
}

type ClipOverrides = Omit<Partial<Clip>, 'transform' | 'effects' | 'text'> & {
  transform?: Partial<Transform>;
  effects?: Partial<Effects>;
  text?: Partial<TextStyle>;
};
export function createClip(kind: Clip['kind'], trackId: string, partial: ClipOverrides = {}): Clip {
  const { text: textOverride, ...rest } = partial;
  return {
    id: uid(),
    name: kind === 'text' ? '文字' : kind === 'shape' ? '色块' : '素材',
    kind,
    trackId,
    start: 0,
    duration: 5,
    inPoint: 0,
    speed: 1,
    fadeIn: 0,
    fadeOut: 0,
    ...(kind === 'text' ? { text: defaultText() } : {}),
    ...(kind === 'shape' ? { color: '#8b5cf6' } : {}),
    ...rest,
    transform: { ...defaultTransform(), ...partial.transform },
    effects: { ...defaultEffects(), ...partial.effects },
    keyframes: Object.fromEntries(
      Object.entries(partial.keyframes ?? {}).map(([key, points]) => [
        key,
        points?.map((point) => ({ ...point })),
      ]),
    ),
    ...(kind === 'text' || textOverride ? { text: { ...defaultText(), ...textOverride } } : {}),
  };
}

function eased(t: number, easing: Easing): number {
  switch (easing) {
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'hold':
      return 0;
    default:
      return t;
  }
}

function ordered(points: Keyframe[]): Keyframe[] {
  const unique = new Map<number, Keyframe>();
  for (const point of points)
    if (Number.isFinite(point.time) && Number.isFinite(point.value)) unique.set(point.time, point);
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

function sample(points: Keyframe[], time: number, fallback: number): number {
  if (!points.length) return fallback;
  if (time <= points[0].time) return points[0].value;
  if (time >= points[points.length - 1].time) return points[points.length - 1].value;
  let low = 0,
    high = points.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (points[mid].time <= time) low = mid;
    else high = mid;
  }
  const a = points[low],
    b = points[high];
  return a.value + (b.value - a.value) * eased((time - a.time) / (b.time - a.time), a.easing);
}

/** localTime is measured in project seconds from the clip's start, independent of source speed. */
export function evaluate(clip: Clip, prop: AnimProperty, localTime: number): number {
  return sample(
    ordered(clip.keyframes[prop] ?? []),
    Number.isFinite(localTime) ? localTime : 0,
    clip.transform[prop],
  );
}

export function getTransform(clip: Clip, localTime: number): Transform {
  return Object.fromEntries(
    properties.map((prop) => [prop, evaluate(clip, prop, localTime)]),
  ) as unknown as Transform;
}

export function durationOf(project: Project): number {
  return project.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
}

/** Cut a curve while preserving untouched easing spans. Partial nonlinear spans are adaptively
 * sampled because the public schema cannot express a shortened easing curve's control points. */
function sliceAnimation(clip: Clip, begin: number, end: number): Clip['keyframes'] {
  const output: Clip['keyframes'] = {};
  for (const prop of properties) {
    const points = ordered(clip.keyframes[prop] ?? []);
    if (!points.length) continue;
    const breaks = [
      begin,
      ...points
        .filter((point) => point.time > begin + EPS && point.time < end - EPS)
        .map((point) => point.time),
      end,
    ];
    const result: Keyframe[] = [];
    const valueAt = (time: number) => sample(points, time, clip.transform[prop]);
    const add = (time: number, easing: Easing) => {
      const previous = result[result.length - 1];
      if (previous && Math.abs(previous.time - (time - begin)) < EPS) {
        previous.easing = easing;
        return;
      }
      result.push({
        id: points.find((point) => Math.abs(point.time - time) < EPS)?.id ?? uid(),
        time: Math.max(0, time - begin),
        value: valueAt(time),
        easing,
      });
    };
    for (let i = 0; i < breaks.length - 1; i++) {
      const a = breaks[i],
        b = breaks[i + 1],
        mid = (a + b) / 2;
      const index = points.findIndex(
        (point, p) => p + 1 < points.length && point.time <= mid && points[p + 1].time > mid,
      );
      const source = index >= 0 ? points[index] : undefined;
      const whole =
        source && Math.abs(a - source.time) < EPS && Math.abs(b - points[index + 1].time) < EPS;
      const easing = source?.easing ?? 'linear';
      if (whole || easing === 'linear' || easing === 'hold') {
        add(a, easing);
        add(b, 'linear');
        continue;
      }
      const tolerance = prop === 'x' || prop === 'y' ? 0.02 : prop === 'rotation' ? 0.002 : 0.00001;
      const subdivide = (left: number, right: number, depth: number) => {
        const lv = valueAt(left),
          rv = valueAt(right);
        const error = Math.max(
          ...[0.25, 0.5, 0.75].map((ratio) =>
            Math.abs(valueAt(left + (right - left) * ratio) - (lv + (rv - lv) * ratio)),
          ),
        );
        if (error > tolerance && depth < 10) {
          const center = (left + right) / 2;
          subdivide(left, center, depth + 1);
          subdivide(center, right, depth + 1);
        } else {
          add(left, 'linear');
          add(right, 'linear');
        }
      };
      subdivide(a, b, 0);
    }
    output[prop] = result;
  }
  return output;
}

/** Bake the rendered fade envelope only when splitting. The public curve format has no
 * separate left/right values at a jump, so a changing held value gets a very short
 * terminal hold whose error stays below the sampling tolerance. */
function fadeCurve(clip: Clip, prop: 'opacity' | 'volume', begin: number, end: number): Keyframe[] {
  const points = ordered(clip.keyframes[prop] ?? []);
  const tolerance = 0.000025;
  const envelope = (time: number) => {
    const enter = clip.fadeIn ? clamp(time / clip.fadeIn, 0, 1) : 1;
    const leave = clip.fadeOut
      ? clamp((clip.duration - time) / Math.min(clip.duration, clip.fadeOut), 0, 1)
      : 1;
    return prop === 'opacity' ? Math.min(enter, leave) : enter * leave;
  };
  const value = (time: number) => sample(points, time, clip.transform[prop]) * envelope(time);
  // Fade corners and ease-in-out midpoints keep each sampled span polynomial.
  const corners = [clip.fadeIn, clip.duration - clip.fadeOut];
  if (clip.fadeIn && clip.fadeOut)
    corners.push((clip.duration * clip.fadeIn) / (clip.fadeIn + clip.fadeOut));
  for (let i = 0; i + 1 < points.length; i++)
    if (points[i].easing === 'ease-in-out') corners.push((points[i].time + points[i + 1].time) / 2);
  const breaks = [
    ...new Set([
      begin,
      ...points.map((point) => point.time).filter((time) => time > begin && time < end),
      ...corners.filter((time) => time > begin && time < end),
      end,
    ]),
  ].sort((a, b) => a - b);
  const result: Keyframe[] = [];
  const add = (time: number, current: number, easing: Easing = 'linear') => {
    const local = time - begin,
      previous = result.at(-1);
    if (previous?.time === local) {
      previous.value = current;
      previous.easing = easing;
      return;
    }
    if (result.length >= 10_000) throw new Error('淡入淡出曲线过于复杂，分割后将超过关键帧上限。');
    result.push({ id: uid(), time: local, value: current, easing });
  };
  for (let i = 0; i + 1 < breaks.length; i++) {
    const a = breaks[i],
      b = breaks[i + 1],
      mid = (a + b) / 2;
    let index = -1;
    for (let p = 0; p < points.length && points[p].time <= mid; p++) index = p;
    const held = index >= 0 && points[index].easing === 'hold' && points[index + 1]?.time === b;
    const beforeEnd = held ? points[index].value * envelope(b) : value(b);
    const afterEnd = value(b);
    const curve = (time: number) => (time === b ? beforeEnd : value(time));
    const subdivide = (left: number, right: number, depth: number) => {
      const lv = curve(left),
        rv = curve(right);
      const error = Math.max(
        ...[0.25, 0.5, 0.75].map((ratio) =>
          Math.abs(curve(left + (right - left) * ratio) - (lv + (rv - lv) * ratio)),
        ),
      );
      if (error > tolerance) {
        if (depth >= 20) throw new Error('淡入淡出曲线变化过快，无法安全分割。');
        const center = (left + right) / 2;
        subdivide(left, center, depth + 1);
        subdivide(center, right, depth + 1);
      } else {
        add(left, lv);
        add(right, rv);
      }
    };
    if (beforeEnd !== afterEnd) {
      // Keep this interval above the existing slice tolerance and the exporter's
      // 8-decimal timestamp precision, so another split preserves the jump.
      let gap = Math.min((b - a) / 2, 0.000001);
      while (gap > 0.00000004 && Math.abs(curve(b - gap) - beforeEnd) > tolerance) gap /= 2;
      if (gap <= EPS * 2 || Math.abs(curve(b - gap) - beforeEnd) > tolerance)
        throw new Error('保持关键帧变化过快，无法安全保留分割处的淡入淡出。');
      const beforeJump = b - gap;
      subdivide(a, beforeJump, 0);
      result[result.length - 1].easing = 'hold';
      add(b, afterEnd);
    } else subdivide(a, b, 0);
  }
  return result;
}

export function splitClip(clip: Clip, globalTime: number): [Clip, Clip] | null {
  const time = globalTime - clip.start;
  if (!Number.isFinite(time) || time <= EPS || time >= clip.duration - EPS) return null;
  const leftFrames = sliceAnimation(clip, 0, time);
  const rightFrames = sliceAnimation(clip, time, clip.duration);
  if (clip.fadeIn || clip.fadeOut) {
    const faded: ('opacity' | 'volume')[] =
      clip.kind === 'audio'
        ? ['volume']
        : clip.kind === 'video'
          ? ['opacity', 'volume']
          : ['opacity'];
    for (const prop of faded) {
      leftFrames[prop] = fadeCurve(clip, prop, 0, time);
      rightFrames[prop] = fadeCurve(clip, prop, time, clip.duration);
    }
  }
  for (const frames of [leftFrames, rightFrames])
    if (Object.values(frames).some((points) => points && points.length > 10_000))
      throw new Error('分割后将超过关键帧上限，请先简化动画。');
  const left = createClip(clip.kind, clip.trackId, {
    ...clip,
    duration: time,
    fadeIn: 0,
    fadeOut: 0,
    keyframes: leftFrames,
  });
  const right = createClip(clip.kind, clip.trackId, {
    ...clip,
    id: uid(),
    start: globalTime,
    duration: clip.duration - time,
    inPoint: clip.inPoint + time * clip.speed,
    fadeIn: 0,
    fadeOut: 0,
    keyframes: rightFrames,
  });
  return [left, right];
}

/** Positive deltas remove project-time seconds from the respective edge; negative values extend. */
export function trimClip(clip: Clip, leftDelta: number, rightDelta: number): Clip {
  if (!Number.isFinite(leftDelta) || !Number.isFinite(rightDelta))
    throw new Error('裁剪时间必须是有限数字');
  const left = clamp(
    leftDelta,
    Math.max(-clip.start, -clip.inPoint / clip.speed),
    clip.duration - 0.001,
  );
  const right = clamp(
    rightDelta,
    clip.start + clip.duration - MAX_TIME,
    clip.duration - left - 0.001,
  );
  const duration = Math.max(0.001, clip.duration - left - right);
  return createClip(clip.kind, clip.trackId, {
    ...clip,
    start: clip.start + left,
    duration,
    inPoint: Math.max(0, clip.inPoint + left * clip.speed),
    fadeIn: Math.min(clip.fadeIn, duration),
    fadeOut: Math.min(clip.fadeOut, duration),
    keyframes: sliceAnimation(clip, left, clip.duration - right),
  });
}

export function parseSrt(text: string): { start: number; duration: number; text: string }[] {
  if (typeof text !== 'string' || text.length > 5_000_000) throw new Error('字幕文件无效或过大');
  const cues: { start: number; duration: number; text: string }[] = [];
  const timestamp = (value: string) => {
    const match = /^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(value);
    if (!match || +match[2] > 59 || +match[3] > 59) return NaN;
    return +match[1] * 3600 + +match[2] * 60 + +match[3] + Number(match[4].padEnd(3, '0')) / 1000;
  };
  for (const block of text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n[ \t]*\n+/)) {
    const lines = block.split('\n');
    const index = /^\s*\d+\s*$/.test(lines[0]) ? 1 : 0;
    const timing =
      /^\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})(?:\s+.*)?$/.exec(
        lines[index] ?? '',
      );
    if (!timing) continue;
    const start = timestamp(timing[1]),
      end = timestamp(timing[2]),
      content = lines
        .slice(index + 1)
        .join('\n')
        .trim();
    if (
      Number.isFinite(start) &&
      end > start &&
      end <= MAX_TIME &&
      content.length &&
      content.length <= 20_000
    )
      cues.push({ start, duration: end - start, text: content });
    if (cues.length > 10_000) throw new Error('字幕条目过多');
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function toSrt(clips: Clip[]): string {
  const format = (seconds: number) => {
    const ms = Math.max(0, Math.round(seconds * 1000));
    return `${String(Math.floor(ms / 3_600_000)).padStart(2, '0')}:${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return clips
    .filter(
      (clip) =>
        clip.kind === 'text' &&
        clip.text?.text.trim() &&
        Number.isFinite(clip.start) &&
        Number.isFinite(clip.duration) &&
        clip.start >= 0 &&
        clip.duration > 0,
    )
    .sort((a, b) => a.start - b.start)
    .map(
      (clip, index) =>
        `${index + 1}\n${format(clip.start)} --> ${format(Math.max(clip.start + 0.001, clip.start + clip.duration))}\n${clip.text!.text.replace(/\r\n?/g, '\n').trim()}\n`,
    )
    .join('\n');
}

// Reconstruct every nested object rather than returning an untrusted object or spreading it.
export function validateProject(input: unknown): Project {
  const fail = (path: string): never => {
    throw new Error(`项目数据无效：${path}`);
  };
  const object = (value: unknown, path: string): Record<string, unknown> => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      return fail(path);
    if (Object.keys(value).some((key) => ['__proto__', 'constructor', 'prototype'].includes(key)))
      return fail(path);
    if (
      Object.values(Object.getOwnPropertyDescriptors(value)).some(
        (descriptor) => descriptor.get || descriptor.set,
      )
    )
      return fail(path);
    return value as Record<string, unknown>;
  };
  const str = (value: unknown, path: string, max = 500): string =>
    typeof value === 'string' && value.length <= max && !value.includes('\0') ? value : fail(path);
  const id = (value: unknown, path: string) => {
    const result = str(value, path, 200);
    return result.length && !/[\x00-\x1f]/.test(result) ? result : fail(path);
  };
  const num = (value: unknown, path: string, min: number, max: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
      ? value
      : fail(path);
  const integer = (value: unknown, path: string, min: number, max: number) => {
    const result = num(value, path, min, max);
    return Number.isInteger(result) ? result : fail(path);
  };
  const bool = (value: unknown, path: string): boolean =>
    typeof value === 'boolean' ? value : fail(path);
  const one = <T extends string>(value: unknown, options: readonly T[], path: string): T =>
    typeof value === 'string' && options.includes(value as T) ? (value as T) : fail(path);
  const arr = (value: unknown, path: string, max: number): unknown[] => {
    if (
      !Array.isArray(value) ||
      value.length > max ||
      Object.getPrototypeOf(value) !== Array.prototype
    )
      return fail(path);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (let index = 0; index < value.length; index++)
      if (!descriptors[index] || descriptors[index].get || descriptors[index].set)
        return fail(path);
    return value;
  };
  const color = (value: unknown, path: string): string => {
    const result = str(value, path, 80);
    return /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|transparent|black|white|(?:rgb|rgba)\(\s*[\d.%]+\s*,\s*[\d.%]+\s*,\s*[\d.%]+(?:\s*,\s*[\d.]+)?\s*\))$/i.test(
      result,
    )
      ? result
      : fail(path);
  };
  let urlBytes = 0,
    pointCount = 0;
  const url = (value: unknown, path: string, allowMissing = false): string => {
    const result = str(value, path, 12_000_000);
    urlBytes += result.length;
    if (allowMissing && result === '') return result;
    if (urlBytes > 50_000_000 || /[\x00-\x20\x7f]/.test(result)) return fail(path);
    if (
      /^blob:[^\s]+$/i.test(result) ||
      /^freecut-media:\/\/[^\s]+$/i.test(result) ||
      /^data:image\/(?:png|jpeg|jpg|webp|gif|avif|bmp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(result)
    )
      return result;
    return fail(path);
  };
  const ranges: Record<AnimProperty, [number, number]> = {
    x: [-100_000, 100_000],
    y: [-100_000, 100_000],
    scale: [0.001, 100],
    rotation: [-360_000, 360_000],
    opacity: [0, 1],
    volume: [0, 4],
  };
  const transform = (value: unknown, path: string): Transform => {
    const data = object(value, path);
    return Object.fromEntries(
      properties.map((prop) => [prop, num(data[prop], `${path}.${prop}`, ...ranges[prop])]),
    ) as unknown as Transform;
  };
  const effects = (value: unknown, path: string): Effects => {
    const data = object(value, path);
    if (typeof data.chromaColor !== 'string' || !/^#[\da-f]{6}$/i.test(data.chromaColor))
      fail(`${path}.chromaColor`);
    return {
      brightness: num(data.brightness, `${path}.brightness`, 0, 5),
      contrast: num(data.contrast, `${path}.contrast`, 0, 5),
      saturation: num(data.saturation, `${path}.saturation`, 0, 5),
      hue: num(data.hue, `${path}.hue`, -360, 360),
      blur: num(data.blur, `${path}.blur`, 0, 100),
      grayscale: num(data.grayscale, `${path}.grayscale`, 0, 1),
      sepia: num(data.sepia, `${path}.sepia`, 0, 1),
      vignette: num(data.vignette, `${path}.vignette`, 0, 1),
      pixelate: num(data.pixelate, `${path}.pixelate`, 0, 200),
      chroma: bool(data.chroma, `${path}.chroma`),
      chromaColor: color(data.chromaColor, `${path}.chromaColor`),
      chromaThreshold: num(data.chromaThreshold, `${path}.chromaThreshold`, 0, 442),
      flipX: bool(data.flipX, `${path}.flipX`),
      flipY: bool(data.flipY, `${path}.flipY`),
      mask: one(data.mask, ['none', 'circle', 'rectangle'], `${path}.mask`),
      maskSize: num(data.maskSize, `${path}.maskSize`, 0.01, 2),
    };
  };
  const root = object(input, 'root');
  if (root.version !== 1) fail('version');
  const project: Project = {
    version: 1,
    id: id(root.id, 'id'),
    name: str(root.name, 'name'),
    width: integer(root.width, 'width', 16, 8192),
    height: integer(root.height, 'height', 16, 8192),
    fps: num(root.fps, 'fps', 1, 120),
    background: color(root.background, 'background'),
    tracks: [],
    assets: [],
    clips: [],
  };
  const trackIds = new Set<string>(),
    assetIds = new Set<string>(),
    clipIds = new Set<string>();
  project.tracks = arr(root.tracks, 'tracks', 100).map((value, index) => {
    const p = `tracks[${index}]`,
      data = object(value, p),
      trackId = id(data.id, `${p}.id`);
    if (trackIds.has(trackId)) fail(`${p}.id 重复`);
    trackIds.add(trackId);
    return {
      id: trackId,
      name: str(data.name, `${p}.name`),
      kind: one(data.kind, ['video', 'audio', 'overlay'], `${p}.kind`),
      muted: bool(data.muted, `${p}.muted`),
      hidden: bool(data.hidden, `${p}.hidden`),
      locked: bool(data.locked, `${p}.locked`),
    };
  });
  if (!project.tracks.length) fail('tracks');
  project.assets = arr(root.assets, 'assets', 5000).map((value, index) => {
    const p = `assets[${index}]`,
      data = object(value, p),
      assetId = id(data.id, `${p}.id`);
    if (assetIds.has(assetId)) fail(`${p}.id 重复`);
    assetIds.add(assetId);
    let path: string | undefined;
    if (data.path !== undefined) {
      path = str(data.path, `${p}.path`, 32768);
      if (/^(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/i.test(path) && !/^[a-z]:[\\/]/i.test(path))
        fail(`${p}.path`);
    }
    return {
      id: assetId,
      name: str(data.name, `${p}.name`, 1000),
      kind: one(data.kind, ['video', 'audio', 'image'], `${p}.kind`),
      url: url(data.url, `${p}.url`, data.missing === true),
      duration: num(data.duration, `${p}.duration`, 0, MAX_TIME),
      ...(path === undefined ? {} : { path }),
      ...(data.width === undefined ? {} : { width: integer(data.width, `${p}.width`, 1, 32768) }),
      ...(data.height === undefined
        ? {}
        : { height: integer(data.height, `${p}.height`, 1, 32768) }),
      ...(data.thumbnail === undefined ? {} : { thumbnail: url(data.thumbnail, `${p}.thumbnail`) }),
      ...(data.missing === undefined ? {} : { missing: bool(data.missing, `${p}.missing`) }),
    };
  });
  project.clips = arr(root.clips, 'clips', 10_000).map((value, index) => {
    const p = `clips[${index}]`,
      data = object(value, p),
      clipId = id(data.id, `${p}.id`),
      trackId = id(data.trackId, `${p}.trackId`);
    if (clipIds.has(clipId)) fail(`${p}.id 重复`);
    clipIds.add(clipId);
    if (!trackIds.has(trackId)) fail(`${p}.trackId 不存在`);
    const kind = one(data.kind, ['video', 'audio', 'image', 'text', 'shape'], `${p}.kind`);
    const start = num(data.start, `${p}.start`, 0, MAX_TIME),
      duration = num(data.duration, `${p}.duration`, 0.001, MAX_TIME);
    if (start + duration > MAX_TIME) fail(`${p}.duration`);
    const keyframes: Clip['keyframes'] = {},
      frameData = object(data.keyframes, `${p}.keyframes`);
    if (Object.keys(frameData).some((key) => !properties.includes(key as AnimProperty)))
      fail(`${p}.keyframes`);
    for (const prop of properties)
      if (frameData[prop] !== undefined) {
        const ids = new Set<string>(),
          times = new Set<number>();
        keyframes[prop] = arr(frameData[prop], `${p}.keyframes.${prop}`, 10_000)
          .map((value) => {
            if (++pointCount > 200_000) fail('关键帧总数过多');
            const frame = object(value, `${p}.keyframes.${prop}`),
              frameId = id(frame.id, `${p}.keyframe.id`),
              time = num(frame.time, `${p}.keyframe.time`, 0, duration + EPS);
            if (ids.has(frameId) || times.has(time)) fail(`${p}.keyframe 重复`);
            ids.add(frameId);
            times.add(time);
            return {
              id: frameId,
              time: Math.min(duration, time),
              value: num(frame.value, `${p}.keyframe.value`, ...ranges[prop]),
              easing: one(frame.easing, easings, `${p}.keyframe.easing`),
            };
          })
          .sort((a, b) => a.time - b.time);
      }
    let text: TextStyle | undefined;
    if (data.text !== undefined) {
      const t = object(data.text, `${p}.text`);
      text = {
        text: str(t.text, `${p}.text.text`, 20_000),
        fontSize: num(t.fontSize, `${p}.text.fontSize`, 1, 2000),
        color: color(t.color, `${p}.text.color`),
        background: color(t.background, `${p}.text.background`),
        align: one(t.align, ['left', 'center', 'right'], `${p}.text.align`),
        bold: bool(t.bold, `${p}.text.bold`),
        stroke: bool(t.stroke, `${p}.text.stroke`),
      };
    }
    if (kind === 'text' && !text) fail(`${p}.text`);
    const assetId = data.assetId === undefined ? undefined : id(data.assetId, `${p}.assetId`);
    if (assetId !== undefined && !assetIds.has(assetId)) fail(`${p}.assetId 不存在`);
    if (['video', 'audio', 'image'].includes(kind) && !assetId) fail(`${p}.assetId`);
    return {
      id: clipId,
      name: str(data.name, `${p}.name`),
      kind,
      trackId,
      start,
      duration,
      inPoint: num(data.inPoint, `${p}.inPoint`, 0, MAX_TIME),
      speed: num(data.speed, `${p}.speed`, 0.05, 16),
      transform: transform(data.transform, `${p}.transform`),
      effects: effects(data.effects, `${p}.effects`),
      keyframes,
      fadeIn: num(data.fadeIn, `${p}.fadeIn`, 0, duration),
      fadeOut: num(data.fadeOut, `${p}.fadeOut`, 0, duration),
      ...(assetId ? { assetId } : {}),
      ...(text ? { text } : {}),
      ...(data.color === undefined ? {} : { color: color(data.color, `${p}.color`) }),
    };
  });
  return project;
}
