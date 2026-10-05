# 让 AI 使用水管剪辑剪片

`shuiguan-cut` 是给 Codex 等支持本地 Skill 的 AI 使用的剪辑入口。AI 将素材与剪辑要求写成配方，再操作水管剪辑的真实桌面进程，保存 `.freecut` 工程并从应用导出 MP4。

它适合本地素材的剪切、拼接、叠加、文字、位置/缩放/旋转/透明度/音量关键帧、固定速度、淡入淡出和基础声道设置。当前桥接尚未自动操作蒙版、滤镜、转场或语音模型；这些内容可以继续在水管剪辑中编辑。软件功能免费，Skill 也免费，没有会员或付费解锁。

## 安装 Skill

从本仓库的 `skills/shuiguan-cut` 获取文件夹，或从[独立开源仓库](https://github.com/Watertube-bilibili/shuiguan-cut-skill)的 [v0.6.0 Release](https://github.com/Watertube-bilibili/shuiguan-cut-skill/releases/tag/v0.6.0) 下载 `shuiguan-cut.zip` 并解压。将完整的 `shuiguan-cut` 文件夹放到 Codex 的技能目录；若已有同名 Skill，先保留旧文件夹作为备份：

- Windows 默认是 `%USERPROFILE%\.codex\skills\shuiguan-cut`。
- Mac 默认是 `~/.codex/skills/shuiguan-cut`。
- 配置了 `CODEX_HOME` 时，放到该目录下的 `skills/shuiguan-cut`。

让 AI 在后续会话中使用 `$shuiguan-cut`。其他支持 Skill 的工具可以读取同一份 `SKILL.md`，但需要能够运行本地 Node 脚本。

此版需要同版本水管剪辑源码仓库及其开发依赖（Node.js 22.12 或更新版、Playwright、TypeScript、Electron 和已准备的 FFmpeg）。按仓库 README 完成 `npm ci`、运行时准备与 `npm run build`；Skill 压缩包不携带这些运行环境。已有安装版可用 `--exe` 指向实际应用可执行文件，但仍需 `--repo` 提供同版本工程模型和自动化依赖。

2026-10-05 的独立 Skill v0.6.0 对应 FreeCut 0.6.0，桥接已包含产品现有的 1440p 档位，可导出 16:9 的 2560×1440 视频。720p、1080p、1440p、2160p 均沿用产品的短边尺寸规则和最大 3840 像素限制，不会修改导出器或绕过工程校验。产品自动选择合适的原生 FFmpeg 或 Canvas 合成路径。[Windows 打包应用的 1440p 实测摘要](verification/skill-060.json)记录了实际导入、14 段拼接、保存工程、导出和完整解码结果，仅含匿名技术参数，不含用户的素材、路径或工程。

## 给 AI 的示例要求

> 使用 $shuiguan-cut，把我提供的两个视频各剪 3 秒拼在一起，添加“周末记录”标题，让标题淡入，原声调到 50%。导出 720p MP4，并保留能在水管剪辑中继续打开的工程。素材在我指定的文件夹，输出到一个新目录。

AI 应先运行环境检查，再按 [配方文档](../skills/shuiguan-cut/references/recipe.md) 执行剪辑：

```text
node <skill-dir>/scripts/shuiguan-cut.cjs doctor --repo <repo-dir>
node <skill-dir>/scripts/shuiguan-cut.cjs edit-render --repo <repo-dir> --recipe <recipe.json> --out-dir <new-output-dir>
```

运行结果包括 `project.freecut`、`render.mp4`、`preview.png`、`recipe.json` 和 `report.json`。工程引用源素材，不内嵌视频文件；换电脑时需携带素材并重新链接。查看成片后再交付，不把自动检查当作字幕或创作质量的保证。

实际使用中发现 FreeCut 0.6.0 的一个边界问题：24 fps 原生导出在部分循环小数时间切点可能出现单帧黑画面，完整解码和帧数检查本身不会发现它。应对照原素材检查切点；可用原素材对应帧制作短补片，再通过真实应用合成修正。此处记录的是应用导出器的已知问题，不代表 Skill 已修复产品主程序，也不能仅凭 `report.json.passed` 宣称画面质量全部通过。

脚本使用独立应用配置，不接管用户已有窗口，不覆盖旧输出，不自行下载模型。导出由水管剪辑自己的 Canvas / FFmpeg 流程完成；外部 FFmpeg 仅用于生成自检输入与分析输出。Skill 不会给普通用户的作品强制添加作者水印或宣传语。

首支软件宣传片使用 HyperFrames 制作。[55 秒中文无声版](../videos/shuiguan-launch-silent-edit) 已使用这个 Skill，经水管剪辑 0.3.0 真实导入、分成七段、保存工程并导出；最新的 [55 秒英文无声版](../videos/freecut-launch-en-edit) 则由 FreeCut 0.3.1 实际组装与导出。两版视觉动画来自各自的 HyperFrames 源工程，最终成片均全量检查静音。之后本项目的宣传片继续优先使用水管剪辑和这个 Skill，遇到桥接尚不支持的效果时明确说明实际制作方式。
