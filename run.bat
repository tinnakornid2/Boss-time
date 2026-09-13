@echo off
title Lineage 2 Boss Tracker (#Kain7)
echo ========================================================
echo   Starting Lineage 2 Boss Tracker Server (#Kain7)...
echo   URL: http://localhost:3000
echo   Admin:  admin / 777999
echo   Member: kain7 / password777999
echo ========================================================
echo.
cd /d "%~dp0"
start http://localhost:3000
node server/server.js
pause
