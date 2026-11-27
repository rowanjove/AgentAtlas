param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Port = if ($env:AGENT_ATLAS_PORT) { $env:AGENT_ATLAS_PORT } else { "4317" }
$Url = "http://127.0.0.1:$Port"
$DataDir = if ($env:AGENT_ATLAS_DATA_DIR) { $env:AGENT_ATLAS_DATA_DIR } else { Join-Path $Root "data" }
if (-not (Test-Path $DataDir)) {
  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}
$LogFile = Join-Path $DataDir "server.log"
$ErrLogFile = Join-Path $DataDir "server.err.log"
$IconPath = Join-Path $Root "assets\agent-atlas.ico"

function Test-AtlasHealth {
  try {
    $res = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 2
    return $res
  } catch {
    return $null
  }
}

function Find-AppBrowser {
  $candidates = @(
    "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  return $null
}

function Open-AtlasWindow {
  param([switch]$DefaultBrowser)
  if (-not $DefaultBrowser) {
    $browser = Find-AppBrowser
    if ($browser) {
      Start-Process -FilePath $browser -ArgumentList "--app=$Url" | Out-Null
      return
    }
  }
  Start-Process $Url | Out-Null
}

# Single-instance check: reuse running AgentAtlas server if already alive
$already = Test-AtlasHealth
if ($already -and $already.status -eq 'ok') {
  if (-not $NoBrowser) {
    Open-AtlasWindow
  }
  exit 0
}

# Verify build artifacts before launching
if (-not (Test-Path "node_modules")) {
  [System.Windows.Forms.MessageBox]::Show("首次运行正在安装依赖，请在项目目录运行一次 pnpm install 或 start.ps1。", "AgentAtlas", "OK", "Information") | Out-Null
  exit 1
}

if (-not (Test-Path "apps\server\dist\index.js") -or -not (Test-Path "apps\web\dist\index.html")) {
  $pBuild = Start-Process -FilePath "pnpm" -ArgumentList "build" -WorkingDirectory $Root -Wait -PassThru -WindowStyle Hidden
  if ($pBuild.ExitCode -ne 0) {
    [System.Windows.Forms.MessageBox]::Show("构建失败，请打开终端运行 pnpm build 检查错误。", "AgentAtlas", "OK", "Error") | Out-Null
    exit 1
  }
}

$script:ServerProc = $null

function Start-AtlasServer {
  $proc = Start-Process -FilePath "node" `
    -ArgumentList "apps/server/dist/index.js" `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $LogFile `
    -RedirectStandardError $ErrLogFile `
    -PassThru

  $script:ServerProc = $proc

  for ($i = 0; $i -lt 40; $i++) {
    $h = Test-AtlasHealth
    if ($h -and $h.status -eq 'ok') {
      return $h
    }
    if ($proc.HasExited) {
      throw "AgentAtlas server exited prematurely (code $($proc.ExitCode)). Check $ErrLogFile"
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Timed out waiting for AgentAtlas server at $Url"
}

function Stop-AtlasServer {
  if ($script:ServerProc -and -not $script:ServerProc.HasExited) {
    try {
      $null = $script:ServerProc.CloseMainWindow()
      if (-not $script:ServerProc.WaitForExit(1500)) {
        Stop-Process -Id $script:ServerProc.Id -Force -ErrorAction SilentlyContinue
        $script:ServerProc.WaitForExit(3000) | Out-Null
      }
    } catch {}
  }
  $script:ServerProc = $null
}

try {
  $health = Start-AtlasServer
} catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "AgentAtlas 启动失败", "OK", "Error") | Out-Null
  Stop-AtlasServer
  exit 1
}

if (-not $NoBrowser) {
  Open-AtlasWindow
}

# Build System Tray Icon & Context Menu
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Text = "AgentAtlas · Local Workbench ($Url)"
if (Test-Path $IconPath) {
  $tray.Icon = New-Object System.Drawing.Icon($IconPath)
} else {
  $tray.Icon = [System.Drawing.SystemIcons]::Application
}
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$itemOpenApp = $menu.Items.Add("打开 AgentAtlas（独立窗口）")
$itemOpenApp.Font = New-Object System.Drawing.Font($itemOpenApp.Font, [System.Drawing.FontStyle]::Bold)
$itemOpenApp.Add_Click({ Open-AtlasWindow })

$itemOpenBrowser = $menu.Items.Add("在默认浏览器中打开")
$itemOpenBrowser.Add_Click({ Open-AtlasWindow -DefaultBrowser })

$null = $menu.Items.Add("-")

$itemStatus = $menu.Items.Add("查看运行状态")
$itemStatus.Add_Click({
  $h = Test-AtlasHealth
  if ($h) {
    $msg = "状态: 运行中`n地址: $Url`n运行时间: $($h.uptimeSec) 秒`n内存占用: $($h.memoryRssMb) MB`n知识节点: $($h.contentStats.nodes) 篇 · 学习路径: $($h.contentStats.paths) 条"
    [System.Windows.Forms.MessageBox]::Show($msg, "AgentAtlas 运行状态", "OK", "Information") | Out-Null
  } else {
    [System.Windows.Forms.MessageBox]::Show("本地服务未响应，请尝试重启服务。", "AgentAtlas 运行状态", "OK", "Warning") | Out-Null
  }
})

$itemRestart = $menu.Items.Add("重启本地服务")
$itemRestart.Add_Click({
  Stop-AtlasServer
  try {
    Start-AtlasServer | Out-Null
    $tray.ShowBalloonTip(2000, "AgentAtlas", "本地服务已重启 ($Url)", [System.Windows.Forms.ToolTipIcon]::Info)
  } catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "重启失败", "OK", "Error") | Out-Null
  }
})

$itemShortcut = $menu.Items.Add("创建桌面快捷方式")
$itemShortcut.Add_Click({
  $createScript = Join-Path $Root "scripts\create-shortcut.ps1"
  if (Test-Path $createScript) {
    & $createScript -Desktop | Out-Null
    $tray.ShowBalloonTip(2500, "AgentAtlas", "已在桌面创建 AgentAtlas 快捷方式", [System.Windows.Forms.ToolTipIcon]::Info)
  }
})

$itemDataDir = $menu.Items.Add("打开数据与日志目录")
$itemDataDir.Add_Click({ Start-Process "explorer.exe" $DataDir | Out-Null })

$null = $menu.Items.Add("-")

$itemExit = $menu.Items.Add("退出 AgentAtlas")
$itemExit.Add_Click({
  $tray.Visible = $false
  $tray.Dispose()
  Stop-AtlasServer
  [System.Windows.Forms.Application]::Exit()
})

$tray.ContextMenuStrip = $menu
$tray.Add_DoubleClick({ Open-AtlasWindow })

if (-not $NoBrowser) {
  $tray.ShowBalloonTip(2200, "AgentAtlas 已在后台运行", "双击托盘图标可随时打开工作台 ($Url)", [System.Windows.Forms.ToolTipIcon]::Info)
}

$appCtx = New-Object System.Windows.Forms.ApplicationContext
try {
  [System.Windows.Forms.Application]::Run($appCtx)
} finally {
  $tray.Visible = $false
  $tray.Dispose()
  Stop-AtlasServer
}
