@echo off
setlocal
cd /d "%~dp0"

copy /y ".env.example" ".env" >nul
echo Synced .env from .env.example

if not exist "..\node_modules" (
  echo Installing dependencies in example\ ...
  pushd ".."
  call npm install
  if errorlevel 1 (
    popd
    echo npm install failed.
    exit /b 1
  )
  popd
)

echo Starting hostra file-view example...
call npx --prefix ".." hostra
exit /b %ERRORLEVEL%
