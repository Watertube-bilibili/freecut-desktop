'use strict';

// Run after the owner builds dist: node scripts/regression-context-menu.cjs
// Optional: --app <unpacked FreeCut executable or macOS .app>. No build, network,
// shared artifact directories, or renderer project hooks. Native dialog choices
// are redirected to a fresh profile; every project assertion reads an actual save.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { _electron, expect } = require('@playwright/test');

const near = (actual, expected, message, epsilon = 0.0001) =>
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${expected}, got ${actual}`);

async function main() {
  const root = path.resolve(__dirname, '..');
  const index = process.argv.indexOf('--app');
  if (index >= 0 && !process.argv[index + 1]) throw Error('--app requires a path');
  let executablePath = index >= 0 ? path.resolve(process.argv[index + 1]) : process.env.FREECUT_TEST_EXE;
  if (executablePath?.endsWith('.app')) executablePath = path.join(executablePath, 'Contents/MacOS/FreeCut');
  await fs.access(executablePath || path.join(root, 'dist/index.html'));
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'freecut-context-regression-'));
  const profile = path.join(directory, 'profile');
  await fs.mkdir(profile);
  const ffmpeg = path.join(root, 'resources/ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const sample = path.join(directory, '本地原创测试图与正弦音.mp4');
  const unused = path.join(directory, '未使用的原创素材.mp4');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=523:sample_rate=48000',
    '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sample],
  { windowsHide: true, stdio: 'pipe' });
  await fs.copyFile(sample, unused, require('node:fs').constants.COPYFILE_EXCL);
  const bootstrap = path.join(directory, 'launch.cjs');
  await fs.writeFile(bootstrap, `const {app}=require('electron');
