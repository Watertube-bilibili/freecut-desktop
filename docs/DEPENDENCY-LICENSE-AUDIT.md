# 0.3.0 生产依赖与分发来源核对

本次按 `package-lock.json` 中非开发依赖条目、实际 `node_modules/<package>/package.json` 和各包 LICENSE 文件逐项核对。以下记录对应当前 0.3.0 工作区，不代表未来版本依赖不变，也不替代组件各自的许可文本。

| 实际安装的生产依赖       | 版本    | package.json 声明 | 随附通知                            |
| ------------------------ | ------- | ----------------- | ----------------------------------- |
| @isaacs/fs-minipass      | 4.0.1   | ISC               | LICENSE                             |
| base64-js                | 1.5.1   | MIT               | LICENSE                             |
| buffer                   | 5.7.1   | MIT               | LICENSE                             |
| chownr                   | 3.0.0   | BlueOak-1.0.0     | LICENSE.md                          |
| ieee754                  | 1.2.1   | BSD-3-Clause      | LICENSE                             |
| lucide-react             | 0.468.0 | ISC               | LICENSE，另含 Feather 的 MIT 声明   |
| minipass                 | 7.1.3   | BlueOak-1.0.0     | LICENSE.md                          |
| minizlib                 | 3.1.0   | MIT               | LICENSE                             |
| react                    | 19.2.8  | MIT               | LICENSE                             |
| react-dom                | 19.2.8  | MIT               | LICENSE                             |
| scheduler                | 0.27.0  | MIT               | LICENSE                             |
| tar                      | 7.5.22  | BlueOak-1.0.0     | LICENSE.md                          |
| tar/node_modules/yallist | 5.0.0   | BlueOak-1.0.0     | LICENSE.md                          |
| through                  | 2.3.8   | MIT               | LICENSE.MIT、LICENSE.APACHE2 均保留 |
| unbzip2-stream           | 1.4.3   | MIT               | LICENSE，含其上游实现署名           |

共 15 个生产包、16 份许可证文件；忽略行尾空格及 CRLF/LF 差异后，16 份文本均已收录在根目录 `THIRD_PARTY_NOTICES.md`。没有仅依据最外层依赖的许可推断其传递依赖许可。该表不把 build-only 工具算成应用运行组件。

Electron 44.2.0 虽在 npm 开发依赖中，实际作为运行时分发；其 MIT 及 Chromium/Node 等通知通过打包产物的 `LICENSE.electron.txt` 和 `LICENSES.chromium.html` 保留。本机已看到这两份文件，最终三平台安装包仍由 CI 打包验证。自定义 Windows 安装器使用应用已有 Electron 运行时、Node 内置模块与项目自有界面，没有另一套 npm 生产依赖。

公开构建的 FFmpeg 9.0.1、固定 x264 提交和 zlib 1.3.1 使用 `scripts/build-ffmpeg.sh` 从固定源码构建。`prepare-ffmpeg.mjs` 验证二进制、三个原始源码包以及对应源码总归档的 SHA-256 和大小；公开发布脚本要求每个平台引擎源码归档与安装包同批存在，并附准确提交的应用源码、GPL 全文和第三方通知。Actions 的临时 14 天 artifact 不能作为公开 Release 源码的长期替代。开发用 npm `ffmpeg-static` 供应商二进制不进入这个公开来源链。

可选语音模型不随基本安装包分发。ChatTTS 控制代码、其下载的 AGPLv3-or-later 项目代码、以及 CC BY-NC 4.0 的官方权重需要区分；应用的 GPL 许可不把权重变成可商用内容。SenseVoice 使用独立模型条款，AISHELL-3 的数据许可不自动赋予所有衍生权重许可，详见 `docs/AI-MODELS.md`、`docs/CHAT-TTS.md` 与打包的第三方通知。本次没有修改或扩大这些权重授权范围。

新增的 16 种音效来自项目数学合成器，没有网络素材、录音或第三方采样。源程序遵循 GPL-3.0-or-later，生成的原始内置音效以 CC0-1.0 提供；范围与逐个合成方法见 `docs/ORIGINAL-SOUNDS.md`，通知也已加入实际打包的 `THIRD_PARTY_NOTICES.md`。

Windows 隐藏安装/便携启动器另按真实二进制核对：实际嵌入 System、Nsis7z 19.00 和 StdUtils 1.14。两个插件的散列与上游原包一致，NSIS 大字符串 stub 也与官方 3.04 参考包一致。完整源码、构建入口、LGPL 及库内通知保存在 [windows-launcher](third-party/windows-launcher/README.md)，随每次应用源码归档分发；CI 检查实际发行 EXE 的插件清单，防止工具链变化后漏掉来源。
