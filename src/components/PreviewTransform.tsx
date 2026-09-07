import { useI18n } from '../i18n';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
} from 'react';
import type { Project, Transform } from '../types';
import {
  angleDelta,
  corners,
  getClipGeometry,
  hitTestProject,
  moveTransform,
  pointerAngle,
  pointerToProject,
  rotationValue,
  scaleTransform,
} from '../core/preview-transform';
import type { ClipGeometry, Corner, MeasureText, Point } from '../core/preview-transform';
import './preview-transform.css';

export interface PreviewTransformProps {
  canvas: HTMLCanvasElement | RefObject<HTMLCanvasElement | null> | null;
  project: Project;
  time: number;
  selected?: string;
  disabled?: boolean;
  onSelect: (id: string | undefined) => void;
  /** Called once, after a two-CSS-pixel drag threshold. Return false to reject editing. */
  onStart: (id: string) => void | boolean;
  onChange: (id: string, values: Partial<Transform>) => void;
  onEnd: (cancelled: boolean) => void;
  onContextMenu: (event: ReactMouseEvent, clipId?: string) => void;
}
type Box = { element: HTMLCanvasElement; left: number; top: number; width: number; height: number };
type Gesture = {
  id: string;
  pointerId: number;
  mode: 'move' | 'rotate' | Corner;
  geometry: ClipGeometry;
  start: Point;
  clientStart: Point;
  rect: DOMRect;
  canvas: HTMLCanvasElement;
  projectId: string;
  time: number;
  started: boolean;
  lastAngle: number;
  rotationDelta: number;
};
const handleLabels: Record<Corner, string> = {
  nw: '缩放左上角',
  ne: '缩放右上角',
  se: '缩放右下角',
  sw: '缩放左下角',
};
const point = (event: { clientX: number; clientY: number }): Point => ({
  x: event.clientX,
  y: event.clientY,
});

