@echo off
setlocal
cd /d "%~dp0"

echo [promptpile] npm run build ...
call npm run build
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)

if not exist "dist\index.js" (
  echo ERROR: dist\index.js missing after build.
  exit /b 1
)

echo [promptpile] node dist\index.js -d "%~dp0test-messages" %*
echo.
node dist\index.js -d "%~dp0test-messages" %*
set EXITCODE=%ERRORLEVEL%
echo.
if %EXITCODE% neq 0 (
  echo Run failed with code %EXITCODE%.
  echo Tip: copy .env.example to .env and set AI_API_KEY, or pass -k YOUR_KEY -b BASE_URL -m MODEL
)
exit /b %EXITCODE%
