!macro RegisterScieMdDocumentProgId PROGID DESCRIPTION
  WriteRegStr HKCU "Software\Classes\${PROGID}" "" "${DESCRIPTION}"
  WriteRegStr HKCU "Software\Classes\${PROGID}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\${PROGID}\shell" "" "open"
  WriteRegStr HKCU "Software\Classes\${PROGID}\shell\open" "" "Open with ${PRODUCTNAME}"
  WriteRegStr HKCU "Software\Classes\${PROGID}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
!macroend

!macro RegisterScieMdDocumentExtension EXT PROGID
  WriteRegStr HKCU "Software\Classes\.${EXT}" "" "${PROGID}"
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}" ""
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
  WriteRegStr HKCU "Software\${MANUFACTURER}\${PRODUCTNAME}\Capabilities\FileAssociations" ".${EXT}" "${PROGID}"
!macroend

!macro UnregisterScieMdDocumentExtension EXT PROGID
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  DeleteRegValue HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}"
  DeleteRegValue HKCU "Software\${MANUFACTURER}\${PRODUCTNAME}\Capabilities\FileAssociations" ".${EXT}"
  ReadRegStr $0 HKCU "Software\Classes\.${EXT}" ""
  StrCmp $0 "${PROGID}" 0 +2
  DeleteRegValue HKCU "Software\Classes\.${EXT}" ""
!macroend

!macro ClearLegacyScieMdCsvAssociation
  !insertmacro UnregisterScieMdDocumentExtension "csv" "ScieMD.CSV"
  !insertmacro UnregisterScieMdDocumentExtension "csv" "ScieMD.csv"
  DeleteRegKey HKCU "Software\Classes\ScieMD.CSV"
  DeleteRegKey HKCU "Software\Classes\ScieMD.csv"
!macroend

!macro PromptForScieMdDefaultAppsSelection
  IfSilent ScieMdDefaultAppsPromptDone
  MessageBox MB_YESNO|MB_ICONQUESTION "ScieMD is registered for Markdown, JSON, JSONL, YAML, TOML, XML, TSV, and plain text files.$\r$\n$\r$\nWindows requires default app changes to be approved in Windows Settings. Open Default Apps now so you can choose ScieMD for those file types?" IDNO ScieMdDefaultAppsPromptDone
  ExecShell "open" "ms-settings:defaultapps?registeredAppUser=${PRODUCTNAME}"
ScieMdDefaultAppsPromptDone:
!macroend

!macro RegisterScieMdDocumentOpenWith
  !insertmacro ClearLegacyScieMdCsvAssociation

  !insertmacro RegisterScieMdDocumentProgId "ScieMD.Markdown" "ScieMD Markdown document"
  !insertmacro RegisterScieMdDocumentProgId "ScieMD.JSON" "ScieMD JSON document"
  !insertmacro RegisterScieMdDocumentProgId "ScieMD.JSONLines" "ScieMD JSON Lines document"
  !insertmacro RegisterScieMdDocumentProgId "ScieMD.YAML" "ScieMD YAML document"
  !insertmacro RegisterScieMdDocumentProgId "ScieMD.TOML" "ScieMD TOML document"
  !insertmacro RegisterScieMdDocumentProgId "ScieMD.XML" "ScieMD XML document"
  !insertmacro RegisterScieMdDocumentProgId "ScieMD.TSV" "ScieMD TSV document"
  !insertmacro RegisterScieMdDocumentProgId "ScieMD.PlainText" "ScieMD plain text document"

  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "" "${PRODUCTNAME}"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""

  WriteRegStr HKCU "Software\${MANUFACTURER}\${PRODUCTNAME}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr HKCU "Software\${MANUFACTURER}\${PRODUCTNAME}\Capabilities" "ApplicationDescription" "ScieMD local-first Markdown and structured data editor"
  WriteRegStr HKCU "Software\${MANUFACTURER}\${PRODUCTNAME}\Capabilities" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"

  !insertmacro RegisterScieMdDocumentExtension "md" "ScieMD.Markdown"
  !insertmacro RegisterScieMdDocumentExtension "markdown" "ScieMD.Markdown"
  !insertmacro RegisterScieMdDocumentExtension "json" "ScieMD.JSON"
  !insertmacro RegisterScieMdDocumentExtension "jsonl" "ScieMD.JSONLines"
  !insertmacro RegisterScieMdDocumentExtension "ndjson" "ScieMD.JSONLines"
  !insertmacro RegisterScieMdDocumentExtension "yaml" "ScieMD.YAML"
  !insertmacro RegisterScieMdDocumentExtension "yml" "ScieMD.YAML"
  !insertmacro RegisterScieMdDocumentExtension "toml" "ScieMD.TOML"
  !insertmacro RegisterScieMdDocumentExtension "xml" "ScieMD.XML"
  !insertmacro RegisterScieMdDocumentExtension "tsv" "ScieMD.TSV"
  !insertmacro RegisterScieMdDocumentExtension "txt" "ScieMD.PlainText"
  !insertmacro RegisterScieMdDocumentExtension "text" "ScieMD.PlainText"

  WriteRegStr HKCU "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\${MANUFACTURER}\${PRODUCTNAME}\Capabilities"
!macroend

!macro UnregisterScieMdDocumentOpenWith
  !insertmacro UnregisterScieMdDocumentExtension "md" "ScieMD.Markdown"
  !insertmacro UnregisterScieMdDocumentExtension "markdown" "ScieMD.Markdown"
  !insertmacro UnregisterScieMdDocumentExtension "json" "ScieMD.JSON"
  !insertmacro UnregisterScieMdDocumentExtension "jsonl" "ScieMD.JSONLines"
  !insertmacro UnregisterScieMdDocumentExtension "ndjson" "ScieMD.JSONLines"
  !insertmacro UnregisterScieMdDocumentExtension "yaml" "ScieMD.YAML"
  !insertmacro UnregisterScieMdDocumentExtension "yml" "ScieMD.YAML"
  !insertmacro UnregisterScieMdDocumentExtension "toml" "ScieMD.TOML"
  !insertmacro UnregisterScieMdDocumentExtension "xml" "ScieMD.XML"
  !insertmacro UnregisterScieMdDocumentExtension "tsv" "ScieMD.TSV"
  !insertmacro UnregisterScieMdDocumentExtension "txt" "ScieMD.PlainText"
  !insertmacro UnregisterScieMdDocumentExtension "text" "ScieMD.PlainText"
  !insertmacro ClearLegacyScieMdCsvAssociation

  DeleteRegKey HKCU "Software\Classes\ScieMD.Markdown"
  DeleteRegKey HKCU "Software\Classes\ScieMD.JSON"
  DeleteRegKey HKCU "Software\Classes\ScieMD.JSONLines"
  DeleteRegKey HKCU "Software\Classes\ScieMD.YAML"
  DeleteRegKey HKCU "Software\Classes\ScieMD.TOML"
  DeleteRegKey HKCU "Software\Classes\ScieMD.XML"
  DeleteRegKey HKCU "Software\Classes\ScieMD.TSV"
  DeleteRegKey HKCU "Software\Classes\ScieMD.PlainText"
  DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "${PRODUCTNAME}"
  DeleteRegKey HKCU "Software\${MANUFACTURER}\${PRODUCTNAME}\Capabilities"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro RegisterScieMdDocumentOpenWith
  !insertmacro UPDATEFILEASSOC
  !insertmacro PromptForScieMdDefaultAppsSelection
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro UnregisterScieMdDocumentOpenWith
  !insertmacro UPDATEFILEASSOC
!macroend
