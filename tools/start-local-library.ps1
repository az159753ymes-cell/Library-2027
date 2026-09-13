$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = 'C:\Users\az159\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$serverScript = Join-Path $PSScriptRoot 'local-preview-server.js'
$chromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$siteUrl = 'http://localhost:4173/'

try {
  Invoke-WebRequest -UseBasicParsing $siteUrl -TimeoutSec 1 | Out-Null
} catch {
  Start-Process -FilePath $nodePath -ArgumentList @($serverScript, '4173') -WorkingDirectory $projectRoot -WindowStyle Hidden

  $isReady = $false
  for ($attempt = 1; $attempt -le 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      Invoke-WebRequest -UseBasicParsing $siteUrl -TimeoutSec 1 | Out-Null
      $isReady = $true
      break
    } catch {
      # The local server is still starting.
    }
  }

  if (-not $isReady) {
    throw 'The local preview server did not start within 10 seconds. Check the complete project folder and run tools\start-local-library.ps1 again.'
  }
}

Start-Process -FilePath $chromePath -ArgumentList $siteUrl
