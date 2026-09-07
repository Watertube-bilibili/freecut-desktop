'use strict';
// Read-only source/archive and actual embedded-DLL verification; no installer is run.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const manifest = require('./sources.json');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
for (const source of manifest.sources) {
  const bytes = fs.readFileSync(path.join(__dirname, source.file));
  assert.equal(bytes.length, source.bytes, source.file);
  assert.equal(sha256(bytes), source.sha256, source.file);
}
for (const filename of process.argv.slice(2)) {
  const bytes = fs.readFileSync(filename);
  const signature = bytes.indexOf(Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex'));
  assert(signature >= 4, 'Expected an NSIS firstheader');
  // NSIS 3.04 fileform firstheader is seven DWORDs; nonsolid zlib blocks each
  // store a length DWORD with bit 31 marking raw-deflate compression.
  const firstheader = signature - 4;
  const flags = bytes.readUInt32LE(firstheader);
  const end = firstheader + bytes.readUInt32LE(signature + 20) - (flags & 4 ? 0 : 4);
  let offset = signature + 24;
  const actual = [];
  while (offset + 4 <= end) {
    const word = bytes.readUInt32LE(offset), size = word & 0x7fffffff;
    assert(size > 0 && offset + 4 + size <= end, 'Invalid NSIS data-block extent');
    const block = bytes.subarray(offset + 4, offset + 4 + size);
    const data = word >>> 31 ? zlib.inflateRawSync(block, { maxOutputLength: 16 * 1024 * 1024 }) : block;
    if (data[0] === 0x4d && data[1] === 0x5a) actual.push({ bytes: data.length, sha256: sha256(data) });
    offset += 4 + size;
  }
  assert.deepEqual(actual, manifest.embeddedPlugins.map(({ bytes, sha256 }) => ({ bytes, sha256 })), `Unexpected plugin DLLs in ${filename}`);
  console.log(`Verified ${filename}: System, Nsis7z 19.00, StdUtils 1.14`);
}
console.log(`Verified ${manifest.sources.length} source/reference archives (${manifest.sources.reduce((n, x) => n + x.bytes, 0)} bytes)`);
