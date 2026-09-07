'use strict';
const path = require('node:path');

const visualDefaults = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
const effectDefaults = {
  brightness: 1, contrast: 1, saturation: 1, hue: 0, blur: 0, grayscale: 0,
  sepia: 0, vignette: 0, pixelate: 0, chroma: false, flipX: false, flipY: false,
  mask: 'none',
};
const inactiveEffectOptions = new Set([
  'chromaColor', 'chromaThreshold', 'maskSize', 'maskX', 'maskY',
  'maskRotation', 'maskFeather', 'maskInvert',
]);
const number = value => String(Number(value.toFixed(8)));
const aligned = (time, fps) => Math.abs(time * fps - Math.round(time * fps)) < 1e-7;

function simpleVisual(clip) {
  if (!['video', 'image'].includes(clip.kind) || clip.fadeIn !== 0 || clip.fadeOut !== 0) return false;
  if (!clip.transform || Object.entries(visualDefaults).some(([key, value]) => clip.transform[key] !== value)) return false;
  if (Object.entries(clip.transform).some(([key]) => !(key in visualDefaults) && key !== 'volume')) return false;
  if (Object.entries(clip.keyframes || {}).some(([key, values]) => key !== 'volume' && (!Array.isArray(values) || values.length))) return false;
  const effects = clip.effects || {};
  if (Object.entries(effectDefaults).some(([key, value]) => (effects[key] ?? value) !== value)) return false;
  return Object.keys(effects).every(key => key in effectDefaults || inactiveEffectOptions.has(key));
}

/**
 * Direct FFmpeg composition for the deliberately narrow, ordinary-cut subset.
 * Returning null means that the shared Canvas renderer must supply the frames.
 * Input paths never enter the filter graph; the caller must retain media.cjs's
 * INPUT_SECURITY arguments. Each image input needs `-loop 1` before `-i`.
 * Audio planning starts at inputCount and remains independent of hidden video.
 */
function planNativeVideo(options, resolveAsset) {
  const { project, width, height, fps, duration } = options || {};
  if (!project || !Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 3840 || height > 3840 || width % 2 || height % 2) return null;
  if (!Number.isFinite(fps) || fps < 1 || fps > 60 || !Number.isFinite(duration) || duration <= 0 || duration > 14400) return null;
  if (!/^#[a-f0-9]{6}$/i.test(project.background || '')) return null;
  if (!Array.isArray(project.tracks) || !Array.isArray(project.assets) || !Array.isArray(project.clips)) return null;
  const tracks = new Map(project.tracks.map(track => [track.id, track]));
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const clips = project.clips.filter(clip => {
    const track = tracks.get(clip.trackId);
    return track && !track.hidden && track.kind !== 'audio' && clip.kind !== 'audio' && clip.start < duration && clip.start + clip.duration > 0;
  }).sort((a, b) => a.start - b.start);
  // Bound open decoders and filter graph size; larger edits use the stream path.
  if (clips.length > 64) return null;
  const frames = Math.ceil(duration * fps), segments = [], inputs = [];
  let cursor = 0;
  for (const clip of clips) {
    if (!simpleVisual(clip) || !Number.isFinite(clip.start) || clip.start < 0 || !Number.isFinite(clip.duration) || clip.duration <= 0 || !aligned(clip.start, fps)) return null;
    const end = Math.min(duration, clip.start + clip.duration);
    if (end < duration && !aligned(end, fps)) return null;
    const startFrame = Math.round(clip.start * fps), endFrame = end === duration ? frames : Math.round(end * fps);
    if (startFrame < cursor) return null; // Layering and transitions are never flattened silently.
    if (endFrame <= startFrame) continue;
    if (!Number.isFinite(clip.inPoint) || clip.inPoint < 0 || !Number.isFinite(clip.speed) || clip.speed < 0.05 || clip.speed > 20) return null;
    if (clip.kind === 'video' && !aligned(clip.inPoint, fps)) return null;
    const asset = assets.get(clip.assetId);
    if (!asset || asset.missing || asset.kind !== clip.kind) return null;
    if (clip.kind === 'video' && (!Number.isFinite(asset.duration) || clip.inPoint >= asset.duration || clip.inPoint + (end - clip.start) * clip.speed > asset.duration + 0.001)) return null;
    // Animated images and formats with browser-dependent orientation/color
    // handling remain on the shared renderer until separately verified.
    if (clip.kind === 'image' && !['.png', '.jpg', '.jpeg', '.bmp'].includes(path.extname(asset.path || '').toLowerCase())) return null;
    const media = resolveAsset(asset); // Authorization errors must propagate.
    if (!media || media.kind !== clip.kind || !path.isAbsolute(media.path || '')) return null;
    if (startFrame > cursor) segments.push({ frames: startFrame - cursor });
    inputs.push({ path: media.path, kind: clip.kind });
    segments.push({ frames: endFrame - startFrame, clip, input: inputs.length - 1 });
    cursor = endFrame;
  }
  if (cursor < frames) segments.push({ frames: frames - cursor });
  const graph = [], labels = [];
  const color = `0x${project.background.slice(1)}`;
  for (const [index, segment] of segments.entries()) {
    const label = `nativepart${index}`, count = segment.frames;
    const background = `color=c=${color}:s=${width}x${height}:r=${number(fps)},trim=end_frame=${count},setpts=N/(${number(fps)}*TB),format=rgba`;
    if (!segment.clip) graph.push(`${background}[${label}]`);
    else {
      const { clip, input } = segment;
      const length = count / fps;
      graph.push(`${background}[nativebg${index}]`);
      const trim = clip.kind === 'image'
        ? `trim=duration=${number(length)},setpts=PTS-STARTPTS`
        : `trim=start=${number(clip.inPoint)}:duration=${number(length * clip.speed)},setpts=(PTS-STARTPTS)/${number(clip.speed)}`;
      graph.push(`[${input}:v:0]${trim},fps=fps=${number(fps)}:start_time=0:round=down,tpad=stop_mode=clone:stop_duration=${number(length)},trim=end_frame=${count},scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:flags=bilinear,setsar=1,format=rgba[nativefg${index}]`);
      graph.push(`[nativebg${index}][nativefg${index}]overlay=x=(W-w)/2:y=(H-h)/2:format=auto:eof_action=pass:shortest=1,trim=end_frame=${count},setsar=1,setpts=N/(${number(fps)}*TB)[${label}]`);
    }
    labels.push(`[${label}]`);
  }
  graph.push(labels.length === 1
    ? `${labels[0]}null[nativevideo]`
    : `${labels.join('')}concat=n=${labels.length}:v=1:a=0,fps=fps=${number(fps)},trim=end_frame=${frames},setpts=N/(${number(fps)}*TB)[nativevideo]`);
  return { inputs, inputCount: inputs.length, filterGraph: graph.join(';'), videoLabel: 'nativevideo', frames };
}

module.exports = { planNativeVideo };
