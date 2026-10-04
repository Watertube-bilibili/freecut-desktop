import { useState } from 'react';
import { History, RotateCcw, Trash2, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n';
import type { RecoveryEntry } from '../recovery-types';
import './recovery.css';

interface Props {
  entries: RecoveryEntry[];
  issues: number;
  loading: boolean;
  error: string;
  busy?: boolean;
  onRefresh: () => Promise<void> | void;
  onRestore: (id: string) => Promise<void> | void;
  onRemove: (id: string) => Promise<void> | void;
}

export default function RecoveryPanel({ entries, issues, loading, error, busy, onRefresh, onRestore, onRemove }: Props) {
  const { t, language } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const [working, setWorking] = useState<string>();
  const [actionError, setActionError] = useState('');
  if (!entries.length && !loading && !error && !issues) return null;
  const shown = expanded ? entries : entries.slice(0, 3);
  const locked = Boolean(busy || working);
  async function act(id: string, callback: (id: string) => Promise<void> | void) {
    setWorking(id); setActionError('');
    try { await callback(id); setConfirmDelete(undefined); }
    catch (cause) { setActionError(String((cause as Error).message || cause)); }
    finally { setWorking(undefined); }
  }
  return (
    <section className="recovery-panel" aria-label={t('恢复记录')} aria-busy={loading || Boolean(working)}>
      <header className="recovery-heading">
        <div><History size={17} aria-hidden="true" /><h2>{t('恢复记录')}</h2><span className="recovery-count">{entries.length}</span></div>
        <button type="button" className="recovery-refresh" disabled={locked || loading} onClick={() => void act('refresh', onRefresh)} aria-label={t('刷新恢复记录')} title={t('刷新恢复记录')}><RefreshCw size={15} aria-hidden="true" /></button>
      </header>
      <p className="recovery-intro">{t('自动保留编辑副本。恢复后请手动保存为工程文件。')}</p>
      {(error || actionError) && <p className="recovery-error" role="alert">{t(error || actionError)}</p>}
      {issues > 0 && <p className="recovery-warning" role="status">{t('有 {count} 条恢复记录无法读取，其余记录仍可恢复。', { count: issues })}</p>}
      {loading && !entries.length && <p className="recovery-intro" role="status">{t('正在读取恢复记录…')}</p>}
      <ul className="recovery-list">
        {shown.map(entry => (
          <li className="recovery-entry" key={entry.id}>
            <div className="recovery-details">
              <div className="recovery-title"><strong title={entry.name}>{entry.name || t('未命名项目')}</strong>{entry.saved && <span>{t('已手动保存')}</span>}</div>
              <p><time dateTime={entry.createdAt}>{new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(entry.createdAt))}</time><span aria-hidden="true"> · </span>{t('{clips} 个片段 · {assets} 个素材', { clips: entry.clipCount, assets: entry.assetCount })}</p>
            </div>
            {confirmDelete === entry.id ? (
              <div className="recovery-actions recovery-confirm">
                <span>{t('删除此恢复副本？')}</span>
                <button type="button" disabled={locked} className="recovery-delete-confirm" onClick={() => void act(entry.id, onRemove)}>{t('删除副本')}</button>
                <button type="button" disabled={locked} onClick={() => setConfirmDelete(undefined)}>{t('取消')}</button>
              </div>
            ) : (
              <div className="recovery-actions">
                <button type="button" className="recovery-restore" disabled={locked} onClick={() => void act(entry.id, onRestore)}><RotateCcw size={14} aria-hidden="true" />{t(working === entry.id ? '正在恢复…' : '恢复')}</button>
                <button type="button" className="recovery-delete" disabled={locked} onClick={() => setConfirmDelete(entry.id)} aria-label={t('删除 {name} 的此恢复副本', { name: entry.name })} title={t('删除副本')}><Trash2 size={15} aria-hidden="true" /></button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {entries.length > 3 && <button type="button" className="recovery-more" onClick={() => setExpanded(!expanded)}>{expanded ? t('收起历史版本') : t('查看全部 {count} 个版本', { count: entries.length })}</button>}
      {entries.length > 0 && <p className="recovery-retention">{t('每次编辑会话最多保留 8 个版本；空间不足时清理旧版本，保留未保存会话的最新副本。')}</p>}
    </section>
  );
}
