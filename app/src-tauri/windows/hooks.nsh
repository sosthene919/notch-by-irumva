; Notch by IRUMVA — NSIS hooks (documented Tauri extension point: installerHooks).
; Created by IRUMVA Sosthene. Built with Muse AI and Claude Sonnet.

!macro NSIS_HOOK_PREINSTALL
  ; One installer at a time: a second Setup.exe stops here instead of
  ; racing the first one's file copies.
  System::Call 'kernel32::CreateMutex(p 0, i 0, t "NotchByIrumvaSetupMutex") p .r0 ? e'
  Pop $R9
  StrCmp $R9 183 0 NotchMutexOk
    MessageBox MB_ICONSTOP|MB_OK "Notch Setup is already running. Finish that one first."
    Abort
  NotchMutexOk:

  ; Close the running app gracefully first (it restores notification
  ; banners and clears its crash marker), force only if it lingers.
  nsExec::Exec 'powershell -NoProfile -WindowStyle Hidden -Command "Get-Process notch -ErrorAction SilentlyContinue | ForEach-Object { $$_.CloseMainWindow() | Out-Null }"'
  Sleep 1500
  nsExec::Exec 'taskkill /F /IM notch.exe'
  Sleep 500

  ; Rollback store: before the template overwrites anything, keep the
  ; previous binary and a copy of the user data. The app restores
  ; these itself if the new build fails to start (3 crashes).
  IfFileExists "$INSTDIR\notch.exe" 0 NotchNoBackup
    CreateDirectory "$APPDATA\com.irumva.notch\rollback\data\lyrics"
    CopyFiles /SILENT "$INSTDIR\notch.exe" "$APPDATA\com.irumva.notch\rollback\notch-prev.exe"
    ReadRegStr $R8 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Notch by IRUMVA" "DisplayVersion"
    FileOpen $R7 "$APPDATA\com.irumva.notch\rollback\version.txt" w
    FileWrite $R7 "$R8"
    FileClose $R7
    IfFileExists "$APPDATA\com.irumva.notch\settings.dpapi" 0 +2
      CopyFiles /SILENT "$APPDATA\com.irumva.notch\settings.dpapi" "$APPDATA\com.irumva.notch\rollback\data\settings.dpapi"
    IfFileExists "$APPDATA\com.irumva.notch\clients.dpapi" 0 +2
      CopyFiles /SILENT "$APPDATA\com.irumva.notch\clients.dpapi" "$APPDATA\com.irumva.notch\rollback\data\clients.dpapi"
    IfFileExists "$APPDATA\com.irumva.notch\lyrics\*.*" 0 +2
      CopyFiles /SILENT "$APPDATA\com.irumva.notch\lyrics\*.*" "$APPDATA\com.irumva.notch\rollback\data\lyrics\"
  NotchNoBackup:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; A killed installer must not count as an app crash on next launch.
  Delete "$APPDATA\com.irumva.notch\session.running"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Stop the running process before files are removed.
  nsExec::Exec 'taskkill /F /IM notch.exe'
  ; If notification takeover was on, hand Windows its toast banners back
  ; (original value recorded by the app in its own registry key).
  ReadRegDWORD $0 HKCU "Software\Notch by IRUMVA" "TakeoverActive"
  StrCmp $0 "1" 0 +3
  ReadRegDWORD $1 HKCU "Software\Notch by IRUMVA" "OriginalToastsEnabled"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Notifications\Settings" "NOC_GLOBAL_SETTING_TOASTS_ENABLED" $1
  DeleteRegKey HKCU "Software\Notch by IRUMVA"
  ; Remove the autostart entry if first-run setup created one.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Notch by IRUMVA"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Notch by IRUMVA"
  ; Temp snapshots the notification watcher made (the OS would clean
  ; these eventually; uninstall does it now).
  nsExec::Exec 'powershell -NoProfile -WindowStyle Hidden -Command "Get-ChildItem $env:TEMP -Directory -Filter notch-wpn-* -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue"'
  ; User data (%APPDATA%\com.irumva.notch and %LOCALAPPDATA%\com.irumva.notch,
  ; incl. settings, reminders, shelf, lyrics cache, backups and WebView2
  ; cache) is kept by default. The stock Tauri NSIS template shows an
  ; opt-in "Delete app data" checkbox on the uninstall confirm page;
  ; when checked it removes both folders. No custom template.
!macroend
