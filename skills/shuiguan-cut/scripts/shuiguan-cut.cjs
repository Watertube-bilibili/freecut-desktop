#!/usr/bin/env node
'use strict';
// Automates the real FreeCut desktop application. Only native file dialogs are
// redirected; media authorization, project opening and Canvas/FFmpeg export run
// through the product. No render implementation is duplicated in this skill.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire, Module } = require('node:module');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const execute = promisify(execFile);
const uid = () => crypto.randomUUID();
const help = `Waterpipe Cut / 水管剪辑 AI bridge (Node.js 22+)
  node shuiguan-cut.cjs doctor --repo PATH [--exe INSTALLED_EXECUTABLE]
  node shuiguan-cut.cjs edit-render --repo PATH --recipe FILE --out-dir NEW_DIRECTORY [--exe EXECUTABLE] [--timeout SECONDS]
  node shuiguan-cut.cjs demo --repo PATH --out-dir NEW_DIRECTORY [--exe EXECUTABLE]
Outputs: project.freecut, render.mp4, preview.png, recipe.json, report.json.
No downloads, existing window attachment, or overwrite. Recipe paths resolve relative to the recipe file.`;

function options(argv) {
  const [command, ...args] = argv;
  if (!command || command === '--help') return { command: 'help' };
  assert(['doctor', 'edit-render', 'demo'].includes(command), `Unknown command: ${command}`);
  const out = { command };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    assert(
      ['--repo', '--recipe', '--out-dir', '--exe', '--timeout'].includes(key),
      `Unknown option: ${key}`,
    );
    assert(args[i + 1] && !args[i + 1].startsWith('--'), `Missing value for ${key}`);
    assert(!(key.slice(2) in out), `Repeated option: ${key}`);
    out[key.slice(2)] = args[i + 1];
  }
  assert(out.repo, '--repo is required');
  if (command !== 'doctor') assert(out['out-dir'], '--out-dir is required');
  if (command === 'edit-render') assert(out.recipe, '--recipe is required');
  out.timeout = out.timeout === undefined ? 900 : Number(out.timeout);
  assert(
    Number.isFinite(out.timeout) && out.timeout >= 30 && out.timeout <= 86400,
    'Timeout must be 30–86400 seconds',
  );
  return out;
}
const object = (value, label) => {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value;
};
function keys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value))
    assert(allowed.includes(key), `Unsupported ${label}.${key}`);
}
function number(value, min, max, label) {
  assert(
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max,
    `${label} must be ${min}..${max}`,
  );
  return value;
}
async function environment(opts) {
  assert(Number(process.versions.node.split('.')[0]) >= 22, 'Node.js 22 or newer is required');
  const repo = await fs.realpath(path.resolve(opts.repo));
  const requireRepo = createRequire(path.join(repo, 'package.json'));
  const pkg = requireRepo('./package.json');
  const exe = opts.exe ? await fs.realpath(path.resolve(opts.exe)) : requireRepo('electron');
  const ffmpeg = path.join(
    opts.exe
      ? process.platform === 'darwin'
        ? path.resolve(path.dirname(exe), '..', 'Resources')
        : path.join(path.dirname(exe), 'resources')
      : path.join(repo, 'resources'),
    'ffmpeg',
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
  );
  for (const file of [
    exe,
    ffmpeg,
    path.join(repo, 'src/core/project.ts'),
    ...(opts.exe ? [] : [path.join(repo, 'dist/index.html')]),
  ])
    assert((await fs.stat(file)).isFile(), `Missing prerequisite: ${file}`);
  const ts = requireRepo('typescript');
  const sourceFile = path.join(repo, 'src/core/project.ts');
  const code = ts.transpileModule(await fs.readFile(sourceFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const coreModule = new Module(sourceFile);
  coreModule.filename = sourceFile;
  coreModule.paths = Module._nodeModulePaths(path.dirname(sourceFile));
  coreModule._compile(code, sourceFile);
  const { stdout } = await execute(ffmpeg, ['-version'], { windowsHide: true, timeout: 15000 });
  const { _electron, expect } = requireRepo('@playwright/test');
  return {
    repo,
    pkg,
    exe,
    ffmpeg,
    core: coreModule.exports,
    _electron,
    expect,
    ffmpegVersion: stdout.split(/\r?\n/)[0],
  };
}
async function readRecipe(file) {
  const stat = await fs.stat(file);
  assert(stat.isFile() && stat.size <= 4 * 1024 * 1024, 'Recipe must be a JSON file under 4 MB');
  const recipe = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  keys(recipe, ['version', 'name', 'canvas', 'assets', 'clips', 'export'], 'recipe');
  assert.equal(recipe.version, 1, 'Recipe version must be 1');
  assert(typeof recipe.name === 'string' && recipe.name.trim(), 'Recipe name is required');
  keys(recipe.canvas ?? {}, ['width', 'height', 'fps', 'background'], 'canvas');
  keys(recipe.export ?? {}, ['height', 'fps', 'quality'], 'export');
  assert(
    Array.isArray(recipe.assets) && recipe.assets.length <= 100,
    'assets must be an array of at most 100 local files',
  );
  assert(
    Array.isArray(recipe.clips) && recipe.clips.length > 0 && recipe.clips.length <= 1000,
    'clips must contain 1–1000 items',
  );
  const assetIds = new Set();
  for (const asset of recipe.assets) {
    keys(asset, ['id', 'path'], 'asset');
    assert(
      typeof asset.id === 'string' && asset.id.length > 0 && !assetIds.has(asset.id),
      'Asset IDs must be unique strings',
    );
    assetIds.add(asset.id);
    assert(
      typeof asset.path === 'string' && asset.path && !/^[a-z]+:\/\//i.test(asset.path),
      'Only local media file paths are supported',
    );
    asset.path = await fs.realpath(path.resolve(path.dirname(file), asset.path));
    assert((await fs.stat(asset.path)).isFile(), `Not a media file: ${asset.path}`);
  }
  return recipe;
}
function compileRecipe(recipe, assets, core) {
  const project = { ...core.createProject(), ...recipe.canvas, name: recipe.name, assets };
  const imported = new Map(recipe.assets.map((asset, index) => [asset.id, assets[index]]));
  const tracks = new Map();
  project.clips = recipe.clips.map((item, index) => {
    const label = `clips[${index}]`;
    keys(
      item,
      [
        'id',
        'name',
        'asset',
        'kind',
        'start',
        'duration',
        'inPoint',
        'speed',
        'layer',
        'transform',
        'keyframes',
        'text',
        'style',
        'color',
        'fadeIn',
        'fadeOut',
        'audio',
      ],
      label,
    );
    const asset = item.asset === undefined ? undefined : imported.get(item.asset);
    assert(item.asset === undefined || asset, `Unknown media asset: ${item.asset}`);
    assert(
      asset || ['text', 'shape'].includes(item.kind),
      `${label} requires asset or kind text/shape`,
    );
    assert(
      !asset || item.kind === undefined || item.kind === asset.kind,
      `${label}.kind disagrees with imported media`,
    );
    const kind = asset?.kind ?? item.kind;
    assert(
      kind === 'shape' || item.color === undefined,
      'color applies only to shape clips; text color belongs in style.color',
    );
    const layer = number(item.layer ?? (kind === 'text' ? 10 : 0), 0, 99, `${label}.layer`);
    assert(Number.isInteger(layer), 'layer must be an integer');
    const trackId = `${kind === 'audio' ? 'audio' : 'visual'}-${layer}`;
    tracks.set(trackId, {
      id: trackId,
      name: `${kind === 'audio' ? '音频' : '画面'} ${layer}`,
      kind: kind === 'audio' ? 'audio' : layer > 0 ? 'overlay' : 'video',
      muted: false,
      hidden: false,
      locked: false,
      layer,
    });
    const speed = number(item.speed ?? 1, 0.25, 4, `${label}.speed`);
    const inPoint = number(item.inPoint ?? 0, 0, 86400, `${label}.inPoint`);
    const duration = number(
      item.duration ?? (asset && kind !== 'image' ? (asset.duration - inPoint) / speed : 5),
      0.001,
      86400,
      `${label}.duration`,
    );
    if (asset && kind !== 'image')
      assert(
        inPoint + duration * speed <= asset.duration + 0.05,
        `${label} extends past the media duration ${asset.duration}s`,
      );
    keys(
      item.transform ?? {},
      ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'],
      `${label}.transform`,
    );
    keys(
      item.keyframes ?? {},
      ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'],
      `${label}.keyframes`,
    );
    keys(
      item.style ?? {},
      ['fontSize', 'color', 'background', 'align', 'bold', 'stroke'],
      `${label}.style`,
    );
    if (item.audio)
      keys(item.audio, ['pan', 'leftGain', 'rightGain', 'channelMode'], `${label}.audio`);
    if (kind === 'text')
      assert(typeof item.text === 'string' && item.text.length > 0, `${label}.text is required`);
    else
      assert(
        item.text === undefined && item.style === undefined,
        'text/style apply only to text clips',
      );
    const keyframes = Object.fromEntries(
      Object.entries(item.keyframes ?? {}).map(([prop, points]) => {
        assert(Array.isArray(points), `${label}.keyframes.${prop} must be an array`);
        const times = new Set();
        return [
          prop,
          points.map((point) => {
            keys(point, ['time', 'value', 'easing'], 'keyframe');
            assert(!times.has(point.time), 'Duplicate keyframe time');
            times.add(point.time);
            return {
              id: uid(),
              time: point.time,
              value: point.value,
              easing: point.easing ?? 'linear',
            };
          }),
        ];
      }),
    );
    return core.createClip(kind, trackId, {
      id: item.id ?? uid(),
      name: item.name ?? asset?.name ?? (kind === 'text' ? item.text.slice(0, 30) : '色块'),
      ...(asset ? { assetId: asset.id } : {}),
      start: item.start ?? 0,
      duration,
      inPoint,
      speed,
      transform: item.transform,
      keyframes,
      fadeIn: item.fadeIn ?? 0,
      fadeOut: item.fadeOut ?? 0,
      ...(kind === 'text' ? { text: { ...item.style, text: item.text } } : {}),
      ...(kind === 'shape' ? { color: item.color ?? '#78e4bc' } : {}),
      ...(item.audio
        ? { audio: { pan: 0, leftGain: 1, rightGain: 1, channelMode: 'stereo', ...item.audio } }
        : {}),
    });
  });
  project.tracks = [...tracks.values()]
    .sort((a, b) => b.layer - a.layer)
    .map(({ layer, ...track }) => track);
  return core.validateProject(project);
}
async function editRender(opts, env, recipe, directory) {
  const { _electron, expect, core } = env;
  const work = path.join(directory, '.session'),
    profile = path.join(work, 'profile');
  await fs.mkdir(profile, { recursive: true });
  const input = path.join(work, 'input.freecut'),
    saved = path.join(directory, 'project.freecut'),
    output = path.join(directory, 'render.mp4');
  const processEnv = { ...process.env };
  // Scope this to our isolated instance; never alter the user's saved preference.
  processEnv.FREECUT_DISABLE_UPDATES = '1';
  for (const key of [
    'ELECTRON_RUN_AS_NODE',
    'PORTABLE_EXECUTABLE_DIR',
    'PORTABLE_EXECUTABLE_FILE',
    'PORTABLE_EXECUTABLE_APP_FILENAME',
  ])
    delete processEnv[key];
  const report = {
    passed: false,
    software: '水管剪辑',
    engine: 'Product Canvas renderer + product FFmpeg exporter',
    directory,
    project: saved,
    output,
    sourceVersion: env.pkg.version,
    startedAt: new Date().toISOString(),
    rendererErrors: [],
  };
  let app, page;
  try {
    const bootstrap = path.join(work, 'launch.cjs');
    if (!opts.exe)
      await fs.writeFile(
        bootstrap,
        `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(env.repo, 'electron/main.cjs'))});\n`,
      );
    app = await _electron.launch({
      executablePath: env.exe,
      args: [...(opts.exe ? [] : [bootstrap]), `--user-data-dir=${profile}`],
      cwd: env.repo,
      env: processEnv,
      timeout: 45000,
    });
    const runtime = await app.evaluate(({ app }) => ({
      version: app.getVersion(),
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
      packaged: app.isPackaged,
      updatesDisabled: process.env.FREECUT_DISABLE_UPDATES === '1',
    }));
    for (const value of [runtime.userData, runtime.sessionData]) {
      const relative = path.relative(profile, value);
      assert(
        !relative.startsWith('..') && !path.isAbsolute(relative),
        'Application did not isolate its profile; refusing automation',
      );
    }
    report.runtime = runtime;
    assert(
      runtime.updatesDisabled,
      'Automatic updates must be disabled for this automation instance',
    );
    await app.evaluate(({ dialog }) => {
      globalThis.__shuiguanDialogs = { open: [], save: [], warnings: [] };
      dialog.showOpenDialog = async () => {
        const filePaths = globalThis.__shuiguanDialogs.open.shift();
        if (!filePaths) throw Error('Unplanned open dialog');
        return { canceled: false, filePaths };
      };
      dialog.showSaveDialog = async () => {
        const filePath = globalThis.__shuiguanDialogs.save.shift();
        if (!filePath) throw Error('Unplanned save dialog');
        return { canceled: false, filePath };
      };
      dialog.showMessageBox = async (_, config) => {
        globalThis.__shuiguanDialogs.warnings.push(config.message);
        return { response: config.cancelId ?? 0, checkboxChecked: false };
      };
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (error) => report.rendererErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.getByRole('button', { name: /^新建项目/ }).click();
    const skip = page.getByRole('button', { name: '跳过引导', exact: true });
    if (await skip.count()) await skip.click();
    const info = await page.evaluate(() => window.freecut.getInfo());
    assert.equal(
      info.version,
      env.pkg.version,
      'Installed executable and source repository versions must match',
    );
    assert(info.ffmpeg, 'Product cannot access its FFmpeg');
    report.app = info;
    const updateState = await page.evaluate(() => window.freecut.updateState());
    assert.equal(
      updateState.phase,
      'disabled',
      'Product updater was not disabled for this isolated run',
    );
    // This is the same public IPC used by the import button. Native media probe
    // and access grants remain entirely in the product process.
    let assets = [];
    if (recipe.assets.length) {
      await app.evaluate(
        (_, files) => globalThis.__shuiguanDialogs.open.push(files),
        recipe.assets.map((asset) => asset.path),
      );
      assets = await page.evaluate(() => window.freecut.importMedia());
      assert.equal(assets.length, recipe.assets.length, 'Product did not import every asset');
    }
    const project = compileRecipe(recipe, assets, core);
    const duration = core.durationOf(project);
    const exportSettings = {
      height: recipe.export?.height ?? 720,
      fps: recipe.export?.fps ?? project.fps,
      quality: recipe.export?.quality ?? 'high',
    };
    assert(
      [720, 1080, 2160].includes(exportSettings.height),
      'Export height must be 720, 1080 or 2160',
    );
    assert([24, 25, 30, 50, 60].includes(exportSettings.fps), 'Export fps must be 24,25,30,50,60');
    assert(
      ['high', 'medium'].includes(exportSettings.quality),
      'Export quality must be high or medium',
    );
    const exportFactor = exportSettings.height / Math.min(project.width, project.height);
    const expectedWidth = Math.round((project.width * exportFactor) / 2) * 2;
    const expectedHeight = Math.round((project.height * exportFactor) / 2) * 2;
    assert(
      expectedWidth <= 3840 && expectedHeight <= 3840,
      'This aspect ratio and resolution exceed the product 3840-pixel export limit',
    );
    await fs.writeFile(input, JSON.stringify(project, null, 2), { flag: 'wx' });
    await fs.writeFile(path.join(directory, 'recipe.json'), JSON.stringify(recipe, null, 2), {
      flag: 'wx',
    });
    await app.evaluate((_, file) => globalThis.__shuiguanDialogs.open.push([file]), input);
    await page.getByTitle('打开工程 Ctrl+O', { exact: true }).click();
    await expect(page.getByLabel('工程名称', { exact: true })).toHaveValue(project.name);
    await expect(page.locator('.timeline-clip')).toHaveCount(project.clips.length);
    await app.evaluate((_, file) => globalThis.__shuiguanDialogs.save.push(file), saved);
    await page.getByTitle('保存工程 Ctrl+S', { exact: true }).click();
    await expect
      .poll(() =>
        fs.stat(saved).then(
          (stat) => stat.size,
          () => 0,
        ),
      )
      .toBeGreaterThan(0);
    const savedProject = JSON.parse(await fs.readFile(saved, 'utf8'));
    assert(
      !savedProject.assets.some((asset) => asset.missing),
      'A media file became missing while opening the project',
    );
    assert.equal(savedProject.clips.length, project.clips.length);
    await page
      .getByLabel('视频预览', { exact: true })
      .screenshot({ path: path.join(work, 'canvas-at-open.png') });
    await app.evaluate((_, file) => globalThis.__shuiguanDialogs.save.push(file), output);
    await page.locator('.export-trigger').click();
    const dialog = page.locator('.export-dialog');
    await dialog.getByRole('combobox').nth(0).selectOption(String(exportSettings.height));
    await dialog.getByRole('combobox').nth(1).selectOption(String(exportSettings.fps));
    await dialog.getByRole('combobox').nth(2).selectOption(exportSettings.quality);
    await dialog.getByRole('button', { name: '选择保存位置并导出', exact: true }).click();
    await page.getByText('视频已保存', { exact: true }).waitFor({ timeout: opts.timeout * 1000 });
    assert((await fs.stat(output)).size > 1000, 'Empty exported video');
    const decoded = await execute(
      env.ffmpeg,
      ['-hide_banner', '-nostdin', '-xerror', '-i', output, '-f', 'null', '-'],
      { windowsHide: true, timeout: opts.timeout * 1000, maxBuffer: 1024 * 1024 },
    );
    const { createMediaLibrary } = createRequire(path.join(env.repo, 'package.json'))(
      './electron/media.cjs',
    );
    const metadata = await createMediaLibrary(env.ffmpeg).importPath(output);
    assert(
      Math.abs(metadata.duration - duration) <= Math.max(0.15, 2 / exportSettings.fps),
      'Exported duration does not match the project',
    );
    assert.equal(
      metadata.width,
      expectedWidth,
      'Exported width does not match the project aspect ratio',
    );
    assert.equal(
      metadata.height,
      expectedHeight,
      'Exported height does not match the project aspect ratio',
    );
    const videoStream = decoded.stderr.split(/\r?\n/).find((line) => /Stream.*Video:/.test(line));
    const actualFps = Number(videoStream?.match(/\b([\d.]+) fps\b/)?.[1]);
    assert.equal(
      actualFps,
      exportSettings.fps,
      'Exported frame rate does not match the selected frame rate',
    );
    // A frame decoded from the completed product export is also useful when
    // the asynchronous interactive preview was not ready at the open instant.
    await execute(
      env.ffmpeg,
      [
        '-hide_banner',
        '-v',
        'error',
        '-nostdin',
        '-ss',
        String(duration / 2),
        '-i',
        output,
        '-frames:v',
        '1',
        '-f',
        'image2',
        '-n',
        path.join(directory, 'preview.png'),
      ],
      { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    assert.deepEqual(report.rendererErrors, []);
    report.warnings = await app.evaluate(() => globalThis.__shuiguanDialogs.warnings);
    assert.deepEqual(report.warnings, []);
    Object.assign(report, {
      passed: true,
      duration,
      export: exportSettings,
      dimensions: { width: expectedWidth, height: expectedHeight, fps: actualFps },
      metadata,
      clips: project.clips.length,
      assets: project.assets.length,
      completedAt: new Date().toISOString(),
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.error = error.stack;
    if (page) await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) {
      // Quit only the instance created by this process; never attach to a user window.
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
    }
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  }
}
async function demoRecipe(env, directory) {
  const source = path.join(directory, 'original-source.mp4');
  await execute(
    env.ffmpeg,
    [
      '-hide_banner',
      '-nostdin',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x163e36:size=640x360:rate=24',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=330:sample_rate=48000',
      '-vf',
      'drawbox=x=70:y=90:w=180:h=120:color=0x78e4bc:t=fill',
      '-t',
      '5',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-n',
      source,
    ],
    { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 },
  );
  return {
    version: 1,
    name: '水管剪辑 AI Skill · 真实导出验证',
    canvas: { width: 1280, height: 720, fps: 24, background: '#163e36' },
    assets: [{ id: 'original', path: source }],
    clips: [
      { asset: 'original', start: 0, duration: 2, inPoint: 1, transform: { volume: 0.2 } },
      {
        asset: 'original',
        start: 2,
        duration: 3,
        inPoint: 2,
        transform: { volume: 0.2 },
        keyframes: {
          x: [
            { time: 0, value: 0 },
            { time: 3, value: 100, easing: 'ease-out' },
          ],
        },
      },
      {
        kind: 'text',
        text: '真实水管剪辑导出',
        start: 0,
        duration: 5,
        layer: 10,
        style: { fontSize: 58, color: '#ffffff' },
        transform: { y: 190 },
        keyframes: {
          opacity: [
            { time: 0, value: 0 },
            { time: 0.8, value: 1 },
            { time: 4.2, value: 1 },
            { time: 5, value: 0 },
          ],
        },
      },
      {
        kind: 'shape',
        color: '#ff8d73',
        start: 0,
        duration: 5,
        layer: 5,
        transform: { x: 450, y: -170, scale: 0.15 },
        keyframes: {
          rotation: [
            { time: 0, value: 0 },
            { time: 5, value: 45 },
          ],
        },
      },
    ],
    export: { height: 720, fps: 24, quality: 'high' },
  };
}
async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.command === 'help') return console.log(help);
  const env = await environment(opts);
  if (opts.command === 'doctor')
    return console.log(
      JSON.stringify(
        {
          ready: true,
          repo: env.repo,
          sourceVersion: env.pkg.version,
          executable: env.exe,
          mode: opts.exe ? 'installed product' : 'source product',
          ffmpeg: env.ffmpeg,
          ffmpegVersion: env.ffmpegVersion,
          noDownloads: true,
        },
        null,
        2,
      ),
    );
  const requestedDirectory = path.resolve(opts['out-dir']);
  let recipe = opts.command === 'edit-render' ? await readRecipe(path.resolve(opts.recipe)) : null;
  // A new directory is our reservation. Existing files/directories, including an
  // old successful run, are always rejected instead of silently overwritten.
  await fs.mkdir(requestedDirectory, { recursive: false });
  // Keep the isolation comparison strict while handling /var -> /private/var
  // on macOS and canonical Windows paths consistently with Electron.
  const directory = await fs.realpath(requestedDirectory);
  if (!recipe) recipe = await demoRecipe(env, directory);
  await editRender(opts, env, recipe, directory);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
