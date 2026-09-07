import type { Effects, MaskShape } from '../types';

export interface MaskPoint {
  x: number;
  y: number;
}
export const maskShapes: { value: MaskShape; label: string; symbol: string }[] = [
  { value: 'none', label: '无蒙版', symbol: '—' },
  { value: 'circle', label: '圆形', symbol: '●' },
  { value: 'rectangle', label: '矩形', symbol: '■' },
  { value: 'ellipse', label: '椭圆', symbol: '⬭' },
  { value: 'diamond', label: '菱形', symbol: '◆' },
  { value: 'star', label: '五角星', symbol: '★' },
  { value: 'heart', label: '爱心', symbol: '♥' },
  { value: 'band', label: '水平条带', symbol: '▬' },
];

/** Original vector geometry, in clip-local pixels. No downloaded artwork or LUTs. */
export function maskPolygon(fx: Effects, width: number, height: number): MaskPoint[] {
  if (fx.mask === 'none') return [];
  const size = fx.maskSize;
  let rx = (width * size) / 2,
    ry = (height * size) / 2;
  if (fx.mask === 'circle' || fx.mask === 'star' || fx.mask === 'heart')
    rx = ry = (Math.min(width, height) * size) / 2;
  let points: MaskPoint[];
  if (fx.mask === 'circle' || fx.mask === 'ellipse') {
    points = Array.from({ length: 256 }, (_, i) => ({
      x: rx * Math.cos((i * Math.PI) / 128),
      y: ry * Math.sin((i * Math.PI) / 128),
    }));
  } else if (fx.mask === 'diamond') {
    points = [
      { x: 0, y: -ry },
      { x: rx, y: 0 },
      { x: 0, y: ry },
      { x: -rx, y: 0 },
    ];
  } else if (fx.mask === 'star') {
    points = Array.from({ length: 10 }, (_, i) => {
      const angle = (i * Math.PI) / 5 - Math.PI / 2,
        radius = i % 2 ? 0.44 : 1;
      return { x: Math.cos(angle) * rx * radius, y: Math.sin(angle) * ry * radius };
    });
  } else if (fx.mask === 'heart') {
    // The parametric heart is centered by its full bounds, not its curve origin.
    const raw = Array.from({ length: 256 }, (_, i) => {
      const t = (i * Math.PI) / 128;
      return {
        x: 16 * Math.sin(t) ** 3,
        y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
      };
    });
    const ys = raw.map((p) => p.y),
      min = Math.min(...ys),
      max = Math.max(...ys);
    points = raw.map((p) => ({
      x: (p.x / 16) * rx,
      y: (((p.y - min) / (max - min)) * 2 - 1) * ry,
    }));
  } else {
    if (fx.mask === 'band') ry *= 0.3;
    points = [
      { x: -rx, y: -ry },
      { x: rx, y: -ry },
      { x: rx, y: ry },
      { x: -rx, y: ry },
    ];
  }
  const radians = ((fx.maskRotation ?? 0) * Math.PI) / 180,
    cos = Math.cos(radians),
    sin = Math.sin(radians);
  return points.map((p) => ({
    x: p.x * cos - p.y * sin + (fx.maskX ?? 0) * width,
    y: p.x * sin + p.y * cos + (fx.maskY ?? 0) * height,
  }));
}

export function maskBounds(fx: Effects, width: number, height: number) {
  if (fx.mask === 'none')
    return { left: -width / 2, top: -height / 2, right: width / 2, bottom: height / 2 };
  const points = maskPolygon(fx, width, height);
  const padding = (fx.maskFeather ?? 0) * Math.min(width, height) * 3;
  return {
    left: Math.min(...points.map((p) => p.x)) - padding,
    top: Math.min(...points.map((p) => p.y)) - padding,
    right: Math.max(...points.map((p) => p.x)) + padding,
    bottom: Math.max(...points.map((p) => p.y)) + padding,
  };
}

export function pointInMask(fx: Effects, width: number, height: number, point: MaskPoint): boolean {
  if (fx.mask === 'none') return true;
  const points = maskPolygon(fx, width, height);
  let inside = false;
  let edgeDistance = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j],
      b = points[i];
    // Include points exactly on an edge; selection and rendered borders agree.
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const along = lengthSquared
      ? Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSquared,
          ),
        )
      : 0;
    edgeDistance = Math.min(
      edgeDistance,
      Math.hypot(point.x - a.x - along * (b.x - a.x), point.y - a.y - along * (b.y - a.y)),
    );
    if (
      Math.abs(cross) < 1e-7 &&
      point.x >= Math.min(a.x, b.x) - 1e-8 &&
      point.x <= Math.max(a.x, b.x) + 1e-8 &&
      point.y >= Math.min(a.y, b.y) - 1e-8 &&
      point.y <= Math.max(a.y, b.y) + 1e-8
    )
      return (fx.maskFeather ?? 0) > 0 || !fx.maskInvert;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  const featherEdge = (fx.maskFeather ?? 0) * Math.min(width, height) * 3;
  return (fx.maskInvert ? !inside : inside) || (featherEdge > 0 && edgeDistance <= featherEdge);
}
