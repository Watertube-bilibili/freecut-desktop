'use strict';
(function (scope) {
  const en = {
    '安装已取消。': 'Installation cancelled.',
    '更新已取消。': 'Update cancelled.',
    超时: 'Timed out',
    '临时目录清理校验失败。': 'Temporary directory cleanup validation failed.',
    '快捷方式和卸载注册仅适用于 Windows。':
      'Shortcuts and uninstall registration are available on Windows only.',
    快捷方式写入失败: 'Could not write the shortcut',
    安装图标清单无效: 'Invalid installation icon manifest',
    安装图标校验失败: 'Installation icon verification failed',
    '隔离测试：未修改系统卸载注册表。':
      'Isolated test: Windows uninstall registration was not modified.',
    '安装包未包含卸载入口组件；可重新运行 Setup 并使用 --uninstall --install-dir 指定此目录。':
      'This package has no uninstall helper. Run Setup with --uninstall --install-dir and this folder path to uninstall.',
    水管剪辑: 'FreeCut',
    我叫水管同学出品: 'By 我叫水管同学',
    '把灵感，': 'Keep your ideas',
    '留在画面里。': 'in the picture.',
    '离线剪辑 · 自由表达': 'Offline editing · Creative freedom',
    'Windows 安装器': 'Windows installer',
    开始创作: 'GET STARTED',
    管理应用: 'MANAGE APP',
    继续创作: 'CONTINUE CREATING',
    安装水管剪辑: 'Install FreeCut',
    更新水管剪辑: 'Update FreeCut',
    卸载水管剪辑: 'Uninstall FreeCut',
    '选择一个位置，让创作开始。': 'Choose where to install FreeCut.',
    '安装位置保持不变，更新完成后继续创作。':
      'Update your current installation and continue editing.',
    '仅移除程序文件，工程与 AI 模型会保留。':
      'Remove application files. Keep your projects and AI models.',
    选择安装磁盘: 'Choose an installation drive',
    盘: 'DRIVE',
    '一键安装到 C 盘': 'Install on C drive',
    '一键安装到 D 盘': 'Install on D drive',
    '正在读取安装目录…': 'Reading installation path…',
    自定义安装目录: 'Choose another folder',
    安装位置: 'Installation folder',
    尚未选择: 'No folder selected',
    '正在读取程序信息…': 'Reading application information…',
    正在准备: 'Preparing',
    安装进度: 'Installation progress',
    '可以开始创作了。': 'Ready to create.',
    '桌面和开始菜单中都能找到 FreeCut。': 'Find FreeCut on your desktop and in the Start menu.',
    '程序与按需下载的 AI 模型分开安装。':
      'AI models are optional downloads, separate from the application.',
    取消安装: 'Cancel installation',
    继续安装: 'Keep installing',
    '要取消这次安装吗？': 'Cancel this installation?',
    选择安装位置: 'Choose a folder',
    '选择安装位置 →': 'Choose a folder →',
    完成: 'Done',
    '安装水管剪辑 →': 'Install FreeCut →',
    '启动水管剪辑 →': 'Launch FreeCut →',
    '重试更新 →': 'Retry update →',
    确认卸载: 'Uninstall',
    '经过修改或不在安装清单中的文件会保留。':
      'Modified files and files outside the installation manifest are kept.',
    此磁盘不可用: 'Drive unavailable',
    'C 盘使用当前用户程序目录，无需管理员权限。':
      'C drive uses your user application folder. No administrator rights required.',
    '当前用户的本地程序目录不在 C 盘；可自定义选择有写入权限的 C 盘目录':
      'Your user application folder is not on C. Choose a writable C-drive folder manually.',
    '最多等待 120 秒，不会强制结束应用。':
      'Waiting up to 120 seconds. FreeCut will not be forcibly terminated.',
    '正在完成文件替换，此步骤暂时不能取消。':
      'Finishing file replacement. This step cannot be cancelled.',
    '确认后安装窗口会关闭，后台完成程序文件移除。':
      'This window will close while the helper removes application files.',
    选择安装目录: 'Choose an installation folder',
    '安装已在进行。': 'Installation is already running.',
    '安装请求无效。': 'Invalid installation request.',
    '安装尚未完成。': 'Installation is not complete.',
    '更新目标不能更改。': 'The destination cannot change during an update.',
    '此卸载入口用于 Windows。': 'This uninstaller is for Windows.',
    '当前不能卸载。': 'Uninstall is not available right now.',
    '请先完成安装。': 'Complete the installation first.',
    '此安装器用于 Windows，请下载对应的 macOS 安装包。':
      'This installer is for Windows. Download the macOS package for a Mac.',
    正在检查安装位置: 'Checking the installation folder',
    正在展开并校验程序文件: 'Copying and verifying application files',
    '正在替换程序文件，请稍候': 'Replacing application files…',
    程序文件安装完成: 'Application files installed',
    '水管剪辑已经准备好了。': 'FreeCut is ready.',
    已取消安装: 'Installation cancelled',
    安装未完成: 'Installation did not complete',
    '正在等待 FreeCut 保存并退出…': 'Waiting for FreeCut to save and close…',
    '正在准备卸载，只移除安装清单内的程序文件':
      'Preparing to remove only the recorded application files',
    '正在移除 FreeCut 程序文件': 'Removing FreeCut application files',
    '等待 FreeCut 退出超过 120 秒。请关闭应用后重试，安装器没有终止任何进程。':
      'FreeCut did not close within 120 seconds. Close it and retry. No process was terminated.',
    '等待退出的进程编号无效。': 'Invalid process identifier.',
    '此模式需要 --install-dir 指定完整安装目录。': 'This mode requires a full --install-dir path.',
    '安装目录无效。': 'Invalid installation folder.',
    '请选择绝对路径。': 'Choose an absolute path.',
    '请选择本机磁盘上的完整目录。': 'Choose a complete folder path on a local drive.',
    '安装目录必须是绝对路径。': 'The installation folder must be an absolute path.',
    '不能直接安装到磁盘根目录，请选择 FreeCut 子目录。':
      'Do not install directly into a drive root. Choose a FreeCut subfolder.',
    '安装目录包含 Windows 不支持的名称。':
      'The folder contains a name that Windows does not support.',
    '请选择独立的 FreeCut 文件夹，不要直接使用系统或个人文件目录。':
      'Choose a dedicated FreeCut folder, rather than a system or personal folder.',
    '这个目录用于系统或安装器运行，请选择其他目录。':
      'This folder is used by Windows or the running installer. Choose another folder.',
    '安装目录不能包含符号链接或目录联接，请选择实际目录。':
      'Choose a real folder. Symbolic links and directory junctions are not allowed.',
    '安装目标已被一个文件占用。': 'A file already exists at the selected folder path.',
    '现有 FreeCut 安装标记不完整，请另选目录。':
      'The existing FreeCut installation marker is incomplete. Choose another folder.',
    '自动更新仅支持可识别的 FreeCut 安装，请手动选择安装目录。':
      'Automatic updates require a recognized FreeCut installation. Choose the installation folder manually.',
    '自动更新仅支持有 FreeCut 安装清单的现有安装，请手动选择安装目录。':
      'This operation requires an installation manifest. Run Setup to upgrade an older FreeCut installation first.',
    '此目录已有 FreeCut.exe，但没有新版安装清单。请先从 Windows 设置卸载旧版，或选择另一个文件夹；原文件未修改。':
      'FreeCut.exe already exists, but this folder could not be verified as a FreeCut installation. Choose another folder or uninstall that application first. Existing files were not changed.',
    '安装文件的父目录被现有文件占用。': 'A file blocks creation of a required parent folder.',
    '旧版程序文件在安装期间发生变化，请关闭 FreeCut 后重试；原文件未修改。':
      'The old application changed during installation. Close FreeCut and retry. Existing files were not changed.',
    '安装已取消，原有程序和其他文件保持不变。':
      'Installation cancelled. The original application and other files are unchanged.',
    '磁盘空间不足。请释放一些空间或选择其他磁盘后重试，原有文件已保留。':
      'Not enough disk space. Free some space or choose another drive and retry. Existing files were kept.',
    'FreeCut 安装清单无效或不属于本应用。':
      'The installation manifest is invalid or belongs to another application.',
    '安装清单不是可读取的普通文件。': 'The installation manifest is not a readable regular file.',
    '安装文件中缺少 FreeCut.exe。': 'The installer is missing FreeCut.exe.',
    '安装文件的大小或校验信息无效。': 'Invalid installation file size or checksum.',
    '安装文件总大小超出限制。': 'The installation exceeds the supported size limit.',
    '安装清单包含重复文件。': 'The installation manifest contains duplicate files.',
    '安装清单的文件和目录发生冲突。': 'The manifest contains conflicting file and folder paths.',
    '安装清单包含无效文件路径。': 'The manifest contains an invalid file path.',
    '安装清单包含危险文件路径。': 'The manifest contains an unsafe file path.',
    '内置安装清单不能包含自身。': 'The embedded manifest cannot include itself.',
  };
  const patterns = [
    [
      /^无法创建安装目录 (.+)。请确认有写入权限，或选择其他目录。\n([\s\S]*)$/,
      (_, folder, details) =>
        `Cannot create the installation folder ${folder}. Check write permissions or choose another folder.\n${details}`,
    ],
    [
      /^安装包缺少程序文件：(.+)。请重新下载安装器。$/,
      (_, file) =>
        `The installer is missing an application file: ${file}. Download the installer again.`,
    ],
    [
      /^正在升级 FreeCut (.+)，个人工程和模型会保留。$/,
      (_, version) => `Upgrading FreeCut ${version}. Your projects and models will be kept.`,
    ],
    [
      /^程序文件约 (.+) · 不含 AI 模型$/,
      (_, value) => `Application: about ${value} · AI models not included`,
    ],
    [/^安装到 (.+)$/, (_, value) => `Install to ${value}`],
    [
      /^这台电脑没有可用的 ([A-Z]) 盘$/,
      (_, drive) => `Drive ${drive} is not available on this computer.`,
    ],
    [
      /^([A-Z]) 盘不存在或未连接，请选择这台电脑上可用的磁盘。$/,
      (_, drive) => `Drive ${drive} does not exist or is disconnected. Choose an available drive.`,
    ],
    [/^正在校验 (.+)$/, (_, file) => `Verifying ${file}`],
    [
      /^目标目录里已有不属于 FreeCut 的同名文件：(.+)。请换一个目录，原文件未修改。$/,
      (_, file) =>
        `An unrelated file already exists: ${file}. Choose another folder. Existing files were not changed.`,
    ],
    [
      /^程序文件位置被目录占用：(.+)$/,
      (_, file) => `A folder occupies an application file path: ${file}`,
    ],
    [
      /^现有程序文件已变为目录：(.+)$/,
      (_, file) => `An application file was replaced by a folder: ${file}`,
    ],
    [/^安装文件大小不匹配：(.+)$/, (_, file) => `Installation file size mismatch: ${file}`],
    [
      /^安装文件 SHA-256 校验失败：(.+)。请重新下载安装器。$/,
      (_, file) => `SHA-256 verification failed: ${file}. Download the installer again.`,
    ],
    [
      /^安装时目标文件被其他程序创建：(.+)。原文件已保留。$/,
      (_, file) => `Another process created the target file: ${file}. That file was kept.`,
    ],
    [
      /^无法写入程序文件。请先关闭 FreeCut，并确认此目录允许当前用户写入。\n([\s\S]*)$/,
      (_, details) =>
        `Cannot write application files. Close FreeCut and check that you can write to this folder.\n${details}`,
    ],
    [/^保留已有快捷方式：(.+)$/, (_, file) => `Kept the existing shortcut: ${file}`],
    [/^图标刷新未完成：(.+)$/, (_, detail) => `Could not refresh the icon: ${detail}`],
    [
      /^Windows 卸载入口未创建：(.+)$/,
      (_, details) => `Could not register the Windows uninstall entry: ${details}`,
    ],
  ];
  function translate(value, language = 'zh-CN') {
    const text = String(value ?? '');
    if (language !== 'en' || !text) return text;
    const clean = text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    if (Object.hasOwn(en, clean)) return en[clean];
    for (const [pattern, format] of patterns) {
      const match = pattern.exec(clean);
      if (match) return format(...match);
    }
    return clean;
  }
  const api = { translate };
  if (typeof module !== 'undefined') module.exports = api;
  else scope.FreeCutInstallerI18n = api;
})(typeof window !== 'undefined' ? window : globalThis);
