'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');

const MEDIA_EXTENSIONS = new Set(['.mp4','.mov','.mkv','.webm','.avi','.m4v','.mpg','.mpeg','.mts','.m2ts','.wav','.mp3','.m4a','.aac','.flac','.ogg','.opus','.wma','.png','.jpg','.jpeg','.gif','.webp','.bmp','.avif']);
const IMAGE_EXTENSIONS = new Set(['.png','.jpg','.jpeg','.gif','.webp','.bmp','.avif']);
const INPUT_SECURITY=['-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,avi,mpeg,mpegts,wav,mp3,aac,flac,ogg,asf,image2,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,gif,avif'];
const MIME = { '.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.m4v':'video/mp4','.mkv':'video/x-matroska','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.flac':'audio/flac','.ogg':'audio/ogg','.opus':'audio/ogg','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.bmp':'image/bmp','.avif':'image/avif' };
const safeError = (message) => new Error(message);
function assertTrustedSender(event, webContents, expectedUrl) {
  if(!webContents || !event || event.sender!==webContents || event.senderFrame!==webContents.mainFrame || event.senderFrame?.url!==expectedUrl)throw safeError('此窗口没有调用桌面功能的权限。');
  return true;
}

function parseProbe(stderr, filePath) {
  const audioLine = stderr.split(/\r?\n/).find((line) => /Stream[^\n]*Audio:/.test(line));
  const audio = Boolean(audioLine);
  const audioChannels = /\bmono\b|\b1 channels?\b/.test(audioLine || '') ? 1 : /\bstereo\b|\b2 channels?\b/.test(audioLine || '') ? 2 : undefined;
  const videoLine = stderr.split(/\r?\n/).find((line) => /Stream[^\n]*Video:/.test(line));
  if (!audio && !videoLine) throw safeError('无法读取此媒体，文件可能损坏或格式不受支持。');
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = match ? Number(match[1])*3600 + Number(match[2])*60 + Number(match[3]) : 0;
  const size = videoLine?.match(/(?:^|[ ,])(\d{2,5})x(\d{2,5})(?:[ ,\[]|$)/);
  const kind = IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()) ? 'image' : videoLine ? 'video' : 'audio';
  if (kind !== 'image' && (!Number.isFinite(duration) || duration <= 0)) throw safeError('无法确定媒体时长。请先转换为本地 MP4、WAV 或 MP3 文件。');
  return { kind, duration: kind === 'image' ? 5 : duration, width: size ? Number(size[1]) : undefined, height: size ? Number(size[2]) : undefined, hasAudio: audio, ...(audioChannels ? { audioChannels } : {}) };
}

function probe(ffmpegPath, filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner','-nostdin',...INPUT_SECURITY,'-i',filePath], { windowsHide: true, stdio: ['ignore','ignore','pipe'] });
    let stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(safeError('读取媒体超时。')); }, 30000);
    child.stderr.on('data', (data) => { stderr = (stderr + data.toString()).slice(-131072); });
    child.on('error', () => { clearTimeout(timeout); reject(safeError('内置 FFmpeg 不可用，请重新安装应用。')); });
    child.on('close', () => { clearTimeout(timeout); try { resolve(parseProbe(stderr, filePath)); } catch (error) { reject(error); } });
  });
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) return false;
  let start, end;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return false; start = Math.max(0, size-suffix); end = size-1; }
  else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size-1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return false;
  return { start, end: Math.min(end, size-1) };
}

function createMediaLibrary(ffmpegPath) {
  const byToken = new Map();
  const byPath = new Map();
  async function importPath(inputPath) {
    if (typeof inputPath !== 'string' || inputPath.length > 32768 || !path.isAbsolute(inputPath)) throw safeError('媒体路径无效。');
    const canonical = await fsp.realpath(inputPath);
    if (!MEDIA_EXTENSIONS.has(path.extname(canonical).toLowerCase())) throw safeError('不支持的媒体文件类型。');
    const stat = await fsp.stat(canonical);
    if (!stat.isFile() || stat.size === 0) throw safeError('媒体文件为空或不是普通文件。');
    if (byPath.has(canonical)) return { ...byPath.get(canonical).asset };
    const info = await probe(ffmpegPath, canonical);
    const token = crypto.randomUUID();
    const asset = { id: crypto.randomUUID(), name: path.basename(canonical), kind: info.kind, url: `freecut-media://asset/${token}`, path: canonical, duration: info.duration, ...(info.width ? { width: info.width, height: info.height } : {}) };
    const record = { asset, canonical, token, hasAudio: info.hasAudio, audioChannels: info.audioChannels };
    byPath.set(canonical, record); byToken.set(token, record);
    return { ...asset };
  }
  function validateMediaPath(inputPath) {
    if (typeof inputPath !== 'string' || !byPath.has(inputPath)) throw safeError('此媒体文件尚未通过导入授权。');
    if(fs.realpathSync(inputPath)!==inputPath || !fs.statSync(inputPath).isFile())throw safeError('媒体文件已移动或发生变更，请重新导入。');
    return byPath.get(inputPath).canonical;
  }
  function resolveAsset(asset) {
    if (!asset || typeof asset.path !== 'string') return null;
    const record = byPath.get(asset.path);
    if (!record) throw safeError(`素材尚未授权或已丢失：${String(asset.name || '未知素材').slice(0,120)}`);
    return { path: validateMediaPath(record.canonical), hasAudio: record.hasAudio, kind: record.asset.kind, audioChannels: record.audioChannels };
  }
  async function handleRequest(request) {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status:405 });
      const url = new URL(request.url);
      if (url.hostname !== 'asset' || url.search || url.hash || !/^\/[a-f0-9-]{36}$/.test(url.pathname)) return new Response('Not found', { status:404 });
      const record = byToken.get(url.pathname.slice(1));
      if (!record) return new Response('Not found', { status:404 });
      // A replaced symlink must not turn a previously authorized path into another file.
      if (await fsp.realpath(record.canonical) !== record.canonical) return new Response('File changed', { status:403 });
      const stat = await fsp.stat(record.canonical);
      if (!stat.isFile()) return new Response('Not found', { status:404 });
      const range = parseRange(request.headers.get('range'), stat.size);
      const headers = { 'Accept-Ranges':'bytes', 'Content-Type':MIME[path.extname(record.canonical).toLowerCase()] || 'application/octet-stream', 'Access-Control-Allow-Origin':'*', 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-store' };
      if (range === false) return new Response(null, { status:416, headers:{ ...headers, 'Content-Range':`bytes */${stat.size}` } });
      const start = range ? range.start : 0, end = range ? range.end : stat.size-1;
      headers['Content-Length'] = String(end-start+1);
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      return new Response(request.method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(record.canonical, { start, end })), { status:range ? 206 : 200, headers });
    } catch { return new Response('Media unavailable', { status:404 }); }
  }
  return { importPath, validateMediaPath, resolveAsset, handleRequest };
}
module.exports = { MEDIA_EXTENSIONS, INPUT_SECURITY, parseProbe, parseRange, createMediaLibrary, assertTrustedSender };
