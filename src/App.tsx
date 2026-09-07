import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Film,
  FolderOpen,
  Plus,
  Download,
  Save,
  Undo2,
  Redo2,
  Scissors,
  Trash2,
  Copy,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Magnet,
  Minus,
  Diamond,
  Type,
  Music2,
  Sparkles,
  Layers,
  Search,
  Image,
  Monitor,
  Smartphone,
  HelpCircle,
  X,
  ArrowRight,
  Upload,
  Captions,
  Mic,
  Volume2,
  Maximize2,
  Check,
  Loader2,
  Settings2,
  SlidersHorizontal,
  Palette,
  RotateCcw,
  Keyboard,
  PanelRightOpen,
  House,
} from 'lucide-react';
import type { AnimProperty, Clip, MediaAsset, Project, ProjectSummary, Transform } from './types';
import {
  createProject,
  createClip,
  defaultEffects,
  durationOf,
  evaluate,
  splitClip,
  validateProject,
  parseSrt,
  toSrt,
} from './core/project';
import { effectPresets } from './core/effects';
import { renderProject, createPreviewRenderer, syncAudio, clearMediaCache } from './core/renderer';
import Inspector from './components/Inspector';
import Timeline, { timecode } from './components/Timeline';
import AIPanel from './components/AIPanel';
import ChatTTSPanel from './components/ChatTTSPanel';
import Home from './components/Home';
import PreviewTransform from './components/PreviewTransform';
import { editTransform } from './core/transform-edit';
import UpdateNotice from './components/UpdateNotice';
import BrandIcon from './components/BrandIcon';
import SoundLibrary from './components/SoundLibrary';
import ContextMenu, { type ContextMenuItem } from './components/ContextMenu';
import { t, useI18n, type Language } from './i18n';
import { version as appVersion } from '../package.json';

type MenuTarget =
  | { kind: 'clip' | 'preview'; id?: string }
  | { kind: 'track'; id: string; atTime?: number }
  | { kind: 'timeline'; atTime: number }
  | { kind: 'asset'; id: string }
  | { kind: 'library' };
type EditorMenu = {
  target: MenuTarget;
  x: number;
  y: number;
  returnFocus: HTMLElement;
  session: number;
};

function cloneClipForPlacement(source: Clip, trackId: string, start: number): Clip {
  const clone = structuredClone(source);
  clone.id = crypto.randomUUID();
  clone.trackId = trackId;
  clone.start = start;
  Object.values(clone.keyframes).forEach((frames) =>
    frames?.forEach((frame) => (frame.id = crypto.randomUUID())),
  );
  return clone;
}

function createLocalizedProject() {
  const p = createProject();
  return {
    ...p,
    name: t(p.name),
    tracks: p.tracks.map((track) => ({ ...track, name: t(track.name) })),
  };
}

