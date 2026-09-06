# 0.1.0 验证记录

本记录区分源代码测试、实际桌面交互和原生模型推理。一次成功不代表所有素材、硬件或长项目均已验收。

## Windows 开发环境

2026-09-06，Windows x64、Electron 44.2.0。当前源代码通过：

- `npm test`：51 项编辑核心测试、24 项桌面宿主测试，全部通过，未跳过。包括关键帧缓动和裁剪、分割淡变连续性、SRT、工程验证、下载与归档安全、取消和真实 H.264/AAC 输出。
- 真实 FFmpeg 解析 1000 个音量关键帧，并按音频样本检查全部五种缓动、保持跳点和区间边界。FFmpeg 6.1.1 与 9.0.1 均通过。
- `npm run build`：TypeScript 和生产构建通过。
- `scripts/smoke-desktop.cjs`：真实桌面导入生成的视频素材，添加缩放关键帧与中文文字，保存及重开工程，输出并解码 720p/24fps MP4；渲染页面错误为空。既可针对开发应用，也可用 `FREECUT_TEST_EXE` 指向实际打包应用。
- `scripts/regression-editor.cjs`：键盘撤销及重做、手机布局检查器的关闭按钮和 Esc、锁轨编辑保护、带关键帧及淡变的时长缩短与保存重开、错误类型/过短素材拒绝及兼容素材重连，5 组均通过。Mac 临时目录的 `/var` 和 `/private/var` 别名以实际规范路径比较。
- npm 依赖审计：当日报告 0 个已知漏洞；这不代替完整安全审计。

桌面测试使用独立测试配置和本地产生的素材。视频烟雾测试产物位于忽略的 `artifacts/smoke/`；编辑回归使用新的系统临时目录。

## 可选语音模型

原生 sherpa-onnx 在真实 Electron 子进程中测试，已解决 Electron 外部 ArrayBuffer 兼容问题。SenseVoice 完成中文和英文录音识别；Whisper tiny 完成英文识别，中文表现较弱；AISHELL-3 VITS 完成中文 WAV 合成和取消。可复现实测脚本为 `scripts/smoke-ai.cjs`，默认禁止网络下载。

Windows 桌面面板另行完成 AISHELL 生成/试听/加入音轨、SenseVoice 识别/编辑/加入字幕轨道、保存工程；音频引用和字幕时间均正确，控制台无错误。原识别存在“测试→设施”的误字，已校对后加入字幕。

ChatTTS 完成独立 Python 和 CPU 依赖准备、全部模型 SHA-256 校验、真实 WAV 自检、再次合成与媒体导入。已修复 Windows 隔离 Python 对中文输入的编码问题；测试文本“你好，这是自由剪辑的真实语音测试。”由 SenseVoice 转写并核对一致。可复现脚本为 `scripts/smoke-chattts.cjs`，模型和结果报告保存在显式指定的外部数据目录。实际桌面面板也完成生成、2.91 秒音频试听、加入时间线与工程保存，生成文件散列与内容核验样本一致。

语音质量与每段内容仍需要试听、校对。ChatTTS 模型许可限非商业用途；AISHELL-3 权重许可状态见模型文档。Mac 的可选语音模型推理尚未完成设备验收。

## 平台分发

首轮 [Actions 构建 34034700514](https://github.com/Watertube-bilibili/freecut-desktop/actions/runs/34034700514) 已证明 Windows x64、Mac arm64、Mac x64 均可从固定 FFmpeg/x264/zlib 源码构建引擎，通过当时测试并生成安装包及源码归档。

最终 [构建 34037318468](https://github.com/Watertube-bilibili/freecut-desktop/actions/runs/34037318468) 对应 `9a9ac1066134b0ffaebef4dcdc742f048f525f58`，三个平台全部成功，包括 75 项核心/宿主测试、5 组编辑回归及实际打包程序的导入、关键帧、工程保存重开和 MP4 导出。发布工作流核验三平台源码一致性、引擎源码散列及所有上传文件后，已公开 [v0.1.0-preview.1](https://github.com/Watertube-bilibili/freecut-desktop/releases/tag/v0.1.0-preview.1)，共 14 份文件。

最终 Windows 便携 EXE 另行下载到本机，实际启动确认随包引擎存在、便携模式启用、旁边的 `FreeCutData` 创建成功，关闭再打开后布局与引导状态均保留。

Windows 包未配置代码签名；Mac 包使用临时签名，未配置 Developer ID 和 Apple 公证。尚未完成完整安装/卸载矩阵、4K 长片压力、所有输入编码和所有机器的 GPU/CPU 组合测试。
