---
name: shuiguan-cut
description: 使用水管剪辑（FreeCut）真实桌面应用剪辑本地素材，生成可继续编辑的 .freecut 工程并导出 MP4；适用于指定本软件或需要其工程文件的视频剪辑任务。
---

# 水管剪辑

把用户的本地视频、图片、音频和文案整理成配方，通过本软件真实导入、打开工程、保存和导出。交付 `.freecut` 工程与 MP4。这里的自动化只接管新建的独立应用进程及其文件对话框，最终画面由产品 Canvas 渲染器逐帧合成、由产品 FFmpeg 导出。

用户指定水管剪辑时使用此路径，不用其他剪辑器或独立 FFmpeg 合成脚本替代最终导出。不修改产品主程序、导出器或安全校验来让配方通过。素材分析、生成原创输入素材和成片解码检查可以使用其他工具。

## 运行

1. 定位水管剪辑源码仓库：需包含 `package.json`、`src/core/project.ts`、`electron/main.cjs`、本机 `node_modules` 和已准备的 FFmpeg。Skill 本身不携带运行时或模型。先运行：

   ```text
   node <skill-dir>/scripts/shuiguan-cut.cjs doctor --repo <repo-dir>
   ```

   源码模式还需要先按仓库说明完成 `npm run build`。已有安装版可追加 `--exe <FreeCut.exe或FreeCut.app/Contents/MacOS/FreeCut>`；仍需 `--repo` 提供 Playwright、TypeScript 和同版本工程模型。二者版本必须一致。无需也不应连接用户正在使用的窗口。

2. 阅读 [配方与工程约定](references/recipe.md)，创建 UTF-8 JSON 配方。明确剪辑起止、画幅、字幕/文字与输出要求；不要替用户添加默认作者昵称、水印、宣传语或赞助内容。相对素材路径以配方所在目录为准。

3. 指定**尚不存在且父目录已存在**的输出目录：

   ```text
   node <skill-dir>/scripts/shuiguan-cut.cjs edit-render --repo <repo-dir> --recipe <recipe.json> --out-dir <new-output-dir>
   ```

   可加 `--exe`、`--timeout 1800`。脚本不覆盖旧输出、不下载依赖/模型、不改变既有工程。失败时查看 `report.json`、`failure.png`；修正配方后用新的输出目录重试。保留已生成的工程，不把失败导出报告为成功。

4. 确认 `report.json.passed === true`，查看预览/成片并核对用户指定的剪辑与文案。脚本已检查真实应用版本、媒体导入、成片完整解码、时长和尺寸，但这些检查不证明叙事、字幕准确率或所有画面的质量。需要看片时检查实际 MP4，而不是只看配方。

交付 `project.freecut`、`render.mp4` 及必要说明。`project.freecut` 引用原素材的绝对本地路径，移动到其他电脑时需同时提供合法素材并重新链接；它不是内嵌素材包。`recipe.json` 使用解析后的绝对素材路径，便于复跑。`.session/` 是本次自动化的独立配置与诊断目录。

## 能力边界

已实现本地素材剪切与拼接、按层叠加、文字、色块、位置/统一缩放/旋转/透明度/音量关键帧、固定变速、淡入淡出和基础声道参数。导出 MP4（H.264/AAC），支持产品界面现有的 720p/1080p/2160p 与 24/25/30/50/60 fps。

此版配方桥接尚未自动操作蒙版/调色、转场、曲线变速、AI 模型下载、ASR/TTS 或复杂时间线交互；用户需要这些时明确当前桥接边界，可在原应用中继续编辑保存的工程。不要把本软件全部功能都说成这个脚本已经支持。脚本拒绝未知字段，避免静默忽略要求。

本软件产品政策为“全部功能永久免费，不设会员不设付费解锁”；自愿赞助不影响功能。该政策不会更改第三方素材或可选模型自己的许可。

## 自检

```text
node <skill-dir>/scripts/shuiguan-cut.cjs demo --repo <repo-dir> --out-dir <new-demo-dir>
```

它用本地数学图形与正弦波生成原创输入素材，再通过实际应用剪成 5 秒含文字、关键帧和音频的短片。`original-source.mp4` 是输入测试素材；只有 `render.mp4` 才是产品真实导出的结果。
