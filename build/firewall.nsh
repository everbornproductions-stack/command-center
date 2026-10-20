; Inbound allow for Meldmind on Private networks only. A failure here does not stop install;
; the app tries the same rule again the first time phone pairing is turned on.
!macro customInstall
  nsExec::ExecToLog '$SYSDIR\netsh.exe advfirewall firewall delete rule name="Meldmind phone pairing"'
  Pop $0
  nsExec::ExecToLog '$SYSDIR\netsh.exe advfirewall firewall add rule name="Meldmind phone pairing" dir=in action=allow program="$INSTDIR\Meldmind.exe" profile=private enable=yes'
  Pop $0
!macroend

!macro customUnInstall
  nsExec::ExecToLog '$SYSDIR\netsh.exe advfirewall firewall delete rule name="Meldmind phone pairing"'
  Pop $0
!macroend
