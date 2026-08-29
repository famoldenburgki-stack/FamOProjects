@echo off
rem ---------------------------------------------------------------
rem  Zweiter Startweg, falls die DocKit.exe an diesem Arbeitsplatz
rem  nicht ausgefuehrt werden darf. Startet dasselbe Programm ueber
rem  Windows-Bordmittel.
rem ---------------------------------------------------------------
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0Programm\DocKit.ps1"