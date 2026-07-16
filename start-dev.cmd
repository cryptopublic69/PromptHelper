@echo off
setlocal EnableExtensions
title PromptHelper V5 - Development

cd /d "%~dp0"

set "SHARED_DATA_FILE=D:\Data\SynologyDrive\Codes\AI\prompt_helper\dist\prompts_data.json"
if not exist "%SHARED_DATA_FILE%" (
    echo [ERROR] Shared data file was not found:
    echo %SHARED_DATA_FILE%
    goto :failed
)
set "PROMPT_HELPER_DATA_FILE=%SHARED_DATA_FILE%"

if exist "C:\Users\Raydio\.cargo\bin\cargo.exe" (
    set "PATH=C:\Users\Raydio\.cargo\bin;%PATH%"
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found. Please install Node.js first.
    goto :failed
)

where cargo >nul 2>nul
if errorlevel 1 (
    echo [ERROR] cargo was not found. Please install Rust first.
    goto :failed
)

if not exist "node_modules\." (
    echo [PromptHelper] Installing project dependencies...
    call npm install
    if errorlevel 1 goto :failed
)

if /i "%~1"=="--check" (
    echo [PromptHelper] Environment check passed.
    echo [PromptHelper] Shared data file: %PROMPT_HELPER_DATA_FILE%
    exit /b 0
)

echo [PromptHelper] Starting Tauri development mode...
echo [PromptHelper] Frontend changes in src will update automatically.
echo [PromptHelper] Press Ctrl+C to stop.
echo.

call npm run tauri dev
set "APP_EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%APP_EXIT_CODE%"=="0" (
    echo [ERROR] Development mode exited with code %APP_EXIT_CODE%.
) else (
    echo [PromptHelper] Development mode has stopped.
)
echo Press any key to close this window.
pause >nul
exit /b %APP_EXIT_CODE%

:failed
echo.
echo [ERROR] Startup failed. Review the message above.
echo Press any key to close this window.
pause >nul
exit /b 1
