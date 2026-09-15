'use strict';
// Run after npm run build. Exercises real Electron IPC and persistent settings
// in an isolated profile. Only native folder selection is queued; no model
// downloads, network service, or inference API is replaced.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron, expect } = require('@playwright/test');

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const root = path.resolve(__dirname, '..');
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), 'freecut-voice-storage-ui-'),
  );
  const profile = path.join(directory, 'profile');
  const parent = path.join(
    directory,
    'Voice models on another drive',
    'A deliberately long folder name for checking wrapped paths',
  );
  const badParent = path.join(directory, 'unavailable-model-folder');
  await fs.mkdir(profile);
  await fs.mkdir(parent, { recursive: true });
  await fs.mkdir(badParent);
  await fs.writeFile(
    path.join(badParent, 'FreeCut-VoiceModels'),
    'A user-owned file; it must remain untouched.',
  );
  const customPath = path.join(await fs.realpath(parent), 'FreeCut-VoiceModels');
  const bootstrap = path.join(directory, 'launch.cjs');
  await fs.writeFile(
    bootstrap,
    `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`,
  );
  const env = { ...process.env, FREECUT_DISABLE_UPDATES: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  const report = {
    directory,
    profile,
    startedAt: new Date().toISOString(),
    checks: [],
    screenshots: [],
    rendererErrors: [],
    passed: false,
  };
  let app, page, defaultPath;

  async function launch() {
    app = await _electron.launch({ args: [bootstrap], cwd: root, env, timeout: 60000 });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on('pageerror', (error) => report.rendererErrors.push(error.message));
    await page.setViewportSize({ width: 1100, height: 720 });
    assert.deepEqual(
      await app.evaluate(({ app }) => ({
        userData: app.getPath('userData'),
        sessionData: app.getPath('sessionData'),
      })),
      { userData: profile, sessionData: profile },
    );
    await app.evaluate(({ dialog }) => {
      globalThis.__voiceStorageDialogs = { queue: [], calls: [], release: null };
      dialog.showOpenDialog = async (...args) => {
        const options = args.at(-1);
        globalThis.__voiceStorageDialogs.calls.push(options);
        const next = globalThis.__voiceStorageDialogs.queue.shift();
        if (!next) throw Error('Unexpected native folder dialog');
        const result = {
          canceled: next.cancel === true,
          filePaths: next.cancel ? [] : [next.folder],
        };
        if (!next.hold) return result;
        return new Promise((resolve) => {
          globalThis.__voiceStorageDialogs.release = () => {
            globalThis.__voiceStorageDialogs.release = null;
            resolve(result);
          };
        });
      };
    });
  }
  async function enterEditor(english = false) {
    await page
      .getByRole('button', { name: english ? 'New project' : '新建项目', exact: true })
      .click();
    const skip = page.getByRole('button', {
      name: english ? 'Skip tour' : '跳过引导',
      exact: true,
    });
    if (await skip.count()) await skip.click();
    await expect(page.locator('.editor-language')).toBeVisible();
  }
  async function openVoice(english = false) {
    await page.locator('.ai-nav').click();
    await page
      .getByRole('tab', { name: english ? 'Text to speech' : '语音朗读', exact: true })
      .click();
    await expect(
      page.getByRole('heading', {
        name: english ? 'Voice model download location' : '朗读模型下载位置',
        exact: true,
      }),
    ).toBeVisible();
  }
  async function state() {
    return page.evaluate(() => window.freecut.voiceStorageStatus());
  }
  async function queue(choice) {
    await app.evaluate(
      (_electron, value) => globalThis.__voiceStorageDialogs.queue.push(value),
      choice,
    );
  }
  async function check(name, action) {
    console.log('RUN: ' + name);
    await action();
    report.checks.push({ name, passed: true });
    console.log('PASS: ' + name);
  }
  async function capture(name) {
    const layout = await page.locator('.ai-dialog').evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: innerWidth,
        height: innerHeight,
        scrollWidth: dialog.scrollWidth,
        clientWidth: dialog.clientWidth,
      };
    });
    assert(
      layout.left >= 0 &&
        layout.right <= layout.width &&
        layout.top >= 0 &&
        layout.bottom <= layout.height,
      'Voice dialog must fit the viewport: ' + JSON.stringify(layout),
    );
    assert(
      layout.scrollWidth <= layout.clientWidth + 1,
      'The long path must not create horizontal overflow: ' + JSON.stringify(layout),
    );
    const file = path.join(directory, name + '.png');
    await page.screenshot({ path: file });
    report.screenshots.push(file);
  }

  try {
    await launch();
    await check(
      'Fresh Chinese interface keeps the model location off the automatic caption tab',
      async () => {
        await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
        await enterEditor();
        await page.locator('.ai-nav').click();
        await expect(page.getByRole('tab', { name: '自动字幕', exact: true })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await expect(page.locator('.ai-voice-storage')).toHaveCount(0);
        await page.getByRole('tab', { name: '语音朗读', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: '朗读模型下载位置', exact: true }),
        ).toBeVisible();
        const value = await state();
        defaultPath = value.defaultPath;
        assert.equal(value.path, defaultPath);
        assert.equal(value.custom, false);
        await expect(
          page.getByRole('textbox', { name: '朗读模型下载位置', exact: true }),
        ).toHaveText(defaultPath);
        await expect(page.getByRole('button', { name: '选择文件夹', exact: true })).toBeEnabled();
        await expect(
          page.getByRole('button', { name: '恢复默认位置', exact: true }),
        ).toBeDisabled();
      },
    );

    await check(
      'Canceling the native folder picker leaves the current location unchanged',
      async () => {
        await queue({ cancel: true });
        await page.getByRole('button', { name: '选择文件夹', exact: true }).click();
        await expect(page.getByRole('button', { name: '选择文件夹', exact: true })).toBeEnabled();
        assert.equal((await state()).path, defaultPath);
        const options = await app.evaluate(() => globalThis.__voiceStorageDialogs.calls.at(-1));
        assert(options.properties.includes('openDirectory'), 'Use the native directory picker');
        await expect(page.locator('.ai-storage-status')).toHaveCount(0);
        await expect(page.locator('.ai-voice-storage .ai-error')).toHaveCount(0);
      },
    );

    await check(
      'Choosing a parent creates FreeCut-VoiceModels and prevents concurrent voice operations while switching',
      async () => {
        await queue({ folder: parent, hold: true });
        await page.getByRole('button', { name: '选择文件夹', exact: true }).click();
        await expect(page.getByText('正在复制并校验已有模型…', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '选择文件夹', exact: true })).toBeDisabled();
        await expect(
          page.getByRole('button', { name: '恢复默认位置', exact: true }),
        ).toBeDisabled();
        await expect(page.getByRole('tab', { name: '自动字幕', exact: true })).toBeDisabled();
        await expect(
          page.getByRole('button', { name: '一键下载安装', exact: true }),
        ).toBeDisabled();
        await expect(page.getByLabel('语音引擎', { exact: true })).toBeDisabled();
        await app.evaluate(() => {
          if (!globalThis.__voiceStorageDialogs.release)
            throw Error('Missing held native folder selection');
          globalThis.__voiceStorageDialogs.release();
        });
        await expect(
          page.getByRole('textbox', { name: '朗读模型下载位置', exact: true }),
        ).toHaveText(customPath);
        await expect(page.getByRole('button', { name: '选择文件夹', exact: true })).toBeEnabled();
        assert.equal((await state()).custom, true);
        assert.equal(await fs.realpath(customPath), customPath);
        await expect(
          page.getByText('已启用新的下载位置，原位置的文件已保留。', { exact: true }),
        ).toBeVisible();
        await capture('voice-storage-zh-1100x720');
      },
    );

    await check('The full path is copyable and shared by both voice providers', async () => {
      await page.getByRole('button', { name: '复制下载位置', exact: true }).click();
      await expect(page.getByText('已复制下载位置。', { exact: true })).toBeVisible();
      await expect
        .poll(
          () =>
            app.evaluate(
              async ({ clipboard }, expected) => (await clipboard.readText()) === expected,
              customPath,
            ),
          { message: 'Copy writes the complete path to the actual clipboard' },
        )
        .toBe(true);
      await page.getByLabel('语音引擎', { exact: true }).selectOption('extra');
      await expect(page.locator('.chattts-panel')).toBeVisible();
      await expect(page.getByRole('textbox', { name: '朗读模型下载位置', exact: true })).toHaveText(
        customPath,
      );
      await expect(page.getByRole('button', { name: '选择文件夹', exact: true })).toBeEnabled();
      await capture('voice-storage-chattts-1100x720');
    });

    await check('English labels and long folder paths fit a 1100 by 720 window', async () => {
      await page.locator('.ai-dialog > header button').click();
      await page.locator('.editor-language').selectOption('en');
      await openVoice(true);
      await expect(page.getByRole('button', { name: 'Choose folder', exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Restore default location', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('textbox', { name: 'Voice model download location', exact: true }),
      ).toHaveText(customPath);
      assert(
        !/[\p{Script=Han}]/u.test(await page.locator('.ai-voice-storage').innerText()),
        'All voice storage interface text must be translated',
      );
      await capture('voice-storage-en-1100x720');
      await page.getByRole('tab', { name: 'Auto captions', exact: true }).click();
      await expect(page.locator('.ai-voice-storage')).toHaveCount(0);
    });

    await check('The custom path and English choice survive a full Electron restart', async () => {
      await app.evaluate(({ app }) => app.exit(0));
      app = undefined;
      await launch();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await enterEditor(true);
      await openVoice(true);
      await expect(
        page.getByRole('textbox', { name: 'Voice model download location', exact: true }),
      ).toHaveText(customPath);
      const value = await state();
      assert.equal(value.path, customPath);
      assert.equal(value.custom, true);
      assert.equal(value.busy, false);
    });

    await check(
      'A rejected destination is translated without changing settings or overwriting files',
      async () => {
        await queue({ folder: badParent });
        await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
        await expect(page.locator('.ai-voice-storage .ai-error')).toHaveText(
          'The voice model folder must be a real directory, not a symbolic link, shortcut, or file.',
        );
        await expect(
          page.getByRole('button', { name: 'Choose folder', exact: true }),
        ).toBeEnabled();
        assert.equal((await state()).path, customPath);
        assert.equal(
          await fs.readFile(path.join(badParent, 'FreeCut-VoiceModels'), 'utf8'),
          'A user-owned file; it must remain untouched.',
        );
        await capture('voice-storage-error-en-1100x720');
      },
    );

    await check(
      'Restoring defaults retains the old custom folder and survives another restart',
      async () => {
        await page.getByRole('button', { name: 'Restore default location', exact: true }).click();
        await expect(
          page.getByRole('textbox', { name: 'Voice model download location', exact: true }),
        ).toHaveText(defaultPath);
        await expect(
          page.getByRole('button', { name: 'Choose folder', exact: true }),
        ).toBeEnabled();
        await expect(
          page.getByRole('button', { name: 'Restore default location', exact: true }),
        ).toBeDisabled();
        assert((await fs.stat(customPath)).isDirectory());
        assert.equal((await state()).custom, false);
        await app.evaluate(({ app }) => app.exit(0));
        app = undefined;
        await launch();
        const value = await state();
        assert.equal(value.path, defaultPath);
        assert.equal(value.custom, false);
        assert.equal(value.busy, false);
      },
    );

    assert.deepEqual(report.rendererErrors, [], 'No renderer exceptions');
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
    if (page && !page.isClosed()) {
      const file = path.join(directory, 'failure.png');
      await page.screenshot({ path: file }).catch(() => {});
      report.screenshots.push(file);
      report.visibleText = await page
        .locator('body')
        .innerText()
        .catch(() => '');
    }
    throw error;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    report.finishedAt = new Date().toISOString();
    const file = path.join(directory, 'report.json');
    await fs.writeFile(file, JSON.stringify(report, null, 2));
    console.log('VOICE_STORAGE_REPORT: ' + file);
  }
}
