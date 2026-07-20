@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   Leila Portal - GitHub 업로드 (집/개인망)
echo ============================================
echo.
echo 회사 프록시를 무시하고 직접 연결합니다...
set HTTP_PROXY=
set HTTPS_PROXY=
echo.
git -c http.proxy= -c https.proxy= push -u origin main --force
echo.
if %errorlevel%==0 (
  echo [성공] GitHub 업로드 완료!
  echo https://github.com/leilasung-cyber/leila_agenda 에서 확인하세요.
) else (
  echo [실패] 위 에러 메시지를 캡처해서 Claude에게 보내주세요.
)
echo.
pause
