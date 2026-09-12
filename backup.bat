@echo off
title Lineage 2 Boss Tracker - Data Backup
echo ========================================================
echo   Creating Data Store Backup...
echo ========================================================
echo.
cd /d "%~dp0"
node server/backup.js
echo.
pause
