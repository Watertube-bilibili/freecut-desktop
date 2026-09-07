# 最终成片验收 · 2026-09-07

本记录对应最新准确昵称 **我叫水管同学**，全片水印 **@我叫水管同学**，软件品牌 **水管剪辑**。开场、封面与旁白采用“全部功能永久免费”，画面明确“不设会员 · 不设付费解锁”。爱发电是自愿赞助，不影响任何功能。

## 最终文件

- 视频：`renders/shuiguan-launch-1080p.mp4`，7,713,883 bytes（约 7.36 MiB）。
- 1920×1080，30 fps，1650 帧，精确 55.000 秒，H.264 / AAC，48 kHz 双声道。
- 封面：`renders/shuiguan-launch-cover.png`，1920×1080。
- 字幕：`renders/shuiguan-launch.zh-CN.srt`，14 条，最后结束 53.751 秒，编号连续、无重叠或越界。
- 视频 SHA-256：`8ec7351cd013666f80e3ec2b46019fd56c444bd065bc355a75599d4acf44af2f`。

## 实测结果

1. HyperFrames 0.8.30 在 23 个时间点执行 check：lint 0 错误 / 0 警告，runtime、layout 和 contrast 通过。对标点遮罩边界警告、入场动画信息进行画面复核，稳定画面中的文字可读。报告见 `renders/hyperframes-check.json`。
2. 本次正式渲染使用 D 盘任务临时目录、4 workers 和 high 画质，耗时 2m 0.3s。只为渲染子进程设置 TEMP/TMP，未修改用户全局环境。完整日志为 `renders/render-console.log`。旧昵称 MP4、ZIP 和报告已移出交付目录，保存在被 Git 忽略的工作缓存中；本记录只对应上述新哈希。
3. FFmpeg 使用 -xerror 完整解码真正的 MP4，1650 帧全部成功；blackdetect 未检出持续至少 0.05 秒的黑屏段。FFprobe 和汇总见 `renders/media-probe.json`、`renders/verification-summary.json`。
4. 从最终 MP4 抽取整片联系表与 9 张重点画面，检查免费承诺、完整昵称水印、出品署名、关键帧截图说明、双布局、功能清单、字幕底边及最终 CTA。文字没有裁切或遮挡主体。联系表见 `renders/decoded-contact-sheet.png`；新封面另行实际渲染并检查。
5. 使用已有本地 SenseVoice 对最终混音按 7 个镜头识别。所有片段保留完整中文语义，最后一段识别为“下载地址见简介，关注我叫水管同学爱发电自愿赞助，不影响任何功能。”。GPT-6 / Codex 的 ASR 大小写及同音字为表记差异，原始输出见 `renders/final-audio-asr-qa.json`。本次没有下载模型或使用付费语音服务。
6. 实测综合响度 -20.4 LUFS、响度范围 7.9 LU、真峰值 -1.0 dBFS。原创音乐进行了人声频段避让和音量包络处理，没有削波。

## 复现与边界

`node scripts/verify-output.mjs` 检查媒体参数、字幕内容/边界、完整解码、响度及抽帧。`scripts/verify-narration.cjs --final` 需要明确设置现有 FREECUT_AI_QA_CACHE，不会默认下载或安装模型。资产和成品校验值在 `assets/manifest.json` 与 `renders/SHA256SUMS.txt`。

听觉核对采用真实混音的自动 ASR 和响度分析，不冒称真人试听或专业配音；系统语音保留合成感。软件画面是真实截图，并明确标注截图演示。手机风格指桌面应用内布局。全部功能免费是软件收费承诺；第三方模型许可只约束使用范围，并非收费例外。未上传或公开发布本片。
