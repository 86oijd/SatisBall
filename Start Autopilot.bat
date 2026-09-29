@echo off
rem ============================================================================
rem  SatisBall Autopilot launcher (Windows)
rem  Opens the studio in its own Edge window with background throttling turned
rem  off, keeps the PC awake while plugged in, and starts Autopilot.
rem  1) Put your studio's web address below (GitHub Pages or http://localhost:8000/).
rem  2) Double-click this file. Do the one-time setup (Export tab) IN THIS WINDOW:
rem     it uses its own browser profile, so your sign-ins are saved there.
rem  3) Optional: run "Install Autopilot Autostart.bat" so it starts at every logon.
rem ============================================================================
set "URL=https://86oijd.github.io/SatisBall/index.html"

rem Never sleep / hibernate on mains power (screen may still turn off - that's fine)
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change hibernate-timeout-ac 0 >nul 2>&1

set "PROFILE=%LOCALAPPDATA%\SatisBallAutopilot"
set "FLAGS=--user-data-dir="%PROFILE%" --no-first-run --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling --autoplay-policy=no-user-gesture-required"

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if exist "%EDGE%" (
  start "" "%EDGE%" %FLAGS% --app="%URL%#autopilot"
  goto :done
)
if exist "%CHROME%" (
  start "" "%CHROME%" %FLAGS% --app="%URL%#autopilot"
  goto :done
)
echo Could not find Microsoft Edge or Google Chrome.
pause
:done
