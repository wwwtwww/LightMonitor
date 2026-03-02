$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$proj = [System.IO.Path]::GetFullPath((Join-Path $here ".."))
Set-Location $proj

$ver = "0.1.0"
try{
  $raw = Get-Content -LiteralPath "package.json" -Raw -Encoding UTF8
  $pkg = $raw | ConvertFrom-Json
  if($pkg.version){ $ver = $pkg.version }
}catch{
  Write-Host "Warn: package.json 解析失败，使用默认版本 $ver"
}
$dist = Join-Path $proj "dist"
if (!(Test-Path $dist)) { New-Item -Type Directory -Path $dist | Out-Null }

if (!(Test-Path "node_modules")) {
  if (Test-Path "package-lock.json") {
    npm ci --omit=dev
  } else {
    npm install --omit=dev
  }
}

$vendor = Join-Path $proj "public\\vendor"
if (!(Test-Path $vendor)) { New-Item -Type Directory -Path $vendor | Out-Null }
$chartFile = Join-Path $vendor "chart.umd.min.js"
$chartSrc = Join-Path $proj "node_modules\\chart.js\\dist\\chart.umd.min.js"
if (Test-Path $chartSrc) {
  Copy-Item $chartSrc $chartFile -Force
} elseif (!(Test-Path $chartFile)) {
  try { Invoke-WebRequest -UseBasicParsing -Uri "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" -OutFile $chartFile } catch { Write-Host "Warn: 无法获取 Chart.js" }
}
$adapterFile = Join-Path $vendor "chartjs-adapter-date-fns.bundle.min.js"
$adapterSrc = Join-Path $proj "node_modules\\chartjs-adapter-date-fns\\dist\\chartjs-adapter-date-fns.bundle.min.js"
if (Test-Path $adapterSrc) {
  Copy-Item $adapterSrc $adapterFile -Force
} elseif (!(Test-Path $adapterFile)) {
  try { Invoke-WebRequest -UseBasicParsing -Uri "https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js" -OutFile $adapterFile } catch { Write-Host "Warn: 无法获取 adapter" }
}

$zip = Join-Path $dist ("LightMonitor-" + $ver + ".zip")
if (Test-Path $zip) { Remove-Item $zip -Force }
$paths = @("server", "public", "scripts", "package.json", "node_modules")
if (Test-Path "package-lock.json") { $paths += "package-lock.json" }
Compress-Archive -Path $paths -DestinationPath $zip -Force -CompressionLevel Optimal
Write-Output $zip
