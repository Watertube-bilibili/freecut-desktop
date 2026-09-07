import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectPresets } from './core/effects';
import { maskShapes } from './core/masks';

describe('interface language', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  beforeEach(() => {
    vi.resetModules();
    values.clear();
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to Simplified Chinese even on an English system', async () => {
    const api = await import('./i18n');
    expect(api.readLanguage(storage)).toBe('zh-CN');
    expect(api.t('设置')).toBe('设置');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('persists an explicit language and restores it on a fresh app module', async () => {
    const api = await import('./i18n');
    api.setLanguage('en');
    expect(values.get('freecut-language')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(api.t('设置')).toBe('Settings');
    vi.resetModules();
    const reopened = await import('./i18n');
    expect(reopened.t('设置')).toBe('Settings');
    reopened.setLanguage('zh-CN');
    expect(values.get('freecut-language')).toBe('zh-CN');
    expect(reopened.t('设置')).toBe('设置');
  });

  it('rejects unsupported saved values and works when storage access fails', async () => {
    values.set('freecut-language', 'fr');
    const api = await import('./i18n');
    expect(api.readLanguage(storage)).toBe('zh-CN');
    expect(
      api.readLanguage({
        getItem: () => {
          throw Error('denied');
        },
      }),
    ).toBe('zh-CN');
    vi.stubGlobal('window', {
      get localStorage() {
        throw Error('denied');
      },
    });
    expect(() => api.setLanguage('en')).not.toThrow();
    expect(api.t('关闭')).toBe('Close');
  });

  it('interpolates zero and repeated placeholders without reinterpreting user text', async () => {
    const { translate } = await import('./i18n');
    expect(translate('识别出 {count} 条字幕，可修改文字后加入时间轴。', 'en', { count: 0 })).toBe(
      'Recognized 0 captions. Edit the text before adding them to the timeline.',
    );
    expect(translate('{name} / {name} / {missing}', 'en', { name: '我的作品 {count} $&' })).toBe(
      '我的作品 {count} $& / 我的作品 {count} $& / {missing}',
    );
    expect(translate('未知词条', 'en')).toBe('未知词条');
    expect(translate('toString', 'en')).toBe('toString');
    expect(translate('打开项目 {v0}', 'en', { v0: '设置' })).toBe('Open project 设置');
  });

  it('translates built-in effect metadata while leaving preset IDs and values unchanged', async () => {
    const { translate } = await import('./i18n');
    const before = JSON.stringify(effectPresets);
    for (const preset of effectPresets) {
      for (const copy of [preset.name, preset.category, preset.description]) {
        expect(translate(copy, 'en'), copy).not.toMatch(/[\p{Script=Han}]/u);
      }
    }
    for (const shape of maskShapes)
      expect(translate(shape.label, 'en')).not.toMatch(/[\p{Script=Han}]/u);
    expect(JSON.stringify(effectPresets)).toBe(before);
  });

  it('translates progress but retains unknown error details and filenames', async () => {
    const api = await import('./i18n');
    api.setLanguage('en');
    expect(api.statusText('识别语句 2 / 5')).toBe('Transcribing sentence 2 / 5');
    expect(api.statusText('校验 中文模型.onnx')).toBe('Verifying 中文模型.onnx');
    expect(api.statusText('校验 设置')).toBe('Verifying 设置');
    expect(api.statusText('服务错误 E123：自定义详情')).toBe('Status: 服务错误 E123：自定义详情');
  });

  it('keeps every feature free in English and asks for a Star without donation copy', async () => {
    const { translate } = await import('./i18n');
    const copy = translate(
      '由初中生使用 GPT-6 与 Codex 自主制作。全部功能永久免费，不设会员，不设付费解锁，导出无水印。自愿赞助不影响任何功能使用。',
      'en',
    );
    expect(copy).toContain('All features are free forever');
    expect(copy).toContain('star on GitHub');
    expect(copy).not.toMatch(/donat|sponsor|membership plans/i);
  });
});
