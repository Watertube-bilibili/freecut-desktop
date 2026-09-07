'use strict';
// Recreate this specific visual-only derivative from the adjacent frozen project.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const destination = path.resolve(__dirname, '..');
const source = path.resolve(destination, '..', 'shuiguan-launch');
async function main() {
  const originalAssets = JSON.parse(await fs.readFile(path.join(source, 'assets/manifest.json'), 'utf8'));
  const frozen = originalAssets.files.filter((item) => /\.(?:png|otf|js|txt)$/.test(item.path));
  const frames = JSON.parse(await fs.readFile(path.join(source, 'frames.json'), 'utf8'));
  assert.equal(frames.length, 7);
  assert.equal(frames.reduce((total, frame) => total + frame.duration, 0), 55);
  const files = ['AGENTS.md', 'frame.md', 'hyperframes.json', 'hyperframes.lock.json', 'package.json', 'package-lock.json',
    'compositions/components/logo-sting.html', ...frames.map((frame) => `compositions/frames/${frame.id}.html`),
    ...frozen.map((item) => item.path)];
  const copied = [];
  for (const relative of files) {
    const bytes = await fs.readFile(path.join(source, relative));
    const output = path.join(destination, relative);
    assert(output.startsWith(destination + path.sep));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, bytes);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const known = frozen.find((item) => item.path === relative);
    if (known) assert.equal(sha256, known.sha256, relative);
    copied.push({ path: relative, bytes: bytes.length, sha256 });
  }
  const originalHTML = await fs.readFile(path.join(source, 'index.html'), 'utf8');
  assert.equal((originalHTML.match(/<audio\b/g) || []).length, 8);
  let html = originalHTML.replace(/\s*<audio\b[^>]*>[\s\S]*?<\/audio>/g, '')
    .replace(/\s*<!-- captions -->\s*<div\b[^>]*id="el-captions"[^>]*><\/div>/, '')
    .replace(/\s*<!-- (?:bgm|music|voiceover) -->/gi, '')
    .replace('<html lang="en">', '<html lang="zh-CN">');
  assert(!/<audio\b|el-captions|compositions\/captions\.html/.test(html));
  assert.equal((html.match(/data-composition-src="compositions\/frames\//g) || []).length, 7);
  await fs.writeFile(path.join(destination, 'index.html'), html);
  for (const name of ['package.json', 'package-lock.json']) {
    const file = path.join(destination, name);
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    value.name = 'shuiguan-launch-instrumental';
    if (value.packages?.['']) value.packages[''].name = value.name;
    if (name === 'package.json') delete value.scripts.publish;
    await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
  }
  await fs.writeFile(path.join(destination, 'meta.json'), JSON.stringify({id:'shuiguan-launch-instrumental',name:'水管剪辑 · 无声无逐句字幕版'}, null, 2) + '\n');
  let start = 0;
  const visualFrames = frames.map(({ phrases, ...frame }) => { const value={...frame,start}; start += frame.duration; return value; });
  await fs.writeFile(path.join(destination, 'frames.json'), JSON.stringify(visualFrames, null, 2) + '\n');
  await fs.writeFile(path.join(destination, 'assets/manifest.json'), JSON.stringify({ files: frozen }, null, 2) + '\n');
  await fs.writeFile(path.join(destination, 'SOURCE-PROVENANCE.json'), JSON.stringify({
    sourceProject: '../shuiguan-launch', sourceIndexSha256: crypto.createHash('sha256').update(originalHTML).digest('hex'),
    operation: 'Remove all eight audio clips and the el-captions composition mount; retain seven visual scenes and watermark.',
    copied,
  }, null, 2) + '\n');
  await fs.copyFile(path.resolve(destination, '../..', 'LICENSE'), path.join(destination, 'LICENSE-GPL-3.0.txt'));
  await fs.mkdir(path.join(destination, 'renders'), { recursive: true });
  console.log(JSON.stringify({ destination, sceneCount: 7, duration: 55, copiedFiles: files.length, copiedAudio: 0, subtitleMounts: 0 }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
