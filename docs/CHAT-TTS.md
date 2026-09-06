# ChatTTS 可选本地配音

FreeCut 提供 ChatTTS 自然配音实验模块。用户在桌面应用的配音面板选择 ChatTTS，点击“一键下载并准备”，即可下载运行环境、安装隔离依赖、下载校验模型，并执行一次真实短句合成。只有验证成功才会显示“已就绪”。随后可输入中文或英文、选择音色种子和语速风格，生成 WAV 后试听并加入时间线。

## 许可与适用范围

ChatTTS 代码采用 AGPLv3+，官方发布的模型采用 CC BY-NC 4.0，仅限非商业的学习、教育与研究用途。本应用没有将该模型重新授权为可商用音色。官方也说明开源模型在稳定性和音质方面存在限制；这里的自然配音不等同于真人录音质量保证。[ChatTTS 官方仓库与许可说明](https://github.com/2noise/ChatTTS)

模型为可选下载，不随安装包分发。桌面面板在下载和生成区域明确展示非商业限制。无需登录，也不会向第三方发送配音文本。下载完成后的生成过程强制 Hugging Face / Transformers 离线模式。

## 固定依赖与下载验证

| 项目 | 固定版本或来源 |
| --- | --- |
| 运行环境管理器 | uv 0.8.22，官方发布文件与内置 SHA-256 |
| Python | uv 管理的 Python 3.11.13 |
| ChatTTS | 0.2.5，PyPI 官方源分发文件及 SHA-256 |
| PyTorch / torchaudio | 2.5.1 CPU；Intel Mac 为 2.2.2 |
| NumPy | 1.26.4 |
| Transformers / tokenizers | 4.46.3 / 0.20.3 |
| 模型仓库 | `2Noise/ChatTTS` |
| 模型版本 | `1a3c04a8b0651689bd9242fbb55b1f4b5a9aef84` |
| 模型文件 | 9 份 safetensors / JSON，每份验证固定字节数和 SHA-256 |

下载来源为 [uv 官方固定发布版本](https://github.com/astral-sh/uv/releases/tag/0.8.22)、[ChatTTS 0.2.5 PyPI 发布](https://pypi.org/project/ChatTTS/0.2.5/) 和 [固定模型快照](https://huggingface.co/2Noise/ChatTTS/tree/1a3c04a8b0651689bd9242fbb55b1f4b5a9aef84)。完整版本约束及校验值位于 `electron/chattts.cjs`。主要依赖固定版本；没有将所有传递依赖打包为永久锁定镜像。

模型本身约 1.22 GB，加上 Python、CPU 推理依赖和安装缓存，首次准备可能下载超过 2 GB，需至少 6 GB 可用空间。CPU 推理可能较慢，长文本建议分段。首版每次限制 300 字，音频最长 5 分钟，任务可取消。

## 隔离与可靠性

- 数据保存在 Electron `userData/ai/chattts-0.2.5-cpu-v1`。便携版随应用的便携数据目录存放。
- 即使电脑已安装 Python，也使用独立托管 Python 与独立 venv，不写入系统 Python 的 site-packages。
- uv、Hugging Face、Torch、Numba、临时文件的缓存目录均指向该独立目录。安装命令不修改用户 PATH。
- 本地路径限制在专用目录内，拒绝目录符号链接；所有子进程使用参数数组和 `shell:false`，Windows 子进程隐藏窗口。
- 模型下载仅允许官方 HTTPS 地址及官方对象存储重定向；下载到临时文件、校验后原子重命名，不执行模型仓库中的 Python 代码。
- 模型文件最多四路并行。大型 GPT 权重使用四段 HTTP Range 续传，严格检查服务器返回范围，合并后验证整个文件的 SHA-256。短暂断连自动重试，下载失败不会产生可用模型标记。
- 安装和推理互斥。取消安装可稍后重试，已完成且校验通过的下载可复用。取消推理清除该次未完成音频。
- 便携数据目录移动后会使原有就绪标记失效；再次点击准备会只重建该应用的 venv，复用模型和下载缓存，修复 Python 的绝对路径引用。
- 安装完成标志由实际 24 kHz 单声道 WAV 合成测试生成；写入原子 `ready.json` 前不会报告成功。状态检查验证安装根目录、推理脚本散列、Python 和模型文件大小；每次查询状态不会重新计算全部模型散列，重新准备时会校验完整模型。
- 生成的音频由现有媒体导入模块注册，前端通过 `freecut-media:` 读取；不接受前端提供任意输出路径。

## 与桌面应用集成

后端导出 `registerChatTTS({ ipcMain, app, importPath, validateSender })`，同步返回含 `dispose()` 的控制器。主进程退出时取消未完成任务。IPC 通道是 `freecut:chattts-status`、`freecut:chattts-install`、`freecut:chattts-generate`、`freecut:chattts-cancel`，进度事件为 `freecut:chattts-progress`。所有入口检查可信页面来源。

前端 `ChatTTSPanel` 接收 `onAddAsset(asset)`。预加载桥提供 `chatttsStatus`、`chatttsInstall`、`chatttsGenerate`、`chatttsCancel` 和 `onChatTTSProgress`。纯浏览器预览展示说明，不会模拟本地安装或生成成功。

## 验证状态

已于 2026-09-06 在 Windows x64 完成真实模型下载、独立 Python/依赖安装、含空格的路径、迁移后重建 venv、取消任务、未就绪时拒绝生成，以及取消后不写就绪标记的验证。实际 Electron 44.2.0 进程调用安装控制器和推理控制器，并使用应用的 FFmpeg 媒体导入模块注册生成结果。Mac 使用独立平台运行环境和对应 Torch 版本，其推理运行结果仍需在 Mac 机器验证。

实际短句为“你好，这是自由剪辑的真实语音测试。”，种子 42、语速 5。生成 WAV 为 24 kHz、单声道、16 位 PCM，时长 2.9097 秒、139,708 字节；峰值 0.8049、RMS 0.0804、无削波样本。本机一次 CPU 推理及媒体导入用时约 22.8 秒，速度会随设备变化。音频 SHA-256 为 `a8525c9c69545f8495b93bedbba298af1200046eff1f77509bb5e4563336153d`。使用已缓存的 SenseVoice 模型转写，结果与该中文输入完全一致。该验证证明本次真实模型输出的技术格式和朗读内容正确，不构成主观自然度或任意文本成功率保证。

此过程发现并修复了 Windows 下隔离 Python 将输入按 GBK 解码的问题：现在通过显式 UTF-8 模式和二进制 stdin 解码传递中文。就绪标记包含推理脚本散列，旧脚本对应的安装会要求重新准备。

### 复现实测

安装项目依赖并准备对应平台的 FFmpeg 后，在项目根目录执行：

```powershell
# 默认禁止下载：使用已有的完整缓存，执行真实推理、FFmpeg 导入和 WAV 检查
node scripts/smoke-chattts.cjs --data-dir "D:\free open cut\.cache\chattts-qa"

# 明确允许下载：完整执行应用中的一键准备流程，再合成真实音频
node scripts/smoke-chattts.cjs --data-dir "D:\free open cut\.cache\chattts-qa" --download

# 可选：利用已有的 SenseVoice 缓存核对朗读内容，不下载 ASR 模型
node scripts/smoke-chattts.cjs --data-dir "D:\free open cut\.cache\chattts-qa" --asr-data-dir "C:\path\to\existing-ai-userdata"
```

`--data-dir` 指定 Electron `userData` 层级，即其下包含 `ai` 子目录；应替换为自己的现有缓存或独立测试目录。脚本默认不进行任何准备下载，缓存缺失时直接失败；只有显式 `--download` 才允许安装运行环境、依赖和模型。支持 `--text`、`--seed` 和 `--speed`。运行报告保存为指定数据目录内的 `chattts-smoke-result.json`，包含实际音频路径、时长、格式、散列和可选转写结果。未提供 ASR 缓存时，报告明确保留 `speechContentVerified: false`，需另行试听；非静音波形检查本身不算自然语音内容验证。
