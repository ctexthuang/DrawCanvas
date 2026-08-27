!macro customRemoveFiles
  StrCpy $R8 "$INSTDIR.draw-canvas-data-preserved"

  IfFileExists "$INSTDIR\Draw Canvas Data\*.*" preserve_data remove_application

  preserve_data:
    IfFileExists "$R8\*.*" backup_exists backup_available

  backup_exists:
    MessageBox MB_ICONSTOP|MB_OK "Cannot uninstall safely because the data backup path already exists:$\r$\n$R8"
    Abort

  backup_available:
    Rename "$INSTDIR\Draw Canvas Data" "$R8"
    IfErrors preserve_failed preserve_ready

  preserve_failed:
    MessageBox MB_ICONSTOP|MB_OK "Cannot preserve Draw Canvas Data. The application was not removed."
    Abort

  preserve_ready:
    SetOutPath "$TEMP"
    RMDir /r "$INSTDIR"
    CreateDirectory "$INSTDIR"
    Rename "$R8" "$INSTDIR\Draw Canvas Data"
    IfErrors restore_failed remove_done

  restore_failed:
    MessageBox MB_ICONEXCLAMATION|MB_OK "The application was removed, but Draw Canvas Data remains at:$\r$\n$R8"
    Goto remove_done

  remove_application:
    SetOutPath "$TEMP"
    RMDir /r "$INSTDIR"

  remove_done:
!macroend
