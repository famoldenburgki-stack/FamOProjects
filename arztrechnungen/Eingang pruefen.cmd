@echo off
rem Liest den ueberwachten Ordner ein und legt neue Rechnungen und Bescheide
rem als Entwurf im Eingang der App ab.
rem Wird beim Anmelden ueber die Verknuepfung im Autostart-Ordner gestartet.
cd /d "%~dp0"
call npm run --workspace backend eingang
