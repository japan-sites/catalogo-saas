@echo off
setlocal

echo ======================================
echo INICIANDO AMBIENTE DE DESENVOLVIMENTO
echo ======================================

REM 1) Backend
start "BACKEND" cmd /k ^
  "cd /d C:\Users\Japan_01\catalogo-saas\backend && npm run dev"

REM 2) Admin
start "ADMIN" cmd /k ^
  "cd /d C:\Users\Japan_01\catalogo-saas\admin && npm run dev"

REM 3) Espera backend
echo Aguardando backend...
powershell -NoProfile -Command ^
  "$u='http://localhost:3001/health'; for($i=0;$i -lt 60;$i++){try{if((Invoke-RestMethod $u).ok){exit 0}}catch{}; Start-Sleep 1}; exit 1"
if errorlevel 1 (
  echo Backend nao respondeu.
  pause
  exit /b
)

REM 4) Espera admin
echo Aguardando admin...
powershell -NoProfile -Command ^
  "$u='http://localhost:5173/'; for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest $u -UseBasicParsing|Out-Null; exit 0}catch{}; Start-Sleep 1}; exit 1"
if errorlevel 1 (
  echo Admin nao respondeu.
  pause
  exit /b
)

REM 5) Abre ferramenta de import
powershell -NoProfile -ExecutionPolicy Bypass -File ^
  "C:\Users\Japan_01\catalogo-saas\backend\atualizar_catalogo.ps1"

endlocal
