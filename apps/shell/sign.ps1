
Get-AuthenticodeSignature dist-win\*.exe | Where-Object -Property Status -Value NotSigned -EQ | ForEach-Object { signtool sign /fd SHA256 /t http://timestamp.digicert.com /n "Smart Code OOD" $_.Path }
Get-AuthenticodeSignature dist-win\*.dll | Where-Object -Property Status -Value NotSigned -EQ | ForEach-Object { signtool sign /fd SHA256 /t http://timestamp.digicert.com /n "Smart Code OOD" $_.Path }

#$env:package_version = (Select-String -Path .\CMakeLists.txt -Pattern '^project\(stremio VERSION "([^"]+)"\)').Matches.Groups[1].Value
#&"C:\Program Files (x86)\NSIS\makensis.exe" windows\installer\windows-installer.nsi
#&signtool sign /fd SHA256 /t http://timestamp.digicert.com /n "Smart Code OOD" "Stremio $env:package_version.exe"
