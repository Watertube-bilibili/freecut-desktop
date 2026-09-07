# Hidden launcher adapted from electron-builder portable.nsi:
# https://registry.npmjs.org/app-builder-lib/-/app-builder-lib-26.15.3.tgz
# Source path inside that versioned package: templates/nsis/portable.nsi
# MIT License — Copyright (c) 2015 Loopline Systems
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
#
# No NSIS wizard pages, shortcuts or registry edits. The product's own Electron
# process opens installer/main.cjs and performs the validated transaction.
# $PLUGINSDIR is generated per launch, never supplied by a command-line argument.
!include "common.nsh"
!include "extractAppPackage.nsh"
CRCCheck on
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel user
SilentInstall silent
!ifdef MUI_ICON
  Icon "${MUI_ICON}"
!endif

Function .onInit
  SetSilent silent
  InitPluginsDir
  !insertmacro check64BitAndSetRegView
FunctionEnd

Section
  StrCpy $INSTDIR "$PLUGINSDIR\app"
  SetOutPath $INSTDIR
  !insertmacro extractEmbeddedAppPackage
  # Avoid inheriting portable mode from the process which requested the update.
  System::Call 'Kernel32::SetEnvironmentVariable(t, p)i ("PORTABLE_EXECUTABLE_DIR", 0).r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, p)i ("PORTABLE_EXECUTABLE_FILE", 0).r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, p)i ("PORTABLE_EXECUTABLE_APP_FILENAME", 0).r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, p)i ("ELECTRON_RUN_AS_NODE", 0).r0'
  ${StdUtils.GetAllParameters} $R0 0
  ClearErrors
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --installer $R0' $0
  IfErrors launchFailed
  SetErrorLevel $0
  Goto cleanup
launchFailed:
  SetErrorLevel 1
cleanup:
  SetOutPath $EXEDIR
  # Only our generated temporary child; never the destination chosen by the user.
  RMDir /r "$INSTDIR"
SectionEnd
