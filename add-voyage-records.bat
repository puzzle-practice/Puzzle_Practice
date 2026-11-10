@echo off
rem Adds records players send in to the Global records table.
rem Drag their "Download all my records" file, or a .txt with their copied message, onto this file.
rem Or drag a folder holding that file plus their pictures named 1.png, 2.jpg... (see docs\voyage-records-screenshots.md).
rem Or double-click it and paste the file's path.
cd /d "%~dp0"
set "FILE=%~1"
if "%FILE%"=="" set /p "FILE=Path to the records file (.json or .txt) or its folder: "
set "FILE=%FILE:"=%"
if "%FILE%"=="" goto :end
node scripts\add-voyage-records.mjs "%FILE%" %2 %3 %4 %5 %6 %7 %8 %9
:end
echo.
pause
