import { describe, expect, it } from 'vitest';
import { createClip, createProject, defaultEffects, defaultTransform, durationOf, evaluate, getTransform, parseSrt, splitClip, toSrt, trimClip, validateProject } from './project';
import type { AnimProperty, Clip, Easing, Project } from '../types';

const animated = (easing: Easing = 'linear'): Clip => createClip('shape', 'video', {
  start: 5, duration: 4, inPoint: 3, speed: 2,
  keyframes: { scale: [{ id: 'a', time: 0, value: 1, easing }, { id: 'b', time: 4, value: 2, easing: 'linear' }] },
});
function fixture(): Project {
  const project = createProject();
  project.assets.push({ id: 'asset', name: '测试.mp4', kind: 'video', url: 'freecut-media://local/video.mp4', path: 'D:\\视频\\测试.mp4', duration: 10 });
  project.clips.push(createClip('video', 'video', { assetId: 'asset', keyframes: { opacity: [{ id: 'k0', time: 0, value: 0, easing: 'linear' }, { id: 'k1', time: 5, value: 1, easing: 'linear' }] } }));
  return project;
}

describe('project defaults and ownership', () => {
  it('creates the three requested track kinds, an empty timeline and 1080p project', () => {
    const project = createProject();
    expect(project.tracks.map(track => track.kind)).toEqual(['overlay', 'video', 'audio']);
    expect([project.width, project.height, project.fps, durationOf(project)]).toEqual([1920, 1080, 30, 0]);
    expect(validateProject(project)).toEqual(project);
    expect(createClip('shape', 'video').duration).toBe(5);
  });
  it('returns independent mutable defaults and clones supplied nested data', () => {
    const first = defaultTransform(); first.scale = 5;
    const effects = defaultEffects(); effects.blur = 30;
    expect(defaultTransform().scale).toBe(1); expect(defaultEffects().blur).toBe(0);
    const source = animated(), copy = createClip(source.kind, source.trackId, source);
    copy.keyframes.scale![0].value = 1.5;
    copy.transform.opacity = .2;
    expect(source.keyframes.scale![0].value).toBe(1); expect(source.transform.opacity).toBe(1);
  });
  it('calculates the last end regardless of clip ordering', () => {
    const project = createProject(); project.clips = [animated(), createClip('shape', 'video', { start: 1, duration: 2 })];
    expect(durationOf(project)).toBe(9);
  });
});

describe('keyframe evaluation', () => {
  it.each<[Easing, number]>([['linear', 1.25], ['ease-in', 1.0625], ['ease-out', 1.4375], ['ease-in-out', 1.125], ['hold', 1]])('evaluates %s interpolation', (easing, value) => {
    expect(evaluate(animated(easing), 'scale', 1)).toBeCloseTo(value, 8);
  });
  it('clamps before/after the available range and hits exact hold endpoints', () => {
    const clip = animated('hold');
    expect(evaluate(clip, 'scale', -10)).toBe(1);
    expect(evaluate(clip, 'scale', 3.999)).toBe(1);
    expect(evaluate(clip, 'scale', 4)).toBe(2);
    expect(evaluate(clip, 'scale', 100)).toBe(2);
  });
  it('uses local time independent of start or source playback speed', () => {
    expect(evaluate(animated(), 'scale', 2)).toBe(1.5);
    expect(getTransform(animated(), 2)).toEqual({ ...defaultTransform(), scale: 1.5 });
  });
  it('handles unordered live edits, duplicate timestamps and missing curves safely', () => {
    const clip = animated(); clip.keyframes.scale!.reverse();
    clip.keyframes.scale!.push({ id: 'replacement', time: 0, value: .5, easing: 'linear' });
    expect(evaluate(clip, 'scale', 0)).toBe(.5);
    expect(evaluate(clip, 'scale', 2)).toBe(1.25);
    expect(evaluate(clip, 'x', 2)).toBe(0);
  });
});

