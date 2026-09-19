'use strict';
const path = require('node:path');
const { layerPlacement } = require('./concat-placement.cjs');

const effectDefaults = {
  brightness: 1, contrast: 1, saturation: 1, hue: 0, blur: 0, grayscale: 0,
  sepia: 0, vignette: 0, pixelate: 0, chroma: false, mask: 'none',
};
const inactiveEffectOptions = new Set([
  'chromaColor', 'chromaThreshold', 'maskSize', 'maskX', 'maskY',
  'maskRotation', 'maskFeather', 'maskInvert', 'flipX', 'flipY',
]);
const numeric = value => String(Number(value.toFixed(8)));
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const aligned = (time, fps) => Math.abs(time * fps - Math.round(time * fps)) < 1e-7;

/** Why the exact Canvas route is needed; never silently drop an effect. */
function unsupportedVisual(clip) {
  if (!['video', 'image'].includes(clip.kind)) return 'raster-required';
  if (!clip.transform || !finite(clip.transform.scale, 0.0001, 20) ||
      !finite(clip.transform.opacity, 0, 1) ||
      !['x', 'y', 'rotation'].every(key => finite(clip.transform[key], -100000, 100000))) return 'transform';
  if (Object.keys(clip.transform).some(key => !['x', 'y', 'scale', 'rotation', 'opacity', 'volume'].includes(key))) return 'transform';
  if (Object.entries(clip.keyframes || {}).some(([key, values]) =>
    !['x', 'y', 'volume'].includes(key) && (!Array.isArray(values) || values.length))) return 'animated-transform';
  const effects = clip.effects || {};
  if (Object.entries(effectDefaults).some(([key, value]) => (effects[key] ?? value) !== value) ||
      Object.keys(effects).some(key => !(key in effectDefaults) && !inactiveEffectOptions.has(key))) return 'effect';
  if (!finite(clip.fadeIn, 0, 14400) || !finite(clip.fadeOut, 0, 14400)) return 'fade';
  // FFmpeg alpha fades multiply; FreeCut visual ramps use their minimum.
  if (clip.fadeIn + clip.fadeOut > clip.duration + 1e-8) return 'overlapping-fades';
  return null;
}

function positionExpression(frames, fallback, start, pixelScale) {
  if (!frames?.length) return numeric(fallback * pixelScale);
  // Identical project-local time, deduplication, outgoing easing and balanced
  // tree to audio, including Concat-derived Bezier keys.
  const { volumeExpression } = require('./export.cjs');
  return '(' + volumeExpression(frames, fallback).replace(/\bt\b/g, '(t-' + numeric(start) + ')') + ')*' + numeric(pixelScale);
}

/**
 * Concat's export loop opens a clip once, pulls sequential frames and composites
 * active layers in track order; this applies that architecture to our FFmpeg
 * process. Actual ported placement lives in concat-placement.cjs. This is not
 * the Rust engine. Audio remains independently planned by export.cjs.
 */
