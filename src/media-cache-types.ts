import type { MediaAsset } from './types';

export type MediaCacheKind = 'proxy' | 'waveform' | 'thumbnails';
export interface MediaCacheEntry {
  assetPath: string;
  sourceKey: string;
  name: string;
  duration: number;
  proxy?: { url: string; height: number; width: number; duration: number };
  waveform?: { bins: number[]; duration: number };
  thumbnails?: { url: string; time: number }[];
}
export interface MediaCacheJob {
  id: string;
  assetPath: string;
  name: string;
  type: MediaCacheKind;
  height?: number;
  state: 'queued' | 'running' | 'complete' | 'cancelled' | 'failed';
  progress: number;
  error?: string;
}
export interface MediaCacheStatus {
  directory: string;
  usedBytes: number;
  maxBytes: number;
  jobs: MediaCacheJob[];
  entries: MediaCacheEntry[];
}
export interface MediaCacheAPI {
  status(): Promise<MediaCacheStatus>;
  request(input: { asset: MediaAsset; type: MediaCacheKind; height?: 540 | 720 }): Promise<MediaCacheStatus>;
  cancel(id: string): Promise<MediaCacheStatus>;
  clear(): Promise<MediaCacheStatus>;
  chooseDirectory(): Promise<MediaCacheStatus | null>;
  onProgress(callback: (state: MediaCacheStatus) => void): () => void;
}
