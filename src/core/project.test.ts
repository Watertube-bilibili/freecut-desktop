import { describe, expect, it } from 'vitest';
import {
  createClip,
  createProject,
  defaultEffects,
  defaultTransform,
  durationOf,
  evaluate,
  getTransform,
  parseSrt,
  splitClip,
  toSrt,
  trimClip,
  validateProject,
} from './project';
import type { AnimProperty, Clip, Easing, Project } from '../types';

const animated = (easing: Easing = 'linear'): Clip =>
  createClip('shape', 'video', {
    start: 5,
    duration: 4,
    inPoint: 3,
    speed: 2,
    keyframes: {
      scale: [
        { id: 'a', time: 0, value: 1, easing },
        { id: 'b', time: 4, value: 2, easing: 'linear' },
      ],
    },
  });
function fixture(): Project {
  const project = createProject();
  project.assets.push({
    id: 'asset',
    name: '测试.mp4',
    kind: 'video',
    url: 'freecut-media://local/video.mp4',
    path: 'D:\\视频\\测试.mp4',
    duration: 10,
  });
  project.clips.push(
    createClip('video', 'video', {
      assetId: 'asset',
      keyframes: {
        opacity: [
          { id: 'k0', time: 0, value: 0, easing: 'linear' },
          { id: 'k1', time: 5, value: 1, easing: 'linear' },
        ],
      },
    }),
  );
  return project;
}

describe('project defaults and ownership', () => {
  it('creates the three requested track kinds, an empty timeline and 1080p project', () => {
    const project = createProject();
    expect(project.tracks.map((track) => track.kind)).toEqual(['overlay', 'video', 'audio']);
    expect([project.width, project.height, project.fps, durationOf(project)]).toEqual([
      1920, 1080, 30, 0,
    ]);
    expect(validateProject(project)).toEqual(project);
    expect(createClip('shape', 'video').duration).toBe(5);
  });
  it('returns independent mutable defaults and clones supplied nested data', () => {
    const first = defaultTransform();
    first.scale = 5;
    const effects = defaultEffects();
    effects.blur = 30;
    expect(defaultTransform().scale).toBe(1);
    expect(defaultEffects().blur).toBe(0);
    const source = animated(),
      copy = createClip(source.kind, source.trackId, source);
    copy.keyframes.scale![0].value = 1.5;
    copy.transform.opacity = 0.2;
    expect(source.keyframes.scale![0].value).toBe(1);
    expect(source.transform.opacity).toBe(1);
  });
  it('calculates the last end regardless of clip ordering', () => {
    const project = createProject();
    project.clips = [animated(), createClip('shape', 'video', { start: 1, duration: 2 })];
    expect(durationOf(project)).toBe(9);
  });
});

describe('keyframe evaluation', () => {
  it.each<[Easing, number]>([
    ['linear', 1.25],
    ['ease-in', 1.0625],
    ['ease-out', 1.4375],
    ['ease-in-out', 1.125],
    ['hold', 1],
  ])('evaluates %s interpolation', (easing, value) => {
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
    const clip = animated();
    clip.keyframes.scale!.reverse();
    clip.keyframes.scale!.push({ id: 'replacement', time: 0, value: 0.5, easing: 'linear' });
    expect(evaluate(clip, 'scale', 0)).toBe(0.5);
    expect(evaluate(clip, 'scale', 2)).toBe(1.25);
    expect(evaluate(clip, 'x', 2)).toBe(0);
  });
});

