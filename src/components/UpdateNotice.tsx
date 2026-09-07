import { statusText, useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import type { UpdateState } from '../types';
import './update-notice.css';

export function UpdateSettings() {
  const { t } = useI18n();
  const [state, setState] = useState<UpdateState>();
  useEffect(() => {
    const api = window.freecut;
    if (!api?.updateState) return;
    void api.updateState().then(setState);
    return api.onUpdateState(setState);
  }, []);
  if (!state || state.phase === 'disabled') return null;
  const pending = ['checking', 'downloading', 'installing'].includes(state.phase);
  return (
    <section className="home-settings update-settings">
      <h2>{t('软件更新')}</h2>
      <div className="home-setting">
        <div>
          <strong>{t('自动检查、下载并安装更新')}</strong>
          <p>
            {' '}
            {t(
              '连接 Watertube-bilibili/freecut-desktop 的 GitHub Release。安装前仍会询问是否保存修改；忙碌时等待，不中断导出。',
            )}{' '}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={state.automatic}
          onClick={() => void window.freecut!.setAutomaticUpdates(!state.automatic).then(setState)}
        >
          {state.automatic ? t('已开启') : t('已关闭')}
        </button>
      </div>
      <div className="home-setting">
        <div>
          <strong>
            {state.version ? t('发现 {v0}', { v0: state.version }) : state.currentVersion}
          </strong>
          <p role="status">
            {statusText(state.message)}
            {state.phase === 'downloading' && ` ${Math.round(state.progress * 100)}%`}
          </p>
        </div>
        <button
          disabled={pending}
          onClick={() =>
            void (
              state.phase === 'ready'
                ? window.freecut!.installUpdate()
                : window.freecut!.checkUpdate().then(setState)
            ).catch((error) => setState({ ...state, message: String(error) }))
          }
        >
          <RefreshCw size={15} />
          {state.phase === 'ready' ? t('安装并重启') : t('检查更新')}
        </button>
      </div>
    </section>
  );
}

export default function UpdateNotice({ busy }: { busy: boolean }) {
  const { t } = useI18n();
  const [state, setState] = useState<UpdateState>();
  const [remaining, setRemaining] = useState(20);
  const [deferred, setDeferred] = useState('');
  const [hidden, setHidden] = useState(false);
  const attempted = useRef('');
  useEffect(() => {
    const api = window.freecut;
    if (!api?.updateState) return;
    void api.updateState().then(setState);
    return api.onUpdateState((value) => {
      setState(value);
      if (value.phase === 'ready') setHidden(false);
    });
  }, []);
  useEffect(() => {
    setRemaining(20);
  }, [state?.version]);
  const canInstall = state?.phase === 'ready' && !busy;
  const auto =
    canInstall &&
    state.automatic &&
    deferred !== state.version &&
    attempted.current !== state.version;
  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [auto]);
  async function install() {
    if (!state?.version || busy) return;
    attempted.current = state.version;
    try {
      await window.freecut!.installUpdate();
    } catch (error) {
      setState({ ...state, message: String(error) });
    }
  }
  useEffect(() => {
    if (auto && remaining === 0) void install();
  }, [auto, remaining]);
  if (!state || hidden || !['downloading', 'ready', 'installing'].includes(state.phase))
    return null;
  return (
    <aside className="update-notice" aria-label={t('FreeCut 软件更新')}>
      <Download size={18} />
      <div>
        <strong>
          {state.version} {state.phase === 'downloading' ? t('正在下载') : t('更新已就绪')}
        </strong>
        <p>
          {state.phase === 'downloading'
            ? t('{v0}% · 下载后自动校验', { v0: Math.round(state.progress * 100) })
            : busy
              ? t('当前任务结束后安装，工程保存提示仍会保留。')
              : auto
                ? t('{v0} 秒后准备重启安装；有修改会先询问保存。', { v0: remaining })
                : statusText(state.message)}
        </p>
        {state.phase === 'downloading' && <progress max={1} value={state.progress} />}
      </div>
      {state.phase === 'ready' && (
        <>
          <button disabled={!canInstall} onClick={() => void install()}>
            {' '}
            {t('立即安装')}{' '}
          </button>
          <button
            onClick={() => {
              setDeferred(state.version || '');
              setHidden(true);
            }}
          >
            {' '}
            {t('稍后')}{' '}
          </button>
        </>
      )}
      {state.phase === 'downloading' && (
        <button className="icon-button" title={t('收起更新进度')} onClick={() => setHidden(true)}>
          <X size={16} />
        </button>
      )}
    </aside>
  );
}
