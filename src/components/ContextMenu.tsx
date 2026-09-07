import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import './context-menu.css';
import { useI18n } from '../i18n';

export interface ContextMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  label: string;
  items: ContextMenuItem[];
  onClose: () => void;
  /** Omit to restore the element focused before opening; null disables restoration. */
  returnFocus?: HTMLElement | null;
}

export default function ContextMenu(props: ContextMenuProps) {
  const { t } = useI18n();
  const { x, y, label, items } = props;
  const latest = useRef(props);
  latest.current = props;
  const menu = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const closed = useRef(false);
  const initialFocus = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const [activeId, setActiveId] = useState<string | undefined>(
    () => items.find((item) => !item.disabled)?.id,
  );
  const [position, setPosition] = useState({
    left: x,
    top: y,
    maxWidth: 320,
    maxHeight: window.innerHeight - 16,
  });

  const close = useCallback((restoreFocus = false) => {
    if (closed.current) return false;
    closed.current = true;
    const current = latest.current;
    const target = current.returnFocus === undefined ? initialFocus.current : current.returnFocus;
    const ownedFocus = menu.current?.contains(document.activeElement) ?? false;
    // Restore synchronously, before an action can focus its own dialog/input.
    // Outside clicks, scrolling and window blur never restore or steal focus.
    current.onClose();
    if (restoreFocus && ownedFocus && target?.isConnected) target.focus({ preventScroll: true });
    return true;
  }, []);

  const focusItem = useCallback((id: string | undefined) => {
    const element = menu.current;
    const item = latest.current.items.find((item) => item.id === id && !item.disabled);
    const button = item ? buttons.current.get(item.id) : undefined;
    if (!button) {
      setActiveId(undefined);
      element?.focus({ preventScroll: true });
      return;
    }
    button.focus({ preventScroll: true });
    setActiveId(item!.id);
    if (element) {
      // Scroll only this menu, never an editor panel behind it.
      const top = button.offsetTop;
      const bottom = top + button.offsetHeight;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (bottom > element.scrollTop + element.clientHeight)
        element.scrollTop = bottom - element.clientHeight;
    }
  }, []);

  const measure = useCallback(() => {
    const element = menu.current;
    if (!element) return;
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const originX = viewport?.offsetLeft ?? 0;
    const originY = viewport?.offsetTop ?? 0;
    const gutter = Math.min(8, width / 4, height / 4);
    const maxWidth = Math.max(1, Math.min(320, width - gutter * 2));
    const maxHeight = Math.max(1, height - gutter * 2);
    const rect = element.getBoundingClientRect();
    const left = Math.max(
      originX + gutter,
      Math.min(
        Number.isFinite(x) ? x : originX,
        originX + width - gutter - Math.min(rect.width, maxWidth),
      ),
    );
    const top = Math.max(
      originY + gutter,
      Math.min(
        Number.isFinite(y) ? y : originY,
        originY + height - gutter - Math.min(rect.height, maxHeight),
      ),
    );
    setPosition((previous) =>
      previous.left === left &&
      previous.top === top &&
      previous.maxWidth === maxWidth &&
      previous.maxHeight === maxHeight
        ? previous
        : { left, top, maxWidth, maxHeight },
    );
  }, [x, y]);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (menu.current) observer.observe(menu.current);
    return () => observer.disconnect();
  }, [measure]);

  // Callback/item-array identity changes during editor updates must not reset focus.
  useLayoutEffect(() => {
    closed.current = false;
    focusItem(latest.current.items.find((item) => !item.disabled)?.id);
  }, [x, y, focusItem]);

  useEffect(() => {
    const outside = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      close(false);
    };
    const dismiss = () => {
      close(false);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    window.addEventListener('scroll', outside, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    window.visualViewport?.addEventListener('resize', dismiss);
    window.visualViewport?.addEventListener('scroll', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
      window.visualViewport?.removeEventListener('resize', dismiss);
      window.visualViewport?.removeEventListener('scroll', dismiss);
    };
  }, [close]);

  const activate = (id: string) => {
    const item = latest.current.items.find((item) => item.id === id);
    if (!item || item.disabled || !close(true)) return;
    item.onSelect();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A portal still bubbles through the React tree. Never let menu keystrokes
    // become editor delete/split/playback shortcuts, including unhandled keys.
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Tab') {
      // Keep native Tab/Shift+Tab navigation, starting from the invoking control.
      close(true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    const enabled = latest.current.items.filter((item) => !item.disabled);
    const index = enabled.findIndex(
      (item) => buttons.current.get(item.id) === document.activeElement,
    );
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? enabled.length - 1
            : event.key === 'ArrowDown'
              ? (index + 1) % enabled.length
              : index < 0
                ? enabled.length - 1
                : (index - 1 + enabled.length) % enabled.length;
      focusItem(enabled[next]?.id);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (index >= 0) activate(enabled[index].id);
    }
  };

  return createPortal(
    <div
      ref={menu}
      className="editor-context-menu"
      role="menu"
      aria-label={t(label)}
      aria-orientation="vertical"
      tabIndex={-1}
      style={{ ...position, minWidth: Math.min(216, position.maxWidth) }}
      data-testid="context-menu"
      onKeyDown={onKeyDown}
      onKeyUp={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {item.separatorBefore && index > 0 && (
            <div className="editor-context-menu-separator" role="separator" />
          )}
          <button
            ref={(element) => {
              if (element) buttons.current.set(item.id, element);
              else buttons.current.delete(item.id);
            }}
            type="button"
            className={`editor-context-menu-item${item.danger ? ' is-danger' : ''}`}
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-label={t(item.label)}
            aria-checked={item.checked}
            aria-disabled={item.disabled || undefined}
            disabled={item.disabled}
            tabIndex={!item.disabled && activeId === item.id ? 0 : -1}
            data-menu-item-id={item.id}
            onFocus={() => setActiveId(item.id)}
            onPointerMove={(event) => {
              if (
                event.pointerType !== 'touch' &&
                !item.disabled &&
                document.activeElement !== event.currentTarget
              )
                focusItem(item.id);
            }}
            onClick={() => activate(item.id)}
          >
            <span className="editor-context-menu-check" aria-hidden="true">
              {item.checked ? '✓' : ''}
            </span>
            <span className="editor-context-menu-label">{t(item.label)}</span>
            {item.shortcut && (
              <kbd className="editor-context-menu-shortcut" aria-hidden="true">
                {item.shortcut}
              </kbd>
            )}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