describe('split and trim', () => {
  it('rejects either edge and times outside the clip', () => {
    for (const time of [0, 5, 9, 10, NaN, Infinity]) expect(splitClip(animated(), time)).toBeNull();
  });
  it('splits source offsets, clip identities, boundary values and local keyframes', () => {
    const clip = animated();
    const [left, right] = splitClip(clip, 7)!;
    expect([left.id, left.duration, left.inPoint]).toEqual([clip.id, 2, 3]);
    expect(right.id).not.toBe(clip.id);
    expect([right.start, right.duration, right.inPoint]).toEqual([7, 2, 7]);
    expect(left.keyframes.scale!.map((point) => [point.time, point.value])).toEqual([
      [0, 1],
      [2, 1.5],
    ]);
    expect(right.keyframes.scale!.map((point) => [point.time, point.value])).toEqual([
      [0, 1.5],
      [2, 2],
    ]);
    expect(clip.duration).toBe(4);
    expect(clip.keyframes.scale).toHaveLength(2);
  });
  it.each<Easing>(['ease-in', 'ease-out', 'ease-in-out', 'hold'])(
    'preserves %s curves on both sides of an interior split',
    (easing) => {
      const original = animated(easing),
        split = 1.37;
      const [left, right] = splitClip(original, original.start + split)!;
      for (let time = 0; time <= 4; time += 0.071) {
        const actual =
          time < split ? evaluate(left, 'scale', time) : evaluate(right, 'scale', time - split);
        expect(Math.abs(actual - evaluate(original, 'scale', time))).toBeLessThan(0.00002);
      }
    },
  );
  it('preserves an original hold discontinuity exactly at a split', () => {
    const clip = animated('hold');
    clip.duration = 6;
    const [left, right] = splitClip(clip, 9)!;
    expect(evaluate(left, 'scale', 3.999)).toBe(1);
    expect(evaluate(left, 'scale', 4)).toBe(2);
    expect(evaluate(right, 'scale', 0)).toBe(2);
  });
  it('trims both edges with source-speed adjustment and repositions animation', () => {
    const clip = animated('ease-in-out'),
      result = trimClip(clip, 1, 0.5);
    expect([result.start, result.duration, result.inPoint]).toEqual([6, 2.5, 5]);
    for (let time = 0; time < result.duration; time += 0.13)
      expect(
        Math.abs(evaluate(result, 'scale', time) - evaluate(clip, 'scale', time + 1)),
      ).toBeLessThan(0.00002);
    expect(result.keyframes.scale![0].time).toBe(0);
    expect(result.keyframes.scale!.at(-1)!.time).toBe(2.5);
  });
  it('keeps a nonzero clip and never extends before source zero or timeline zero', () => {
    const result = trimClip(animated(), 100, 100);
    expect(result.duration).toBeCloseTo(0.001);
    const extended = trimClip(animated(), -100, -1);
    expect(extended.inPoint).toBe(0);
    expect(extended.start).toBe(3.5);
    expect(() => trimClip(animated(), NaN, 0)).toThrow();
  });
});

