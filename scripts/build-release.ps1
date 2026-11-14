# Notch by IRUMVA — clean release build.
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1 [-SkipTests] [-CertThumbprint <thumbprint>]
# Without a certificate the build is unsigned (expected for now; see
# docs/RELEASE_PLAN.md). With -CertThumbprint (or $env:NOTCH_CERT_THUMBPRINT)
# Tauri signs the app and the installer with SHA-256 + timestamp.
param(
    [switch]$SkipTests,
    [string]$CertThumbprint = $env:NOTCH_CERT_THUMBPRINT
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$app = Join-Path $root 'app'

function Read-Version([string]$file, [string]$pattern) {
    $m = Select-String -Path $file -Pattern $pattern | Select-Object -First 1
    if (-not $m) { throw "version not found in $file" }
    return $m.Matches[0].Groups[1].Value
}

Write-Host '== Version sync check =='
$vPkg = Read-Version (Join-Path $app 'package.json') '"version":\s*"([^"]+)"'
$vConf = Read-Version (Join-Path $app 'src-tauri\tauri.conf.json') '"version":\s*"([^"]+)"'
$vCargo = Read-Version (Join-Path $app 'src-tauri\Cargo.toml') '(?m)^version = "([^"]+)"'
if ($vPkg -ne $vConf -or $vPkg -ne $vCargo) {
    throw "Version mismatch: package.json=$vPkg tauri.conf.json=$vConf Cargo.toml=$vCargo. Bump all three (semver)."
}
$version = $vPkg
Write-Host "Version $version"

Write-Host '== Install dependencies (lockfile) =='
Push-Location $app
try {
    npm ci
    if (-not $SkipTests) {
        Write-Host '== Tests: TypeScript =='
        npm test
        Write-Host '== Tests: Rust =='
        Push-Location (Join-Path $app 'src-tauri')
        try { cargo test --lib } finally { Pop-Location }
        Write-Host '== Contrast checks =='
        node (Join-Path $root 'scripts\contrast.mjs')
    }

    Write-Host '== Dependency audit (report only) =='
    npm audit --audit-level=high 2>&1 | Select-Object -Last 5
    if (Get-Command cargo-audit -ErrorAction SilentlyContinue) {
        Push-Location (Join-Path $app 'src-tauri')
        try { cargo audit 2>&1 | Select-Object -Last 5 } finally { Pop-Location }
    } else {
        Write-Warning 'cargo-audit not installed; skipping. Install with: cargo install cargo-audit'
    }

    Write-Host '== SBOM =='
    node (Join-Path $root 'scripts\sbom.mjs')

    Write-Host '== Build =='
    if ($CertThumbprint) {
        $signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $signtool) { throw 'Signing requested but signtool.exe (Windows SDK) was not found.' }
        $cfg = Join-Path $env:TEMP 'notch-signing.json'
        @{
            bundle = @{
                windows = @{
                    certificateThumbprint = $CertThumbprint
                    timestampUrl = 'http://timestamp.digicert.com'
                    digestAlgorithm = 'sha256'
                    tsp = $true
                }
            }
        } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $cfg
        npm run tauri -- build --config $cfg
        Remove-Item $cfg -Force
    } else {
        Write-Warning 'No certificate: building UNSIGNED. Users will see a SmartScreen prompt (see docs/RELEASE_PLAN.md).'
        npm run tauri -- build
    }
} finally {
    Pop-Location
}

Write-Host '== Checksums and release folder =='
$setup = Join-Path $app "src-tauri\target\release\bundle\nsis\Notch by IRUMVA_${version}_x64-setup.exe"
$exe = Join-Path $app 'src-tauri\target\release\notch.exe'
foreach ($f in @($setup, $exe)) {
    if (-not (Test-Path $f)) { throw "expected artifact missing: $f" }
}
$out = Join-Path $root "release\$version"
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item $setup $out -Force
Copy-Item (Join-Path $root 'sbom.json') $out -Force
$lines = foreach ($f in @((Join-Path $out (Split-Path $setup -Leaf)), $exe)) {
    $h = Get-FileHash $f -Algorithm SHA256
    "$($h.Hash.ToLower())  $(Split-Path $f -Leaf)"
}
# The shipped exe inside the installer is what Setup extracts; also
# record the standalone binary hash for the rollback store checks.
$lines | Set-Content -Encoding ASCII (Join-Path $out 'SHA256SUMS.txt')
$lines | ForEach-Object { Write-Host $_ }
Write-Host "Release ready in $out"
