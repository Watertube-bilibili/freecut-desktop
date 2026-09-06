import type { AnimProperty, Clip } from '../types';
import { evaluate } from './project';

const visual: AnimProperty[] = ['x', 'y', 'scale', 'rotation', 'opacity'];
export function frameProperties(clip: Clip): AnimProperty[] {
  return clip.kind === 'audio'
    ? ['volume']
    : clip.kind === 'video'
      ? [...visual, 'volume']
      : [...visual];
}
const tolerance = (fps: number) => 0.5 / (Number.isFinite(fps) && fps > 0 ? fps : 30);
const localTime = (clip: Clip, time: number) => Math.max(0, Math.min(clip.duration, time));

/** Nearby property keys share one easy-mode stop; the stored project schema is unchanged. */
export function frameTimes(clip: Clip, fps: number): number[] {
  const all = frameProperties(clip)
    .flatMap((prop) => clip.keyframes[prop]?.map((frame) => frame.time) ?? [])
    .filter((time) => Number.isFinite(time) && time >= 0 && time <= clip.duration)
    .sort((a, b) => a - b);
  const times: number[] = [];
  for (const time of all)
    if (!times.length || time - times[times.length - 1] >= tolerance(fps)) times.push(time);
  return times;
}
export function frameNavigation(clip: Clip, time: number, fps: number) {
  const local = localTime(clip, time),
    times = frameTimes(clip, fps),
    epsilon = tolerance(fps);
  const current = times
    .filter((at) => Math.abs(at - local) < epsilon)
    .sort((a, b) => Math.abs(a - local) - Math.abs(b - local))[0];
  return {
    times,
    current,
    previous: times.filter((at) => at < local - epsilon).at(-1),
    next: times.find((at) => at > local + epsilon),
  };
}
export function canRecordFrame(clip: Clip, time: number, fps: number): boolean {
  if (!Number.isFinite(time)) return false;
  const at = frameNavigation(clip, time, fps).current ?? localTime(clip, time);
  return frameProperties(clip).every((prop) => {
    const frames = clip.keyframes[prop] ?? [];
    return (
      frames.length < 10_000 || frames.some((frame) => Math.abs(frame.time - at) < tolerance(fps))
    );
  });
}

/** One immutable update captures every relevant property, preserving existing IDs/easing. */
export function recordFrame(clip: Clip, time: number, fps: number): Clip {
  if (!canRecordFrame(clip, time, fps)) return clip;
  const at = frameNavigation(clip, time, fps).current ?? localTime(clip, time);
  const keyframes = { ...clip.keyframes };
  let changed = false;
  for (const prop of frameProperties(clip)) {
    const frames = clip.keyframes[prop] ?? [];
    const nearby = frames.filter((frame) => Math.abs(frame.time - at) < tolerance(fps));
    const existing = nearby.sort((a, b) => Math.abs(a.time - at) - Math.abs(b.time - at))[0];
    const next = [
      ...frames.filter((frame) => !nearby.includes(frame)),
      {
        id: existing?.id ?? crypto.randomUUID(),
        time: at,
        value: evaluate(clip, prop, at),
        easing: existing?.easing ?? ('linear' as const),
      },
    ].sort((a, b) => a.time - b.time);
    if (
      frames.length !== next.length ||
      frames.some((frame, i) =>
        ['id', 'time', 'value', 'easing'].some(
          (key) => frame[key as keyof typeof frame] !== next[i]?.[key as keyof typeof frame],
        ),
      )
    )
      changed = true;
    keyframes[prop] = next;
  }
  return changed ? { ...clip, keyframes } : clip;
}

/** Removing the final group keeps the current pose/volume instead of jumping to old defaults. */
export function removeFrame(clip: Clip, time: number, fps: number): Clip {
  if (!Number.isFinite(time)) return clip;
  const at = frameNavigation(clip, time, fps).current;
  if (at === undefined) return clip;
  const keyframes = { ...clip.keyframes },
    transform = { ...clip.transform };
  let changed = false;
  for (const prop of frameProperties(clip)) {
    const frames = clip.keyframes[prop];
    if (!frames) continue;
    const kept = frames.filter((frame) => Math.abs(frame.time - at) >= tolerance(fps));
    if (kept.length === frames.length) continue;
    changed = true;
    if (kept.length) keyframes[prop] = kept;
    else {
      transform[prop] = evaluate(clip, prop, at);
      delete keyframes[prop];
    }
  }
  return changed ? { ...clip, keyframes, transform } : clip;
}
