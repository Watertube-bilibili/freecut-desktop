// Functional reference: Concat e5c8662daf6d721de2fd6c4e78cb671cd6d98393,
// src/crates/concat/ui/workspace/{workspace,splitter}.slint.
// Independent React implementation; no upstream UI assets or source are copied.
import { useEffect, useRef, useState } from 'react';
import './workbench-resize.css';

interface Props {
  orientation: 'vertical' | 'horizontal';
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset?: () => void;
  reversed?: boolean;
  className?: string;
}
export default function WorkbenchResizeHandle(props: Props) {
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);
  const clamp = (value: number) => Math.round(Math.max(props.min, Math.min(props.max, value)));
  return (
    <div
      className={`workbench-resize-handle ${props.orientation} ${props.className || ''}`}
      role="separator"
      aria-label={props.label}
      aria-orientation={props.orientation}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={clamp(props.value)}
      tabIndex={0}
      onDoubleClick={props.onReset}
      onKeyDown={(event) => {
        const keys =
          props.orientation === 'vertical' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          props.onChange(event.key === 'Home' ? props.min : props.max);
        } else if (keys.includes(event.key)) {
          event.preventDefault();
          props.onChange(
            clamp(
              props.value +
                (event.shiftKey ? 25 : 10) *
                  (event.key === keys[0] ? -1 : 1) *
                  (props.reversed ? -1 : 1),
            ),
          );
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const element = event.currentTarget,
          pointerId = event.pointerId;
        cleanup.current?.();
        element.setPointerCapture(pointerId);
        const origin = props.orientation === 'vertical' ? event.clientX : event.clientY;
        const cursor = document.body.style.cursor;
        const selection = document.body.style.userSelect;
        document.body.style.cursor = props.orientation === 'vertical' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
        const move = (next: PointerEvent) => {
          const delta = (props.orientation === 'vertical' ? next.clientX : next.clientY) - origin;
          props.onChange(clamp(props.value + delta * (props.reversed ? -1 : 1)));
        };
        const finish = () => {
          element.removeEventListener('pointermove', move);
          element.removeEventListener('pointerup', finish);
          element.removeEventListener('pointercancel', finish);
          element.removeEventListener('lostpointercapture', finish);
          cleanup.current = undefined;
          if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
          document.body.style.cursor = cursor;
          document.body.style.userSelect = selection;
        };
        cleanup.current = finish;
        element.addEventListener('pointermove', move);
        element.addEventListener('pointerup', finish);
        element.addEventListener('pointercancel', finish);
        element.addEventListener('lostpointercapture', finish);
      }}
    />
  );
}
const defaults = { libraryWidth: 300, inspectorWidth: 300, timelineHeight: 250 };
const limits = { libraryWidth: [200, 480], inspectorWidth: [240, 480], timelineHeight: [150, 620] };
type Layout = typeof defaults;
export function useWorkbenchLayout() {
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('freecut-workbench-layout-v1') || '{}');
      return Object.fromEntries(
        Object.entries(defaults).map(([key, value]) => {
          const [min, max] = limits[key as keyof Layout];
          return [
            key,
            Number.isFinite(saved[key]) ? Math.max(min, Math.min(max, saved[key])) : value,
          ];
        }),
      ) as Layout;
    } catch {
      return defaults;
    }
  });
  const [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight });
  useEffect(() => {
    const resize = () => setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('freecut-workbench-layout-v1', JSON.stringify(layout));
    } catch {
      /* Preferences remain usable in memory. */
    }
  }, [layout]);
  return {
    ...layout,
    viewport,
    change: (key: keyof Layout, value: number) =>
      setLayout((previous) => ({ ...previous, [key]: value })),
    reset: () => setLayout(defaults),
  };
}
