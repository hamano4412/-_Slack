# Slack-like 開発サーバを起動して Google Chrome で開く。
# 使い方: PowerShell でこのファイルを実行する (Right-click → "Run with PowerShell" でも可)。

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Ensure-Deps($dir) {
  $nm = Join-Path $dir 'node_modules'
  $pj = Join-Path $dir 'package.json'
  $needInstall = (-not (Test-Path $nm)) -or `
    ((Get-Item $pj).LastWriteTime -gt (Get-Item $nm).LastWriteTime)
  if ($needInstall) {
    Write-Host "[setup] installing dependencies in $dir ..." -ForegroundColor Cyan
    Push-Location $dir
    try { npm install } finally { Pop-Location }
  }
}

Ensure-Deps (Join-Path $root 'backend')
Ensure-Deps (Join-Path $root 'frontend')

Write-Host "[start] launching backend (http://localhost:3001) ..." -ForegroundColor Green
Start-Process -FilePath 'powershell.exe' `
  -ArgumentList @('-NoExit', '-Command', "cd `"$root\backend`"; npm run dev")

Write-Host "[start] launching frontend (https://localhost:5173) ..." -ForegroundColor Green
Start-Process -FilePath 'powershell.exe' `
  -ArgumentList @('-NoExit', '-Command', "cd `"$root\frontend`"; npm run dev")

# Vite (HTTPS 自己署名) が起動するまで待つ — 証明書検証を回避するため TCP ポートのみ確認
Write-Host "[start] waiting for Vite to be ready ..." -ForegroundColor Yellow
$deadline = (Get-Date).AddSeconds(30)
$ready = $false
while ((Get-Date) -lt $deadline) {
  $probe = Test-NetConnection -ComputerName 'localhost' -Port 5173 -WarningAction SilentlyContinue
  if ($probe.TcpTestSucceeded) { $ready = $true; break }
  Start-Sleep -Milliseconds 500
}

if (-not $ready) {
  Write-Host "[start] Vite が 30 秒以内に応答しませんでした。手動で https://localhost:5173 を開いてください。" -ForegroundColor Yellow
}

# Chrome で開く
$chromePaths = @(
  "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "${env:LocalAppData}\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($chrome) {
  Write-Host "[start] opening Google Chrome ..." -ForegroundColor Green
  Start-Process -FilePath $chrome -ArgumentList 'https://localhost:5173'
} else {
  Write-Host "[start] Chrome が見つかりませんでした。既定のブラウザで開きます。" -ForegroundColor Yellow
  Start-Process 'https://localhost:5173'
}

Write-Host ""
Write-Host "終了するには backend / frontend の PowerShell ウィンドウをそれぞれ閉じてください。" -ForegroundColor Cyan
