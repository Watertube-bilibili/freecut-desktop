'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const LIMITS = { count: 64, each: 32 * 1024 * 1024, total: 128 * 1024 * 1024 };
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function isRasterPng(bytes, width, height) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 57 || bytes.byteLength > LIMITS.each) return false;
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!data.subarray(0, 8).equals(PNG)) return false;
  let position = 8, header = false, pixels = false;
  while (position + 12 <= data.length) {
    const size = data.readUInt32BE(position), type = data.toString('ascii', position + 4, position + 8);
    if (size > data.length - position - 12) return false;
    if (!header) {
      if (type !== 'IHDR' || size !== 13 || data.readUInt32BE(position + 8) !== width || data.readUInt32BE(position + 12) !== height) return false;
      if (data[position + 16] !== 8 || ![2, 6].includes(data[position + 17]) || data[position + 18] || data[position + 19] || data[position + 20]) return false;
      header = true;
    } else if (type === 'IHDR' || type === 'acTL') return false;
    if (type === 'IDAT' && size > 0) pixels = true;
    position += size + 12;
    if (type === 'IEND') return size === 0 && pixels && position === data.length;
  }
  return false;
}

function validateRasterLayers(options) {
  const layers = options.rasterLayers;
  if (layers === undefined) return [];
  if (!Array.isArray(layers) || layers.length > LIMITS.count) throw Error('文字图片数量超出导出限制。');
  const clips = new Map(options.project.clips.map(clip => [clip.id, clip]));
  const seen = new Set();
  let total = 0;
  for (const layer of layers) {
    const clip = clips.get(layer?.clipId);
    if (!clip || !['text', 'shape'].includes(clip.kind) || seen.has(layer.clipId)) throw Error('文字图片引用了无效或重复的片段。');
    if (!isRasterPng(layer.bytes, options.width, options.height)) throw Error('文字图片尺寸或 PNG 格式无效。');
    total += layer.bytes.byteLength;
    if (total > LIMITS.total) throw Error('文字图片总大小超出导出限制。');
    seen.add(layer.clipId);
  }
  return layers;
}

async function prepareRasterLayers(options, directory, resolveAsset) {
  const layers = validateRasterLayers(options);
  if (!layers.length) return { options, resolveAsset };
  const replacements = new Map(), owned = new Map();
  for (const layer of layers) {
    const clip = options.project.clips.find(item => item.id === layer.clipId);
    // The Canvas renderer applies these radii in screen space; transforming a
    // baked texture changes their meaning. Text's background and glyphs also
    // receive globalAlpha independently, so flattening before a fade changes
    // overlap alpha. Leave the original clip in place to select exact frames.
    if (clip.effects?.blur > 0 || clip.effects?.maskFeather > 0 || clip.effects?.vignette > 0 ||
        (clip.kind === 'text' && (clip.text?.stroke || (clip.text?.background && clip.text.background !== 'transparent')) &&
         (clip.transform.opacity !== 1 || clip.fadeIn > 0 || clip.fadeOut > 0 || clip.keyframes?.opacity?.length))) continue;
    const id = crypto.randomUUID(), destination = path.join(directory, `raster-${id}.png`);
    await fs.writeFile(destination, layer.bytes, { flag: 'wx' });
    const asset = { id, name: 'Export raster', kind: 'image', path: destination,
      duration: options.duration, width: options.width, height: options.height };
    replacements.set(layer.clipId, asset);
    owned.set(id, asset);
  }
  const project = { ...options.project, assets: [...options.project.assets, ...owned.values()],
    clips: options.project.clips.map(clip => {
      const raster = replacements.get(clip.id);
      return raster ? { ...clip, kind: 'image', assetId: raster.id, inPoint: 0, speed: 1, effects: {} } : clip;
    }) };
  return { options: { ...options, project }, resolveAsset: asset => {
    const raster = owned.get(asset.id);
    if (!raster) return resolveAsset(asset);
    if (asset !== raster || asset.path !== raster.path) throw Error('导出图片授权无效。');
    return { kind: 'image', path: raster.path, hasAudio: false };
  } };
}

module.exports = { validateRasterLayers, prepareRasterLayers, isRasterPng, LIMITS };
