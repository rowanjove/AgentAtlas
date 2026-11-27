param(
  [switch]$Desktop
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$VbsPath = Join-Path $Root "scripts\launch-hidden.vbs"
$IconPath = Join-Path $Root "assets\agent-atlas.ico"

if (-not (Test-Path $IconPath)) {
  $genScript = Join-Path $Root "scripts\generate-icon.ps1"
  & $genScript -OutputPath $IconPath | Out-Null
}

$wsh = New-Object -ComObject WScript.Shell

function New-AtlasShortcut([string]$ShortcutPath) {
  $sc = $wsh.CreateShortcut($ShortcutPath)
  $sc.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $sc.Arguments = "//B `"$VbsPath`""
  $sc.WorkingDirectory = $Root
  $sc.Description = "AgentAtlas · Local-first AI Agent Engineering Workbench"
  if (Test-Path $IconPath) {
    $sc.IconLocation = "$IconPath,0"
  }
  $sc.Save()
  Write-Output "Created shortcut: $ShortcutPath"
}

$rootShortcut = Join-Path $Root "AgentAtlas.lnk"
New-AtlasShortcut $rootShortcut

if ($Desktop) {
  $desktopDir = [Environment]::GetFolderPath("Desktop")
  $desktopShortcut = Join-Path $desktopDir "AgentAtlas.lnk"
  New-AtlasShortcut $desktopShortcut
}
