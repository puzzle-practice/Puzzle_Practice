@echo off
rem Double-click to start Puzzle Practice. Leave this window open while you play; close it to stop.
cd /d "%~dp0"
title Puzzle Practice

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

rem Fetch the latest version. A ZIP download has no .git folder and can't update itself.
if not exist ".git" (
  echo This folder was downloaded as a ZIP, so it can't update itself.
  echo To get the latest version, download a new ZIP or set it up with git clone.
  goto install
)

rem Use Git from the PATH, or the copy bundled with GitHub Desktop.
set "GIT="
where git >nul 2>nul && set "GIT=git"
if not defined GIT (
  for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
  )
)
if not defined GIT (
  echo Git is not installed, so updates were skipped. Get it from https://git-scm.com to update automatically.
  goto install
)

echo Checking for updates...
"%GIT%" pull --ff-only || echo Could not update, starting the current version instead.

:install
echo Installing packages...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo npm install failed. See the messages above.
  pause
  exit /b 1
)

echo Starting Puzzle Practice. Your browser will open shortly.
call npm run dev -- --open
pause
