@echo off
title Lineage 2 Boss Tracker (#Kain7) - 24/7 Dedicated Server
color 0A
cd /d "%~dp0"

echo ====================================================================
echo   Starting Lineage 2 Dedicated Boss Server (#Kain7)...
echo ====================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is NOT installed on this computer!
    echo Please download and install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

node launcher.js
pause
