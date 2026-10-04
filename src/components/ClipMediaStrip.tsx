import { useEffect, useMemo, useRef, useState } from 'react';
import type { Clip, MediaAsset } from '../types';
import { requestMediaCache, useMediaCache } from '../core/use-media-cache';
import './clip-media-strip.css';

export function ClipMediaStrip({ clip, asset, showWaveform = true }: { clip: Clip; asset?: MediaAsset; showWaveform?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false);
  const state = useMediaCache();
  const entry = state.entries.find(item => item.assetPath === asset?.path);
  useEffect(() => {
    if (!ref.current || !asset?.path || asset.missing) return;
    const observer = new IntersectionObserver(([item]) => setVisible(item.isIntersecting), { rootMargin: '100px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [asset?.path, asset?.missing]);
  useEffect(() => {
    if (!visible || !asset?.path || asset.missing) return;
    if (asset.kind !== 'audio') void requestMediaCache(asset, 'thumbnails').catch(() => {});
    if (showWaveform && asset.kind !== 'image') void requestMediaCache(asset, 'waveform').catch(() => {});
  }, [visible, asset?.path, asset?.kind, asset?.missing, showWaveform]);
  const waveform = useMemo(() => {
    if (!entry?.waveform?.bins.length || !showWaveform || !visible) return '';
    const { bins, duration } = entry.waveform;
    // Fixed point count bounds SVG and trim/zoom work independently of clip length.
    const count = 96, points: string[] = [];
    const samples = Array.from({ length: count }, (_, index) => {
      const time = clip.inPoint + index / (count - 1) * clip.duration * clip.speed;
      return bins[Math.max(0, Math.min(bins.length - 1, Math.floor(time / duration * bins.length)))] || 0;
    });
    samples.forEach((value, index) => points.push(`${index / (count - 1) * 100},${50 - Math.max(.02, value) * 48}`));
    samples.slice().reverse().forEach((value, index) => points.push(`${(count - 1 - index) / (count - 1) * 100},${50 + Math.max(.02, value) * 48}`));
    return points.join(' ');
  }, [entry?.waveform, showWaveform, visible, clip.inPoint, clip.duration, clip.speed]);
  const thumbs = visible && entry?.thumbnails?.length ? Array.from({ length: 8 }, (_, index) => {
    const time = clip.inPoint + (index + .5) / 8 * clip.duration * clip.speed;
    return entry.thumbnails!.reduce((best, item) => Math.abs(item.time - time) < Math.abs(best.time - time) ? item : best);
  }) : [];
  return <div className={`clip-media-strip ${clip.kind === 'audio' ? 'audio' : ''}`} ref={ref} aria-hidden="true">
    {!!thumbs.length && <div className="clip-thumbnails">{thumbs.map((item, index) => <img key={index} src={item.url} alt="" loading="lazy" draggable={false} />)}</div>}
    {waveform && <svg className="clip-waveform" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points={waveform}/></svg>}
  </div>;
}
