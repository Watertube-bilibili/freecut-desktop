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
- 安装和推理互斥。取消安装可稍后重试，已完成且校验通过的下载可复用。取消推理清除该次未完成音频。
- 便携数据目录移动后会使原有就绪标记失效；再次点击准备会只重建该应用的 venv，复用模型和下载缓存，修复 Python 的绝对路径引用。
- 安装完成标志由实际 24 kHz 单声道 WAV 合成测试生成；写入原子 `ready.json` 前不会报告成功。
- 生成的音频由现有媒体导入模块注册，前端通过 `freecut-media:` 读取；不接受前端提供任意输出路径。

## 与桌面应用集成

后端导出 `registerChatTTS({ ipcMain, app, importPath, validateSender })`，同步返回含 `dispose()` 的控制器。主进程退出时取消未完成任务。IPC 通道是 `freecut:chattts-status`、`freecut:chattts-install`、`freecut:chattts-generate`、`freecut:chattts-cancel`，进度事件为 `freecut:chattts-progress`。所有入口检查可信页面来源。

前端 `ChatTTSPanel` 接收 `onAddAsset(asset)`。预加载桥提供 `chatttsStatus`、`chatttsInstall`、`chatttsGenerate`、`chatttsCancel` 和 `onChatTTSProgress`。纯浏览器预览展示说明，不会模拟本地安装或生成成功。

## 验证状态

安装器包含自动短句合成自检。开发环境的实际端到端下载和合成测试进行中；本段会在取得真实 WAV 结果后更新。Mac 使用独立平台运行环境和对应 Torch 版本，其运行结果仍需在 Mac 机器验证。