describe('split fade envelope preservation', () => {
  const rendered = (clip: Clip, prop: 'opacity' | 'volume', local: number) => {
    const enter = clip.fadeIn ? Math.min(1, local / clip.fadeIn) : 1;
    const leave = clip.fadeOut ? Math.min(1, (clip.duration - local) / clip.fadeOut) : 1;
    return (
      evaluate(clip, prop, local) * (prop === 'opacity' ? Math.min(enter, leave) : enter * leave)
    );
  };
  function compare(original: Clip, parts: Clip[], samples: number[]) {
    for (const time of samples) {
      const part =
        parts.find(
          (p) => time >= p.start - original.start && time < p.start - original.start + p.duration,
        ) ?? parts.at(-1)!;
      for (const prop of original.kind === 'audio'
        ? (['volume'] as const)
        : (['opacity', 'volume'] as const)) {
        const actual = rendered(part, prop, time - (part.start - original.start));
        expect(Math.abs(actual - rendered(original, prop, time))).toBeLessThan(0.0001);
      }
    }
  }
  it('does not make a fade-in louder when splitting inside it', () => {
    const original = createClip('audio', 'audio', {
      assetId: 'audio',
      start: 7,
      duration: 5,
      fadeIn: 5,
    });
    const before = structuredClone(original);
    const parts = splitClip(original, 9)!;
    expect(rendered(parts[0], 'volume', 1)).toBeCloseTo(0.2, 8);
    expect(rendered(parts[1], 'volume', 0.5)).toBeCloseTo(0.5, 8);
    expect(parts.every((part) => part.fadeIn === 0 && part.fadeOut === 0)).toBe(true);
    expect(original).toEqual(before);
  });
  it.each<Easing>(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'])(
    'preserves overlapping fades composed with existing %s opacity and volume',
    (easing) => {
      const original = createClip('video', 'video', {
        assetId: 'asset',
        start: 3,
        duration: 5,
        fadeIn: 4,
        fadeOut: 3.5,
        keyframes: {
          opacity: [
            { id: 'o0', time: 0, value: 0.8, easing },
            { id: 'o1', time: 2, value: 0.2, easing },
            { id: 'o2', time: 5, value: 1, easing: 'linear' },
          ],
          volume: [
            { id: 'v0', time: 0, value: 3.7, easing },
            { id: 'v1', time: 2, value: 0.3, easing },
            { id: 'v2', time: 5, value: 2.4, easing: 'linear' },
          ],
        },
      });
      for (const cut of [0.63, 2, 3.17, 4.81]) {
        const parts = splitClip(original, original.start + cut)!;
        compare(original, parts, [
          ...Array.from({ length: 1201 }, (_, index) => (index * 5) / 1200),
          2 - 1e-7,
          2 - 1e-9,
          2,
          2 + 1e-9,
          cut,
        ]);
        const project = fixture();
        project.clips = parts;
        expect(() => validateProject(project)).not.toThrow();
      }
    },
  );
  it('keeps the different visual-min and audio-product overlap envelopes', () => {
    const original = createClip('video', 'video', { duration: 5, fadeIn: 5, fadeOut: 5 });
    const [left] = splitClip(original, 3)!;
    expect(evaluate(left, 'opacity', 2.5)).toBeCloseTo(0.5, 5);
    expect(evaluate(left, 'volume', 2.5)).toBeCloseTo(0.25, 4);
  });
  it('preserves a held jump inside a changing fade after repeated splits', () => {
    const original = createClip('audio', 'audio', {
      start: 8,
      duration: 5,
      fadeIn: 5,
      fadeOut: 4,
      keyframes: {
        volume: [
          { id: 'a', time: 0, value: 3, easing: 'hold' },
          { id: 'b', time: 2, value: 0.3, easing: 'ease-in-out' },
          { id: 'c', time: 5, value: 4, easing: 'linear' },
        ],
      },
    });
    let parts: Clip[] = splitClip(original, original.start + 0.4)!;
    const firstCount = parts.reduce((n, clip) => n + clip.keyframes.volume!.length, 0);
    const cuts = [0.8, 1.2, 1.6, 2, 2.4, 2.8, 3.2, 3.6, 4, 4.4, 4.8];
    for (const cut of cuts) {
      const at = original.start + cut;
      const index = parts.findIndex((p) => at > p.start && at < p.start + p.duration);
      parts.splice(index, 1, ...splitClip(parts[index], at)!);
    }
    expect(parts.reduce((n, clip) => n + clip.keyframes.volume!.length, 0)).toBeLessThanOrEqual(
      firstCount + 2 * cuts.length,
    );
    compare(original, parts, [
      ...Array.from({ length: 1501 }, (_, index) => (index * 5) / 1500),
      2 - 1e-7,
      2 - 1e-9,
      2,
      2 + 1e-9,
    ]);
  });
  it('rejects an over-budget baked curve without mutating the source', () => {
    const original = createClip('audio', 'audio', {
      duration: 5,
      fadeIn: 5,
      keyframes: {
        volume: Array.from({ length: 6000 }, (_, i) => ({
          id: `dense-${i}`,
          time: (i * 5) / 5999,
          value: i % 2 ? 4 : 1,
          easing: 'hold' as const,
        })),
      },
    });
    expect(() => splitClip(original, 4.99)).toThrow(/关键帧上限/);
    expect(original.fadeIn).toBe(5);
    expect(original.keyframes.volume).toHaveLength(6000);
  });
  it('leaves trim fade semantics unchanged', () => {
    const original = createClip('video', 'video', { duration: 5, fadeIn: 4, fadeOut: 3 });
    const trimmed = trimClip(original, 1, 1);
    expect([trimmed.fadeIn, trimmed.fadeOut]).toEqual([3, 3]);
    expect(trimmed.keyframes).toEqual({});
  });
});

describe('SRT interoperability', () => {
  it('reads BOM, CRLF, multiline Chinese text, period decimals and subtitle positioning settings', () => {
    expect(
      parseSrt(
        '\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\n你好\r\n第二行\r\n\r\n2\r\n00:00:05.000 --> 00:00:06.250 X1:10 X2:20\r\n测试',
      ),
    ).toEqual([
      { start: 1.25, duration: 2.25, text: '你好\n第二行' },
      { start: 5, duration: 1.25, text: '测试' },
    ]);
  });
  it('skips malformed or reversed intervals and accepts unnumbered subtitles', () => {
    expect(
      parseSrt(
        '1\n00:60:00,000 --> 00:60:01,000\nbad\n\n2\n00:00:05,000 --> 00:00:03,000\nreversed\n\n00:00:02,000 --> 00:00:03,000\n有效',
      ),
    ).toEqual([{ start: 2, duration: 1, text: '有效' }]);
  });
  it('sorts text clips and round-trips millisecond boundaries without changing the input order', () => {
    const first = createClip('text', 'overlay', { start: 59.9996, duration: 1.001 }),
      second = createClip('text', 'overlay', { start: 1.25, duration: 2.25 });
    first.text!.text = '后一句';
    second.text!.text = '你好\n世界';
    const clips = [first, createClip('shape', 'overlay'), second],
      text = toSrt(clips);
    expect(text).toContain('00:01:00,000 --> 00:01:01,001');
    const cues = parseSrt(text);
    expect(cues[0]).toEqual({ start: 1.25, duration: 2.25, text: '你好\n世界' });
    expect(cues[1]).toMatchObject({ start: 60, text: '后一句' });
    expect(cues[1].duration).toBeCloseTo(1.001, 8);
    expect(clips[0]).toBe(first);
  });
});

