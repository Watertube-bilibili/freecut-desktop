import { useEffect, useSyncExternalStore } from 'react';
import type { MediaAsset } from '../types';
import type { MediaCacheAPI, MediaCacheKind, MediaCacheStatus } from '../media-cache-types';
import { setPreviewMediaProxies } from './renderer';

function readEnabled() { try { return localStorage.getItem('freecut-preview-proxies') !== 'false'; } catch { return true; } }
const empty: MediaCacheStatus & { enabled: boolean } = { directory: '', usedBytes: 0, maxBytes: 2 * 1024 ** 3, jobs: [], entries: [], enabled: readEnabled() };
let state = empty, stop: (() => void) | undefined, timer: ReturnType<typeof setInterval> | undefined;
let refreshing: Promise<void> | undefined;
const listeners = new Set<() => void>();
export function mediaCacheAPI(): MediaCacheAPI | undefined {
  return (window.freecut as (NonNullable<Window['freecut']> & { mediaCache?: MediaCacheAPI }) | undefined)?.mediaCache;
}
function accept(next: MediaCacheStatus) {
  state = { ...next, enabled: state.enabled };
  setPreviewMediaProxies(state.enabled ? next.entries : []);
  listeners.forEach(listener => listener());
}
export function setMediaCacheEnabled(enabled: boolean) {
  try { localStorage.setItem('freecut-preview-proxies', String(enabled)); } catch {}
  state = { ...state, enabled, entries: [...state.entries] };
  setPreviewMediaProxies(enabled ? state.entries : []);
  listeners.forEach(listener => listener());
}
export function refreshMediaCache(): Promise<void> {
  const api = mediaCacheAPI();
  if (!api) return Promise.resolve();
  if (!refreshing) refreshing = api.status().then(accept).finally(() => { refreshing = undefined; });
  return refreshing;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    stop = mediaCacheAPI()?.onProgress(accept);
    void refreshMediaCache().catch(() => {});
    // Stat validation is independent of render frames, and invalidates replaced originals.
    timer = setInterval(() => { void refreshMediaCache().catch(() => {}); }, 5000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { stop?.(); stop = undefined; clearInterval(timer); timer = undefined; }
  };
}
export function useMediaCache(assets?: MediaAsset[]) {
  const value = useSyncExternalStore(subscribe, () => state, () => empty);
  useEffect(() => {
    // Restore persisted artifacts lazily through a normal, authorized request.
    // Proxy generation remains an explicit user action in MediaCachePanel.
    void refreshMediaCache().catch(() => {});
  }, [assets]);
  return value;
}
export async function requestMediaCache(asset: MediaAsset, type: MediaCacheKind, height?: 540 | 720) {
  const api = mediaCacheAPI();
  if (api) accept(await api.request({ asset, type, height }));
}
export async function mutateMediaCache(action: 'clear' | 'chooseDirectory' | 'cancel', id?: string) {
  const api = mediaCacheAPI();
  if (!api) return;
  const next = await (action === 'cancel' ? api.cancel(id!) : api[action]());
  if (next) accept(next);
}
