import type { MediaAsset } from './types';
export type AIModelId = 'asr-sensevoice' | 'asr-zh-en' | 'tts-zh';
export interface AIProgress {
  phase: 'downloading' | 'verifying' | 'installing' | 'processing' | 'done' | 'error';
  message: string;
  progress: number;
  received?: number;
  total?: number;
}
export interface AIModelStatus {
  id: AIModelId;
  name: string;
  bytes: number;
  diskBytes: number;
  license: string;
  installed: boolean;
}
export interface AIStatus {
  supported: boolean;
  platform: string;
  runtimeReady: boolean;
  busy: boolean;
  models: AIModelStatus[];
}
export interface VoiceStorageState {
  path: string;
  defaultPath: string;
  custom: boolean;
  busy: boolean;
}
export interface AIApi {
  voiceStorageStatus: () => Promise<VoiceStorageState>;
  voiceStorageChoose: () => Promise<VoiceStorageState | null>;
  voiceStorageReset: () => Promise<VoiceStorageState>;
  voiceStorageCopy: () => Promise<void>;
  aiStatus: () => Promise<AIStatus>;
  aiInstall: (request: { modelId: AIModelId }) => Promise<AIStatus>;
  aiTranscribe: (request: {
    assetId: string;
    path: string;
    inPoint: number;
    duration: number;
    language: 'auto' | 'zh' | 'en';
    modelId?: 'asr-sensevoice' | 'asr-zh-en';
  }) => Promise<{ items: { start: number; duration: number; text: string }[]; timing?: string }>;
  aiSpeak: (request: { text: string; speakerId: number; speed: number }) => Promise<MediaAsset>;
  aiCancel: () => Promise<void>;
  onAIProgress: (callback: (progress: AIProgress) => void) => () => void;
}