function inspectNativeVideo(options, resolveAsset) {
  const reject = reason => ({ plan: null, reason });
  const { project, width, height, fps, duration } = options || {};
  if (!project || !Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 3840 || height > 3840 || width % 2 || height % 2) return reject('dimensions');
  if (!finite(fps, 1, 60) || !finite(duration, 0.01, 14400)) return reject('timing');
  if (!/^#[a-f0-9]{6}$/i.test(project.background || '')) return reject('background');
  if (!Array.isArray(project.tracks) || !Array.isArray(project.assets) || !Array.isArray(project.clips)) return reject('project');
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  // First FreeCut track is top-most; same-lane clips retain document order.
  const clips = project.tracks.slice().reverse().filter(track => !track.hidden && track.kind !== 'audio')
    .flatMap(track => project.clips.filter(clip => clip.trackId === track.id && clip.kind !== 'audio' && clip.start < duration && clip.start + clip.duration > 0));
  if (clips.length > 64) return reject('layer-count');
  const frames = Math.ceil(duration * fps), inputs = [], graph = [];
  const color = '0x' + project.background.slice(1);
  graph.push('color=c=' + color + ':s=' + width + 'x' + height + ':r=' + numeric(fps) + ',trim=end_frame=' + frames + ',setpts=N/(' + numeric(fps) + '*TB),format=rgba[nativebase]');
  let previous = 'nativebase';
  const pixelScale = width / (finite(project.width, 16, 8192) ? project.width : width);
  const verticalScale = height / (finite(project.height, 16, 8192) ? project.height : height);
  for (const [index, clip] of clips.entries()) {
    const reason = unsupportedVisual(clip);
    if (reason) return reject(reason);
    if (!finite(clip.start, 0, 14400) || !finite(clip.duration, 0.001, 14400) || !aligned(clip.start, fps)) return reject('fractional-cut');
    const end = Math.min(duration, clip.start + clip.duration);
    if (end < duration && !aligned(end, fps)) return reject('fractional-cut');
    const startFrame = Math.round(clip.start * fps), endFrame = end === duration ? frames : Math.round(end * fps);
    const count = endFrame - startFrame;
    if (count <= 0) continue;
    if (!finite(clip.inPoint, 0, 86400) || !finite(clip.speed, 0.05, 20)) return reject('source-time');
    if (clip.kind === 'video' && !aligned(clip.inPoint, fps)) return reject('fractional-in-point');
    const asset = assets.get(clip.assetId);
    if (!asset || asset.missing || asset.kind !== clip.kind) return reject('missing-asset');
    if (clip.kind === 'video' && (!finite(asset.duration, 0, 86400) || clip.inPoint >= asset.duration || clip.inPoint + (end - clip.start) * clip.speed > asset.duration + 0.001)) return reject('source-range');
    if (clip.kind === 'image' && !['.png', '.jpg', '.jpeg', '.bmp'].includes(path.extname(asset.path || '').toLowerCase())) return reject('image-format');
    const media = resolveAsset(asset);
    if (!media || media.kind !== clip.kind || !path.isAbsolute(media.path || '')) return reject('unauthorized-media');
    const sw = asset.width || media.width, sh = asset.height || media.height;
    let placement;
    if (finite(sw, 1, 100000) && finite(sh, 1, 100000)) {
      placement = layerPlacement(width, height, sw, sh, clip.transform, pixelScale, verticalScale);
      if (Math.max(placement.scaledWidth, placement.scaledHeight, placement.rotatedWidth, placement.rotatedHeight) > 8192 ||
          placement.rotatedWidth * placement.rotatedHeight > 33554432) return reject('transform-memory');
    } else if (clip.transform.rotation !== 0 || clip.transform.scale !== 1) return reject('missing-dimensions');
    const inputIndex = inputs.length;
    inputs.push({ path: media.path, kind: clip.kind, seek: clip.kind === 'video' ? clip.inPoint : 0 });
    const length = count / fps, chain = [];
    chain.push(clip.kind === 'image' ? 'trim=duration=' + numeric(length) + ',setpts=PTS-STARTPTS' :
      'trim=duration=' + numeric(length * clip.speed) + ',setpts=(PTS-STARTPTS)/' + numeric(clip.speed));
    chain.push('fps=fps=' + numeric(fps) + ':start_time=0:round=down', 'tpad=stop_mode=clone:stop_duration=' + numeric(length), 'trim=end_frame=' + count);
    chain.push(placement ? 'scale=w=' + placement.scaledWidth + ':h=' + placement.scaledHeight + ':flags=bilinear' :
      'scale=w=' + width + ':h=' + height + ':force_original_aspect_ratio=decrease:flags=bilinear', 'setsar=1', 'format=rgba');
    if (clip.effects?.flipX) chain.push('hflip');
    if (clip.effects?.flipY) chain.push('vflip');
    if (clip.transform.rotation !== 0) chain.push('rotate=' + numeric(placement.rotation) + ':ow=' + placement.rotatedWidth + ':oh=' + placement.rotatedHeight + ':c=none');
    if (clip.transform.opacity !== 1) chain.push('colorchannelmixer=aa=' + numeric(clip.transform.opacity));
    if (clip.fadeIn > 0) chain.push('fade=t=in:st=0:d=' + numeric(clip.fadeIn) + ':alpha=1');
    if (clip.fadeOut > 0) chain.push('fade=t=out:st=' + numeric(clip.duration - clip.fadeOut) + ':d=' + numeric(clip.fadeOut) + ':alpha=1');
    chain.push('settb=AVTB', 'setpts=N/(' + numeric(fps) + '*TB)+' + numeric(clip.start) + '/TB');
    const foreground = 'nativefg' + index, output = 'nativepart' + index;
    graph.push('[' + inputIndex + ':v:0]' + chain.join(',') + '[' + foreground + ']');
    const x = positionExpression(clip.keyframes?.x, clip.transform.x, clip.start, pixelScale);
    const y = positionExpression(clip.keyframes?.y, clip.transform.y, clip.start, verticalScale);
    // Exclusive time boundary prevents framesync repeating over later gaps.
    // Overlay's n counter can advance for secondary frames between main frames;
    // use the presentation clock, not that internal count, to gate layers.
    graph.push('[' + previous + '][' + foreground + "]overlay=x='(W-w)/2+" + x + "':y='(H-h)/2+" + y + "':eval=frame:format=auto:eof_action=pass:repeatlast=0:enable='gte(t," + numeric(startFrame / fps) + ')*lt(t,' + numeric(endFrame / fps) + ")'[" + output + ']');
    previous = output;
  }
  graph.push('[' + previous + ']trim=end_frame=' + frames + ',setpts=N/(' + numeric(fps) + '*TB)[nativevideo]');
  return { plan: { inputs, inputCount: inputs.length, filterGraph: graph.join(';'), videoLabel: 'nativevideo', frames }, reason: null };
}

function planNativeVideo(options, resolveAsset) { return inspectNativeVideo(options, resolveAsset).plan; }
module.exports = { planNativeVideo, inspectNativeVideo, positionExpression };
