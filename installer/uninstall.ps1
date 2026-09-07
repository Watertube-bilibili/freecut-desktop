param([Parameter(Mandatory = $true)][string]$PlanPath, [switch]$Launch)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Start-Process creates a new hidden Windows console. A Node DETACHED_PROCESS
# PowerShell can silently exit on startup; sharing the parent's console instead
# kills the helper when the uninstall window exits. Only fixed files and argument
# values are passed here; no command expression is constructed from a target.
if ($Launch) {
  $helperDirectory = [IO.Path]::GetDirectoryName($PSCommandPath)
  $helperArguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), '-PlanPath', ('"' + $PlanPath + '"'))
  Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $helperArguments -WindowStyle Hidden -WorkingDirectory $helperDirectory -RedirectStandardOutput (Join-Path $helperDirectory 'powershell.log') -RedirectStandardError (Join-Path $helperDirectory 'powershell-error.log')
  exit 0
}
$uninstallResult = @{ success = $false; removed = 0; preserved = @(); removedShortcuts = @(); preservedShortcuts = @(); error = '' }
$plan = $null
function Get-Sha256([string]$FilePath) {
  $fileStream = [IO.File]::OpenRead($FilePath)
  $hashEngine = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hashEngine.ComputeHash($fileStream)).Replace('-', '').ToLowerInvariant()) }
  finally { $fileStream.Dispose(); $hashEngine.Dispose() }
}
function Assert-ActualPath([string]$Value) {
  $walkPath = [IO.Path]::GetFullPath($Value)
  while ($walkPath) {
    if (Test-Path -LiteralPath $walkPath) {
      $entry = Get-Item -LiteralPath $walkPath -Force
      if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refusing a symbolic link or junction.' }
    }
    $parentPath = [IO.Path]::GetDirectoryName($walkPath)
    if ($parentPath -eq $walkPath) { break }
    $walkPath = $parentPath
  }
}
function Get-CanonicalLocalPath([string]$Value) {
  # Reject network paths and all reparse points before opening a real handle.
  # GetFullPath alone neither expands Windows 8.3 names nor resolves file identity.
  if ($Value -notmatch '^[a-zA-Z]:[\\/]') { throw 'Shortcut path is not an absolute local path.' }
  Assert-ActualPath $Value
  if (-not ('FreeCutUninstallPaths' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class FreeCutUninstallPaths {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder buffer, uint capacity, uint flags);
  public static string Resolve(string value) {
    // No data access; sharing permits an executable which is still mapped.
    // BACKUP_SEMANTICS also permits resolving the shortcut's working directory.
    using (SafeFileHandle handle = CreateFile(value, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
      if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
      StringBuilder buffer = new StringBuilder(32768);
      uint length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
      if (length == 0 || length >= buffer.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error());
      string result = buffer.ToString();
      return result.StartsWith(@"\\?\") ? result.Substring(4) : result;
    }
  }
}
'@
  }
  return [FreeCutUninstallPaths]::Resolve([IO.Path]::GetFullPath($Value))
}
try {
  $plan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($plan.product -ne 'org.freecut.desktop') { throw 'Invalid FreeCut uninstall plan.' }
  $installTarget = [IO.Path]::GetFullPath([string]$plan.target).TrimEnd('\')
  $driveRoot = [IO.Path]::GetPathRoot($installTarget).TrimEnd('\')
  if ($installTarget -eq $driveRoot -or $installTarget -notmatch '^[a-zA-Z]:\\') { throw 'Refusing a disk root or network target.' }
  foreach ($protected in @($env:SystemRoot, $env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramData)) {
    if ($protected -and $installTarget -eq ([IO.Path]::GetFullPath($protected).TrimEnd('\'))) { throw 'Refusing a protected directory.' }
  }
  if ($installTarget.StartsWith(([IO.Path]::GetFullPath($env:SystemRoot).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing the Windows directory.' }
  Assert-ActualPath $installTarget
  if ($plan.readyFile) { [IO.File]::WriteAllText([string]$plan.readyFile, 'ready', [Text.Encoding]::UTF8) }
  # The helper is a small standalone process, so the installed Electron runtime
  # can be removed after its own uninstall window closes. Never terminate it.
  $waitProcessId = [int]$plan.pid
  if ($waitProcessId -le 1 -or $waitProcessId -eq $PID) { throw 'Invalid process wait target.' }
  $closingProcess = Get-Process -Id $waitProcessId -ErrorAction SilentlyContinue
  if ($closingProcess -and -not $closingProcess.WaitForExit(120000)) { throw 'FreeCut uninstall window did not exit within 120 seconds.' }
  $waitUntil = [DateTime]::UtcNow.AddSeconds(120)
  do {
    $running = @(Get-CimInstance Win32_Process -Filter "Name = 'FreeCut.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -eq $plan.executable })
    if ($running.Count -eq 0) { break }
    if ([DateTime]::UtcNow -gt $waitUntil) { throw 'FreeCut is still running. Close it and run uninstall again.' }
    Start-Sleep -Milliseconds 500
  } while ($true)
  $marker = Join-Path $installTarget '.freecut-install.json'
  Assert-ActualPath $marker
  if ((Get-Sha256 $marker) -ne $plan.ownershipHash) { throw 'Installation changed after uninstall was requested. Nothing was removed.' }
  $installed = Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($installed.product -ne $plan.product -or $installed.installId -ne $plan.installId) { throw 'Installation identity does not match.' }
  $filesToRemove = [Collections.Generic.List[string]]::new()
  $emptyDirectories = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($file in $plan.files) {
    $relative = [string]$file.path
    if (-not $relative -or $relative -match '\\|(^|/)\.\.?(/|$)|[:*?"<>|]' -or $relative.StartsWith('/') -or $relative -eq '.freecut-install.json') { throw 'Unsafe uninstall entry.' }
    $absolute = [IO.Path]::GetFullPath((Join-Path $installTarget ($relative.Replace('/', '\'))))
    if (-not $absolute.StartsWith(($installTarget + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Uninstall entry escaped the installation directory.' }
    Assert-ActualPath $absolute
    if (Test-Path -LiteralPath $absolute) {
      $item = Get-Item -LiteralPath $absolute -Force
      if (-not $item.PSIsContainer -and $item.Length -eq $file.size -and (Get-Sha256 $absolute) -eq $file.sha256) { $filesToRemove.Add($absolute) }
      else { $uninstallResult.preserved += $relative }
    }
    $parentPath = [IO.Path]::GetDirectoryName($absolute)
    while ($parentPath -and $parentPath -ne $installTarget) { [void]$emptyDirectories.Add($parentPath); $parentPath = [IO.Path]::GetDirectoryName($parentPath) }
  }
  # Resolve ownership while the executable and its directories still exist.
  # Shell Link may return a different long/short spelling after target deletion.
  # Keep custom links and links which change during inspection/deletion.
  $shortcutCandidates = [Collections.Generic.List[object]]::new()
  $expectedExecutable = Join-Path $installTarget ([string]$installed.entryPoint)
  $canonicalExecutable = $null
  if (Test-Path -LiteralPath $expectedExecutable -PathType Leaf) {
    $canonicalExecutable = Get-CanonicalLocalPath $expectedExecutable
    if ((Get-CanonicalLocalPath ([string]$plan.executable)) -ne $canonicalExecutable) { throw 'Uninstall executable identity does not match the installation.' }
  }
  $shortcutShell = New-Object -ComObject WScript.Shell
  foreach ($shortcutPath in $plan.shortcuts) {
    if (-not (Test-Path -LiteralPath $shortcutPath)) { continue }
    try {
      if (-not $canonicalExecutable -or [IO.Path]::GetExtension($shortcutPath) -ne '.lnk') { throw 'Cannot confirm shortcut ownership.' }
      Assert-ActualPath $shortcutPath
      $beforeHash = Get-Sha256 $shortcutPath
      $shortcut = $shortcutShell.CreateShortcut($shortcutPath)
      if ((Get-CanonicalLocalPath ([string]$shortcut.TargetPath)) -ne $canonicalExecutable) { throw 'Shortcut points to another application.' }
      # These are the properties written by installIntegrations. User-specific
      # arguments, icon, working directory, description, hotkey or state survive.
      if ($shortcut.Arguments -or $shortcut.Hotkey -or [int]$shortcut.WindowStyle -ne 1 -or $shortcut.Description -ne '水管剪辑 FreeCut') { throw 'Shortcut has user customizations.' }
      if ((Get-CanonicalLocalPath ([string]$shortcut.WorkingDirectory)) -ne [IO.Path]::GetDirectoryName($canonicalExecutable)) { throw 'Shortcut working directory changed.' }
      $icon = [regex]::Match([string]$shortcut.IconLocation, '^(.*),(-?\d+)$')
      if (-not $icon.Success -or $icon.Groups[2].Value -ne '0' -or (Get-CanonicalLocalPath ($icon.Groups[1].Value.Trim('"'))) -ne $canonicalExecutable) { throw 'Shortcut icon changed.' }
      Assert-ActualPath $shortcutPath
      if ((Get-Sha256 $shortcutPath) -ne $beforeHash) { throw 'Shortcut changed during inspection.' }
      $shortcutCandidates.Add(@{ path = [string]$shortcutPath; sha256 = $beforeHash })
    } catch {
      $uninstallResult.preservedShortcuts += [string]$shortcutPath
    } finally {
      if ($shortcut) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut); $shortcut = $null }
    }
  }
  # No recursive delete is used for the installation directory.
  foreach ($filePath in $filesToRemove) { Remove-Item -LiteralPath $filePath -Force; $uninstallResult.removed++ }
  Remove-Item -LiteralPath $marker -Force
  foreach ($directory in @($emptyDirectories) | Sort-Object Length -Descending) {
    if ((Test-Path -LiteralPath $directory) -and @(Get-ChildItem -LiteralPath $directory -Force).Count -eq 0) { Remove-Item -LiteralPath $directory -Force }
  }
  if (@(Get-ChildItem -LiteralPath $installTarget -Force).Count -eq 0) { Remove-Item -LiteralPath $installTarget -Force }
  foreach ($candidate in $shortcutCandidates) {
    try {
      if (-not (Test-Path -LiteralPath $candidate.path)) { continue }
      Assert-ActualPath $candidate.path
      if ((Get-Sha256 $candidate.path) -ne $candidate.sha256) { throw 'Shortcut changed before removal.' }
      Remove-Item -LiteralPath $candidate.path -Force
      $uninstallResult.removedShortcuts += $candidate.path
    } catch {
      $uninstallResult.preservedShortcuts += $candidate.path
    }
  }
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcutShell)
  if ($plan.registryKey) {
    $expectedHash = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($installTarget.ToLowerInvariant()))
    $suffix = ([BitConverter]::ToString($expectedHash).Replace('-', '').ToLowerInvariant()).Substring(0, 16)
    $expectedKey = 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeCut-' + $suffix
    if ($plan.registryKey -ne $expectedKey) { throw 'Unexpected registry path.' }
    $registryPath = 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeCut-' + $suffix
    if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath }
  }
  $uninstallResult.success = $true
} catch {
  $uninstallResult.error = $_.Exception.Message
  if (-not $plan.silent) {
    Add-Type -AssemblyName System.Windows.Forms
    [void][Windows.Forms.MessageBox]::Show(('FreeCut uninstall could not finish. Close FreeCut and try again.' + [Environment]::NewLine + $uninstallResult.error), 'FreeCut', 'OK', 'Warning')
  }
} finally {
  if ($plan.logFile) { $uninstallResult | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $plan.logFile -Encoding UTF8 }
}
if (-not $uninstallResult.success) { exit 1 }
