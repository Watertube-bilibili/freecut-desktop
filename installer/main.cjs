'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const backend = require('./backend.cjs');

const args = process.argv.slice(1);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const uninstallMode = args.includes('--uninstall');
// Only a packaged FreeCut process can select its own executable tree as payload.
// No renderer IPC field or environment variable can enable this mode.
const embeddedInstall = app.isPackaged && args.includes('--installer');
const updateMode = args.includes('--update');
const silent = args.includes('--silent');
const autoRun = args.includes('--auto-run');
const explicitTarget = option('--install-dir');
const waitPidValue = option('--wait-pid');
const testHome =
  !app.isPackaged && process.env.FREECUT_INSTALLER_TEST_HOME
    ? path.resolve(process.env.FREECUT_INSTALLER_TEST_HOME)
    : undefined;
const payloadRoot = embeddedInstall
  ? path.dirname(process.execPath)
  : !app.isPackaged && process.env.FREECUT_INSTALLER_PAYLOAD_DIR
    ? path.resolve(process.env.FREECUT_INSTALLER_PAYLOAD_DIR)
    : path.join(process.resourcesPath, 'freecut-payload');
const pageURL = pathToFileURL(path.join(__dirname, 'index.html')).href;
let window,
  controller,
  installedResult,
  allowClose = false,
  starting = false;
const state = {
  mode: uninstallMode ? 'uninstall' : updateMode ? 'update' : 'install',
  version: '0.3.0',
  target: '',
  busy: false,
  phase: 'ready',
  message: '',
  progress: 0,
  cancellable: false,
  error: '',
  warnings: [],
  totalBytes: 0,
  completedBytes: 0,
  drives: [],
  ready: false,
};
app.setName('FreeCut Installer');
const explicitProfile = app.commandLine.getSwitchValue('user-data-dir');
const profileDirectory = explicitProfile
  ? path.resolve(explicitProfile)
  : path.join(testHome ?? app.getPath('appData'), 'FreeCut Installer');
app.setPath('userData', profileDirectory);
app.setPath('sessionData', profileDirectory);

