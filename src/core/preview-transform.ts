import type { Clip, Project, TextStyle, Transform } from '../types';
import { getTransform } from './project';
import { maskBounds, pointInMask } from './masks';

export interface Point {
  x: number;
  y: number;
}
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export type Corner = 'nw' | 'ne' | 'se' | 'sw';
export const corners: Corner[] = ['nw', 'ne', 'se', 'sw'];
export interface TextMeasurement {
  width: number;
  actualBoundingBoxLeft?: number;
  actualBoundingBoxRight?: number;
  actualBoundingBoxAscent?: number;
  actualBoundingBoxDescent?: number;
}
export type MeasureText = (line: string, style: TextStyle) => TextMeasurement;
export interface ClipGeometry {
  clip: Clip;
  transform: Transform;
  /** Transform origin; a left/right aligned text box need not be centered here. */
  origin: Point;
  bounds: Bounds;
  corners: [Point, Point, Point, Point];
  content: Bounds;
  flipX: number;
  flipY: number;
  projectCenter: Point;
}
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const fallbackMeasure: MeasureText = (line, style) => ({
  width: [...line].length * style.fontSize * 0.6,
});
const union = (a: Bounds, b: Bounds): Bounds => ({
  left: Math.min(a.left, b.left),
  top: Math.min(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
});
const intersect = (a: Bounds, b: Bounds): Bounds => ({
  left: Math.max(a.left, b.left),
  top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom),
});
function rotated(point: Point, degrees: number): Point {
  const angle = (degrees * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}
export function localToProject(geometry: ClipGeometry, point: Point): Point {
  const offset = rotated(
    {
      x: point.x * geometry.transform.scale * geometry.flipX,
      y: point.y * geometry.transform.scale * geometry.flipY,
    },
    geometry.transform.rotation,
  );
  return { x: geometry.origin.x + offset.x, y: geometry.origin.y + offset.y };
}
export function projectToLocal(geometry: ClipGeometry, point: Point): Point {
  const offset = rotated(
    { x: point.x - geometry.origin.x, y: point.y - geometry.origin.y },
    -geometry.transform.rotation,
  );
  return {
    x: offset.x / geometry.transform.scale / geometry.flipX,
    y: offset.y / geometry.transform.scale / geometry.flipY,
  };
}
export function boundsCorners(bounds: Bounds): [Point, Point, Point, Point] {
  return [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom },
  ];
}
export function textBounds(
  style: TextStyle,
  measure: MeasureText = fallbackMeasure,
): Bounds | null {
  const lines = style.text.split('\n'),
    lineHeight = style.fontSize * 1.3;
  const metrics = lines.map((line) => measure(line, style));
  const width = Math.max(0, ...metrics.map((metric) => metric.width));
  let result: Bounds | null = null;
  if (style.background !== 'transparent') {
    const left = style.align === 'left' ? 0 : style.align === 'right' ? -width : -width / 2;
    result = {
      left: left - 18,
      right: left + width + 18,
      top: (-lines.length * lineHeight) / 2 - 8,
      bottom: (lines.length * lineHeight) / 2 + 8,
    };
  }
  metrics.forEach((metric, index) => {
    if (!lines[index].trim()) return;
    const baseline = (index - (lines.length - 1) / 2) * lineHeight;
    const left =
      style.align === 'left' ? 0 : style.align === 'right' ? -metric.width : -metric.width / 2;
    const stroke = style.stroke ? 2.5 : 0;
    // Canvas actual bounds are relative to its configured textAlign / middle baseline.
    const ink = {
      left: Number.isFinite(metric.actualBoundingBoxLeft) ? -metric.actualBoundingBoxLeft! : left,
      right: Number.isFinite(metric.actualBoundingBoxRight)
        ? metric.actualBoundingBoxRight!
        : left + metric.width,
      top:
        baseline -
        (Number.isFinite(metric.actualBoundingBoxAscent)
          ? metric.actualBoundingBoxAscent!
          : style.fontSize / 2),
      bottom:
        baseline +
        (Number.isFinite(metric.actualBoundingBoxDescent)
          ? metric.actualBoundingBoxDescent!
          : style.fontSize / 2),
    };
    const stroked = {
      left: ink.left - stroke,
      right: ink.right + stroke,
      top: ink.top - stroke,
      bottom: ink.bottom + stroke,
    };
    result = result ? union(result, stroked) : stroked;
  });
  return result;
}
export function getClipGeometry(
  project: Project,
  clip: Clip,
  time: number,
  measure?: MeasureText,
): ClipGeometry | null {
  const track = project.tracks.find((item) => item.id === clip.trackId);
  if (
    !track ||
    track.hidden ||
    track.locked ||
    track.kind === 'audio' ||
    clip.kind === 'audio' ||
    time < clip.start ||
    time >= clip.start + clip.duration
  )
    return null;
  const local = time - clip.start,
    transform = getTransform(clip, local);
  let fade = 1;
  if (clip.fadeIn > 0) fade = Math.min(fade, local / clip.fadeIn);
  if (clip.fadeOut > 0) fade = Math.min(fade, (clip.duration - local) / clip.fadeOut);
  if (transform.opacity * fade <= 0 || transform.scale <= 0) return null;
  const asset = project.assets.find((item) => item.id === clip.assetId);
  if (asset?.missing || asset?.kind === 'audio') return null;
  if ((clip.kind === 'image' || clip.kind === 'video') && (!asset || asset.missing || !asset.url))
    return null;
  let width = project.width,
    height = project.height;
  if (asset && asset.width && asset.height && asset.width > 0 && asset.height > 0) {
    const fit = Math.min(project.width / asset.width, project.height / asset.height);
    width = asset.width * fit;
    height = asset.height * fit;
  }
  const content = { left: -width / 2, top: -height / 2, right: width / 2, bottom: height / 2 };
  let bounds = clip.kind === 'text' ? (clip.text ? textBounds(clip.text, measure) : null) : content;
  if (clip.effects.vignette > 0) bounds = bounds ? union(bounds, content) : content;
  if (!bounds) return null;
  if (clip.effects.mask !== 'none' && !clip.effects.maskInvert) {
    bounds = intersect(bounds, maskBounds(clip.effects, width, height));
  }
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return null;
  const projectCenter = { x: project.width / 2, y: project.height / 2 };
  const geometry: ClipGeometry = {
    clip,
    transform,
    bounds,
    content,
    projectCenter,
    origin: { x: projectCenter.x + transform.x, y: projectCenter.y + transform.y },
    flipX: clip.effects.flipX ? -1 : 1,
    flipY: clip.effects.flipY ? -1 : 1,
    corners: boundsCorners(bounds),
  };
  geometry.corners = boundsCorners(bounds).map((point) =>
    localToProject(geometry, point),
  ) as ClipGeometry['corners'];
  return geometry;
}
export function containsPoint(geometry: ClipGeometry, point: Point): boolean {
  const local = projectToLocal(geometry, point),
    bounds = geometry.bounds;
  if (
    local.x < bounds.left ||
    local.x > bounds.right ||
    local.y < bounds.top ||
    local.y > bounds.bottom
  )
    return false;
  return pointInMask(geometry.clip.effects,
    geometry.content.right - geometry.content.left,
    geometry.content.bottom - geometry.content.top, local);
}
/** Rendering reverses tracks, then paints clips in array order; hit testing reverses that. */
export function hitTestProject(
  project: Project,
  time: number,
  point: Point,
  measure?: MeasureText,
): ClipGeometry | null {
  if (point.x < 0 || point.y < 0 || point.x > project.width || point.y > project.height)
    return null;
  for (const track of project.tracks) {
    if (track.hidden || track.locked || track.kind === 'audio') continue;
    for (let index = project.clips.length - 1; index >= 0; index--) {
      const clip = project.clips[index];
      if (clip.trackId !== track.id) continue;
      const geometry = getClipGeometry(project, clip, time, measure);
      if (geometry && containsPoint(geometry, point)) return geometry;
    }
  }
  return null;
}
export function pointerToProject(
  point: Point,
  rect: { left: number; top: number; width: number; height: number },
  project: Pick<Project, 'width' | 'height'>,
): Point {
  return {
    x: ((point.x - rect.left) * project.width) / rect.width,
    y: ((point.y - rect.top) * project.height) / rect.height,
  };
}
export function moveTransform(
  geometry: ClipGeometry,
  start: Point,
  current: Point,
): Partial<Transform> {
  return {
    x: clamp(geometry.transform.x + current.x - start.x, -100000, 100000),
    y: clamp(geometry.transform.y + current.y - start.y, -100000, 100000),
  };
}
/** Uniform resize projected onto the original diagonal; its opposite corner stays fixed. */
export function scaleTransform(
  geometry: ClipGeometry,
  corner: Corner,
  start: Point,
  current: Point,
): Partial<Transform> {
  const index = corners.indexOf(corner),
    opposite = (index + 2) % 4;
  const anchor = geometry.corners[opposite],
    moving = geometry.corners[index];
  const vector = { x: moving.x - anchor.x, y: moving.y - anchor.y };
  const squared = vector.x * vector.x + vector.y * vector.y;
  if (squared < 1e-12) return {};
  const factor =
    1 + ((current.x - start.x) * vector.x + (current.y - start.y) * vector.y) / squared;
  const scale = clamp(geometry.transform.scale * factor, 0.001, 100);
  const local = boundsCorners(geometry.bounds)[opposite];
  const offset = rotated(
    { x: local.x * scale * geometry.flipX, y: local.y * scale * geometry.flipY },
    geometry.transform.rotation,
  );
  return {
    scale,
    x: clamp(anchor.x - offset.x - geometry.projectCenter.x, -100000, 100000),
    y: clamp(anchor.y - offset.y - geometry.projectCenter.y, -100000, 100000),
  };
}
export function pointerAngle(origin: Point, point: Point): number {
  return (Math.atan2(point.y - origin.y, point.x - origin.x) * 180) / Math.PI;
}
export function angleDelta(previous: number, current: number): number {
  return ((((current - previous + 540) % 360) + 360) % 360) - 180;
}
export function rotationValue(degrees: number, snap = false): number {
  return clamp(snap ? Math.round(degrees / 15) * 15 : degrees, -360000, 360000);
}