const uid = () => crypto.randomUUID();
const nav = [
  { id: 'media', label: '素材', icon: FolderOpen },
  { id: 'text', label: '文字', icon: Type },
  { id: 'audio', label: '音频', icon: Music2 },
  { id: 'effects', label: '特效', icon: Sparkles },
  { id: 'motion', label: '动画', icon: Layers },
  { id: 'tools', label: '工具', icon: Settings2 },
];
const presets = [
  { label: '横屏 16:9', width: 1920, height: 1080 },
  { label: '竖屏 9:16', width: 1080, height: 1920 },
  { label: '方形 1:1', width: 1080, height: 1080 },
  { label: '横屏 4:3', width: 1440, height: 1080 },
];
function downloadFile(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function demoProject() {
  const p = createLocalizedProject();
  p.name = t('每一帧，都有你的想法 · 示例');
  const video = p.tracks.find((t) => t.kind === 'video')!.id,
    over = p.tracks.find((t) => t.kind === 'overlay')!.id;
  p.clips = [
    createClip('shape', video, { name: t('松石色背景'), duration: 10, color: '#254c49' }),
    createClip('shape', over, {
      name: t('暖橙色块'),
      duration: 10,
      color: '#dd9865',
      transform: { x: 560, y: 80, scale: 0.25, rotation: -12, opacity: 1, volume: 1 },
      keyframes: {
        rotation: [
          { id: uid(), time: 0, value: -12, easing: 'ease-in-out' },
          { id: uid(), time: 10, value: 16, easing: 'linear' },
        ],
      },
    }),
    createClip('text', over, {
      name: t('主标题'),
      duration: 10,
      text: {
        text: t('每一帧，\n都有你的想法。'),
        fontSize: 124,
        color: '#f1efe4',
        background: 'transparent',
        align: 'left',
        bold: true,
        stroke: false,
      },
      transform: { x: -760, y: -60, scale: 1, rotation: 0, opacity: 1, volume: 1 },
      keyframes: {
        y: [
          { id: uid(), time: 0, value: 20, easing: 'ease-out' },
          { id: uid(), time: 1.6, value: -60, easing: 'linear' },
        ],
        opacity: [
          { id: uid(), time: 0, value: 0, easing: 'ease-out' },
          { id: uid(), time: 1, value: 1, easing: 'linear' },
        ],
      },
      fadeOut: 0.6,
    }),
    createClip('text', over, {
      name: t('副标题'),
      duration: 10,
      text: {
        text: t('水管剪辑  /  FREECUT\n让灵感，从这一剪开始。'),
        fontSize: 32,
        color: '#c8dad1',
        background: 'transparent',
        align: 'left',
        bold: false,
        stroke: false,
      },
      transform: { x: -750, y: 300, scale: 1, rotation: 0, opacity: 1, volume: 1 },
      fadeIn: 1.2,
      fadeOut: 0.6,
    }),
  ];
  return p;
}

export default function App() {
  const { language, setLanguage } = useI18n();
  const [contextMenu, setContextMenu] = useState<EditorMenu>();
  const [clipboard, setClipboard] = useState<Clip>();
  const closeContextMenu = useCallback(() => setContextMenu(undefined), []);
  const [project, setProject] = useState<Project>(() => {
    try {
      const saved = localStorage.getItem('freecut-autosave');
      if (saved && !window.freecut) return validateProject(JSON.parse(saved));
    } catch {}
    return createLocalizedProject();
  });
  const [selected, setSelected] = useState<string>(),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [tab, setTab] = useState('media'),
    [inspectorTab, setInspectorTab] = useState('basic'),
    [zoom, setZoom] = useState(65),
    [snap, setSnap] = useState(true),
    [search, setSearch] = useState(''),
    [mobile, setMobile] = useState(() => localStorage.getItem('freecut-layout') === 'mobile'),
    [inspectorOpen, setInspectorOpen] = useState(
      () => localStorage.getItem('freecut-layout') !== 'mobile',
    ),
    [mobileShelf, setMobileShelf] = useState(false),
    [onboarding, setOnboarding] = useState(() => !localStorage.getItem('freecut-onboarded')),
    [tourStep, setTourStep] = useState(0),
    [toast, setToast] = useState(''),
    [error, setError] = useState(''),
    [aiOpen, setAIOpen] = useState(false),
    [aiTab, setAITab] = useState<'asr' | 'tts'>('asr'),
    [exportOpen, setExportOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [exportPhase, setExportPhase] = useState(''),
    [exportPath, setExportPath] = useState(''),
    [exportSize, setExportSize] = useState('1080'),
    [quality, setQuality] = useState<'high' | 'medium'>('high'),
    [exportFps, setExportFps] = useState(30),
    [historyVersion, setHistoryVersion] = useState(0);
  const [home, setHome] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [recentProjects, setRecentProjects] = useState<ProjectSummary[]>([]);
  const [keyframeMode, setKeyframeMode] = useState<'easy' | 'pro'>(() =>
    localStorage.getItem('freecut-keyframe-mode') === 'pro' ? 'pro' : 'easy',
  );
  const [savedFingerprint, setSavedFingerprint] = useState(() => JSON.stringify(project));
  const savedRef = useRef(savedFingerprint);
  const projectSession = useRef(0);
  const fileOperation = useRef(false);
  const [fileBusy, setFileBusy] = useState(false);
  const fingerprint = useMemo(() => JSON.stringify(project), [project]);
  const dirty = fingerprint !== savedFingerprint;
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const [pendingNavigation, setPendingNavigation] = useState<{
    action: () => void | Promise<void>;
  }>();
  const [navigationBusy, setNavigationBusy] = useState(false);
  const previewGesture = useRef<
    { id: string; before: Clip; session: number; localTime: number } | undefined
  >(undefined);
  const history = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    projectRef = useRef(project),
    timeRef = useRef(time),
    playingRef = useRef(playing),
    canvas = useRef<HTMLCanvasElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    srtInput = useRef<HTMLInputElement>(null),
    cancelled = useRef(false),
    job = useRef<string | undefined>(undefined),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  projectRef.current = project;
  timeRef.current = time;
  playingRef.current = playing;
  const clip = project.clips.find((c) => c.id === selected),
    duration = durationOf(project);
  const notify = useCallback((message: string) => {
    setToast(t(message));
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4200);
  }, []);
  const markSaved = useCallback((snapshot: Project) => {
    savedRef.current = JSON.stringify(snapshot);
    setSavedFingerprint(savedRef.current);
  }, []);
  useEffect(() => {
    void window.freecut?.setLanguage?.(language).catch(() => {
      notify(t('无法同步系统对话框语言，请重新打开软件。'));
    });
  }, [language, notify]);
  const refreshProjects = useCallback(async () => {
    if (!window.freecut) return;
    try {
      setRecentProjects(await window.freecut.listProjects());
    } catch (e) {
      notify((e as Error).message);
    }
  }, [notify]);
  useEffect(() => {
    if (home) void refreshProjects();
  }, [home, refreshProjects]);
  useEffect(
    () =>
      window.freecut?.onCloseFailed?.(() => {
        closingRef.current = false;
        setClosing(false);
      }),
    [],
  );
  useEffect(() => {
    const api = window.freecut;
    if (!api) {
      const warn = (event: BeforeUnloadEvent) => {
        if (JSON.stringify(projectRef.current) !== savedRef.current) {
          event.preventDefault();
          event.returnValue = '';
        }
      };
      window.addEventListener('beforeunload', warn);
      return () => window.removeEventListener('beforeunload', warn);
    }
    return api.onCloseRequested(async ({ requestId }) => {
      if (closingRef.current) return;
      finishPreviewGesture(true);
      if (fileOperation.current) {
        await api.cancelClose(requestId);
        notify(t('正在处理工程文件，请完成后再退出。'));
        return;
      }
      closingRef.current = true;
      setClosing(true);
      setPlaying(false);
      const snapshot = structuredClone(projectRef.current);
      const atRequest = JSON.stringify(snapshot);
      try {
        const result = await api.resolveClose({
          requestId,
          dirty: atRequest !== savedRef.current,
          project: snapshot,
        });
        if (result.outcome === 'saved') markSaved(snapshot);
        if (result.status === 'ready') {
          const unchanged = JSON.stringify(projectRef.current) === atRequest;
          const closed = await api.confirmClose({ requestId, unchanged });
          if (closed) return;
          if (!unchanged) notify(t('等待退出时工程又有更新，已保留窗口。请检查后重新保存。'));
        } else if (result.status === 'failed')
          notify(result.error ?? t('保存失败，工程仍保留在编辑器中。'));
      } catch (e) {
        await api.cancelClose(requestId).catch(() => {});
        notify((e as Error).message);
      }
      closingRef.current = false;
      setClosing(false);
    });
  }, [markSaved, notify]);
  function changeKeyframeMode(mode: 'easy' | 'pro') {
    setKeyframeMode(mode);
    localStorage.setItem('freecut-keyframe-mode', mode);
  }
  function chooseLayout(value: boolean) {
    finishPreviewGesture(true);
    setMobile(value);
    setInspectorOpen(!value);
    setMobileShelf(false);
    localStorage.setItem('freecut-layout', value ? 'mobile' : 'professional');
  }
  function enterEditor() {
    setHome(false);
    setHasSession(true);
    setOnboarding(!localStorage.getItem('freecut-onboarded'));
    setTourStep(0);
  }
  function navigate(action: () => void | Promise<void>) {
    if (fileOperation.current || closingRef.current) return;
    finishPreviewGesture(true);
    setPlaying(false);
    if (JSON.stringify(projectRef.current) !== savedRef.current) setPendingNavigation({ action });
    else void action();
  }
  const record = useCallback((snapshot: Project) => {
    history.current.push(structuredClone(snapshot));
    if (history.current.length > 80) history.current.shift();
    future.current = [];
    setHistoryVersion((v) => v + 1);
  }, []);
  const commit = useCallback(
    (update: (p: Project) => Project) => {
      finishPreviewGesture(false);
      const p = projectRef.current;
      const result = update(p);
      if (result === p) return;
      record(p);
      projectRef.current = result;
      setProject(result);
    },
    [record],
  );
  const undo = useCallback(() => {
    finishPreviewGesture(true);
    const previous = history.current.pop();
    if (previous) {
      future.current.push(projectRef.current);
      projectRef.current = previous;
      setProject(previous);
      setHistoryVersion((v) => v + 1);
    }
  }, []);
  const redo = useCallback(() => {
    finishPreviewGesture(true);
    const next = future.current.pop();
    if (next) {
      history.current.push(projectRef.current);
      projectRef.current = next;
      setProject(next);
      setHistoryVersion((v) => v + 1);
    }
  }, []);
  function startPreviewGesture(id: string) {
    if (closingRef.current || fileOperation.current || previewGesture.current) return false;
    const p = projectRef.current,
      target = p.clips.find((item) => item.id === id);
    if (
      !target ||
      target.kind === 'audio' ||
      p.tracks.find((track) => track.id === target.trackId)?.locked ||
      timeRef.current < target.start ||
      timeRef.current >= target.start + target.duration
    )
      return false;
    playingRef.current = false;
    setPlaying(false);
    previewGesture.current = {
      id,
      before: structuredClone(target),
      session: projectSession.current,
      localTime: timeRef.current - target.start,
    };
    return true;
  }
  function changePreviewTransform(id: string, values: Partial<Transform>) {
    const gesture = previewGesture.current;
    if (!gesture || gesture.id !== id || gesture.session !== projectSession.current) return;
    const p = projectRef.current,
      target = p.clips.find((item) => item.id === id);
    if (!target || p.tracks.find((track) => track.id === target.trackId)?.locked) {
      finishPreviewGesture(true);
      return;
    }
    try {
      const changed = editTransform(target, values, gesture.localTime, p.fps);
      if (changed === target) return;
      const next = { ...p, clips: p.clips.map((item) => (item.id === id ? changed : item)) };
      projectRef.current = next;
      setProject(next);
    } catch (error) {
      finishPreviewGesture(true);
      notify((error as Error).message);
    }
  }
  function finishPreviewGesture(cancelled: boolean) {
    const gesture = previewGesture.current;
    if (!gesture) return;
    previewGesture.current = undefined;
    if (gesture.session !== projectSession.current) return;
    const p = projectRef.current,
      target = p.clips.find((item) => item.id === gesture.id);
    if (
      !target ||
      (JSON.stringify(target.transform) === JSON.stringify(gesture.before.transform) &&
        JSON.stringify(target.keyframes) === JSON.stringify(gesture.before.keyframes))
    )
      return;
    // Undo/cancel changes only this clip; unrelated completed imports stay intact.
    const before = {
      ...p,
      clips: p.clips.map((item) =>
        item.id === gesture.id
          ? { ...item, transform: gesture.before.transform, keyframes: gesture.before.keyframes }
          : item,
      ),
    };
    if (cancelled) {
      projectRef.current = before;
      setProject(before);
    } else record(before);
  }
  const changeClip = (update: (c: Clip) => Clip) => {
    if (!clip) return;
    if (project.tracks.find((t) => t.id === clip.trackId)?.locked) {
      notify(t('轨道已锁定，请先解锁。'));
      return;
    }
    commit((p) => ({ ...p, clips: p.clips.map((c) => (c.id === selected ? update(c) : c)) }));
  };
  const seek = useCallback((value: number) => {
    finishPreviewGesture(true);
    playingRef.current = false;
    timeRef.current = Math.max(0, value);
    setPlaying(false);
    setTime(timeRef.current);
  }, []);
  const removeClipById = useCallback(
    (id?: string) => {
      const p = projectRef.current,
        c = p.clips.find((c) => c.id === id);
      if (!c || p.tracks.find((t) => t.id === c.trackId)?.locked) return;
      commit((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== id) }));
      setSelected((current) => (current === id ? undefined : current));
    },
    [commit],
  );
  const remove = useCallback(() => removeClipById(selected), [removeClipById, selected]);
  const splitClipById = useCallback(
    (id?: string) => {
      const p = projectRef.current,
        c = p.clips.find((c) => c.id === id);
      if (!c) {
        notify(t('先选择要分割的片段。'));
        return;
      }
      if (p.tracks.find((t) => t.id === c.trackId)?.locked) return;
      let result: ReturnType<typeof splitClip>;
      try {
        result = splitClip(c, timeRef.current);
      } catch (error) {
        notify(error instanceof Error ? error.message : t('片段分割失败，请检查关键帧。'));
        return;
      }
      if (!result) {
        notify(t('将播放头移到片段内部再分割。'));
        return;
      }
      commit((p) => ({ ...p, clips: p.clips.flatMap((c) => (c.id === id ? result : [c])) }));
      setSelected(result[1].id);
      notify(t('片段已分割，关键帧已保留。'));
    },
    [commit, notify],
  );
  const split = useCallback(() => splitClipById(selected), [selected, splitClipById]);
  const duplicateClipById = (id?: string) => {
    const p = projectRef.current,
      source = p.clips.find((item) => item.id === id);
    if (source && p.tracks.find((track) => track.id === source.trackId)?.locked) {
      notify(t('轨道已锁定，请先解锁。'));
      return;
    }
    if (source) {
      const clone = cloneClipForPlacement(source, source.trackId, source.start + source.duration);
      clone.name += t(' 副本');
      commit((p) => ({ ...p, clips: [...p.clips, clone] }));
      setSelected(clone.id);
    }
  };
  const duplicate = () => duplicateClipById(selected);
  function copyClipById(id?: string, cut = false) {
    const p = projectRef.current,
      source = p.clips.find((item) => item.id === id);
    if (!source || (cut && p.tracks.find((track) => track.id === source.trackId)?.locked)) return;
    setClipboard(structuredClone(source));
    if (cut) removeClipById(id);
    notify(cut ? t('片段已剪切，可在时间线上粘贴。') : t('片段已复制，可在时间线上粘贴。'));
  }
  function pasteDestination(trackId?: string) {
    const p = projectRef.current;
    if (!clipboard || (clipboard.assetId && !p.assets.some((a) => a.id === clipboard.assetId)))
      return;
    const compatible = (track: Project['tracks'][number]) =>
      !track.locked && (track.kind !== 'audio' || clipboard.kind === 'audio');
    if (trackId) return p.tracks.find((track) => track.id === trackId && compatible(track));
    const preferred = p.clips.find((item) => item.id === selected)?.trackId ?? clipboard.trackId;
    return (
      p.tracks.find((track) => track.id === preferred && compatible(track)) ??
      p.tracks.find((track) => track.id === clipboard.trackId && compatible(track)) ??
      p.tracks.find(
        (track) =>
          track.kind === (clipboard.kind === 'audio' ? 'audio' : 'video') && compatible(track),
      ) ??
      p.tracks.find(compatible)
    );
  }
  function pasteClip(trackId?: string, at = timeRef.current) {
    const target = pasteDestination(trackId);
    if (!clipboard || !target) {
      notify(t('请先复制片段，并选择未锁定的兼容轨道。'));
      return;
    }
    const p = projectRef.current;
    const start = Math.max(0, Math.round(at * p.fps) / p.fps);
    const clone = cloneClipForPlacement(clipboard, target.id, start);
    commit((p) => ({ ...p, clips: [...p.clips, clone] }));
    setSelected(clone.id);
    seek(start);
    notify(t('片段已粘贴。'));
  }
  function editClipById(id: string, update: (item: Clip) => Clip) {
    commit((p) => {
      const target = p.clips.find((item) => item.id === id);
      if (!target || p.tracks.find((track) => track.id === target.trackId)?.locked) return p;
      return { ...p, clips: p.clips.map((item) => (item.id === id ? update(item) : item)) };
    });
  }
  function toggleTrack(id: string, property: 'muted' | 'hidden' | 'locked') {
    commit((p) => ({
      ...p,
      tracks: p.tracks.map((track) =>
        track.id === id ? { ...track, [property]: !track[property] } : track,
      ),
    }));
  }
  function openContextMenu(event: React.MouseEvent, target: MenuTarget) {
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]'))
      return;
    event.preventDefault();
    event.stopPropagation();
    if (
      home ||
      busy ||
      exportOpen ||
      aiOpen ||
      helpOpen ||
      onboarding ||
      closingRef.current ||
      fileOperation.current ||
      pendingNavigation
    )
      return;
    finishPreviewGesture(true);
    playingRef.current = false;
    setPlaying(false);
    if (target.kind === 'clip' || target.kind === 'preview') setSelected(target.id);
    const origin = event.currentTarget as HTMLElement;
    origin.focus({ preventScroll: true });
    setContextMenu({
      target,
      x: event.clientX,
      y: event.clientY,
      returnFocus: origin,
      session: projectSession.current,
    });
  }
  function keyboardContextMenu(event: React.KeyboardEvent) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.left + Math.min(24, rect.width / 2),
        clientY: rect.top + Math.min(24, rect.height / 2),
      }),
    );
  }
  useEffect(() => {
    if (
      home ||
      busy ||
      exportOpen ||
      aiOpen ||
      helpOpen ||
      onboarding ||
      closing ||
      fileBusy ||
      pendingNavigation
    )
      closeContextMenu();
  }, [
    home,
    busy,
    exportOpen,
    aiOpen,
    helpOpen,
    onboarding,
    closing,
    fileBusy,
    pendingNavigation,
    closeContextMenu,
  ]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('freecut-autosave', JSON.stringify(project));
      } catch {}
    }, 700);
    return () => clearTimeout(timer);
  }, [project]);
  useEffect(() => {
    let raf = 0,
      last = performance.now();
    const tick = (now: number) => {
      if (playingRef.current) {
        const end = durationOf(projectRef.current);
        const next = timeRef.current + (now - last) / 1000;
        if (next >= end) {
          setTime(end);
          setPlaying(false);
        } else setTime(next);
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    syncAudio(project, time, playing);
  }, [project, time, playing]);
  useEffect(() => {
    let dead = false,
      raf = 0,
      lastProject: Project | undefined,
      lastTime = -1,
      lastCanvas: HTMLCanvasElement | null = null;
    const preview = createPreviewRenderer();
    function draw() {
      if (dead) return;
      const p = projectRef.current,
        t = timeRef.current;
      if (
        canvas.current &&
        (lastProject !== p || lastTime !== t || lastCanvas !== canvas.current)
      ) {
        lastProject = p;
        lastTime = t;
        lastCanvas = canvas.current;
        void preview
          .request(canvas.current, p, t, {
            width: Math.round((720 * p.width) / Math.max(p.width, p.height)),
            height: Math.round((720 * p.height) / Math.max(p.width, p.height)),
          })
          .then((committed) => {
            if (committed && !dead) setError('');
          })
          .catch((e: Error) => {
            if (!dead) setError(e.message);
          });
      }
      if (!dead) raf = requestAnimationFrame(draw);
    }
    draw();
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      preview.dispose();
    };
  }, []);
  useEffect(
    () => () => {
      syncAudio(projectRef.current, 0, false);
      clearMediaCache();
    },
    [],
  );
  function switchLayout() {
    const next = !mobile;
    chooseLayout(next);
    notify(next ? t('已切换手机风格 · 所有专业功能仍可使用') : t('已切换专业布局'));
  }
  function setAnim(property: AnimProperty, value: number) {
    changeClip((c) => {
      const frames = c.keyframes[property];
      if (!frames?.length) return { ...c, transform: { ...c.transform, [property]: value } };
      const local = Math.max(0, Math.min(c.duration, time - c.start));
      const exists = frames.find((k) => Math.abs(k.time - local) < 0.5 / project.fps);
      return {
        ...c,
        keyframes: {
          ...c.keyframes,
          [property]: (exists
            ? frames.map((k) => (k.id === exists.id ? { ...k, value } : k))
            : [...frames, { id: uid(), time: local, value, easing: 'linear' as const }]
          ).sort((a, b) => a.time - b.time),
        },
      };
    });
  }
  function toggleKey(property: AnimProperty) {
    changeClip((c) => {
      const local = Math.max(0, Math.min(c.duration, time - c.start)),
        frames = c.keyframes[property] ?? [],
        exists = frames.find((k) => Math.abs(k.time - local) < 0.5 / project.fps);
      return {
        ...c,
        keyframes: {
          ...c.keyframes,
          [property]: exists
            ? frames.filter((k) => k.id !== exists.id)
            : [
                ...frames,
                {
                  id: uid(),
                  time: local,
                  value: evaluate(c, property, local),
                  easing: 'linear' as const,
                },
              ].sort((a, b) => a.time - b.time),
        },
      };
    });
  }
  function addAssetToTrack(id: string, trackId?: string, start?: number) {
    const asset = projectRef.current.assets.find((a) => a.id === id);
    if (!asset) return;
    const p = projectRef.current;
    const target =
      trackId ?? p.tracks.find((t) => t.kind === (asset.kind === 'audio' ? 'audio' : 'video'))!.id;
    if (p.tracks.find((t) => t.id === target)?.locked) {
      notify(t('目标轨道已锁定。'));
      return;
    }
    const track = p.tracks.find((t) => t.id === target);
    if (track?.kind === 'audio' && asset.kind !== 'audio') {
      notify(t('请将画面素材添加到视频或叠加轨道。'));
      return;
    }
    const position =
      start ??
      Math.max(
        timeRef.current,
        ...p.clips.filter((c) => c.trackId === target).map((c) => c.start + c.duration),
        0,
      );
    const c = createClip(asset.kind, target, {
      name: asset.name,
      assetId: id,
      start: position,
      duration: asset.kind === 'image' ? 5 : Math.max(0.1, asset.duration),
    });
    commit((p) => ({ ...p, clips: [...p.clips, c] }));
    setSelected(c.id);
    setTime(position);
  }
  function addAssets(assets: MediaAsset[]) {
    commit((p) => ({
      ...p,
      assets: [...new Map([...p.assets, ...assets].map((a) => [a.id, a])).values()],
    }));
    notify(t('已导入 {v0} 个素材，双击或拖入时间线。', { v0: assets.length }));
  }
  async function relinkMissing(assetId?: string) {
    const session = projectSession.current;
    const target = projectRef.current.assets.find((a) => (assetId ? a.id === assetId : a.missing));
    if (!target) return;
    if (!window.freecut) {
      notify(t('请在桌面版中重新链接本地素材。'));
      return;
    }
    try {
      notify(t('请选择缺失的素材：') + target.name);
      const files = await window.freecut.importMedia();
      if (session !== projectSession.current) {
        notify(t('已切换项目，先前的素材重连结果未应用。'));
        return;
      }
      if (files[0]) {
        if (files[0].kind !== target.kind)
          throw new Error(t('素材类型不一致，请选择相同类型的 ') + target.name);
        const required = Math.max(
          0,
          ...projectRef.current.clips
            .filter((c) => c.assetId === target.id)
            .map((c) => c.inPoint + c.duration * c.speed),
        );
        if (target.kind !== 'image' && files[0].duration + 0.05 < required)
          throw new Error(t('替换素材太短，需要至少 ') + required.toFixed(2) + t(' 秒。'));
        commit((p) => ({
          ...p,
          assets: p.assets.map((a) =>
            a.id === target.id ? { ...files[0], id: target.id, missing: false } : a,
          ),
        }));
        clearMediaCache();
        notify(t('素材已重新链接。'));
      }
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function importMedia() {
    const session = projectSession.current;
    try {
      if (window.freecut) {
        setBusy(true);
        const assets = await window.freecut.importMedia();
        if (session !== projectSession.current) {
          notify(t('已切换项目，先前选择的素材未加入当前项目。需要时请重新导入。'));
          return;
        }
        if (assets.length) addAssets(assets);
      } else fileInput.current?.click();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function browserImport(files: FileList | null) {
    if (!files) return;
    const session = projectSession.current;
    setBusy(true);
    try {
      const assets = await Promise.all(
        Array.from(files).map(
          (file) =>
            new Promise<MediaAsset>((resolve, reject) => {
              const kind = file.type.startsWith('audio/')
                  ? 'audio'
                  : file.type.startsWith('image/')
                    ? 'image'
                    : 'video',
                url = URL.createObjectURL(file),
                media =
                  kind === 'image'
                    ? new window.Image()
                    : document.createElement(kind === 'audio' ? 'audio' : 'video');
              const timer = setTimeout(
                () => reject(new Error(t('无法读取 {v0}', { v0: file.name }))),
                15000,
              );
              const done = () => {
                clearTimeout(timer);
                resolve({
                  id: uid(),
                  name: file.name,
                  kind,
                  url,
                  duration: media instanceof HTMLMediaElement ? media.duration : 5,
                  width:
                    media instanceof HTMLVideoElement
                      ? media.videoWidth
                      : media instanceof HTMLImageElement
                        ? media.naturalWidth
                        : undefined,
                  height:
                    media instanceof HTMLVideoElement
                      ? media.videoHeight
                      : media instanceof HTMLImageElement
                        ? media.naturalHeight
                        : undefined,
                });
              };
              media.addEventListener(kind === 'image' ? 'load' : 'loadedmetadata', done, {
                once: true,
              });
              media.onerror = () => {
                clearTimeout(timer);
                reject(new Error(t('格式暂不支持：{v0}', { v0: file.name })));
              };
              media.src = url;
            }),
        ),
      );
      if (session !== projectSession.current) {
        assets.forEach((asset) => URL.revokeObjectURL(asset.url));
        notify(t('已切换项目，先前选择的素材未加入当前项目。需要时请重新导入。'));
        return;
      }
      addAssets(assets);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  function writableTrack(kind: 'video' | 'audio' | 'overlay') {
    const existing = projectRef.current.tracks.find((t) => t.kind === kind && !t.locked);
    return (
      existing ?? {
        id: uid(),
        name: kind === 'audio' ? t('音频') : kind === 'video' ? t('画面') : t('叠加'),
        kind,
        locked: false,
        muted: false,
        hidden: false,
      }
    );
  }
  function addText(text = t('在这里输入文字'), style?: Partial<NonNullable<Clip['text']>>) {
    const target = writableTrack('overlay');
    const c = createClip('text', target.id, {
      name: text.split('\n')[0].slice(0, 16),
      start: time,
      text: {
        text,
        fontSize: 72,
        color: '#ffffff',
        background: 'transparent',
        align: 'center',
        bold: true,
        stroke: false,
        ...style,
      },
    });
    commit((p) => ({
      ...p,
      tracks: p.tracks.some((t) => t.id === target.id) ? p.tracks : [target, ...p.tracks],
      clips: [...p.clips, c],
    }));
    setSelected(c.id);
    setInspectorTab('basic');
    setInspectorOpen(true);
  }
  function addSubtitles(items: { start: number; duration: number; text: string }[]) {
    const trackId = uid();
    const clips = items.map((item) =>
      createClip('text', trackId, {
        name: item.text.slice(0, 20),
        start: item.start,
        duration: item.duration,
        transform: { x: 0, y: project.height * 0.36, scale: 1, rotation: 0, opacity: 1, volume: 1 },
        text: {
          text: item.text,
          fontSize: Math.round(project.height * 0.048),
          color: '#ffffff',
          background: 'transparent',
          align: 'center',
          bold: true,
          stroke: true,
        },
      }),
    );
    commit((p) => ({
      ...p,
      tracks: [
        {
          id: trackId,
          name: t('字幕'),
          kind: 'overlay',
          muted: false,
          hidden: false,
          locked: false,
        },
        ...p.tracks,
      ],
      clips: [...p.clips, ...clips],
    }));
    notify(t('已添加 {v0} 条字幕，可逐条编辑。', { v0: clips.length }));
  }
  function addAIAudio(asset: MediaAsset) {
    const target = writableTrack('audio');
    const c = createClip('audio', target.id, {
      name: asset.name,
      assetId: asset.id,
      start: time,
      duration: asset.duration,
    });
    commit((p) => ({
      ...p,
      tracks: p.tracks.some((t) => t.id === target.id) ? p.tracks : [...p.tracks, target],
      assets: p.assets.some((a) => a.id === asset.id) ? p.assets : [...p.assets, asset],
      clips: [...p.clips, c],
    }));
    setSelected(c.id);
    notify(t('音频已添加到时间线。'));
  }
  async function save() {
    finishPreviewGesture(true);
    if (fileOperation.current) return false;
    fileOperation.current = true;
    setFileBusy(true);
    const session = projectSession.current;
    const snapshot = structuredClone(projectRef.current);
    try {
      if (window.freecut) {
        const path = await window.freecut.saveProject(snapshot);
        if (!path) return false;
        if (projectSession.current === session) markSaved(snapshot);
        void refreshProjects();
        notify(t('工程已保存。'));
      } else {
        downloadFile(`${snapshot.name}.freecut`, JSON.stringify(snapshot, null, 2));
        if (projectSession.current === session) markSaved(snapshot);
        notify(t('工程已下载；浏览器素材需要在重开后重新导入。'));
      }
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    } finally {
      fileOperation.current = false;
      setFileBusy(false);
    }
  }
  function replaceProject(p: Project, saved = true) {
    finishPreviewGesture(true);
    projectSession.current++;
    closeContextMenu();
    setClipboard(undefined);
    setPlaying(false);
    clearMediaCache();
    history.current = [];
    future.current = [];
    setHistoryVersion((v) => v + 1);
    projectRef.current = p;
    setProject(p);
    if (saved) markSaved(p);
    else {
      savedRef.current = '';
      setSavedFingerprint('');
    }
    setTime(0);
    setSelected(undefined);
    setError('');
    enterEditor();
  }
  async function open() {
    navigate(openUnchecked);
  }
  async function openUnchecked() {
    if (!window.freecut) {
      projectInput.current?.click();
      return;
    }
    await loadDesktopProject(() => window.freecut!.openProject());
  }
  async function loadDesktopProject(load: () => Promise<Project | null>) {
    if (fileOperation.current) return;
    fileOperation.current = true;
    setFileBusy(true);
    const session = projectSession.current;
    const before = JSON.stringify(projectRef.current);
    try {
      const data = await load();
      if (!data) return;
      if (projectSession.current !== session || JSON.stringify(projectRef.current) !== before) {
        notify(t('打开文件期间当前工程有更新，已保留当前工程。请保存后重新打开。'));
        return;
      }
      replaceProject(validateProject(data));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      fileOperation.current = false;
      setFileBusy(false);
    }
  }
  async function openRecent(id: string) {
    navigate(async () => {
      if (window.freecut) await loadDesktopProject(() => window.freecut!.openRecentProject(id));
      await refreshProjects();
    });
  }
  async function finishNavigation(shouldSave: boolean) {
    if (!pendingNavigation || navigationBusy) return;
    setNavigationBusy(true);
    const before = JSON.stringify(projectRef.current);
    if (shouldSave && !(await save())) {
      setNavigationBusy(false);
      return;
    }
    if (JSON.stringify(projectRef.current) !== before) {
      notify(t('工程有新的更新，已保留当前工程。请检查后再继续。'));
      setNavigationBusy(false);
      return;
    }
    // Discarding a transition to Home also discards the in-memory editing session.
    // Creating/opening a project replaces it in the action below.
    const action = pendingNavigation.action;
    setPendingNavigation(undefined);
    try {
      await action();
    } finally {
      setNavigationBusy(false);
    }
  }
  function goHome() {
    navigate(() => {
      if (JSON.stringify(projectRef.current) !== savedRef.current) {
        projectSession.current++;
        const blank = createLocalizedProject();
        projectRef.current = blank;
        setProject(blank);
        markSaved(blank);
        setHasSession(false);
        history.current = [];
        future.current = [];
        setSelected(undefined);
        clearMediaCache();
      }
      setHome(true);
      setPlaying(false);
      setHelpOpen(false);
      setMobileShelf(false);
    });
  }
  function applyMotion(id: string) {
    if (!clip) {
      notify(t('先选择时间线中的画面或文字。'));
      return;
    }
    changeClip((c) => {
      const end = Math.min(1.2, c.duration / 2);
      const frames = (from: number, to: number) => [
        { id: uid(), time: 0, value: from, easing: 'ease-out' as const },
        { id: uid(), time: end, value: to, easing: 'linear' as const },
      ];
      if (id === 'fade')
        return {
          ...c,
          fadeIn: Math.min(0.6, c.duration / 2),
          fadeOut: Math.min(0.6, c.duration / 2),
        };
      if (id === 'zoom')
        return {
          ...c,
          keyframes: {
            ...c.keyframes,
            scale: [
              { id: uid(), time: 0, value: c.transform.scale, easing: 'linear' },
              { id: uid(), time: c.duration, value: c.transform.scale * 1.15, easing: 'linear' },
            ],
          },
        };
      if (id === 'slide')
        return { ...c, keyframes: { ...c.keyframes, x: frames(-project.width, c.transform.x) } };
      if (id === 'rise')
        return {
          ...c,
          keyframes: {
            ...c.keyframes,
            y: frames(project.height / 2, c.transform.y),
            opacity: frames(0, 1),
          },
        };
      if (id === 'pop')
        return {
          ...c,
          keyframes: {
            ...c.keyframes,
            scale: frames(0.2, c.transform.scale),
            opacity: frames(0, 1),
          },
        };
      return {
        ...c,
        keyframes: {
          ...c.keyframes,
          rotation: frames(-20, c.transform.rotation),
          opacity: frames(0, 1),
        },
      };
    });
    setInspectorTab('keyframes');
    notify(t('动画已应用，可在关键帧中继续调整。'));
  }
  async function doExport() {
    const api = window.freecut;
    if (!api) return;
    setBusy(true);
    setPlaying(false);
    setProgress(0);
    setExportPath('');
    setExportPhase(t('准备导出'));
    cancelled.current = false;
    let unsub: undefined | (() => void);
    try {
      const p = structuredClone(projectRef.current),
        dur = durationOf(p),
        short = +exportSize,
        factor = short / Math.min(p.width, p.height),
        width = Math.round((p.width * factor) / 2) * 2,
        height = Math.round((p.height * factor) / 2) * 2;
      const out = await api.beginExport({
        project: p,
        width,
        height,
        fps: exportFps,
        duration: dur,
        quality,
        format: 'mp4',
        frameFormat: 'rgba',
        pipeline: 'auto',
      });
      if (!out) {
        setBusy(false);
        return;
      }
      job.current = out.jobId;
      let framesComplete = out.pipeline === 'native';
      unsub = api.onExportProgress((event) => {
        if (event.jobId === out.jobId && event.phase === 'encoding' && framesComplete) {
          setExportPhase(t('编码视频与混合音频'));
          setProgress(out.pipeline === 'native' ? event.progress * 100 : 90 + event.progress * 10);
        }
      });
      const offscreen = document.createElement('canvas'),
        count = Math.ceil(dur * exportFps);
      let lastProgress = 0;
      for (let i = 0; out.pipeline !== 'native' && i < count; i++) {
        if (cancelled.current) break;
        await renderProject(offscreen, p, i / exportFps, { width, height });
        const pixels = offscreen.getContext('2d')!.getImageData(0, 0, width, height).data;
        if (cancelled.current) break;
        await api.writeFrame({
          jobId: out.jobId,
          index: i,
          bytes: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
        });
        const now = performance.now();
        if (now - lastProgress >= 100 || i === count - 1) {
          setExportPhase(t('渲染画面 {v0} / {v1}', { v0: i + 1, v1: count }));
          setProgress(((i + 1) / count) * 90);
          lastProgress = now;
        }
      }
      framesComplete = true;
      if (cancelled.current) {
        await api.cancelExport(out.jobId);
        notify(t('导出已取消。'));
      } else {
        setExportPhase(t('编码视频与混合音频'));
        const result = await api.finishExport(out.jobId);
        setProgress(100);
        setExportPath(result.path);
        setExportPhase(t('导出完成'));
        notify(t('视频已导出，无水印。'));
      }
    } catch (e) {
      if (!cancelled.current) {
        setExportPhase(t('导出失败'));
        notify((e as Error).message);
        setError((e as Error).message);
      }
      if (job.current) await api.cancelExport(job.current).catch(() => {});
    } finally {
      unsub?.();
      job.current = undefined;
      setBusy(false);
    }
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (previewGesture.current) {
        if (event.key === 'Escape') finishPreviewGesture(true);
        event.preventDefault();
        return;
      }
      const element = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable)
        return;
      if (
        contextMenu ||
        home ||
        exportOpen ||
        aiOpen ||
        helpOpen ||
        onboarding ||
        closingRef.current ||
        fileOperation.current ||
        pendingNavigation
      )
        return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.key === 'Escape') {
        setInspectorOpen(false);
        setMobileShelf(false);
      } else if (event.code === 'Space') {
        event.preventDefault();
        setPlaying((p) => !p);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        remove();
      } else if (mod && key === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (mod && key === 's') {
        event.preventDefault();
        void save();
      } else if (mod && key === 'o') {
        event.preventDefault();
        void open();
      } else if (mod && key === 'b') {
        event.preventDefault();
        split();
      } else if (mod && key === 'c') {
        event.preventDefault();
        copyClipById(selected);
      } else if (mod && key === 'x') {
        event.preventDefault();
        copyClipById(selected, true);
      } else if (mod && key === 'v') {
        event.preventDefault();
        pasteClip();
      } else if (mod && key === 'd') {
        event.preventDefault();
        duplicateClipById(selected);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        seek(timeRef.current + (event.key === 'ArrowLeft' ? -1 : 1) / projectRef.current.fps);
      } else if (event.key.toLowerCase() === 'k') {
        setInspectorTab('keyframes');
        setInspectorOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    selected,
    clipboard,
    contextMenu,
    language,
    home,
    exportOpen,
    aiOpen,
    helpOpen,
    onboarding,
    pendingNavigation,
    remove,
    undo,
    redo,
    split,
    seek,
  ]);
  const assets = project.assets.filter(
    (a) =>
      (tab !== 'audio' || a.kind === 'audio') &&
      a.name.toLowerCase().includes(search.toLowerCase()),
  );
  const toolButtons = [
    {
      label: t('关键帧'),
      description: t('为位置、缩放、声音添加动画'),
      icon: Diamond,
      action: () => {
        setInspectorTab('keyframes');
        setInspectorOpen(true);
      },
    },
    {
      label: t('自动字幕'),
      description: t('下载开源模型，识别中英文'),
      icon: Captions,
      action: () => {
        setAITab('asr');
        setAIOpen(true);
      },
    },
    {
      label: t('语音朗读'),
      description: t('将文字变成时间线上的声音'),
      icon: Mic,
      action: () => {
        setAITab('tts');
        setAIOpen(true);
      },
    },
    {
      label: t('蒙版与抠像'),
      description: t('圆形、矩形与绿幕蓝幕'),
      icon: Layers,
      action: () => {
        setInspectorTab('effects');
        setInspectorOpen(true);
      },
    },
    {
      label: t('导入 SRT 字幕'),
      description: t('保留时间码，逐条编辑'),
      icon: Upload,
      action: () => srtInput.current?.click(),
    },
    {
      label: t('导出 SRT 字幕'),
      description: t('保存文字轨道为字幕文件'),
      icon: Download,
      action: () =>
        downloadFile(
          `${project.name}.srt`,
          toSrt(project.clips.filter((c) => c.kind === 'text')),
          'text/plain',
        ),
    },
    {
      label: t('添加叠加轨道'),
      description: t('放置画中画、文字和图形'),
      icon: Plus,
      action: () =>
        commit((p) => ({
          ...p,
          tracks: [
            {
              id: uid(),
              name: t('叠加 {v0}', { v0: p.tracks.filter((t) => t.kind === 'overlay').length + 1 }),
              kind: 'overlay',
              hidden: false,
              muted: false,
              locked: false,
            },
            ...p.tracks,
          ],
        })),
    },
  ];
  function contextContent(): { label: string; items: ContextMenuItem[] } | undefined {
    if (!contextMenu || contextMenu.session !== projectSession.current) return;
    const target = contextMenu.target,
      p = projectRef.current;
    const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
    const pasting = (trackId?: string, at?: number): ContextMenuItem => ({
      id: 'paste',
      label: t('粘贴'),
      shortcut: `${mod}+V`,
      disabled: !pasteDestination(trackId),
      onSelect: () => pasteClip(trackId, at),
    });
    const historyItems = (): ContextMenuItem[] => [
      {
        id: 'undo',
        label: t('撤销'),
        shortcut: `${mod}+Z`,
        separatorBefore: true,
        disabled: !history.current.length,
        onSelect: undo,
      },
      {
        id: 'redo',
        label: t('重做'),
        shortcut: `${mod}+Shift+Z`,
        disabled: !future.current.length,
        onSelect: redo,
      },
    ];
    const trackItems = (id: string): ContextMenuItem[] => {
      const track = p.tracks.find((item) => item.id === id);
      if (!track) return [];
      return [
        {
          id: 'track-mute',
          label: track.muted ? t('取消静音') : t('轨道静音'),
          checked: track.muted,
          onSelect: () => toggleTrack(id, 'muted'),
        },
        {
          id: 'track-hide',
          label: track.hidden ? t('显示轨道') : t('隐藏轨道'),
          checked: track.hidden,
          onSelect: () => toggleTrack(id, 'hidden'),
        },
        {
          id: 'track-lock',
          label: track.locked ? t('解锁轨道') : t('锁定轨道'),
          checked: track.locked,
          onSelect: () => toggleTrack(id, 'locked'),
        },
      ];
    };
    if (target.kind === 'clip' || (target.kind === 'preview' && target.id)) {
      const item = p.clips.find((item) => item.id === target.id);
      if (!item) return;
      const locked = !!p.tracks.find((track) => track.id === item.trackId)?.locked;
      const visual = item.kind !== 'audio';
      const items: ContextMenuItem[] = [
        {
          id: 'split',
          label: t('在播放头处分割'),
          shortcut: `${mod}+B`,
          disabled:
            locked || time <= item.start + 1e-8 || time >= item.start + item.duration - 1e-8,
          onSelect: () => splitClipById(item.id),
        },
        {
          id: 'copy',
          label: t('复制'),
          shortcut: `${mod}+C`,
          separatorBefore: true,
          onSelect: () => copyClipById(item.id),
        },
        {
          id: 'cut',
          label: t('剪切'),
          shortcut: `${mod}+X`,
          disabled: locked,
          onSelect: () => copyClipById(item.id, true),
        },
        pasting(item.trackId),
        {
          id: 'duplicate',
          label: t('复制到片段后'),
          shortcut: `${mod}+D`,
          disabled: locked,
          onSelect: () => duplicateClipById(item.id),
        },
        {
          id: 'delete',
          label: t('删除片段'),
          shortcut: 'Delete',
          danger: true,
          disabled: locked,
          onSelect: () => removeClipById(item.id),
        },
        {
          id: 'keyframes',
          label: t('关键帧'),
          shortcut: 'K',
          separatorBefore: true,
          onSelect: () => {
            setSelected(item.id);
            setInspectorTab('keyframes');
            setInspectorOpen(true);
          },
        },
      ];
      if (visual)
        items.push(
          {
            id: 'flip-x',
            label: t('水平翻转'),
            checked: item.effects.flipX,
            disabled: locked,
            onSelect: () =>
              editClipById(item.id, (c) => ({
                ...c,
                effects: { ...c.effects, flipX: !c.effects.flipX },
              })),
          },
          {
            id: 'flip-y',
            label: t('垂直翻转'),
            checked: item.effects.flipY,
            disabled: locked,
            onSelect: () =>
              editClipById(item.id, (c) => ({
                ...c,
                effects: { ...c.effects, flipY: !c.effects.flipY },
              })),
          },
        );
      const track = trackItems(item.trackId);
      if (track[0]) track[0].separatorBefore = true;
      items.push(...track);
      return { label: target.kind === 'preview' ? t('预览菜单') : t('片段菜单'), items };
    }
    if (target.kind === 'track') {
      if (!p.tracks.some((track) => track.id === target.id)) return;
      const items: ContextMenuItem[] = [pasting(target.id, target.atTime)];
      if (target.atTime !== undefined)
        items.push({
          id: 'seek',
          label: t('移动播放头到此处'),
          onSelect: () => seek(target.atTime!),
        });
      const tracks = trackItems(target.id);
      if (tracks[0]) tracks[0].separatorBefore = true;
      items.push(
        ...tracks,
        {
          id: 'add-track',
          label: t('添加叠加轨道'),
          separatorBefore: true,
          onSelect: toolButtons[6].action,
        },
        ...historyItems(),
      );
      return { label: t('轨道菜单'), items };
    }
    if (target.kind === 'asset') {
      const asset = p.assets.find((a) => a.id === target.id);
      if (!asset) return;
      const track = p.tracks.find(
        (track) => track.kind === (asset.kind === 'audio' ? 'audio' : 'video') && !track.locked,
      );
      const used = p.clips.some((clip) => clip.assetId === asset.id);
      const items: ContextMenuItem[] = [
        {
          id: 'asset-at-playhead',
          label: t('添加到播放头'),
          disabled: !track || asset.missing,
          onSelect: () => addAssetToTrack(asset.id, track?.id, timeRef.current),
        },
        {
          id: 'asset-at-end',
          label: t('添加到末尾'),
          disabled: !track || asset.missing,
          onSelect: () =>
            addAssetToTrack(
              asset.id,
              track?.id,
              Math.max(
                0,
                ...projectRef.current.clips
                  .filter((c) => c.trackId === track?.id)
                  .map((c) => c.start + c.duration),
              ),
            ),
        },
      ];
      if (asset.missing)
        items.push({
          id: 'relink',
          label: t('重新链接素材'),
          onSelect: () => {
            void relinkMissing(asset.id);
          },
        });
      items.push({
        id: 'remove-asset',
        label: t('从素材库移除'),
        shortcut: used ? t('正在使用') : undefined,
        disabled: used,
        danger: true,
        separatorBefore: true,
        onSelect: () => {
          commit((p) =>
            p.clips.some((c) => c.assetId === asset.id)
              ? p
              : { ...p, assets: p.assets.filter((a) => a.id !== asset.id) },
          );
          notify(t('已从素材库移除，原文件保留。'));
        },
      });
      return { label: t('素材菜单'), items };
    }
    const items: ContextMenuItem[] = [];
    if (target.kind !== 'library')
      items.push(pasting(undefined, target.kind === 'timeline' ? target.atTime : undefined));
    if (target.kind === 'timeline')
      items.push({ id: 'seek', label: t('移动播放头到此处'), onSelect: () => seek(target.atTime) });
    items.push(
      {
        id: 'import',
        label: t('导入素材'),
        separatorBefore: items.length > 0,
        onSelect: () => {
          void importMedia();
        },
      },
      { id: 'add-text', label: t('添加文字'), onSelect: () => addText() },
      { id: 'add-track', label: t('添加叠加轨道'), onSelect: toolButtons[6].action },
      ...historyItems(),
    );
    return {
      label:
        target.kind === 'library'
          ? t('素材库菜单')
          : target.kind === 'preview'
            ? t('预览菜单')
            : t('时间线菜单'),
      items,
    };
  }
  const menuContent = contextContent();
  return (
    <div
      className={`app ${home ? 'home-view' : ''} ${mobile ? 'mobile-mode' : ''} ${mobileShelf ? 'shelf-open' : ''} ${!inspectorOpen ? 'inspector-collapsed' : ''}`}
    >
      {contextMenu && menuContent && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          label={t(menuContent.label)}
          items={menuContent.items.map((item) => ({ ...item, label: t(item.label) }))}
          onClose={closeContextMenu}
          returnFocus={contextMenu.returnFocus}
        />
      )}
      <UpdateNotice
        busy={
          closing ||
          fileBusy ||
          busy ||
          playing ||
          (!home && (exportOpen || aiOpen || onboarding || helpOpen)) ||
          !!pendingNavigation
        }
      />
      {home ? (
        <Home
          projects={recentProjects}
          mobile={mobile}
          mode={keyframeMode}
          setMobile={chooseLayout}
          setMode={changeKeyframeMode}
          create={() => navigate(() => replaceProject(createLocalizedProject()))}
          open={() => void open()}
          demo={() => {
            replaceProject(demoProject(), false);
            setTime(2);
          }}
          resume={enterEditor}
          hasSession={hasSession}
          openRecent={(id) => void openRecent(id)}
          removeRecent={(id) => {
            void window.freecut
              ?.removeRecentProject(id)
              .then(refreshProjects)
              .catch((e) => notify(String(e)));
          }}
          notify={notify}
        />
      ) : (
        <>
          <header className="topbar">
            <button className="icon-button" title={t('返回首页')} onClick={goHome}>
              <House size={18} />
            </button>
            <div className="brand">
              <span className="brand-symbol">
                <BrandIcon size={36} />
              </span>
              <strong>{t('水管剪辑')}</strong>
              {language === 'zh-CN' && <span className="brand-english">FreeCut</span>}
            </div>
            <button
              className={`layout-switch ${onboarding && tourStep === 1 ? 'tour-highlight' : ''}`}
              title={t('切换专业布局 / 手机风格')}
              onClick={switchLayout}
            >
              {mobile ? <Smartphone size={17} /> : <Monitor size={17} />}
              <span>{mobile ? t('手机风格') : t('专业布局')}</span>
            </button>
            <button
              className="mode-switch"
              title={t('切换关键帧操作模式')}
              onClick={() => changeKeyframeMode(keyframeMode === 'easy' ? 'pro' : 'easy')}
            >
              <Diamond size={14} />
              {keyframeMode === 'easy' ? t('普通（易用）') : t('专业模式')}
            </button>
            <div className="top-divider" />
            <input
              className="project-title"
              aria-label={t('工程名称')}
              value={project.name}
              onChange={(e) => commit((p) => ({ ...p, name: e.target.value.slice(0, 100) }))}
            />
            <span className={`local-badge ${dirty ? 'unsaved' : ''}`}>
              {dirty ? t('未保存') : t('已保存')}
            </span>
            <div className="top-actions">
              <select
                className="editor-language"
                aria-label={t('界面语言 / Language')}
                value={language}
                onChange={(event) => {
                  closeContextMenu();
                  setLanguage(event.target.value as Language);
                }}
              >
                <option value="zh-CN">{t('简体中文')}</option>
                <option value="en">English</option>
              </select>
              <button
                title={t('新建工程')}
                onClick={() => navigate(() => replaceProject(createLocalizedProject()))}
              >
                <Plus size={16} />
                <span>{t('新建')}</span>
              </button>
              <button title={t('打开工程 Ctrl+O')} onClick={() => void open()}>
                <FolderOpen size={16} />
                <span>{t('打开')}</span>
              </button>
              <button title={t('保存工程 Ctrl+S')} onClick={() => void save()}>
                <Save size={16} />
                <span>{t('保存')}</span>
              </button>
              <button
                className="icon-button"
                title={t('新手引导和快捷键')}
                onClick={() => setHelpOpen(true)}
              >
                <HelpCircle size={17} />
              </button>
              <button
                className="primary export-trigger"
                disabled={!duration || busy}
                onClick={() => {
                  setExportOpen(true);
                  setExportPath('');
                  setProgress(0);
                  setExportFps(project.fps);
                }}
              >
                <Download size={16} />
                {t('导出')}
              </button>
            </div>
          </header>
          <div className="workspace">
            <nav className="tool-nav" aria-label={t('创作工具')}>
              {nav.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={tab === id ? 'active' : ''}
                  onClick={() => {
                    setTab(id);
                    setSearch('');
                    if (mobile) setMobileShelf(id === tab ? !mobileShelf : true);
                  }}
                >
                  <Icon size={21} />
                  <span>{t(label)}</span>
                </button>
              ))}
              <div className="nav-spacer" />
              <button
                className="ai-nav"
                onClick={() => {
                  setAITab('asr');
                  setAIOpen(true);
                }}
              >
                <Captions size={21} />
                <span>{t('AI 语音')}</span>
              </button>
            </nav>
            <aside className="library">
              <div className="panel-heading">
                <span>
                  {t('{name}工作区', { name: t(nav.find((n) => n.id === tab)?.label ?? '') })}
                </span>
                <span className="small muted">
                  {tab === 'media' ? t('{v0} 项', { v0: project.assets.length }) : ''}
                </span>
              </div>
              <div className="library-search">
                <Search size={14} />
                <input
                  aria-label={t('搜索素材或工具')}
                  placeholder={t('搜索素材、效果或工具')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button title={t('清空搜索')} onClick={() => setSearch('')}>
                    <X size={12} />
                  </button>
                )}
              </div>
              <div
                className="library-body"
                onContextMenu={(event) => {
                  if (tab === 'media' || tab === 'audio')
                    openContextMenu(event, { kind: 'library' });
                }}
              >
                {(tab === 'media' || tab === 'audio') && (
                  <>
                    <button
                      className="import-button"
                      disabled={busy}
                      onClick={() => void importMedia()}
                    >
                      {busy ? <Loader2 className="spin" size={17} /> : <Plus size={18} />}
                      {tab === 'audio' ? t('导入音频') : t('导入素材')}
                    </button>
                    <p className="library-caption">{t('视频、图片、音频 · 保留原文件')}</p>
                    {project.assets.some((a) => a.missing) && (
                      <button className="import-button" onClick={() => void relinkMissing()}>
                        <FolderOpen size={15} />
                        {t('重新链接素材')}
                      </button>
                    )}
                    {assets.length ? (
                      <div className="asset-grid">
                        {assets.map((asset) => (
                          <button
                            key={asset.id}
                            className="asset-card"
                            data-asset-id={asset.id}
                            draggable
                            onContextMenu={(event) =>
                              openContextMenu(event, { kind: 'asset', id: asset.id })
                            }
                            onKeyDown={keyboardContextMenu}
                            onDragStart={(e) => e.dataTransfer.setData('freecut/asset', asset.id)}
                            onDoubleClick={() => addAssetToTrack(asset.id)}
                            title={t('双击添加，拖入时间线，或右键查看更多操作')}
                          >
                            <div className={`asset-preview ${asset.kind}`}>
                              {asset.kind === 'image' ? (
                                <img src={asset.url} alt="" />
                              ) : asset.kind === 'audio' ? (
                                <Music2 size={27} />
                              ) : (
                                <Film size={27} />
                              )}
                              <span>
                                {asset.kind === 'image'
                                  ? t('图片')
                                  : `${asset.duration.toFixed(1)}s`}
                              </span>
                              <span
                                className="asset-add"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addAssetToTrack(asset.id);
                                }}
                              >
                                <Plus size={14} />
                              </span>
                            </div>
                            <span className="asset-name">{asset.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="library-empty">
                        <FolderOpen size={32} />
                        <h3>{search ? t('没有匹配的素材') : t('好作品，从素材开始')}</h3>
                        <p>
                          {search
                            ? t('换一个关键词试试。')
                            : t('点击导入，然后将素材拖入下方时间线。')}
                        </p>
                      </div>
                    )}
                    {tab === 'audio' && (
                      <SoundLibrary onAddAsset={addAIAudio} notify={notify} search={search} />
                    )}
                    {tab === 'audio' && (
                      <button
                        className="feature-row"
                        onClick={() => {
                          setAITab('tts');
                          setAIOpen(true);
                        }}
                      >
                        <Mic size={20} />
                        <span>
                          <strong>{t('语音朗读')}</strong>
                          <small>{t('下载开源声音，将文字变成配音')}</small>
                        </span>
                        <ArrowRight size={15} />
                      </button>
                    )}
                  </>
                )}
                {tab === 'text' && (
                  <>
                    <button className="import-button" onClick={() => addText()}>
                      <Plus size={17} />
                      {t('添加文字')}
                    </button>
                    <div className="text-presets">
                      {[
                        { text: t('你的故事\n值得被看见'), label: t('双行大标题'), fontSize: 100 },
                        {
                          text: t('记录生活的每一刻'),
                          label: t('简洁字幕'),
                          fontSize: 52,
                          stroke: true,
                        },
                        { text: 'CHAPTER 01', label: t('章节标题'), fontSize: 70 },
                        {
                          text: t('自由表达，不设边界。'),
                          label: t('文字底条'),
                          fontSize: 52,
                          background: '#1a1e22',
                        },
                      ].map((item) => (
                        <button key={item.label} onClick={() => addText(item.text, item)}>
                          <span style={{ fontSize: item.label === t('双行大标题') ? 21 : 15 }}>
                            {item.text}
                          </span>
                          <small>{item.label}</small>
                        </button>
                      ))}
                    </div>
                    <button className="feature-row" onClick={() => srtInput.current?.click()}>
                      <Upload size={19} />
                      <span>
                        <strong>{t('导入 SRT 字幕')}</strong>
                        <small>{t('自动生成可编辑字幕片段')}</small>
                      </span>
                    </button>
                    <button
                      className="feature-row"
                      onClick={() => {
                        setAITab('asr');
                        setAIOpen(true);
                      }}
                    >
                      <Captions size={19} />
                      <span>
                        <strong>{t('自动识别字幕')}</strong>
                        <small>{t('首次下载后本地识别')}</small>
                      </span>
                    </button>
                  </>
                )}
                {tab === 'effects' && (
                  <>
                    <p className="library-caption">{t('选择片段后点击应用 · 原创参数预设')}</p>
                    <div className="effect-grid">
                      {effectPresets
                        .filter((e) =>
                          (t(e.name) + t(e.category) + t(e.description))
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                        )
                        .map((effect) => (
                          <button
                            key={effect.id}
                            onClick={() => {
                              if (!clip) {
                                notify(t('先选择时间线里的片段。'));
                                return;
                              }
                              if (project.tracks.find((t) => t.id === clip.trackId)?.locked) {
                                notify(t('请先解锁片段所在轨道。'));
                                return;
                              }
                              if (clip.kind === 'audio') {
                                notify(t('画面特效需要选择视频、图片、文字或色卡。'));
                                return;
                              }
                              if (
                                (effect.values.pixelate || effect.values.chroma) &&
                                !['video', 'image'].includes(clip.kind)
                              ) {
                                notify(t('像素化和色度抠像需要选择视频或图片片段。'));
                                return;
                              }
                              changeClip((c) => ({
                                ...c,
                                effects: { ...defaultEffects(), ...effect.values },
                              }));
                              setInspectorTab('effects');
                              notify(t('已应用「{v0}」', { v0: t(effect.name) }));
                            }}
                            title={t(effect.description)}
                          >
                            <div className="effect-swatch" style={{ background: effect.swatch }}>
                              <span
                                style={{
                                  filter: `grayscale(${effect.values.grayscale ?? 0}) blur(${effect.values.blur ? 2 : 0}px)`,
                                }}
                              >
                                Fc
                              </span>
                            </div>
                            <strong>{t(effect.name)}</strong>
                            <small>{t(effect.category)}</small>
                          </button>
                        ))}
                    </div>
                  </>
                )}
                {tab === 'motion' && (
                  <>
                    <p className="library-caption">{t('动画会生成可编辑的关键帧')}</p>
                    <div className="motion-list">
                      {[
                        { id: 'fade', label: t('淡入淡出'), sub: t('画面与声音柔和进入、离开') },
                        { id: 'zoom', label: t('缓慢推近'), sub: t('让静态画面也有镜头感') },
                        { id: 'slide', label: t('左侧滑入'), sub: t('适合标题与画中画') },
                        { id: 'rise', label: t('向上浮现'), sub: t('位置与透明度联动') },
                        { id: 'pop', label: t('缩放出现'), sub: t('从小到大，自然定格') },
                        { id: 'rotate', label: t('旋转入场'), sub: t('轻微倾斜，渐显归位') },
                      ].map((item) => (
                        <button key={item.id} onClick={() => applyMotion(item.id)}>
                          <Layers size={22} />
                          <span>
                            <strong>{item.label}</strong>
                            <small>{item.sub}</small>
                          </span>
                          <ArrowRight size={14} />
                        </button>
                      ))}
                    </div>
                    <p className="note">
                      {t('跨片段叠化：将上下轨片段重叠，再为上层设置淡入／淡出。')}
                    </p>
                  </>
                )}
                {tab === 'tools' && (
                  <>
                    {toolButtons
                      .filter((t) => (t.label + t.description).includes(search))
                      .map(({ label, description, icon: Icon, action }) => (
                        <button key={label} className="feature-row" onClick={action}>
                          <Icon size={19} />
                          <span>
                            <strong>{label}</strong>
                            <small>{description}</small>
                          </span>
                          <ArrowRight size={13} />
                        </button>
                      ))}
                    <button
                      className="feature-row"
                      onClick={() => {
                        const target = writableTrack('video');
                        const c = createClip('shape', target.id, {
                          name: t('纯色色卡'),
                          start: time,
                          color: '#254c49',
                        });
                        commit((p) => ({
                          ...p,
                          tracks: p.tracks.some((t) => t.id === target.id)
                            ? p.tracks
                            : [target, ...p.tracks],
                          clips: [...p.clips, c],
                        }));
                        setSelected(c.id);
                      }}
                    >
                      <Palette size={19} />
                      <span>
                        <strong>{t('添加色卡')}</strong>
                        <small>{t('纯色背景，可缩放与添加动画')}</small>
                      </span>
                    </button>
                  </>
                )}
              </div>
              <div className="library-footer">
                <span className="status-dot" />
                {t('离线创作 · 无水印')}
              </div>
            </aside>
            <main className="preview-panel">
              <div className="preview-header">
                <span>{t('播放器')}</span>
                <div>
                  <select
                    aria-label={t('画布比例')}
                    value={`${project.width}:${project.height}`}
                    onChange={(e) => {
                      const [width, height] = e.target.value.split(':').map(Number);
                      commit((p) => ({ ...p, width, height }));
                    }}
                  >
                    {!presets.some(
                      (p) => p.width === project.width && p.height === project.height,
                    ) && (
                      <option value={`${project.width}:${project.height}`}>{t('自定义')}</option>
                    )}
                    {presets.map((p) => (
                      <option key={p.label} value={`${p.width}:${p.height}`}>
                        {t(p.label)}
                      </option>
                    ))}
                  </select>
                  <button
                    className="icon-button"
                    title={t('显示或隐藏属性检查器')}
                    onClick={() => setInspectorOpen(!inspectorOpen)}
                  >
                    <PanelRightOpen size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title={t('全屏预览')}
                    onClick={() => canvas.current?.requestFullscreen()}
                  >
                    <Maximize2 size={15} />
                  </button>
                </div>
              </div>
              <div
                className="stage"
                tabIndex={0}
                aria-label={t('预览画布区域')}
                onContextMenu={(event) => openContextMenu(event, { kind: 'preview' })}
                onKeyDown={keyboardContextMenu}
              >
                <canvas
                  ref={canvas}
                  aria-label={t('视频预览')}
                  style={{ aspectRatio: `${project.width}/${project.height}` }}
                />
                <PreviewTransform
                  canvas={canvas}
                  project={project}
                  time={time}
                  selected={selected}
                  disabled={
                    closing ||
                    fileBusy ||
                    busy ||
                    exportOpen ||
                    aiOpen ||
                    onboarding ||
                    !!pendingNavigation
                  }
                  onSelect={(id) => {
                    playingRef.current = false;
                    setPlaying(false);
                    setSelected(id);
                  }}
                  onStart={startPreviewGesture}
                  onChange={changePreviewTransform}
                  onEnd={finishPreviewGesture}
                  onContextMenu={(event, id) => openContextMenu(event, { kind: 'preview', id })}
                />
                {!project.clips.length && (
                  <div className="stage-empty">
                    <span className="empty-mark">
                      <BrandIcon size={60} />
                    </span>
                    <h1>{t('让灵感，从这一剪开始。')}</h1>
                    <p>{t('你的素材，你的节奏，你的作品。')}</p>
                    <button className="primary" onClick={() => void importMedia()}>
                      <Plus size={16} />
                      {t('导入素材')}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        navigate(() => {
                          replaceProject(demoProject(), false);
                          setTime(2);
                        });
                        notify(t('已打开原创示例，选择标题查看关键帧。'));
                      }}
                    >
                      {t('先试试示例工程')}
                      <ArrowRight size={13} />
                    </button>
                  </div>
                )}
                {error && (
                  <div className="preview-error">
                    <strong>{t('预览遇到问题')}</strong>
                    <span>{error}</span>
                    <button
                      onClick={() => {
                        clearMediaCache();
                        setTime(time + 0.001);
                      }}
                    >
                      {t('重试')}
                    </button>
                  </div>
                )}
              </div>
              <div className="playback-controls">
                <div className="time-readout">
                  <b>{timecode(time, project.fps)}</b>
                  <span>/ {timecode(duration, project.fps)}</span>
                </div>
                <div className="transport">
                  <button title={t('回到起点')} onClick={() => seek(0)}>
                    <SkipBack size={17} />
                  </button>
                  <button
                    className="play-button"
                    disabled={!duration || busy}
                    title={t('播放 / 暂停 Space')}
                    onClick={() => {
                      if (time >= duration) setTime(0);
                      setPlaying(!playing);
                    }}
                  >
                    {playing ? (
                      <Pause size={21} fill="currentColor" />
                    ) : (
                      <Play size={21} fill="currentColor" />
                    )}
                  </button>
                  <button title={t('跳到结尾')} onClick={() => seek(duration)}>
                    <SkipForward size={17} />
                  </button>
                </div>
                <span className="preview-quality">
                  {t('预览适配')}
                  <span>·</span> {project.fps} fps
                </span>
              </div>
              <div className="quick-tools">
                <button
                  onClick={() => {
                    setInspectorTab('keyframes');
                    setInspectorOpen(true);
                  }}
                >
                  <Diamond size={14} />
                  {t('关键帧')}
                </button>
                <button
                  onClick={() => {
                    setAITab('asr');
                    setAIOpen(true);
                  }}
                >
                  <Captions size={15} />
                  {t('自动字幕')}
                </button>
                <button
                  onClick={() => {
                    setAITab('tts');
                    setAIOpen(true);
                  }}
                >
                  <Mic size={15} />
                  {t('语音朗读')}
                </button>
                <button
                  onClick={() => {
                    setInspectorTab('effects');
                    setInspectorOpen(true);
                  }}
                >
                  <SlidersHorizontal size={14} />
                  {t('画面调整')}
                </button>
              </div>
            </main>
            <Inspector
              mode={keyframeMode}
              setMode={changeKeyframeMode}
              applyMotion={applyMotion}
              onClose={() => setInspectorOpen(false)}
              clip={clip}
              project={project}
              time={time}
              tab={inspectorTab}
              setTab={setInspectorTab}
              change={changeClip}
              setAnim={setAnim}
              toggleKey={toggleKey}
              seek={seek}
            />
          </div>
          <section className="timeline-panel" aria-label={t('多轨时间线')}>
            <div className="timeline-toolbar">
              <div className="edit-actions">
                <button
                  className="icon-button"
                  title={t('撤销 Ctrl+Z')}
                  disabled={!history.current.length}
                  onClick={undo}
                >
                  <Undo2 size={17} />
                </button>
                <button
                  className="icon-button"
                  title={t('重做 Ctrl+Shift+Z')}
                  disabled={!future.current.length}
                  onClick={redo}
                >
                  <Redo2 size={17} />
                </button>
                <i />
                <button title={t('分割 Ctrl+B')} disabled={!clip} onClick={split}>
                  <Scissors size={16} />
                  <span>{t('分割')}</span>
                </button>
                <button
                  className="icon-button"
                  title={t('复制片段')}
                  disabled={!clip}
                  onClick={duplicate}
                >
                  <Copy size={16} />
                </button>
                <button
                  className="icon-button"
                  title={t('删除 Delete')}
                  disabled={!clip}
                  onClick={remove}
                >
                  <Trash2 size={16} />
                </button>
                <i />
                <button
                  className={snap ? 'active' : ''}
                  title={t('磁吸对齐')}
                  onClick={() => setSnap(!snap)}
                >
                  <Magnet size={16} />
                  <span>{t('吸附')}</span>
                </button>
              </div>
              <div className="timeline-info">
                {t('{count}个片段', { count: project.clips.length })}
                <span>·</span>
                {t('{seconds}秒', { seconds: duration.toFixed(1) })}
              </div>
              <div className="timeline-zoom">
                <button
                  title={t('缩小时间线')}
                  onClick={() => setZoom((v) => Math.max(12, v - 15))}
                >
                  <Minus size={14} />
                </button>
                <input
                  aria-label={t('时间线缩放')}
                  type="range"
                  min={12}
                  max={180}
                  value={zoom}
                  onChange={(e) => setZoom(+e.target.value)}
                />
                <button
                  title={t('放大时间线')}
                  onClick={() => setZoom((v) => Math.min(180, v + 15))}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
            <Timeline
              project={project}
              selected={selected}
              time={time}
              zoom={zoom}
              snap={snap}
              select={setSelected}
              seek={seek}
              commit={commit}
              setLive={(next) => {
                projectRef.current = next;
                setProject(next);
              }}
              record={record}
              addAsset={addAssetToTrack}
              addTrack={() => toolButtons[6].action()}
              onClipContextMenu={(event, id) => openContextMenu(event, { kind: 'clip', id })}
              onTrackContextMenu={(event, id, atTime) =>
                openContextMenu(event, { kind: 'track', id, atTime })
              }
              onTimelineContextMenu={(event, atTime) =>
                openContextMenu(event, { kind: 'timeline', atTime })
              }
            />
          </section>
          <footer className="statusbar">
            <span>
              <span className="status-dot" />
              {window.freecut ? t('桌面版') : t('浏览器预览')}{' '}
              <span className="muted">{appVersion}</span>
            </span>
            <span>
              {clip ? t('已选择 {v0}', { v0: clip.name }) : t('双击素材添加到时间线')}
              <span className="status-shortcuts">
                {t('右键查看更多 · Space 播放 · Ctrl+B 分割')}
              </span>
            </span>
            <button onClick={() => setHelpOpen(true)}>
              <Keyboard size={12} />
              {t('快捷键')}
            </button>
          </footer>
        </>
      )}
      <input
        hidden
        ref={fileInput}
        type="file"
        multiple
        accept="video/*,audio/*,image/png,image/jpeg,image/webp"
        onChange={(e) => void browserImport(e.target.files)}
      />
      <input
        hidden
        ref={projectInput}
        type="file"
        accept=".freecut,.json"
        onChange={async (e) => {
          try {
            const file = e.target.files?.[0];
            if (file)
              await loadDesktopProject(async () => validateProject(JSON.parse(await file.text())));
          } catch (err) {
            notify((err as Error).message);
          }
          e.target.value = '';
        }}
      />
      <input
        hidden
        ref={srtInput}
        type="file"
        accept=".srt"
        onChange={async (e) => {
          const session = projectSession.current;
          try {
            const file = e.target.files?.[0];
            if (file) {
              const items = parseSrt(await file.text());
              if (session !== projectSession.current) {
                notify(t('已切换项目，字幕未加入当前项目。'));
                return;
              }
              if (!items.length) throw new Error(t('没有读取到有效字幕，请检查 SRT 格式。'));
              addSubtitles(items);
            }
          } catch (err) {
            notify((err as Error).message);
          }
          e.target.value = '';
        }}
      />
      {toast && (
        <div role="status" className="toast">
          <Check size={16} />
          {toast}
          <button title={t('关闭提示')} onClick={() => setToast('')}>
            <X size={13} />
          </button>
        </div>
      )}
      {aiOpen && (
        <AIPanel
          initialTab={aiTab}
          extraVoicePanel={<ChatTTSPanel onAddAsset={addAIAudio} />}
          project={project}
          selectedClip={clip}
          playhead={time}
          onAddAsset={addAIAudio}
          onAddSubtitles={addSubtitles}
          onClose={() => setAIOpen(false)}
        />
      )}
      {exportOpen && (
        <div className="modal-backdrop">
          <div
            className="dialog export-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
          >
            <div className="dialog-heading">
              <h2 id="export-title">{t('导出你的作品')}</h2>
              <button
                className="icon-button"
                title={t('关闭')}
                disabled={busy}
                onClick={() => setExportOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <p className="dialog-subtitle">{t('本地渲染，保留关键帧、特效和声音。无水印。')}</p>
            {!window.freecut ? (
              <div className="notice">
                <Monitor size={22} />
                <p>
                  {t(
                    '视频导出需要打开 FreeCut 桌面版。浏览器用于界面预览与编辑，桌面版内置 FFmpeg 导出引擎。',
                  )}
                </p>
              </div>
            ) : (
              <>
                <div className="export-summary">
                  <Film size={30} />
                  <span>
                    <strong>{project.name}</strong>
                    <small>
                      {t('{seconds}秒 · {count}个片段', {
                        seconds: duration.toFixed(1),
                        count: project.clips.length,
                      })}
                    </small>
                  </span>
                </div>
                <label className="inline-field">
                  {t('分辨率')}
                  <select
                    disabled={busy}
                    value={exportSize}
                    onChange={(e) => setExportSize(e.target.value)}
                  >
                    <option value="720">720p</option>
                    <option value="1080">1080p</option>
                    <option value="2160">4K / 2160p</option>
                  </select>
                </label>
                <label className="inline-field">
                  {t('帧率')}
                  <select
                    disabled={busy}
                    value={exportFps}
                    onChange={(e) => setExportFps(+e.target.value)}
                  >
                    {[24, 25, 30, 50, 60].map((f) => (
                      <option key={f} value={f}>
                        {f} fps
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inline-field">
                  {t('编码质量')}
                  <select
                    disabled={busy}
                    value={quality}
                    onChange={(e) => setQuality(e.target.value as 'high')}
                  >
                    <option value="high">{t('高质量 · 较大文件')}</option>
                    <option value="medium">{t('标准 · 较小文件')}</option>
                  </select>
                </label>
                <label className="inline-field">
                  {t('格式')}
                  <span>MP4 · H.264 + AAC</span>
                </label>
                {(busy || progress > 0) && (
                  <div className="export-progress">
                    <div>
                      <span>{exportPhase}</span>
                      <b>{Math.round(progress)}%</b>
                    </div>
                    <progress value={progress} max={100} />
                  </div>
                )}
                {exportPath ? (
                  <div className="export-success">
                    <Check size={20} />
                    <span>{t('视频已保存')}</span>
                    <button onClick={() => void window.freecut?.showItem(exportPath)}>
                      {t('打开所在文件夹')}
                    </button>
                  </div>
                ) : (
                  <div className="dialog-actions">
                    {busy ? (
                      <button
                        onClick={() => {
                          cancelled.current = true;
                          if (job.current) void window.freecut?.cancelExport(job.current);
                        }}
                      >
                        {t('取消导出')}
                      </button>
                    ) : (
                      <button className="primary" onClick={() => void doExport()}>
                        <Download size={16} />
                        {t('选择保存位置并导出')}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {onboarding && !home && (
        <div className="modal-backdrop onboarding-backdrop">
          <div
            className="dialog onboarding"
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboard-title"
          >
            <div className="onboard-visual">
              {tourStep === 0 ? (
                <>
                  <span className="onboard-screen">
                    <Monitor size={58} />
                    <b>{t('专业布局')}</b>
                  </span>
                  <ArrowRight size={25} />
                  <span className="onboard-phone">
                    <Smartphone size={52} />
                    <b>{t('手机风格')}</b>
                  </span>
                </>
              ) : tourStep === 1 ? (
                <div className="switch-demo">
                  <Monitor size={25} />
                  <span>{t('左上角，一键切换')}</span>
                  <Smartphone size={25} />
                </div>
              ) : (
                <div className="onboard-workflow">
                  <FolderOpen size={34} />
                  <ArrowRight size={19} />
                  <BrandIcon size={60} />
                  <ArrowRight size={19} />
                  <Download size={34} />
                </div>
              )}
            </div>
            <h2 id="onboard-title">
              {
                [t('欢迎来到水管剪辑'), t('熟悉的布局，由你来选'), t('准备好，开始第一剪')][
                  tourStep
                ]
              }
            </h2>
            <p>
              {
                [
                  t('从素材到成片，离线创作、自由表达。这里有两种工作台，功能都在。'),
                  t(
                    '左上角的电脑 / 手机图标可随时切换布局。手机风格拥有底部工具栏，同时保留多轨、关键帧、调色等专业能力。',
                  ),
                  t(
                    '导入素材，拖到时间线，在普通模式点击「记录当前画面」即可添加关键帧。顶部可切换专业模式。自动字幕和语音朗读可按需下载模型。',
                  ),
                ][tourStep]
              }
            </p>
            <div className="onboard-dots">
              {[0, 1, 2].map((i) => (
                <span key={i} className={i === tourStep ? 'active' : ''} />
              ))}
            </div>
            <div className="dialog-actions">
              <button
                onClick={() => {
                  localStorage.setItem('freecut-onboarded', '1');
                  setOnboarding(false);
                }}
              >
                {t('跳过引导')}
              </button>
              {tourStep === 1 && (
                <button onClick={switchLayout}>
                  {mobile ? t('切回专业布局') : t('试试手机风格')}
                </button>
              )}
              <button
                className="primary"
                onClick={() => {
                  if (tourStep < 2) setTourStep(tourStep + 1);
                  else {
                    localStorage.setItem('freecut-onboarded', '1');
                    setOnboarding(false);
                    notify(t('左上角可随时切换专业布局 / 手机风格。'));
                  }
                }}
              >
                {tourStep === 2 ? t('开始创作') : t('下一步')}
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
      {helpOpen && (
        <div className="modal-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-label={t('使用帮助')}>
            <div className="dialog-heading">
              <h2>{t('上手水管剪辑')}</h2>
              <button className="icon-button" title={t('关闭')} onClick={() => setHelpOpen(false)}>
                <X size={19} />
              </button>
            </div>
            <p>{t('左上角的布局图标可在专业布局与手机风格之间切换，工程和功能保持一致。')}</p>
            <div className="shortcut-list">
              {[
                [t('播放 / 暂停'), 'Space'],
                [t('分割选中片段'), 'Ctrl / ⌘ + B'],
                [t('复制 / 剪切 / 粘贴片段'), 'Ctrl / ⌘ + C / X / V'],
                [t('复制到片段后'), 'Ctrl / ⌘ + D'],
                [t('打开右键菜单'), 'Shift + F10'],
                [t('保存工程'), 'Ctrl / ⌘ + S'],
                [t('打开工程'), 'Ctrl / ⌘ + O'],
                [t('撤销 / 重做'), 'Ctrl / ⌘ + Z / Shift + Z'],
                [t('前进 / 后退一帧'), '← / →'],
                [t('关键帧面板'), 'K'],
                [t('删除片段'), 'Delete'],
              ].map(([name, key]) => (
                <div key={name}>
                  <span>{name}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
            <div className="dialog-actions">
              <button
                onClick={() => {
                  setHelpOpen(false);
                  navigate(() => {
                    replaceProject(demoProject(), false);
                    setTime(2);
                  });
                }}
              >
                {t('打开示例工程')}
              </button>
              <button
                className="primary"
                onClick={() => {
                  setHelpOpen(false);
                  setTourStep(0);
                  setOnboarding(true);
                }}
              >
                {t('重新查看引导')}
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingNavigation && (
        <div className="modal-backdrop">
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('保存未完成的修改')}
          >
            <h2>{t('要保存当前项目吗？')}</h2>
            <p>
              「{project.name}
              {t('」还有未保存的修改。保存后再继续，可以下次接着编辑。')}
            </p>
            <div className="dialog-actions">
              <button disabled={navigationBusy} onClick={() => setPendingNavigation(undefined)}>
                {t('取消')}
              </button>
              <button disabled={navigationBusy} onClick={() => void finishNavigation(false)}>
                {t('不保存并继续')}
              </button>
              <button
                disabled={navigationBusy}
                className="primary"
                onClick={() => void finishNavigation(true)}
              >
                {navigationBusy ? t('正在保存…') : t('保存并继续')}
              </button>
            </div>
          </div>
        </div>
      )}
      {closing && (
        <div className="modal-backdrop close-backdrop" role="status">
          <div className="dialog">
            <Loader2 size={22} />
            <p>{t('正在处理退出，请在系统对话框中选择是否保存。')}</p>
          </div>
        </div>
      )}
      {fileBusy && (
        <div className="modal-backdrop close-backdrop" role="status">
          <div className="dialog">
            <Loader2 size={22} />
            <p>{t('正在处理工程文件…')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
