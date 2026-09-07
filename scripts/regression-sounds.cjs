'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict');
const { _electron, expect } = require('@playwright/test');
(async () => {
  const root = path.resolve(__dirname, '..'),
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-sound-ui-')),
    profile = path.join(dir, 'profile'),
    saved = path.join(dir, '音效工程.freecut');
  await fs.mkdir(profile);
  const bootstrap = path.join(dir, 'main.cjs');
  await fs.writeFile(
    bootstrap,
    `const {app,dialog}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(saved)}});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`,
  );
  const env = { ...process.env, FREECUT_DISABLE_UPDATES: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: [bootstrap], cwd: root, env });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByRole('button', { name: '跳过引导', exact: true }).click();
    await page.getByRole('button', { name: '音频', exact: true }).click();
    await expect(page.locator('.sound-row')).toHaveCount(16);
    const first = page.locator('.sound-row').first();
    await first.locator('.sound-preview').click();
    await expect(first.locator('.icon-button')).toBeEnabled();
    await first.locator('.icon-button').click();
    await expect(page.locator('.timeline-clip')).toHaveCount(1);
    await first.locator('.icon-button').click();
    await expect(page.locator('.timeline-clip')).toHaveCount(2);
    await page.getByTitle('保存工程 Ctrl+S', { exact: true }).click();
    await expect(page.locator('.local-badge')).toHaveText('已保存');
    const project = JSON.parse(await fs.readFile(saved, 'utf8'));
    assert.equal(project.assets.length, 1);
    assert.equal(project.clips.length, 2);
    assert.equal(project.clips[0].assetId, project.clips[1].assetId);
    await page.screenshot({ path: path.join(dir, 'sound-library.png') });
    await fs.writeFile(
      path.join(dir, 'result.json'),
      JSON.stringify(
        { passed: true, saved, assets: project.assets.length, clips: project.clips.length },
        null,
        2,
      ),
    );
    console.log(
      'PASS sound library actual preview, repeat insertion, deduplicated asset and save: ' + dir,
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
