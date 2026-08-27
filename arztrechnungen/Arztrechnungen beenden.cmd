@echo off
rem Beendet den Server der App. Danach ist http://localhost:4000 nicht mehr da,
rem bis er neu gestartet wird (Anmeldung oder "Arztrechnungen.lnk").
echo Beende die Arztrechnungs-App ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'Arztrechnungen Dienst.cmd|dist.index.js|npm.*start' -and $_.Name -match 'node.exe|cmd.exe' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }"
echo Fertig. Die App ist beendet.
