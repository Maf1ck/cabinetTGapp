; Custom NSIS hooks for the "Kabinet" installer (wired via nsis.include in package.json).
;
; Per-user install only, no admin rights needed.
; If a local fixed drive D: exists, the default folder is D:\Programs\cabinet-desktop
; (the user can still change it); otherwise the stock %LOCALAPPDATA%\Programs is used.

!macro preInit
  ; .onInit also runs on the build machine to generate the uninstaller: skip it there
  !ifndef BUILD_UNINSTALLER
    ; reinstall/update keeps the folder chosen before
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $0 == ""
      ; 3 = DRIVE_FIXED (not a USB stick or CD drive)
      System::Call 'kernel32::GetDriveTypeW(w "D:\") i .r1'
      ${If} $1 == 3
        ; the stock template reads the initial folder from this value
        WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "D:\Programs\${APP_FILENAME}"
      ${EndIf}
    ${EndIf}
  !endif
!macroend

; No "just me / all users" page: "all users" needs admin and installs to Program Files on C:
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; The template keeps a ~120 MB installer copy in %LOCALAPPDATA% for auto-updates.
; The app has no auto-updates (the site updates itself), so free that space on C:.
!macro customInstall
  RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
!macroend
