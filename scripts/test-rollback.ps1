# Rollback drill (run on a machine where Notch is already installed).
# 1. Reinstalls the same Setup.exe: the installer must store the
#    previous binary and data in the rollback store.
# 2. Changes a setting (data now differs from the backup).
# 3. Simulates a crash streak (unclean-exit marker + count of 2), so
#    the next launch is the third strike and arms safe mode.
# 4. Triggers perform_rollback through the app's own command and
#    confirms the data file is byte-identical to the backup again and
#    the app is running.
# Needs WEBVIEW2 debug access, so it launches the app with the
# remote-debugging flag for the drill, then relaunches it clean.
param([Parameter(Mandatory = $true)][string]$Setup)
$ErrorActionPreference = 'Stop'

$dataDir = Join-Path $env:APPDATA 'com.irumva.notch'
$settingsFile = Join-Path $dataDir 'settings.dpapi'
$exe = Join-Path $env:LOCALAPPDATA 'Notch by IRUMVA\notch.exe'

function Hash-Settings { (Get-FileHash $settingsFile -Algorithm SHA256).Hash }

Write-Host '== Reinstall to create the rollback store =='
Stop-Process -Name notch -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$p = Start-Process $Setup -ArgumentList '/S' -PassThru -Wait
Write-Host "installer exit: $($p.ExitCode)"
$backupExe = Join-Path $dataDir 'rollback\notch-prev.exe'
$backupSettings = Join-Path $dataDir 'rollback\data\settings.dpapi'
if (-not (Test-Path $backupExe)) { throw 'rollback store has no previous binary' }
if (-not (Test-Path $settingsFile)) { throw 'no settings file yet; run the app once by hand first' }
$hashAtBackup = Hash-Settings
Write-Host "settings hash at backup: $hashAtBackup"

Write-Host '== Launch and change a setting (theme to Light) =='
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223 --remote-allow-origins=*'
Start-Process $exe
Start-Sleep -Seconds 5
$py = @'
import websocket, json, time, sys
pages = __import__("urllib.request", fromlist=["x"])
import urllib.request
tid = [p["id"] for p in json.load(urllib.request.urlopen("http://localhost:9223/json/list", timeout=5)) if p.get("type") == "page"][0]
ws = websocket.create_connection(f"ws://localhost:9223/devtools/page/{tid}", timeout=15, suppress_origin=True)
i = [0]
def ev(expr, awaitp=False):
    i[0] += 1
    ws.send(json.dumps({"id": i[0], "method": "Runtime.evaluate", "params": {"expression": expr, "returnByValue": True, "awaitPromise": awaitp}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == i[0]:
            return m.get("result", {}).get("result", {}).get("value")
ev("window.location.assign('#/security')")
time.sleep(1.5)
clicked = ev("(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.innerText==='Light'); if(b){b.click(); return 'light clicked'} return 'button missing'})()")
print("theme:", clicked, flush=True)
time.sleep(1.2)
mode = sys.argv[1] if len(sys.argv) > 1 else ""
if mode == "rollback":
    info = ev("window.__TAURI_INTERNALS__.invoke('get_startup_info').then(i => JSON.stringify(i))", True)
    print("startup info:", info, flush=True)
    r = ev("window.__TAURI_INTERNALS__.invoke('perform_rollback').then(x => 'rollback: ' + x).catch(e => 'rollback ERR ' + e)", True)
    print(r, flush=True)
ws.close()
'@
$pyFile = Join-Path $env:TEMP 'notch-drill.py'
$py | Set-Content -Encoding UTF8 $pyFile
python3 $pyFile
Start-Sleep -Seconds 1
$hashAfterChange = Hash-Settings
Write-Host "settings hash after change: $hashAfterChange"
if ($hashAfterChange -eq $hashAtBackup) { throw 'setting change did not reach disk' }

Write-Host '== Simulate crash streak and trigger rollback =='
Get-Process notch -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }
Start-Sleep -Seconds 2
Stop-Process -Name notch -Force -ErrorAction SilentlyContinue
Set-Content -Path (Join-Path $dataDir 'session.running') -Value '1' -NoNewline
Set-Content -Path (Join-Path $dataDir 'crash-count.txt') -Value '2' -NoNewline
Start-Process $exe
Start-Sleep -Seconds 5
python3 $pyFile rollback
Start-Sleep -Seconds 5
$running = Get-Process notch -ErrorAction SilentlyContinue
$hashRestored = Hash-Settings
Write-Host "app running after rollback: $([bool]$running)"
Write-Host "settings hash after rollback: $hashRestored"
if (-not $running) { throw 'app is not running after rollback' }
if ($hashRestored -ne $hashAtBackup) { throw 'settings were not restored from the backup' }

Write-Host '== Clean up drill state and relaunch clean =='
Get-Process notch -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }
Start-Sleep -Seconds 2
Stop-Process -Name notch -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dataDir 'session.running') -Force -ErrorAction SilentlyContinue
Set-Content -Path (Join-Path $dataDir 'crash-count.txt') -Value '0' -NoNewline
Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
Start-Process $exe
Write-Host 'PASS: rollback restored the previous data and the app runs.'
