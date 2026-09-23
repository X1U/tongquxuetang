param([Parameter(Mandatory = $true)][string]$CacheDirectory)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
function Send-Reply($reply) { [Console]::WriteLine(($reply | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
$synth = $null
$modernSynth = $null
$voiceEntries = @()
# Windows exposes installed desktop and OneCore voices through separate APIs.
# Keep the classic voice available while also supporting current Windows voices.
try {
    Add-Type -AssemblyName System.Speech
    $synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
    $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -match '^zh' })
    $preferred = $voices | Where-Object { $_.VoiceInfo.Culture.Name -eq 'zh-CN' -and $_.VoiceInfo.Name -match 'Desktop' } | Select-Object -First 1
    if (-not $preferred) { $preferred = $voices | Where-Object { $_.VoiceInfo.Culture.Name -eq 'zh-CN' } | Select-Object -First 1 }
    if (-not $preferred) { $preferred = $voices | Select-Object -First 1 }
    if ($preferred) { $defaultVoice = $preferred.VoiceInfo.Name }
    $voiceEntries += @($voices | ForEach-Object { @{ id = $_.VoiceInfo.Name; name = $_.VoiceInfo.Name; lang = $_.VoiceInfo.Culture.Name; local = $true; engine = 'desktop' } })
} catch { if ($synth) { $synth.Dispose(); $synth = $null } }
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $modernSynth = [Windows.Media.SpeechSynthesis.SpeechSynthesizer,Windows.Media.SpeechSynthesis,ContentType=WindowsRuntime]::new()
    $modernVoices = @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object Language -match '^zh')
    $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetGenericArguments().Count -eq 1
    } | Select-Object -First 1
    $streamType = [Windows.Media.SpeechSynthesis.SpeechSynthesisStream,Windows.Media.SpeechSynthesis,ContentType=WindowsRuntime]
    $asStreamTask = $asTaskMethod.MakeGenericMethod($streamType)
    $voiceEntries += @($modernVoices | ForEach-Object { @{ id = $_.Id; name = $_.DisplayName; lang = $_.Language; local = $true; engine = 'onecore' } })
} catch { if ($modernSynth) { $modernSynth.Dispose(); $modernSynth = $null } }
if (-not $voiceEntries.Count) {
    Send-Reply @{ type = 'ready'; available = $false; code = 'VOICE_INIT_FAILED' }
    if ($synth) { $synth.Dispose() }
    if ($modernSynth) { $modernSynth.Dispose() }
    exit 1
}
if (-not $defaultVoice) { $defaultVoice = $voiceEntries[0].id }
Send-Reply @{ type = 'ready'; available = $true; voice = $defaultVoice; voices = $voiceEntries }
try {
    while ($null -ne ($line = [Console]::ReadLine())) {
        $request = $null
        try {
            $request = $line | ConvertFrom-Json
            if ($request.key -notmatch '^[a-f0-9]{64}$') { throw 'INVALID_KEY' }
            if (-not ($request.text -is [string]) -or $request.text.Length -lt 1 -or $request.text.Length -gt 800) { throw 'INVALID_TEXT' }
            $rate = [double]$request.rate
            if ([double]::IsNaN($rate) -or $rate -lt 0.35 -or $rate -gt 1.5) { throw 'INVALID_RATE' }
            $selectedVoice = if (($request.voice -is [string]) -and $request.voice.Length -gt 0) { $request.voice } else { $defaultVoice }
            $voiceEntry = $voiceEntries | Where-Object id -eq $selectedVoice | Select-Object -First 1
            if (-not $voiceEntry) { throw 'INVALID_VOICE' }
            $outputFile = Join-Path $CacheDirectory ($request.key + '.wav')
            if ($voiceEntry.engine -eq 'onecore') {
                $modernSynth.Voice = $modernVoices | Where-Object Id -eq $selectedVoice | Select-Object -First 1
                $modernSynth.Options.SpeakingRate = $rate
                $operation = $modernSynth.SynthesizeTextToStreamAsync($request.text)
                $task = $asStreamTask.Invoke($null, @($operation))
                if (-not $task.Wait(15000)) { throw 'SYNTHESIS_TIMEOUT' }
                $speechStream = $task.Result
                $inputStream = $null
                $fileStream = $null
                try {
                    $inputStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($speechStream.GetInputStreamAt(0))
                    $fileStream = [System.IO.File]::Create($outputFile)
                    $inputStream.CopyTo($fileStream)
                } finally {
                    if ($fileStream) { $fileStream.Dispose() }
                    if ($inputStream) { $inputStream.Dispose() }
                    $speechStream.Dispose()
                }
            } else {
                $synth.SelectVoice($selectedVoice)
                $synth.Rate = [int][Math]::Max(-10, [Math]::Min(10, [Math]::Round([Math]::Log($rate, 2) * 5)))
                $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
                $synth.SetOutputToWaveFile($outputFile, $format)
                $synth.Speak($request.text)
                $synth.SetOutputToNull()
            }
            Send-Reply @{ type = 'result'; key = $request.key; ok = $true }
        } catch {
            try { $synth.SetOutputToNull() } catch {}
            Send-Reply @{ type = 'result'; key = $request.key; ok = $false; code = 'SYNTHESIS_FAILED' }
        }
    }
} finally {
    if ($synth) { $synth.Dispose() }
    if ($modernSynth) { $modernSynth.Dispose() }
}
