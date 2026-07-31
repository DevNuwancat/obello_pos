@echo off
REM Removes the auto-start shortcut created by install-autostart.bat
set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
del "%STARTUP_DIR%\ObelloPrintAgent.lnk" 2>nul
echo Auto-start removed. The print agent will no longer launch on startup.
pause
