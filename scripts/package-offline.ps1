$ErrorActionPreference="Stop"
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$proj=[System.IO.Path]::GetFullPath((Join-Path $root ".."))
Set-Location $proj
if(!(Test-Path "dist")){New-Item -Type Directory -Path "dist" | Out-Null}
if(!(Test-Path "node_modules")){
  if(Test-Path "package-lock.json"){npm ci --omit=dev}else{npm install --omit=dev}
}
$zip=Join-Path (Get-Location) "dist\\LightMonitor-0.1.0.zip"
if(Test-Path $zip){Remove-Item $zip -Force}
$items=@("server","public","scripts","package.json","node_modules","README_OFFLINE.txt")
if(Test-Path "package-lock.json"){$items+="$($PWD.Path)\\package-lock.json"}
Compress-Archive -Path $items -DestinationPath $zip -Force
Write-Output $zip
