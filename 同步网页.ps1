$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path (Split-Path -Parent $project) '密码图卡乐园\密码图卡乐园.html'
$target = Join-Path $project 'app\src\main\assets\index.html'
if (-not (Test-Path -LiteralPath $source)) { throw "找不到网页源文件：$source" }
Copy-Item -LiteralPath $source -Destination $target -Force
Write-Host "网页已同步到 Android 工程：$target" -ForegroundColor Green
