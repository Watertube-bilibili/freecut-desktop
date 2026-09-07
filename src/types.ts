export type MediaKind = 'video' | 'audio' | 'image';
export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  url: string;
  path?: string;
  duration: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  missing?: boolean;
}
export type AnimProperty = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';
export interface Keyframe {
  id: string;
  time: number;
  value: number;
  easing: Easing;
}
export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  volume: number;
}
export type MaskShape =
  | 'none'
  | 'circle'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'star'
  | 'heart'
  | 'band';
export interface Effects {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  blur: number;
  grayscale: number;
  sepia: number;
  vignette: number;
  pixelate: number;
  chroma: boolean;
  chromaColor: string;
  chromaThreshold: number;
  flipX: boolean;
  flipY: boolean;
  mask: MaskShape;
  maskSize: number;
  /** Fractions of fitted source width/height; optional for older project files. */
  maskX?: number;
  maskY?: number;
  maskRotation?: number;
  maskFeather?: number;
  maskInvert?: boolean;
}
export interface TextStyle {
  text: string;
  fontSize: number;
  color: string;
  background: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  stroke: boolean;
}
export interface Clip {
  id: string;
  name: string;
  kind: MediaKind | 'text' | 'shape';
  assetId?: string;
  trackId: string;
  start: number;
  duration: number;
  inPoint: number;
  speed: number;
  transform: Transform;
  keyframes: Partial<Record<AnimProperty, Keyframe[]>>;
  effects: Effects;
  text?: TextStyle;
  color?: string;
  fadeIn: number;
  fadeOut: number;
  audio?: AudioSettings;
}
export interface AudioSettings {
  pan: number;
  leftGain: number;
  rightGain: number;
  channelMode: 'stereo' | 'left' | 'right' | 'mono' | 'swap';
}
export interface Track {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'overlay';
  muted: boolean;
  hidden: boolean;
  locked: boolean;
}
export interface Project {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  assets: MediaAsset[];
  clips: Clip[];
  tracks: Track[];
}
export interface ExportOptions {
  project: Project;
  width: number;
  height: number;
  fps: number;
  duration: number;
  quality: 'high' | 'medium';
  format: 'mp4';
  frameFormat?: 'png' | 'rgba';
  pipeline?: 'auto' | 'frames';
}
export interface ExportProgress {
  jobId: string;
  phase: string;
  progress: number;
}
export interface DesktopAPI {
  setLanguage: (language: 'zh-CN' | 'en') => Promise<'zh-CN' | 'en'>;
  listSounds: () => Promise<
    { id: string; name: string; category: string; duration: number; license: string }[]
  >;
  createSound: (id: string) => Promise<MediaAsset>;
  updateState: () => Promise<UpdateState>;
  checkUpdate: () => Promise<UpdateState>;
  setAutomaticUpdates: (value: boolean) => Promise<UpdateState>;
  installUpdate: () => Promise<void>;
  onUpdateState: (callback: (state: UpdateState) => void) => () => void;
  onCloseFailed: (callback: () => void) => () => void;
  onCloseRequested: (
    callback: (request: { requestId: string; reason: 'window' | 'quit' }) => void,
  ) => () => void;
  resolveClose: (data: { requestId: string; dirty: boolean; project: Project }) => Promise<{
    status: 'ready' | 'cancelled' | 'failed';
    outcome?: 'saved' | 'discarded' | 'clean';
    path?: string;
    error?: string;
  }>;
  confirmClose: (data: { requestId: string; unchanged: boolean }) => Promise<boolean>;
  cancelClose: (requestId: string) => Promise<unknown>;
  listProjects: () => Promise<ProjectSummary[]>;
  openRecentProject: (id: string) => Promise<Project>;
  removeRecentProject: (id: string) => Promise<void>;
  openExternal: (kind: 'bilibili' | 'github') => Promise<void>;
  importMedia: () => Promise<MediaAsset[]>;
  saveProject: (project: Project) => Promise<string | null>;
  openProject: () => Promise<Project | null>;
  beginExport: (
    options: ExportOptions,
  ) => Promise<{
    jobId: string;
    path: string;
    pipeline?: 'native' | 'frames';
    frameFormat?: 'png' | 'rgba';
  } | null>;
  writeFrame: (data: { jobId: string; index: number; bytes: Uint8Array }) => Promise<void>;
  finishExport: (jobId: string) => Promise<{ path: string }>;
  cancelExport: (jobId: string) => Promise<void>;
  onExportProgress: (callback: (progress: ExportProgress) => void) => () => void;
  showItem: (path: string) => Promise<void>;
  getInfo: () => Promise<{
    version: string;
    platform: string;
    ffmpeg: boolean;
    portable: boolean;
    userData: string;
  }>;
}
export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  updatedAt: string;
  duration: number;
  width: number;
  height: number;
  clipCount: number;
  missing: boolean;
}
export interface UpdateState {
  phase:
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'latest'
    | 'downloading'
    | 'ready'
    | 'installing'
    | 'error';
  automatic: boolean;
  currentVersion: string;
  repository: string;
  progress: number;
  message: string;
  version?: string;
  checkedAt?: string;
}
declare global {
  interface Window {
    freecut?: DesktopAPI;
  }
}
