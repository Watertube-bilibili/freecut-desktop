param([Parameter(Mandatory=$true)][string]$PlanPath)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FreeCutIconRefresh {
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
    public static extern void SHChangeNotify(int eventId, uint flags, string item1, IntPtr item2);
}
'@
$plan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($item in $plan.items) {
    $itemPath = [IO.Path]::GetFullPath([string]$item.path)
    if (-not (Test-Path -LiteralPath $itemPath -PathType Leaf)) { throw 'Shortcut refresh target is missing.' }
    # SHCNE_CREATE / SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSHNOWAIT.
    $eventId = if ($item.created) { 2 } else { 0x2000 }
    [FreeCutIconRefresh]::SHChangeNotify($eventId, 0x3005, $itemPath, [IntPtr]::Zero)
}
if (@($plan.items).Count -gt 0) {
    # Also invalidate Explorer's icon cache; changing the link alone can leave a
    # stale placeholder on an already open desktop. No cache files are deleted.
    [FreeCutIconRefresh]::SHChangeNotify(0x08000000, 0x3000, $null, [IntPtr]::Zero)
}
