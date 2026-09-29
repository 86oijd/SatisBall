@echo off
rem Makes SatisBall Autopilot start automatically every time you log in to Windows.
rem (To undo: delete "SatisBall Autopilot.bat" from the Startup folder that opens at the end.)
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy /y "%~dp0Start Autopilot.bat" "%STARTUP%\SatisBall Autopilot.bat" >nul
echo Autopilot will now start at every logon.
echo Tip: turn on automatic sign-in or keep the laptop logged in, so it restarts after updates.
explorer "%STARTUP%"
pause
