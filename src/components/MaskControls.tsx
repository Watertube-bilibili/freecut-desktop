import { useI18n } from '../i18n';
import type { Effects } from '../types';
import { maskShapes } from '../core/masks';
import './mask-controls.css';

export default function MaskControls({
  effects,
  onChange,
}: {
  effects: Effects;
  onChange: (values: Partial<Effects>) => void;
}) {
  const { t } = useI18n();
  const controls: {
    key: 'maskSize' | 'maskX' | 'maskY' | 'maskRotation' | 'maskFeather';
    label: string;
    min: number;
    max: number;
    step: number;
    fallback: number;
  }[] = [
    { key: 'maskSize', label: '蒙版大小', min: 0.01, max: 2, step: 0.01, fallback: 1 },
    { key: 'maskX', label: '蒙版位置 X', min: -1, max: 1, step: 0.01, fallback: 0 },
    { key: 'maskY', label: '蒙版位置 Y', min: -1, max: 1, step: 0.01, fallback: 0 },
    { key: 'maskRotation', label: '蒙版旋转', min: -180, max: 180, step: 1, fallback: 0 },
    { key: 'maskFeather', label: '蒙版羽化', min: 0, max: 0.25, step: 0.005, fallback: 0 },
  ];
  return (
    <div className="mask-controls">
      <label className="mask-shape-label">
        {' '}
        {t('形状')}{' '}
        <select
          aria-label={t('蒙版形状')}
          value={effects.mask}
          onChange={(e) => onChange({ mask: e.target.value as Effects['mask'] })}
        >
          {maskShapes.map((shape) => (
            <option key={shape.value} value={shape.value}>
              {t(shape.label)}
            </option>
          ))}
        </select>
      </label>
      <div className="mask-shape-grid" aria-label={t('常用蒙版形状')}>
        {maskShapes
          .filter((shape) => shape.value !== 'none')
          .map((shape) => (
            <button
              key={shape.value}
              type="button"
              aria-label={t('使用{v0}蒙版', { v0: t(shape.label) })}
              aria-pressed={effects.mask === shape.value}
              className={effects.mask === shape.value ? 'active' : ''}
              onClick={() => onChange({ mask: shape.value })}
            >
              <span aria-hidden="true">{shape.symbol}</span>
              <small>{t(shape.label)}</small>
            </button>
          ))}
      </div>
      {effects.mask !== 'none' && (
        <>
          {controls.map((control) => (
            <div className="range-control" key={control.key}>
              <label>
                {t(control.label)}
                <output>
                  {control.key === 'maskRotation'
                    ? `${effects[control.key] ?? 0}°`
                    : `${Math.round((effects[control.key] ?? control.fallback) * 100)}%`}
                </output>
              </label>
              <input
                aria-label={t(control.label)}
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={effects[control.key] ?? control.fallback}
                onChange={(e) => onChange({ [control.key]: Number(e.target.value) })}
              />
            </div>
          ))}
          <label className="inline-field">
            {' '}
            {t('反转蒙版')}{' '}
            <input
              type="checkbox"
              aria-label={t('反转蒙版')}
              checked={effects.maskInvert ?? false}
              onChange={(e) => onChange({ maskInvert: e.target.checked })}
            />
          </label>
          <button
            type="button"
            className="mask-reset"
            onClick={() =>
              onChange({
                maskSize: 1,
                maskX: 0,
                maskY: 0,
                maskRotation: 0,
                maskFeather: 0,
                maskInvert: false,
              })
            }
          >
            {' '}
            {t('重置蒙版位置与边缘')}{' '}
          </button>
          <p className="mask-help">{t('蒙版随画面的位置、缩放和旋转关键帧一起运动。')}</p>
        </>
      )}
    </div>
  );
}
