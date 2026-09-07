# 配方与工程约定

配方版本为 `1`。下例从 `scene.mp4` 的第 1 秒开始使用 5 秒，添加标题并让它淡入。素材文件相对配方位置解析；不要使用网络 URL。

```json
{
  "version": 1,
  "name": "我的短片",
  "canvas": { "width": 1280, "height": 720, "fps": 24, "background": "#163e36" },
  "assets": [{ "id": "scene", "path": "scene.mp4" }],
  "clips": [
    { "asset": "scene", "start": 0, "inPoint": 1, "duration": 5, "layer": 0,
      "transform": { "volume": 0.7 } },
    { "kind": "text", "text": "新的故事", "start": 0.5, "duration": 4,
      "layer": 10, "style": { "fontSize": 64, "color": "#ffffff", "bold": true },
      "transform": { "x": 0, "y": 190 },
      "keyframes": { "opacity": [
        { "time": 0, "value": 0, "easing": "ease-out" },
        { "time": 0.6, "value": 1 }
      ] } }
  ],
  "export": { "height": 720, "fps": 24, "quality": "high" }
}
```

## 配方字段

| 字段 | 含义 |
| --- | --- |
| `name` | 非空工程名。 |
| `canvas` | 可省略字段采用产品默认值：1920×1080、30 fps、深色背景。 |
| `assets` | `id` 唯一；`path` 为本地视频、图片或音频。媒体类型、时长和像素大小由产品实际导入获取，不在配方中伪造。纯文字/色块可以使用空数组。 |
| `clips` | 最多 1000 项，至少一项；素材片段用 `asset` 引用，生成片段用 `kind: "text"` 或 `"shape"`。 |
| `start` | 片段在项目时间线上的秒数，默认 0。 |
| `duration` | 项目秒数。视频/音频默认使用 `inPoint` 之后的剩余时长除以速度；图片/文字/色块默认 5 秒。 |
| `inPoint` | 源素材入点秒数，默认 0。剪切关系为 `源时间 = inPoint + 局部项目时间 × speed`。不可超出素材末尾。 |
| `speed` | 固定速度 0.25–4，默认 1；最终混音由产品处理。 |
| `layer` | 整数 0–99；越大越靠上。文字默认 10，其他默认 0。同层有重叠时配方中后出现的画面覆盖先出现的；音频按产品混合。 |
| `transform` | 部分对象：`x`、`y`、`scale`、`rotation`、`opacity`、`volume`。默认 0、0、1、0、1、1。 |
| `keyframes` | 属性名到关键帧数组。每点为 `time`、`value` 和可选 `easing`；脚本为每帧生成工程 ID。 |
| `text` / `style` | 仅文字片段：文字串，和部分样式 `fontSize`、`color`、`background`、`align`（left/center/right）、`bold`、`stroke`。字体使用产品字体；不支持指定外部字体。 |
| `color` | 色块片段颜色；色块原始大小为整个项目画布，用 `scale` 调整。 |
| `fadeIn` / `fadeOut` | 项目秒数，默认 0，不得大于片段长度。 |
| `audio` | 可选 `pan`（-1..1）、`leftGain`/`rightGain`（0..2）、`channelMode`（stereo/left/right/mono/swap）。音量与声道用于产品预览及导出。 |
| `id` / `name` | 可选片段 ID 和显示名；ID 必须唯一。不填写时自动生成。 |
| `export` | `height` 是产品的分辨率档位，为 720、1080 或 2160；产品按**短边**缩放，保留比例并取偶数尺寸。例如 9:16 竖屏选 720 时导出 720×1280，而不是高度 720。长边不得超过产品当前 3840 像素限制。`fps` 为 24、25、30、50、60；`quality` 为 high/medium。默认 720 档、项目帧率、high。 |

关键帧 `time` 始终从**所属片段的开头**计算，必须在 `[0, duration]` 内；不是整个项目的绝对时间，也不会乘以素材速度。`x/y` 以项目画布中心为原点，单位是项目像素；正 x 向右、正 y 向下。`rotation` 为角度，`scale` 为统一倍数。素材先等比适配画布再应用变换。旋转围绕片段中心。

缓动值为 `linear`、`ease-in`、`ease-out`、`ease-in-out`、`hold`。一段曲线采用**前一个关键帧**的缓动。首尾以外保持端点值；同属性不能有重复时间。透明度范围 0–1，音量范围 0–4。更细约束以仓库自身 `validateProject()` 为准，脚本直接加载它，不另造宽松项目验证器。

多个视频接续：把第二个片段的 `start` 设为第一个的 `start + duration`。一段素材分切：使用相同 `asset`，分别设置 `inPoint/duration/start`。叠加音轨：另加音频素材与片段，按 `start` 排列。字幕可以用多个时间明确的文字片段表达；此桥接不自动识别语音。

## 保存下来的 .freecut 文件

真实工程由产品保存，版本字段为 `version: 1`，包含 `id/name/width/height/fps/background/assets/clips/tracks`。素材条目保留绝对 `path`，临时访问 `url` 在保存时清空，重新打开时由产品重新授权。片段包含 `trackId/assetId/start/duration/inPoint/speed/transform/keyframes/effects/fadeIn/fadeOut`，文字片段另有 `text` 样式对象，色块另有 `color`。

`tracks` 数组靠前的画面在上层。不要把配方 JSON 当作 `.freecut` 文件直接改扩展名；二者结构不同。需要支持新的产品字段时先改配方桥接并独立实测，不能把脚本不认识的字段写进配方后假定生效。
