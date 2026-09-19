import { describe, it, expect } from 'vitest';
import {
  bezierYAtX,
  isBezierCurve,
  linearizeBezierKeyframes,
} from '../../shared/concat-bezier.mjs';
import { createClip, createProject, evaluate, splitClip, validateProject } from './project';
import type { Keyframe } from '../types';

describe('Concat easing integration', () => {
  it('matches known CSS timing values and handles flat tangents', () => {
    expect(bezierYAtX(0.25, 0.1, 0.25, 1, 0.5)).toBeCloseTo(0.8024034, 6);
    expect(bezierYAtX(0, 0, 1, 1, 0.37)).toBeCloseTo(0.37, 6);
    for (const x of [0, 0.00001, 0.05, 0.5, 1]) {
      expect(bezierYAtX(0, 1, 0, 1, x)).toBeCloseTo(1 - (1 - Math.cbrt(x)) ** 3, 4);
    }
    expect(isBezierCurve([0, 0, 1, 1])).toBe(true);
    for (const input of [[0, 0, 1], [-1, 0, 1, 1], [0, NaN, 1, 1], '0,0,1,1'])
      expect(isBezierCurve(input)).toBe(false);
  });

  it('preserves old quadratic curves and saves new control points in v1 projects', () => {
    const p = createProject();
    const c = createClip('shape', p.tracks[0].id, {
      duration: 4,
      keyframes: {
        x: [
          { id: 'a', time: 0, value: -120, easing: 'bezier', curve: [0.16, 1, 0.3, 1] },
          { id: 'b', time: 4, value: 220, easing: 'linear' },
        ],
        y: [
          { id: 'y1', time: 0, value: 0, easing: 'ease-in' },
          { id: 'y2', time: 4, value: 100, easing: 'linear' },
        ],
      },
    });
    p.clips = [c];
    const loaded = validateProject(JSON.parse(JSON.stringify(p)));
    expect(loaded.clips[0].keyframes.x![0].curve).toEqual([0.16, 1, 0.3, 1]);
    expect(evaluate(loaded.clips[0], 'y', 2)).toBe(25);
    const [left, right] = splitClip(c, 1.7)!;
    for (let t = 0; t <= 4; t += 0.017) {
      const cut = t <= 1.7 ? left : right;
      expect(
        Math.abs(evaluate(cut, 'x', t <= 1.7 ? t : t - 1.7) - evaluate(c, 'x', t)),
      ).toBeLessThan(0.025);
    }
    expect(
      validateProject(JSON.parse(JSON.stringify({ ...p, clips: [left, right] }))),
    ).toBeTruthy();
    const invalid = structuredClone(p);
    delete invalid.clips[0].keyframes.x![0].curve;
    expect(() => validateProject(invalid)).toThrow();
  });

  it('the host expression samples agree with preview easing', () => {
    const curves: NonNullable<Keyframe['curve']>[] = [
      [0.25, 0.1, 0.25, 1],
      [0.16, 1, 0.3, 1],
      [0.7, 0, 0.84, 0],
      [0, 1, 0, 1],
    ];
    for (const curve of curves) {
      const keys: Keyframe[] = [
        { id: 'a', time: 0, value: 0, easing: 'bezier', curve },
        { id: 'b', time: 2, value: 1, easing: 'hold' },
      ];
      const sampled = linearizeBezierKeyframes(keys);
      for (let t = 0.001; t < 2; t += 0.013) {
        const j = sampled.findIndex((p, i) => i > 0 && p.time >= t);
        const a = sampled[j - 1],
          b = sampled[j];
        const value = a.value + ((b.value - a.value) * (t - a.time)) / (b.time - a.time);
        expect(Math.abs(value - bezierYAtX(...curve, t / 2))).toBeLessThan(0.00002);
      }
      expect(sampled.at(-1)!.easing).toBe('hold');
    }
  });
});
