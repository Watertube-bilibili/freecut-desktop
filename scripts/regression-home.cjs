'use strict';

// Run after npm run build. Uses real Electron, renderer and project IPC.
// Native dialogs and opening the external browser/file manager are intercepted.
// The final race cases also defer one import IPC response to model background decoding.
// Every project and profile lives in a fresh temp directory.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
if (process.argv.includes('--help')) {
  console.log(
    'npm run build\nnode scripts/regression-home.cjs\nNo downloads. Uses temporary profiles/projects; screenshots and a JSON report remain in the printed temporary directory.',
  );
} else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

async function main() {
  await fs.access(path.join(root, 'dist', 'index.html'));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-home-regression-'));
  const profile = path.join(directory, 'profile');
  await fs.mkdir(profile);
  const bootstrap = path.join(directory, 'launch.cjs');
  await fs.writeFile(
    bootstrap,
    `const {app}=require('electron');\napp.setPath('userData',${JSON.stringify(profile)});\napp.setPath('sessionData',${JSON.stringify(profile)});\nrequire(${JSON.stringify(path.join(root, 'electron', 'main.cjs'))});\n`,
  );
  const report = {
    startedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    directory,
    checks: [],
    screenshots: [],
    passed: false,
  };
  const savedHome = path.join(directory, 'home-saved.freecut');
  const savedExit = path.join(directory, 'window-exit.freecut');
  const savedQuit = path.join(directory, 'app-quit.freecut');
  let app, page, child;
  const check = async (name, run) => {
    console.log(`RUN: ${name}`);
    const started = Date.now();
    await run();
    report.checks.push({ name, passed: true, elapsedMs: Date.now() - started });
    console.log(`PASS: ${name}`);
  };
  const screenshot = async (name) => {
    const file = path.join(directory, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    report.screenshots.push(file);
  };
  const queue = (kind, value) =>
    app.evaluate(
      (_, data) => {
        globalThis.__homeDialogs[data.kind].push(data.value);
      },
      { kind, value },
    );
  const state = () => app.evaluate(() => globalThis.__homeDialogs);
  const navigateHome = () => page.getByTitle('返回首页', { exact: true }).click();
  const navDialog = () => page.getByRole('dialog', { name: '保存未完成的修改', exact: true });
  const nameInput = () => page.getByLabel('工程名称', { exact: true });
  const dirty = () => expect(page.locator('.local-badge')).toHaveText('未保存');
  const rename = async (name) => {
    await nameInput().fill(name);
    await dirty();
  };
  const closeAttempt = async (kind, response, save) => {
    const before = (await state()).messages.length;
    await queue('choices', response);
    if (save !== undefined) await queue('save', save);
    await app.evaluate(({ app, BrowserWindow }, mode) => {
      if (mode === 'quit') app.quit();
      else {
        BrowserWindow.getAllWindows()[0].close();
        BrowserWindow.getAllWindows()[0]?.close();
      }
    }, kind);
    await expect.poll(async () => (await state()).messages.length).toBe(before + 1);
    await expect(page.locator('.close-backdrop')).toBeHidden();
    assert.equal(page.isClosed(), false);
    assert.equal(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1,
    );
    assert.equal((await state()).choices.length, 0);
    await dirty();
  };
  const launch = async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.PORTABLE_EXECUTABLE_DIR;
    if (process.platform === 'win32') env.PORTABLE_EXECUTABLE_DIR = directory;
    app = await _electron.launch({ args: [bootstrap], cwd: root, env, timeout: 30000 });
    child = app.process();
    await app.evaluate(({ dialog, shell }) => {
      globalThis.__homeDialogs = {
        open: [],
        save: [],
        choices: [],
        messages: [],
        saveCalls: [],
        external: [],
        reveal: [],
        warnings: [],
      };
      dialog.showOpenDialog = async () => {
        let filePaths = globalThis.__homeDialogs.open.shift();
        if (filePaths?.delay) {
          globalThis.__homeDialogs.openPending = true;
          await new Promise((resolve) => {
            globalThis.__releaseHomeOpen = resolve;
          });
          globalThis.__homeDialogs.openPending = false;
          filePaths = filePaths.paths;
        }
        if (!filePaths) throw Error('Unexpected native open dialog');
        return { canceled: false, filePaths };
      };
      dialog.showSaveDialog = async (_, options) => {
        globalThis.__homeDialogs.saveCalls.push(options);
        if (!globalThis.__homeDialogs.save.length) throw Error('Unexpected native save dialog');
        let filePath = globalThis.__homeDialogs.save.shift();
        if (filePath?.delay) {
          globalThis.__homeDialogs.savePending = true;
          await new Promise((resolve) => {
            globalThis.__releaseHomeSave = resolve;
          });
          globalThis.__homeDialogs.savePending = false;
          filePath = filePath.path;
        }
        return filePath === null ? { canceled: true } : { canceled: false, filePath };
      };
      dialog.showMessageBox = async (_, options) => {
        if (options.title !== '保存更改') {
          globalThis.__homeDialogs.warnings.push(options);
          return { response: 0, checkboxChecked: false };
        }
        globalThis.__homeDialogs.messages.push(options);
        if (!globalThis.__homeDialogs.choices.length) throw Error('Unexpected close confirmation');
        return { response: globalThis.__homeDialogs.choices.shift(), checkboxChecked: false };
      };
      shell.openExternal = async (url) => {
        globalThis.__homeDialogs.external.push(url);
      };
      shell.showItemInFolder = (file) => {
        globalThis.__homeDialogs.reveal.push(file);
      };
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1440, height: 950 });
    await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible();
    const info = await page.evaluate(() => window.freecut.getInfo());
    const canonicalData = await fs.realpath(info.userData);
    const relative = path.relative(await fs.realpath(directory), canonicalData);
    assert(
      relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      'User data escaped the test directory',
    );
    report.runtime = { ...info, electron: await app.evaluate(() => process.versions.electron) };
  };
  const forceCleanup = async () => {
    if (app && child?.exitCode === null)
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    app = null;
  };
  const finalClose = async (kind, file) => {
    await queue('choices', 0);
    await queue('save', file);
    const closed = page.waitForEvent('close', { timeout: 15000 });
    await app.evaluate(({ app, BrowserWindow }, mode) => {
      if (mode === 'quit') app.quit();
      else BrowserWindow.getAllWindows()[0].close();
    }, kind);
    await closed;
    await expect
      .poll(() => fs.readFile(file, 'utf8').catch(() => ''), { timeout: 15000 })
      .not.toBe('');
    if (process.platform !== 'darwin' || kind === 'quit')
      await expect.poll(() => child.exitCode, { timeout: 15000 }).toBe(0);
    // On macOS, closing the last window intentionally keeps the application alive.
    // Forced exit is cleanup only, after the real guard has approved window close.
    await forceCleanup();
    return JSON.parse(await fs.readFile(file, 'utf8'));
  };
  try {
    await launch();
    await check('homepage, settings, about and fixed external links are accessible', async () => {
      await expect(page.getByRole('button', { name: '新建项目', exact: true })).toBeVisible();
      await expect(page.locator('.home-project')).toHaveCount(0);
      await screenshot('01-home-empty');
      await page
        .getByRole('navigation', { name: '首页导航' })
        .getByRole('button', { name: '设置', exact: true })
        .click();
      await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '手机风格', exact: true }).click();
      await page.getByRole('button', { name: '专业', exact: true }).click();
      await expect(page.getByRole('button', { name: '手机风格', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByRole('button', { name: '专业', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      assert.deepEqual(
        await page.evaluate(() => [
          localStorage.getItem('freecut-layout'),
          localStorage.getItem('freecut-keyframe-mode'),
        ]),
        ['mobile', 'pro'],
      );
      await screenshot('02-settings');
      await page
        .getByRole('navigation', { name: '首页导航' })
        .getByRole('button', { name: '关于', exact: true })
        .click();
      await expect(page.getByRole('heading', { name: '关于', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '我的 B站主页', exact: true }).click();
      await page.getByRole('button', { name: 'GitHub · 源码与下载', exact: true }).click();
      await expect
        .poll(async () => (await state()).external)
        .toEqual([
          'https://space.bilibili.com/390310418?spm_id_from=333.1007.0.0',
          'https://github.com/Watertube-bilibili/freecut-desktop',
        ]);
      const invalid = await page.evaluate(() =>
        window.freecut.openExternal('https://example.com').then(
          () => false,
          () => true,
        ),
      );
      assert.equal(invalid, true);
      await screenshot('03-about');
      await page
        .getByRole('navigation', { name: '首页导航' })
        .getByRole('button', { name: /^我的项目/ })
        .click();
    });
    await check('new project can skip onboarding and a name-only edit is unsaved', async () => {
      await page.getByRole('button', { name: '新建项目', exact: true }).click();
      await page.getByRole('button', { name: '跳过引导', exact: true }).click();
      await expect(page.getByTitle('切换专业布局 / 手机风格', { exact: true })).toContainText(
        '手机风格',
      );
      await expect(page.getByTitle('切换关键帧操作模式', { exact: true })).toContainText(
        '专业模式',
      );
      await expect(page.locator('.timeline-clip')).toHaveCount(0);
      await rename('首页回归空工程');
    });
    await check(
      'return home cancellation retains edits; save and continue records the project',
      async () => {
        await navigateHome();
        await expect(navDialog()).toBeVisible();
        await navDialog().getByRole('button', { name: '取消', exact: true }).click();
        await expect(nameInput()).toHaveValue('首页回归空工程');
        await dirty();
        await navigateHome();
        await queue('save', savedHome);
        await navDialog().getByRole('button', { name: '保存并继续', exact: true }).click();
        await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible();
        await expect(
          page.getByRole('button', { name: '打开项目 首页回归空工程', exact: true }),
        ).toBeVisible();
        const project = JSON.parse(await fs.readFile(savedHome, 'utf8'));
        assert.equal(project.name, '首页回归空工程');
        assert.equal(project.clips.length, 0);
        await screenshot('04-home-saved-project');
      },
    );
    await check('recent project opens and removal preserves its project file', async () => {
      await page.getByRole('button', { name: '打开项目 首页回归空工程', exact: true }).click();
      await expect(nameInput()).toHaveValue('首页回归空工程');
      await expect(page.locator('.local-badge')).toHaveText('已保存');
      await navigateHome();
      await page.getByTitle('从列表移除 首页回归空工程（保留文件）', { exact: true }).click();
      await expect(page.locator('.home-project')).toHaveCount(0);
      await fs.access(savedHome);
      const arbitrary = await page.evaluate(
        (file) =>
          window.freecut.openRecentProject(file).then(
            () => false,
            () => true,
          ),
        savedHome,
      );
      assert.equal(arbitrary, true);
      await queue('open', [savedHome]);
      await page.getByRole('button', { name: '打开项目', exact: true }).click();
      await expect(nameInput()).toHaveValue('首页回归空工程');
    });
    await check(
      'native window close cancellation and save cancellation preserve an editable window',
      async () => {
        await rename('原生取消后继续');
        await closeAttempt('window', 2);
        await rename('保存对话框取消后继续');
        await closeAttempt('window', 0, null);
        await rename('保存取消后仍可编辑');
      },
    );
    await check(
      'native close save failure keeps the window; final save writes the latest empty project',
      async () => {
        await closeAttempt(
          'window',
          0,
          path.join(directory, 'missing-parent', 'cannot-save.freecut'),
        );
        await rename('窗口退出最终已保存');
        const native = (await state()).messages;
        assert(native.length >= 3);
        for (const dialog of native)
          assert.deepEqual(dialog.buttons, ['保存并退出', '不保存', '取消']);
        assert((await state()).saveCalls.length >= 3);
        const project = await finalClose('window', savedExit);
        assert.equal(project.name, '窗口退出最终已保存');
        assert.equal(project.clips.length, 0);
        assert.equal(project.assets.length, 0);
      },
    );
    await launch();
    await check(
      'settings and recent projects persist across a real application restart',
      async () => {
        await expect(
          page.getByRole('button', { name: '打开项目 窗口退出最终已保存', exact: true }),
        ).toBeVisible();
        await page.getByTitle('定位项目 窗口退出最终已保存', { exact: true }).click();
        const canonical = await fs.realpath(savedExit);
        await expect.poll(async () => (await state()).reveal).toEqual([canonical]);
        const invalid = await page.evaluate(
          (file) =>
            window.freecut.showItem(file).then(
              () => false,
              () => true,
            ),
          bootstrap,
        );
        assert.equal(invalid, true);
        await page
          .getByRole('navigation', { name: '首页导航' })
          .getByRole('button', { name: '设置', exact: true })
          .click();
        await expect(page.getByRole('button', { name: '手机风格', exact: true })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect(page.getByRole('button', { name: '专业', exact: true })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await page
          .getByRole('navigation', { name: '首页导航' })
          .getByRole('button', { name: /^我的项目/ })
          .click();
        await page
          .getByRole('button', { name: '打开项目 窗口退出最终已保存', exact: true })
          .click();
        await expect(nameInput()).toHaveValue('窗口退出最终已保存');
        await expect(page.getByRole('button', { name: '跳过引导', exact: true })).toBeHidden();
      },
    );
    await check(
      'app.quit uses the same cancellation/failure guard and saves before exiting',
      async () => {
        await rename('应用退出取消');
        await closeAttempt('quit', 2);
        await rename('应用保存取消');
        await closeAttempt('quit', 0, null);
        await rename('应用保存失败');
        await closeAttempt(
          'quit',
          0,
          path.join(directory, 'missing-parent', 'app-save-failure.freecut'),
        );
        await rename('应用退出最终已保存');
        const project = await finalClose('quit', savedQuit);
        assert.equal(project.name, '应用退出最终已保存');
        assert.equal(project.clips.length, 0);
        await fs.access(savedHome);
        await fs.access(savedExit);
      },
    );
    await launch();
    await check(
      'pending save blocks navigation and duplicate saves, and keeps native close safe',
      async () => {
        await page.getByRole('button', { name: '新建项目', exact: true }).click();
        if (
          (await page.getByTitle('切换专业布局 / 手机风格', { exact: true }).innerText()).includes(
            '手机风格',
          )
        )
          await page.getByTitle('切换专业布局 / 手机风格', { exact: true }).click();
        await rename('导航竞态 A');
        const destination = path.join(directory, 'navigation-race.freecut');
        await queue('save', { delay: true, path: destination });
        const savesBefore = (await state()).saveCalls.length;
        await page.getByTitle('保存工程 Ctrl+S', { exact: true }).click();
        await expect.poll(async () => (await state()).savePending).toBe(true);
        await expect(page.getByText('正在处理工程文件…', { exact: true })).toBeVisible();
        assert.equal(
          await page.getByTitle('返回首页', { exact: true }).evaluate((button) => {
            const r = button.getBoundingClientRect();
            return button.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            );
          }),
          false,
          'Save overlay does not block navigation pointer events',
        );
        await page.getByTitle('返回首页', { exact: true }).evaluate((button) => button.click());
        await expect(nameInput()).toHaveValue('导航竞态 A');
        await expect(navDialog()).toBeHidden();
        await page.keyboard.press('ControlOrMeta+s');
        assert.equal(
          (await state()).saveCalls.length,
          savesBefore + 1,
          'Duplicate save escaped serialization',
        );
        const messagesBefore = (await state()).messages.length;
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        await expect(
          page.getByText('正在处理工程文件，请完成后再退出。', { exact: true }),
        ).toBeVisible();
        assert.equal(page.isClosed(), false);
        assert.equal(
          (await state()).messages.length,
          messagesBefore,
          'Close should wait for the existing file operation',
        );
        await app.evaluate(() => globalThis.__releaseHomeSave());
        await expect(page.locator('.local-badge')).toHaveText('已保存');
        assert.equal(JSON.parse(await fs.readFile(destination, 'utf8')).name, '导航竞态 A');
      },
    );
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('freecut:import-media');
      ipcMain.handle(
        'freecut:import-media',
        () =>
          new Promise((resolve) => {
            globalThis.__homeDialogs.importPending = true;
            globalThis.__releaseHomeImport = (name) => {
              globalThis.__homeDialogs.importPending = false;
              resolve([
                {
                  id: crypto.randomUUID(),
                  name,
                  kind: 'image',
                  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
                  duration: 5,
                  width: 1,
                  height: 1,
                },
              ]);
            };
          }),
      );
    });
    await check(
      'late open result cannot overwrite a background media update to the current project',
      async () => {
        await page.locator('.import-button').click();
        await expect.poll(async () => (await state()).importPending).toBe(true);
        await queue('open', { delay: true, paths: [savedHome] });
        await page.getByTitle('打开工程 Ctrl+O', { exact: true }).click();
        await expect.poll(async () => (await state()).openPending).toBe(true);
        await expect(page.getByText('正在处理工程文件…', { exact: true })).toBeVisible();
        await app.evaluate(() => globalThis.__releaseHomeImport('background-during-open.png'));
        await dirty();
        await app.evaluate(() => globalThis.__releaseHomeOpen());
        await expect(page.getByText('正在处理工程文件…', { exact: true })).toBeHidden();
        await expect(nameInput()).toHaveValue('导航竞态 A');
        await expect(page.getByText('background-during-open.png', { exact: true })).toBeVisible();
        await dirty();
        await screenshot('05-background-edit-retained');
      },
    );
    await check(
      'an import started in a discarded session cannot mutate the newly created project',
      async () => {
        await page.locator('.import-button').click();
        await expect.poll(async () => (await state()).importPending).toBe(true);
        await navigateHome();
        await navDialog().getByRole('button', { name: '不保存并继续', exact: true }).click();
        await page.getByRole('button', { name: '新建项目', exact: true }).click();
        await expect(page.locator('.local-badge')).toHaveText('已保存');
        await app.evaluate(() => globalThis.__releaseHomeImport('old-session-import.png'));
        await expect(page.locator('.import-button')).toBeEnabled();
        await expect(page.getByText('old-session-import.png', { exact: true })).toHaveCount(0);
        await expect(page.locator('.local-badge')).toHaveText('已保存');
        await screenshot('06-new-session-isolated');
      },
    );
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
    if (page && !page.isClosed()) await screenshot('failure').catch(() => {});
    throw error;
  } finally {
    await forceCleanup();
    report.finishedAt = new Date().toISOString();
    const reportFile = path.join(directory, 'home-regression-result.json');
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
    console.log(`REPORT: ${reportFile}`);
  }
}
