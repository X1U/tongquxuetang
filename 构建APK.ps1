$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$java17 = 'C:\Users\admin\.jdks\ms-17.0.15\bin\java.exe'
$env:JAVA_HOME = if (Test-Path -LiteralPath $java17) { Split-Path (Split-Path $java17) } else { $env:JAVA_HOME }

Write-Host '童趣学堂 Android 构建助手'
Write-Host '正在寻找 Android Studio 或 Gradle...' -ForegroundColor Cyan
$gradleCommand = Get-Command gradle -ErrorAction SilentlyContinue
$localGradle = Join-Path $project '.tools\gradle-8.7\bin\gradle.bat'
if ($gradleCommand) {
    $gradlePath = $gradleCommand.Source
} elseif (Test-Path -LiteralPath $localGradle) {
    $gradlePath = $localGradle
}
if (-not $gradlePath) {
    $androidStudio = Get-ChildItem 'C:\Program Files\Android Studio\bin\studio64.exe','C:\Program Files\Android\Android Studio\bin\studio64.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($androidStudio) {
        Write-Host '已找到 Android Studio。请用 Android Studio 打开本文件夹并执行 Build > Build APK(s)。' -ForegroundColor Yellow
    } else {
        Write-Host '当前电脑没有可直接调用的 Gradle。请安装 Android Studio 后打开本文件夹构建。' -ForegroundColor Yellow
    }
    exit 1
}

Push-Location $project
try {
    node scripts/build-poetry.cjs
    if ($LASTEXITCODE -ne 0) { throw '页面与版本信息生成失败，已停止构建。' }
    & $gradlePath --no-daemon assembleDebug
    if ($LASTEXITCODE -ne 0) {
        throw "APK 构建失败，退出代码：$LASTEXITCODE"
    }
    Write-Host "APK 已生成：$project\app\build\outputs\apk\debug\app-debug.apk" -ForegroundColor Green
} finally {
    Pop-Location
}
