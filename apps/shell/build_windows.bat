@echo off
cd /d %~dp0

SETLOCAL
for /f delims^=^"^ tokens^=2 %%i IN ('type .\CMakeLists.txt ^| find "stremio VERSION"') DO (
   set package_version=%%i
)

SET BUILD_DIR=build

:: Set up VS environment
CALL "C:\Program Files (x86)\Microsoft Visual Studio\2017\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x86

rd /s/q "%BUILD_DIR%"
mkdir "%BUILD_DIR%"
PUSHD "%BUILD_DIR%"
set MAKE_BUILD_TYPE=Release
cmake -G"NMake Makefiles" -DCMAKE_BUILD_TYPE=Release ..
::exit /b
cmake --build .

POPD

rd /s/q dist-win
md dist-win

::copy "C:\Program Files (x86)\nodejs\node.exe" dist-win\stremio-runtime.exe
@REM CALL windows\generate_stremio-runtime.cmd dist-win
powershell -Command Start-BitsTransfer -Source "$(cat .\server-url.txt)" -Destination .\dist-win\server.js; ((Get-Content -path .\dist-win\server.js -Raw) -replace 'os.tmpDir','os.tmpdir') ^| Set-Content -Path .\dist-win\server.js
copy build\*.exe dist-win
copy windows\*.dll dist-win
copy windows\*.exe dist-win
copy windows\DS\* dist-win
copy "C:\Program Files (x86)\OpenSSL-Win32\libcrypto-3.dll" dist-win
pwsh -ExecutionPolicy ByPass -command "Get-ChildItem dist-win | Where-Object Name -Match '\.(dll|exe)$' | Get-AuthenticodeSignature | Where-Object -Property Status -Value NotSigned -EQ | ForEach-Object { signtool sign /fd SHA256 /t http://timestamp.digicert.com /n 'Smart Code OOD' $_.Path }"
windeployqt --release --no-compiler-runtime --qmldir=. ./dist-win/stremio.exe

"C:\Program Files (x86)\NSIS\makensis.exe" windows\installer\windows-installer.nsi
signtool sign /fd SHA256 /t http://timestamp.digicert.com /n "Smart Code OOD" *.exe
ENDLOCAL
