# 最终成片验收 · 2026-09-07

本记录对应最终更正版：作者昵称 **我叫我水管同学**，全片水印 **@我叫我水管同学**，软件品牌 **水管剪辑**。开场、封面与旁白采用“全部功能永久免费”，画面明确“不设会员 · 不设付费解锁”。爱发电为自愿赞助，不影响任何功能。

## 交付文件

- 视频：`renders/shuiguan-launch-1080p.mp4`，7,727,569 bytes（约 7.4 MiB）。
- 1920×1080，30 fps，1650 帧，精确 55.000 秒，H.264 / AAC，48 kHz 双声道。
- 封面：`renders/shuiguan-launch-cover.png`，1920×1080。
- 字幕：`renders/shuiguan-launch.zh-CN.srt`，14 条，末条结束 53.898 秒，编号连续、无重叠、无越界。
- 视频 SHA-256：`2f0751a93a06673a4092d1e958cd4888af3265cc210af2a68a28efab2372d3be`。

## 实际验证

1. HyperFrames 0.8.30 在 23 个时间点执行 check：lint 0 错误 / 0 警告，runtime、layout 和 contrast 全部通过。检查了 1 条标点遮罩边界警告与 1 条入场动画信息，成片抽帧可读；报告见 `renders/hyperframes-check.json`。
2. 正式渲染使用 D 盘任务专用临时目录、4 workers、高画质；2 分 16.7 秒完成。日志见 `renders/render-console.log`。只设置渲染子进程 TEMP/TMP，未修改用户全局环境。早期磁盘空间不足的尝试在抓帧前停止；旧昵称产物已隔离到被 Git 忽略的 .hyperframes/obsolete-nickname，不属于本次交付。
3. FFmpeg 使用 -xerror 完整解码实际 MP4，1650 帧全部成功；blackdetect 未检出持续至少 0.05 秒的黑屏段。FFprobe 与结果汇总见 `renders/media-probe.json`、`renders/verification-summary.json`。
4. 实际 MP4 抽取整片联系表及 9 张重点图，逐图检查开场免费承诺、全名水印、出品署名、关键帧截图说明、双布局、功能清单、字幕底边和最终 CTA，无文字裁切或主体遮挡。联系表见 `renders/decoded-contact-sheet.png`，重点图为 decoded-*.png。新封面已独立重渲染和检查。
5. 对最终混音按 7 个镜头使用已有本地 SenseVoice 识别。7 段均保留对应完整中文语义；最后一段正确识别“关注我叫我水管同学”“爱发电自愿赞助，不影响任何功能”。GPT-6 / Codex 的转写大小写与同音字属于 ASR 表记差异；结果原文见 `renders/final-audio-asr-qa.json`。没有下载模型或使用付费语音服务。
6. EBU R128 实测综合响度 -20.4 LUFS、响度范围 7.9 LU、真峰值 -1.1 dBFS。音乐经过人声频段避让和音量包络处理，无削波；未为追求更大响度额外限制动态。

## 复现与边界

`node scripts/verify-output.mjs` 执行媒体/字幕/完整解码/响度/抽帧检查。`scripts/verify-narration.cjs --final` 需要显式指定现有 FREECUT_AI_QA_CACHE，默认不会下载或安装模型。资产与输出哈希见 `assets/manifest.json` 与 `renders/SHA256SUMS.txt`。

本次听觉核对是实际混音的自动 ASR 加波形/响度分析，不冒称真人试听或专业配音。系统合成语音会保留合成感。软件画面为真实截图，镜头明确标为截图演示；手机风格指桌面应用内的布局。全部功能免费是软件收费承诺，第三方模型许可只约束使用范围，并非收费例外。未上传视频、未发布 B站内容或自动赞助。
