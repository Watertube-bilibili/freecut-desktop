import { statusText, useI18n } from '../i18n';
import { useEffect, useState } from 'react';
import { Download, Mic2, Plus, RefreshCw, Square, Volume2 } from 'lucide-react';
import type { DesktopAPI, MediaAsset } from '../types';
import './chattts-panel.css';

export interface ChatTTSStatus {
  ready: boolean;
  busy: boolean;
  phase: string;
  progress: number;
  error?: string;
}
interface ChatTTSAPI {
  chatttsStatus(): Promise<ChatTTSStatus>;
  chatttsInstall(): Promise<void>;
  chatttsGenerate(request: { text: string; seed: number; speed: number }): Promise<MediaAsset>;
  chatttsCancel(): Promise<void>;
  onChatTTSProgress(callback: (status: ChatTTSStatus) => void): () => void;
}
const initial: ChatTTSStatus = {
  ready: false,
  busy: false,
  phase: '尚未准备语音模型',
  progress: 0,
};
export default function ChatTTSPanel({ onAddAsset }: { onAddAsset: (asset: MediaAsset) => void }) {
  const { t } = useI18n();
  const api = window.freecut as (DesktopAPI & Partial<ChatTTSAPI>) | undefined;
  const available = Boolean(api?.chatttsStatus && api?.chatttsInstall && api?.chatttsGenerate);
  const [status, setStatus] = useState<ChatTTSStatus>(initial);
  const [text, setText] = useState('你好，欢迎使用水管剪辑。让每一个灵感，都有自己的声音。');
  const [seed, setSeed] = useState(42);
  const [speed, setSpeed] = useState(5);
  const [audio, setAudio] = useState<MediaAsset | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (!available) return;
    let active = true;
    void api!.chatttsStatus!()
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch((reason) => {
        if (active) setError(String(reason.message ?? reason));
      });
    const unsubscribe = api!.onChatTTSProgress?.((value) => {
      if (active) {
        setStatus(value);
        if (value.error) setError(value.error);
      }
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [available]);
  const busy = pending || status.busy;
  async function install() {
    if (!api?.chatttsInstall || busy) return;
    setPending(true);
    setError('');
    try {
      await api.chatttsInstall();
      setStatus(await api.chatttsStatus!());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  }
  async function generate() {
    if (!api?.chatttsGenerate || busy || !text.trim()) return;
    setPending(true);
    setError('');
    setAdded(false);
    try {
      setAudio(await api.chatttsGenerate({ text, seed, speed }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="chattts-panel" aria-label={t('ChatTTS 本地配音')}>
      <div className="chattts-heading">
        <div className="chattts-icon">
          <Mic2 size={19} />
        </div>
        <div>
          <h3>{t('ChatTTS 自然配音')}</h3>
          <p>{t('对话语气 · 中文与英文 · 本地生成')}</p>
        </div>
        <span className="chattts-badge">{t('实验功能')}</span>
      </div>
      <div className="chattts-license">
        <strong>{t('仅限非商业用途')}</strong>
        <span>
          {' '}
          {t(
            '模型采用 CC BY-NC 4.0 许可，适合学习与研究。商用项目请使用其他获得商业授权的音色。',
          )}{' '}
        </span>
      </div>
      {!status.ready && (
        <div className="chattts-setup">
          <p>
            {' '}
            {t('首次使用会自动准备独立运行环境和语音模型，无需打开终端。下载可能超过')}{' '}
            <strong>2 GB</strong>
            {t('，请预留至少')} <strong>6 GB</strong>{' '}
            {t('空间。CPU 生成较慢，准备完成后可离线使用。')}{' '}
          </p>
          <button
            className="chattts-primary"
            onClick={() => void install()}
            disabled={!available || busy}
          >
            <Download size={16} />
            {busy ? t('正在准备…') : t('一键下载并准备')}
          </button>
          {!available && (
            <p className="chattts-muted">{t('请在 FreeCut 桌面应用中使用本地配音。')}</p>
          )}
        </div>
      )}
      {status.ready && (
        <>
          <div className="chattts-ready">
            <span /> {t('运行环境与模型已验证 · 无需联网生成')}{' '}
          </div>
          <label className="chattts-label" htmlFor="chattts-text">
            {' '}
            {t('配音内容')} <span>{text.length}/300</span>
          </label>
          <textarea
            id="chattts-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={300}
            rows={5}
            disabled={busy}
            placeholder={t('输入中文或英文，较长内容建议分段生成。')}
          />
          <div className="chattts-controls">
            <label>
              {' '}
              {t('音色种子')}{' '}
              <div className="chattts-seed">
                <input
                  aria-label={t('音色种子')}
                  type="number"
                  min={0}
                  max={2147483647}
                  step={1}
                  value={seed}
                  disabled={busy}
                  onChange={(event) =>
                    setSeed(
                      Math.max(
                        0,
                        Math.min(2147483647, Math.trunc(Number(event.target.value) || 0)),
                      ),
                    )
                  }
                />
                <button
                  title={t('随机生成一个音色种子')}
                  aria-label={t('换个音色')}
                  disabled={busy}
                  onClick={() => setSeed(Math.floor(Math.random() * 1000000))}
                >
                  <RefreshCw size={15} />
                </button>
              </div>
            </label>
            <label>
              {' '}
              {t('语速风格')}{' '}
              <select
                value={speed}
                disabled={busy}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                <option value={3}>{t('舒缓')}</option>
                <option value={5}>{t('自然')}</option>
                <option value={7}>{t('轻快')}</option>
              </select>
            </label>
          </div>
          <p className="chattts-muted">
            {t('相同种子可复用音色。语气与发音可能变化，生成后请试听。')}
          </p>
          <button
            className="chattts-primary"
            onClick={() => void generate()}
            disabled={busy || !text.trim()}
          >
            <Volume2 size={16} />
            {busy ? t('正在本地合成…') : t('生成配音')}
          </button>
        </>
      )}
      {busy && (
        <div className="chattts-progress" role="status" aria-live="polite">
          <div>
            <span>{statusText(status.phase)}</span>
            <button
              aria-label={t('取消 ChatTTS 任务')}
              onClick={() =>
                void api
                  ?.chatttsCancel?.()
                  .catch((reason) => setError(String(reason.message ?? reason)))
              }
            >
              <Square size={12} /> {t('取消')}{' '}
            </button>
          </div>
          {!status.ready && (
            <progress
              aria-label={t('ChatTTS 准备进度')}
              max={1}
              value={Math.max(0, Math.min(1, status.progress))}
            />
          )}
        </div>
      )}
      {error && (
        <div className="chattts-error" role="alert">
          <strong>{t('操作未完成')}</strong>
          <p>{t('错误详情：{detail}', { detail: t(error) })}</p>
        </div>
      )}
      {audio && (
        <div className="chattts-result">
          <span>{audio.name}</span>
          <audio controls src={audio.url} preload="metadata" aria-label={t('试听 ChatTTS 配音')} />
          <button
            onClick={() => {
              onAddAsset(audio);
              setAdded(true);
            }}
            disabled={busy || added}
          >
            <Plus size={15} />
            {added ? t('已加入素材与时间线') : t('加入时间线')}
          </button>
        </div>
      )}
    </section>
  );
}
