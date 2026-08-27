@echo off
rem ---------------------------------------------------------------------------
rem Oeffnet die App im Browser. Laeuft der Server noch nicht, wird er zuerst
rem unsichtbar gestartet - ein zweiter Server entsteht dabei nie.
rem ---------------------------------------------------------------------------
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$offen = { (Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue) -ne $null };" ^
  "if (-not (& $offen)) {" ^
  "  Write-Host 'Starte die App ...';" ^
  "  Start-Process wscript.exe -ArgumentList '\"%~dp0Unsichtbar starten.vbs\"', '\"Arztrechnungen Dienst.cmd\"';" ^
  "  for ($i=0; $i -lt 40 -and -not (& $offen); $i++) { Start-Sleep -Milliseconds 500 };" ^
  "}" ^
  "if (& $offen) { Start-Process 'http://localhost:4000' } else { Write-Host 'Der Server antwortet nicht - siehe backend\data\server.log'; Start-Sleep 6 }"
