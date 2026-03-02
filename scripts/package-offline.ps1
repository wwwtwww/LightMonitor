$ErrorActionPreference="Stop"
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$proj=[System.IO.Path]::GetFullPath((Join-Path $root ".."))
Set-Location $proj
if(!(Test-Path "dist")){New-Item -Type Directory -Path "dist" | Out-Null}
if(!(Test-Path "node_modules")){
  if(Test-Path "package-lock.json"){npm ci --omit=dev}else{npm install --omit=dev}
}
$vendor=Join-Path $proj "public\\vendor"
if(!(Test-Path $vendor)){New-Item -Type Directory -Path $vendor | Out-Null}
if(!(Test-Path (Join-Path $vendor "chart.umd.min.js"))){
  try{Invoke-WebRequest -UseBasicParsing -Uri "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" -OutFile (Join-Path $vendor "chart.umd.min.js")}catch{}
}
if(!(Test-Path (Join-Path $vendor "chartjs-adapter-date-fns.bundle.min.js"))){
  try{Invoke-WebRequest -UseBasicParsing -Uri "https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js" -OutFile (Join-Path $vendor "chartjs-adapter-date-fns.bundle.min.js")}catch{}
}
$zip=Join-Path (Get-Location) "dist\\LightMonitor-0.1.0.zip"
if(Test-Path $zip){Remove-Item $zip -Force}
$items=@("server","public","scripts","package.json","node_modules")
if(Test-Path "package-lock.json"){$items+="$($PWD.Path)\\package-lock.json"}
Compress-Archive -Path $items -DestinationPath $zip -Force
Write-Output $zip