export default function PreviewTransform(props: PreviewTransformProps) {
  const { t } = useI18n();
  const { canvas, project, time, selected, disabled = false } = props;
  const callbacks = useRef(props);
  callbacks.current = props;
  const overlay = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const keyboardMenu = useRef<{ clipId?: string } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const context = useMemo(() => document.createElement('canvas').getContext('2d'), []);
  const measureText = useCallback<MeasureText>(
    (line, style) => {
      if (!context) return { width: [...line].length * style.fontSize * 0.6 };
      context.font = `${style.bold ? '700' : '400'} ${style.fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      context.textAlign = style.align;
      context.textBaseline = 'middle';
      return context.measureText(line);
    },
    [context],
  );
  const measureBox = useCallback(() => {
    const element = canvas && 'current' in canvas ? canvas.current : canvas;
    const parent = element?.parentElement;
    if (!element || !parent || !element.isConnected) {
      setBox((previous) => (previous === null ? previous : null));
      return;
    }
    const rect = element.getBoundingClientRect(),
      parentRect = parent.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      setBox((previous) => (previous === null ? previous : null));
      return;
    }
    const next = {
      element,
      left: rect.left - parentRect.left - parent.clientLeft + parent.scrollLeft,
      top: rect.top - parentRect.top - parent.clientTop + parent.scrollTop,
      width: rect.width,
      height: rect.height,
    };
    setBox((previous) =>
      previous &&
      Object.keys(next).every((key) => previous[key as keyof Box] === next[key as keyof Box])
        ? previous
        : next,
    );
  }, [canvas]);
  // Refs are attached before layout effects, including the first editor mount.
  useLayoutEffect(() => {
    measureBox();
  });
  useLayoutEffect(() => {
    const element = box?.element;
    if (!element) return;
    const observer = new ResizeObserver(measureBox);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener('resize', measureBox);
    window.addEventListener('scroll', measureBox, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measureBox);
      window.removeEventListener('scroll', measureBox, true);
    };
  }, [box?.element, measureBox]);
  const finish = useCallback((cancelled: boolean) => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    setDragging(false);
    const target = overlay.current;
    if (target?.hasPointerCapture(current.pointerId))
      target.releasePointerCapture(current.pointerId);
    if (current.started) callbacks.current.onEnd(cancelled);
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !gesture.current) return;
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    };
    window.addEventListener('keydown', keydown, true);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      finish(true);
    };
  }, [finish]);
  useLayoutEffect(() => {
    const current = gesture.current;
    if (!current) return;
    const clip = project.clips.find((item) => item.id === current.id);
    if (
      disabled ||
      current.projectId !== project.id ||
      current.id !== selected ||
      Math.abs(current.time - time) > 1e-8 ||
      !clip ||
      !getClipGeometry(project, clip, time, measureText) ||
      !current.canvas.isConnected ||
      (box &&
        (box.element !== current.canvas ||
          Math.abs(box.width - current.rect.width) > 0.1 ||
          Math.abs(box.height - current.rect.height) > 0.1))
    )
      finish(true);
  }, [disabled, project, time, selected, box, measureText, finish]);
  const selectedGeometry = useMemo(() => {
    const clip = project.clips.find((item) => item.id === selected);
    return clip ? getClipGeometry(project, clip, time, measureText) : null;
  }, [project, time, selected, measureText]);
  // Context menus can inspect locked objects; editing still uses the original
  // project and getClipGeometry's existing lock guard.
  const contextProject = useMemo(
    () => ({
      ...project,
      tracks: project.tracks.map((track) => (track.locked ? { ...track, locked: false } : track)),
    }),
    [project],
  );
  function openContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || !box) return;
    if (gesture.current) finish(true);
    const keyboard = keyboardMenu.current;
    const geometry = keyboard
      ? null
      : hitTestProject(
          contextProject,
          time,
          pointerToProject(point(event), box.element.getBoundingClientRect(), project),
          measureText,
        );
    callbacks.current.onContextMenu(event, keyboard ? keyboard.clipId : geometry?.clip.id);
  }
  function openKeyboardMenu(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    if (disabled || !box) return;
    event.preventDefault();
    event.stopPropagation();
    const clip = project.clips.find((item) => item.id === selected);
    const geometry = clip ? getClipGeometry(contextProject, clip, time, measureText) : null;
    const rect = box.element.getBoundingClientRect();
    const position = geometry?.origin ?? { x: project.width / 2, y: project.height / 2 };
    keyboardMenu.current = { clipId: selected };
    try {
      event.currentTarget.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: Math.max(
            0,
            Math.min(window.innerWidth - 1, rect.left + (position.x * rect.width) / project.width),
          ),
          clientY: Math.max(
            0,
            Math.min(
              window.innerHeight - 1,
              rect.top + (position.y * rect.height) / project.height,
            ),
          ),
        }),
      );
    } finally {
      keyboardMenu.current = null;
    }
  }
  function begin(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || !box || event.button !== 0 || gesture.current) return;
    const rect = box.element.getBoundingClientRect();
    const start = pointerToProject(point(event), rect, project);
    const handle = (event.target as Element).closest<HTMLElement>('[data-transform-handle]')
      ?.dataset.transformHandle as Gesture['mode'] | undefined;
    const geometry = handle ? selectedGeometry : hitTestProject(project, time, start, measureText);
    event.preventDefault();
    event.stopPropagation();
    if (!geometry) {
      callbacks.current.onSelect(undefined);
      return;
    }
    callbacks.current.onSelect(geometry.clip.id);
    gesture.current = {
      id: geometry.clip.id,
      pointerId: event.pointerId,
      mode: handle ?? 'move',
      geometry,
      start,
      clientStart: point(event),
      rect,
      canvas: box.element,
      projectId: project.id,
      time,
      started: false,
      lastAngle: pointerAngle(geometry.origin, start),
      rotationDelta: 0,
    };
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function update(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current) {
      if (box && !disabled)
        setHovering(
          Boolean(
            hitTestProject(
              project,
              time,
              pointerToProject(point(event), box.element.getBoundingClientRect(), project),
              measureText,
            ),
          ),
        );
      return;
    }
    if (event.pointerId !== current.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (!current.started) {
      if (
        Math.hypot(event.clientX - current.clientStart.x, event.clientY - current.clientStart.y) < 2
      )
        return;
      if (callbacks.current.onStart(current.id) === false) {
        finish(true);
        return;
      }
      current.started = true;
      setDragging(true);
    }
    const pointer = pointerToProject(point(event), current.rect, project);
    let values: Partial<Transform>;
    if (current.mode === 'move') values = moveTransform(current.geometry, current.start, pointer);
    else if (current.mode === 'rotate') {
      const angle = pointerAngle(current.geometry.origin, pointer);
      current.rotationDelta += angleDelta(current.lastAngle, angle);
      current.lastAngle = angle;
      values = {
        rotation: rotationValue(
          current.geometry.transform.rotation + current.rotationDelta,
          event.shiftKey,
        ),
      };
    } else values = scaleTransform(current.geometry, current.mode, current.start, pointer);
    callbacks.current.onChange(current.id, values);
  }
  if (!box || disabled || project.clips.length === 0) return null;
  const toCss = (p: Point) => ({
    x: (p.x * box.width) / project.width,
    y: (p.y * box.height) / project.height,
  });
  const outline = selectedGeometry?.corners.map(toCss);
  let rotationHandle: Point | undefined, rotationEdge: Point | undefined;
  if (outline) {
    rotationEdge = { x: (outline[0].x + outline[1].x) / 2, y: (outline[0].y + outline[1].y) / 2 };
    const center = { x: (outline[0].x + outline[2].x) / 2, y: (outline[0].y + outline[2].y) / 2 };
    const dx = rotationEdge.x - center.x,
      dy = rotationEdge.y - center.y,
      length = Math.hypot(dx, dy) || 1;
    rotationHandle = {
      x: rotationEdge.x + (dx / length) * 30,
      y: rotationEdge.y + (dy / length) * 30,
    };
    const parent = box.element.parentElement;
    if (parent) {
      rotationHandle.x = Math.max(
        12 - box.left,
        Math.min(parent.clientWidth - 12 - box.left, rotationHandle.x),
      );
      rotationHandle.y = Math.max(
        12 - box.top,
        Math.min(parent.clientHeight - 12 - box.top, rotationHandle.y),
      );
    }
  }
  return (
    <div
      ref={overlay}
      className={`preview-transform-overlay ${dragging ? 'is-dragging' : hovering ? 'is-hovering' : ''}`}
      data-testid="preview-transform-overlay"
      aria-label={t('画面变换工具')}
      role="group"
      tabIndex={0}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={begin}
      onContextMenu={openContextMenu}
      onKeyDown={openKeyboardMenu}
      onPointerMove={update}
      onPointerUp={(event) => {
        if (gesture.current?.pointerId === event.pointerId) {
          update(event);
          finish(false);
        }
      }}
      onPointerCancel={(event) => {
        if (gesture.current?.pointerId === event.pointerId) finish(true);
      }}
      onLostPointerCapture={(event) => {
        if (gesture.current?.pointerId === event.pointerId) finish(true);
      }}
      onPointerLeave={() => {
        if (!gesture.current) setHovering(false);
      }}
    >
      {outline && selectedGeometry && (
        <>
          <svg
            className="preview-transform-lines"
            width={box.width}
            height={box.height}
            aria-hidden="true"
          >
            <polygon
              data-testid="preview-selection-box"
              data-clip-id={selectedGeometry.clip.id}
              points={outline.map((p) => `${p.x},${p.y}`).join(' ')}
            />
            {rotationHandle && rotationEdge && (
              <line
                x1={rotationEdge.x}
                y1={rotationEdge.y}
                x2={rotationHandle.x}
                y2={rotationHandle.y}
              />
            )}
          </svg>
          {corners.map((corner, index) => (
            <button
              key={corner}
              type="button"
              className={`preview-transform-handle scale-${corner}`}
              aria-label={t(handleLabels[corner])}
              title={t(handleLabels[corner])}
              data-testid={`preview-scale-${corner}`}
              data-transform-handle={corner}
              style={{ left: outline[index].x, top: outline[index].y }}
            />
          ))}
          {rotationHandle && (
            <button
              type="button"
              className="preview-transform-handle preview-transform-rotate"
              aria-label={t('旋转选中对象')}
              title={t('旋转选中对象 · Shift 吸附 15°')}
              data-testid="preview-rotate"
              data-transform-handle="rotate"
              style={{ left: rotationHandle.x, top: rotationHandle.y }}
            >
              <span aria-hidden="true">↻</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
