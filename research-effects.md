# 特效、字幕、音频与桌面打包调研

调研日期：2026-09-06。本文区分已核实的现有能力与本项目的实现建议；并不代表这些功能已实现。

## 建议技术路线

首版采用 Electron 桌面外壳、React 编辑器、独立 FFmpeg 进程导出。工程使用一个版本化 JSON 描述时间线、素材引用、效果参数和关键帧。预览与导出读取同一描述，避免界面看得到、成片却缺失效果的问题。基础效果优先自制参数预设；高阶 GPU 转场随后通过 GLSL 插件接入。

以下是工程建议，而非第三方产品的能力声明：

- 每个效果记录 `id/version/category/parameters/keyframeable/previewBackend/exportBackend/license`。尚无导出实现的效果不能标成已支持。
- 任意时间取样应为纯函数：`evaluateKeyframes(track, time)`；随机抖动、粒子、噪点使用固定种子，同一工程每次渲染一致。
- 关键帧首批覆盖位置 X/Y、缩放、旋转、透明度、音量；支持线性、缓入、缓出、缓入缓出、保持，以及复制、删除和移动关键帧。曲线编辑器随后接入贝塞尔曲线。
- 效果预设应能调强度、重置、关闭、重新排序；搜索兼容“抠像/去背景”“画中画/叠加”“自动字幕/识别字幕”等用语。
- 关键帧 UI、项目保存、导出三者作为一个完整功能验收，不能只画菱形按钮。

## FFmpeg 可承接的能力

