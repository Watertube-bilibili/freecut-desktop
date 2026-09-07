import { statusText, useI18n } from '../i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { Download, X, AudioLines, Captions, Check, LoaderCircle, AlertCircle } from 'lucide-react';
import type { Clip, DesktopAPI, MediaAsset, Project } from '../types';
import type { AIApi, AIProgress, AIStatus } from '../ai-types';
import './ai-panel.css';

interface Props {
  project: Project;
  selectedClip?: Clip;
  playhead: number;
  onAddAsset: (asset: MediaAsset) => void;
  onAddSubtitles: (items: { start: number; duration: number; text: string }[]) => void;
  onClose: () => void;
  /** Optional independent voice provider UI, e.g. ChatTTS. */
  extraVoicePanel?: ReactNode;
  initialTab?: 'asr' | 'tts';
}
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
export default function AIPanel({
  project,
  selectedClip,
  playhead,
  onAddAsset,
  onAddSubtitles,
  onClose,
  extraVoicePanel,
  initialTab = 'asr',
}: Props) {
  const { t } = useI18n();
  const api = window.freecut as (DesktopAPI & AIApi) | undefined;
  const available = !!api?.aiStatus;
  const [tab, setTab] = useState<'asr' | 'tts'>(initialTab);
  const [provider, setProvider] = useState<'sherpa' | 'extra'>('sherpa');
  const [status, setStatus] = useState<AIStatus>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AIProgress>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [language, setLanguage] = useState<'auto' | 'zh' | 'en'>('zh');
  const [asrModel, setAsrModel] = useState<'asr-sensevoice' | 'asr-zh-en'>('asr-sensevoice');
  const [text, setText] = useState('你好，欢迎使用水管剪辑。让创意自由表达。');
  const [speakerId, setSpeakerId] = useState(88);
  const [speed, setSpeed] = useState(1);
  const [subtitles, setSubtitles] = useState<{ start: number; duration: number; text: string }[]>(
    [],
  );
  const [audio, setAudio] = useState<MediaAsset>();
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (!available || !api) return;
    let live = true;
    api
      .aiStatus()
      .then((s) => {
        if (live) setStatus(s);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    const unsubscribe = api.onAIProgress((p) => {
      if (live) setProgress(p);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [available]);
  const modelId = tab === 'asr' ? asrModel : 'tts-zh';
  const model = status?.models.find((m) => m.id === modelId);
  const ready = status?.runtimeReady && model?.installed;
  const asset = project.assets.find((a) => a.id === selectedClip?.assetId);
  const validClip =
    !!selectedClip && !!asset?.path && ['audio', 'video'].includes(selectedClip.kind);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    setProgress(undefined);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (api)
        api
          .aiStatus()
          .then(setStatus)
          .catch(() => undefined);
    }
  }
  function transcribe() {
    if (!api || !selectedClip || !asset?.path) return;
    const clip = { ...selectedClip };
    void run(async () => {
      const result = await api.aiTranscribe({
        assetId: asset.id,
        path: asset.path!,
        inPoint: clip.inPoint,
        duration: clip.duration * clip.speed,
        language,
        modelId: asrModel,
      });
      const mapped = result.items
        .map((s) => ({
          start: clip.start + s.start / clip.speed,
          duration: Math.min(s.duration / clip.speed, clip.duration - s.start / clip.speed),
          text: s.text,
        }))
        .filter((s) => s.duration > 0);
      setSubtitles(mapped);
      setApplied(false);
      setNotice(
        mapped.length
          ? t('识别出 {count} 条字幕，可修改文字后加入时间轴。', { count: mapped.length })
          : t('没有检测到有效语音，请检查音轨或尝试其他语言。'),
      );
    });
  }
  return (
    <div
      className="ai-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section className="ai-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-title">
        <header>
          <h2 id="ai-title">{t('字幕与语音')}</h2>
          <button className="ai-icon-button" title={t('关闭')} disabled={busy} onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="ai-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'asr'}
            className={tab === 'asr' ? 'active' : ''}
            disabled={busy}
            onClick={() => {
              setTab('asr');
              setError('');
            }}
          >
            <Captions size={17} /> {t('自动字幕')}{' '}
          </button>
          <button
            role="tab"
            aria-selected={tab === 'tts'}
            className={tab === 'tts' ? 'active' : ''}
            disabled={busy}
            onClick={() => {
              setTab('tts');
              setError('');
            }}
          >
            <AudioLines size={17} /> {t('语音朗读')}{' '}
          </button>
        </div>
        {!available ? (
          <div className="ai-empty">
            <AlertCircle />
            <h3>{t('请在桌面版中使用')}</h3>
            <p>{t('模型下载与本地语音处理需要 Windows 或 macOS 桌面应用。')}</p>
          </div>
        ) : (
          <>
            {tab === 'tts' && extraVoicePanel && (
              <label className="ai-field">
                {' '}
                {t('语音引擎')}{' '}
                <select
                  value={provider}
                  disabled={busy}
                  onChange={(e) => setProvider(e.target.value as 'sherpa' | 'extra')}
                >
                  <option value="sherpa">{t('AISHELL-3 · 轻量中文朗读')}</option>
                  <option value="extra">{t('ChatTTS · 自然对话语音')}</option>
                </select>
              </label>
            )}
            {tab === 'tts' && provider === 'extra' && extraVoicePanel ? (
              extraVoicePanel
            ) : (
              <>
                {tab === 'asr' && (
                  <label className="ai-field">
                    {' '}
                    {t('识别模型')}{' '}
                    <select
                      value={asrModel}
                      disabled={busy}
                      onChange={(e) => setAsrModel(e.target.value as typeof asrModel)}
                    >
                      <option value="asr-sensevoice">
                        {t('SenseVoice Small · 中文优先 · 239.5 MB')}
                      </option>
                      <option value="asr-zh-en">{t('Whisper tiny · 更小 · 103.6 MB')}</option>
                    </select>
                  </label>
                )}
                <div className="ai-model-card">
                  <div>
                    <strong>
                      {(model?.name ? t(model.name) : undefined) ||
                        (tab === 'asr'
                          ? t('Whisper tiny · 中英识别')
                          : t('AISHELL-3 · 中文 174 音色'))}
                    </strong>
                    <p>
                      {model
                        ? t('模型下载 {v0} · 安装后约 {v1} · CPU 本地运行', {
                            v0: mb(model.bytes),
                            v1: mb(model.diskBytes),
                          })
                        : t('正在检查本地组件…')}
                    </p>
                    <span>
                      {ready ? (
                        <>
                          <Check size={13} /> {t('已安装，可以离线使用')}{' '}
                        </>
                      ) : (
                        t('首次使用需联网下载，完成后不上传音视频')
                      )}
                    </span>
                  </div>
                  <button
                    className={ready ? 'ai-secondary' : 'ai-primary'}
                    disabled={busy || !status?.supported}
                    onClick={() =>
                      void run(async () => {
                        if (api) setStatus(await api.aiInstall({ modelId }));
                      })
                    }
                  >
                    {ready ? (
                      t('校验 / 修复')
                    ) : (
                      <>
                        <Download size={15} /> {t('一键下载安装')}{' '}
                      </>
                    )}
                  </button>
                </div>
                {status && !status.supported && (
                  <p className="ai-error">
                    {' '}
                    {t('当前架构')} {status.platform}{' '}
                    {t('暂不支持。可用版本：Windows x64、Mac Intel / Apple 芯片。')}{' '}
                  </p>
                )}
                {tab === 'asr' ? (
                  <div className="ai-section">
                    <label className="ai-field">
                      {' '}
                      {t('识别对象')}{' '}
                      <div className="ai-selection">
                        {validClip ? selectedClip?.name : t('请先在时间轴选择一个视频或音频片段')}
                      </div>
                    </label>
                    <label className="ai-field">
                      {' '}
                      {t('语音语言')}{' '}
                      <select
                        value={language}
                        disabled={busy}
                        onChange={(e) => setLanguage(e.target.value as typeof language)}
                      >
                        <option value="zh">{t('中文')}</option>
                        <option value="en">{t('英语')}</option>
                        <option value="auto">{t('自动检测')}</option>
                      </select>
                    </label>
                    <p className="ai-help">
                      {' '}
                      {t(
                        '识别所选片段的源音轨，字幕随片段位置与速度对齐。当前按语音停顿分句，时间为句级估计；复杂配乐、方言及其他识别结果需要校对。每次最多处理 1 小时源音频。',
                      )}{' '}
                    </p>
                    <button
                      className="ai-primary ai-run"
                      disabled={busy || !ready || !validClip}
                      onClick={transcribe}
                    >
                      <Captions size={16} /> {t('识别字幕')}{' '}
                    </button>
                    {!!subtitles.length && (
                      <div className="ai-results">
                        <div className="ai-result-title">
                          <strong>
                            {t('识别结果 ·')} {subtitles.length} {t('条')}
                          </strong>
                          <span>{t('可直接修改')}</span>
                        </div>
                        <div className="ai-subtitle-list">
                          {subtitles.map((s, i) => (
                            <label key={i}>
                              <span>{s.start.toFixed(1)}s</span>
                              <input
                                aria-label={t('第 {v0} 条字幕', { v0: i + 1 })}
                                value={s.text}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setSubtitles((items) =>
                                    items.map((item, j) =>
                                      j === i ? { ...item, text: value } : item,
                                    ),
                                  );
                                  setApplied(false);
                                }}
                              />
                            </label>
                          ))}
                        </div>
                        <button
                          className="ai-primary"
                          disabled={busy || applied}
                          onClick={() => {
                            onAddSubtitles(subtitles.filter((s) => s.text.trim()));
                            setApplied(true);
                          }}
                        >
                          {applied ? t('已加入时间轴') : t('加入字幕轨道')}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="ai-section">
                    <label className="ai-field">
                      {' '}
                      {t('朗读文本')}{' '}
                      <textarea
                        maxLength={3000}
                        rows={5}
                        value={text}
                        disabled={busy}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={t('输入要朗读的中文文本')}
                      />
                      <span className="ai-count">{text.length} / 3000</span>
                    </label>
                    <div className="ai-row">
                      <label className="ai-field">
                        {' '}
                        {t('中文音色')}{' '}
                        <select
                          value={speakerId}
                          disabled={busy}
                          onChange={(e) => setSpeakerId(Number(e.target.value))}
                        >
                          {Array.from({ length: 174 }, (_, i) => (
                            <option key={i} value={i}>
                              {' '}
                              {t('音色')} {String(i).padStart(3, '0')}
                              {i === 88 ? t(' · 推荐试听') : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="ai-field">
                        {' '}
                        {t('语速')}{' '}
                        <select
                          value={speed}
                          disabled={busy}
                          onChange={(e) => setSpeed(Number(e.target.value))}
                        >
                          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((n) => (
                            <option key={n} value={n}>
                              {n} ×
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="ai-help">
                      {' '}
                      {t(
                        '适合普通话朗读。英语词句暂不保证发音质量。生成后可先试听，再放到时间轴。',
                      )}{' '}
                    </p>
                    <button
                      className="ai-primary ai-run"
                      disabled={busy || !ready || !text.trim()}
                      onClick={() =>
                        void run(async () => {
                          if (api) {
                            setAudio(await api.aiSpeak({ text, speakerId, speed }));
                            setApplied(false);
                            setNotice(t('朗读已生成，请试听后加入时间轴。'));
                          }
                        })
                      }
                    >
                      <AudioLines size={16} /> {t('生成朗读')}{' '}
                    </button>
                    {audio && (
                      <div className="ai-results">
                        <audio controls src={audio.url} />
                        <button
                          className="ai-primary"
                          disabled={busy || applied}
                          onClick={() => {
                            onAddAsset(audio);
                            setApplied(true);
                          }}
                        >
                          {applied
                            ? t('已加入时间轴')
                            : t('在 {v0} 秒加入音频', { v0: playhead.toFixed(1) })}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            {(busy || progress) && (
              <div className="ai-progress" aria-live="polite">
                <div>
                  {busy && <LoaderCircle size={15} className="ai-spin" />}
                  <span>{progress?.message ? statusText(progress.message) : t('正在准备…')}</span>
                  {busy && <button onClick={() => void api?.aiCancel()}>{t('取消')}</button>}
                </div>
                {progress && progress.phase !== 'error' && (
                  <progress max={1} value={progress.progress} />
                )}
                {progress?.received !== undefined && (
                  <small>
                    {mb(progress.received)}
                    {progress.total ? ` / ${mb(progress.total)}` : ''}
                  </small>
                )}
              </div>
            )}
            {error && (
              <p className="ai-error" role="alert">
                <AlertCircle size={16} />
                {t('错误详情：{detail}', { detail: t(error) })}
              </p>
            )}
            {notice && (
              <p className="ai-notice" role="status">
                {t(notice)}
              </p>
            )}
            <footer>
              {' '}
              {t(
                '开源组件按需安装，不占用初始安装包。模型来源、校验值与许可见项目 docs/AI-MODELS.md。',
              )}{' '}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
