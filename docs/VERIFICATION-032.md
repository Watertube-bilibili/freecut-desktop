# 0.3.2 Windows 快捷方式修复验证

本次修复覆盖安装后的旧快捷方式及图标缓存。应用编辑功能未修改。

- `node --test installer/backend.test.cjs installer/shortcuts.test.cjs`：23 项测试通过，其中实际 Electron Shell Link 测试包含 19 种新装、旧版迁移、8.3 别名、自定义入口及独立图标情形。
- `node installer/smoke.cjs`：6 组真实安装界面、取消/重试、升级及 PowerShell 卸载验证通过。桌面/开始菜单使用隔离目录，图标文件、图标散列与快捷方式读取结果一致。
- Unicode 卸载回归继续在 ACP1252 的独立进程中验证中文目录和说明；升级后的独立 ICO 随安装清单归属管理。
- `--no-shortcuts` 供无人值守安装使用，真实 Setup 打包回归通过该参数避免更新开发者自己的桌面入口。默认安装和应用自动更新会更新符合条件的旧入口。

新图标以内容 SHA-256 命名，避免沿用旧 EXE 图标路径。安装后发送 Shell 变更及缓存失效通知，不删除 Windows 全局缓存文件、不重启 Explorer。实现参考微软的 [SHChangeNotify 文档](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shchangenotify)和[快捷方式图标刷新说明](https://devblogs.microsoft.com/oldnewthing/20150903-00/?p=91671)。

本地测试与最终发布包验收分别记录；正式构建和安装结果见本次 Release 及 README。
