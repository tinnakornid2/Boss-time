@echo off
title Push to GitHub (Boss-time)
echo ========================================================
echo   Pushing Lineage 2 Boss Tracker to GitHub...
echo   Repository: https://github.com/tinnakornid2/Boss-time
echo ========================================================
echo.
cd /d "%~dp0"
git push -u origin main
echo.
pause
