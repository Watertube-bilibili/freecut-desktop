import {
  X,
  Diamond,
  RotateCcw,
  Trash2,
  SlidersHorizontal,
  Move,
  Volume2,
  Type,
  ChevronRight,
  ChevronLeft,
  Sparkles,
} from 'lucide-react';
import type { AnimProperty, Clip, Easing, Effects, Project } from '../types';
import { defaultEffects, evaluate, trimClip } from '../core/project';
import { canRecordFrame, frameNavigation, recordFrame, removeFrame } from '../core/easy-keyframes';
import './inspector-easy.css';

const properties: {
  key: AnimProperty;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}[] = [
  { key: 'x', label: '位置 X', min: -1920, max: 1920, step: 1, unit: 'px' },
  { key: 'y', label: '位置 Y', min: -1920, max: 1920, step: 1, unit: 'px' },
  { key: 'scale', label: '缩放', min: 0.05, max: 4, step: 0.01, unit: '×' },
  { key: 'rotation', label: '旋转', min: -360, max: 360, step: 1, unit: '°' },
  { key: 'opacity', label: '不透明度', min: 0, max: 1, step: 0.01, unit: '' },
  { key: 'volume', label: '音量', min: 0, max: 4, step: 0.01, unit: '×' },
];
const effectFields: {
  key: keyof Effects;
  label: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: 'brightness', label: '亮度', min: 0, max: 2, step: 0.01 },
  { key: 'contrast', label: '对比度', min: 0, max: 2, step: 0.01 },
  { key: 'saturation', label: '饱和度', min: 0, max: 3, step: 0.01 },
  { key: 'hue', label: '色相', min: -180, max: 180, step: 1 },
  { key: 'blur', label: '模糊', min: 0, max: 40, step: 1 },
  { key: 'vignette', label: '暗角', min: 0, max: 1, step: 0.01 },
  { key: 'pixelate', label: '马赛克', min: 0, max: 60, step: 1 },
  { key: 'grayscale', label: '黑白', min: 0, max: 1, step: 0.01 },
  { key: 'sepia', label: '复古', min: 0, max: 1, step: 0.01 },
];
interface Props {
  mode: 'easy' | 'pro';
  setMode: (mode: 'easy' | 'pro') => void;
  applyMotion: (id: string) => void;
  onClose: () => void;
  clip?: Clip;
  project: Project;
  time: number;
  tab: string;
  setTab: (tab: string) => void;
  change: (update: (clip: Clip) => Clip) => void;
  setAnim: (property: AnimProperty, value: number) => void;
  toggleKey: (property: AnimProperty) => void;
  seek: (time: number) => void;
}
export default function Inspector({
  mode,
  setMode,
  applyMotion,
  onClose,
  clip,
  project,
  time,
  tab,
  setTab,
  change,
  setAnim,
  toggleKey,
  seek,
}: Props) {
  const local = clip ? Math.max(0, Math.min(clip.duration, time - clip.start)) : 0;
  const hasPixels = clip?.kind === 'video' || clip?.kind === 'image';
  const visibleProperties = properties.filter((p) =>
    clip?.kind === 'audio' ? p.key === 'volume' : p.key !== 'volume' || clip?.kind === 'video',
  );
  const update = (values: Partial<Clip>) => change((c) => ({ ...c, ...values }));
  const effect = (key: keyof Effects, value: Effects[keyof Effects]) =>
    change((c) => ({ ...c, effects: { ...c.effects, [key]: value } }));
  const locked = !!project.tracks.find((track) => track.id === clip?.trackId)?.locked;
  const navigation = clip ? frameNavigation(clip, local, project.fps) : undefined;
  const easyControls = clip && navigation && (
    <>
      <section className="easy-keyframes" aria-label="一键关键帧">
        <div className="easy-keyframe-position">
          <span>片段内 {local.toFixed(2)} 秒</span>
          <span className={navigation.current !== undefined ? 'recorded' : ''}>
            {navigation.current !== undefined
              ? '此处已记录'
              : `${navigation.times.length} 处关键帧`}
          </span>
        </div>
        <button
          className="easy-record"
          disabled={locked || !canRecordFrame(clip, local, project.fps)}
          onClick={() => change((c) => recordFrame(c, local, project.fps))}
        >
          <Diamond size={19} fill={navigation.current !== undefined ? 'currentColor' : 'none'} />
          {clip.kind === 'audio' ? '记录当前音量' : '记录当前画面'}
        </button>
        <p className="easy-help">
          {locked ? '轨道已锁定，请先解锁。' : '记录起点，移动播放头，调整后再记录。'}
        </p>
        <div className="easy-keyframe-navigation">
          <button
            title="上一个关键帧"
            aria-label="上一个关键帧"
            disabled={navigation.previous === undefined}
            onClick={() =>
              navigation.previous !== undefined && seek(clip.start + navigation.previous)
            }
          >
            <ChevronLeft size={15} />
            上一处
          </button>
          <button
            title="删除当前整组关键帧"
            aria-label="删除当前整组关键帧"
            disabled={locked || navigation.current === undefined}
            onClick={() => change((c) => removeFrame(c, local, project.fps))}
          >
            <Trash2 size={14} />
            删除此处
          </button>
          <button
            title="下一个关键帧"
            aria-label="下一个关键帧"
            disabled={navigation.next === undefined}
            onClick={() => navigation.next !== undefined && seek(clip.start + navigation.next)}
          >
            下一处
            <ChevronRight size={15} />
          </button>
        </div>
      </section>
      <section className="easy-adjustments">
        <h3>{clip.kind === 'audio' ? '调整声音' : '调整画面'}</h3>
        {[
          ...(clip.kind === 'audio'
            ? []
            : [
                {
                  prop: 'scale' as const,
                  label: '画面大小',
                  min: 10,
                  max: 400,
                  factor: 100,
                  unit: '%',
                },
                {
                  prop: 'x' as const,
                  label: '左右移动',
                  min: -project.width,
                  max: project.width,
                  factor: 1,
                  unit: ' px',
                },
                {
                  prop: 'y' as const,
                  label: '上下移动',
                  min: -project.height,
                  max: project.height,
                  factor: 1,
                  unit: ' px',
                },
                {
                  prop: 'opacity' as const,
                  label: '不透明度',
                  min: 0,
                  max: 100,
                  factor: 100,
                  unit: '%',
                },
              ]),
          ...(['audio', 'video'].includes(clip.kind)
            ? [
                {
                  prop: 'volume' as const,
                  label: '声音大小',
                  min: 0,
                  max: 400,
                  factor: 100,
                  unit: '%',
                },
              ]
            : []),
        ].map((control) => (
          <label className="easy-slider" key={control.prop}>
            <span>
              {control.label}
              <output>
                {Math.round(evaluate(clip, control.prop, local) * control.factor)}
                {control.unit}
              </output>
            </span>
            <input
              aria-label={control.label}
              type="range"
              min={control.min}
              max={control.max}
              step={1}
              disabled={locked}
              value={evaluate(clip, control.prop, local) * control.factor}
              onChange={(event) => setAnim(control.prop, +event.target.value / control.factor)}
            />
          </label>
        ))}
      </section>
      <section className="easy-motion-presets">
        <h3>
          <Sparkles size={14} />
          一键动画
        </h3>
        <div>
          {(clip.kind === 'audio'
            ? [{ id: 'fade', label: '音量淡入淡出' }]
            : [
                { id: 'zoom', label: '缓慢放大' },
                { id: 'slide', label: '从左移入' },
                { id: 'fade', label: '淡入淡出' },
                { id: 'pop', label: '缩放出现' },
              ]
          ).map((preset) => (
            <button key={preset.id} disabled={locked} onClick={() => applyMotion(preset.id)}>
              {preset.label}
            </button>
          ))}
        </div>
      </section>
    </>
  );
  return (
    <aside className={`inspector inspector-${mode}`}>
      <div className="panel-heading">
        <span>属性检查器</span>
        <div className="inspector-mode" role="group" aria-label="属性检查器模式">
          <button aria-pressed={mode === 'easy'} onClick={() => setMode('easy')}>
            普通
          </button>
          <button aria-pressed={mode === 'pro'} onClick={() => setMode('pro')}>
            专业
          </button>
        </div>
        <button className="icon-button" title="关闭属性检查器" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="inspector-tabs">
        {[
          ['basic', '基础'],
          ['effects', '调色 / 蒙版'],
          ['keyframes', '关键帧'],
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {!clip ? (
        <div className="inspector-empty">
          <Move size={30} />
          <h3>让每一帧恰到好处</h3>
          <p>选择时间线中的片段，调整画面、声音或添加关键帧。</p>
          <div className="project-facts">
            <span>画布</span>
            <b>
              {project.width} × {project.height}
            </b>
            <span>帧率</span>
            <b>{project.fps} fps</b>
            <span>素材</span>
            <b>{project.assets.length} 个</b>
          </div>
        </div>
      ) : (
        <div className="inspector-body">
          <div className="selection-name">
            <span className={`kind-dot ${clip.kind}`} />
            <strong>{clip.name}</strong>
          </div>
          {mode === 'easy' && (tab === 'basic' || tab === 'keyframes') && easyControls}
          {tab === 'basic' && (
            <>
              {mode === 'pro' && (
                <section>
                  <h3>
                    <Move size={14} /> 变换 <small>点击菱形添加关键帧</small>
                  </h3>
                  {visibleProperties.map((p) => {
                    const value = evaluate(clip, p.key, local),
                      exists = clip.keyframes[p.key]?.some(
                        (k) => Math.abs(k.time - local) < 0.5 / project.fps,
                      );
                    return (
                      <div className="anim-control" key={p.key}>
                        <label htmlFor={`prop-${p.key}`}>{p.label}</label>
                        <input
                          aria-label={p.label}
                          id={`prop-${p.key}`}
                          type="number"
                          step={p.step}
                          min={p.min}
                          max={p.max}
                          value={Number(value.toFixed(3))}
                          onChange={(e) => {
                            if (e.target.value !== '')
                              setAnim(
                                p.key,
                                Math.max(p.min, Math.min(p.max, Number(e.target.value))),
                              );
                          }}
                        />
                        <span className="unit">{p.unit}</span>
                        <button
                          className={`icon-button key-button ${exists ? 'keyed' : ''}`}
                          title={`${exists ? '删除' : '添加'}${p.label}关键帧`}
                          onClick={() => toggleKey(p.key)}
                        >
                          <Diamond size={14} fill={exists ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                    );
                  })}
                </section>
              )}
              {clip.kind === 'text' && clip.text && (
                <section>
                  <h3>
                    <Type size={14} /> 文字
                  </h3>
                  <textarea
                    aria-label="文字内容"
                    value={clip.text.text}
                    onChange={(e) => update({ text: { ...clip.text!, text: e.target.value } })}
                    rows={3}
                  />
                  <div className="two-controls">
                    <label>
                      字号
                      <input
                        aria-label="字号"
                        type="number"
                        min={8}
                        max={400}
                        value={clip.text.fontSize}
                        onChange={(e) =>
                          update({
                            text: {
                              ...clip.text!,
                              fontSize: Math.max(8, Math.min(400, +e.target.value)),
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      文字颜色
                      <input
                        aria-label="文字颜色"
                        type="color"
                        value={clip.text.color}
                        onChange={(e) => update({ text: { ...clip.text!, color: e.target.value } })}
                      />
                    </label>
                  </div>
                  <div className="segmented">
                    <button
                      className={clip.text.bold ? 'active' : ''}
                      onClick={() => update({ text: { ...clip.text!, bold: !clip.text!.bold } })}
                    >
                      加粗
                    </button>
                    <button
                      className={clip.text.stroke ? 'active' : ''}
                      onClick={() =>
                        update({ text: { ...clip.text!, stroke: !clip.text!.stroke } })
                      }
                    >
                      描边
                    </button>
                    <button
                      className={clip.text.background !== 'transparent' ? 'active' : ''}
                      onClick={() =>
                        update({
                          text: {
                            ...clip.text!,
                            background:
                              clip.text!.background === 'transparent' ? '#161a1d' : 'transparent',
                          },
                        })
                      }
                    >
                      底色
                    </button>
                  </div>
                  <label className="inline-field">
                    对齐
                    <select
                      value={clip.text.align}
                      onChange={(e) =>
                        update({ text: { ...clip.text!, align: e.target.value as 'center' } })
                      }
                    >
                      <option value="left">左对齐</option>
                      <option value="center">居中</option>
                      <option value="right">右对齐</option>
                    </select>
                  </label>
                </section>
              )}
              {clip.kind === 'shape' && (
                <section>
                  <label className="inline-field">
                    色卡颜色
                    <input
                      aria-label="色卡颜色"
                      type="color"
                      value={clip.color}
                      onChange={(e) => update({ color: e.target.value })}
                    />
                  </label>
                </section>
              )}
              {mode === 'pro' && (
                <section>
                  <h3>时间与速度</h3>
                  <label className="inline-field">
                    所在轨道
                    <select
                      aria-label="所在轨道"
                      value={clip.trackId}
                      onChange={(e) => update({ trackId: e.target.value })}
                    >
                      {project.tracks.map((track) => (
                        <option
                          key={track.id}
                          value={track.id}
                          disabled={
                            track.locked || (track.kind === 'audio' && clip.kind !== 'audio')
                          }
                        >
                          {track.name}
                          {track.locked ? '（已锁定）' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-field">
                    开始时间
                    <input
                      aria-label="开始时间"
                      type="number"
                      min={0}
                      step={0.1}
                      value={Number(clip.start.toFixed(3))}
                      onChange={(e) => update({ start: Math.max(0, +e.target.value) })}
                    />
                    <span>秒</span>
                  </label>
                  <label className="inline-field">
                    片段时长
                    <input
                      aria-label="片段时长"
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={Number(clip.duration.toFixed(3))}
                      onChange={(e) => {
                        const asset = project.assets.find((a) => a.id === clip.assetId);
                        const max =
                          asset && asset.kind !== 'image'
                            ? (asset.duration - clip.inPoint) / clip.speed
                            : 3600;
                        const duration = Math.max(0.1, Math.min(max, +e.target.value));
                        change((c) => trimClip(c, 0, c.duration - duration));
                      }}
                    />
                    <span>秒</span>
                  </label>
                  {['video', 'audio'].includes(clip.kind) && (
                    <label className="inline-field">
                      常规变速
                      <select
                        value={clip.speed}
                        onChange={(e) => {
                          const speed = +e.target.value,
                            ratio = clip.speed / speed;
                          update({
                            speed,
                            duration: clip.duration * ratio,
                            keyframes: Object.fromEntries(
                              Object.entries(clip.keyframes).map(([k, v]) => [
                                k,
                                v?.map((frame) => ({ ...frame, time: frame.time * ratio })),
                              ]),
                            ),
                            fadeIn: clip.fadeIn * ratio,
                            fadeOut: clip.fadeOut * ratio,
                          });
                        }}
                      >
                        {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((s) => (
                          <option key={s} value={s}>
                            {s}×
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </section>
              )}
              {mode === 'pro' && (
                <section>
                  <h3>
                    <Volume2 size={14} /> 淡入淡出
                  </h3>
                  {(['fadeIn', 'fadeOut'] as const).map((key, i) => (
                    <label className="inline-field" key={key}>
                      {i === 0 ? '淡入' : '淡出'}
                      <input
                        aria-label={i === 0 ? '淡入' : '淡出'}
                        type="number"
                        min={0}
                        max={clip.duration}
                        step={0.1}
                        value={clip[key]}
                        onChange={(e) =>
                          update({ [key]: Math.max(0, Math.min(clip.duration, +e.target.value)) })
                        }
                      />
                      <span>秒</span>
                    </label>
                  ))}
                </section>
              )}
            </>
          )}
          {tab === 'effects' && clip.kind === 'audio' && (
            <p className="keyframe-intro">
              音频片段可在“基础”和“关键帧”中调整音量、速度及淡入淡出。
            </p>
          )}
          {tab === 'effects' && clip.kind !== 'audio' && (
            <>
              <section>
                <h3>
                  画面调整
                  <button
                    title="重置全部效果"
                    className="icon-button"
                    onClick={() => update({ effects: defaultEffects() })}
                  >
                    <RotateCcw size={13} />
                  </button>
                </h3>
                {effectFields
                  .filter((p) => p.key !== 'pixelate' || hasPixels)
                  .map((p) => (
                    <div className="range-control" key={p.key}>
                      <label>
                        {p.label}
                        <output>{Number(clip.effects[p.key]).toFixed(p.step < 1 ? 2 : 0)}</output>
                      </label>
                      <input
                        aria-label={p.label}
                        type="range"
                        min={p.min}
                        max={p.max}
                        step={p.step}
                        value={Number(clip.effects[p.key])}
                        onChange={(e) => effect(p.key, +e.target.value)}
                      />
                    </div>
                  ))}
              </section>
              <section>
                <h3>蒙版</h3>
                <select
                  aria-label="蒙版形状"
                  value={clip.effects.mask}
                  onChange={(e) => effect('mask', e.target.value as Effects['mask'])}
                >
                  <option value="none">无蒙版</option>
                  <option value="circle">圆形</option>
                  <option value="rectangle">矩形</option>
                </select>
                {clip.effects.mask !== 'none' && (
                  <div className="range-control">
                    <label>蒙版大小</label>
                    <input
                      aria-label="蒙版大小"
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.01}
                      value={clip.effects.maskSize}
                      onChange={(e) => effect('maskSize', +e.target.value)}
                    />
                  </div>
                )}
                <div className="segmented">
                  <button
                    className={clip.effects.flipX ? 'active' : ''}
                    onClick={() => effect('flipX', !clip.effects.flipX)}
                  >
                    水平镜像
                  </button>
                  <button
                    className={clip.effects.flipY ? 'active' : ''}
                    onClick={() => effect('flipY', !clip.effects.flipY)}
                  >
                    垂直镜像
                  </button>
                </div>
              </section>
              {hasPixels && (
                <section>
                  <h3>色度抠像</h3>
                  <label className="inline-field">
                    启用抠像
                    <input
                      type="checkbox"
                      checked={clip.effects.chroma}
                      onChange={(e) => effect('chroma', e.target.checked)}
                    />
                  </label>
                  {clip.effects.chroma && (
                    <>
                      <label className="inline-field">
                        移除颜色
                        <input
                          aria-label="移除颜色"
                          type="color"
                          value={clip.effects.chromaColor}
                          onChange={(e) => effect('chromaColor', e.target.value)}
                        />
                      </label>
                      <div className="range-control">
                        <label>
                          容差 <output>{clip.effects.chromaThreshold}</output>
                        </label>
                        <input
                          aria-label="抠像容差"
                          type="range"
                          min={0}
                          max={350}
                          value={clip.effects.chromaThreshold}
                          onChange={(e) => effect('chromaThreshold', +e.target.value)}
                        />
                      </div>
                    </>
                  )}
                </section>
              )}
            </>
          )}
          {tab === 'keyframes' && mode === 'pro' && (
            <>
              <div className="keyframe-intro">
                <Diamond size={20} />
                <p>移动播放头，再改变参数。已有关键帧的属性会自动记录动画。</p>
              </div>
              <div className="local-time">
                片段内时间 <b>{local.toFixed(2)} s</b>
              </div>
              {visibleProperties.map((prop) => (
                <section className="keyframe-property" key={prop.key}>
                  <h3>
                    {prop.label}
                    <button className="text-button" onClick={() => toggleKey(prop.key)}>
                      添加关键帧
                    </button>
                  </h3>
                  {!clip.keyframes[prop.key]?.length ? (
                    <p className="muted small">暂无关键帧 · 当前 {clip.transform[prop.key]}</p>
                  ) : (
                    clip.keyframes[prop.key]!.map((k) => (
                      <div className="keyframe-row" key={k.id}>
                        <button
                          className="time-link"
                          title="跳转至此关键帧"
                          onClick={() => seek(clip.start + k.time)}
                        >
                          <Diamond size={11} />
                          {k.time.toFixed(2)}s
                        </button>
                        <input
                          aria-label={`${prop.label}关键帧值`}
                          type="number"
                          step={prop.step}
                          value={k.value}
                          onChange={(e) =>
                            change((c) => ({
                              ...c,
                              keyframes: {
                                ...c.keyframes,
                                [prop.key]: c.keyframes[prop.key]!.map((f) =>
                                  f.id === k.id
                                    ? {
                                        ...f,
                                        value: Math.max(
                                          prop.min,
                                          Math.min(prop.max, +e.target.value),
                                        ),
                                      }
                                    : f,
                                ),
                              },
                            }))
                          }
                        />
                        <select
                          aria-label="缓动方式"
                          value={k.easing}
                          onChange={(e) =>
                            change((c) => ({
                              ...c,
                              keyframes: {
                                ...c.keyframes,
                                [prop.key]: c.keyframes[prop.key]!.map((f) =>
                                  f.id === k.id ? { ...f, easing: e.target.value as Easing } : f,
                                ),
                              },
                            }))
                          }
                        >
                          <option value="linear">线性</option>
                          <option value="ease-in">缓入</option>
                          <option value="ease-out">缓出</option>
                          <option value="ease-in-out">缓入缓出</option>
                          <option value="hold">保持</option>
                        </select>
                        <button
                          className="icon-button"
                          title="删除关键帧"
                          onClick={() =>
                            change((c) => ({
                              ...c,
                              keyframes: {
                                ...c.keyframes,
                                [prop.key]: c.keyframes[prop.key]!.filter((f) => f.id !== k.id),
                              },
                            }))
                          }
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))
                  )}
                </section>
              ))}
              <p className="muted small">
                <ChevronRight size={12} /> 缓动方式控制从此关键帧到下一帧的变化。
              </p>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
