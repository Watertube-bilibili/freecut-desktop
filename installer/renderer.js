'use strict';
const api = window.freecutInstaller;
const byId = (id) => document.getElementById(id);
let state,
  selection = '';
const formatBytes = (bytes) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${Math.ceil(bytes / 1024 ** 2)} MB`;
function showError(error) {
  byId('error').hidden = false;
  byId('error').textContent = error.message ?? String(error);
}
function choose(value) {
  selection = value;
  // Native selection can be a drive root. The backend independently rejects a
  // raw root if an IPC caller bypasses this presentation normalization.
  if (/^[a-z]:[\\/]?$/i.test(selection)) selection = selection.slice(0, 2) + '\\FreeCut';
  render(state);
}
function render(next) {
  state = next;
  const uninstall = state.mode === 'uninstall',
    update = state.mode === 'update';
  const complete = state.phase === 'complete',
    busy = state.busy;
  const target = update || uninstall ? state.target : selection;
  byId('edition').textContent = `FreeCut ${state.version} · Windows`;
  byId('heading').textContent = uninstall
    ? '卸载水管剪辑'
    : update
      ? '更新水管剪辑'
      : '安装水管剪辑';
  byId('sectionMark').textContent = uninstall ? '管理应用' : update ? '继续创作' : '开始创作';
  byId('intro').textContent = uninstall
    ? '仅移除程序文件，工程与 AI 模型会保留。'
    : update
      ? '安装位置保持不变，更新完成后继续创作。'
      : '选择一个位置，让创作开始。';
  byId('locationView').hidden = update || uninstall || busy || complete;
  byId('destination').hidden = complete;
  byId('target').textContent = target || '尚未选择';
  byId('target').title = target;
  byId('size').textContent = uninstall
    ? '经过修改或不在安装清单中的文件会保留。'
    : `程序文件约 ${formatBytes(state.totalBytes)} · 不含 AI 模型`;
  for (const letter of ['C', 'D']) byId(`drive${letter}`).disabled = true;
  for (const drive of state.drives) {
    const button = byId(`drive${drive.letter}`);
    button.disabled = !drive.available || busy || !state.ready;
    button.title = drive.reason || `安装到 ${drive.target}`;
    button.setAttribute(
      'aria-pressed',
      String(target.toLowerCase() === drive.target.toLowerCase()),
    );
    button.querySelector('.drive-path').textContent = drive.available
      ? drive.target
      : '此磁盘不可用';
  }
  byId('driveNote').textContent =
    state.drives.find((drive) => drive.letter === 'D' && !drive.available)?.reason ||
    'C 盘使用当前用户程序目录，无需管理员权限。';
  byId('choose').disabled = busy || !state.ready;
  byId('progressView').hidden = !busy;
  byId('progress').value = Math.max(0, Math.min(100, state.progress));
  byId('percentage').textContent = `${Math.floor(state.progress)}%`;
  byId('progressLabel').textContent = state.message;
  byId('progressLabel').title = state.message;
  byId('progressDetail').textContent =
    state.phase === 'waiting'
      ? '最多等待 120 秒，不会强制结束应用。'
      : state.cancellable
        ? `${formatBytes(state.completedBytes)} / ${formatBytes(state.totalBytes)}`
        : '正在完成文件替换，此步骤暂时不能取消。';
  byId('completeView').hidden = !complete;
  byId('error').hidden = !state.error;
  byId('error').textContent = state.error;
  byId('warnings').hidden = !state.warnings.length;
  byId('warnings').textContent = state.warnings.join('\n');
  byId('footnote').textContent = uninstall
    ? '确认后安装窗口会关闭，后台完成程序文件移除。'
    : complete
      ? target
      : '程序与按需下载的 AI 模型分开安装。';
  byId('cancel').hidden = !busy || !state.cancellable;
  byId('primary').hidden = busy;
  byId('primary').disabled = !state.ready || (!target && !complete);
  byId('primary').textContent = complete
    ? '启动水管剪辑 →'
    : uninstall
      ? '确认卸载'
      : update
        ? '重试更新 →'
        : target
          ? '安装水管剪辑 →'
          : '选择安装位置 →';
  byId('done').hidden = !complete;
}
document.querySelectorAll('[data-drive]').forEach((button) =>
  button.addEventListener('click', async () => {
    const drive = state.drives.find((item) => item.letter === button.dataset.drive);
    if (!drive?.available || state.busy || !state.ready) return;
    choose(drive.target);
    try {
      await api.install(selection);
    } catch (error) {
      showError(error);
    }
  }),
);
byId('choose').addEventListener('click', async () => {
  try {
    const value = await api.choose();
    if (value) choose(value);
  } catch (error) {
    showError(error);
  }
});
byId('primary').addEventListener('click', async () => {
  try {
    if (state.phase === 'complete') await api.launch();
    else if (state.mode === 'uninstall') await api.uninstall();
    else await api.install(state.mode === 'update' ? state.target : selection);
  } catch (error) {
    showError(error);
  }
});
byId('cancel').addEventListener('click', () => api.cancel().catch(showError));
byId('done').addEventListener('click', () => api.close().catch(showError));
api.onProgress(render);
api
  .state()
  .then((next) => {
    // A caller-supplied, backend-validated --install-dir is an explicit choice;
    // ordinary first launch still leaves selection empty until a user acts.
    if (next.mode === 'install' && next.target) selection = next.target;
    render(next);
  })
  .catch(showError);
