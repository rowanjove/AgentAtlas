$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "=== AgentAtlas Local Workbench Launcher ===" -ForegroundColor Cyan

if (-not (Test-Path "node_modules")) {
  Write-Host "[1/3] Installing workspace dependencies..."
  pnpm install
}

if (-not (Test-Path "apps/server/dist/index.js") -or -not (Test-Path "apps/web/dist/index.html")) {
  Write-Host "[2/3] Building AgentAtlas packages, server, and web UI..."
  pnpm build
}

$Port = if ($env:AGENT_ATLAS_PORT) { $env:AGENT_ATLAS_PORT } else { "4317" }
$Url = "http://127.0.0.1:$Port"

try {
  $existing = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 2
  if ($existing.status -eq 'ok') {
    Write-Host "AgentAtlas is already running at $Url (RSS: $($existing.memoryRssMb) MB). Opening browser..." -ForegroundColor Green
    Start-Process $Url
    exit 0
  }
} catch {
  # Port is not serving AgentAtlas yet; proceed to launch
}

Write-Host "[3/3] Starting AgentAtlas local server at $Url ..."
Start-Job -ScriptBlock {
  param($url)
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $r = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2
      if ($r.status -eq 'ok') {
        Start-Process $url
        break
      }
    } catch {
      Start-Sleep -Milliseconds 400
    }
  }
} -ArgumentList $Url | Out-Null

node apps/server/dist/index.js
