# 水管剪辑宣传片：来源与许可

本项目为约 55 秒、1920×1080 横屏宣传片。对外主品牌为「水管剪辑」，作者为「我叫我水管同学」。FreeCut 是当前仓库与可执行文件保留的项目代号。本片未冒用任何竞品界面、图标、模板、音效或滤镜包。

| 内容 | 来源 | 许可与使用说明 |
| --- | --- | --- |
| 3D 图标 | 仓库 `resources/icon.png` | 本次项目内置图像生成工具生成的原创图像，沿用项目代号 F。 |
| 4 张应用截图 | `docs/screenshots/*-030.png`，可由 `scripts/capture-showcase.cjs` 重现 | 真实运行的水管剪辑 0.3.0。几何场景、节拍和字幕为本项目原创示例。没有重绘或虚构软件界面；所称手机风格是桌面软件内布局，不表示已经发布原生手机应用。 |
| 中文旁白 | 本机已安装的 Microsoft Huihui Desktop / Windows SAPI | 原创脚本由系统语音离线合成；仅交付生成的 WAV，不附带或重分发微软语音引擎、字典和模型。没有使用 ChatTTS 非商业模型权重，也没有克隆真人声音。系统语音组件本身仍适用其微软许可，本说明不把第三方组件另行许可。 |
| 背景音乐 | `scripts/build-audio.mjs` | 原创确定性合成：110 BPM，A 小调和弦进行，正弦低音、拨弦波形、合成鼓与噪声镲。没有采样录音和第三方音乐素材。源脚本随项目开放。 |
| 中文字体 | [Noto Sans CJK 官方仓库](https://github.com/notofonts/noto-cjk/tree/main/Sans) | NotoSansSC Regular / Bold，SIL Open Font License 1.1；原始许可见 `assets/fonts/LICENSE-NOTO.txt`。直接下载自 notofonts/noto-cjk 主分支中的 Sans/SubsetOTF/SC；本地文件固定、渲染不联网取字体。 |
| HTML 视频框架 | HyperFrames 0.8.30 | 此项目单独锁定版本；包许可随依赖提供。基础创意采用已安装 product-launch-video / creative-mode，镜头独立可编辑。 |
| 品牌落版动效参考 | HyperFrames Registry `logo-sting` | CLI 官方组件，源文件保留于 `compositions/components/logo-sting.html`，第 2 镜借用其落位与冲击环节奏并换为本产品原创素材。 |
| 动画运行时 | GSAP 3.14.2 | 原始压缩文件固定保存于 `assets/vendor/gsap.min.js`，来源 jsDelivr 的官方 npm gsap 包；遵循 [GSAP Standard License](https://gsap.com/standard-license/)，已附官方完整许可文字 `assets/vendor/LICENSE-GSAP.txt`。不冒称自主开发此库。 |

GPT-6 和 Codex 仅以文字描述制作者使用的工具，不使用 OpenAI 标志，不表示 OpenAI 官方出品或背书。用户要求的「全部功能永久免费、无水印导出」是项目方向与当前全部功能免费承诺；本片没有承诺与剪映所有功能相同，也没有将所有第三方 AI 模型宣称为可任意商用。

本目录是独立的宣传片制作工程，不是水管剪辑应用的运行时代码或安装载荷。GSAP、Noto 字体和框架依赖保留各自许可；根仓库应用代码的 GPL 许可不重新许可或覆盖这些第三方文件。特别是 GSAP 不应从此宣传工程直接搬入一个可视化动画编辑器，需另行确认其用途是否符合许可。

最终 CTA 使用真实仓库 [Watertube-bilibili/freecut-desktop](https://github.com/Watertube-bilibili/freecut-desktop)、B站 UID 390310418 与「下载地址见简介」。爱发电仅有支持创作文案；用户没有提供个人爱发电地址，所以本片没有二维码、付款信息或假链接。

旁白字幕采用逐句合成的真实 WAV 时长定位，不宣称强制对齐的逐字时间戳。另以现有本地 SenseVoice 对最终混音中的全部 7 段旁白执行识别核对，结果见 `renders/final-audio-asr-qa.json`；ASR 核对不等同于真人试听。最终音视频解码与采样检查会单独记录在 QA.md。

作者 B 站昵称为「我叫我水管同学」，全片水印为 @我叫我水管同学。水管剪辑承诺全部功能永久免费，不设会员、不设付费解锁，导出无水印。爱发电是自愿赞助，不影响任何功能；第三方模型许可只约束使用范围，并非收费例外。
