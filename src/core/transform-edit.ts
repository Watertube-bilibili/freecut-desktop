import type { AnimProperty, Clip, Transform } from '../types';
import { evaluate } from './project';

const limits: Record<AnimProperty, [number, number]> = {
  x: [-100000, 100000],
  y: [-100000, 100000],
  scale: [0.001, 100],
  rotation: [-100000, 100000],
  opacity: [0, 1],
  volume: [0, 4],
};

/** Update only the properties manipulated at the captured playhead time. */
export function editTransform(
  clip: Clip,
  values: Partial<Transform>,
  localTime: number,
  fps: number,
): Clip {
  const time = Math.max(0, Math.min(clip.duration, localTime));
  if (!Number.isFinite(time) || !Number.isFinite(fps) || fps <= 0) throw Error('关键帧时间无效。');
  const transform = { ...clip.transform },
    keyframes = { ...clip.keyframes };
  let changed = false;
  for (const property of Object.keys(values) as AnimProperty[]) {
    const input = values[property];
    if (!limits[property] || typeof input !== 'number' || !Number.isFinite(input))
      throw Error('画面变换数值无效。');
    const value = Math.max(limits[property][0], Math.min(limits[property][1], input));
    if (Math.abs(evaluate(clip, property, time) - value) < 1e-9) continue;
    const frames = clip.keyframes[property];
    if (!frames?.length) transform[property] = value;
    else {
      const current = frames.find((frame) => Math.abs(frame.time - time) < 0.5 / fps);
      if (!current && frames.length >= 10000)
        throw Error('这个属性的关键帧已达上限，请先删除部分关键帧。');
      keyframes[property] = (
        current
          ? frames.map((frame) => (frame.id === current.id ? { ...frame, value } : frame))
          : [...frames, { id: crypto.randomUUID(), time, value, easing: 'linear' as const }]
      ).sort((a, b) => a.time - b.time);
    }
    changed = true;
  }
  return changed ? { ...clip, transform, keyframes } : clip;
}
