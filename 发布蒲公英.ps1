param(
    [switch]$Check,
    [switch]$SkipBuild,
    [switch]$Login,
    [switch]$NewUpload,
    [string]$NotesFile,
    [string]$Channel,
    [string]$Resume
)
$ErrorActionPreference = 'Stop'
# Import only the named release credentials; preserve explicit process values.
# This refreshes variables added in Windows settings after IDEA was started.
foreach ($publishVariableName in @('PGY_USERNAME', 'PGY_PASSWORD', 'PGYER_API_KEY', 'PGYER_INSTALL_PASSWORD')) {
    $publishVariableValue = [Environment]::GetEnvironmentVariable($publishVariableName, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($publishVariableValue)) { continue }
    foreach ($publishVariableScope in @('User', 'Machine')) {
        $publishVariableValue = [Environment]::GetEnvironmentVariable($publishVariableName, $publishVariableScope)
        if (-not [string]::IsNullOrWhiteSpace($publishVariableValue)) {
            [Environment]::SetEnvironmentVariable($publishVariableName, $publishVariableValue, 'Process')
            break
        }
    }
}
$publishVariableValue = $null
$publishNode = (Get-Command node -ErrorAction Stop).Source
$publishArguments = @((Join-Path $PSScriptRoot 'scripts\pgyer-release.cjs'))
if ($Check) { $publishArguments += '--check' }
if ($SkipBuild) { $publishArguments += '--skip-build' }
if ($Login) { $publishArguments += '--login' }
if ($NewUpload) { $publishArguments += '--new-upload' }
if ($NotesFile) { $publishArguments += @('--notes-file', $NotesFile) }
if ($Channel) { $publishArguments += @('--channel', $Channel) }
if ($Resume) { $publishArguments += @('--resume', $Resume) }
& $publishNode @publishArguments
exit $LASTEXITCODE
