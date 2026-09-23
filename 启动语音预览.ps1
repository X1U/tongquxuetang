$ErrorActionPreference = 'Stop'
$previewProject = $PSScriptRoot
$previewPort = 8765
$previewLogDirectory = Join-Path $previewProject '.checks\voice-compat'
New-Item -ItemType Directory -Path $previewLogDirectory -Force | Out-Null
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $previewPort)
foreach ($previewOwnerId in @($listeners.OwningProcess | Select-Object -Unique)) {
    $previewRecord = Get-CimInstance Win32_Process -Filter "ProcessId = $previewOwnerId"
    if ($previewRecord.Name -ne 'node.exe' -or $previewRecord.CommandLine -notmatch '手机预览\.cjs') { throw '8765 端口正在被其他程序使用，未停止该程序。' }
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$previewPort/" -TimeoutSec 4
    $expectedBytes = [System.IO.File]::ReadAllBytes((Join-Path $previewProject 'app\src\main\assets\index.html'))
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $actualHash = [BitConverter]::ToString($hasher.ComputeHash($response.RawContentStream.ToArray()))
        $expectedHash = [BitConverter]::ToString($hasher.ComputeHash($expectedBytes))
    } finally { $hasher.Dispose() }
    if ($actualHash -ne $expectedHash) { throw '8765 端口提供的不是当前游戏页面，未停止该程序。' }
    Stop-Process -Id $previewOwnerId -Force
}
$env:PICTURE_GAME_PORT = [string]$previewPort
$previewNode = (Get-Command node -ErrorAction Stop).Source
$previewProcess = Start-Process -FilePath $previewNode -ArgumentList '.\手机预览.cjs' -WorkingDirectory $previewProject -WindowStyle Hidden -RedirectStandardOutput (Join-Path $previewLogDirectory 'preview-stdout.log') -RedirectStandardError (Join-Path $previewLogDirectory 'preview-stderr.log') -PassThru
$voiceStatus = $null
for ($attempt = 0; $attempt -lt 8; $attempt++) {
    $previewProcess.Refresh()
    if ($previewProcess.HasExited) { throw '手机预览进程已退出，请查看 .checks/voice-compat/preview-stderr.log。' }
    try {
        $previewListeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $previewPort)
        if (-not $previewListeners.Count) { Start-Sleep -Milliseconds 250; continue }
        if (@($previewListeners | Where-Object OwningProcess -ne $previewProcess.Id).Count) { throw '预览端口不属于新启动的进程，未将旧服务误报为启动成功。' }
        $voiceStatus = Invoke-RestMethod -Uri "http://127.0.0.1:$previewPort/api/speech/status" -TimeoutSec 5
        if ($voiceStatus.available) { break }
    }
    catch { if ($previewProcess.HasExited) { throw '手机预览未能启动，请查看 .checks/voice-compat/preview-stderr.log。' }; Start-Sleep -Milliseconds 250 }
}
if (-not $voiceStatus.available) { throw '中文语音未就绪，请查看 .checks/voice-compat/preview-stdout.log。' }
[PSCustomObject]@{ ProcessId = $previewProcess.Id; Preview = "http://127.0.0.1:$previewPort/"; VoiceAvailable = $voiceStatus.available; Voice = $voiceStatus.voice } | ConvertTo-Json
