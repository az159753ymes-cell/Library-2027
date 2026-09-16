$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$nodePath = $nodeCommand.Source
$serverScript = Join-Path $PSScriptRoot 'local-preview-server.js'
$chromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$siteUrl = 'http://localhost:4173/'
$healthUrl = 'http://127.0.0.1:4173/'

try {
  Invoke-WebRequest -UseBasicParsing $healthUrl -TimeoutSec 1 | Out-Null
} catch {
  # Quote the script path because Start-Process joins arguments into one command line.
  Start-Process -FilePath $nodePath -ArgumentList ('"{0}" 4173' -f $serverScript) -WorkingDirectory $projectRoot -WindowStyle Hidden

  $isReady = $false
  for ($attempt = 1; $attempt -le 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      Invoke-WebRequest -UseBasicParsing $healthUrl -TimeoutSec 1 | Out-Null
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
