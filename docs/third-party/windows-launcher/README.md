# Windows 启动器源码与许可证

本目录是 FreeCut 0.3.0 Windows 隐藏 Setup 启动器与便携启动器的分发来源记录。所有归档均已实际下载；原文件保持原样，来源、字节数、SHA-256 见 `sources.json`。六份源代码/参考归档合计约 4.2 MiB，随 `FreeCut-project-source-<commit>.tar.gz` 一起放在同一 Release，不需要增加主发布文件种类。

## 实际嵌入的组件

已经逐块解压本机实际构建的 `FreeCut-0.3.0-win-x64-Setup.exe` 与 `FreeCut-0.3.0-win-x64-Portable.exe` 的 NSIS 数据区，两个文件都只包含下列三个插件 DLL。这里列出的 x86 指 NSIS 启动器架构，应用本身仍是 Windows x64。

| 组件 | 实际版本与来源 | 用途与许可 |
| --- | --- | --- |
| NSIS exehead / System.dll | NSIS 3.04，electron-builder 供应商包名 `nsis-3.0.4.1`；大字符串构建 | zlib 外壳解压、环境变量与平台探测；NSIS zlib/libpng 条款 |
| StdUtils.dll | 官方版本 1.14，PE 版本 1.1.4.0；102,400 B | `GetAllParameters`；LGPL-2.1-or-later，保留作者关于独立插件的澄清，以及库内 Apache Group、RHash、BLAKE2 声明 |
| Nsis7z.dll | 19.00；434,176 B | 解压内嵌 `.7z` 应用；保留插件原作者 LGPL 说明及随附 LZMA SDK 公有领域声明，不用新的笼统许可证覆盖它们 |

StdUtils 和 Nsis7z 的实际嵌入 DLL 均与本目录原作者发布包中的 Unicode DLL **SHA-256 完全一致**。NSIS 缓存中的六种 Unicode stub 也与官方 `nsis-3.04-strlen_8192.zip` 对应文件一致；最终 EXE 的图标/品牌资源会由构建过程调整。供应商包版本不能误写成上游版本 3.0.4.1。

当前 `app-builder-lib` 使用非 solid **zlib** NSIS 外壳和独立 Nsis7z 插件。NSIS COPYING 同时描述的 LZMA/CPL 模块没有被当作当前外壳压缩器。UAC、INetC、nsisunz、nsProcess、WinShell、EmbedHTML、SpiderBanner 等虽然存在于构建缓存中，但没有嵌入本次这两个 EXE。自定义脚本没有使用默认 NSIS 安装向导。

验证已有归档及两个实际安装包：

```text
node docs/third-party/windows-launcher/verify.cjs release/FreeCut-0.3.0-win-x64-Setup.exe release/FreeCut-0.3.0-win-x64-Portable.exe
```

验证器只读取归档和安装包，不运行安装器。更换 NSIS/插件/压缩配置后需要重新建立实际嵌入清单，不能忽略验证失败。

## 原始源码与构建入口

- `StdUtils.2018-10-27.zip` 是原作者发布包，包含 `Contrib/StdUtils/StdUtils.2018-10-27.Sources.tar`、许可和实际 DLL。其内嵌 tar 的 Git commit ID 为 `4e1117321001e54dcd2c52f72d3c359d5215e426`，与另外保留的固定 GitHub 源码归档一致。上游版本标签为 `1.14`。解开源码后，`Contrib/StdUtils/StdUtils.sln` 的 `Release_Unicode|Win32` 是本次插件配置；`make_pack.bat` 记录 Visual Studio 2010 工具链和完整原始打包步骤。
- `Nsis7z_19.00.7z` 是 NSIS 项目页面直接提供的原作者发布包，含插件源码覆盖层、Visual Studio 工程、实例和原始 DLL。先解开 `lzma1900.7z` 得到完整 **LZMA SDK 19.00**，再把插件包的 `Contrib/nsis7z/` 内容覆盖到 SDK 根目录。构建 `CPP/7zip/Bundles/Nsis7z/Nsis7z.sln`，选择 `Release Unicode|Win32`；工程记录工具集 `v141`（Visual Studio 2017）。具体修改说明保留在 `Nsis7z-ReadMe.txt`，无需自行猜测或另找上游压缩代码。
- `nsis-3.04-src.tar.bz2` 是完整 NSIS 3.04 源码，含 `Source/exehead`、压缩模块及 `Contrib/System`。上游 `INSTALL`、`SConstruct`、`SCons/` 记录构建工具和参数。构建大字符串 Unicode 版本使用 `NSIS_MAX_STRLEN=8192` 和 `UNICODE=yes`；`scons -h` 列出可用选项。本目录的 `nsis-3.04-strlen_8192.zip` 是用于确认实际 stub 的官方参考二进制，不冒充源码。
- FreeCut 的 `installer/bootstrap.nsi`、`installer-builder.cjs`、`electron-builder.yml` 和锁定的 electron-builder 模板记录最终包装方式，也在同一个应用源码归档中。插件以独立 DLL 解包和调用；可以修改插件、重编译并重建启动器。不同编译器环境不保证字节级复现。

本次没有修改上述第三方插件二进制或源码。完整许可也已复制到安装包实际携带的根目录 `THIRD_PARTY_NOTICES.md`。作者的 StdUtils 澄清原文中出现的用词按原样保留；并未擅自改写许可。

## 官方来源

- [NSIS 3.04 官方发布目录](https://sourceforge.net/projects/nsis/files/NSIS%203/3.04/)
- [electron-builder 使用的 NSIS 供应商版本](https://github.com/electron-userland/electron-builder-binaries/releases/tag/nsis-3.0.4.1)
- [StdUtils 原作者发布目录](https://sourceforge.net/projects/muldersoft/files/StdUtils-Plugin%20%28NSIS%29/)
- [StdUtils 固定源码提交](https://github.com/lordmulder/stdutils/commit/4e1117321001e54dcd2c52f72d3c359d5215e426)
- [Nsis7z 项目页面及 19.00 发布包](https://nsis.sourceforge.io/Nsis7z_plug-in)
- [7-Zip 的 LZMA SDK](https://www.7-zip.org/sdk.html)
