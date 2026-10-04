import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import type { RecoveryAPI, RecoveryEntry } from '../recovery-types';

interface Options {
  project: Project;
  dirty: boolean;
  enabled: boolean;
  sessionId: string;
  busy: boolean;
  api?: RecoveryAPI;
}

export type RecoveryStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/** Debounce finished edits; a continuous editing session is checkpointed every 30 seconds. */
export function useRecovery(options: Options) {
  const { api, project, dirty, enabled, sessionId, busy } = options;
  const current = useRef(options);
  current.current = options;
  const [entries, setEntries] = useState<RecoveryEntry[]>([]);
  const [issues, setIssues] = useState(0);
  const [loading, setLoading] = useState(Boolean(api));
  const [status, setStatus] = useState<RecoveryStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string>();
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const pendingSince = useRef(0);
  const savedProject = useRef<Project | undefined>(undefined);
  const savedSession = useRef('');
  const pending = useRef<Promise<void> | null>(null);
  const listVersion = useRef(0);

  const refresh = useCallback(async () => {
    if (!api) { setLoading(false); return; }
    const version = ++listVersion.current;
    setLoading(true);
    try {
      const result = await api.list();
      if (mounted.current && version === listVersion.current) {
        setEntries(result.entries); setIssues(result.issues); setError('');
      }
    } catch (cause) {
      if (mounted.current && version === listVersion.current) setError(String((cause as Error).message || cause));
    } finally {
      if (mounted.current && version === listVersion.current) setLoading(false);
    }
  }, [api]);

  const flush = useCallback(async () => {
    while (pending.current) await pending.current;
    const input = current.current;
    if (!input.api || !input.enabled || !input.dirty || input.busy ||
      (savedProject.current === input.project && savedSession.current === input.sessionId)) return;
    const operation = (async () => {
      if (mounted.current) setStatus('saving');
      try {
        const result = await input.api!.snapshot({ project: input.project, sessionId: input.sessionId, dirty: true });
        savedProject.current = input.project;
        savedSession.current = input.sessionId;
        pendingSince.current = current.current.dirty && current.current.enabled &&
          (current.current.project !== input.project || current.current.sessionId !== input.sessionId) ? Date.now() : 0;
        if (mounted.current && current.current.sessionId === input.sessionId) {
          setStatus(result.entry ? 'saved' : 'idle'); setError('');
          if (result.entry) setLastSavedAt(result.entry.createdAt);
        }
        if (mounted.current) await refresh();
      } catch (cause) {
        // Keep the pending edits eligible for retry. No manual-save state is changed.
        pendingSince.current = Date.now();
        if (mounted.current && current.current.sessionId === input.sessionId) {
          setStatus('error'); setError(String((cause as Error).message || cause));
        }
      }
    })();
    pending.current = operation;
    try { await operation; } finally { if (pending.current === operation) pending.current = null; }
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; listVersion.current++; };
  }, [refresh]);

  useEffect(() => {
    pendingSince.current = 0;
    savedProject.current = undefined;
    savedSession.current = sessionId;
    setLastSavedAt(undefined);
    setStatus('idle');
  }, [sessionId]);

  useEffect(() => {
    if (!api || !enabled || !dirty) { pendingSince.current = 0; return; }
    if (savedProject.current === project && savedSession.current === sessionId) return;
    if (!pendingSince.current) pendingSince.current = Date.now();
    if (busy) return;
    setStatus(previous => previous === 'error' ? previous : 'pending');
    const delay = Math.max(0, Math.min(10_000, 30_000 - (Date.now() - pendingSince.current)));
    const timer = window.setTimeout(() => { void flush(); }, delay);
    return () => window.clearTimeout(timer);
  }, [api, enabled, dirty, project, sessionId, busy, flush]);

  useEffect(() => {
    if (!api) return;
    // A rejected write is retried, and edits made during a write get their next checkpoint.
    const timer = window.setInterval(() => {
      if (pendingSince.current && Date.now() - pendingSince.current >= 30_000) void flush();
    }, 5_000);
    const onVisibility = () => { if (document.visibilityState === 'hidden') void flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [api, flush]);

  const remove = useCallback(async (id: string) => {
    if (!api) return;
    await api.remove(id);
    await refresh();
  }, [api, refresh]);
  const markSaved = useCallback(async (saved: Project, forSession?: string) => {
    if (!api) return;
    await api.markSaved({ project: saved, sessionId: forSession ?? current.current.sessionId });
    await refresh();
  }, [api, refresh]);

  return { entries, issues, loading, status, lastSavedAt, error, refresh, flush, remove, markSaved };
}
