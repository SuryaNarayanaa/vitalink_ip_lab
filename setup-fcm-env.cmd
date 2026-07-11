@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Configures local backend FCM settings without echoing the service-account key.
rem Usage: setup-fcm-env.cmd [redis-url]
rem Example: setup-fcm-env.cmd redis://localhost:6379

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-fcm-env.ps1" -RedisUrl "%~1"
exit /b %errorlevel%
