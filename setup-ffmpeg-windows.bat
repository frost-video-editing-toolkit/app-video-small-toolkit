@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title FFmpeg Setup Helper

echo =========================================
echo   FFmpeg Setup Helper for Video Workbench
echo =========================================
echo.
echo This script helps you:
echo   1. Check whether ffmpeg is available
echo   2. Install ffmpeg with winget
echo   3. Save FFMPEG_PATH if needed
echo.

call :check_ffmpeg
if %ERRORLEVEL% EQU 0 goto verify

echo ffmpeg was not found on this machine.
choice /c YN /m "Install ffmpeg now with winget"
if errorlevel 2 goto ask_path
if errorlevel 1 call :install_ffmpeg

:ask_path
echo.
set "FFMPEG_EXE="
set /p FFMPEG_EXE=Optional: enter the full path to ffmpeg.exe ^(or press Enter to skip^): 
if not defined FFMPEG_EXE goto verify

if not exist "%FFMPEG_EXE%" (
  echo [ERROR] File not found: "%FFMPEG_EXE%"
  goto verify
)

setx FFMPEG_PATH "%FFMPEG_EXE%" >nul
set "FFMPEG_PATH=%FFMPEG_EXE%"
echo Saved FFMPEG_PATH for future terminals.
goto verify

:install_ffmpeg
where winget >nul 2>nul
if errorlevel 1 (
  echo [ERROR] winget is not available on this PC.
  echo Please install ffmpeg manually, then run this script again.
  goto :eof
)

echo.
echo Installing ffmpeg with winget...
winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements
goto :eof

:check_ffmpeg
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [NG] ffmpeg is not available yet.
  exit /b 1
)

echo [OK] ffmpeg is available.
for /f "delims=" %%i in ('ffmpeg -version 2^>nul ^| findstr /b "ffmpeg version"') do echo %%i
exit /b 0

:verify
echo.
echo Re-checking ffmpeg...
call :check_ffmpeg
echo.
echo If you changed PATH or FFMPEG_PATH, restart VS Code or the terminal before starting the app.
echo Then you can run:
echo   npm run dev
echo or
echo   npm run react:build ^&^& npm run start
echo.
pause
endlocal
