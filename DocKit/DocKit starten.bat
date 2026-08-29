@echo off
rem ---------------------------------------------------------------
rem  DocKit starten.
rem  Doppelklick genuegt. Es wird nichts installiert.
rem  Das Programm legt sich als Symbol in den Infobereich der
rem  Taskleiste (unten rechts, evtl. hinter dem kleinen Pfeil).
rem ---------------------------------------------------------------
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0Programm\DocKit.ps1"
