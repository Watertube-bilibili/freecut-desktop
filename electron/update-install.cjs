'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { hashFile } = require('./updater.cjs');

function portableTarget(env = process.env) {
  const directory = env.PORTABLE_EXECUTABLE_DIR;
  const file =
    env.PORTABLE_EXECUTABLE_FILE ||
    (directory &&
      env.PORTABLE_EXECUTABLE_APP_FILENAME &&
      path.join(directory, env.PORTABLE_EXECUTABLE_APP_FILENAME));
  if (
    !directory ||
    !file ||
    !path.isAbsolute(file) ||
    path.dirname(path.resolve(file)).toLowerCase() !== path.resolve(directory).toLowerCase() ||
    !file.toLowerCase().endsWith('.exe')
  )
    throw Error('无法确认便携程序的位置，请从原来的便携 EXE 启动。');
  return path.resolve(file);
}
async function detached(executable, args, { readyFile } = {}) {
  const powershell =
    process.platform === 'win32' && path.basename(executable).toLowerCase() === 'powershell.exe';
  const env = { ...process.env };
  for (const name of [
    'ELECTRON_RUN_AS_NODE',
    'PORTABLE_EXECUTABLE_DIR',
    'PORTABLE_EXECUTABLE_FILE',
    'PORTABLE_EXECUTABLE_APP_FILENAME',
  ])
    delete env[name];
  if (powershell) {
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
    env.PSModulePath = path.join(path.dirname(executable), 'Modules');
  }
  const child = spawn(executable, args, {
    // PowerShell's -Launch branch uses Start-Process for the independent
    // hidden worker. Direct DETACHED_PROCESS silently skips execution on
    // some Windows hosts; a shared console alone dies with its parent.
    detached: !powershell,
    stdio: powershell ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    windowsHide: true,
    env,
  });
  let diagnostics = '';
  child.stdout?.on('data', (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-3000);
  });
  child.stderr?.on('data', (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-3000);
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', resolve);
  });
  child.unref();
  if (!readyFile) return;
  const deadline = Date.now() + 20000;
  while (
    !(await fs.stat(readyFile).then(
      () => true,
      () => false,
    ))
  ) {
    if ((child.exitCode !== null && child.exitCode !== 0) || Date.now() >= deadline) {
      const failure = await fs
        .readFile(path.join(path.dirname(readyFile), 'error.txt'), 'utf8')
        .catch(() => '');
      throw Error(
        `更新辅助进程未能启动。${(failure || diagnostics).slice(-1500)} 日志：${path.dirname(readyFile)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function prepareUpdateInstall({
  asset,
  userData,
  portable,
  platform = process.platform,
  executable = process.execPath,
  env = process.env,
  pid = process.pid,
}) {
  if ((await hashFile(asset.file)) !== asset.sha256) throw Error('更新文件校验失败。');
  if (platform === 'win32' && !portable) {
    const target = path.dirname(executable);
    const manifest = JSON.parse(
      await fs.readFile(path.join(target, '.freecut-install.json'), 'utf8').catch(() => {
        throw Error('当前不是新版安装器管理的目录，请先使用 0.3 或更新版安装包安装一次。');
      }),
    );
    if (!manifest || typeof manifest !== 'object') throw Error('安装记录无效。');
    return () =>
      detached(asset.file, [
        '--update',
        '--install-dir',
        target,
        '--auto-run',
        '--wait-pid',
        String(pid),
      ]);
  }
  const helperDir = await fs.mkdtemp(path.join(userData, 'updates', 'apply-'));
  if (platform === 'win32') {
    const target = portableTarget(env);
    await fs.access(target);
    const helper = path.join(helperDir, 'apply.ps1');
    const plan = path.join(helperDir, 'plan.json');
    await fs.copyFile(path.join(__dirname, 'update-portable.ps1'), helper);
    await fs.writeFile(
      plan,
      JSON.stringify({ source: asset.file, target, sha256: asset.sha256, processId: pid }),
    );
    return () =>
      detached(
        path.join(
          env.SystemRoot || 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        ),
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          helper,
          '-Plan',
          plan,
          '-Launch',
        ],
        { readyFile: path.join(helperDir, 'ready') },
      );
  }
  if (platform === 'darwin') {
    const suffix = '/Contents/MacOS/FreeCut';
    if (!executable.endsWith(suffix))
      throw Error('请先把 FreeCut.app 安装到 Applications 或可写文件夹。');
    const target = executable.slice(0, -suffix.length);
    if (
      target.startsWith('/Volumes/') ||
      target.includes('/AppTranslocation/') ||
      path.dirname(target) === '/'
    )
      throw Error('请先把 FreeCut.app 从磁盘映像拖到 Applications，再检查更新。');
    await fs.access(path.dirname(target), require('node:fs').constants.W_OK);
    const helper = path.join(helperDir, 'apply.sh');
    await fs.copyFile(path.join(__dirname, 'update-mac.sh'), helper);
    return () =>
      detached('/bin/bash', [
        helper,
        asset.file,
        target,
        String(pid),
        asset.sha256,
        asset.version.replace(/^v/, '').split('-')[0],
      ]);
  }
  throw Error('当前平台不支持安装更新。');
}
module.exports = { portableTarget, prepareUpdateInstall, detached };
