; Keep the user's database when the app is removed or upgraded.
;
; The data directory is %APPDATA%\Glassfish Zero\data — an uninstall takes the
; program, never the recorded traces and cost history. Someone who wants it
; gone can delete the folder; someone who uninstalls to reinstall should not
; lose months of spend data to a routine action.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "Also delete your recorded traces and cost history?$\r$\n$\r$\nThis removes $APPDATA\${APP_FILENAME}\data and cannot be undone. Choose No to keep the data for a future reinstall." \
      /SD IDNO IDYES deleteData IDNO keepData
    deleteData:
      RMDir /r "$APPDATA\${APP_FILENAME}\data"
      Goto doneData
    keepData:
    doneData:
  ${endIf}
!macroend
