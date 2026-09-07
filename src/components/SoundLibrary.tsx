import { useEffect, useRef, useState } from 'react';
import { Loader2, Play, Plus, Volume2 } from 'lucide-react';
import type { MediaAsset } from '../types';
import './sound-library.css';
interface Sound { id: string; name: string; category: string; duration: number; license: string }
interface SoundAPI { listSounds: () => Promise<Sound[]>; createSound: (id: string) => Promise<MediaAsset> }
export default function SoundLibrary({ onAddAsset, notify, search = '' }: { onAddAsset: (asset: MediaAsset) => void; notify: (message: string) => void; search?: string }) {
  const api = window.freecut as (NonNullable<Window['freecut']> & SoundAPI) | undefined;
  const [sounds, setSounds] = useState<Sound[]>([]), [busy, setBusy] = useState<string>();
  const preview = useRef<HTMLAudioElement>(undefined), assets = useRef(new Map<string, MediaAsset>()), mounted = useRef(true);
  useEffect(() => { mounted.current = true; void api?.listSounds().then(items => { if (mounted.current) setSounds(items); }).catch(error => notify(String(error))); return () => { mounted.current = false; preview.current?.pause(); }; }, []);
  async function useSound(sound: Sound, add: boolean) {
    if (!api || busy) return;
    setBusy(sound.id);
    try {
      const asset = assets.current.get(sound.id) ?? await api.createSound(sound.id);
      assets.current.set(sound.id, asset);
      if (!mounted.current) return;
      if (add) onAddAsset(asset);
      else { preview.current?.pause(); preview.current = new Audio(asset.url); preview.current.volume = .65; await preview.current.play(); }
    } catch (error) { notify((error as Error).message); }
    finally { if (mounted.current) setBusy(undefined); }
  }
  return <section className="sound-library" aria-label="内置原创音效">
    <h3><Volume2 size={16} /> 内置音效 <small>16 种 · 无需下载</small></h3>
    <p>本地合成的点击、提示与转场声。先试听，再加入时间线。</p>
    {!api && <p>请在桌面版本中使用内置音效。</p>}
    <div className="sound-list">{sounds.filter(sound => `${sound.name}${sound.category}`.includes(search)).map(sound => <div className="sound-row" key={sound.id}>
      <button className="sound-preview" title={`试听 ${sound.name}`} onClick={() => void useSound(sound, false)} disabled={Boolean(busy)}>{busy === sound.id ? <Loader2 size={16} className="spin" /> : <Play size={16} />}<span><strong>{sound.name}</strong><small>{sound.category} · {sound.duration.toFixed(2)} 秒</small></span></button>
      <button className="icon-button" title={`添加音效 ${sound.name}`} onClick={() => void useSound(sound, true)} disabled={Boolean(busy)}><Plus size={17} /></button>
    </div>)}</div>
    <p className="sound-license">原创合成 · 音效文件 CC0 · 无外部素材采样</p>
  </section>;
}
