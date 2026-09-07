# 可选本地字幕与中文朗读

FreeCut 的 AI 工作室按需下载开源语音引擎及公开模型。初始安装包不包含模型；用户点击“一键下载安装”后才访问下载站点。安装后，识别和朗读在本机 CPU 子进程中执行，不上传文字、视频或音频。

## 使用

1. 自动字幕：在时间轴选择一个有音轨的视频或音频片段，打开“字幕与语音 → 自动字幕”，首次下载组件，选择中文/英语/自动检测，然后识别。结果可以校对文字，再加入字幕轨道。
2. 语音朗读：打开“语音朗读”，首次下载 AISHELL-3，输入中文、选音色与语速、生成；试听后在播放头位置加入音频。
3. 下载或推理失败可以重试；处理中可以取消。0.3.0 的大文件按 4 MiB 分段请求，连接中断保留下载前缀供续传；完成后复验完整散列。校验失败会重新下载该文件，已校验完整文件复用。用户主动取消会清理当前未完成文件。
4. 缓存位于 Electron `app.getPath('userData')/ai`。生成的朗读 WAV 保存在其中 `speech` 子目录，项目引用该文件，不要手工移动它。

自动字幕提供中文优先的 SenseVoice Small 和较小的 Whisper tiny 两种 INT8 ONNX 权重，并按音量与停顿分成最长约 12 秒的窗口。当前字幕时间是句级估计，不是逐字强制对齐。音乐、噪声、方言、低音量和复杂中英混说可能降低准确率；纯静音不会交给识别模型。每次最多处理 1 小时源音轨。字幕根据所选片段的入点、速度和时间轴位置映射，识别的是源音轨而非最终混音。

AISHELL-3 模型提供 174 个中文说话人，允许选择 0–173 的音色和 0.5–2.0 倍语速；每次最多 3000 字。它适合普通话朗读，英文发音与拟人表现存在明显限制。ChatTTS 如配置为独立提供者，使用独立运行时与许可说明。

## 固定来源与大小

核验日期：2026-09-06。下载器不会查询“latest”，不执行 npm install、shell 命令或下载脚本。

| 组件 | 固定版本/提交 | 网络下载 | 解压/模型文件 |
|---|---|---:|---:|
| sherpa-onnx-node JS 包 | 1.13.7 | 11,954 B | 61,221 B |
| Windows x64 native | 1.13.7 | 8,705,089 B | 23,019,070 B |
| macOS Intel native | 1.13.7 | 11,151,181 B | 37,516,406 B |
| macOS Apple 芯片 native | 1.13.7 | 10,015,211 B | 34,006,842 B |
| Whisper tiny INT8 + tokens | `65176e2deb88badc814a94058666cadccc29b61c` | 103,609,903 B | 同左 |
| SenseVoice Small INT8 + tokens + 许可引用 | `2365baeacb507f821a0c8120fcee3d484dba7a07` | 239,549,806 B | 同左 |
| VITS AISHELL-3 中文 | 固定 SHA256 的 2024-04-08 发布资产 | 31,559,701 B | 213,479,522 B |

中文朗读包内 `model.onnx` 为 30,482,262 B，较大的 `rule.far` 是中文文本规范化规则。磁盘还会保留已校验下载供修复；安装全部三种模型应预留至少 1 GB 空间，临时解包和推理另需空间。原生组件由运行中的 `process.platform` 和 `process.arch` 选择，拒绝其他架构。

