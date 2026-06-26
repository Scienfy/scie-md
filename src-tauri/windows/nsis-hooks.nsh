!macro RegisterScieMdMarkdownOpenWith
  WriteRegStr HKCU "Software\Classes\ScieMD.Markdown" "" "ScieMD Markdown document"
  WriteRegStr HKCU "Software\Classes\ScieMD.Markdown\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\ScieMD.Markdown\shell" "" "open"
  WriteRegStr HKCU "Software\Classes\ScieMD.Markdown\shell\open" "" "Open with ${PRODUCTNAME}"
  WriteRegStr HKCU "Software\Classes\ScieMD.Markdown\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""

  WriteRegStr HKCU "Software\Classes\.md\OpenWithProgids" "ScieMD.Markdown" ""
  WriteRegStr HKCU "Software\Classes\.markdown\OpenWithProgids" "ScieMD.Markdown" ""

  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "" "${PRODUCTNAME}"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".md" ""
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".markdown" ""

  WriteRegStr HKCU "Software\${MANUFACTURER}\${PRODUCTNAME}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr HKCU "Software\${MANUFACTURER}\${PRODUCTNAME}\Capabilities" "ApplicationDescription" "ScieMD scientific Markdown editor"
  WriteRegStr HKCU "Software\${MANUFACTURER}\${PRODUCTNAME}\Capabilities\FileAssociations" ".md" "ScieMD.Markdown"
  WriteRegStr HKCU "Software\${MANUFACTURER}\${PRODUCTNAME}\Capabilities\FileAssociations" ".markdown" "ScieMD.Markdown"
  WriteRegStr HKCU "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\${MANUFACTURER}\${PRODUCTNAME}\Capabilities"
!macroend

!macro UnregisterScieMdMarkdownOpenWith
  DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "ScieMD.Markdown"
  DeleteRegValue HKCU "Software\Classes\.markdown\OpenWithProgids" "ScieMD.Markdown"
  DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "${PRODUCTNAME}"
  DeleteRegKey HKCU "Software\${MANUFACTURER}\${PRODUCTNAME}\Capabilities"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro RegisterScieMdMarkdownOpenWith
  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro UnregisterScieMdMarkdownOpenWith
  !insertmacro UPDATEFILEASSOC
!macroend