describe('split and trim', () => {
  it('rejects either edge and times outside the clip', () => {
    for (const time of [0, 5, 9, 10, NaN, Infinity]) expect(splitClip(animated(), time)).toBeNull();
  });
  it('splits source offsets, clip identities, boundary values and local keyframes', () => {
    const clip = animated(); const [left, right] = splitClip(clip, 7)!;
    expect([left.id, left.duration, left.inPoint]).toEqual([clip.id, 2, 3]);
    expect(right.id).not.toBe(clip.id);
    expect([right.start, right.duration, right.inPoint]).toEqual([7, 2, 7]);
    expect(left.keyframes.scale!.map(point => [point.time, point.value])).toEqual([[0, 1], [2, 1.5]]);
    expect(right.keyframes.scale!.map(point => [point.time, point.value])).toEqual([[0, 1.5], [2, 2]]);
    expect(clip.duration).toBe(4); expect(clip.keyframes.scale).toHaveLength(2);
  });
  it.each<Easing>(['ease-in', 'ease-out', 'ease-in-out', 'hold'])('preserves %s curves on both sides of an interior split', easing => {
    const original = animated(easing), split = 1.37;
    const [left, right] = splitClip(original, original.start + split)!;
    for (let time = 0; time <= 4; time += .071) {
      const actual = time < split ? evaluate(left, 'scale', time) : evaluate(right, 'scale', time - split);
      expect(Math.abs(actual - evaluate(original, 'scale', time))).toBeLessThan(.00002);
    }
  });
  it('preserves an original hold discontinuity exactly at a split', () => {
    const clip = animated('hold'); clip.duration = 6;
    const [left, right] = splitClip(clip, 9)!;
    expect(evaluate(left, 'scale', 3.999)).toBe(1);
    expect(evaluate(left, 'scale', 4)).toBe(2);
    expect(evaluate(right, 'scale', 0)).toBe(2);
  });
  it('trims both edges with source-speed adjustment and repositions animation', () => {
    const clip = animated('ease-in-out'), result = trimClip(clip, 1, .5);
    expect([result.start, result.duration, result.inPoint]).toEqual([6, 2.5, 5]);
    for (let time = 0; time < result.duration; time += .13) expect(Math.abs(evaluate(result, 'scale', time) - evaluate(clip, 'scale', time + 1))).toBeLessThan(.00002);
    expect(result.keyframes.scale![0].time).toBe(0);
    expect(result.keyframes.scale!.at(-1)!.time).toBe(2.5);
  });
  it('keeps a nonzero clip and never extends before source zero or timeline zero', () => {
    const result = trimClip(animated(), 100, 100);
    expect(result.duration).toBeCloseTo(.001);
    const extended = trimClip(animated(), -100, -1);
    expect(extended.inPoint).toBe(0); expect(extended.start).toBe(3.5);
    expect(() => trimClip(animated(), NaN, 0)).toThrow();
  });
});

describe('SRT interoperability', () => {
  it('reads BOM, CRLF, multiline Chinese text, period decimals and subtitle positioning settings', () => {
    expect(parseSrt('\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\n你好\r\n第二行\r\n\r\n2\r\n00:00:05.000 --> 00:00:06.250 X1:10 X2:20\r\n测试')).toEqual([
      { start: 1.25, duration: 2.25, text: '你好\n第二行' }, { start: 5, duration: 1.25, text: '测试' },
    ]);
  });
  it('skips malformed or reversed intervals and accepts unnumbered subtitles', () => {
    expect(parseSrt('1\n00:60:00,000 --> 00:60:01,000\nbad\n\n2\n00:00:05,000 --> 00:00:03,000\nreversed\n\n00:00:02,000 --> 00:00:03,000\n有效')).toEqual([{ start: 2, duration: 1, text: '有效' }]);
  });
  it('sorts text clips and round-trips millisecond boundaries without changing the input order', () => {
    const first = createClip('text', 'overlay', { start: 59.9996, duration: 1.001 }), second = createClip('text', 'overlay', { start: 1.25, duration: 2.25 });
    first.text!.text = '后一句'; second.text!.text = '你好\n世界';
    const clips = [first, createClip('shape', 'overlay'), second], text = toSrt(clips);
    expect(text).toContain('00:01:00,000 --> 00:01:01,001');
    const cues = parseSrt(text);
    expect(cues[0]).toEqual({ start: 1.25, duration: 2.25, text: '你好\n世界' });
    expect(cues[1]).toMatchObject({ start: 60, text: '后一句' }); expect(cues[1].duration).toBeCloseTo(1.001, 8);
    expect(clips[0]).toBe(first);
  });
});

