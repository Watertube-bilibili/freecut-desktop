# 水管剪辑 · 55 秒发布宣传片

这是独立于应用安装包的 HyperFrames 0.8.30 视频工程，包含 7 个可编辑 HTML 镜头、中文旁白、原创合成音乐、真实应用截图和本地中文字体。主文件为 `index.html`；分镜与脚本分别是 `STORYBOARD.md`、`SCRIPT.md`。

最终产物位于 `renders/`：

- `shuiguan-launch-1080p.mp4`：1920×1080、55 秒、H.264/AAC。
- `shuiguan-launch-cover.png`：1920×1080 封面。
- `shuiguan-launch.zh-CN.srt`：逐句中文字幕。
- `verification-summary.json`：成品参数、全片解码、黑帧与响度检查。
- `final-audio-asr-qa.json`：最终混音中的全部 7 段旁白识别核对。

```powershell
cd 'D:\free open cut\videos\shuiguan-launch'
npm ci
npm run check
npx --yes hyperframes@0.8.30 preview --background
npx --yes hyperframes@0.8.30 render --skill=product-launch-video --quality high --output renders/shuiguan-launch-1080p.mp4
node scripts/verify-output.mjs
```

常规并行渲染需要约 14 GB 的临时抓帧空间。本机最终使用独立 D 盘临时目录、4 个 worker；只为渲染子进程设置 `TEMP` 和 `TMP`，不修改用户全局环境。如果临时盘空间不足，可以给 render 添加 `--low-memory-mode`，以单 worker 边抓帧边编码。检查脚本需要本机 PATH 中的 FFmpeg 与 FFprobe，会完整解码成品并输出采样图，不会下载工具或修改源视频。

正常重渲染直接使用已生成 WAV，不需要登录服务、下载 AI 模型或使用微软语音组件。重新合成旁白需要 Windows 已安装 Microsoft Huihui Desktop，执行 `scripts/create-voice.ps1`；随后 `node scripts/build-audio.mjs` 重建时序和原创音乐。若改变语音内容或时长，应同步字幕、分镜长度及镜头动画，不能只替换 WAV。

`scripts/finalize.mjs` 用于在安装了对应 HyperFrames 技能脚本的作者电脑上重新组装镜头、挂载全片作者水印并分析音乐的人声避让。它不是重渲染现有 `index.html` 的必要步骤。`scripts/verify-narration.cjs` 是可选的本机 ASR 质量检查，需要仓库中现有 Electron 和已下载模型缓存；不默认联网、不随成片分发模型。

GSAP、Noto 字体、HyperFrames 及其依赖保留各自原许可；根仓库应用代码的 GPL 不覆盖这些第三方文件。此目录只用于制作宣传视频，不作为可视化剪辑器运行时功能。完整来源、许可文本位置及宣传边界见 `SOURCES.md`；实测质量结果见 `QA.md`。成品 MP4、构建缓存和工作代理日志不进入 Git。

作者 B 站昵称为「我叫水管同学」，全片水印为 @我叫水管同学。水管剪辑承诺全部功能永久免费，不设会员、不设付费解锁，导出无水印。爱发电是自愿赞助，不影响任何功能；第三方模型许可只约束使用范围，并非收费例外。