- [sherpa-onnx Node 官方安装文档](https://k2-fsa.github.io/sherpa/onnx/javascript-api/install.html) 声明支持 Windows x64 与 macOS x64 / arm64。
- [固定 JS 包元数据](https://registry.npmjs.org/sherpa-onnx-node/1.13.7)
- [Windows x64 元数据](https://registry.npmjs.org/sherpa-onnx-win-x64/1.13.7)
- [macOS x64 元数据](https://registry.npmjs.org/sherpa-onnx-darwin-x64/1.13.7)
- [macOS arm64 元数据](https://registry.npmjs.org/sherpa-onnx-darwin-arm64/1.13.7)
- [固定 Whisper ONNX 仓库版本](https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny/tree/65176e2deb88badc814a94058666cadccc29b61c)
- [固定 SenseVoice ONNX 仓库版本](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tree/2365baeacb507f821a0c8120fcee3d484dba7a07)
- [AISHELL-3 官方引擎示例与发布链接](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/vits.html)
- [中文模型原始下载](https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-icefall-zh-aishell3.tar.bz2)

## 固定完整性值

下列值固化在 `electron/ai.cjs`，每次下载后计算并对照。npm 使用官方固定版本 metadata 的 SHA512 SRI；Whisper 模型使用 HF LFS SHA256，tokens 和中文压缩包的 SHA256 是本次实际下载计算值。运行前进一步检查安装文件清单的 SHA256。

```text
sherpa-onnx-node 1.13.7
sha512-0XGV7arGngBCnol0m8OLyqlnaUm19Q1KmetVj1DDBdymXa1upmAHZDwNdN47gjsEhqE5hXUEyc1vRQoXrNhNVg==
sherpa-onnx-win-x64 1.13.7
sha512-wBV1o+/zgsMrOjfCFIgGrH6S28xq6CqRCLSavCOjTZ6cqr80yGc07DUHxqsHFPZvfoJU+2JF5L2l3gyWFWoWdQ==
sherpa-onnx-darwin-x64 1.13.7
sha512-N3o+T+wn9WaQmsKV5DD8bTHdo+WN2+sXwmZcGJZiDjtOMR2zFz7uVCZnYCmEAMgvChC+oHcF5RvEEKcRCAu6Pw==
sherpa-onnx-darwin-arm64 1.13.7
sha512-5NCE50hAvr3n2pdett0SgfPBJXaFZE0bqHwbHyiq+IKZ8Ids0l4M0VrG+ImGYIafCwie+oC3uAJ+pKj9xg/k+w==
tiny-encoder.int8.onnx
sha256:d24fb083ae3b1041fc24e97971d60e280c9342201fbb67b0ab428a8b4a51a434
tiny-decoder.int8.onnx
sha256:d2fece8dd42771f1df975c6c0445770d0c292bf7547c2cae04a6c0cc57540925
tiny-tokens.txt
sha256:b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126
vits-icefall-zh-aishell3.tar.bz2
sha256:ab468db3a3308cdd861495e0db2f25d79418a0c00639f74944c7cdf5dd8c6ec1
SenseVoice model.int8.onnx
sha256:c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51
SenseVoice tokens.txt
sha256:f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc
SenseVoice LICENSE
sha256:221c6df10b0931a5629adad671ea48fb7747e034c414b6d2bfa275bc3dd4ea17
```

## 许可与来源

| 部分 | 已核实声明 | 来源 |
|---|---|---|
| sherpa-onnx 引擎 | Apache-2.0 | [固定源码许可证](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.7/LICENSE) |
| ONNX Runtime | MIT，原生包包含引擎共享库；保留上游声明 | [官方许可证](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) |
| Whisper 原始代码与权重 | MIT | [Whisper 官方仓库许可说明](https://github.com/openai/whisper#license) |
| ONNX Whisper 转换 | 由 sherpa 维护者公开发布；原始权重来源为 Whisper | [固定模型仓库](https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny/tree/65176e2deb88badc814a94058666cadccc29b61c) |
| SenseVoice ONNX 权重 | 转换仓库 LICENSE 引用 FunASR 许可页，模型适用独立模型协议，不能只套用工具包 MIT | [固定许可引用](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/blob/2365baeacb507f821a0c8120fcee3d484dba7a07/LICENSE)、[FunASR 模型协议](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE) |
| AISHELL-3 训练数据 | Apache-2.0 | [数据发布者仓库](https://huggingface.co/datasets/AISHELL/AISHELL-3)、[数据集论文](https://www.isca-archive.org/interspeech_2021/shi21c_interspeech.pdf) |
| AISHELL-3 VITS 权重 | sherpa 官方公开发布，由 icefall 训练；下载包没有单独权重 LICENSE，不能把训练数据许可自动等同权重许可 | [官方模型说明](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/vits.html) |

仓库与安装包不再分发大模型。公开可下载不等于所有商业用途均获得授权；如需商业分发这一中文权重，应向其发布者确认权重授权，并保留对应确认记录。模型许可记录会随来源调整，不能以“全部商用免费”概括。

## 安装与进程边界

- 只允许 HTTPS，且逐次校验重定向域名。固定允许 registry.npmjs.org、github.com、GitHub 发布资产域名、huggingface.co 及精确列出的 HF 官方 CDN 主机。拒绝用户名、密码、自定义端口、任意用户 URL。
- 下载流写入 `.part`，有大小限制、60 秒无数据超时、最多三次重试。校验后改名为缓存文件；解包到随机 staging 目录，完成完整文件清单后才替换目标安装目录。
- 续传校验 HTTP Content-Range，服务器忽略 Range 时安全重新开始，禁止把完整响应拼到已有前缀后。磁盘中同样大小但内容损坏的运行时也会在加载前被散列检查拦截。
- 本地 `ai/diagnostics.jsonl` 记录安装/任务阶段与有限错误信息，大小约 64 KiB 上限，不写入原始朗读文本或识别音频。界面错误与日志用于故障定位，不是自动上传的遥测。
- tar 解包拒绝绝对路径、父目录路径、驱动器路径、NUL、符号链接、硬链接及特殊文件；限制总解包大小和条目数。
- renderer 无法指定引擎可执行路径或模型 URL。所有 AI IPC 都使用主窗口与主 frame 发送方校验，输入音频必须通过宿主媒体白名单校验。
- 音轨转换以 `spawn(ffmpegPath, args, {shell:false})` 执行。AI 在独立 Node 子进程执行，取消终止进程；子进程错误不会被当作识别结果。
- 下载器只安装固定 native N-API 包，不运行包生命周期脚本。macOS 为子进程设置对应 native 包的 `DYLD_LIBRARY_PATH`。macOS 的实际签名、公证和原生库运行仍需在 Mac CI / 真机验证。

## 验证记录

Windows 本机实测使用系统临时目录缓存，测试模型与音频不提交仓库。

- 固定 Windows N-API 引擎下载、SHA512 校验、安全解包和清单生成成功。
- Whisper 英语：官方 `test_wavs/0.wav`（约 6.6 秒）经 FFmpeg → 本地模型 → JSON 字幕，输出 0.24–6.30 秒一条完整参考句；含进程启动与校验用时约 2.4 秒。
- 中文朗读：输入“今天是星期天。我们正在测试自动字幕和语音朗读功能。”，音色 88、1 倍语速，生成真实 5.69075 秒 WAV。
- 同段中文给 Whisper tiny：得到字幕但误字较多，因此增加 SenseVoice 并将其设为中文默认。不能把跑通推理等同识别准确。
- SenseVoice 在真实 Electron 子进程中通过中文自然语音、中文合成语音、英语三段识别：官方中文样本得到“开放时间早上9点至下午5点。”；英语参考句完整识别；中文 TTS 回识别仍有“字幕”误为“自动”的错误，需人工校对。三段总耗时约 8.3 秒，不作为通用性能基准。
- 损坏已安装 tokens 文件会在运行前被 SHA256 拦截；点击修复从已校验缓存恢复，无需重下。
- 取消任务释放运行状态；全静音无识别窗口；恶意父目录路径与符号链接 tar 被安全拒绝；正常 gzip / bzip2 包解压通过。
- 额外使用实际 Electron 44.2.0 / 内置 Node 24.20.0 执行中文朗读与英语识别子进程，配合本项目打包用 FFmpeg 成功；修复了 Electron V8 memory cage 不允许外部 ArrayBuffer 的问题，TTS 和 WAV 读取均明确使用复制缓冲区。
- 下载中取消、实际 native 子进程已启动后取消均通过，取消后运行状态释放。60 秒连续语音合成信号分成 5 段无重叠、每段 12 秒的识别窗口。
- 实际 Windows 桌面面板完成 AISHELL 中文输入→生成→试听→加入时间线→选中音频→SenseVoice 识别→修改文字→加入字幕轨道→保存工程，控制台无错误。3.718 秒音频正确引用到音频轨道，字幕为 0–3.66 秒；识别把“测试”误为“设施”，已在界面校对，不能保证无需人工检查。
- macOS 模型推理仍需真机核验，不据 Windows 结果声称全平台实测通过。

开发机证据位于系统临时目录 `freecut-ai-verify`：`integration-result.json`（中文合成及 tiny 回识别）、`electron-integration-result.json`（真实 Electron 朗读/英语识别）、`sensevoice-integration-result.json`（中英三样本）、`security-results.json`（修复/取消/解包边界）。临时模型路径为其 `userdata/ai` 子目录。这些文件是开发期日志，不属于安装包。

已保存可重复验证入口：

```sh
# 默认测试：使用 mock 下载响应，不下载运行时或模型
node --test electron/ai.test.cjs

# 真实测试：显式允许联网安装三种模型和固定散列的公开语音样本
node scripts/smoke-ai.cjs --download

# 已有模型时离线测试；DIR 内应有 ai/，WAV 需匹配脚本的固定官方样本
node scripts/smoke-ai.cjs --data-dir DIR --english ENGLISH_WAV --chinese CHINESE_WAV
```

最近运行：安全测试 12/12 通过；真实脚本在现有缓存下、未开启网络下载时，完成实际 Electron 中文 TTS、SenseVoice/Whisper 各自中英两组识别、正在运行的 native 任务取消，全部通过。脚本自动使用实际 Electron 可执行文件，结果保存在指定目录的 `smoke-ai-result.json`。真实测试不属于默认 CI，除非显式加 `--download` 否则不会下载缺少的模型或样本。

0.3.0 更新：模型下载/安全测试共 18 项通过。原公开 0.2.0 应用及补丁打包应用在独立中文路径中完成实际 SenseVoice 安装和中文识别。用户报告的下载完成后立即报错没有在本机复现；本次修复重点是下载恢复、损坏文件拦截和诊断信息，未将推测写作已确认根因。对应脚本为 `scripts/regression-models.cjs`。
