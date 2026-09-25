@echo off
rem SatisBall launcher: opens the studio in Microsoft Edge (or Chrome) as an app window.
set "APP=%~dp0index.html"
set "FLAGS=--window-size=1600,950"
set "EDGE1=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE2=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME1=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROME2=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%EDGE1%" goto edge1
if exist "%EDGE2%" goto edge2
if exist "%CHROME1%" goto chrome1
if exist "%CHROME2%" goto chrome2
start "" "%APP%"
goto :eof
:edge1
start "" "%EDGE1%" --app="%APP%" %FLAGS%
goto :eof
:edge2
start "" "%EDGE2%" --app="%APP%" %FLAGS%
goto :eof
:chrome1
start "" "%CHROME1%" --app="%APP%" %FLAGS%
goto :eof
:chrome2
start "" "%CHROME2%" --app="%APP%" %FLAGS%
