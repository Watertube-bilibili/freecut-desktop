import { describe, expect, it } from 'vitest';
import { createClip, createProject } from './project';
import {
  angleDelta,
  containsPoint,
  getClipGeometry,
  hitTestProject,
  localToProject,
  moveTransform,
  pointerAngle,
  pointerToProject,
  projectToLocal,
  rotationValue,
  scaleTransform,
  textBounds,
} from './preview-transform';
import type { ClipGeometry, Point } from './preview-transform';
import type { TextStyle } from '../types';

function fixture() {
  const project = createProject();
  project.width = 1000;
  project.height = 500;
  return project;
}
function near(actual: Point, expected: Point) {
  expect(actual.x).toBeCloseTo(expected.x, 7);
  expect(actual.y).toBeCloseTo(expected.y, 7);
}
const text: TextStyle = {
  text: 'AB',
  fontSize: 20,
  color: '#fff',
  background: 'transparent',
  align: 'left',
  bold: false,
  stroke: false,
};

describe('preview geometry matches renderer space', () => {
  it('fits a portrait/square source into the project without stretching', () => {
    const project = fixture();
    project.assets = [
      {
        id: 'image',
        name: 'square',
        kind: 'image',
        url: 'blob:image',
        duration: 5,
        width: 100,
        height: 100,
      },
    ];
    const clip = createClip('image', 'video', { assetId: 'image' });
    const geometry = getClipGeometry(project, clip, 1)!;
    expect(geometry.bounds).toEqual({ left: -250, top: -250, right: 250, bottom: 250 });
    expect(geometry.corners).toEqual([
      { x: 250, y: 0 },
      { x: 750, y: 0 },
      { x: 750, y: 500 },
      { x: 250, y: 500 },
    ]);
    expect(containsPoint(geometry, { x: 100, y: 250 })).toBe(false);
  });
  it('applies position, uniform scale and rotation around project center', () => {
    const geometry = getClipGeometry(
      fixture(),
      createClip('shape', 'video', { transform: { x: 100, y: -20, scale: 0.2, rotation: 90 } }),
      1,
    )!;
    near(geometry.origin, { x: 600, y: 230 });
    near(geometry.corners[0], { x: 650, y: 130 });
    near(geometry.corners[2], { x: 550, y: 330 });
  });
  it('inverts transforms including both flip axes', () => {
    const geometry = getClipGeometry(
      fixture(),
      createClip('shape', 'video', {
        transform: { x: 63, y: -77, scale: 0.35, rotation: 137 },
        effects: { flipX: true, flipY: true },
      }),
      1,
    )!;
    for (const point of [
      { x: 0, y: 0 },
      { x: -270, y: 80 },
      { x: 500, y: -250 },
    ])
      near(projectToLocal(geometry, localToProject(geometry, point)), point);
    expect(containsPoint(geometry, localToProject(geometry, { x: 510, y: 0 }))).toBe(false);
  });
  it('evaluates keyframes in clip-local time instead of using base transform', () => {
    const clip = createClip('shape', 'video', {
      start: 7,
      duration: 4,
      transform: { x: -400 },
      keyframes: {
        x: [
          { id: 'x0', time: 0, value: 0, easing: 'linear' },
          { id: 'x1', time: 4, value: 200, easing: 'linear' },
        ],
      },
    });
    expect(getClipGeometry(fixture(), clip, 9)?.origin.x).toBe(600);
    expect(getClipGeometry(fixture(), clip, 6.99)).toBeNull();
    expect(getClipGeometry(fixture(), clip, 11)).toBeNull();
  });
  it('rejects hidden, locked, audio and missing-media objects', () => {
    const project = fixture(),
      clip = createClip('shape', 'video');
    project.tracks.find((track) => track.id === 'video')!.locked = true;
    expect(getClipGeometry(project, clip, 1)).toBeNull();
    project.tracks.find((track) => track.id === 'video')!.locked = false;
    project.tracks.find((track) => track.id === 'video')!.hidden = true;
    expect(getClipGeometry(project, clip, 1)).toBeNull();
    expect(getClipGeometry(fixture(), createClip('audio', 'audio'), 1)).toBeNull();
    expect(
      getClipGeometry(fixture(), createClip('video', 'video', { assetId: 'absent' }), 1),
    ).toBeNull();
  });
  it('does not hit invisible opacity/fade boundaries', () => {
    const project = fixture();
    expect(
      getClipGeometry(project, createClip('shape', 'video', { transform: { opacity: 0 } }), 1),
    ).toBeNull();
    const clip = createClip('shape', 'video', { fadeIn: 1 });
    expect(getClipGeometry(project, clip, 0)).toBeNull();
    expect(getClipGeometry(project, clip, 0.1)).not.toBeNull();
  });
  it('uses topmost visible editable track, then last clip in that track', () => {
    const project = fixture();
    const base = createClip('shape', 'video'),
      one = createClip('shape', 'overlay'),
      two = createClip('shape', 'overlay');
    project.clips = [two, base, one];
    expect(hitTestProject(project, 1, { x: 500, y: 250 })?.clip.id).toBe(one.id);
    project.tracks[0].locked = true;
    expect(hitTestProject(project, 1, { x: 500, y: 250 })?.clip.id).toBe(base.id);
    expect(hitTestProject(project, 1, { x: -1, y: 250 })).toBeNull();
  });
  it('hit tests circle and rectangle masks inside their clipped bounds', () => {
    const project = fixture();
    const circle = getClipGeometry(
      project,
      createClip('shape', 'video', { effects: { mask: 'circle', maskSize: 0.5 } }),
      1,
    )!;
    expect(circle.bounds).toEqual({ left: -125, top: -125, right: 125, bottom: 125 });
    expect(containsPoint(circle, { x: 620, y: 370 })).toBe(false);
    expect(containsPoint(circle, { x: 500, y: 370 })).toBe(true);
    const rect = getClipGeometry(
      project,
      createClip('shape', 'video', { effects: { mask: 'rectangle', maskSize: 0.5 } }),
      1,
    )!;
    expect(rect.bounds).toEqual({ left: -250, top: -125, right: 250, bottom: 125 });
  });
});

