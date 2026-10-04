import { describe, expect, it } from 'vitest';
import { createClip, createProject, evaluate } from './project';
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  editableSelection,
  moveSelection,
  pasteSelection,
  rectanglesIntersect,
  toggleSelection,
  unionClipRanges,
} from './timeline-selection';
import type { Project } from '../types';

function fixture(): Project {
  const project = createProject();
  project.tracks = [
    { ...project.tracks[0], id: 'v0', kind: 'video' },
    { ...project.tracks[1], id: 'v1', kind: 'video' },
    { ...project.tracks[1], id: 'v2', kind: 'overlay' },
    { ...project.tracks[2], id: 'a0' },
    { ...project.tracks[1], id: 'locked', locked: true },
  ];
  project.clips = [
    createClip('shape', 'v0', {
      id: 'one',
      start: 2,
      duration: 2,
      keyframes: {
        x: [
          { id: 'kf1', time: 0, value: 4, easing: 'bezier', curve: [0.2, 0.6, 0.8, 0.9] },
          { id: 'kf2', time: 2, value: 150, easing: 'linear' },
        ],
      },
    }),
    createClip('text', 'v1', { id: 'two', start: 5, duration: 1, text: { text: 'Caption' } }),
    createClip('shape', 'locked', { id: 'protected', start: 3, duration: 3 }),
  ];
  return project;
}

describe('timeline selection gestures', () => {
  it('toggles stable selections and ignores duplicate/stale IDs for edits', () => {
    expect(toggleSelection(['one'], 'two')).toEqual(['one', 'two']);
    expect(toggleSelection(['one', 'two'], 'one')).toEqual(['two']);
    expect(
      editableSelection(fixture(), ['one', 'missing', 'protected', 'one']).map((c) => c.id),
    ).toEqual(['one']);
  });
  it('clamps the entire group at zero and preserves relative timing and animation', () => {
    const project = fixture();
    const moved = moveSelection(project, ['one', 'two', 'protected'], -100);
    expect(moved.clips.map((c) => c.start)).toEqual([0, 3, 3]);
    expect(moved.clips[0].keyframes).toBe(project.clips[0].keyframes);
    expect(moved.clips[2]).toBe(project.clips[2]);
    expect(project.clips[0].start).toBe(2);
  });
  it('moves compatible tracks together with their relative vertical offsets', () => {
    const project = fixture();
    const moved = moveSelection(project, ['one', 'two'], 1.13, 1);
    expect(moved.clips.slice(0, 2).map((c) => c.trackId)).toEqual(['v1', 'v2']);
    expect(moved.clips[1].start - moved.clips[0].start).toBeCloseTo(3);
    expect(moved.clips[0].start).toBeCloseTo(2 + 34 / 30);
  });
  it('rejects incompatible, locked and out-of-range destinations atomically', () => {
    const project = fixture();
    expect(moveSelection(project, ['one', 'two'], 1, 2)).toBe(project);
    expect(moveSelection(project, ['one'], 1, 4)).toBe(project);
    expect(moveSelection(project, ['one'], 1, -1)).toBe(project);
    expect(moveSelection(project, ['protected'], 1)).toBe(project);
    expect(moveSelection(project, ['one'], 0)).toBe(project);
    expect(moveSelection(project, ['one'], NaN)).toBe(project);
  });
  it('previews from one snapshot without accumulating intermediate deltas', () => {
    const project = fixture();
    const previewOne = moveSelection(project, ['one', 'two'], 1);
    const previewTwo = moveSelection(project, ['one', 'two'], 2);
    expect(previewOne.clips[0].start).toBe(3);
    expect(previewTwo.clips[0].start).toBe(4);
    expect(moveSelection(project, ['one', 'two'], 0)).toBe(project);
    expect(project.clips[0].start).toBe(2);
  });
  it('keeps imported subframe offsets and prevents exceeding the 24 hour project limit', () => {
    const project = fixture();
    project.clips[0].start = 0.005;
    project.clips[1].start = 86398.005;
    const moved = moveSelection(project, ['one', 'two'], 100);
    expect(moved.clips[1].start + moved.clips[1].duration).toBeCloseTo(86400);
    expect(moved.clips[1].start - moved.clips[0].start).toBeCloseTo(86398);
  });
  it('marquee intersection excludes touching boundaries and includes partial overlaps', () => {
    const area = { left: 10, top: 10, right: 30, bottom: 30 };
    expect(rectanglesIntersect(area, { left: 30, top: 10, right: 40, bottom: 20 })).toBe(false);
    expect(rectanglesIntersect(area, { left: 29, top: 29, right: 40, bottom: 40 })).toBe(true);
  });
});

