@echo off
title Lineage 2 Boss Tracker - Desktop App
cd /d "%~dp0"

echo ====================================================================
echo   Starting Lineage 2 Boss Tracker Desktop App...
echo ====================================================================
echo.

:: Clean up any stuck background ghost processes from previous tests
taskkill /F /IM BossTracker.exe >nul 2>&1
timeout /t 1 /nobreak >nul 2>&1

if exist "desktop-app\dist\win-unpacked\BossTracker.exe" (
    echo [OK] Launching BossTracker.exe...
    start "" "desktop-app\dist\win-unpacked\BossTracker.exe"
    echo App started! You can close this window.
) else (
    echo [INFO] Running from electron source...
    cd desktop-app
    npm start
)
