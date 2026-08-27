@echo off
setlocal
title Arztrechnungen einrichten
cd /d "%~dp0"

echo ===========================================================
echo   Arztrechnungen - Einrichtung
echo ===========================================================
echo.
echo Das dauert ein paar Minuten. Es wird nur in diesen Ordner
echo geschrieben; deine Belege bleiben, wo sie sind.
echo.

rem --- 1. Laeuft Node.js, und ist es neu genug? -------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo FEHLER: Node.js ist nicht installiert.
  echo.
  echo Bitte zuerst die LTS-Version von https://nodejs.org herunterladen
  echo und installieren, dann dieses Skript erneut starten.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set HAUPT=%%v
if %HAUPT% LSS 22 (
  echo FEHLER: Node.js %HAUPT% ist zu alt - die App braucht Version 22 oder neuer.
  echo Bitte von https://nodejs.org die aktuelle LTS-Version installieren.
  echo.
  pause
  exit /b 1
)
echo [1/3] Node.js gefunden:
node -v
echo.

rem --- 2. Bausteine holen ----------------------------------------------------
echo [2/3] Lade die benoetigten Bausteine ... (einmalig, kann einige Minuten dauern)
call npm install
if errorlevel 1 (
  echo.
  echo FEHLER beim Laden der Bausteine. Besteht eine Internetverbindung?
  pause
  exit /b 1
)
echo.

rem --- 3. App bauen ----------------------------------------------------------
echo [3/3] Baue die App ...
call npm run build
if errorlevel 1 (
  echo.
  echo FEHLER beim Bauen.
  pause
  exit /b 1
)
echo.

rem --- Verknuepfung auf dem Desktop ------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$hier = '%~dp0'.TrimEnd('\');" ^
  "$w = New-Object -ComObject WScript.Shell;" ^
  "$l = $w.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Arztrechnungen.lnk'));" ^
  "$l.TargetPath = Join-Path $hier 'Arztrechnungen.cmd';" ^
  "$l.WorkingDirectory = $hier;" ^
  "$l.IconLocation = Join-Path $hier 'Arztrechnungen.ico';" ^
  "$l.Description = 'Arztrechnungen oeffnen';" ^
  "$l.Save()"

echo ===========================================================
echo   Fertig.
echo ===========================================================
echo.
echo Auf dem Desktop liegt jetzt "Arztrechnungen".
echo.
echo Soll die App kuenftig bei jeder Anmeldung im Hintergrund
echo bereitstehen? Dann jetzt "j" eingeben.
echo (Kann spaeter mit "Autostart einrichten.cmd" nachgeholt werden.)
echo.
set /p AUTO="Autostart einrichten? [j/n] "
if /i "%AUTO%"=="j" (
  call "%~dp0Autostart einrichten.cmd"
)

echo.
echo Die App wird jetzt geoeffnet. Beim ersten Start fragt sie,
echo wer zum Haushalt gehoert und wo die Belege abgelegt werden sollen.
echo.
pause
call "%~dp0Arztrechnungen.cmd"
