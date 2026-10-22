@echo off
rem Double-click to choose a branch and run it. Your own folder and its unsaved changes are left alone.
cd /d "%~dp0"
title Puzzle Practice - pick a branch

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed. Get it from https://git-scm.com and run this again.
  pause
  exit /b 1
)

node scripts\pick-branch.mjs %*
pause
