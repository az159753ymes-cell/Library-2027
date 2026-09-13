param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^v\d+\.\d+\.\d+$')]
  [string]$Version,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Summary
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$projectContainer = Split-Path -Parent $projectRoot
$backupRoot = Join-Path $projectContainer '圖書館系統版本控制'
$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$safeSummary = ($Summary -replace '[\\/:*?"<>|]', '_').Trim()
$backupName = "圖書館系統_${Version}_${safeSummary}_備份_${timestamp}"
$archivePath = Join-Path $backupRoot "$backupName.zip"
$stagingPath = Join-Path $backupRoot "$backupName.staging"
$excludedNames = @('.git', 'backups', 'scratch', '.firebase', 'node_modules', '.sites-runtime')

if (Test-Path -LiteralPath $archivePath) {
  throw "備份檔已存在，為避免覆寫已停止：$archivePath"
}

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stagingPath -Force | Out-Null

try {
  Get-ChildItem -LiteralPath $projectRoot -Force |
    Where-Object { $_.Name -notin $excludedNames } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $stagingPath -Recurse -Force }

  # 專案副本可能尚未包含 .git；備份仍須可完成，不能因 Git 查詢的 stderr 被嚴格錯誤設定中斷。
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $gitRevision = (& git -C $projectRoot rev-parse HEAD 2>$null)
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if (-not $gitRevision) { $gitRevision = '無法取得 Git 提交資訊' }

  @(
    "備份建立時間：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    "版本：$Version"
    "說明：$Summary"
    "Git 提交：$gitRevision"
    '內容：專案程式、素材、設定與文件；Firestore 正式資料請另以管理員 JSON 備份保護。'
  ) | Set-Content -LiteralPath (Join-Path $stagingPath '備份資訊.txt') -Encoding utf8

  Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $stagingPath -Force | Select-Object -ExpandProperty FullName) -DestinationPath $archivePath -CompressionLevel Optimal
  Write-Host "備份完成：$archivePath"
}
finally {
  if (Test-Path -LiteralPath $stagingPath) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
  }
}

