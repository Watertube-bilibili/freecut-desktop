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
$uninstallResult = @{ success = $false; removed = 0; preserved = @(); error = '' }
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
  # No recursive delete is used for the installation directory.
  foreach ($filePath in $filesToRemove) { Remove-Item -LiteralPath $filePath -Force; $uninstallResult.removed++ }
  Remove-Item -LiteralPath $marker -Force
  foreach ($directory in @($emptyDirectories) | Sort-Object Length -Descending) {
    if ((Test-Path -LiteralPath $directory) -and @(Get-ChildItem -LiteralPath $directory -Force).Count -eq 0) { Remove-Item -LiteralPath $directory -Force }
  }
  if (@(Get-ChildItem -LiteralPath $installTarget -Force).Count -eq 0) { Remove-Item -LiteralPath $installTarget -Force }
  $shortcutShell = New-Object -ComObject WScript.Shell
  foreach ($shortcutPath in $plan.shortcuts) {
    if ((Test-Path -LiteralPath $shortcutPath) -and $shortcutShell.CreateShortcut($shortcutPath).TargetPath -eq $plan.executable) { Remove-Item -LiteralPath $shortcutPath -Force }
  }
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
