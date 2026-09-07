'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative));
const json = (relative) => JSON.parse(read(relative).toString('utf8'));
const frames = json('frames.json');
assert.equal(frames.length, 7);
let end = 0;
for (const frame of frames) {
  assert.equal(frame.start, end);
  end += frame.duration;
  const html = read(`compositions/frames/${frame.id}.html`).toString('utf8');
  assert(!/<audio\b|<track\b|el-captions|afdian|390310418|B站/.test(html));
  assert(!/[\u3400-\u9fff]/.test(html.replaceAll('我叫水管同学', '')), `${frame.id} has untranslated on-screen/source text`);
}
assert.equal(end, 55);
const index = read('index.html').toString('utf8');
assert(index.includes('lang="en"') && index.includes('@我叫水管同学'));
assert(!/<audio\b|<track\b|el-captions/.test(index));
const approval = json('SCREENSHOTS-PENDING.json');
assert.equal(approval.status, 'ready', 'Real English UI screenshots have not been approved yet');
assert.equal(approval.renderAllowed, true);
const assets = json('assets/manifest.json');
for (const asset of assets.files) {
  assert(/^assets\/[a-zA-Z0-9/._-]+$/.test(asset.path) && !asset.path.includes('..'));
  const bytes = read(asset.path);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.path);
}
for (const screenshot of ['editor-en.png', 'editor-keyframes-en.png', 'editor-transform-en.png', 'mobile-en.png']) {
  const record = assets.files.find((asset) => asset.path === `assets/${screenshot}`);
  assert(record && record.uiLanguage === 'en' && record.source, `Missing English screenshot provenance: ${screenshot}`);
  const png = read(record.path);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1920, screenshot);
  assert.equal(png.readUInt32BE(20), 1080, screenshot);
}
console.log(JSON.stringify({passed:true,scenes:7,duration:55,audioMounts:0,captionMounts:0,approvedEnglishScreenshots:4},null,2));
