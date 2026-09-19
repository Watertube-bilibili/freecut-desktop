// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jareer and Concat contributors
// SPDX-FileCopyrightText: 2026 FreeCut contributors
// Port of concat-core/src/animate.rs, bezier_y_at_x and its two helpers.
// Upstream: jub0t/Concat e5c8662daf6d721de2fd6c4e78cb671cd6d98393.
// Modified 2026-09-19: JavaScript; shared browser/host validation and FreeCut's
// seconds + outgoing-ease keyframe adapter; tighter root tolerance for near-flat
// curves. Old quadratic easings stay unchanged.

const axis = (p1, p2, t) => {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
};
const slope = (p1, p2, t) => {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
};

/** Concat's Newton solve, falling back to bisection for flat slopes. */
export function bezierYAtX(x1, y1, x2, y2, x) {
  x = Math.max(0, Math.min(1, x));
  let t = x;
  for (let i = 0; i < 8; i++) {
    const error = axis(x1, x2, t) - x;
    if (Math.abs(error) < 1e-12) return axis(y1, y2, t);
    const derivative = slope(x1, x2, t);
    if (Math.abs(derivative) < 1e-9) break;
    t -= error / derivative;
  }
  let lo = 0,
    hi = 1;
  t = x;
  for (let i = 0; i < 48; i++) {
    const at = axis(x1, x2, t);
    if (Math.abs(at - x) < 1e-12) break;
    if (at > x) hi = t;
    else lo = t;
    t = (lo + hi) / 2;
  }
  return axis(y1, y2, t);
}

export const DEFAULT_BEZIER = Object.freeze([0.25, 0.1, 0.25, 1]);

// Bounded control points intentionally avoid overshoot of volume/opacity/scale.
export function isBezierCurve(curve) {
  return (
    Array.isArray(curve) &&
    curve.length === 4 &&
    curve.every(
      (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1,
    )
  );
}

/** Flatten only the new bezier spans for FFmpeg. Existing easings are untouched.
 * Sampling happens once per export, never per pixel. A per-span bound and a
 * whole-track cap keep untrusted project data from creating unbounded graphs.
 */
export function linearizeBezierKeyframes(frames) {
  if (!frames?.some((frame) => frame.easing === 'bezier')) return frames;
  const points = [
    ...new Map(
      [...frames].sort((a, b) => a.time - b.time).map((frame) => [frame.time, frame]),
    ).values(),
  ];
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[i + 1];
    if (a.easing !== 'bezier') {
      result.push(a);
      continue;
    }
    if (!isBezierCurve(a.curve)) throw new Error('Invalid cubic-bezier control points');
    result.push({ ...a, easing: 'linear' });
    if (!b || b.time <= a.time) continue;
    const sample = (fraction) => bezierYAtX(...a.curve, fraction);
    const append = (left, right, depth) => {
      const lv = sample(left),
        rv = sample(right);
      const error = Math.max(
        ...[0.25, 0.5, 0.75].map((ratio) =>
          Math.abs(sample(left + (right - left) * ratio) - (lv + (rv - lv) * ratio)),
        ),
      );
      if (error > 0.000008 && depth < 24) {
        const middle = (left + right) / 2;
        append(left, middle, depth + 1);
        append(middle, right, depth + 1);
      } else if (right < 1) {
        result.push({
          time: a.time + (b.time - a.time) * right,
          value: a.value + (b.value - a.value) * rv,
          easing: 'linear',
        });
        if (result.length > 20000) throw new Error('Bezier export curve is too complex');
      }
    };
    // Initial subdivisions avoid a symmetrical S-curve hiding its curvature.
    for (let part = 0; part < 8; part++) append(part / 8, (part + 1) / 8, 0);
  }
  return result;
}
