'use strict';
const net = require('node:net');
const { isDeepStrictEqual: same } = require('node:util');
const { validateProject } = require('./export.cjs');
const { MEDIA_EXTENSIONS } = require('./media.cjs');
const LIMITS = Object.freeze({
  project: 2 * 1024 * 1024,
  asset: 8 * 1024 ** 3,
  room: 32 * 1024 ** 3,
  assets: 256,
  peers: 8,
  history: 24,
  transfers: 4,
});
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9-]{36}$/;
const pick = (value, keys) =>
  Object.fromEntries(
    keys.filter((key) => Object.hasOwn(value || {}, key)).map((key) => [key, value[key]]),
  );
const number = (value, min, max) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const string = (value, max = 500) =>
  typeof value === 'string' && value.length <= max && !value.includes('\0');
const identifier = (value) => string(value, 200) && value.length > 0 && !/[\x00-\x1f]/.test(value);
const color = (value) =>
  string(value, 80) &&
  /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|transparent|black|white|(?:rgb|rgba)\(\s*[\d.%]+\s*,\s*[\d.%]+\s*,\s*[\d.%]+(?:\s*,\s*[\d.]+)?\s*\))$/i.test(
    value,
  );
const ranges = {
  x: [-100000, 100000],
  y: [-100000, 100000],
  scale: [0.001, 100],
  rotation: [-360000, 360000],
  opacity: [0, 1],
  volume: [0, 4],
};
const effectRanges = {
  brightness: [0, 5],
  contrast: [0, 5],
  saturation: [0, 5],
  hue: [-360, 360],
  blur: [0, 100],
  grayscale: [0, 1],
  sepia: [0, 1],
  vignette: [0, 1],
  pixelate: [0, 200],
  chromaThreshold: [0, 442],
  maskSize: [0.01, 2],
};
const optionalRanges = {
  maskX: [-1, 1],
  maskY: [-1, 1],
  maskRotation: [-360, 360],
  maskFeather: [0, 0.25],
};
function editorBounds(project) {
  const ensure = (valid) => {
    if (!valid) throw Error('Shared project contains invalid editor settings.');
  };
  ensure(
    identifier(project.id) &&
      Number.isInteger(project.width) &&
      Number.isInteger(project.height) &&
      color(project.background),
  );
  ensure(
    project.tracks.length > 0 && project.tracks.length <= 100 && project.clips.length <= 10000,
  );
  for (const track of project.tracks)
    ensure(identifier(track.id) && string(track.name) && typeof track.locked === 'boolean');
  for (const asset of project.assets) {
    ensure(identifier(asset.id) && string(asset.name, 1000) && number(asset.duration, 0, 86400));
    ensure(
      asset.width === undefined || (Number.isInteger(asset.width) && number(asset.width, 1, 32768)),
    );
    ensure(
      asset.height === undefined ||
        (Number.isInteger(asset.height) && number(asset.height, 1, 32768)),
    );
    ensure(asset.missing === undefined || typeof asset.missing === 'boolean');
  }
  let points = 0;
  for (const clip of project.clips) {
    ensure(
      identifier(clip.id) &&
        string(clip.name) &&
        number(clip.speed, 0.05, 16) &&
        clip.start + clip.duration <= 86400,
    );
    ensure(number(clip.fadeIn, 0, clip.duration) && number(clip.fadeOut, 0, clip.duration));
    ensure(!['video', 'audio', 'image'].includes(clip.kind) || typeof clip.assetId === 'string');
    ensure(Object.entries(ranges).every(([key, bounds]) => number(clip.transform[key], ...bounds)));
    ensure(
      Object.entries(effectRanges).every(([key, bounds]) => number(clip.effects[key], ...bounds)),
    );
    ensure(
      Object.entries(optionalRanges).every(
        ([key, bounds]) => clip.effects[key] === undefined || number(clip.effects[key], ...bounds),
      ),
    );
    ensure(['chroma', 'flipX', 'flipY'].every((key) => typeof clip.effects[key] === 'boolean'));
    ensure(clip.effects.maskInvert === undefined || typeof clip.effects.maskInvert === 'boolean');
    ensure(
      /^#[\da-f]{6}$/i.test(clip.effects.chromaColor) &&
        ['none', 'circle', 'rectangle', 'ellipse', 'diamond', 'star', 'heart', 'band'].includes(
          clip.effects.mask,
        ),
    );
    if (clip.color !== undefined) ensure(color(clip.color));
    if (clip.kind === 'text') ensure(Boolean(clip.text));
    if (clip.text)
      ensure(
        string(clip.text.text, 20000) &&
          number(clip.text.fontSize, 1, 2000) &&
          color(clip.text.color) &&
          color(clip.text.background) &&
          ['left', 'center', 'right'].includes(clip.text.align) &&
          typeof clip.text.bold === 'boolean' &&
          typeof clip.text.stroke === 'boolean',
      );
    for (const [key, frames] of Object.entries(clip.keyframes)) {
      const ids = new Set(),
        times = new Set();
      for (const frame of frames) {
        ensure(
          ++points <= 200000 &&
            identifier(frame.id) &&
            !ids.has(frame.id) &&
            !times.has(frame.time) &&
            number(frame.time, 0, clip.duration + 1e-8) &&
            number(frame.value, ...ranges[key]),
        );
        ids.add(frame.id);
        times.add(frame.time);
      }
    }
  }
}
function canonicalProject(input, wire = false) {
  validateProject(input);
  if (input.assets.length > LIMITS.assets)
    throw Error('Collaboration supports up to 256 media files per project.');
  const project = pick(input, ['version', 'id', 'name', 'width', 'height', 'fps', 'background']);
  project.assets = input.assets.map((asset) => ({
    ...pick(asset, ['id', 'name', 'kind', 'duration', 'width', 'height', 'missing']),
    url: '',
  }));
  project.tracks = input.tracks.map((track) =>
    pick(track, ['id', 'name', 'kind', 'muted', 'hidden', 'locked']),
  );
  project.clips = input.clips.map((clip) => {
    const result = pick(clip, [
      'id',
      'name',
      'kind',
      'assetId',
      'trackId',
      'start',
      'duration',
      'inPoint',
      'speed',
      'color',
      'fadeIn',
      'fadeOut',
    ]);
    result.transform = pick(clip.transform, ['x', 'y', 'scale', 'rotation', 'opacity', 'volume']);
    result.effects = pick(clip.effects, [
      'brightness',
      'contrast',
      'saturation',
      'hue',
      'blur',
      'grayscale',
      'sepia',
      'vignette',
      'pixelate',
      'chroma',
      'chromaColor',
      'chromaThreshold',
      'flipX',
      'flipY',
      'mask',
      'maskSize',
      'maskX',
      'maskY',
      'maskRotation',
      'maskFeather',
      'maskInvert',
    ]);
    result.keyframes = Object.fromEntries(
      ['x', 'y', 'scale', 'rotation', 'opacity', 'volume']
        .filter((key) => Array.isArray(clip.keyframes?.[key]))
        .map((key) => [
          key,
          clip.keyframes[key].map((frame) => pick(frame, ['id', 'time', 'value', 'easing'])),
        ]),
    );
    if (clip.text)
      result.text = pick(clip.text, [
        'text',
        'fontSize',
        'color',
        'background',
        'align',
        'bold',
        'stroke',
      ]);
    if (clip.audio)
      result.audio = pick(clip.audio, ['pan', 'leftGain', 'rightGain', 'channelMode']);
    return result;
  });
  validateProject(project);
  editorBounds(project);
  if (Buffer.byteLength(JSON.stringify(project)) > LIMITS.project)
    throw Error('Collaboration project exceeds 2 MB.');
  if (wire && !same(input, project)) throw Error('Unsupported collaboration project fields.');
  return structuredClone(project);
}
function validateManifest(project, manifest) {
  if (!Array.isArray(manifest) || manifest.length > LIMITS.assets)
    throw Error('Invalid media manifest.');
  let total = 0;
  const ids = new Set();
  for (const entry of manifest) {
    if (
      !entry ||
      Object.keys(entry).sort().join(',') !== 'ext,hash,id,size' ||
      typeof entry.id !== 'string' ||
      ids.has(entry.id) ||
      !HASH.test(entry.hash) ||
      !MEDIA_EXTENSIONS.has(entry.ext) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size <= 0 ||
      entry.size > LIMITS.asset
    )
      throw Error('Invalid shared media.');
    if (!project.assets.some((asset) => asset.id === entry.id && !asset.missing))
      throw Error('Media is not part of the shared project.');
    ids.add(entry.id);
    total += entry.size;
  }
  if (total > LIMITS.room) throw Error('Shared media exceeds 32 GB.');
  if (project.assets.some((asset) => !asset.missing && !ids.has(asset.id)))
    throw Error('A shared media file is missing.');
  return structuredClone(manifest);
}
function address(options) {
  let value = options;
  if (typeof options?.invite === 'string') {
    if (options.invite.length > 512 || !/^freecut1:[A-Za-z0-9_-]+$/.test(options.invite))
      throw Error('Invalid invitation.');
    try {
      value = JSON.parse(Buffer.from(options.invite.slice(9), 'base64url').toString('utf8'));
    } catch {
      throw Error('Invalid invitation.');
    }
  }
  if (
    !value ||
    net.isIP(value.host) !== 4 ||
    value.host === '0.0.0.0' ||
    Number(value.host.split('.')[0]) >= 224 ||
    !Number.isInteger(value.port) ||
    value.port < 1024 ||
    value.port > 65535 ||
    !/^[a-f0-9]{48}$/.test(value.key)
  )
    throw Error('Enter an IPv4 address, port 1024–65535, and the room key.');
  return { host: value.host, port: value.port, key: value.key };
}
const { mergeProjects } = require('./collaboration-merge.mjs');

module.exports = { LIMITS, HASH, ID, canonicalProject, validateManifest, address, mergeProjects };
