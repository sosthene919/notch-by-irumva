; Notch by IRUMVA — NSIS hooks (documented Tauri extension point: installerHooks).
; Created by IRUMVA Sosthene. Built with Muse AI and Claude Sonnet.

!macro NSIS_HOOK_PREUNINSTALL
  ; Stop the running process before files are removed.
  nsExec::Exec 'taskkill /F /IM notch.exe'
  ; Remove the autostart entry if first-run setup created one.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Notch by IRUMVA"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Notch by IRUMVA"
  ; User data (%LOCALAPPDATA%\com.irumva.notch, incl. WebView2 cache) is kept by default.
  ; The "delete user data" opt-in checkbox requires a custom NSIS template (Phase 6, ASSUMPTIONS A4).
!macroend