describe('text bounds preserve alignment, measured ink and renderer padding', () => {
  it.each(['left', 'center', 'right'] as const)('positions %s aligned multiline text', (align) => {
    const bounds = textBounds({ ...text, align, text: 'AB\nC' }, (line) => ({
      width: line.length * 20,
    }))!;
    const expected = align === 'left' ? [0, 40] : align === 'right' ? [-40, 0] : [-20, 20];
    expect([bounds.left, bounds.right]).toEqual(expected);
    expect([bounds.top, bounds.bottom]).toEqual([-23, 23]);
  });
  it('uses actual ink offsets measured with the middle baseline', () => {
    expect(
      textBounds(text, () => ({
        width: 40,
        actualBoundingBoxLeft: -3,
        actualBoundingBoxRight: 38,
        actualBoundingBoxAscent: 4,
        actualBoundingBoxDescent: 11,
      })),
    ).toEqual({ left: 3, right: 38, top: -4, bottom: 11 });
  });
  it('expands the five-pixel stroke by half its width', () => {
    expect(textBounds({ ...text, stroke: true, align: 'right' }, () => ({ width: 40 }))).toEqual({
      left: -42.5,
      right: 2.5,
      top: -12.5,
      bottom: 12.5,
    });
  });
  it('matches multiline background padding and preserves blank lines', () => {
    expect(
      textBounds({ ...text, text: 'ABC\n', background: '#000' }, (line) => ({
        width: line.length * 20,
      })),
    ).toEqual({ left: -18, right: 78, top: -34, bottom: 34 });
    expect(textBounds({ ...text, text: '  \n ' })).toBeNull();
  });
});

describe('pointer transactions remain in project coordinates', () => {
  it('maps offsets and CSS scaling independently of canvas backing pixels / device DPI', () => {
    near(
      pointerToProject(
        { x: 410, y: 245 },
        { left: 10, top: 20, width: 800, height: 450 },
        { width: 1920, height: 1080 },
      ),
      { x: 960, y: 540 },
    );
    near(
      pointerToProject(
        { x: 210, y: 132.5 },
        { left: 10, top: 20, width: 400, height: 225 },
        { width: 1920, height: 1080 },
      ),
      { x: 960, y: 540 },
    );
  });
  it('moves from the original pointer-down coordinates without a threshold offset', () => {
    const geometry = getClipGeometry(
      fixture(),
      createClip('shape', 'video', { transform: { x: 50, y: 30 } }),
      1,
    )!;
    expect(moveTransform(geometry, { x: 530, y: 220 }, { x: 577, y: 191 })).toEqual({
      x: 97,
      y: 1,
    });
  });
  it.each([0, 35, 170])('keeps the opposite resize corner fixed at %i degrees', (rotation) => {
    const project = fixture(),
      clip = createClip('shape', 'video', {
        transform: { x: 50, y: -20, scale: 0.3, rotation },
        effects: { flipX: true },
      });
    const before = getClipGeometry(project, clip, 1)!;
    const start = before.corners[2],
      anchor = before.corners[0];
    const current = {
      x: anchor.x + (start.x - anchor.x) * 1.4,
      y: anchor.y + (start.y - anchor.y) * 1.4,
    };
    const change = scaleTransform(before, 'se', start, current);
    expect(change.scale).toBeCloseTo(0.42, 9);
    const after = getClipGeometry(
      project,
      { ...clip, transform: { ...clip.transform, ...change } },
      1,
    )!;
    near(after.corners[0], anchor);
    near(after.corners[2], current);
  });
  it('anchors an asymmetric left-aligned text box while resizing', () => {
    const project = fixture(),
      clip = createClip('text', 'overlay', { text, transform: { rotation: 38, scale: 2, x: 100 } });
    const before = getClipGeometry(project, clip, 1, () => ({ width: 40 }))!;
    const start = before.corners[2],
      anchor = before.corners[0];
    const change = scaleTransform(before, 'se', start, {
      x: anchor.x + (start.x - anchor.x) * 2,
      y: anchor.y + (start.y - anchor.y) * 2,
    });
    const after = getClipGeometry(
      project,
      { ...clip, transform: { ...clip.transform, ...change } },
      1,
      () => ({ width: 40 }),
    )!;
    expect(change.scale).toBeCloseTo(4);
    near(after.corners[0], anchor);
  });
  it('clamps a corner dragged through its anchor without flipping or zero scale', () => {
    const geometry = getClipGeometry(fixture(), createClip('shape', 'video'), 1)!;
    const change = scaleTransform(geometry, 'se', geometry.corners[2], { x: -1000, y: -1000 });
    expect(change.scale).toBe(0.001);
    expect(Number.isFinite(change.x)).toBe(true);
  });
  it('unwraps +/-180 degrees and snaps rotation in fifteen-degree steps', () => {
    expect(angleDelta(179, -179)).toBe(2);
    expect(angleDelta(-179, 179)).toBe(-2);
    expect(pointerAngle({ x: 3, y: 8 }, { x: 3, y: 18 })).toBe(90);
    expect(rotationValue(37, true)).toBe(30);
    expect(rotationValue(-39, true)).toBe(-45);
    expect(rotationValue(397, false)).toBe(397);
  });
});