下表是滤镜映射，具体安装包仍需运行 `ffmpeg -filters`、`-encoders` 检测构建实际支持项。[FFmpeg 官方滤镜文档](https://ffmpeg.org/ffmpeg-filters.html)

| 功能 | 引擎入口 |
|---|---|
| 裁切、缩放、旋转、翻转、画中画 | `crop`, `scale`, `rotate`, `hflip`, `vflip`, `overlay` |
| 亮度、对比度、饱和度、曲线、色温、LUT | `eq`, `curves`, `colortemperature`, `lut3d` |
| 模糊、锐化、噪点、暗角 | `gblur`, `unsharp`, `noise`, `vignette` |
| 绿幕与简单蒙版 | `chromakey`, `colorkey`, `alphamerge` |
| 变速、倒放、定格 | `setpts`, `atempo`, `reverse`, `tpad` |
| 转场 | `xfade`, `acrossfade` |
| 字幕、文字 | `subtitles`, `ass`, `drawtext` |
| 混音、淡入淡出、降噪、均衡、响度、闪避 | `amix`, `afade`, `afftdn`, `equalizer`, `loudnorm`, `sidechaincompress` |

`xfade` 输入必须统一帧率、尺寸、像素格式和 timebase；字幕烧录需包含 libass 的 FFmpeg 构建。某些滤镜支持逐帧表达式或运行时参数，不能假设所有参数均可直接动画化。[xfade 与字幕编译条件](https://ffmpeg.org/ffmpeg-filters.html)

建议首批预设：自然、鲜明、黑白、复古、暖阳、冷蓝、褪色、电影青橙；模糊、锐化、颗粒、暗角、泛光、像素化、RGB 偏移、抖动；淡化、叠化、黑场、白闪、左右擦除、上下推入、圆形展开、像素化转场。名称、参数和缩略图均自行设计。颗粒/泛光/RGB 偏移若预览采用 WebGL，必须提供同效导出路径并抽帧比较。

## 开源集成候选与许可边界

| 候选 | 核实结论 | 采用建议 |
|---|---|---|
| FFmpeg | 主体 LGPL 2.1+，启用某些组件会成为 GPL；官方列出对应源码、构建配置、署名等分发注意事项 | 固定二进制版本及 SHA-256，保存 `-version`、`-buildconf`、许可证与匹配源码；不能仅放一个通用 LICENSE 文件就视为完成分发要求。[官方许可](https://ffmpeg.org/legal.html) |
| gl-transitions | 以 `progress`、from/to 两张纹理构造 GLSL 转场；仓库默认 MIT，个别 shader 文件头可单独规定许可 | 精选转场逐个审查后随包附许可；不要把全部文件默认当 MIT。导出必须接同一 shader 或准确实现映射。[规范](https://github.com/gl-transitions/gl-transitions)、[许可证](https://raw.githubusercontent.com/gl-transitions/gl-transitions/master/LICENSE) |
| whisper.cpp | MIT；Windows、Intel Mac、Apple Silicon 可用，CPU 与多种 GPU 后端；模型需要另行下载 | 后续实现离线自动字幕，默认多语言模型供中文识别；模型按需下载并校验哈希，展示下载体积、运行进度与取消。[官方仓库](https://github.com/ggml-org/whisper.cpp) |
| MLT / frei0r | MLT 有完整编辑多媒体框架；frei0r 提供效果插件，采用前需检查具体模块及插件许可 | 当前轻量架构不同时引入另一套时间线内核；以后若需更成熟原生渲染，可专门评估迁移成本。[MLT 文档](https://www.mltframework.org/docs/)、[MLT COPYING](https://github.com/mltframework/mlt/blob/master/COPYING)、[frei0r COPYING](https://github.com/dyne/frei0r/blob/master/COPYING) |

免费软件与可商用、可再分发是不同条件。集成时针对实际使用版本与具体文件记录授权。剪映的付费滤镜可按公开效果重新实现通用算法，但不提取其专有素材、模型、字体或模板文件。

## 素材库来源

- **优先自制 SVG/Canvas 图形、标题和程序生成背景**：可直接维护源文件、颜色和动画参数，适合首版内置库。
- **Kenney**：官方资产页的游戏素材采用 CC0，可用于商业项目；资产包内仍保留原始许可。不使用其商标作为本项目标识。[Kenney 官方说明](https://kenney.nl/support)
- **Poly Haven**：HDRI、纹理、模型为 CC0，明确允许再分发，可用于背景和材质包；网站示例渲染、文本和商标不在该授权内，下载/接口应遵守其服务与 API 条款。[官方资产许可](https://polyhaven.com/license)
- **Freesound**：按单个声音筛选 CC0，或为 CC-BY 配置完整署名；面向可商用素材库排除 CC-BY-NC。[官方 FAQ](https://freesound.org/help/faq/)
- **Pexels / Pixabay**：可用于成片不等于可打包为自由下载的素材库。Pexels 明确限制作为图库平台再分发；Pixabay 非 CC0 内容适用独立 Content License 和禁止用途。首版不批量内置二者素材，后续按正式 API 与具体用途单独评估。[Pexels 许可](https://www.pexels.com/legal-pages/license/)、[Pixabay 条款](https://pixabay.com/service/terms/)

建议素材索引持久化 `sourceUrl/author/license/licenseUrl/downloadedAt/sha256/redistributionAllowed`，并在工程导出时生成所用素材署名文本。字体应单独纳入许可清单；使用操作系统已有字体时，也要避免未经许可将字体随工程打包。

## Windows 安装包、便携版与 Mac

electron-builder 官方支持 Windows NSIS 安装程序及 portable 单文件程序；portable 提供 `PORTABLE_EXECUTABLE_DIR` 等环境变量。[NSIS 与 portable 文档](https://www.electron.build/docs/nsis/)

建议交付矩阵：

| 系统 | 首批产物 | 本项目的验证要求 |
|---|---|---|
| Windows x64 | `Setup.exe`、`Portable.exe`、便携 ZIP | 干净用户环境启动、导入中文/空格路径、保存重开、导出、取消导出、卸载 |
| Mac arm64 | DMG、ZIP | 在 Apple Silicon CI 构建，真机验证媒体访问和 FFmpeg 启动 |
| Mac x64 | DMG、ZIP | 在对应架构构建并验证，避免只改文件名伪称兼容 |

便携版建议在程序旁 `data` 目录保存设置与缓存：启动极早阶段检测 portable 环境并设置 Electron `userData`。若目录不可写，显示明确错误或让用户选数据目录；素材按项目相对路径归档才能随 U 盘迁移。portable 打包本身不会自动让应用的全部数据便携。

DMG 是 macOS 常见直接下载格式，配套 ZIP 可用于更新交付。[DMG 官方文档](https://www.electron.build/docs/dmg/)

正式 Mac 分发应完成 Developer ID 签名、Hardened Runtime、公证和 stapling；签名与公证是不同步骤，FFmpeg 等随包可执行文件也要纳入签名。没有用户证书时可先产出明确标注的未签名测试版与 CI 流程，不能声称已公证。[electron-builder 公证文档](https://www.electron.build/docs/notarization/)、[Electron 官方签名说明](https://github.com/electron/electron/blob/main/docs/tutorial/code-signing.md)

构建配置必须匹配锁定的 electron-builder 主版本：当前 v27 文档将 Mac 签名字段移动到 `mac.sign`；v26 使用旧字段。不要混抄不同版本配置。[v27 macOS 配置](https://www.electron.build/mac/)、[v26 macOS 配置](https://www.electron.build/v26/docs/mac/)

## 最小可交付验收建议

一段带声音的视频加图片和中文字幕，分割、移动、变速，添加位置/缩放/透明度关键帧、两种滤镜和一个转场；保存关闭再打开后结果不变；导出 MP4 并核对开头、中段、关键帧端点、转场中点和结尾。另测纯音频、竖屏、无音轨、中文路径、失联素材和取消导出。界面中的每个已标为可用功能都应能完成此闭环。
