# Uninstall leftovers check.
# Snapshots install artifacts, silent-installs, verifies they exist,
# silent-uninstalls, and fails if anything the installer created is
# still there. User data is kept by design (the "Delete app data" box
# is interactive-only); this script checks installer artifacts only.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\check-uninstall.ps1 -Setup <path-to-Setup.exe>
param([Parameter(Mandatory = $true)][string]$Setup)
$ErrorActionPreference = 'Stop'

$installDir = Join-Path $env:LOCALAPPDATA 'Notch by IRUMVA'
$uninstKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Notch by IRUMVA'
$notchKey = 'HKCU:\Software\Notch by IRUMVA'
$startLnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Notch by IRUMVA.lnk'

function Get-State {
    @{
        InstallDir = Test-Path $installDir
        NotchExe = Test-Path (Join-Path $installDir 'notch.exe')
        UninstallKey = Test-Path $uninstKey
        StartMenuLink = Test-Path $startLnk
        Running = [bool](Get-Process notch -ErrorAction SilentlyContinue)
    }
}

Write-Host '== Before =='
$before = Get-State
$before | Format-Table -AutoSize
if ($before.InstallDir -or $before.UninstallKey) {
    Write-Warning 'A previous install exists; it will be replaced by this check and uninstalled at the end.'
}

Write-Host '== Silent install =='
$p = Start-Process $Setup -ArgumentList '/S' -PassThru -Wait
Write-Host "installer exit: $($p.ExitCode)"
Start-Sleep -Seconds 2
$mid = Get-State
$mid | Format-Table -AutoSize
if (-not $mid.NotchExe -or -not $mid.UninstallKey -or -not $mid.StartMenuLink) {
    throw 'install did not create the expected artifacts'
}
$ver = (Get-ItemProperty $uninstKey).DisplayVersion
$pub = (Get-ItemProperty $uninstKey).Publisher
Write-Host "registered: version=$ver publisher=$pub"
if (-not $ver -or -not $pub) { throw 'uninstall entry is missing version or publisher' }

Write-Host '== Silent uninstall =='
$un = Join-Path $installDir 'uninstall.exe'
$u = Start-Process $un -ArgumentList '/S' -PassThru -Wait
Write-Host "uninstaller exit: $($u.ExitCode)"
Start-Sleep -Seconds 2
$after = Get-State
$after | Format-Table -AutoSize

$leftovers = @()
if ($after.InstallDir) { $leftovers += 'install directory' }
if ($after.UninstallKey) { $leftovers += 'uninstall registry key' }
if ($after.StartMenuLink) { $leftovers += 'Start Menu shortcut' }
if ($after.Running) { $leftovers += 'running process' }
if (Test-Path $notchKey) { $leftovers += 'app registry key (HKCU\Software\Notch by IRUMVA)' }
$tempLeft = Get-ChildItem $env:TEMP -Directory -Filter 'notch-wpn-*' -ErrorAction SilentlyContinue
if ($tempLeft) { $leftovers += 'watcher temp folders' }

if ($leftovers.Count -gt 0) {
    Write-Error "LEFTOVERS: $($leftovers -join ', ')"
    exit 1
}
Write-Host 'PASS: nothing left behind (user data kept by design).'
