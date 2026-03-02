$ErrorActionPreference="Stop"
$here=Split-Path -Parent $MyInvocation.MyCommand.Path
$proj=[System.IO.Path]::GetFullPath((Join-Path $here ".."))
Set-Location $proj
if(-not $env:SAMPLE_MS){$env:SAMPLE_MS="5000"}
if(-not $env:RETAIN_HOURS){$env:RETAIN_HOURS="168"}
if(-not $env:PORT){$env:PORT="8080"}
if(!(Test-Path "node_modules")){npm i --omit=dev}
node server/index.js
