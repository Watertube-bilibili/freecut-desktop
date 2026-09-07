'use strict';
// node installer/prepare-payload.cjs --source release/win-unpacked --output .cache/installer-payload --version 0.2.0
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  PRODUCT,
  EMBEDDED_MANIFEST,
  assertNoLinks,
  safeRelative,
  sha256,
  validateManifest,
} = require('./backend.cjs');
async function main() {
  const args = process.argv.slice(2);
  const option = (key) => {
    const index = args.indexOf(key);
    return index < 0 ? undefined : args[index + 1];
  };
  const source = path.resolve(option('--source') ?? 'release/win-unpacked');
  const inPlace = args.includes('--in-place');
  const outputValue = option('--output');
  if (!inPlace && !outputValue) throw Error('An explicit --output directory is required');
  if (inPlace && outputValue) throw Error('--in-place cannot be combined with --output');
  const output = inPlace ? source : path.resolve(outputValue),
    version = option('--version');
  const relativeOutput = path.relative(source, output);
  if (
    !version ||
    (!inPlace &&
      (!relativeOutput ||
        (!relativeOutput.startsWith('..' + path.sep) &&
          relativeOutput !== '..' &&
          !path.isAbsolute(relativeOutput))))
  )
    throw Error('Use a version and an output outside the source application directory');
  await assertNoLinks(source);
  await assertNoLinks(output);
  const application = inPlace ? source : path.join(output, 'application');
  if (inPlace) {
    const helper = path.join(source, 'resources', 'freecut-installer', 'main.cjs');
    await assertNoLinks(helper);
    if (!(await fs.stat(helper)).isFile())
      throw Error('The prepackaged application has no embedded installer');
  } else {
    await fs.mkdir(output); // Never overwrite a previous staging folder silently.
    await fs.mkdir(application);
  }
  const manifestFile = path.join(output, inPlace ? EMBEDDED_MANIFEST : 'manifest.json');
  await assertNoLinks(manifestFile);
  const files = [];
  async function walk(directory, prefix = '') {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const relative = safeRelative(prefix + entry.name),
        file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error(`Payload contains a symbolic link: ${relative}`);
      if (inPlace && relative.toLowerCase() === EMBEDDED_MANIFEST.toLowerCase()) {
        if (!entry.isFile()) throw Error('Embedded manifest must be a regular file');
        continue;
      }
      if (entry.isDirectory()) {
        if (!inPlace) await fs.mkdir(path.join(application, relative), { recursive: true });
        await walk(file, relative + '/');
      } else if (entry.isFile()) {
        const stat = await fs.stat(file);
        if (!inPlace) await fs.copyFile(file, path.join(application, relative));
        files.push({
          path: relative,
          size: stat.size,
          sha256: await sha256(path.join(application, relative)),
        });
      } else throw Error(`Unsupported payload entry: ${relative}`);
    }
  }
  await walk(source);
  const manifest = validateManifest({
    format: 1,
    product: PRODUCT,
    entryPoint: 'FreeCut.exe',
    version,
    files,
  });
  const temporary = manifestFile + '.' + require('node:crypto').randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, JSON.stringify(manifest, null, 2), { flag: 'wx' });
    await fs.rename(temporary, manifestFile);
  } finally {
    await fs.unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  console.log(
    JSON.stringify({
      output,
      manifestFile,
      inPlace,
      version,
      files: files.length,
      bytes: manifest.totalBytes,
    }),
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