describe('untrusted project validation', () => {
  it('reconstructs valid data, leaving file-existence checks to the backend', () => {
    const input = fixture(), result = validateProject(input);
    expect(result).toEqual(input); expect(result).not.toBe(input);
    expect(result.clips[0].transform).not.toBe(input.clips[0].transform);
    expect(result.assets[0].missing).toBeUndefined();
  });
  it('accepts an empty media URL only with an explicit missing flag', () => {
    const input = fixture(); input.assets[0].url = '';
    expect(() => validateProject(input)).toThrow(/url/);
    input.assets[0].missing = true;
    expect(validateProject(input).assets[0]).toMatchObject({ url: '', missing: true });
  });
  it.each(['https://evil.example/movie.mp4', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4='])('rejects unsafe media URL %s', url => {
    const input = fixture(); input.assets[0].url = url;
    expect(() => validateProject(input)).toThrow(/url/);
  });
  it.each(['blob:http://localhost:5173/id', 'freecut-media://local/a%20b.mp4', 'data:image/png;base64,iVBORw0KGgo='])('accepts local media URL %s', url => {
    const input = fixture(); input.assets[0].url = url; expect(validateProject(input).assets[0].url).toBe(url);
  });
  it.each<[AnimProperty, number]>([['x', Infinity], ['scale', -1], ['opacity', 2], ['volume', NaN]])('rejects invalid nested transform %s', (prop, value) => {
    const input = fixture(); input.clips[0].transform[prop] = value; expect(() => validateProject(input)).toThrow();
  });
  it('rejects malformed nested effects, unknown tracks, duplicate IDs and invalid keyframes', () => {
    const badEffect = fixture(); badEffect.clips[0].effects.blur = 1e9; expect(() => validateProject(badEffect)).toThrow(/blur/);
    const badTrack = fixture(); badTrack.clips[0].trackId = 'absent'; expect(() => validateProject(badTrack)).toThrow(/trackId/);
    const duplicate = fixture(); duplicate.clips.push(duplicate.clips[0]); expect(() => validateProject(duplicate)).toThrow(/重复/);
    const badFrame = fixture(); badFrame.clips[0].keyframes.opacity![1].time = 6; expect(() => validateProject(badFrame)).toThrow(/time/);
    const duplicateTime = fixture(); duplicateTime.clips[0].keyframes.opacity![1].time = 0; expect(() => validateProject(duplicateTime)).toThrow(/重复/);
  });
  it('rejects overlarge resources, nonfinite timing, network paths and unsupported schemas', () => {
    const input = fixture(); input.width = 100_000; expect(() => validateProject(input)).toThrow(/width/);
    const timing = fixture(); timing.clips[0].duration = Infinity; expect(() => validateProject(timing)).toThrow(/duration/);
    const network = fixture(); network.assets[0].path = '\\\\remote\\share\\file.mp4'; expect(() => validateProject(network)).toThrow(/path/);
    expect(() => validateProject({ ...fixture(), version: 2 })).toThrow(/version/);
    expect(() => validateProject({ ...fixture(), clips: new Array(10_001) })).toThrow(/clips/);
  });
  it('rejects pollution keys and accessors without executing them', () => {
    const poisoned = JSON.parse(JSON.stringify(fixture())); poisoned.clips[0].effects = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(() => validateProject(poisoned)).toThrow();
    const input = fixture(); let invoked = false;
    Object.defineProperty(input.clips[0].transform, 'x', { get() { invoked = true; return 0; } });
    expect(() => validateProject(input)).toThrow(); expect(invoked).toBe(false);
  });
  it('drops unknown fields and provides a serializable object without shared references', () => {
    const input = fixture(); Object.assign(input, { ignored: { secret: true } });
    const validated = validateProject(input);
    expect(validated).not.toHaveProperty('ignored'); expect(() => JSON.stringify(validated)).not.toThrow();
  });
});
