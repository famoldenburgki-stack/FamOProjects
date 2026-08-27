@echo off
rem ---------------------------------------------------------------------------
rem Haelt den Server der App am Laufen. Wird beim Anmelden unsichtbar gestartet
rem (siehe "Unsichtbar starten.vbs") und laeuft, solange der Rechner laeuft.
rem
rem Faellt der Server aus, startet die Schleife ihn nach 10 Sekunden neu.
rem Beenden: "Arztrechnungen beenden.cmd".
rem ---------------------------------------------------------------------------
rem Zeichensatz auf UTF-8, sonst stehen Umlaute als Kauderwelsch im Protokoll
chcp 65001 >nul

cd /d "%~dp0"
set "PROTOKOLL=%~dp0backend\data\server.log"

rem Protokoll bei jedem Rechnerstart neu beginnen, damit es nicht endlos waechst
echo Start %DATE% %TIME% > "%PROTOKOLL%"

rem Ohne gebautes Frontend/Backend gibt es nichts zu starten - einmalig bauen
if not exist "%~dp0backend\dist\index.js" (
  echo Baue die App zum ersten Mal ... >> "%PROTOKOLL%"
  call npm run build >> "%PROTOKOLL%" 2>&1
)

:schleife
rem Direkt node statt npm: spart zwei Zwischenprozesse und startet schneller
node "%~dp0backend\dist\index.js" >> "%PROTOKOLL%" 2>&1
echo. >> "%PROTOKOLL%"
echo Server beendet %DATE% %TIME% - Neustart in 10 Sekunden >> "%PROTOKOLL%"
timeout /t 10 /nobreak >nul
goto schleife
