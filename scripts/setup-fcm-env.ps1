[CmdletBinding()]
param(
    [string]$RedisUrl = 'redis://localhost:6379'
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repositoryRoot 'backend/.env'
$envExampleFile = Join-Path $repositoryRoot 'backend/.env.example'

$serviceAccountFiles = @(
    Get-ChildItem -LiteralPath $repositoryRoot -File -Filter '*-firebase-adminsdk-*.json'
)

if ($serviceAccountFiles.Count -eq 0) {
    throw "No Firebase service-account JSON matching *-firebase-adminsdk-*.json was found in: $repositoryRoot"
}

if ($serviceAccountFiles.Count -gt 1) {
    throw 'Multiple Firebase service-account JSON files were found in the repository root. Keep only the intended file, then run this script again.'
}

$serviceAccountFile = $serviceAccountFiles[0].FullName

if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    Copy-Item -LiteralPath $envExampleFile -Destination $envFile
}

# Parse then compress the JSON so it is a valid one-line dotenv value. Do not print it.
$serviceAccountJson = Get-Content -Raw -LiteralPath $serviceAccountFile |
    ConvertFrom-Json |
    ConvertTo-Json -Compress

$settings = [ordered]@{
    FCM_ENABLED                    = 'true'
    FIREBASE_SERVICE_ACCOUNT        = $serviceAccountJson
    NOTIFICATION_DELIVERY_ENABLED   = 'true'
    REDIS_URL                       = $RedisUrl
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

[System.IO.File]::WriteAllLines(
    $envFile,
    $lines,
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host 'FCM backend settings were written to backend/.env.'
Write-Host "Redis is set to $RedisUrl."
Write-Host 'Do not commit backend/.env or the Firebase service-account JSON file.'
