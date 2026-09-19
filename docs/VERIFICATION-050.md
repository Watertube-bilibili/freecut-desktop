# FreeCut 0.5.0 验证记录

日期：2026-09-19。已发布版本 `0.5.0`，标签 `v0.5.0-preview.1`。本文记录工作台与导出重构的实际验证范围及发布结果。

## 改动与来源

- 专业工作台可调整素材库、属性栏宽度和时间线高度；可收起面板、重置布局，设置跨次启动保存。素材类型筛选/排序、适合全片、刀片和逐帧操作接入原工程/撤销系统。
- 从 Concat（原 WolfCut）固定提交移植贝塞尔求值以及居中放置、旋转边界的算法，保留原 GPL 与派生 AGPL 声明。具体来源和修改见 [集成记录](WOLFCUT-INTEGRATION.md)。没有引入完整 Rust/Slint 应用、上游字体或新的 GPU 编码器。
- 原生导出从单一无变换片段扩展到符合条件的多视频/图片叠层、静态变换、位置关键帧和淡化。安全的文字/色块只绘制一次透明 PNG，视频连续解码，音频仍按原工程混合。
- 复杂蒙版/调色、动态缩放/旋转/透明度、未对齐帧边界、交叠淡化等保留 Canvas 路径。带底色或描边的文字在淡化/半透明时也保留原路径，避免改变原工程的逐次绘制透明度。
- 修复 Chromium 对微秒时间截断导致严格导出偶尔取到前一帧：例如 30 fps 的第 113 帧曾取得第 112 帧。新旧渲染路线使用同一目标帧核对。

## 本机验证

Windows x64，真实 Electron 44 桌面应用，隔离临时配置和自产测试素材。没有打开用户工程、搬移模型或修改现有安装。

| 范围 | 证据 / 结果 |
| --- | --- |
| 核心单元测试 | 134 项通过；旧工程、关键帧、分割、音频、蒙版、协作合并和语言 |
| 宿主与安装器 | 全套 `npm test` 通过；随后新增文字透明度保护的定向测试通过。Windows 不运行 macOS 更新实机用例；MP3 的可选测试素材编码器未打入当前 FFmpeg，二者为明确跳过项 |
| 原生导出专项 | `export.test.cjs`、`export-pipeline.test.cjs`、`native-export.test.cjs`、`native-layers.test.cjs` 共 25 项通过；实际 FFmpeg 像素、音频、帧数、分辨率/画质差异、损坏 PNG、取消和并发准备清理 |
| 新工作台 | 7/7 通过：真实指针分隔条、面板折叠/重置、三类素材、时间线适配、刀片撤销、逐帧、贝塞尔保存、中英与手机布局；[去除机器路径的报告](verification/050-workbench.json) |
| 既有编辑功能 | editor、context-menu、transform、language、home、keyframes、audio、sounds、effects、update、voice-storage、collaboration-ui、timeline-gesture、media-kind 回归通过 |
| 连续预览 | `regression-preview.cjs` 与 `regression-preview-playback.cjs` 通过；两种实际编辑器布局均显示不断变化的帧号，暂停/离开编辑器后解码器停止 |
| 来源记录 | 13 个固定上游原始文件 SHA-256 和 3 份原文许可/政策副本核对；派生模块及打包规则包含完整声明 |

语音模型没有重新下载或重新进行跨平台推理验收；本次验证模型目录和工具的界面/宿主流程保持可用。异地协作的历史公网测试仍属于 0.4.1，本次进行了本机双应用协作回归，不能当作所有网络重新验收。

工作台最终检查生成 6 张真实截图；其中[中文桌面](screenshots/editor-050.png)、[手机风格](screenshots/mobile-050.png)和[英文桌面](screenshots/editor-en-050.png)已随仓库保存。1100×620 短窗口的素材区高度约 167.67 px，首行素材与导入按钮均可见；英文导出在短窗口中可访问。原报告时间为 2026-09-19T07:34:31.996Z 至 07:34:51.264Z，未出现 renderer errors。

## 导出对照样本

脚本：[regression-compositor.cjs](../scripts/regression-compositor.cjs)。同一 4 秒、640×360、30 fps 工程，包含真实运动视频和立体声音轨、旋转半透明色块、贝塞尔位置动画标题、淡入淡出。标题无底色且无描边，属于本次可安全一次性栅格化的范围。两个路径均生成实际 MP4；测试包含 PNG 准备时间。

| 路径 | 本机耗时 | 文件大小 |
| --- | ---: | ---: |
| 新原生多层合成 | 878 ms | 545,312 bytes |
| 兼容 Canvas 逐帧路径 | 4,095 ms | 530,962 bytes |

这是一组短样本的单次结果，不是跨设备基准，也不保证所有工程同样提速。编码差异和 Canvas/FFmpeg 抗锯齿不同，因此不要求输出文件逐字节相同。对照第 6、39、87、113 帧，RGB 平均绝对差分别约 2.13、2.18、2.34、2.44（每通道 0–255）；全部通过预设容差。文字样式回退、准备期间取消和伪造栅格片段引用另有验证。

## 发布状态

[v0.5.0-preview.1 Release](https://github.com/Watertube-bilibili/freecut-desktop/releases/tag/v0.5.0-preview.1) 已于 2026-09-19T08:06:38Z 发布。程序和源码对应提交 `ba10234fbf108f5f1ca0ba7e71c1e619eda82f8e`。

- [三平台构建](https://github.com/Watertube-bilibili/freecut-desktop/actions/runs/35430332374)成功：Windows x64、Mac arm64、Mac x64。CI 完成完整测试、真实编辑器回归、打包应用启动/媒体导出与协作组件检查；Windows 另完成实际 Setup 安装、已安装应用和卸载验证，Mac 两种芯片均检查真实更新 ZIP。
- [发布流程](https://github.com/Watertube-bilibili/freecut-desktop/actions/runs/35431042517)核对匹配源码、三平台产物与每项 SHA-256 后公开 15 个文件：六个应用包、对应应用与 FFmpeg 源码、许可说明、双语教程和校验清单。
- Windows Setup、Portable、双语教程和 SHA256SUMS 已从公开 Release 回下载，文件大小与 GitHub digest、清单散列一致。解开回下载的 Portable 后，实际算法模块与对应 Git 提交逐字节匹配；resources/licenses/concat 下四份上游许可/来源文件也逐字节一致。证据见 [发布和下载核对](verification/050-release.json)。
- 本机源码打包应用和回下载的正式 Windows 包均使用隔离配置运行真实桌面媒体导入、保存工程及 MP4 导出，无渲染器错误。没有覆盖用户现有安装或工程。

构建过程保留两项说明：初轮特殊路径测试复制程序时漏带新增 shared 目录，已补齐复制清单，最终构建包含该修复。第二轮 Windows 英文退出测试曾在保存 IPC 返回前请求关闭，被应用正常的保存中保护取消；同提交重跑 Windows 后全部通过，Mac 两个平台首轮通过。测试脚本随后补上正确的英文提示文案及保存完成/未保存状态等待，本机 10/10 通过；该测试同步改进随发布说明提交，不改变上述发行包的生产代码。没有删除断言、放宽画面容差或跳过失败用例。
