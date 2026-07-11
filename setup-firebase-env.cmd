@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Configures local Firebase Auth settings without echoing secrets.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-firebase-auth-env.ps1"
exit /b %errorlevel%
