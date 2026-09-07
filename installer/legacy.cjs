'use strict';

// Identify our pre-manifest Electron installations without loading or executing
// any old JavaScript. Only fixed, bounded ASAR entries are read. A directory name
// or an arbitrary file called FreeCut.exe is not sufficient evidence.
const path = require('node:path');
const nativeFs = process.versions.electron ? require('original-fs') : require('node:fs');
const fs = nativeFs.promises;
const MAX_HEADER = 32 * 1024 * 1024;

async function readExactly(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) throw Error('旧版程序文件不完整。');
    offset += bytesRead;
  }
  return buffer;
}

async function identifyLegacy(target, assertNoLinks) {
  const executable = path.join(target, 'FreeCut.exe');
  const archive = path.join(target, 'resources', 'app.asar');
  let exe, asar;
  try {
    await assertNoLinks(executable);
    await assertNoLinks(archive);
    exe = await fs.open(executable, 'r');
    const exeStat = await exe.stat();
    if (!exeStat.isFile() || exeStat.size < 88) return null;
    const dos = await readExactly(exe, 64, 0);
    if (dos.toString('ascii', 0, 2) !== 'MZ') return null;
    const peOffset = dos.readUInt32LE(60);
    if (peOffset < 64 || peOffset > exeStat.size - 24) return null;
    const pe = await readExactly(exe, 24, peOffset);
    if (pe.readUInt32LE(0) !== 0x4550 || ![0x14c, 0x8664, 0xaa64].includes(pe.readUInt16LE(4)))
      return null;
    const sections = pe.readUInt16LE(6),
      optionalSize = pe.readUInt16LE(20);
    if (
      sections < 1 ||
      sections > 96 ||
      optionalSize < 224 ||
      peOffset + 24 + optionalSize + sections * 40 > exeStat.size ||
      !(pe.readUInt16LE(22) & 2) ||
      pe.readUInt16LE(22) & 0x2000
    )
      return null;
    const optional = await readExactly(exe, 2, peOffset + 24);
    if (![0x10b, 0x20b].includes(optional.readUInt16LE(0))) return null;
    asar = await fs.open(archive, 'r');
    const stat = await asar.stat();
    if (!stat.isFile() || stat.size < 16) return null;
    const prefix = await readExactly(asar, 16, 0);
    const headerSize = prefix.readUInt32LE(4),
      jsonSize = prefix.readUInt32LE(12);
    if (
      prefix.readUInt32LE(0) !== 4 ||
      headerSize < 8 ||
      headerSize > MAX_HEADER ||
      headerSize > stat.size - 8 ||
      prefix.readUInt32LE(8) !== headerSize - 4 ||
      jsonSize < 2 ||
      jsonSize > headerSize - 8
    )
      return null;
    const header = JSON.parse((await readExactly(asar, jsonSize, 16)).toString('utf8'));
    const fileEntry = (relative) => {
      let entry = header;
      for (const part of relative.split('/')) {
        if (!entry?.files || !Object.hasOwn(entry.files, part)) return null;
        entry = entry.files[part];
      }
      if (
        !entry ||
        entry.link ||
        entry.unpacked ||
        !Number.isSafeInteger(entry.size) ||
        entry.size <= 0 ||
        !/^\d+$/.test(entry.offset)
      )
        return null;
      const offset = Number(entry.offset),
        end = 8 + headerSize + offset + entry.size;
      return Number.isSafeInteger(offset) && Number.isSafeInteger(end) && end <= stat.size
        ? entry
        : null;
    };
    const packageEntry = fileEntry('package.json');
    if (
      !packageEntry ||
      packageEntry.size > 64 * 1024 ||
      !fileEntry('electron/main.cjs') ||
      !fileEntry('electron/preload.cjs') ||
      !fileEntry('dist/index.html')
    )
      return null;
    const metadata = JSON.parse(
      (
        await readExactly(asar, packageEntry.size, 8 + headerSize + Number(packageEntry.offset))
      ).toString('utf8'),
    );
    if (
      metadata.name !== 'freecut-desktop' ||
      metadata.main !== 'electron/main.cjs' ||
      typeof metadata.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(metadata.version)
    )
      return null;
    return { version: metadata.version, method: 'freecut-electron-asar' };
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code) || error instanceof SyntaxError) return null;
    // Invalid/short archives do not become a reason to overwrite an unknown app.
    if (error.message === '旧版程序文件不完整。') return null;
    throw error;
  } finally {
    await exe?.close();
    await asar?.close();
  }
}

module.exports = { identifyLegacy };
