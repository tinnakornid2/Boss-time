@echo off
title Setup Auto-Start on Windows Boot
cd /d "%~dp0"

echo ====================================================================
echo   Setting up Auto-Start on Windows Boot...
echo ====================================================================
echo.

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut(\"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\BossTrackerServer.lnk\"); $s.TargetPath = \"$((Get-Item -Path .).FullName)\START_SERVER.bat\"; $s.WorkingDirectory = \"$((Get-Item -Path .).FullName)\"; $s.Save();"

echo ====================================================================
echo   [SUCCESS] ติดตั้งระบบเปิดอัตโนมัติเมื่อเปิดเครื่องเรียบร้อยแล้ว!
echo   เมื่อคอมพิวเตอร์เครื่องนี้เปิดขึ้นมา ระบบจะรันเซิร์ฟเวอร์ให้อัตโนมัติ
echo ====================================================================
echo.
pause
