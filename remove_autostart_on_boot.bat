@echo off
title Remove Auto-Start on Windows Boot
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BossTrackerServer.lnk" 2>nul
echo ====================================================================
echo   ยกเลิกระบบเปิดอัตโนมัติเรียบร้อยแล้ว
echo ====================================================================
echo.
pause
