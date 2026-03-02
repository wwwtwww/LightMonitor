$ErrorActionPreference="Stop"
$here=Split-Path -Parent $MyInvocation.MyCommand.Path
$proj=[System.IO.Path]::GetFullPath((Join-Path $here ".."))
Set-Location $proj
if(!(Test-Path "dist")){ New-Item -Type Directory -Path "dist" | Out-Null }
$zip=Join-Path (Get-Location) "dist\\LightMonitor-0.1.0.zip"
if(Test-Path $zip){ Remove-Item $zip -Force }
Compress-Archive -Path server,public,scripts,package.json -DestinationPath $zip -Force
Write-Output $zip
