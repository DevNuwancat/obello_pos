@echo off
REM ============================================================
REM  Obello Print Agent - Auto-Start Installer
REM  Double-click this file once. It copies a shortcut to your
REM  Windows "Startup" folder so ObelloPrintAgent.exe launches
REM  automatically every time this computer turns on.
REM ============================================================

set SCRIPT_DIR=%~dp0
set EXE_PATH=%SCRIPT_DIR%ObelloPrintAgent.exe
set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

if not exist "%EXE_PATH%" (
    echo.
    echo ERROR: ObelloPrintAgent.exe was not found in this folder.
    echo Make sure install-autostart.bat is in the SAME folder as ObelloPrintAgent.exe
    echo.
    pause
    exit /b 1
)

REM Create a shortcut (.lnk) in the Startup folder pointing at the exe
powershell -NoProfile -Command ^
  "$s = (New-Object -COM WScript.Shell).CreateShortcut('%STARTUP_DIR%\ObelloPrintAgent.lnk'); $s.TargetPath = '%EXE_PATH%'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.WindowStyle = 7; $s.Save()"

echo.
echo Done! Obello Print Agent will now start automatically every time
echo this computer turns on. It just started running now too -
echo you can check by opening: http://localhost:8899/health
echo.
start "" "%EXE_PATH%"
pause
