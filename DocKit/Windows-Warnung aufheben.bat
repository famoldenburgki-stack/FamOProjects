@echo off
rem ---------------------------------------------------------------
rem  Windows haengt an jede Datei, die aus dem Internet oder aus
rem  einer heruntergeladenen ZIP-Datei stammt, eine Herkunftsmarke.
rem  Sie ist der Grund fuer die Warnung "Der Computer wurde durch
rem  Windows geschuetzt - Unbekannter Herausgeber".
rem
rem  Dieser Aufruf entfernt die Marke von allen Dateien daneben.
rem  Er braucht keine Administratorrechte und aendert nichts am
rem  Rechner - nur die Markierung an diesen Dateien.
rem ---------------------------------------------------------------
echo.
echo   Herkunftsmarkierung wird entfernt ...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File | Unblock-File; Write-Host '   Fertig. DocKit laesst sich jetzt starten.'"
echo.
pause
