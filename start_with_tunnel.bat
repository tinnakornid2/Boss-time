@echo off
title Lineage 2 Boss Tracker (#Kain7) - Online Server
echo ====================================================================
echo   Starting Lineage 2 Boss Tracker + Cloudflare Public Tunnel...
echo ====================================================================
echo   Admin:  admin / 777999
echo   Member: kain7 / password777999
echo ====================================================================
echo.

cd /d "%~dp0"

echo [1/2] Launching Local Server on Port 3000...
start /b cmd /c "node server/server.js > server_output.log 2>&1"

echo [2/2] Connecting Cloudflare Tunnel to generate public link...
echo (Please wait 3-5 seconds for the public link to appear below)
echo --------------------------------------------------------------------

if not exist cloudflared.exe (
    echo Downloading cloudflared.exe...
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe -o cloudflared.exe
)

cloudflared.exe tunnel --url http://localhost:3000
pause
