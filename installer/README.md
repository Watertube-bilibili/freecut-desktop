# 水管剪辑独立 Windows 安装器

安装界面复用产品自身的 Electron 运行时，Setup 中只有一份产品。主品牌为「水管剪辑」，出品方为「我叫水管同学」；`FreeCut.exe`、安装子文件夹和 `org.freecut.desktop` 保留兼容。安装 UI 是本目录的 HTML/CSS/JS，自定义 NSIS 脚本只负责隐藏解压并启动 `FreeCut.exe --installer`，没有 NSIS/Inno 向导页面。

首次打开不选择任何磁盘。C 盘快捷按钮使用当前用户位于 C 卷的 `%LOCALAPPDATA%\Programs\FreeCut`，无需提升权限；若当前用户目录不在 C 卷，按钮明确禁用，可用自定义目录选择其他可写位置。D 盘可用时选择 `D:\FreeCut`，不存在时禁用。原生目录选择返回任意盘根目录时，界面自动补 `FreeCut`；安装 API 收到原始根路径时仍直接拒绝。

## 打包契约

1. 先构建产品 `win-unpacked`，其中 `resources/freecut-installer/` 包含本目录的 `main.cjs`、`preload.cjs`、`backend.cjs`、`index.html`、`styles.css`、`renderer.js`、`uninstall.ps1`、`icon.png`。不包含 payload、tests 或第二套 Electron。
2. 产品 `electron/main.cjs` 在初始化窗口、IPC、模型前，仅在已打包进程发现 `--installer` 或 `--uninstall` 时转交 `require(path.join(process.resourcesPath, 'freecut-installer', 'main.cjs'))`，并停止其他产品初始化。`app.asar` 始终为原产品，不写入永久安装器模式。
3. 就地生成清单，不复制第二份运行时：

   ```powershell
   node installer/prepare-payload.cjs --source release/win-unpacked --in-place --version 0.3.0
   ```

4. 清单位于 `resources/freecut-installer/payload-manifest.json`，包含除自身以外全部产品文件的 SHA-256 和大小。只有已打包的 `--installer` 进程会选用 executable 所在目录作为源；IPC 不能提供 `embedded` 模式。清单不复制到安装目标，目标正常运行产品并保留卸载组件。
5. `scripts/package-installer.cjs` 调用 `electron-builder --config installer-builder.cjs --win nsis --prepackaged release/win-unpacked`，不会重建产品。打包前后检查 `FreeCut.exe` 和 `resources/app.asar` 哈希不变。`bootstrap.nsi` 采用 electron-builder MIT 许可的 portable launcher 结构，保留完整许可声明；每次使用独立临时目录，转发原命令行参数，退出后清理临时解压文件。

旧 `--output` 载荷生成模式仅保留给开发测试，仍生成 `manifest.json` 与 `application/`，正式 Setup 不使用它。

安装后的 `.freecut-install.json` 保存应用 ID、版本、安装 ID、时间及文件清单。更新只认有效标记。旧 NSIS 安装没有清单，选到旧目录时说明先从 Windows 设置卸载旧版或另选目录，不自动认领已有文件。

## 命令行

```text
Setup.exe
Setup.exe --update --install-dir "D:\FreeCut" --wait-pid 12345 --auto-run
Setup.exe --update --install-dir "D:\FreeCut" --wait-pid 12345 --silent
FreeCut.exe --uninstall --install-dir "D:\FreeCut"
```

`--wait-pid` 只接受正整数且不得是安装器自身 PID；等待最多 120 秒，期间允许取消，永不结束旧进程。更新目录不可在界面更改；失败时显示可重试结果。`--silent` 不显示窗口，失败退出码为 1。`--auto-run` 完成后启动已安装应用，清除安装器的 portable 环境变量，避免影响用户数据位置。

## 文件与卸载行为

- 安装前拒绝根目录、Windows 系统目录、个人文件根目录、网络路径、目录联接与符号链接。
- staging 与备份均在安装目标父目录内的随机专用目录中。复制阶段逐文件校验；用户可取消。短暂提交阶段不可取消，错误会恢复备份。
- 首次安装可以保留目录中不冲突的其他文件；任何未被旧清单拥有的同名文件都会阻止安装。重装仅替换旧清单内的程序文件。
- 创建桌面、开始菜单快捷方式及 HKCU 卸载项，不请求管理员权限，也不注册系统范围内容。若同名快捷方式指向其他程序则保留它。
- 卸载窗口复用已安装 Electron。确认后，一个固定内容的小 PowerShell helper 等窗口退出，再核验安装标记与文件 SHA-256，只删除原有未修改程序文件和空目录。工程、AI 缓存、未知文件及用户改动文件保留。没有额外缓存整份 Setup。
- 卸载使用固定脚本通过 Windows `Start-Process -WindowStyle Hidden` 启动独立清理进程；窗口等待真正清理进程读取计划并写入 ready 后退出，避免共享控制台随窗口结束。系统 PowerShell 模块路径固定到 Windows 自带目录。
- 卸载日志保留在 `%TEMP%\freecut-uninstall-*\result.json`，同目录的 `launcher.log`、`powershell.log` 和 `powershell-error.log` 用于启动诊断。升级期间或权限冲突使卸载失败时，可重新运行 Setup 的 `--uninstall --install-dir` 入口。

## 验证

```powershell
node --test installer/backend.test.cjs
node installer/smoke.cjs
npm run build
node node_modules/electron-builder/out/cli/cli.js --win dir --x64 --publish never
node scripts/package-installer.cjs
node installer/smoke-setup.cjs
```

后端测试使用独立临时目录，涵盖根路径规范化/拒绝、损坏载荷、旧文件保留、重装、取消重试、提交碰撞回滚、联接保护及安全卸载，并验证就地清单排除自身、安装保留原始 app.asar、嵌入模式仍拒绝损坏和清单父目录联接。`smoke.cjs` 使用 fixture 载荷测试原 UI；`smoke-setup.cjs` 另启动真正生成的 Setup，安装到独立 `.cache` 目录、逐文件核验、正常启动已安装编辑器，并使用真实卸载入口保留样例个人工程。测试不会覆盖既有用户安装。

开发运行支持 `FREECUT_INSTALLER_PAYLOAD_DIR` 指向 payload，`FREECUT_INSTALLER_TEST_HOME` 将安装器配置和快捷方式隔离到临时目录并跳过系统注册表。二者均只在未打包的开发模式生效。
