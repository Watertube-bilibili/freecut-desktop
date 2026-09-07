param([Parameter(Mandatory=$true)][string]$Plan, [switch]$Quiet, [switch]$Launch)
$ErrorActionPreference = 'Stop'
# The short bootstrap belongs to the caller. Start-Process creates a separate
# hidden console for the real worker, so the worker survives application exit.
# File paths are argv values, never interpolated into a PowerShell command.
if ($Launch) {
  $helperDirectory = [IO.Path]::GetDirectoryName($PSCommandPath)
  $helperArguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), '-Plan', ('"' + $Plan + '"'))
  if ($Quiet) { $helperArguments += '-Quiet' }
  Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $helperArguments -WindowStyle Hidden -WorkingDirectory $helperDirectory -RedirectStandardOutput (Join-Path $helperDirectory 'powershell.log') -RedirectStandardError (Join-Path $helperDirectory 'powershell-error.log')
  exit 0
}
$stagePath = $null
$backupPath = $null
$replacementInstalled = $false
function Get-UpdateHash([string]$File) {
  $stream = [IO.File]::OpenRead($File)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose(); $stream.Dispose() }
}
try {
  $config = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
  $sourcePath = [IO.Path]::GetFullPath([string]$config.source)
  $targetPath = [IO.Path]::GetFullPath([string]$config.target)
  $parentPath = [IO.Path]::GetDirectoryName($targetPath)
  if ($targetPath -eq [IO.Path]::GetPathRoot($targetPath) -or [IO.Path]::GetExtension($targetPath) -ne '.exe' -or !(Test-Path -LiteralPath $targetPath -PathType Leaf)) { throw 'Invalid portable target' }
  if ((Get-Item -LiteralPath $targetPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Portable target cannot be a link' }
  if ($sourcePath -eq $targetPath -or [string]$config.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid update plan' }
  if ((Get-UpdateHash $sourcePath) -ne $config.sha256) { throw 'Checksum mismatch' }
  $oldProcessId = [int]$config.processId
  if ($oldProcessId -lt 1) { throw 'Invalid process identifier' }
  [IO.File]::WriteAllText((Join-Path ([IO.Path]::GetDirectoryName($Plan)) 'ready'), 'ready', [Text.Encoding]::UTF8)
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  while (Get-Process -Id $oldProcessId -ErrorAction SilentlyContinue) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'FreeCut is still running; update was not installed' }
    Start-Sleep -Milliseconds 300
  }
  $token = [Guid]::NewGuid().ToString('N')
  $stagePath = Join-Path $parentPath ".freecut-update-$token.exe"
  $backupPath = Join-Path $parentPath ".freecut-backup-$token.exe"
  Copy-Item -LiteralPath $sourcePath -Destination $stagePath
  if ((Get-UpdateHash $stagePath) -ne $config.sha256) { throw 'Staged file checksum mismatch' }
  Move-Item -LiteralPath $targetPath -Destination $backupPath
  try { Move-Item -LiteralPath $stagePath -Destination $targetPath } catch { Move-Item -LiteralPath $backupPath -Destination $targetPath; throw }
  $replacementInstalled = $true
  # Hide a transient console; FreeCut opens its own application window.
  $started = Start-Process -FilePath $targetPath -WorkingDirectory $parentPath -WindowStyle Hidden -PassThru
  if ($started.WaitForExit(1500) -and $started.ExitCode -ne 0) { throw "Updated application exited with error $($started.ExitCode)" }
  $replacementInstalled = $false
  Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $sourcePath -Force -ErrorAction SilentlyContinue
  Set-Content -LiteralPath (Join-Path (Split-Path -Parent $Plan) 'result.txt') -Value 'Update installed'
} catch {
  $failure = $_ | Out-String
  if ($replacementInstalled -and $backupPath -and (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
    try {
      if (Test-Path -LiteralPath $targetPath -PathType Leaf) { Remove-Item -LiteralPath $targetPath -Force }
      Move-Item -LiteralPath $backupPath -Destination $targetPath
      $failure += "`nPrevious application restored."
    } catch { $failure += "`nAutomatic restore failed. Previous application remains at: $backupPath`n$($_ | Out-String)" }
  }
  Set-Content -LiteralPath (Join-Path (Split-Path -Parent $Plan) 'error.txt') -Value $failure
  if ($stagePath -and (Test-Path -LiteralPath $stagePath)) { Remove-Item -LiteralPath $stagePath -Force -ErrorAction SilentlyContinue }
  if (!$Quiet) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('自动更新未完成，已尝试恢复原程序，工程数据没有改动。请查看更新目录内的 error.txt 后重试。', 'FreeCut 更新') | Out-Null
  }
  exit 1
}
