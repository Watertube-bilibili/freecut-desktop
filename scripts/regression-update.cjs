'use strict';
// Real Electron/main/renderer/IPC/atomic-save chain with an isolated profile.
// Only network responses, native dialogs and final installer launch are controlled.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { expect } = require('@playwright/test');
const root = path.resolve(__dirname, '..');

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-update-regression-'));
  const profile = path.join(directory, 'profile');
  await fs.mkdir(profile);
  const saved = path.join(directory, '中文 更新前工程.freecut');
  const marker = path.join(directory, 'installer-launch.jsonl');
  const bootstrap = path.join(directory, 'launch.cjs');
  await fs.writeFile(
    bootstrap,
    `
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {app,dialog}=require('electron');
Object.defineProperty(app,'isPackaged',{get:()=>true});
Object.defineProperty(process,'resourcesPath',{value:${JSON.stringify(path.join(root, 'resources'))}});
app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});
global.__updateTest={choices:[],saves:[],messages:[],saveCalls:0,launches:0,prepared:0,network:[]};
const data=Buffer.from('FreeCut controlled update bytes; never an executable');
const suffix=process.platform==='win32'?'win-x64-Portable.exe':'mac-'+process.arch+'.zip';
const name='FreeCut-0.99.0-'+suffix;
const url='https://github.com/Watertube-bilibili/freecut-desktop/releases/download/v0.99.0-preview.1/'+name;
global.fetch=async (input,init={})=>{
  global.__updateTest.network.push(String(input));
  if(String(input)==='https://api.github.com/repos/Watertube-bilibili/freecut-desktop/releases?per_page=100')
    return new Response(JSON.stringify([{tag_name:'v0.99.0-preview.1',draft:false,prerelease:true,assets:[{name,state:'uploaded',size:data.length,digest:'sha256:'+crypto.createHash('sha256').update(data).digest('hex'),browser_download_url:url}]}]));
  if(String(input)!==url)throw Error('Unexpected network access in update regression');
  const match=/^bytes=(\\d+)-(\\d+)$/.exec(init.headers.Range||'');
  if(!match)throw Error('Expected bounded Range download');
  const start=Number(match[1]),end=Number(match[2]);
  return new Response(data.subarray(start,end+1),{status:206,headers:{'content-range':'bytes '+start+'-'+end+'/'+data.length}});
};
dialog.showMessageBox=async (_,options)=>{
  if(options.title!=='保存更改')throw Error('Unexpected dialog: '+options.title);
  global.__updateTest.messages.push(options);
  if(!global.__updateTest.choices.length)throw Error('No queued close response');
  return {response:global.__updateTest.choices.shift(),checkboxChecked:false};
};
dialog.showSaveDialog=async ()=>{
  global.__updateTest.saveCalls++;
  if(!global.__updateTest.saves.length)throw Error('No queued save path');
  const filePath=global.__updateTest.saves.shift();
  return filePath===null?{canceled:true}:{canceled:false,filePath};
};
const install=${JSON.stringify(path.join(root, 'electron', 'update-install.cjs'))};
require.cache[require.resolve(install)]={id:install,filename:install,loaded:true,exports:{prepareUpdateInstall:async ({asset})=>{
  if(!fs.readFileSync(asset.file).equals(data))throw Error('Incorrect verified update data');
  global.__updateTest.prepared++;
  return async ()=>{
    global.__updateTest.launches++;
    fs.appendFileSync(${JSON.stringify(marker)},JSON.stringify({launches:global.__updateTest.launches,project:JSON.parse(fs.readFileSync(${JSON.stringify(saved)},'utf8'))})+'\\n');
  };
}}};
require(${JSON.stringify(path.join(root, 'electron', 'main.cjs'))});
`,
  );
  new (require('node:vm').Script)(await fs.readFile(bootstrap, 'utf8'), { filename: bootstrap });
  const report = {
    directory,
    platform: process.platform,
    checks: [],
    screenshots: [],
    passed: false,
  };
  let app, page, child;
  const check = async (name, action) => {
    console.log('RUN:', name);
    await action();
    report.checks.push({ name, passed: true });
    console.log('PASS:', name);
  };
  const state = () => app.evaluate(() => globalThis.__updateTest);
  const queue = (choice, savePath) =>
    app.evaluate(
      (_, data) => {
        globalThis.__updateTest.choices.push(data.choice);
        if (data.savePath !== undefined) globalThis.__updateTest.saves.push(data.savePath);
      },
      { choice, savePath },
    );
  const noLaunch = async () => {
    assert.equal((await state()).launches, 0);
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
    assert.equal(page.isClosed(), false);
  };
  const advance = async (seconds) => {
    for (let i = 0; i < seconds; i++) await page.clock.fastForward(1000);
  };
  try {
    const env = { ...process.env };
    for (const key of [
      'ELECTRON_RUN_AS_NODE',
      'FREECUT_DISABLE_UPDATES',
      'PORTABLE_EXECUTABLE_DIR',
      'PORTABLE_EXECUTABLE_FILE',
      'PORTABLE_EXECUTABLE_APP_FILENAME',
    ])
      delete env[key];
    if (process.platform === 'win32') env.PORTABLE_EXECUTABLE_DIR = directory;
    app = await _electron.launch({ args: [bootstrap], cwd: root, env, timeout: 30000 });
    child = app.process();
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1440, height: 950 });
    await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible();
    const time = new Date();
    await page.clock.install({ time });
    await page.clock.pauseAt(new Date(time.getTime() + 1000));
    const info = await page.evaluate(() => window.freecut.getInfo());
    const relative = path.relative(await fs.realpath(directory), await fs.realpath(info.userData));
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    report.runtime = info;
    await check(
      'Settings controls persist and a real validated download becomes ready',
      async () => {
        await page
          .getByRole('navigation', { name: '首页导航' })
          .getByRole('button', { name: '设置', exact: true })
          .click();
        await expect(page.getByRole('heading', { name: '软件更新', exact: true })).toBeVisible();
        const toggle = page.getByRole('switch');
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        assert.equal(
          JSON.parse(
            await fs.readFile(path.join(info.userData, 'updates', 'preferences.json'), 'utf8'),
          ).automatic,
          false,
        );
        await toggle.click();
        await page.getByRole('button', { name: '检查更新', exact: true }).click();
        await expect(page.getByRole('button', { name: '安装并重启', exact: true })).toBeVisible();
        assert.equal((await page.evaluate(() => window.freecut.updateState())).phase, 'ready');
        assert.equal((await state()).network.length, 2);
        const screenshot = path.join(directory, 'settings-update-ready.png');
        await page.screenshot({ path: screenshot });
        report.screenshots.push(screenshot);
        await noLaunch();
      },
    );
    await check('onboarding and an open export dialog defer the automatic restart', async () => {
      await page
        .getByRole('navigation', { name: '首页导航' })
        .getByRole('button', { name: /^我的项目/ })
        .click();
      await page.getByRole('button', { name: '新建项目', exact: true }).click();
      await expect(page.getByRole('button', { name: '跳过引导', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '立即安装', exact: true })).toBeDisabled();
      await advance(25);
      assert.equal((await state()).messages.length, 0);
      await noLaunch();
      await page.getByRole('button', { name: '跳过引导', exact: true }).click();
      await page.getByLabel('工程名称', { exact: true }).fill('自动更新前的未保存工程');
      await expect(page.locator('.local-badge')).toHaveText('未保存');
      await page.locator('.tool-nav').getByRole('button', { name: '文字', exact: true }).click();
      await page.getByRole('button', { name: '添加文字', exact: true }).click();
      await page.getByRole('button', { name: '导出', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '导出你的作品', exact: true })).toBeVisible();
      await advance(25);
      assert.equal((await state()).messages.length, 0);
      await noLaunch();
    });
    await check(
      'twenty-second automatic restart asks to save; cancel keeps editor usable',
      async () => {
        await queue(2);
        await page
          .getByRole('dialog', { name: '导出你的作品', exact: true })
          .getByTitle('关闭', { exact: true })
          .click();
        await advance(21);
        await expect.poll(async () => (await state()).messages.length).toBe(1);
        await expect(page.locator('.close-backdrop')).toBeHidden();
        await noLaunch();
        await page.getByLabel('工程名称', { exact: true }).fill('取消自动更新后继续编辑');
        await expect(page.locator('.local-badge')).toHaveText('未保存');
        await advance(25);
        assert.equal((await state()).messages.length, 1);
      },
    );
    await check(
      'save-dialog cancellation does not launch an installer or close the editor',
      async () => {
        await queue(0, null);
        await page.getByRole('button', { name: '立即安装', exact: true }).click();
        await expect.poll(async () => (await state()).saveCalls).toBe(1);
        await expect(page.locator('.close-backdrop')).toBeHidden();
        await noLaunch();
        await page.getByLabel('工程名称', { exact: true }).fill('更新前保存的最终工程');
        await expect(page.locator('.local-badge')).toHaveText('未保存');
      },
    );
    await check(
      'an actual atomic-save failure leaves the update deferred and editing available',
      async () => {
        await queue(0, directory);
        await page.getByRole('button', { name: '立即安装', exact: true }).click();
        await expect.poll(async () => (await state()).saveCalls).toBe(2);
        await expect(page.locator('.close-backdrop')).toBeHidden();
        await expect
          .poll(async () => (await page.evaluate(() => window.freecut.updateState())).phase)
          .toBe('ready');
        await noLaunch();
        await page.getByLabel('工程名称', { exact: true }).fill('更新前保存的最终工程');
        await expect(page.locator('.local-badge')).toHaveText('未保存');
      },
    );
    await check(
      'successful save precedes exactly one installer launch and normal app quit',
      async () => {
        await queue(0, saved);
        const closed = page.waitForEvent('close');
        await page.getByRole('button', { name: '立即安装', exact: true }).click();
        await closed;
        await expect.poll(() => child.exitCode).toBe(0);
        const lines = (await fs.readFile(marker, 'utf8')).trim().split('\n');
        assert.equal(lines.length, 1);
        const launch = JSON.parse(lines[0]);
        assert.equal(launch.launches, 1);
        assert.equal(launch.project.name, '更新前保存的最终工程');
        assert.equal(launch.project.clips.length, 1);
        assert.deepEqual(JSON.parse(await fs.readFile(saved, 'utf8')), launch.project);
      },
    );
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    // Forced exit is failure cleanup only; successful path above uses real guarded app.quit.
    if (app && child?.exitCode === null)
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await fs.writeFile(
      path.join(directory, 'update-regression-result.json'),
      JSON.stringify(report, null, 2),
    );
    console.log('Update regression report:', path.join(directory, 'update-regression-result.json'));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