describe('batch timeline edits', () => {
  it('pastes independent clip and keyframe IDs without sharing any mutable state', () => {
    const project = fixture();
    const clipboard = copySelection(project, ['one', 'two']);
    const first = pasteSelection(project, clipboard, 10, 'v1');
    const second = pasteSelection(first.project, clipboard, 20, 'v1');
    const clones = first.project.clips.slice(3);
    expect(clones.map((c) => c.start)).toEqual([10, 13]);
    expect(clones.map((c) => c.trackId)).toEqual(['v1', 'v2']);
    expect(new Set([...first.ids, ...second.ids]).size).toBe(4);
    expect(clones[0].keyframes.x![0].id).not.toBe(project.clips[0].keyframes.x![0].id);
    for (const time of [0, 0.5, 1, 1.5, 2])
      expect(evaluate(clones[0], 'x', time)).toBe(evaluate(project.clips[0], 'x', time));
    clones[0].keyframes.x![0].curve![0] = 0.9;
    clones[1].text!.text = 'Changed';
    expect(project.clips[0].keyframes.x![0].curve![0]).toBe(0.2);
    expect(clipboard[1].text!.text).toBe('Caption');
  });
  it('rejects all pasted clips when any target or referenced asset is unavailable', () => {
    const project = fixture();
    const clipboard = copySelection(project, ['one', 'two']);
    expect(pasteSelection(project, clipboard, 1, 'v2')).toMatchObject({
      project,
      ids: [],
      error: 'incompatible',
    });
    expect(pasteSelection(project, clipboard, 1, 'locked').project).toBe(project);
    expect(pasteSelection(project, clipboard, 1, 'absent').error).toBe('missing-track');
    clipboard[0].assetId = 'missing';
    expect(pasteSelection(project, clipboard, 1).error).toBe('missing-asset');
  });
  it('duplicates a group after its complete span while leaving locked clips alone', () => {
    const project = fixture();
    const result = duplicateSelection(project, ['one', 'two', 'protected']);
    expect(result.project.clips.slice(3).map((c) => c.start)).toEqual([6, 9]);
    expect(result.ids).toHaveLength(2);
    expect(result.project.clips[2]).toBe(project.clips[2]);
  });
  it('duplicates after the next frame boundary without creating a subframe overlap', () => {
    const project = fixture();
    project.clips[1].duration = 1.01;
    const result = duplicateSelection(project, ['one', 'two']);
    expect(result.project.clips[3].start).toBeCloseTo(6 + 1 / 30);
    expect(result.project.clips[3].start).toBeGreaterThanOrEqual(6.01);
  });
  it('ordinary delete removes unlocked selections and leaves survivors at their times', () => {
    const project = fixture();
    const result = deleteSelection(project, ['one', 'protected']);
    expect(result.project.clips.map((c) => c.id)).toEqual(['two', 'protected']);
    expect(result.project.clips[0].start).toBe(5);
    expect(result.ids).toEqual(['protected']);
  });
  it('ripple closes the union once across all unlocked tracks, preserving boundary clips', () => {
    const project = fixture();
    project.clips.push(
      createClip('shape', 'v2', { id: 'overlap-selection', start: 3, duration: 1.5 }),
      createClip('shape', 'v0', { id: 'before', start: 0, duration: 2 }),
      createClip('shape', 'v1', { id: 'later', start: 8, duration: 1 }),
    );
    expect(
      unionClipRanges(
        project.clips.filter((c) => ['one', 'overlap-selection', 'two'].includes(c.id)),
      ),
    ).toEqual([
      [2, 4.5],
      [5, 6],
    ]);
    const result = deleteSelection(project, ['one', 'two', 'overlap-selection'], true);
    expect(result.error).toBeUndefined();
    expect(result.project.clips.find((c) => c.id === 'later')!.start).toBe(4.5);
    expect(result.project.clips.find((c) => c.id === 'before')!.start).toBe(0);
    expect(result.project.clips.find((c) => c.id === 'protected')!.start).toBe(3);
    expect(result.project.clips.find((c) => c.id === 'later')!.duration).toBe(1);
  });
  it('ripple rejects a survivor crossing a removed range without partial deletion or truncation', () => {
    const project = fixture();
    project.clips.push(createClip('shape', 'v1', { id: 'spanning', start: 1, duration: 4 }));
    const result = deleteSelection(project, ['one'], true);
    expect(result.project).toBe(project);
    expect(result.error).toBe('ripple-overlap');
    expect(result.ids).toEqual(['one']);
    expect(project.clips.find((c) => c.id === 'spanning')!.duration).toBe(4);
  });
});
