import { useSyncExternalStore } from 'react';
import { en } from './locales/en';

export type Language = 'zh-CN' | 'en';
export type TranslationValues = Record<string, string | number>;
export const LANGUAGE_STORAGE_KEY = 'freecut-language';

/** Deliberately independent of the operating-system/browser language. */
export function readLanguage(storage?: Pick<Storage, 'getItem'>): Language {
  try {
    return storage?.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

export function translate(text: string, language: Language, values?: TranslationValues): string {
  const message = language === 'en' && Object.hasOwn(en, text) ? en[text] : text;
  return values
    ? message.replace(/\{([^{}]+)\}/g, (token, key: string) =>
        Object.hasOwn(values, key) ? String(values[key]) : token,
      )
    : message;
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
let language: Language = readLanguage(browserStorage());
const listeners = new Set<() => void>();
function syncDocument() {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}
syncDocument();

export function setLanguage(value: Language): void {
  if (value !== 'en' && value !== 'zh-CN') return;
  try {
    browserStorage()?.setItem(LANGUAGE_STORAGE_KEY, value);
  } catch {
    // A disabled/full browser store must not prevent switching this session.
  }
  const changed = language !== value;
  language = value;
  syncDocument();
  if (changed) listeners.forEach((listener) => listener());
}
export function t(text: string, values?: TranslationValues): string {
  return translate(text, language, values);
}

/** Translate known backend status formats, retaining unrecognized diagnostics intact. */
export function statusText(message: string): string {
  if (language === 'zh-CN') return message;
  if (Object.hasOwn(en, message)) return t(message);
  const patterns: [RegExp, string, string[]][] = [
    [/^校验 (.+)$/, '校验 {name}', ['name']],
    [/^下载 (.+)$/, '下载 {name}', ['name']],
    [/^续传 (.+)$/, '续传 {name}', ['name']],
    [/^安装 (.+)$/, '安装 {name}', ['name']],
    [
      /^连接中断，重试 (.+)（(\d+)\/3）$/,
      '连接中断，重试 {name}（{attempt}/3）',
      ['name', 'attempt'],
    ],
    [/^识别语句 (\d+) \/ (\d+)$/, '识别语句 {current} / {total}', ['current', 'total']],
    [
      /^并行下载与校验语音模型 (\d+)\/(\d+)$/,
      '并行下载与校验语音模型 {current}/{total}',
      ['current', 'total'],
    ],
    [/^正在验证模型：(.+)$/, '正在验证模型：{phase}', ['phase']],
    [/^暂时无法安装：(.+)。$/, '暂时无法安装：{detail}。', ['detail']],
    [/^更新未完成：(.+)。可稍后重试。$/, '更新未完成：{detail}。可稍后重试。', ['detail']],
  ];
  for (const [pattern, key, names] of patterns) {
    const match = message.match(pattern);
    if (match)
      return t(
        key,
        Object.fromEntries(
          names.map((name, i) => [
            name,
            name === 'phase' ? statusText(match[i + 1]) : match[i + 1],
          ]),
        ),
      );
  }
  return /[\p{Script=Han}]/u.test(message) ? t('状态：{detail}', { detail: message }) : message;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useI18n() {
  const current = useSyncExternalStore(
    subscribe,
    () => language,
    (): Language => 'zh-CN',
  );
  return { language: current, setLanguage, t };
}
