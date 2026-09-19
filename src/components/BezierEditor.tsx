import { useI18n } from '../i18n';
import type { Keyframe } from '../types';
import { DEFAULT_BEZIER } from '../../shared/concat-bezier.mjs';
import './bezier-editor.css';

const presets: { label: string; curve: NonNullable<Keyframe['curve']> }[] = [
  { label: '柔和', curve: [0.25, 0.1, 0.25, 1] },
  { label: '快速到位', curve: [0.16, 1, 0.3, 1] },
  { label: '先慢后快', curve: [0.7, 0, 0.84, 0] },
];

export default function BezierEditor({
  curve,
  change,
}: {
  curve?: Keyframe['curve'];
  change: (value: NonNullable<Keyframe['curve']>) => void;
}) {
  const { t } = useI18n();
  const value = curve ?? [...DEFAULT_BEZIER];
  const [x1, y1, x2, y2] = value;
  return (
    <div className="bezier-editor" aria-label={t('贝塞尔曲线')}>
      <div className="bezier-chart" aria-hidden="true">
        <svg viewBox="0 0 116 84">
          <path d="M 8 8 V 76 H 108" className="bezier-axis" />
          <path
            d={`M 8 76 L ${8 + x1 * 100} ${76 - y1 * 68} M 108 8 L ${8 + x2 * 100} ${76 - y2 * 68}`}
            className="bezier-handles"
          />
          <path
            d={`M 8 76 C ${8 + x1 * 100} ${76 - y1 * 68}, ${8 + x2 * 100} ${76 - y2 * 68}, 108 8`}
            className="bezier-line"
          />
          <circle cx={8 + x1 * 100} cy={76 - y1 * 68} r="3" />
          <circle cx={8 + x2 * 100} cy={76 - y2 * 68} r="3" />
        </svg>
        <span>{t('时间 →')}</span>
      </div>
      <div className="bezier-inputs">
        {['X1', 'Y1', 'X2', 'Y2'].map((name, index) => (
          <label key={name}>
            <span>{name}</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={value[index]}
              aria-label={`${t('曲线控制点')} ${name}`}
              onChange={(event) => {
                const number = event.currentTarget.valueAsNumber;
                if (!Number.isFinite(number)) return;
                const next: NonNullable<Keyframe['curve']> = [...value];
                next[index] = Math.max(0, Math.min(1, number));
                change(next);
              }}
            />
          </label>
        ))}
      </div>
      <div className="bezier-presets">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            aria-pressed={value.every((v, i) => v === preset.curve[i])}
            onClick={() => change([...preset.curve])}
          >
            {t(preset.label)}
          </button>
        ))}
      </div>
    </div>
  );
}
