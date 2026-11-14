<# Launch Notch as a native desktop app (Tauri window at the top of the
   screen), not as a web page in a browser.

   Uses the already-built release binary when present. Otherwise falls back
   to `npm run tauri dev`, which needs Rust and VS C++ Build Tools.

   Usage: powershell -ExecutionPolicy Bypass -File prototype\launch-native.ps1
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $root 'app\src-tauri\target\release\notch.exe'

if (Test-Path $exe) {
    Start-Process $exe
    Write-Host "Launched native app: $exe"
    Write-Host 'The island sits at the top-center of the screen. Hover or click it to expand. Close it from its window or with: Stop-Process -Name notch'
} else {
    Write-Host 'No release binary found. Starting the Tauri dev shell (first build takes a few minutes)...'
    Push-Location (Join-Path $root 'app')
    try { npm run tauri dev } finally { Pop-Location }
}
