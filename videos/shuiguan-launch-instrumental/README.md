# 水管剪辑 · 无声无逐句字幕版

本工程是 `../shuiguan-launch` 的独立视觉变体，保留七个场景原有的 55 秒时轴，以及主文案和 **@我叫水管同学** 水印。没有配音、音乐、音效或逐句字幕层；软件真实截图内的示例文字和功能名称仍是原画面的一部分。

视觉素材输出：`renders/shuiguan-launch-silent-1080p.mp4`，1920×1080、30 fps、55 秒。最终媒体参数与校验值见 `QA.md`。此文件供水管剪辑 Skill 实际编辑并导出；用户之后自行添加音乐。

本次仅复制必要 HTML、图片、字体、GSAP 与完整许可，不复制原项目渲染结果、缓存、node_modules、旁白、音乐或字幕文件。`SOURCE-PROVENANCE.json` 记录复制源的哈希，`assets/manifest.json` 固定视觉资产。

## 复现

先读取 `CLI-VERSION.md` 中实际探测与验证的 CLI 版本。`npm run check` 执行完整检查，`npm run render -- --quality high --workers 4 --no-low-memory-mode --output renders/shuiguan-launch-silent-1080p.mp4` 渲染现有工程。首次运行可能联网取得 CLI 与浏览器运行时。可仅对渲染子进程设置独立 TEMP/TMP，避免系统盘空间不足。

`node scripts/prepare-source.cjs` 是从旁边原项目重新派生的构建脚本，会覆盖本变体的初始源文件；已有独立编辑不应再次运行它。正常重渲染不需要原项目，不需要语音引擎或 AI 模型。

## 许可与文案

水管剪辑全部功能永久免费，不设会员、不设付费解锁，导出无水印。爱发电自愿赞助，不影响任何功能；第三方 AI 模型许可只约束使用范围。

原创工程对应 GPL-3.0，完整文本在 `LICENSE-GPL-3.0.txt`。GSAP、Noto 字体和框架依赖保留各自许可，不被项目 GPL 重新许可。详见 `SOURCES.md`。