describe('untrusted project validation', () => {
  it('reconstructs valid data, leaving file-existence checks to the backend', () => {
    const input = fixture(),
      result = validateProject(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.clips[0].transform).not.toBe(input.clips[0].transform);
    expect(result.assets[0].missing).toBeUndefined();
  });
  it('accepts an empty media URL only with an explicit missing flag', () => {
    const input = fixture();
    input.assets[0].url = '';
    expect(() => validateProject(input)).toThrow(/url/);
    input.assets[0].missing = true;
    expect(validateProject(input).assets[0]).toMatchObject({ url: '', missing: true });
  });
  it.each([
    'https://evil.example/movie.mp4',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz4=',
  ])('rejects unsafe media URL %s', (url) => {
    const input = fixture();
    input.assets[0].url = url;
    expect(() => validateProject(input)).toThrow(/url/);
  });
  it.each([
    'blob:http://localhost:5173/id',
    'freecut-media://local/a%20b.mp4',
    'data:image/png;base64,iVBORw0KGgo=',
  ])('accepts local media URL %s', (url) => {
    const input = fixture();
    input.assets[0].url = url;
    expect(validateProject(input).assets[0].url).toBe(url);
  });
  it.each<[AnimProperty, number]>([
    ['x', Infinity],
    ['scale', -1],
    ['opacity', 2],
    ['volume', NaN],
  ])('rejects invalid nested transform %s', (prop, value) => {
    const input = fixture();
    input.clips[0].transform[prop] = value;
    expect(() => validateProject(input)).toThrow();
  });
  it('rejects malformed nested effects, unknown tracks, duplicate IDs and invalid keyframes', () => {
    const badEffect = fixture();
    badEffect.clips[0].effects.blur = 1e9;
    expect(() => validateProject(badEffect)).toThrow(/blur/);
    const badTrack = fixture();
    badTrack.clips[0].trackId = 'absent';
    expect(() => validateProject(badTrack)).toThrow(/trackId/);
    const duplicate = fixture();
    duplicate.clips.push(duplicate.clips[0]);
    expect(() => validateProject(duplicate)).toThrow(/重复/);
    const badFrame = fixture();
    badFrame.clips[0].keyframes.opacity![1].time = 6;
    expect(() => validateProject(badFrame)).toThrow(/time/);
    const duplicateTime = fixture();
    duplicateTime.clips[0].keyframes.opacity![1].time = 0;
    expect(() => validateProject(duplicateTime)).toThrow(/重复/);
  });
  it('rejects overlarge resources, nonfinite timing, network paths and unsupported schemas', () => {
    const input = fixture();
    input.width = 100_000;
    expect(() => validateProject(input)).toThrow(/width/);
    const timing = fixture();
    timing.clips[0].duration = Infinity;
    expect(() => validateProject(timing)).toThrow(/duration/);
    const network = fixture();
    network.assets[0].path = '\\\\remote\\share\\file.mp4';
    expect(() => validateProject(network)).toThrow(/path/);
    expect(() => validateProject({ ...fixture(), version: 2 })).toThrow(/version/);
    expect(() => validateProject({ ...fixture(), clips: new Array(10_001) })).toThrow(/clips/);
  });
  it('rejects pollution keys and accessors without executing them', () => {
    const poisoned = JSON.parse(JSON.stringify(fixture()));
    poisoned.clips[0].effects = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(() => validateProject(poisoned)).toThrow();
    const input = fixture();
    let invoked = false;
    Object.defineProperty(input.clips[0].transform, 'x', {
      get() {
        invoked = true;
        return 0;
      },
    });
    expect(() => validateProject(input)).toThrow();
    expect(invoked).toBe(false);
  });
  it('drops unknown fields and provides a serializable object without shared references', () => {
    const input = fixture();
    Object.assign(input, { ignored: { secret: true } });
    const validated = validateProject(input);
    expect(validated).not.toHaveProperty('ignored');
    expect(() => JSON.stringify(validated)).not.toThrow();
  });
});