app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});
require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});\n`);
  const env = { ...process.env, FREECUT_DISABLE_UPDATES: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  delete env.PORTABLE_EXECUTABLE_FILE;
  const report = { directory, startedAt: new Date().toISOString(), platform: process.platform,
    executablePath: executablePath || 'source Electron', checks: [], rendererErrors: [], passed: false };
  let app, page, baseline, n = 0;
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const A = 'context-shape-a', B = 'context-shape-b', T = 'context-text';
  const menu = () => page.getByRole('menu');
  const item = id => menu().locator(`[data-menu-item-id="${id}"]`);
  const clip = id => page.locator(`.timeline-clip[data-clip-id="${id}"]`);
  const track = id => page.locator(`.track-header[data-track-id="${id}"]`);
  const byId = (p, id) => {
    const c = p.clips.find(c => c.id === id);
    assert(c, `Clip ${id} is missing`);
    return c;
  };
  const check = async (name, run) => {
    console.log(`RUN: ${name}`);
    report.running = name;
    const start = Date.now();
    await run();
    report.checks.push({ name, passed: true, elapsedMs: Date.now() - start });
    console.log(`PASS: ${name}`);
  };
  const dismiss = async () => {
    if (await menu().count()) await page.keyboard.press('Escape');
    await expect(menu()).toHaveCount(0);
  };
  const save = async label => {
    await dismiss();
    const file = path.join(directory, `${String(++n).padStart(2, '0')}-${label}.freecut`);
    await app.evaluate((_, file) => globalThis.__contextDialogs.save.push(file), file);
    await page.getByTitle('保存工程 Ctrl+S', { exact: true }).click();
    await expect.poll(() => fs.readFile(file, 'utf8').catch(() => ''), { timeout: 15000 }).not.toBe('');
    // The recent-index write happens after the project file. Wait for the real
    // IPC acknowledgment before subsequent raw mouse/keyboard interactions.
    await expect(page.getByText('正在处理工程文件…', { exact: true })).toBeHidden({ timeout: 15000 });
    await expect(page.locator('.local-badge')).toHaveText('已保存');
    report.lastProject = file;
    return JSON.parse(await fs.readFile(file, 'utf8'));
  };
  const load = async (project, label) => {
    await save(`before-open-${label}`);
    const file = path.join(directory, `fixture-${label}-${++n}.freecut`);
    const next = { ...structuredClone(project), name: `右键真实回归-${label}-${n}` };
    await fs.writeFile(file, JSON.stringify(next, null, 2), { flag: 'wx' });
    await app.evaluate((_, file) => globalThis.__contextDialogs.open.push([file]), file);
    await page.getByTitle('打开工程 Ctrl+O', { exact: true }).click();
    await expect(page.locator('.project-title')).toHaveValue(next.name);
    await expect(page.getByText('正在处理工程文件…', { exact: true })).toBeHidden({ timeout: 15000 });
    await expect(page.getByTitle('撤销 Ctrl+Z', { exact: true })).toBeDisabled();
    return save(`normalized-${label}`);
  };
  const reset = async label => { baseline = await load(baseline, label); };
  const undo = async () => { await page.getByTitle('撤销 Ctrl+Z', { exact: true }).click(); };
  const right = async (target, label) => {
    await target.scrollIntoViewIfNeeded();
    // Finish native scroll events before invoking a menu whose contract dismisses
    // on outside scrolling. Locator auto-scrolling during the click can race it.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await target.click({ button: 'right', position: { x: 22, y: 22 } });
    await expect(menu()).toBeVisible();
    if (label) await expect(menu()).toHaveAttribute('aria-label', label);
  };
  const choose = async id => { await item(id).click(); await expect(menu()).toHaveCount(0); };
  const zoom = () => clip(A).evaluate(el => parseFloat(el.style.width) / 2);
  const playhead = () => page.locator('.playhead').evaluate(el => parseFloat(el.style.left));
  const seek = async time => {
    await dismiss();
    const z = await zoom(), r = await page.locator('.ruler').boundingBox();
    assert(r, 'Timeline ruler is not visible');
    await page.mouse.click(r.x + Math.max(1, time * z), r.y + 14);
    await expect.poll(playhead).toBeCloseTo(Math.max(1, time * z), 1);
  };
  const rightAt = async (selector, time, label) => {
    const target = page.locator(selector);
    await target.scrollIntoViewIfNeeded();
    const r = await target.boundingBox(), z = await zoom();
    assert(r, `No rectangle for ${selector}`);
    await page.mouse.click(r.x + Math.max(1, time * z), r.y + r.height - 3, { button: 'right' });
    await expect(menu()).toHaveAttribute('aria-label', label);
  };
  const sameBaseline = async label => assert.deepEqual(await save(label), baseline);

  try {
    app = await _electron.launch({ executablePath, args: executablePath ? [`--user-data-dir=${profile}`] : [bootstrap], cwd: root, env });
    const isolation = await app.evaluate(async ({ app, dialog, clipboard }) => {
      await app.whenReady();
      globalThis.__contextDialogs = { open: [], save: [], unexpected: [] };
      globalThis.__contextClipboard = await clipboard.read();
      dialog.showSaveDialog = async () => {
        const filePath = globalThis.__contextDialogs.save.shift();
        if (!filePath) throw Error('Unexpected native save dialog');
        return { canceled: false, filePath };
      };
      dialog.showOpenDialog = async () => {
        const filePaths = globalThis.__contextDialogs.open.shift();
        if (!filePaths) throw Error('Unexpected native open dialog');
        return { canceled: false, filePaths };
      };
      dialog.showMessageBox = async (_window, options) => {
        if (!['保存更改', 'Save changes'].includes(options.title)) globalThis.__contextDialogs.unexpected.push(options.message);
        return { response: 1, checkboxChecked: false };
      };
      return { userData: app.getPath('userData'), sessionData: app.getPath('sessionData') };
    });
    assert.equal(await fs.realpath(isolation.userData), await fs.realpath(profile));
    assert.equal(await fs.realpath(isolation.sessionData), await fs.realpath(profile));
    report.isolation = isolation;
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.rendererErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1050 });

    await check('Default Chinese, menu import, and a real saved four-clip fixture', async () => {
      await page.getByRole('button', { name: /^新建项目/ }).click();
      const skip = page.getByRole('button', { name: '跳过引导', exact: true });
      if (await skip.count()) await skip.click();
      await expect(page.locator('.editor-language')).toHaveValue('zh-CN');
      await right(page.locator('.library-body'), '素材库菜单');
      await app.evaluate((_, files) => globalThis.__contextDialogs.open.push(files), [sample, unused]);
      await choose('import');
      await expect(page.locator('.asset-card')).toHaveCount(2);
      const p = await save('real-import');
      assert.equal(p.assets.length, 2);
      assert(p.assets.every(a => a.kind === 'video' && !a.missing && a.duration >= 1.99));
      const transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1 };
      const effects = { brightness: 1, contrast: 1, saturation: 1, hue: 0, blur: 0,
        grayscale: 0, sepia: 0, vignette: 0, pixelate: 0, chroma: false,
        chromaColor: '#00ff00', chromaThreshold: 80, flipX: false, flipY: false,
        mask: 'none', maskSize: 1, maskX: 0, maskY: 0, maskRotation: 0, maskFeather: 0, maskInvert: false };
      const make = (id, kind, trackId, extra) => ({ id, name: id, kind, trackId, start: 0, duration: 2,
        inPoint: 0, speed: 1, fadeIn: 0, fadeOut: 0, transform: { ...transform }, effects: { ...effects }, keyframes: {}, ...extra });
      p.width = 640; p.height = 360; p.fps = 24;
      p.tracks = ['a', 'b', 'text', 'video', 'audio'].map(id => ({ id, name: `测试 ${id}`,
        kind: ['video', 'audio'].includes(id) ? id : 'overlay', muted: false, hidden: false, locked: false }));
      p.clips = [
        make(A, 'shape', 'a', { color: '#ed795c', transform: { ...transform, x: -150, scale: 0.2 },
          keyframes: { x: [0, 1, 2].map((time, i) => ({ id: `x${i}`, time, value: -150 + 60 * i, easing: 'linear' })) } }),
        make(B, 'shape', 'b', { color: '#6fbcd9', transform: { ...transform, x: 180, scale: 0.2 } }),
        make(T, 'text', 'text', { transform: { ...transform, y: 110 },
          text: { text: 'MENU', fontSize: 28, color: '#ffffff', background: 'transparent', align: 'center', bold: true, stroke: false } }),
        make('context-video', 'video', 'video', { assetId: p.assets.find(a => a.path === sample).id }),
      ];
      baseline = await load(p, 'base');
      await expect(page.locator('.timeline-clip')).toHaveCount(4);
      if (!(await page.locator('.mode-switch').innerText()).includes('专业模式')) await page.locator('.mode-switch').click();
    });

    await check('Right-click targets A while B was selected; no seek/drag; split retains animation and undo', async () => {
      await seek(1);
      await clip(B).click({ position: { x: 25, y: 20 } });
      await expect(clip(B)).toHaveClass(/selected/);
      const at = await playhead();
      await right(clip(A), '片段菜单');
      await page.mouse.move(900, 350, { steps: 8 });
      near(await playhead(), at, 'Right-click must not seek');
      await expect(clip(A)).toHaveClass(/selected/);
      await choose('flip-x');
      const flipped = await save('only-A-flipped');
      assert.equal(byId(flipped, A).effects.flipX, true);
      assert.deepEqual(byId(flipped, B), byId(baseline, B));
      near(byId(flipped, A).start, 0, 'Right-click must not drag');
      await undo(); await sameBaseline('undo-flip');
      await right(clip(A), '片段菜单'); await choose('split');
      const split = await save('split');
      const halves = split.clips.filter(c => c.trackId === 'a').sort((a, b) => a.start - b.start);
      assert.equal(halves.length, 2);
      assert.deepEqual(halves.map(c => [c.start, c.duration]), [[0, 1], [1, 1]]);
      assert.deepEqual(halves.map(c => c.keyframes.x.map(k => [k.time, k.value])), [[[0, -150], [1, -90]], [[0, -90], [1, -30]]]);
      assert.deepEqual(byId(split, B), byId(baseline, B));
      await undo(); await sameBaseline('undo-split');
      await right(clip(A), '片段菜单'); await choose('delete');
      const deleted = await save('delete-A');
      assert(!deleted.clips.some(c => c.id === A));
      assert.deepEqual(byId(deleted, B), byId(baseline, B));
      await undo(); await sameBaseline('undo-delete');
    });

    await check('Clipboard placement uses clicked track/time; duplicate and cut preserve keyframes', async () => {
      await right(clip(A)); await choose('copy');
      await seek(0.25);
      const at = await playhead();
      await rightAt('.track-lane[data-track-id="b"]', 1.5, '轨道菜单');
      near(await playhead(), at, 'Opening track menu must not seek');
      await choose('paste');
      const pasted = await save('paste-at-track-time');
      const clone = pasted.clips.find(c => !baseline.clips.some(b => b.id === c.id));
      assert(clone); assert.equal(clone.trackId, 'b'); near(clone.start, 1.5, 'Pasted start');
      assert.deepEqual(clone.keyframes.x.map(k => [k.time, k.value]), byId(baseline, A).keyframes.x.map(k => [k.time, k.value]));
      assert.notEqual(clone.keyframes.x[0].id, byId(baseline, A).keyframes.x[0].id);
      await undo(); await sameBaseline('undo-paste');
      await right(clip(A)); await choose('duplicate');
      const doubled = await save('duplicate-after');
      const duplicate = doubled.clips.find(c => !baseline.clips.some(b => b.id === c.id));
      assert.equal(duplicate.trackId, 'a'); near(duplicate.start, 2, 'Duplicate after original');
      await undo(); await sameBaseline('undo-duplicate');
      await right(clip(A)); await choose('cut');
      await expect(clip(A)).toHaveCount(0);
      // The ruler supplies a destination even after A, our zoom reference, was cut.
      await track('a').click({ button: 'right', position: { x: 22, y: 22 } });
      await choose('paste');
      const cut = await save('cut-paste');
      assert.equal(cut.clips.length, baseline.clips.length);
      assert(!cut.clips.some(c => c.id === A));
      assert.deepEqual(byId(cut, B), byId(baseline, B));
      await undo(); await undo(); await sameBaseline('undo-cut-paste');
    });

    await check('Track toggles undo; locked edits and incompatible audio paste are disabled', async () => {
      for (const [id, field] of [['track-mute', 'muted'], ['track-hide', 'hidden'], ['track-lock', 'locked']]) {
        await right(track('a'), '轨道菜单'); await choose(id);
        const changed = await save(field);
        assert.equal(changed.tracks.find(t => t.id === 'a')[field], true);
        if (field === 'locked') {
          await right(clip(A));
          for (const action of ['split', 'cut', 'paste', 'duplicate', 'delete', 'flip-x', 'flip-y']) await expect(item(action)).toBeDisabled();
          await expect(item('copy')).toBeEnabled();
          await dismiss();
        }
        await undo(); await sameBaseline(`undo-${field}`);
      }
      await right(track('audio'), '轨道菜单');
      await expect(item('paste')).toBeDisabled();
      await dismiss();
    });

    await check('Used assets are protected; unused removal keeps file; insertion and empty menus work', async () => {
      const used = baseline.assets.find(a => a.path === sample), spare = baseline.assets.find(a => a.path === unused);
      const asset = id => page.locator(`.asset-card[data-asset-id="${id}"]`);
      await right(asset(used.id), '素材菜单'); await expect(item('remove-asset')).toBeDisabled(); await dismiss();
      await right(asset(spare.id), '素材菜单'); await choose('remove-asset');
      const removed = await save('unused-removed');
      assert.equal(removed.assets.length, 1); assert((await fs.stat(unused)).size > 1000);
      await undo(); await sameBaseline('undo-asset-remove');
      for (const [action, start] of [['asset-at-playhead', 0.5], ['asset-at-end', 2]]) {
        await seek(0.5); await right(asset(used.id), '素材菜单'); await choose(action);
        const inserted = await save(action);
        const c = inserted.clips.find(c => !baseline.clips.some(b => b.id === c.id));
        assert.equal(c.assetId, used.id); assert.equal(c.trackId, 'video'); near(c.start, start, action);
        await undo(); await sameBaseline(`undo-${action}`);
      }
      await right(page.locator('.library-body'), '素材库菜单'); await choose('add-text');
      const text = await save('menu-added-text'); assert.equal(text.clips.filter(c => c.kind === 'text').length, 2);
      await undo(); await sameBaseline('undo-add-text');
      await rightAt('.ruler', 1.5, '时间线菜单'); await choose('add-track');
      assert.equal((await save('menu-added-track')).tracks.length, baseline.tracks.length + 1);
      await undo(); await sameBaseline('undo-add-track');
    });

    await check('Preview menu, keyboard dismissal, and native text copy/paste/delete stay scoped', async () => {
      await seek(0.5); await clip(A).click({ position: { x: 25, y: 20 } });
      const selection = await page.getByTestId('preview-selection-box').boundingBox();
      assert(selection);
      // The SVG outline is intentionally pointer-transparent; click its visible
      // center through the product's hit-testing overlay, just like a user.
      await page.mouse.click(selection.x + selection.width / 2, selection.y + selection.height / 2, { button: 'right' });
      await expect(menu()).toHaveAttribute('aria-label', '预览菜单'); await choose('flip-y');
      assert.equal(byId(await save('preview-flip'), A).effects.flipY, true);
      await undo(); await sameBaseline('undo-preview');
      await right(clip(A)); await choose('keyframes');
      await expect(page.locator('.keyframe-row')).toHaveCount(3);
      await right(clip(A));
      const at = await playhead();
      await page.keyboard.press('Delete'); await page.keyboard.press(`${mod}+b`);
      await expect(menu()).toBeVisible(); await expect(page.locator('.timeline-clip')).toHaveCount(4);
      near(await playhead(), at, 'Menu keys must not play or seek');
      await item('copy').focus(); await page.keyboard.press('Space');
      await expect(menu()).toHaveCount(0);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      near(await playhead(), at, 'Space activates Copy without starting playback');
      await right(clip(A));
      await page.keyboard.press('Escape'); await expect(menu()).toHaveCount(0);
      await clip(A).focus(); await page.keyboard.press('Shift+F10'); await expect(menu()).toBeVisible();
      await page.locator('.project-title').click(); await expect(menu()).toHaveCount(0);
      await clip(T).click({ position: { x: 25, y: 20 } });
      await page.locator('.inspector').getByRole('button', { name: '基础', exact: true }).click();
      const input = page.getByRole('textbox', { name: '文字内容', exact: true });
      await input.fill('CLIPBOARD'); await input.selectText(); await page.keyboard.press(`${mod}+c`);
      await input.fill(''); await page.keyboard.press(`${mod}+v`); await expect(input).toHaveValue('CLIPBOARD');
      await input.selectText(); await page.keyboard.press('Delete'); await expect(input).toHaveValue('');
      await expect(page.locator('.timeline-clip')).toHaveCount(4);
      await input.fill('MENU');
      await sameBaseline('text-clipboard-scoped');
    });

    await check('Help modal blocks background cut/paste/delete; shortcuts resume after closing', async () => {
      await clip(A).click({ position: { x: 25, y: 20 } });
      await page.getByTitle('新手引导和快捷键', { exact: true }).click();
      const help = page.getByRole('dialog', { name: '使用帮助', exact: true });
      await expect(help).toBeVisible();
      for (const key of [`${mod}+x`, `${mod}+v`, 'Delete']) {
        await page.keyboard.press(key);
        await expect(help).toBeVisible();
        await expect(page.locator('.timeline-clip')).toHaveCount(4);
        await expect(clip(A)).toHaveCount(1);
      }
      await help.getByTitle('关闭', { exact: true }).click();
      await sameBaseline('help-protects-project');
      await clip(A).focus(); await page.keyboard.press(`${mod}+x`);
      await expect(clip(A)).toHaveCount(0);
      await page.keyboard.press(`${mod}+v`);
      await expect(page.locator('.timeline-clip')).toHaveCount(4);
      await undo(); await undo(); await sameBaseline('undo-shortcuts-after-help');
    });

    await check('English menu labels, viewport edges, and mobile scroll reach every item', async () => {
      await page.locator('.editor-language').selectOption('en');
      await clip(A).click({ button: 'right', position: { x: 25, y: 20 } });
      await expect(menu()).toHaveAttribute('aria-label', 'Clip menu');
      await expect(item('copy')).toHaveAttribute('aria-label', 'Copy');
      await expect(item('delete')).toHaveAttribute('aria-label', 'Delete clip');
      await page.screenshot({ path: path.join(directory, 'english-context-menu.png') });
      await dismiss(); await page.locator('.editor-language').selectOption('zh-CN');
      await page.locator('.layout-switch').click();
      await expect(page.locator('.mobile-mode')).toBeVisible();
      await page.setViewportSize({ width: 860, height: 380 });
      await clip(A).scrollIntoViewIfNeeded();
      await clip(A).focus(); await page.keyboard.press('Shift+F10');
      await expect(menu()).toBeVisible();
      const bounds = await menu().evaluate(el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight,
          scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
      });
      assert(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= bounds.width + 1 && bounds.bottom <= bounds.height + 1, JSON.stringify(bounds));
      assert(bounds.scrollHeight > bounds.clientHeight, 'Short mobile viewport must exercise overflow scrolling');
      const behind = await page.locator('.timeline-scroll').evaluate(el => ({ top: el.scrollTop, left: el.scrollLeft }));
      await page.keyboard.press('End'); await expect(item('track-lock')).toBeFocused();
      const last = await item('track-lock').boundingBox(), outer = await menu().boundingBox();
      assert(last.y >= outer.y && last.y + last.height <= outer.y + outer.height + 1, 'Last action must be scrolled into menu viewport');
      await page.keyboard.press('Home'); await expect(item('split')).toBeFocused();
      assert.deepEqual(await page.locator('.timeline-scroll').evaluate(el => ({ top: el.scrollTop, left: el.scrollLeft })), behind);
      await page.screenshot({ path: path.join(directory, 'mobile-context-menu.png') });
      await dismiss(); await page.setViewportSize({ width: 1440, height: 1050 });
      await page.locator('.layout-switch').click();
      const ruler = await page.locator('.ruler').boundingBox();
      await page.mouse.click(1428, ruler.y + 12, { button: 'right' });
      await expect(menu()).toHaveAttribute('aria-label', '时间线菜单');
      const edge = await menu().boundingBox();
      assert(edge.x + edge.width <= 1440 && edge.y + edge.height <= 1050, 'Bottom-right menu must remain inside viewport');
      await dismiss();
      await sameBaseline('menus-no-hidden-edits');
    });

    await check('Edited project saves, reopens, and exports a fully decoded two-second MP4 with sound', async () => {
      await reset('final-export');
      await seek(1); await right(clip(A)); await choose('split');
      const edited = await save('edited-delivery');
      const reopened = await load(edited, 'reopened-delivery');
      assert.deepEqual(reopened.clips, edited.clips); assert.equal(reopened.assets.some(a => a.missing), false);
      const output = path.join(directory, '右键菜单真实成片.mp4');
      await app.evaluate((_, file) => globalThis.__contextDialogs.save.push(file), output);
      await page.locator('.export-trigger').click();
      await page.locator('.export-dialog').getByRole('combobox').nth(0).selectOption('720');
      await page.locator('.export-dialog').getByRole('combobox').nth(1).selectOption('24');
      await page.getByRole('button', { name: '选择保存位置并导出', exact: true }).click();
      await expect(page.getByText('视频已保存', { exact: true })).toBeVisible({ timeout: 180000 });
      const decoded = spawnSync(ffmpeg, ['-hide_banner', '-xerror', '-i', output, '-f', 'null', '-'], { windowsHide: true, encoding: 'utf8' });
      assert.equal(decoded.status, 0, decoded.stderr);
      assert.match(decoded.stderr, /Duration: 00:00:02\.0\d/);
      assert.match(decoded.stderr, /1280x720/); assert.match(decoded.stderr, /24 fps/);
      assert.match(decoded.stderr, /Audio: aac/);
      const pcm = execFileSync(ffmpeg, ['-v', 'error', '-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      let energy = 0; for (let i = 0; i < pcm.length; i += 4) energy += pcm.readFloatLE(i) ** 2;
      const rms = Math.sqrt(energy / (pcm.length / 4)); assert(rms > 0.02 && rms < 0.3, `Bad audio RMS ${rms}`);
      const rgb = execFileSync(ffmpeg, ['-v', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1', '-vf', 'scale=160:90', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { windowsHide: true });
      const mean = rgb.reduce((a, b) => a + b, 0) / rgb.length;
      const deviation = Math.sqrt(rgb.reduce((a, b) => a + (b - mean) ** 2, 0) / rgb.length);
      assert(deviation > 35, `Blank or damaged output pixels: standard deviation ${deviation}`);
      const preview = path.join(directory, 'export-frame.png');
      execFileSync(ffmpeg, ['-v', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1', preview], { windowsHide: true });
      report.export = { output, bytes: (await fs.stat(output)).size, duration: 2, width: 1280, height: 720, fps: 24, rms, pixelStdDev: deviation, preview };
      await page.screenshot({ path: path.join(directory, 'export-complete.png') });
    });
    assert.deepEqual(report.rendererErrors, []);
    assert.deepEqual(await app.evaluate(() => globalThis.__contextDialogs.unexpected), []);
    assert.deepEqual(await app.evaluate(() => ({ open: globalThis.__contextDialogs.open.length, save: globalThis.__contextDialogs.save.length })), { open: 0, save: 0 });
    report.passed = true;
    delete report.running;
  } catch (error) {
    report.error = error.stack || String(error);
    if (app) report.dialogsAtFailure = await app.evaluate(() => globalThis.__contextDialogs).catch(() => undefined);
    if (page) await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) {
      await app.evaluate(async ({ clipboard }) => {
        const prior = globalThis.__contextClipboard;
        if (prior?.length) await clipboard.write(prior);
        else if (prior) clipboard.clear();
      }).catch(() => {});
      // Preserve the product's own renderer/main close guard, never app.exit().
      if (page) await page.locator('.export-dialog').getByTitle('关闭', { exact: true }).click({ timeout: 2000 }).catch(() => {});
      await app.close().catch(() => {});
    }
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
