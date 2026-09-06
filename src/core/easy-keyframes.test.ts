import { describe, expect, it } from 'vitest';
import { createClip, createProject, evaluate, validateProject } from './project';
import {
  canRecordFrame,
  frameNavigation,
  frameProperties,
  frameTimes,
  recordFrame,
  removeFrame,
} from './easy-keyframes';

describe('easy keyframe groups', () => {
  it('records every current visual property in one immutable group', () => {
    const original = createClip('shape', 'video', {
      start: 8,
      duration: 4,
      transform: { x: 20, scale: 1.5 },
    });
    const recorded = recordFrame(original, 2, 30);
    expect(frameProperties(recorded)).toEqual(['x', 'y', 'scale', 'rotation', 'opacity']);
    for (const prop of frameProperties(recorded))
      expect(recorded.keyframes[prop]).toMatchObject([
        { time: 2, value: original.transform[prop] },
      ]);
    expect(original.keyframes).toEqual({});
    expect(recordFrame(recorded, 2, 30)).toBe(recorded);
    const project = createProject();
    project.clips = [recorded];
    expect(() => validateProject(project)).not.toThrow();
  });
  it('captures the evaluated animated pose, not stale base values', () => {
    const clip = createClip('video', 'video', {
      duration: 4,
      transform: { scale: 1 },
      keyframes: {
        scale: [
          { id: 'start', time: 0, value: 1, easing: 'ease-in' },
          { id: 'end', time: 4, value: 3, easing: 'linear' },
        ],
      },
    });
    const recorded = recordFrame(clip, 2, 30);
    expect(recorded.keyframes.scale!.find((frame) => frame.time === 2)!.value).toBe(
      evaluate(clip, 'scale', 2),
    );
    expect(recorded.keyframes.volume).toHaveLength(1);
    expect(recorded.keyframes.scale![0]).toEqual(clip.keyframes.scale![0]);
  });
  it('records only volume for audio and keeps existing outgoing easing and identity', () => {
    const clip = createClip('audio', 'audio', {
      keyframes: { volume: [{ id: 'v', time: 1, value: 2, easing: 'hold' }] },
    });
    const recorded = recordFrame(clip, 1.001, 30);
    expect(Object.keys(recorded.keyframes)).toEqual(['volume']);
    expect(recorded.keyframes.volume).toEqual(clip.keyframes.volume);
    expect(recorded).toBe(clip);
  });
  it('groups nearby property keys and navigates in both directions', () => {
    const clip = createClip('shape', 'video', {
      keyframes: {
        x: [
          { id: 'x', time: 1, value: 0, easing: 'linear' },
          { id: 'end', time: 4, value: 1, easing: 'linear' },
        ],
        y: [{ id: 'y', time: 1.005, value: 2, easing: 'linear' }],
      },
    });
    expect(frameTimes(clip, 30)).toEqual([1, 4]);
    expect(frameNavigation(clip, 2, 30)).toMatchObject({
      previous: 1,
      next: 4,
      current: undefined,
    });
    expect(frameNavigation(clip, 1.001, 30)).toMatchObject({
      previous: undefined,
      next: 4,
      current: 1,
    });
    const captured = recordFrame(clip, 1.003, 30);
    expect(captured.keyframes.y![0].time).toBe(1);
    expect(frameTimes(captured, 30)).toEqual([1, 4]);
  });
  it('deletes the current group across properties and retains other animation', () => {
    let clip = createClip('shape', 'video');
    clip = recordFrame(recordFrame(clip, 0, 30), 3, 30);
    const removed = removeFrame(clip, 3, 30);
    expect(frameTimes(removed, 30)).toEqual([0]);
    expect(frameTimes(clip, 30)).toEqual([0, 3]);
    expect(removeFrame(removed, 2, 30)).toBe(removed);
  });
  it('keeps the displayed value when the last keyframe group is removed', () => {
    const clip = createClip('audio', 'audio', {
      transform: { volume: 1 },
      keyframes: { volume: [{ id: 'v', time: 1, value: 2.5, easing: 'linear' }] },
    });
    const removed = removeFrame(clip, 1, 30);
    expect(removed.keyframes.volume).toBeUndefined();
    expect(evaluate(removed, 'volume', 0)).toBe(2.5);
  });
  it('clamps edge recording and rejects nonfinite times without changing the clip', () => {
    const clip = createClip('shape', 'video', { duration: 2 });
    expect(frameTimes(recordFrame(clip, -5, 30), 30)).toEqual([0]);
    expect(frameTimes(recordFrame(clip, 20, 30), 30)).toEqual([2]);
    expect(recordFrame(clip, NaN, 30)).toBe(clip);
    expect(removeFrame(clip, Infinity, 30)).toBe(clip);
  });
  it('does not create an unsavable curve at the per-property limit', () => {
    const clip = createClip('audio', 'audio', {
      duration: 20000,
      keyframes: {
        volume: Array.from({ length: 10000 }, (_, i) => ({
          id: `v${i}`,
          time: i,
          value: 1,
          easing: 'linear' as const,
        })),
      },
    });
    expect(canRecordFrame(clip, 12000, 30)).toBe(false);
    expect(recordFrame(clip, 12000, 30)).toBe(clip);
    expect(canRecordFrame(clip, 20, 30)).toBe(true);
  });
});
