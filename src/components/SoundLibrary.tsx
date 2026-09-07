import { useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Play, Plus, Volume2 } from 'lucide-react';
import type { MediaAsset } from '../types';
import './sound-library.css';
interface Sound {
  id: string;
  name: string;
  category: string;
  duration: number;
  license: string;
}
interface SoundAPI {
  listSounds: () => Promise<Sound[]>;
  createSound: (id: string) => Promise<MediaAsset>;
}
export default function SoundLibrary({
  onAddAsset,
  notify,
  search = '',
}: {
  onAddAsset: (asset: MediaAsset) => void;
  notify: (message: string) => void;
  search?: string;
}) {
  const { t } = useI18n();
  const api = window.freecut as (NonNullable<Window['freecut']> & SoundAPI) | undefined;
  const [sounds, setSounds] = useState<Sound[]>([]),
    [busy, setBusy] = useState<string>();
  const preview = useRef<HTMLAudioElement>(undefined),
    assets = useRef(new Map<string, MediaAsset>()),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void api
      ?.listSounds()
      .then((items) => {
        if (mounted.current) setSounds(items);
      })
      .catch((error) => notify(t('错误详情：{detail}', { detail: String(error) })));
    return () => {
      mounted.current = false;
      preview.current?.pause();
    };
  }, []);
  async function useSound(sound: Sound, add: boolean) {
    if (!api || busy) return;
    setBusy(sound.id);
    try {
      const asset = assets.current.get(sound.id) ?? (await api.createSound(sound.id));
      assets.current.set(sound.id, asset);
      if (!mounted.current) return;
      if (add) onAddAsset(asset);
      else {
        preview.current?.pause();
        preview.current = new Audio(asset.url);
        preview.current.volume = 0.65;
        await preview.current.play();
      }
    } catch (error) {
      notify(t('错误详情：{detail}', { detail: (error as Error).message }));
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  }
  return (
    <section className="sound-library" aria-label={t('内置原创音效')}>
      <h3>
        <Volume2 size={16} /> {t('内置音效')} <small>{t('16 种 · 无需下载')}</small>
      </h3>
      <p>{t('本地合成的点击、提示与转场声。先试听，再加入时间线。')}</p>
      {!api && <p>{t('请在桌面版本中使用内置音效。')}</p>}
      <div className="sound-list">
        {sounds
          .filter((sound) =>
            `${sound.name}${sound.category}${t(sound.name)}${t(sound.category)}`
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase()),
          )
          .map((sound) => (
            <div className="sound-row" key={sound.id}>
              <button
                className="sound-preview"
                title={t('试听 {v0}', { v0: t(sound.name) })}
                onClick={() => void useSound(sound, false)}
                disabled={Boolean(busy)}
              >
                {busy === sound.id ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
                <span>
                  <strong>{t(sound.name)}</strong>
                  <small>
                    {t(sound.category)} · {sound.duration.toFixed(2)} {t('秒')}
                  </small>
                </span>
              </button>
              <button
                className="icon-button"
                title={t('添加音效 {v0}', { v0: t(sound.name) })}
                onClick={() => void useSound(sound, true)}
                disabled={Boolean(busy)}
              >
                <Plus size={17} />
              </button>
            </div>
          ))}
      </div>
      <p className="sound-license">{t('原创合成 · 音效文件 CC0 · 无外部素材采样')}</p>
    </section>
  );
}
