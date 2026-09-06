export type MediaKind = 'video' | 'audio' | 'image';
export interface MediaAsset { id: string; name: string; kind: MediaKind; url: string; path?: string; duration: number; width?: number; height?: number; thumbnail?: string; missing?: boolean }
export type AnimProperty = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';
export interface Keyframe { id: string; time: number; value: number; easing: Easing }
export interface Transform { x: number; y: number; scale: number; rotation: number; opacity: number; volume: number }
export interface Effects { brightness: number; contrast: number; saturation: number; hue: number; blur: number; grayscale: number; sepia: number; vignette: number; pixelate: number; chroma: boolean; chromaColor: string; chromaThreshold: number; flipX: boolean; flipY: boolean; mask: 'none' | 'circle' | 'rectangle'; maskSize: number }
export interface TextStyle { text: string; fontSize: number; color: string; background: string; align: 'left' | 'center' | 'right'; bold: boolean; stroke: boolean }
export interface Clip { id: string; name: string; kind: MediaKind | 'text' | 'shape'; assetId?: string; trackId: string; start: number; duration: number; inPoint: number; speed: number; transform: Transform; keyframes: Partial<Record<AnimProperty, Keyframe[]>>; effects: Effects; text?: TextStyle; color?: string; fadeIn: number; fadeOut: number }
export interface Track { id: string; name: string; kind: 'video' | 'audio' | 'overlay'; muted: boolean; hidden: boolean; locked: boolean }
export interface Project { version: 1; id: string; name: string; width: number; height: number; fps: number; background: string; assets: MediaAsset[]; clips: Clip[]; tracks: Track[] }
export interface ExportOptions { project: Project; width: number; height: number; fps: number; duration: number; quality: 'high' | 'medium'; format: 'mp4' }
export interface ExportProgress { jobId: string; phase: string; progress: number }
export interface DesktopAPI {
  importMedia: () => Promise<MediaAsset[]>;
  saveProject: (project: Project) => Promise<string | null>;
  openProject: () => Promise<Project | null>;
  beginExport: (options: ExportOptions) => Promise<{ jobId: string; path: string } | null>;
  writeFrame: (data: { jobId: string; index: number; bytes: Uint8Array }) => Promise<void>;
  finishExport: (jobId: string) => Promise<{ path: string }>;
  cancelExport: (jobId: string) => Promise<void>;
  onExportProgress: (callback: (progress: ExportProgress) => void) => () => void;
  showItem: (path: string) => Promise<void>;
  getInfo: () => Promise<{ version: string; platform: string; ffmpeg: boolean; portable: boolean }>;
}
declare global { interface Window { freecut?: DesktopAPI } }