function publish(patch = {}) {
  Object.assign(state, patch);
  if (window && !window.isDestroyed()) window.webContents.send('freecut-installer:progress', state);
}
function validateSender(event) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== pageURL
  )
    throw Error('Invalid installer IPC sender');
}
function registryKey(target) {
  return (
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\FreeCut-' +
    crypto
      .createHash('sha256')
      .update(path.resolve(target).toLowerCase())
      .digest('hex')
      .slice(0, 16)
  );
}
const run = (exe, argv) =>
  new Promise((resolve, reject) => {
    const child = spawn(exe, argv, {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let errorText = '';
    child.stderr.on('data', (chunk) => {
      errorText = (errorText + chunk).slice(-3000);
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error(errorText || `辅助程序退出码 ${code}`)),
    );
  });
async function installIntegrations(result) {
  if (process.platform !== 'win32') return ['快捷方式和卸载注册仅适用于 Windows。'];
  const warnings = [];
  const desktop = testHome ? path.join(testHome, 'Desktop') : app.getPath('desktop');
  const programs = testHome
    ? path.join(testHome, 'StartMenu')
    : path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  for (const directory of [desktop, programs]) {
    try {
      await fs.mkdir(directory, { recursive: true });
      const file = path.join(directory, 'FreeCut.lnk');
      let operation = 'create';
      if (
        await fs.stat(file).then(
          () => true,
          () => false,
        )
      ) {
        const previous = shell.readShortcutLink(file);
        if (
          path.resolve(previous.target).toLowerCase() !==
          path.resolve(result.executable).toLowerCase()
        ) {
          warnings.push(`保留已有快捷方式：${file}`);
          continue;
        }
        operation = 'replace';
      }
      if (
        !shell.writeShortcutLink(file, operation, {
          target: result.executable,
          cwd: result.target,
          icon: result.executable,
          iconIndex: 0,
          description: '水管剪辑 FreeCut',
        })
      )
        throw Error('快捷方式写入失败');
    } catch (error) {
      warnings.push(error.message);
    }
  }
  if (testHome) return [...warnings, '隔离测试：未修改系统卸载注册表。'];
  const helper = path.join(result.target, 'resources', 'freecut-installer', 'main.cjs');
  if (
    !(await fs.stat(helper).then(
      (stat) => stat.isFile(),
      () => false,
    ))
  )
    return [
      ...warnings,
      '安装包未包含卸载入口组件；可重新运行 Setup 并使用 --uninstall --install-dir 指定此目录。',
    ];
  const reg = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');
  const key = registryKey(result.target);
  const command = `"${result.executable}" --uninstall --install-dir "${result.target}"`;
  try {
    const values = {
      DisplayName: '水管剪辑 FreeCut',
      DisplayVersion: result.manifest.version,
      Publisher: 'FreeCut contributors',
      InstallLocation: result.target,
      DisplayIcon: result.executable,
      UninstallString: command,
      QuietUninstallString: command + ' --silent',
      InstallDate: new Date().toISOString().slice(0, 10).replaceAll('-', ''),
    };
    for (const [name, value] of Object.entries(values))
      await run(reg, ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f']);
    for (const name of ['NoModify', 'NoRepair'])
      await run(reg, ['add', key, '/v', name, '/t', 'REG_DWORD', '/d', '1', '/f']);
  } catch (error) {
    warnings.push(`Windows 卸载入口未创建：${error.message}`);
  }
  return warnings;
}

async function waitForOldProcess(signal) {
  if (waitPidValue === undefined) return;
  if (
    !/^\d+$/.test(waitPidValue) ||
    !Number.isSafeInteger(Number(waitPidValue)) ||
    Number(waitPidValue) <= 1 ||
    Number(waitPidValue) === process.pid
  )
    throw Error('等待退出的进程编号无效。');
  const pid = Number(waitPidValue),
    started = Date.now();
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      if (error.code === 'EPERM') return true;
      throw error;
    }
  };
  while (alive()) {
    if (signal.aborted) throw Object.assign(Error('更新已取消。'), { name: 'AbortError' });
    if (Date.now() - started > 120000)
      throw Error('等待 FreeCut 退出超过 120 秒。请关闭应用后重试，安装器没有终止任何进程。');
    publish({ phase: 'waiting', message: '正在等待 FreeCut 保存并退出…', cancellable: true });
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

async function launchInstalled() {
  if (!installedResult) throw Error('请先完成安装。');
  const { target, installed } = await backend.inspectTarget(installedResult.target, {
    update: true,
  });
  const executable = path.join(target, installed.entryPoint);
  await backend.assertNoLinks(executable);
  const env = { ...process.env };
  delete env.PORTABLE_EXECUTABLE_DIR;
  delete env.PORTABLE_EXECUTABLE_FILE;
  delete env.PORTABLE_EXECUTABLE_APP_FILENAME;
  delete env.FREECUT_INSTALLER_PAYLOAD_DIR;
  delete env.FREECUT_INSTALLER_TEST_HOME;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [], {
    cwd: target,
    detached: true,
    stdio: 'ignore',
    env,
    windowsHide: false,
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
}

async function beginInstall(target) {
  if (state.busy || starting) throw Error('安装已在进行。');
  starting = true;
  controller = new AbortController();
  try {
    if (process.platform !== 'win32')
      throw Error('此安装器用于 Windows，请下载对应的 macOS 安装包。');
    const forbiddenRoots = [payloadRoot, process.resourcesPath, path.dirname(process.execPath)];
    const actual = backend.validateTarget(target, { forbiddenRoots });
    publish({
      target: actual,
      busy: true,
      error: '',
      warnings: [],
      progress: 0,
      completedBytes: 0,
      phase: 'checking',
      message: '正在检查安装位置',
      cancellable: true,
    });
    await waitForOldProcess(controller.signal);
    installedResult = await backend.install({
      payloadRoot,
      embedded: embeddedInstall,
      target: actual,
      update: updateMode,
      forbiddenRoots,
      signal: controller.signal,
      onProgress: publish,
    });
    const warnings = await installIntegrations(installedResult);
    publish({
      busy: false,
      phase: 'complete',
      message: '水管剪辑已经准备好了。',
      progress: 100,
      cancellable: false,
      warnings,
    });
    if (autoRun) await launchInstalled();
    if (silent || autoRun) {
      allowClose = true;
      app.quit();
    }
  } catch (error) {
    publish({
      busy: false,
      phase: error.name === 'AbortError' ? 'cancelled' : 'failed',
      error: error.message,
      message: error.name === 'AbortError' ? '已取消安装' : '安装未完成',
      cancellable: false,
    });
    if (silent) {
      process.exitCode = 1;
      allowClose = true;
      app.exit(1);
    }
  } finally {
    starting = false;
  }
}

async function beginUninstall() {
  if (state.busy || !uninstallMode) throw Error('当前不能卸载。');
  if (process.platform !== 'win32') throw Error('此卸载入口用于 Windows。');
  const { target, installed } = await backend.inspectTarget(explicitTarget, { update: true });
  publish({
    busy: true,
    phase: 'uninstalling',
    message: '正在准备卸载，只移除安装清单内的程序文件',
    progress: 10,
    cancellable: false,
  });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-uninstall-'));
  const helper = path.join(directory, 'uninstall.ps1'),
    planFile = path.join(directory, 'plan.json');
  await fs.copyFile(path.join(__dirname, 'uninstall.ps1'), helper);
  const desktop = testHome ? path.join(testHome, 'Desktop') : app.getPath('desktop');
  const programs = testHome
    ? path.join(testHome, 'StartMenu')
    : path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const plan = {
    target,
    installId: installed.installId,
    ownershipHash: await backend.sha256(path.join(target, backend.OWNERSHIP)),
    product: backend.PRODUCT,
    files: installed.files,
    pid: process.pid,
    executable: path.join(target, installed.entryPoint),
    registryKey: testHome ? null : registryKey(target),
    shortcuts: [path.join(desktop, 'FreeCut.lnk'), path.join(programs, 'FreeCut.lnk')],
    silent,
    logFile: path.join(directory, 'result.json'),
    readyFile: path.join(directory, 'ready'),
  };
  await fs.writeFile(planFile, JSON.stringify(plan, null, 2));
  const powershell = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  // Windows PowerShell must not inherit a PowerShell 7 / host-specific module
  // search path. Keep a standalone log even if parsing or module loading fails
  // before the helper can produce its structured result.
  const helperEnv = { ...process.env };
  for (const key of Object.keys(helperEnv))
    if (key.toLowerCase() === 'psmodulepath') delete helperEnv[key];
  helperEnv.PSModulePath = path.join(path.dirname(powershell), 'Modules');
  const helperLog = await fs.open(path.join(directory, 'launcher.log'), 'a');
  let child;
  try {
    child = spawn(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        helper,
        '-PlanPath',
        planFile,
        '-Launch',
      ],
      {
        // This short bootstrap only calls Start-Process. The actual worker must
        // get its own hidden console so it survives the uninstall window.
        detached: false,
        stdio: ['ignore', helperLog.fd, helperLog.fd],
        windowsHide: true,
        shell: false,
        env: helperEnv,
        cwd: directory,
      },
    );
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
  } finally {
    await helperLog.close();
  }
  child.unref();
  // The window stays alive until the independent helper has loaded its plan.
  // A successful CreateProcess alone does not prove that PowerShell started.
  const readyDeadline = Date.now() + 15000;
  while (
    !(await fs.stat(plan.readyFile).then(
      () => true,
      () => false,
    ))
  ) {
    if ((child.exitCode !== null && child.exitCode !== 0) || Date.now() >= readyDeadline) {
      const detail = await fs
        .readFile(path.join(directory, 'launcher.log'), 'utf8')
        .catch(() => '');
      throw Error(
        `卸载辅助进程未能启动（退出码 ${child.exitCode ?? '超时'}）。日志：${directory}${detail ? '\n' + detail.slice(-1500) : ''}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  allowClose = true;
  app.quit();
}

async function initialize() {
  if ((updateMode || uninstallMode || silent) && !explicitTarget)
    throw Error('此模式需要 --install-dir 指定完整安装目录。');
  if (explicitTarget) state.target = backend.validateTarget(explicitTarget);
  if (uninstallMode) {
    const result = await backend.inspectTarget(state.target, { update: true });
    state.version = result.installed.version;
  } else {
    const manifest = await backend.readManifest(
      path.join(payloadRoot, embeddedInstall ? backend.EMBEDDED_MANIFEST : 'manifest.json'),
    );
    state.version = manifest.version;
    state.totalBytes = manifest.totalBytes;
  }
  state.drives = await Promise.all(
    ['C', 'D'].map(async (letter) => {
      const root = `${letter}:\\`;
      const available = await fs.stat(root).then(
        (stat) => stat.isDirectory(),
        () => false,
      );
      const localPrograms = process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Programs', 'FreeCut')
        : '';
      const userInstallOnC = /^c:\\/i.test(localPrograms);
      const target = letter === 'C' && userInstallOnC ? localPrograms : `${letter}:\\FreeCut`;
      const usable = available && (letter !== 'C' || userInstallOnC);
      return {
        letter,
        available: usable,
        target,
        reason: !available
          ? `这台电脑没有可用的 ${letter} 盘`
          : letter === 'C' && !userInstallOnC
            ? '当前用户的本地程序目录不在 C 盘；可自定义选择有写入权限的 C 盘目录'
            : '',
      };
    }),
  );
  state.ready = true;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      try {
        await initialize();
      } catch (error) {
        state.error = error.message;
        state.phase = 'failed';
      }
      window = new BrowserWindow({
        width: 820,
        height: 620,
        minWidth: 760,
        minHeight: 560,
        resizable: false,
        show: false,
        title: uninstallMode ? '卸载水管剪辑' : '安装水管剪辑',
        backgroundColor: '#111816',
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => {
        if (url !== pageURL) event.preventDefault();
      });
      window.on('close', async (event) => {
        if (allowClose || !state.busy) return;
        event.preventDefault();
        if (!state.cancellable) return;
        const answer = await dialog.showMessageBox(window, {
          type: 'question',
          title: '取消安装',
          message: '要取消这次安装吗？',
          buttons: ['继续安装', '取消安装'],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer.response === 1) controller?.abort();
      });
      ipcMain.handle('freecut-installer:state', (event) => {
        validateSender(event);
        return state;
      });
      ipcMain.handle('freecut-installer:choose', async (event) => {
        validateSender(event);
        if (state.busy || updateMode || uninstallMode) return null;
        const result = await dialog.showOpenDialog(window, {
          title: '选择安装目录',
          properties: ['openDirectory', 'createDirectory'],
          defaultPath: state.target || undefined,
        });
        if (result.canceled) return null;
        return backend.normalizeSelection(result.filePaths[0]);
      });
      ipcMain.handle('freecut-installer:install', async (event, value) => {
        validateSender(event);
        if (!state.ready || uninstallMode || typeof value !== 'string' || value.length > 2200)
          throw Error('安装请求无效。');
        if (
          updateMode &&
          path.resolve(value).toLowerCase() !== path.resolve(explicitTarget).toLowerCase()
        )
          throw Error('更新目标不能更改。');
        await beginInstall(value);
      });
      ipcMain.handle('freecut-installer:cancel', (event) => {
        validateSender(event);
        if (!state.cancellable) return false;
        controller?.abort();
        return true;
      });
      ipcMain.handle('freecut-installer:launch', async (event) => {
        validateSender(event);
        if (state.phase !== 'complete') throw Error('安装尚未完成。');
        await launchInstalled();
        allowClose = true;
        app.quit();
      });
      ipcMain.handle('freecut-installer:uninstall', async (event) => {
        validateSender(event);
        try {
          await beginUninstall();
        } catch (error) {
          publish({ busy: false, phase: 'failed', error: error.message });
        }
      });
      ipcMain.handle('freecut-installer:close', (event) => {
        validateSender(event);
        window.close();
      });
      await window.loadFile(path.join(__dirname, 'index.html'));
      if (!silent) window.show();
      if (state.ready && (updateMode || silent)) {
        if (uninstallMode) await beginUninstall();
        else await beginInstall(state.target);
      } else if (silent && !state.ready) app.exit(1);
    })
    .catch((error) => {
      console.error(error.message);
      app.exit(1);
    });
  app.on('window-all-closed', () => app.quit());
}
