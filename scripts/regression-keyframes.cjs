'use strict';

// npm run build && node scripts/regression-keyframes.cjs
// Full application UI test, with actual save IPC. No FFmpeg, model or network
// setup is needed. All generated projects and Electron state use a fresh temp
// directory. Only native file-dialog choices are mocked; the close guard stays on.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron, expect } = require('@playwright/test');

const visualProperties = ['opacity', 'rotation', 'scale', 'x', 'y'];
const closeTo = (actual, expected, message) =>
  assert(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);

async function main() {
  const root = path.resolve(__dirname, '..');
  await fs.access(path.join(root, 'dist', 'index.html')).catch(() => {
    throw Error('Build the current application first: npm run build');
  });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-keyframes-regression-'));
  const profile = path.join(directory, 'profile');
  await fs.mkdir(profile);
  const bootstrap = path.join(directory, 'launch.cjs');
  await fs.writeFile(
    bootstrap,
    `const {app}=require('electron');\napp.setPath('userData',${JSON.stringify(profile)});\napp.setPath('sessionData',${JSON.stringify(profile)});\nrequire(${JSON.stringify(path.join(root, 'electron/main.cjs'))});\n`,
  );
  const report = {
    startedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    directory,
    checks: [],
    rendererErrors: [],
    passed: false,
  };
  let app,
    page,
    savedNumber = 0;
  const check = async (name, action) => {
    console.log(`RUN: ${name}`);
    const started = Date.now();
    await action();
    report.checks.push({ name, passed: true, elapsedMs: Date.now() - started });
    console.log(`PASS: ${name}`);
  };
  const save = async (label) => {
    const file = path.join(directory, `${String(++savedNumber).padStart(2, '0')}-${label}.freecut`);
    await app.evaluate((_, selected) => {
      globalThis.__keyframeDialogs.save.push(selected);
    }, file);
    await page.getByTitle('保存工程 Ctrl+S', { exact: true }).click();
    await expect
      .poll(() => fs.readFile(file, 'utf8').catch(() => ''), { timeout: 15000 })
      .not.toBe('');
    const project = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(project.clips.length, 1, 'The UI should contain only the generated text fixture');
    assert.equal(project.clips[0].kind, 'text');
    assert.equal(project.assets.length, 0, 'This test must not depend on imported media');
    assert(
      project.tracks.some(
        (track) => track.id === project.clips[0].trackId && track.kind === 'overlay',
      ),
    );
    return { file, project, clip: project.clips[0] };
  };
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.PORTABLE_EXECUTABLE_DIR;
    app = await _electron.launch({ args: [bootstrap], cwd: root, env, timeout: 30000 });
    report.runtime = await app.evaluate(({ app }) => ({
      electron: process.versions.electron,
      node: process.versions.node,
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
    }));
    assert.equal(report.runtime.userData, profile);
    assert.equal(report.runtime.sessionData, profile);
    await app.evaluate(({ dialog }) => {
      globalThis.__keyframeDialogs = { save: [], unexpected: [], closeChoices: 0 };
      dialog.showSaveDialog = async () => {
        const filePath = globalThis.__keyframeDialogs.save.shift();
        if (!filePath) throw Error('Unexpected native save dialog');
        return { canceled: false, filePath };
      };
      dialog.showMessageBox = async (_window, options) => {
        // This chooses "discard" through the real guard if a failed test has
        // unsaved changes. Never remove close listeners or skip the handshake.
        if (options.title === '保存更改') globalThis.__keyframeDialogs.closeChoices++;
        else globalThis.__keyframeDialogs.unexpected.push(options.message);
        return { response: 1, checkboxChecked: false };
      };
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => report.rendererErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 950 });
    const mode = page.getByTitle('切换关键帧操作模式', { exact: true });
    const record = page.getByRole('button', { name: '记录当前画面', exact: true });
    const previous = page.getByRole('button', { name: '上一个关键帧', exact: true });
    const next = page.getByRole('button', { name: '下一个关键帧', exact: true });
    const remove = page.getByRole('button', { name: '删除当前整组关键帧', exact: true });
    const position = page.locator('.easy-keyframe-position');
    let first, twoGroups;

    await check('Home opens an easy-mode text project with a one-click record button', async () => {
      await page.getByRole('button', { name: /^新建项目/ }).click();
      const skip = page.getByRole('button', { name: '跳过引导', exact: true });
      if (await skip.count()) await skip.click();
      await expect(mode).toContainText('普通');
      await page.getByLabel('工程名称', { exact: true }).fill('普通模式关键帧回归');
      await page.locator('.tool-nav').getByRole('button', { name: '文字', exact: true }).click();
      await page.getByRole('button', { name: '添加文字', exact: true }).click();
      await expect(page.locator('.timeline-clip.text')).toHaveCount(1);
      await expect(record).toBeVisible();
      await expect(page.locator('.anim-control')).toHaveCount(0);
      await expect(page.getByLabel('画面大小', { exact: true })).toHaveValue('100');
      await expect(previous).toBeDisabled();
      await expect(next).toBeDisabled();
      await expect(remove).toBeDisabled();
      await record.click();
      first = await save('first-group');
      assert.deepEqual(Object.keys(first.clip.keyframes).sort(), visualProperties);
      for (const prop of visualProperties) {
        const frames = first.clip.keyframes[prop];
        assert.equal(frames.length, 1);
        closeTo(frames[0].time, 0, `${prop} initial time`);
        closeTo(frames[0].value, first.clip.transform[prop], `${prop} captured initial value`);
      }
    });

    await check(
      'Arrow seeking, size adjustment and recording save five properties at both times',
      async () => {
        // The save button has keyboard focus; ArrowRight therefore follows the
        // product's timeline shortcut rather than editing a focused input field.
        for (let frame = 0; frame < first.project.fps * 2; frame++)
          await page.keyboard.press('ArrowRight');
        await expect(position).toContainText('2.00 秒');
        await page.getByLabel('画面大小', { exact: true }).fill('175');
        await record.click();
        twoGroups = await save('two-groups');
        assert.deepEqual(Object.keys(twoGroups.clip.keyframes).sort(), visualProperties);
        for (const prop of visualProperties) {
          const frames = twoGroups.clip.keyframes[prop];
          assert.equal(frames.length, 2, `${prop} should have both snapshot times`);
          assert.notEqual(frames[0].id, frames[1].id);
          closeTo(frames[0].time, 0, `${prop} first time`);
          closeTo(frames[1].time, 2, `${prop} second time`);
          closeTo(frames[0].value, first.clip.transform[prop], `${prop} first value survived`);
          closeTo(
            frames[1].value,
            prop === 'scale' ? 1.75 : first.clip.transform[prop],
            `${prop} second value`,
          );
        }
        closeTo(twoGroups.clip.duration, first.clip.duration, 'Recording must not resize the clip');
        report.twoGroupsProject = twoGroups.file;
        await page.screenshot({ path: path.join(directory, 'two-groups.png') });
      },
    );

    await check('Previous and next navigate to the recorded poses', async () => {
      await previous.click();
      await expect(position).toContainText('0.00 秒');
      await expect(page.getByLabel('画面大小', { exact: true })).toHaveValue('100');
      await expect(previous).toBeDisabled();
      await expect(next).toBeEnabled();
      await next.click();
      await expect(position).toContainText('2.00 秒');
      await expect(page.getByLabel('画面大小', { exact: true })).toHaveValue('175');
      await expect(next).toBeDisabled();
    });

    await check(
      'Switching professional and easy mode leaves all project data unchanged',
      async () => {
        await mode.click();
        await expect(mode).toContainText('专业模式');
        await expect(page.locator('.anim-control')).toHaveCount(5);
        await expect(record).toHaveCount(0);
        const professional = await save('professional-mode');
        assert.deepEqual(professional.project, twoGroups.project);
        await mode.click();
        await expect(mode).toContainText('普通');
        await expect(record).toBeVisible();
        await expect(page.locator('.anim-control')).toHaveCount(0);
        const easy = await save('easy-again');
        assert.deepEqual(easy.project, twoGroups.project);
      },
    );

    await check(
      'Delete current group removes all five keys and retains the first pose',
      async () => {
        await expect(position).toContainText('2.00 秒');
        await remove.click();
        await expect(remove).toBeDisabled();
        const deleted = await save('deleted-second-group');
        for (const prop of visualProperties) {
          assert.deepEqual(
            deleted.clip.keyframes[prop],
            [twoGroups.clip.keyframes[prop][0]],
            `${prop} should retain the first key only`,
          );
        }
        assert.deepEqual(deleted.clip.transform, first.clip.transform);
        assert.deepEqual(deleted.clip.text, first.clip.text);
        assert.equal(deleted.clip.id, first.clip.id);
        await previous.click();
        await expect(position).toContainText('0.00 秒');
        await expect(page.getByLabel('画面大小', { exact: true })).toHaveValue('100');
        await expect(next).toBeDisabled();
        report.deletedProject = deleted.file;
        await page.screenshot({ path: path.join(directory, 'after-delete.png') });
      },
    );
    const dialogs = await app.evaluate(() => globalThis.__keyframeDialogs);
    assert.equal(dialogs.save.length, 0);
    assert.deepEqual(dialogs.unexpected, []);
    assert.deepEqual(report.rendererErrors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) {
      const timer = setTimeout(() => {
        report.passed = false;
        report.closeError = 'Product close guard did not finish within 30 seconds';
        process.exitCode = 1;
        // Last-resort cleanup of this test-owned process after a failed guard.
        app.process().kill();
      }, 30000);
      try {
        await app.close();
      } catch (error) {
        report.passed = false;
        report.closeError = error.message;
        process.exitCode = 1;
      } finally {
        clearTimeout(timer);
      }
    }
    report.completedAt = new Date().toISOString();
    const file = path.join(directory, 'regression-keyframes-result.json');
    await fs.writeFile(file, JSON.stringify(report, null, 2));
    console.log(
      `${report.passed ? 'PASS' : 'FAIL'}: ${report.checks.length} keyframe regression groups\nReport: ${file}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
