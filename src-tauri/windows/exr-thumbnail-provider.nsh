!define PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID "{4D64B0F7-4E7E-49E2-8F8C-1DB4B1EF6C15}"
!define PRISMIFOLD_THUMBNAIL_PROVIDER_HANDLER "{e357fccd-a995-4576-b01f-234630154e96}"
!define PRISMIFOLD_EXR_PROGID "Prismifold.OpenEXR"
!define PRISMIFOLD_EXR_FILE_TYPE_NAME "OpenEXR Image"
!define PRISMIFOLD_EXR_CAPABILITIES_PATH "Software\Prismifold\Capabilities"

!macro PRISMIFOLD_EXR_THUMBNAIL_SET_REGVIEW
  !if "${ARCH}" == "x64"
    SetRegView 64
  !endif
  !if "${ARCH}" == "arm64"
    SetRegView 64
  !endif
!macroend

!macro PRISMIFOLD_EXR_THUMBNAIL_NOTIFY_SHELL
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend

!macro PRISMIFOLD_EXR_THUMBNAIL_REMOVE_OLD_ASSOCIATION_IF_DEFAULT FILECLASS
  ReadRegStr $R0 SHCTX "Software\Classes\.exr" ""
  ${If} $R0 == "${FILECLASS}"
    DeleteRegValue SHCTX "Software\Classes\.exr" ""
    DeleteRegKey SHCTX "Software\Classes\${FILECLASS}"
  ${EndIf}
!macroend

!macro PRISMIFOLD_EXR_REGISTER_APP_HANDLER
  WriteRegStr SHCTX "Software\Classes\.exr\OpenWithProgids" "${PRISMIFOLD_EXR_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\${PRISMIFOLD_EXR_PROGID}" "" "${PRISMIFOLD_EXR_FILE_TYPE_NAME}"
  WriteRegStr SHCTX "Software\Classes\${PRISMIFOLD_EXR_PROGID}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\${PRISMIFOLD_EXR_PROGID}\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\${PRISMIFOLD_EXR_PROGID}\shell\open" "" "Open with ${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\${PRISMIFOLD_EXR_PROGID}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""

  WriteRegStr SHCTX "${PRISMIFOLD_EXR_CAPABILITIES_PATH}" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${PRISMIFOLD_EXR_CAPABILITIES_PATH}" "ApplicationDescription" "${PRODUCTNAME} OpenEXR image viewer"
  WriteRegStr SHCTX "${PRISMIFOLD_EXR_CAPABILITIES_PATH}\FileAssociations" ".exr" "${PRISMIFOLD_EXR_PROGID}"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "${PRISMIFOLD_EXR_CAPABILITIES_PATH}"

  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\App Paths\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\App Paths\${MAINBINARYNAME}.exe" "Path" "$INSTDIR"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".exr" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
!macroend

!macro PRISMIFOLD_EXR_UNREGISTER_APP_HANDLER
  DeleteRegValue SHCTX "Software\Classes\.exr\OpenWithProgids" "${PRISMIFOLD_EXR_PROGID}"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.exr\OpenWithProgids"
  DeleteRegKey SHCTX "Software\Classes\${PRISMIFOLD_EXR_PROGID}"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
  DeleteRegKey SHCTX "${PRISMIFOLD_EXR_CAPABILITIES_PATH}"
  DeleteRegKey /ifempty SHCTX "Software\Prismifold"
  DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\App Paths\${MAINBINARYNAME}.exe"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro PRISMIFOLD_EXR_THUMBNAIL_SET_REGVIEW
  !insertmacro PRISMIFOLD_EXR_THUMBNAIL_REMOVE_OLD_ASSOCIATION_IF_DEFAULT "OpenEXR Image"
  !insertmacro PRISMIFOLD_EXR_THUMBNAIL_REMOVE_OLD_ASSOCIATION_IF_DEFAULT "Prismifold.exr"
  DeleteRegKey SHCTX "Software\Classes\Prismifold.exr"

  !insertmacro PRISMIFOLD_EXR_REGISTER_APP_HANDLER
  WriteRegStr SHCTX "Software\Classes\.exr\ShellEx\${PRISMIFOLD_THUMBNAIL_PROVIDER_HANDLER}" "" "${PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID}"
  WriteRegStr SHCTX "Software\Classes\CLSID\${PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID}" "" "Prismifold EXR Thumbnail Provider"
  WriteRegStr SHCTX "Software\Classes\CLSID\${PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID}\InprocServer32" "" "$INSTDIR\prismifold_exr_thumbnail.dll"
  WriteRegStr SHCTX "Software\Classes\CLSID\${PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID}\InprocServer32" "ThreadingModel" "Apartment"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved" "${PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID}" "Prismifold EXR Thumbnail Provider"
  !insertmacro PRISMIFOLD_EXR_THUMBNAIL_NOTIFY_SHELL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro PRISMIFOLD_EXR_THUMBNAIL_SET_REGVIEW
  !insertmacro PRISMIFOLD_EXR_UNREGISTER_APP_HANDLER
  DeleteRegKey SHCTX "Software\Classes\.exr\ShellEx\${PRISMIFOLD_THUMBNAIL_PROVIDER_HANDLER}"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.exr\ShellEx"
  DeleteRegKey SHCTX "Software\Classes\CLSID\${PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID}"
  DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved" "${PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID}"
  !insertmacro PRISMIFOLD_EXR_THUMBNAIL_NOTIFY_SHELL
!macroend
