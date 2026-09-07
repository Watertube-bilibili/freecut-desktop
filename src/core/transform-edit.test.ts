import { describe, it, expect } from 'vitest';
import { createClip } from './project';
import { editTransform } from './transform-edit';

describe('preview transform editing', () => {
  it('moves static clips without creating unwanted animation', () => {
    const clip = createClip('shape', 'video');
    const edited = editTransform(clip, { x: 180, y: -30, scale: 1.8 }, 2, 30);
    expect(edited.transform).toMatchObject({ x: 180, y: -30, scale: 1.8 });
    expect(edited.keyframes).toEqual({});
    expect(clip.transform.x).toBe(0);
  });
  it('updates an existing animation point without changing its time, ID, easing or other properties', () => {
    const clip = createClip('shape', 'video', {
      keyframes: {
        x: [
          { id: 'a', time: 0, value: 0, easing: 'ease-in' },
          { id: 'b', time: 2, value: 100, easing: 'hold' },
          { id: 'c', time: 4, value: 200, easing: 'linear' },
        ],
        opacity: [{ id: 'd', time: 0, value: 0.8, easing: 'linear' }],
      },
    });
    const edited = editTransform(clip, { x: 170, y: 20 }, 2.005, 30);
    expect(edited.keyframes.x).toEqual([
      clip.keyframes.x![0],
      { ...clip.keyframes.x![1], value: 170 },
      clip.keyframes.x![2],
    ]);
    expect(edited.keyframes.opacity).toEqual(clip.keyframes.opacity);
    expect(edited.transform.x).toBe(0);
    expect(edited.transform.y).toBe(20);
  });
  it('inserts one current-time point across repeated moves and preserves the other times', () => {
    const clip = createClip('shape', 'video', {
      keyframes: {
        scale: [
          { id: 'first', time: 0, value: 1, easing: 'linear' },
          { id: 'last', time: 4, value: 2, easing: 'linear' },
        ],
      },
    });
    const first = editTransform(clip, { scale: 1.9 }, 2, 30);
    const second = editTransform(first, { scale: 2.1 }, 2, 30);
    expect(second.keyframes.scale).toEqual([
      clip.keyframes.scale![0],
      { ...first.keyframes.scale![1], value: 2.1 },
      clip.keyframes.scale![1],
    ]);
  });
  it('keeps a click or unchanged pose as a no-op and rejects invalid input', () => {
    const clip = createClip('shape', 'video');
    expect(editTransform(clip, { x: 0, scale: 1 }, 2, 30)).toBe(clip);
    expect(() => editTransform(clip, { scale: NaN }, 2, 30)).toThrow();
    expect(editTransform(clip, { scale: -2 }, 2, 30).transform.scale).toBe(0.001);
  });
});
