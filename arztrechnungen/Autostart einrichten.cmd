@echo off
rem ---------------------------------------------------------------------------
rem Legt zwei Verknuepfungen im Autostart-Ordner an:
rem   1. den Server der App (laeuft dann immer, ohne sichtbares Fenster)
rem   2. das Einlesen des ueberwachten Ordners
rem
rem Nochmal ausfuehren ist unschaedlich - die Verknuepfungen werden ersetzt.
rem Rueckgaengig: Windows-Taste + R, "shell:startup", Verknuepfungen loeschen.
rem ---------------------------------------------------------------------------

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$hier = '%~dp0'.TrimEnd('\');" ^
  "$auto = [Environment]::GetFolderPath('Startup');" ^
  "$w = New-Object -ComObject WScript.Shell;" ^
  "function Lege($name, $skript, $text) {" ^
  "  $l = $w.CreateShortcut((Join-Path $auto $name));" ^
  "  $l.TargetPath = 'wscript.exe';" ^
  "  $l.Arguments = '\"' + $hier + '\Unsichtbar starten.vbs\" \"' + $skript + '\"';" ^
  "  $l.WorkingDirectory = $hier;" ^
  "  $l.IconLocation = Join-Path $hier 'Arztrechnungen.ico';" ^
  "  $l.Description = $text;" ^
  "  $l.Save();" ^
  "  Write-Host ('  ' + $name) };" ^
  "Write-Host 'Angelegt:';" ^
  "Lege 'Arztrechnungen - Server.lnk' 'Arztrechnungen Dienst.cmd' 'Haelt die Arztrechnungs-App im Hintergrund bereit';" ^
  "Lege 'Arztrechnungen - Eingang pruefen.lnk' 'Eingang pruefen.cmd' 'Liest den ueberwachten Ordner ein'"

if errorlevel 1 (
  echo.
  echo Die Verknuepfungen konnten nicht angelegt werden.
  pause
  exit /b 1
)

echo.
echo Ab der naechsten Anmeldung laeuft die App von allein im Hintergrund.
echo Aufrufen dann einfach ueber "Arztrechnungen.lnk" oder http://localhost:4000
echo.
pause
