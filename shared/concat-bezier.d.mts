export type BezierCurve = [number, number, number, number];
export function bezierYAtX(x1: number, y1: number, x2: number, y2: number, x: number): number;
export const DEFAULT_BEZIER: readonly [number, number, number, number];
export function isBezierCurve(curve: unknown): curve is BezierCurve;
export function linearizeBezierKeyframes<
  T extends { time: number; value: number; easing: string; curve?: BezierCurve },
>(frames: T[]): Array<T | { time: number; value: number; easing: string }>;
