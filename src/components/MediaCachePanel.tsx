import { useEffect, useRef, useState } from 'react';
import { FolderOpen, HardDrive, Loader2, Trash2, X } from 'lucide-react';
import { useI18n } from '../i18n';
import type { MediaAsset } from '../types';
import { mediaCacheAPI, mutateMediaCache, requestMediaCache, setMediaCacheEnabled, useMediaCache } from '../core/use-media-cache';
import './media-cache-panel.css';

function size(bytes: number) { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
export function MediaCachePanel({ assets, onClose }: { assets: MediaAsset[]; onClose: () => void }) {
  const { t } = useI18n(), state = useMediaCache(assets);
  const [height, setHeight] = useState<540 | 720>(540), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const videos = assets.filter(asset => asset.kind === 'video' && asset.path && !asset.missing);
  const running = state.jobs.filter(job => job.state === 'running' || job.state === 'queued');
  const available = Boolean(mediaCacheAPI());
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  async function run(work: () => Promise<unknown>) {
    setError(''); setBusy(true);
    try { await work(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <div className="media-cache-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="media-cache-panel" role="dialog" aria-modal="true" aria-labelledby="media-cache-title" tabIndex={-1} ref={dialog} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]');
        if (nodes?.length) { const first = nodes[0], last = nodes[nodes.length - 1]; if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
      }
    }}>
      <header><h2 id="media-cache-title"><HardDrive size={21}/>{t('代理与媒体缓存')}</h2><button type="button" className="media-cache-close" onClick={onClose} aria-label={t('关闭')}><X size={20}/></button></header>
      <p className="media-cache-intro">{t('生成轻量代理，让高分辨率素材更流畅。预览保留原始音频，导出始终使用原片。')}</p>
      {!available && <p role="status">{t('媒体缓存需要桌面版。')}</p>}
      <label className="media-cache-toggle"><input type="checkbox" checked={state.enabled} onChange={event => setMediaCacheEnabled(event.target.checked)}/><span><strong>{t('流畅预览')}</strong><small>{t('开启后使用已生成代理；关闭后立即切回原片。')}</small></span></label>
      <section className="media-cache-generator">
        <div><h3>{t('视频代理')}</h3><p>{t('降低预览负担，保留原片画质导出')}</p></div>
        <label>{t('预览分辨率')}<select aria-label={t('预览分辨率')} value={height} onChange={event => setHeight(Number(event.target.value) as 540 | 720)}><option value={540}>540p</option><option value={720}>720p</option></select></label>
        <button type="button" className="media-cache-primary" disabled={busy || !available || !videos.length} onClick={() => void run(async () => { for (const asset of videos) await requestMediaCache(asset, 'proxy', height); })}>{t('生成全部视频代理')}</button>
      </section>
      <div className="media-cache-assets">
        {!videos.length && <p className="media-cache-empty">{t('导入视频后可生成代理。')}</p>}
        {videos.map(asset => {
          const proxy = state.entries.find(entry => entry.assetPath === asset.path)?.proxy;
          const job = [...state.jobs].reverse().find(item => item.assetPath === asset.path && item.type === 'proxy');
          const processing = job && ['queued', 'running'].includes(job.state);
          return <div className="media-cache-asset" key={asset.id}>
            <div><strong title={asset.name}>{asset.name}</strong><span>{processing ? `${t(job.state === 'running' ? '正在生成' : '排队中')} ${Math.round(job.progress * 100)}%` : proxy ? t('{height}p 代理就绪', { height: proxy.height }) : job?.state === 'failed' ? t('生成失败，可重试') : t('使用原片预览')}</span>{processing && <progress max={1} value={job.progress}/>}</div>
            <button type="button" disabled={busy || !available} onClick={() => void run(() => processing ? mutateMediaCache('cancel', job.id) : requestMediaCache(asset, 'proxy', height))}>{processing ? t('取消') : proxy?.height === height ? t('已就绪') : t('生成代理')}</button>
          </div>;
        })}
      </div>
      <section className="media-cache-storage">
        <div className="media-cache-storage-heading"><h3>{t('缓存空间')}</h3><span>{size(state.usedBytes)} / {size(state.maxBytes)}</span></div>
        <progress max={state.maxBytes} value={state.usedBytes}/>
        <p>{t('波形与缩略图按需生成；缓存最多 2 GB，旧缓存自动释放。')}</p>
        <code title={state.directory}>{state.directory || t('正在读取缓存位置…')}</code>
        <div className="media-cache-storage-actions"><button type="button" disabled={busy || !!running.length || !available} onClick={() => void run(() => mutateMediaCache('chooseDirectory'))}><FolderOpen size={15}/>{t('更换缓存位置')}</button><button type="button" disabled={busy || !!running.length || !available} onClick={() => void run(() => mutateMediaCache('clear'))}><Trash2 size={15}/>{t('清理媒体缓存')}</button></div>
        {!!running.length && <div className="media-cache-queue"><Loader2 className="spin" size={14}/><span>{t('{count} 个缓存任务等待或运行中', { count: running.length })}</span><button type="button" disabled={busy} onClick={() => void run(async () => { for (const job of running) await mutateMediaCache('cancel', job.id); })}>{t('取消全部')}</button></div>}
        <small>{t('清理缓存不影响原片和工程。更换位置后，旧缓存保留在原目录。')}</small>
      </section>
      {error && <p className="media-cache-error" role="alert">{t(error)}</p>}
    </div>
  </div>;
}
export default MediaCachePanel;
