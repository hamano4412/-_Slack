# Slack-like を ngrok 経由で公開 URL として配信する。
#
# 事前準備(初回のみ):
#   1) winget install ngrok.ngrok
#   2) https://dashboard.ngrok.com/signup で無料登録
#   3) ngrok config add-authtoken <YOUR_TOKEN>
#
# 使い方:
#   .\tunnel.ps1
#
# 終了:
#   起動された backend / ngrok のウィンドウを閉じる。

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# 1) ngrok の存在チェック
$ngrokCmd = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $ngrokCmd) {
  Write-Host "ngrok が見つかりません。" -ForegroundColor Red
  Write-Host "  winget install ngrok.ngrok" -ForegroundColor Yellow
  Write-Host "  (または https://ngrok.com/download から ZIP を取得し PATH に通す)"
  Write-Host ""
  Write-Host "インストール後、初回のみ:"
  Write-Host "  ngrok config add-authtoken <YOUR_TOKEN>" -ForegroundColor Yellow
  Write-Host "  (token は https://dashboard.ngrok.com/get-started/your-authtoken)"
  exit 1
}

# 2) 依存をそろえる
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

# 3) frontend をビルド(backend が dist を配信するので、これで単一ポート構成になる)
Write-Host "[build] frontend ..." -ForegroundColor Cyan
Push-Location (Join-Path $root 'frontend')
try { npm run build } finally { Pop-Location }

# 4) backend を別ウィンドウで起動
Write-Host "[start] backend on http://localhost:3001 ..." -ForegroundColor Green
Start-Process -FilePath 'powershell.exe' `
  -ArgumentList @('-NoExit', '-Command', "cd `"$root\backend`"; npm run dev") | Out-Null

# 5) backend の起動を待機
Write-Host "[start] waiting for backend ..." -ForegroundColor Yellow
$deadline = (Get-Date).AddSeconds(30)
$ready = $false
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest -Uri 'http://localhost:3001/api/channels' -UseBasicParsing -TimeoutSec 1
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
  Start-Sleep -Milliseconds 500
}
if (-not $ready) {
  Write-Host "[error] backend が 30 秒以内に応答しませんでした。backend ウィンドウを確認してください。" -ForegroundColor Red
  exit 1
}

# 6) ngrok を別ウィンドウで起動(:3001 をトンネル)
Write-Host "[ngrok] starting tunnel for :3001 ..." -ForegroundColor Green
Start-Process -FilePath 'powershell.exe' `
  -ArgumentList @('-NoExit', '-Command', "ngrok http 3001") | Out-Null

# 7) ngrok のローカル API から公開 URL を取得
Write-Host "[ngrok] waiting for public URL ..." -ForegroundColor Yellow
$publicUrl = $null
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline -and -not $publicUrl) {
  try {
    $api = Invoke-RestMethod -Uri 'http://localhost:4040/api/tunnels' -TimeoutSec 1
    $publicUrl = $api.tunnels |
      Where-Object { $_.proto -eq 'https' } |
      Select-Object -First 1 -ExpandProperty public_url
  } catch {}
  if (-not $publicUrl) { Start-Sleep -Milliseconds 500 }
}

if (-not $publicUrl) {
  Write-Host "[error] 公開 URL が取得できませんでした。ngrok ウィンドウで状況を確認してください。" -ForegroundColor Red
  Write-Host "        (authtoken 未設定の可能性: ngrok config add-authtoken <TOKEN>)"
  exit 1
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  公開 URL :  $publicUrl" -ForegroundColor White
Write-Host "  ローカル :  http://localhost:3001" -ForegroundColor DarkGray
Write-Host "  ngrok UI :  http://localhost:4040" -ForegroundColor DarkGray
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "この URL を Chrome のアドレスバーに貼れば誰でも開けます。"
Write-Host "  - 初回アクセス時に ngrok の警告ページが出る場合があります。"
Write-Host "    「Visit Site」を押して進めてください(ngrok 無料プランの仕様)。"
Write-Host ""
Write-Host "終了するには backend / ngrok の PowerShell ウィンドウを閉じてください。" -ForegroundColor DarkGray

# 8) Chrome で開く
$chromePaths = @(
  "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "${env:LocalAppData}\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($chrome) {
  Write-Host "[start] opening Google Chrome ..." -ForegroundColor Green
  Start-Process -FilePath $chrome -ArgumentList $publicUrl
} else {
  Write-Host "[start] Chrome が見つかりません。既定ブラウザで開きます。" -ForegroundColor Yellow
  Start-Process $publicUrl
}
