import { useI18n } from '../i18n';
import { useRef } from 'react';
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
interface Props {
  project: Project;
  selected?: string;
  time: number;
  zoom: number;
  snap: boolean;
  select: (id?: string) => void;
  seek: (time: number) => void;
  commit: (f: (p: Project) => Project) => void;
  setLive: (p: Project) => void;
  record: (p: Project) => void;
  addAsset: (id: string, trackId: string, start: number) => void;
  addTrack: () => void;
  onClipContextMenu: (event: React.MouseEvent, clipId: string) => void;
  onTrackContextMenu: (event: React.MouseEvent, trackId: string, atTime?: number) => void;
  onTimelineContextMenu: (event: React.MouseEvent, atTime: number) => void;
}
export function timecode(time: number, fps = 30) {
  const t = Math.max(0, time);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}:${String(Math.floor((t % 1) * fps)).padStart(2, '0')}`;
}
export default function Timeline({
  project,
  selected,
  time,
  zoom,
  snap,
  select,
  seek,
  commit,
  setLive,
  record,
  addAsset,
  addTrack,
  onClipContextMenu,
  onTrackContextMenu,
  onTimelineContextMenu,
}: Props) {
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement>(null),
    headerScroller = useRef<HTMLDivElement>(null);
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
  const total = Math.max(30, durationOf(project) + 8);
  const width = total * zoom;
  const step = zoom < 30 ? 5 : zoom < 80 ? 2 : 1;
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
    if (e.button !== 0 || project.tracks.find((t) => t.id === clip.trackId)?.locked) return;
    e.preventDefault();
    e.stopPropagation();
    select(clip.id);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const origin = e.clientX,
      snapshot = project;
    let next = snapshot;
    let moved = false;
    const move = (event: PointerEvent) => {
      const delta = (event.clientX - origin) / zoom;
      if (Math.abs(delta) < 0.01) return;
      moved = true;
      let edited: Clip;
      if (mode === 'move') {
        let start = Math.max(0, clip.start + delta);
        if (snap) {
          const points = [
            0,
            time,
            ...snapshot.clips
              .filter((c) => c.id !== clip.id)
              .flatMap((c) => [c.start, c.start + c.duration]),
          ];
          for (const point of points) {
            if (Math.abs(start - point) < 8 / zoom) {
              start = point;
              break;
            }
            if (Math.abs(start + clip.duration - point) < 8 / zoom) {
              start = point - clip.duration;
              break;
            }
          }
        }
        edited = { ...clip, start: Math.max(0, Math.round(start * project.fps) / project.fps) };
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
        edited = trimClip(clip, mode === 'left' ? d : 0, mode === 'right' ? d : 0);
      }
      next = { ...snapshot, clips: snapshot.clips.map((c) => (c.id === clip.id ? edited : c)) };
      setLive(next);
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      if (moved) record(snapshot);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
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
    <div className="timeline-content">
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
        <div className="timeline-inner" style={{ width, minHeight: '100%' }}>
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
              onClick={() => select(undefined)}
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
                    className={`timeline-clip ${clip.kind} ${selected === clip.id ? 'selected' : ''}`}
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
                    onKeyDown={(e) => {
                      keyboardContextMenu(e);
                      if (e.key === 'Enter') select(clip.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onClipContextMenu(event, clip.id);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      select(clip.id);
                    }}
                    onPointerDown={(e) => startDrag(e, clip, 'move')}
                  >
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
                    {selected === clip.id &&
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
