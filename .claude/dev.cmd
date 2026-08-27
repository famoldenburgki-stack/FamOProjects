@echo off
rem Startet Backend und Frontend der Arztrechnungs-App im Entwicklungsmodus.
rem Setzt den Node-Pfad explizit, damit der Start auch aus Umgebungen
rem funktioniert, die Node nicht in der PATH-Variable haben.
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0..\arztrechnungen"
call npm run dev
