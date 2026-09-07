import { describe, expect, it } from 'vitest';
import { createClip, createProject, defaultEffects, validateProject } from './project';
import { maskBounds, maskPolygon, maskShapes, pointInMask } from './masks';
import { effectPresets } from './effects';
import { containsPoint, getClipGeometry } from './preview-transform';

describe('original masks', () => {
  it.each(maskShapes.filter((shape) => shape.value !== 'none'))(
    '$label has finite closed geometry and an interior',
    ({ value }) => {
      const fx = { ...defaultEffects(), mask: value };
      const points = maskPolygon(fx, 640, 360);
      expect(points.length).toBeGreaterThanOrEqual(4);
      expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      expect(pointInMask(fx, 640, 360, { x: 0, y: 0 })).toBe(true);
      expect(pointInMask(fx, 640, 360, { x: 400, y: 0 })).toBe(false);
    },
  );
  it('distinguishes circle, ellipse and band dimensions', () => {
    const fx = defaultEffects();
    expect(maskBounds({ ...fx, mask: 'circle' }, 640, 360)).toEqual({
      left: -180,
      right: 180,
      top: -180,
      bottom: 180,
    });
    expect(maskBounds({ ...fx, mask: 'ellipse' }, 640, 360)).toEqual({
      left: -320,
      right: 320,
      top: -180,
      bottom: 180,
    });
    expect(maskBounds({ ...fx, mask: 'band' }, 640, 360)).toEqual({
      left: -320,
      right: 320,
      top: -54,
      bottom: 54,
    });
  });
  it('rotates around the mask origin then positions in source fractions', () => {
    const fx = {
      ...defaultEffects(),
      mask: 'rectangle' as const,
      maskSize: 0.5,
      maskRotation: 90,
      maskX: 0.25,
      maskY: -0.25,
    };
    const b = maskBounds(fx, 640, 360);
    expect(b.left).toBeCloseTo(70);
    expect(b.right).toBeCloseTo(250);
    expect(b.top).toBeCloseTo(-250);
    expect(b.bottom).toBeCloseTo(70);
    expect(pointInMask(fx, 640, 360, { x: 160, y: -90 })).toBe(true);
    expect(pointInMask(fx, 640, 360, { x: 260, y: -90 })).toBe(false);
  });
  it('inverts only the mask and keeps selection inside the source', () => {
    const project = createProject();
    project.width = 640;
    project.height = 360;
    const clip = createClip('shape', project.tracks[0].id, {
      effects: { ...defaultEffects(), mask: 'circle', maskSize: 0.5, maskInvert: true },
    });
    project.clips = [clip];
    const g = getClipGeometry(project, clip, 0)!;
    expect(containsPoint(g, { x: 320, y: 180 })).toBe(false);
    expect(containsPoint(g, { x: 20, y: 180 })).toBe(true);
    expect(containsPoint(g, { x: -1, y: 180 })).toBe(false);
  });
  it('preserves local transform keyframes when adding a shifted star', () => {
    const project = createProject();
    project.width = 640;
    project.height = 360;
    const clip = createClip('shape', project.tracks[0].id, {
      start: 3,
      effects: { ...defaultEffects(), mask: 'star', maskSize: 0.4, maskX: 0.1 },
      keyframes: {
        x: [
          { id: 'a', time: 0, value: 0, easing: 'linear' },
          { id: 'b', time: 2, value: 100, easing: 'linear' },
        ],
      },
    });
    project.clips = [clip];
    const g = getClipGeometry(project, clip, 4)!;
    expect(g.transform.x).toBe(50);
    expect(containsPoint(g, { x: 434, y: 180 })).toBe(true);
    expect(containsPoint(g, { x: 500, y: 230 })).toBe(false);
  });
  it('lets the visible feather edge be selected without selecting far transparent pixels', () => {
    const fx = {
      ...defaultEffects(),
      mask: 'rectangle' as const,
      maskSize: 0.5,
      maskFeather: 0.02,
    };
    expect(pointInMask(fx, 640, 360, { x: 170, y: 0 })).toBe(true);
    expect(pointInMask(fx, 640, 360, { x: 200, y: 0 })).toBe(false);
    expect(pointInMask({ ...fx, maskInvert: true }, 640, 360, { x: 150, y: 0 })).toBe(true);
    expect(pointInMask({ ...fx, maskInvert: true }, 640, 360, { x: 0, y: 0 })).toBe(false);
  });
  it('round trips new mask fields and fills absent fields in old projects', () => {
    const project = createProject();
    const clip = createClip('shape', project.tracks[0].id);
    project.clips = [clip];
    Object.assign(clip.effects, {
      mask: 'heart',
      maskX: 0.2,
      maskY: -0.1,
      maskRotation: 25,
      maskFeather: 0.05,
      maskInvert: true,
    });
    expect(validateProject(project).clips[0].effects).toEqual(clip.effects);
    delete clip.effects.maskX;
    delete clip.effects.maskY;
    delete clip.effects.maskRotation;
    delete clip.effects.maskFeather;
    delete clip.effects.maskInvert;
    expect(validateProject(project).clips[0].effects).toMatchObject({
      maskX: 0,
      maskY: 0,
      maskRotation: 0,
      maskFeather: 0,
      maskInvert: false,
    });
  });
  it.each([
    ['maskX', Infinity],
    ['maskX', 1.1],
    ['maskY', -1.1],
    ['maskRotation', 361],
    ['maskFeather', -0.1],
    ['maskFeather', 0.3],
    ['maskInvert', 'yes'],
    ['mask', 'private-asset'],
  ])('rejects unsafe mask field %s=%s', (key, value) => {
    const project = createProject();
    const clip = createClip('shape', project.tracks[0].id);
    project.clips = [clip];
    Object.assign(clip.effects, { [key]: value });
    expect(() => validateProject(project)).toThrow();
  });
});

describe('original color presets', () => {
  it('offers 19 self-contained color grades and seven masks', () => {
    expect(effectPresets.filter((p) => p.category === '调色')).toHaveLength(19);
    expect(effectPresets.filter((p) => p.category === '蒙版')).toHaveLength(7);
    expect(new Set(effectPresets.map((p) => p.id)).size).toBe(effectPresets.length);
  });
  it('switching from monochrome to daylight restores color and preserves other effects', () => {
    const mono = effectPresets.find((p) => p.id === 'mono')!,
      day = effectPresets.find((p) => p.id === 'daylight')!;
    const fx = {
      ...defaultEffects(),
      mask: 'star' as const,
      blur: 2,
      ...mono.values,
      ...day.values,
    };
    expect(fx.grayscale).toBe(0);
    expect(fx.mask).toBe('star');
    expect(fx.blur).toBe(2);
  });
  it('all presets pass the same project validation as saved files', () => {
    for (const preset of effectPresets) {
      const project = createProject();
      project.clips = [
        createClip('shape', project.tracks[0].id, {
          effects: { ...defaultEffects(), ...preset.values },
        }),
      ];
      expect(() => validateProject(project)).not.toThrow();
    }
  });
});
