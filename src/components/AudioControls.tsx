import { useI18n } from '../i18n';
import { Volume2 } from 'lucide-react';
import type { AudioSettings } from '../types';
import { defaultAudio } from '../core/audio-routing';

export default function AudioControls({
  audio,
  change,
}: {
  audio?: AudioSettings;
  change: (audio: AudioSettings) => void;
}) {
  const { t } = useI18n();
  const value = { ...defaultAudio(), ...audio };
  const update = (patch: Partial<AudioSettings>) => change({ ...value, ...patch });
  return (
    <section aria-label={t('声道控制')}>
      <h3>
        <Volume2 size={14} /> {t('左右声道')}
      </h3>
      <label className="inline-field">
        {t('声道来源')}
        <select
          aria-label={t('声道来源')}
          value={value.channelMode}
          onChange={(event) =>
            update({ channelMode: event.target.value as AudioSettings['channelMode'] })
          }
        >
          <option value="stereo">{t('原始立体声')}</option>
          <option value="left">{t('仅左声道（送到双侧）')}</option>
          <option value="right">{t('仅右声道（送到双侧）')}</option>
          <option value="mono">{t('混合为单声道')}</option>
          <option value="swap">{t('交换左右声道')}</option>
        </select>
      </label>
      <label className="inline-field">
        {t('左右平衡')}
        <input
          aria-label={t('左右平衡')}
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={value.pan}
          onChange={(event) => update({ pan: Number(event.target.value) })}
        />
        <span>
          {value.pan === 0
            ? t('居中')
            : t('{v0} {v1}%', {
                v0: t(value.pan < 0 ? '左' : '右'),
                v1: Math.round(Math.abs(value.pan) * 100),
              })}
        </span>
      </label>
      <div className="two-controls">
        {(['leftGain', 'rightGain'] as const).map((key) => (
          <label key={key}>
            {key === 'leftGain' ? t('左声道音量') : t('右声道音量')}
            <input
              aria-label={key === 'leftGain' ? t('左声道音量') : t('右声道音量')}
              type="number"
              min={0}
              max={200}
              step={1}
              value={Math.round(value[key] * 100)}
              onChange={(event) => {
                if (event.target.value !== '')
                  update({ [key]: Math.max(0, Math.min(2, Number(event.target.value) / 100)) });
              }}
            />
            %
          </label>
        ))}
      </div>
      <p className="muted small">
        {t('平衡向一侧移动时，另一侧音量会降低。单声道素材会复制到双侧。')}
      </p>
      <button onClick={() => change(defaultAudio())}>{t('重置声道')}</button>
    </section>
  );
}
