[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repositoryRoot 'backend/.env'
$envExampleFile = Join-Path $repositoryRoot 'backend/.env.example'
$serviceAccountFiles = @(Get-ChildItem -LiteralPath $repositoryRoot -File -Filter '*-firebase-adminsdk-*.json')

if ($serviceAccountFiles.Count -eq 0) {
    throw "No Firebase service-account JSON matching *-firebase-adminsdk-*.json was found in: $repositoryRoot"
}
if ($serviceAccountFiles.Count -gt 1) {
    throw 'Multiple Firebase service-account JSON files were found. Keep only the intended file, then retry.'
}
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    Copy-Item -LiteralPath $envExampleFile -Destination $envFile
}

$serviceAccountJson = Get-Content -Raw -LiteralPath $serviceAccountFiles[0].FullName |
    ConvertFrom-Json |
    ConvertTo-Json -Compress
$settings = [ordered]@{
    FIREBASE_AUTH_ENABLED = 'true'
    FIREBASE_PHONE_DEFAULT_COUNTRY_CODE = '+91'
    FIREBASE_SERVICE_ACCOUNT = $serviceAccountJson
}

$lines = [System.Collections.Generic.List[string]]@(Get-Content -LiteralPath $envFile)
foreach ($entry in $settings.GetEnumerator()) {
    $replacement = "$($entry.Key)=$($entry.Value)"
    $index = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match ('^' + [regex]::Escape($entry.Key) + '=')) {
            $index = $i
            break
        }
    }
    if ($index -ge 0) {
        $lines[$index] = $replacement
    }
    else {
        $lines.Add($replacement)
    }
}

[System.IO.File]::WriteAllLines($envFile, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Host 'Firebase Auth backend settings were written to backend/.env.'
Write-Host 'Do not commit backend/.env or the Firebase service-account JSON file.'
