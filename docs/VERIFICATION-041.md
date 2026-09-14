# 0.4.1 验证记录

日期：2026-09-14。状态：Windows 本地打包和真实公网协作已验证，最终三平台发行检查进行中。本文仅记录本次实际执行，不把 0.3.x / 0.4.0 的旧包验收等同于新包验收。

## 已完成

- **真实跨网生产协议测试通过**：[GitHub Actions 34857859032](https://github.com/Watertube-bilibili/freecut-desktop/actions/runs/34857859032)。一端是用户的 Windows x64 电脑，一端是 GitHub 提供的 Linux x64 临时云虚拟机。运行实际 `createCollaborationService` / HyperDHT / Noise / HTTP 协议，只共享脚本生成的 WAV，不读取用户素材。加入并下载 1,280,044 字节用时 8,358 ms；反向上传 960,044 字节、双方工程改动、最终确认和退出后素材保留均通过 SHA-256 校验，客户端总用时 14,534 ms。测试采用受控素材导入回调，不等同于两台完整桌面 UI 的公网联动测试。GitHub 只用于测试，不是生产房间服务器。
- **Windows 实际打包原生模块通过**：从 `release/win-unpacked/FreeCut.exe` 启动 Electron 44.2.0，确认 udx-native 1.21.1 和 sodium-native 5.1.0 的当前平台 `.node` 实际位于 `app.asar.unpacked`，未借用源码依赖。隔离 DHT 中双向各 3,145,728 字节一致、节点销毁完成。报告 `freecut-native-smoke-VWdJiL/native-report.json`。同一打包程序的实际导入、保存重开和 MP4 导出也通过，0 渲染错误。
- **Windows 实际 Setup 通过**：4 组验收覆盖自定义安装页面、114 个文件逐一散列、原始 app.asar/单一运行时、安装后真实编辑器启动及卸载保留个人工程。报告 `setup-runtime-test-mPR3k5/setup-report.json`。本机快速打包的 Setup 为 145,720,999 字节，SHA-256 `CFBB8CF40B22F060D3BE8DC6A2AFDEE32CAC234E583B0455866B7DA79358A111`；它与 CI 发布版压缩参数不同，不冒充最终 Release 文件散列。

- 协作后端：原有 11 项与新增远端 10 项测试通过。使用本机隔离 DHT 网络、真实 Noise 与 HTTP；覆盖 3 MiB 双向字节一致、工程修订、素材校验、错误密钥、退出保留素材、更换房间公钥、初始化取消和失败清理，并验证缺少原生组件仍能打开普通编辑与 LAN 协作。
- 双桌面界面：9 组通过，0 渲染错误；默认异地邀请码表单、高级 LAN、双向工程和素材、拖动期间合并、两种布局与英文、旧邀请码、取消挂起连接并保存草稿。报告 `freecut-collab-ui-9Qmon2/report.json`。这些界面测试仅用本机连接，不作为跨公网证据。
- 连续预览：针对 Intel CI 冷启动解码导致反复 seek 的情况增加有界追帧与恢复期；500 ms 延迟样本恢复后只 seek 一次，113 个变化帧，位置误差 70 ms。旧实现同样样本出现 5 次 seek 并未通过；逐帧导出路径独立。报告 `freecut-playback-regression-KtpIdb/playback-report.json`。
- 依赖：固定 HyperDHT 6.34.0，生产依赖 `npm audit --omit=dev` 为 0 已知漏洞（检查时结果，不等于不存在漏洞）。依赖及原生子库的来源、完整声明和未解项记录于 `third-party/p2p/`。

## 待完成

- 最终版本全套回归、Windows / Mac Intel / Mac Apple Silicon 打包后的原生传输模块和编辑导出验收。
- 最终 Release 资产与对应源码的散列校验。

## 范围

首次低层公网探针因初始化失败清理未设期限被测试任务取消；没有计作通过。后续实际产品服务已对初始化、连接、取消和清理设置期限，并通过上面的跨网工程测试。一次 Windows CI 在测试时下载 Electron 遇到 GitHub HTTP 504；发行流程改为在并行测试前显式准备固定、带校验的运行时，并有限重试。实际 Setup 的等待由默认 5 秒改为最多 120 秒，因为当次测试在正常文件替换 92% 时超过默认等待；安装文件逐一散列核验保持不变。

邀请码使用公开发现节点和 UDP NAT 穿透，传输通过 Noise 加密；没有媒体流量中继。禁用 UDP、部分对称 NAT 或防火墙策略仍可能导致连接失败。本次任何成功测试都不等同于所有网络都能连接。测试素材规模也不代表 8 GiB 单素材上限已做完整容量压力验收。

软件每次启动默认在约 12 秒后检查 Release，发现新版自动下载和校验；之后每 4 小时检查。只有已发布且版本更高的匹配资产才会触发升级，下载完成仍保护当前未保存工程和进行中的操作。
