import { useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  LockKeyhole,
  UnlockKeyhole,
  Volume2,
  VolumeX,
  Plus,
  Film,
  Music2,
  Type,
  Diamond,
} from 'lucide-react';
import type { Project, Clip, Track } from '../types';
import { durationOf, trimClip } from '../core/project';
import {
  editableSelection,
  moveSelection,
  rectanglesIntersect,
  toggleSelection,
  type SelectionRectangle,
} from '../core/timeline-selection';
import { ClipMediaStrip } from './ClipMediaStrip';
import './timeline-interaction.css';
interface Props {
  /** Workbench interactions inspired by Concat timeline/tray.slint; project model stays FreeCut v1. */
  fitRequest?: number;
  onZoomChange?: (zoom: number) => void;
  tool?: 'select' | 'razor';
  onRazor?: (id: string, time: number) => void;
  project: Project;
  selected?: string;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[], primary?: string) => void;
  time: number;
  zoom: number;
  snap: boolean;
  select: (id?: string) => void;
  seek: (time: number) => void;
  commit: (f: (p: Project) => Project) => void;
  setLive: (p: Project) => void;
  record: (p: Project) => void;
  onGestureChange?: (active: boolean) => void;
  addAsset: (id: string, trackId: string, start: number) => void;
  addTrack: () => void;
  onClipContextMenu: (event: React.MouseEvent, clipId: string) => void;
  onTrackContextMenu: (event: React.MouseEvent, trackId: string, atTime?: number) => void;
  onTimelineContextMenu: (event: React.MouseEvent, atTime: number) => void;
}
export function timecode(time: number, fps = 30) {
  const t = Math.max(0, time);
  // Avoid 35/30 being displayed as frame 04 after binary floating-point
  // subtraction. Integer-rate timelines use the same frame index as stepping.
  const frame = Math.floor(t * fps + 1e-7);
  const seconds = Number.isInteger(fps) ? Math.floor(frame / fps) : Math.floor(t);
  const within = Number.isInteger(fps) ? frame % fps : Math.floor((t % 1) * fps + 1e-7);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}:${String(within).padStart(2, '0')}`;
}
export default function Timeline({
  fitRequest = 0,
  onZoomChange,
  tool = 'select',
  onRazor,
  project,
  selected,
  selectedIds,
  onSelectionChange,
  time,
  zoom,
  snap,
  select,
  seek,
  commit,
  setLive,
  record,
  onGestureChange,
  addAsset,
  addTrack,
  onClipContextMenu,
  onTrackContextMenu,
  onTimelineContextMenu,
}: Props) {
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement>(null),
    headerScroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<SelectionRectangle>();
  const [invalidDrop, setInvalidDrop] = useState(false);
  const suppressClick = useRef(false);
  const selection = selectedIds ?? (selected ? [selected] : []);
  const selectedSet = new Set(selection);
  const updateSelection = (ids: string[], primary = ids.at(-1)) => {
    if (onSelectionChange) onSelectionChange(ids, primary);
    else select(primary);
  };
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  const gestureChange = useRef(onGestureChange);
  gestureChange.current = onGestureChange;
  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(() => {
    if (!fitRequest || !scroller.current || !onZoomChange) return;
    const duration = durationOf(project);
    const available = Math.max(100, scroller.current.clientWidth - 30);
    onZoomChange(
      Math.max(
        0.02,
        Math.min(260, available / Math.max(2, duration + Math.min(2, duration * 0.04))),
      ),
    );
    scroller.current.scrollLeft = 0;
  }, [fitRequest]);
  const layouts = new Map(
    project.tracks.map((track) => {
      const ends: number[] = [],
        lanes = new Map<string, number>();
      for (const c of project.clips
        .filter((c) => c.trackId === track.id)
        .sort((a, b) => a.start - b.start)) {
        let lane = ends.findIndex((end) => end <= c.start + 0.0001);
        if (lane < 0) lane = ends.length;
        ends[lane] = c.start + c.duration;
        lanes.set(c.id, lane);
      }
      return [track.id, { lanes, height: Math.max(63, ends.length * 56 + 7) }];
    }),
  );
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const total = Math.max(30, durationOf(project) + 8);
  const width = total * zoom;
  const step =
    [1 / project.fps, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].find(
      (value) => value * zoom >= 68,
    ) ?? 3600;
  const contextTime = (event: React.MouseEvent) =>
    Math.max(
      0,
      Math.round(
        ((event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom) * project.fps,
      ) / project.fps,
    );
  const keyboardContextMenu = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: Math.max(
          0,
          Math.min(window.innerWidth - 1, rect.left + Math.min(24, rect.width / 2)),
        ),
        clientY: Math.max(
          0,
          Math.min(window.innerHeight - 1, rect.top + Math.min(24, rect.height / 2)),
        ),
      }),
    );
  };
  function startDrag(e: React.PointerEvent, clip: Clip, mode: 'move' | 'left' | 'right') {
    if (e.button === 0) suppressClick.current = false;
    if (e.button !== 0 || tool === 'razor' || dragCleanup.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (mode === 'move' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      updateSelection(toggleSelection(selection, clip.id));
      suppressClick.current = true;
      return;
    }
    const ids = mode === 'move' && selectedSet.has(clip.id) ? selection : [clip.id];
    updateSelection(ids, clip.id);
    if (project.tracks.find((track) => track.id === clip.trackId)?.locked) {
      suppressClick.current = true;
      return;
    }
    // Capture on the stable timeline parent: crossing tracks re-parents the clip DOM node.
    const target = inner.current;
    if (!target) return;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    const origin = { x: e.clientX, y: e.clientY },
      snapshot = project;
    const moving = editableSelection(snapshot, ids);
    const movingIds = new Set(moving.map((item) => item.id));
    const snapPoints = snap
      ? [
          0,
          time,
          ...snapshot.clips
            .filter((item) => !movingIds.has(item.id))
            .flatMap((item) => [item.start, item.start + item.duration]),
        ].sort((a, b) => a - b)
      : [];
    const sourceTrack = snapshot.tracks.findIndex((track) => track.id === clip.trackId);
    const lanes = [...target.querySelectorAll<HTMLElement>('.track-lane')].map((lane) => ({
      id: lane.dataset.trackId,
      rect: lane.getBoundingClientRect(),
    }));
    let next = snapshot;
    let moved = false;
    let ended = false;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== e.pointerId) return;
      const delta = (event.clientX - origin.x) / zoom;
      if (!moved && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 3) return;
      moved = true;
      suppressClick.current = true;
      if (mode === 'move') {
        let shift = delta;
        if (snap) {
          let distance = 8 / zoom;
          for (const member of moving) {
            for (const edge of [member.start, member.start + member.duration]) {
              // Search neighboring targets only; large selections must not scan every pair.
              let low = 0,
                high = snapPoints.length;
              while (low < high) {
                const middle = (low + high) >>> 1;
                if (snapPoints[middle] < edge + delta) low = middle + 1;
                else high = middle;
              }
              for (const point of snapPoints.slice(Math.max(0, low - 1), low + 1)) {
                const correction = point - (edge + delta);
                if (Math.abs(correction) < distance) {
                  shift = delta + correction;
                  distance = Math.abs(correction);
                }
              }
            }
          }
        }
        const hit = lanes.find(
          (lane) => event.clientY >= lane.rect.top && event.clientY < lane.rect.bottom,
        );
        const destination = hit
          ? snapshot.tracks.findIndex((track) => track.id === hit.id)
          : sourceTrack;
        const offset = destination - sourceTrack;
        const edited = moveSelection(snapshot, ids, shift, offset);
        // An invalid vertical target cancels the preview; the entire group stays together.
        setInvalidDrop(offset !== 0 && edited === snapshot);
        next = edited;
      } else {
        const asset = project.assets.find((a) => a.id === clip.assetId);
        const extend =
          asset && asset.kind !== 'image'
            ? Math.max(0, (asset.duration - clip.inPoint) / clip.speed - clip.duration)
            : 3600;
        const d =
          mode === 'left'
            ? Math.min(
                clip.duration - 1 / project.fps,
                Math.max(-clip.inPoint / clip.speed, -clip.start, delta),
              )
            : Math.min(clip.duration - 1 / project.fps, Math.max(-extend, -delta));
        const edited = trimClip(clip, mode === 'left' ? d : 0, mode === 'right' ? d : 0);
        next =
          Math.abs(d) < 1e-8
            ? snapshot
            : { ...snapshot, clips: snapshot.clips.map((c) => (c.id === clip.id ? edited : c)) };
      }
      setLive(next);
    };
    const finish = (outcome: 'commit' | 'cancel' | 'unmount') => {
      if (ended) return;
      ended = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape, true);
      target.removeEventListener('lostpointercapture', cancel);
      dragCleanup.current = undefined;
      try {
        // Record before unlocking remote synchronization. An unmount may belong to
        // a new project, so never push the old project's snapshot into its history.
        if (outcome === 'commit' && next !== snapshot) record(snapshot);
        if (outcome === 'cancel' && next !== snapshot) setLive(snapshot);
        if (outcome === 'commit' && !moved) updateSelection([clip.id], clip.id);
      } finally {
        if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
        if (outcome !== 'unmount') setInvalidDrop(false);
        gestureChange.current?.(false);
      }
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId === e.pointerId) finish('commit');
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === e.pointerId) finish('cancel');
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick.current = true;
      finish('cancel');
    };
    dragCleanup.current = () => finish('unmount');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape, true);
    target.addEventListener('lostpointercapture', cancel);
    gestureChange.current?.(true);
  }

  function startMarquee(e: React.PointerEvent) {
    if (e.button !== 0 || dragCleanup.current || tool !== 'select' || !inner.current) return;
    if ((e.target as HTMLElement).closest('.timeline-clip')) return;
    e.preventDefault();
    suppressClick.current = false;
    const target = inner.current;
    const rect = target.getBoundingClientRect();
    const origin = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const initial = selection;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const bounds = [...target.querySelectorAll<HTMLElement>('.timeline-clip')].map((element) => {
      const box = element.getBoundingClientRect();
      return {
        id: element.dataset.clipId!,
        left: box.left - rect.left,
        right: box.right - rect.left,
        top: box.top - rect.top,
        bottom: box.bottom - rect.top,
      };
    });
    let moved = false;
    let ended = false;
    target.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) => {
      if (event.pointerId !== e.pointerId) return;
      const liveRect = target.getBoundingClientRect();
      const current = { x: event.clientX - liveRect.left, y: event.clientY - liveRect.top };
      if (!moved && Math.hypot(current.x - origin.x, current.y - origin.y) < 4) return;
      moved = true;
      suppressClick.current = true;
      const area = {
        left: Math.min(origin.x, current.x),
        right: Math.max(origin.x, current.x),
        top: Math.min(origin.y, current.y),
        bottom: Math.max(origin.y, current.y),
      };
      setMarquee(area);
      const hits = bounds.filter((box) => rectanglesIntersect(area, box)).map((box) => box.id);
      const ids = additive ? [...new Set([...initial, ...hits])] : hits;
      updateSelection(ids);
    };
    const finish = (outcome: 'commit' | 'cancel' | 'unmount') => {
      if (ended) return;
      ended = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape, true);
      target.removeEventListener('lostpointercapture', cancel);
      dragCleanup.current = undefined;
      if (outcome !== 'unmount') {
        setMarquee(undefined);
        if (outcome === 'cancel') updateSelection(initial, selected);
        else if (!moved) {
          if (!additive) updateSelection([]);
          seek(Math.max(0, Math.round((origin.x / zoom) * project.fps) / project.fps));
        }
      }
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId === e.pointerId) finish('commit');
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === e.pointerId) finish('cancel');
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish('cancel');
    };
    dragCleanup.current = () => finish('unmount');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape, true);
    target.addEventListener('lostpointercapture', cancel);
  }
  const changeTrack = (id: string, values: Partial<Track>) =>
    commit((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...values } : t)) }));
  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const element = e.currentTarget as HTMLElement;
    const rect = element.getBoundingClientRect();
    seek(Math.max(0, (e.clientX - rect.left) / zoom));
    element.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) =>
      seek(Math.max(0, Math.min(total, (event.clientX - rect.left) / zoom)));
    const end = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
  };
  return (
    <div
      className={`timeline-content ${tool === 'razor' ? 'razor-mode' : ''} ${invalidDrop ? 'invalid-drop' : ''}`}
    >
      <div className="track-headers" ref={headerScroller}>
        <div className="track-header-top">
          <span>{t('轨道')}</span>
          <button className="icon-button" title={t('添加叠加轨道')} onClick={addTrack}>
            <Plus size={14} />
          </button>
        </div>
        {project.tracks.map((track) => (
          <div
            key={track.id}
            className={`track-header ${track.kind}`}
            data-track-id={track.id}
            style={{ height: layouts.get(track.id)!.height }}
            role="group"
            tabIndex={0}
            aria-label={t('轨道 {v0}', { v0: track.name })}
            onKeyDown={keyboardContextMenu}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onTrackContextMenu(event, track.id);
            }}
          >
            <div className="track-name">
              {track.kind === 'audio' ? (
                <Music2 size={14} />
              ) : track.kind === 'overlay' ? (
                <Type size={14} />
              ) : (
                <Film size={14} />
              )}
              <span>{track.name}</span>
            </div>
            <div className="track-toggles">
              <button
                className={`icon-button ${track.hidden ? 'toggled' : ''}`}
                title={track.hidden ? t('显示轨道') : t('隐藏轨道')}
                onClick={() => changeTrack(track.id, { hidden: !track.hidden })}
              >
                {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button
                className={`icon-button ${track.muted ? 'toggled' : ''}`}
                title={track.muted ? t('取消静音') : t('轨道静音')}
                onClick={() => changeTrack(track.id, { muted: !track.muted })}
              >
                {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </button>
              <button
                className={`icon-button ${track.locked ? 'toggled' : ''}`}
                title={track.locked ? t('解锁轨道') : t('锁定轨道')}
                onClick={() => changeTrack(track.id, { locked: !track.locked })}
              >
                {track.locked ? <LockKeyhole size={13} /> : <UnlockKeyhole size={13} />}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div
        className="timeline-scroll"
        ref={scroller}
        onScroll={(e) => {
          if (headerScroller.current) headerScroller.current.scrollTop = e.currentTarget.scrollTop;
        }}
      >
        <div className="timeline-inner" ref={inner} style={{ width, minHeight: '100%' }}>
          <div
            className="ruler"
            onPointerDown={scrub}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onTimelineContextMenu(event, contextTime(event));
            }}
          >
            {Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => (
              <span key={i} style={{ left: i * step * zoom }}>
                {timecode(i * step, project.fps)}
              </span>
            ))}
          </div>
          {project.tracks.map((track) => (
            <div
              key={track.id}
              className={`track-lane ${track.hidden ? 'hidden-track' : ''}`}
              data-track-id={track.id}
              style={{ height: layouts.get(track.id)!.height }}
              onPointerDown={startMarquee}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onTrackContextMenu(event, track.id, contextTime(event));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (track.locked) return;
                const id = e.dataTransfer.getData('freecut/asset');
                if (id)
                  addAsset(
                    id,
                    track.id,
                    Math.max(0, (e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom),
                  );
              }}
            >
              {project.clips
                .filter((c) => c.trackId === track.id)
                .map((clip) => (
                  <div
                    key={clip.id}
                    className={`timeline-clip ${clip.kind} ${selectedSet.has(clip.id) ? 'selected' : ''} ${selected === clip.id ? 'primary-selection' : ''} ${track.locked ? 'locked-clip' : ''}`}
                    data-clip-id={clip.id}
                    style={{
                      left: clip.start * zoom,
                      width: Math.max(8, clip.duration * zoom),
                      top: 7 + layouts.get(track.id)!.lanes.get(clip.id)! * 56,
                      height: 49,
                    }}
                    title={t('{v0} · {v1} 秒', { v0: clip.name, v1: clip.duration.toFixed(2) })}
                    role="button"
                    tabIndex={0}
                    aria-label={t('片段 {v0}', { v0: clip.name })}
                    aria-pressed={selectedSet.has(clip.id)}
                    onKeyDown={(e) => {
                      keyboardContextMenu(e);
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        updateSelection(
                          e.ctrlKey || e.metaKey || e.shiftKey
                            ? toggleSelection(selection, clip.id)
                            : [clip.id],
                        );
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!selectedSet.has(clip.id)) updateSelection([clip.id], clip.id);
                      onClipContextMenu(event, clip.id);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (suppressClick.current) return;
                      if (tool === 'razor' && onRazor && !track.locked) {
                        const at =
                          clip.start +
                          (e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom;
                        onRazor(clip.id, Math.round(at * project.fps) / project.fps);
                      } else if (e.detail === 0) updateSelection([clip.id], clip.id);
                    }}
                    onPointerDown={(e) => startDrag(e, clip, 'move')}
                  >
                    <ClipMediaStrip
                      clip={clip}
                      asset={clip.assetId ? assets.get(clip.assetId) : undefined}
                      showWaveform
                    />
                    <div
                      className="trim-handle left"
                      title={t('拖动修剪开始')}
                      onPointerDown={(e) => startDrag(e, clip, 'left')}
                    />
                    <div className="clip-label">
                      {clip.kind === 'audio' ? (
                        <Music2 size={12} />
                      ) : clip.kind === 'text' ? (
                        <Type size={12} />
                      ) : (
                        <Film size={12} />
                      )}
                      <span>{clip.name}</span>
                    </div>
                    {clip.kind === 'audio' ? (
                      <div className="audio-stripe">
                        {t('音频 ·')} {clip.speed}×
                      </div>
                    ) : (
                      <div className="clip-detail">
                        {clip.kind === 'text'
                          ? clip.text?.text
                          : clip.kind === 'shape'
                            ? t('纯色色卡')
                            : `${clip.speed}× · ${clip.duration.toFixed(1)}s`}
                      </div>
                    )}
                    {selectedSet.has(clip.id) &&
                      Object.values(clip.keyframes)
                        .flat()
                        .filter((v, i, all) => v && all.findIndex((f) => f?.time === v.time) === i)
                        .map(
                          (k) =>
                            k && (
                              <button
                                key={k.id}
                                className="timeline-key"
                                title={t('跳到关键帧 {v0}秒', { v0: k.time.toFixed(2) })}
                                style={{ left: k.time * zoom }}
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  seek(clip.start + k.time);
                                }}
                              >
                                <Diamond size={9} fill="currentColor" />
                              </button>
                            ),
                        )}
                    <div
                      className="trim-handle right"
                      title={t('拖动修剪结尾')}
                      onPointerDown={(e) => startDrag(e, clip, 'right')}
                    />
                  </div>
                ))}
            </div>
          ))}
          {marquee && (
            <div
              className="timeline-marquee"
              aria-hidden="true"
              style={{
                left: marquee.left,
                top: marquee.top,
                width: marquee.right - marquee.left,
                height: marquee.bottom - marquee.top,
              }}
            />
          )}
          {invalidDrop && (
            <div className="timeline-drop-notice" role="status">
              {t('目标轨道已锁定或不兼容，片段保持原位')}
            </div>
          )}
          <div className="playhead" style={{ left: time * zoom }}>
            <span />
          </div>
          {project.clips.length === 0 && (
            <div className="timeline-hint">
              <Film size={20} />
              <span>{t('将素材拖到轨道，开始你的第一剪')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
