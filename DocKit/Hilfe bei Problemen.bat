@echo off
rem ---------------------------------------------------------------
rem  Startet DocKit mit sichtbarem Fenster.
rem  Nur benutzen, wenn der normale Start nicht funktioniert:
rem  Fehlermeldungen bleiben dann in diesem Fenster stehen.
rem ---------------------------------------------------------------
title DocKit - Start mit Meldungen
echo.
echo   DocKit wird gestartet. Dieses Fenster offen lassen.
echo   Zum Beenden: Rechtsklick auf das Symbol unten rechts.
echo.
echo   PowerShell-Version:
powershell.exe -NoProfile -Command "$PSVersionTable.PSVersion.ToString()"
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0Programm\DocKit.ps1"
echo.
echo   Das Programm wurde beendet.
pause
