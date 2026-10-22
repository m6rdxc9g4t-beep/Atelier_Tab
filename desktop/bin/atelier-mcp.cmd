@echo off
rem Serveur MCP d'Atelier_Tab sous Windows (docs/SUITE.md section 8.3, ADR 0005) :
rem   %%LOCALAPPDATA%%\Programs\Atelier_Tab\resources\atelier-mcp.cmd
rem Lance atelier-mcp.cjs (a cote) avec le Node.js embarque dans l'app (ELECTRON_RUN_AS_NODE) ;
rem il execute le serveur du depot (dist-desktop\atelier-mcp.mjs) et ne declenche jamais de
rem mise a jour. Aucune donnee lue ici : les chemins viennent de %%~dp0 (dossier de ce fichier).
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\Atelier_Tab.exe" "%~dp0atelier-mcp.cjs" %*
exit /b %ERRORLEVEL%
