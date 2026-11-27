$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$ReleaseDir = Join-Path $Root "release"
$OutDir = Join-Path $ReleaseDir "AgentAtlas-portable"
$ZipPath = Join-Path $ReleaseDir "AgentAtlas-win-x64-portable.zip"
$RuntimeDir = Join-Path $OutDir "runtime"
$WebOutDir = Join-Path $OutDir "web"
$ContentOutDir = Join-Path $OutDir "content"

$WebDistSrc = Join-Path $Root "apps\web\dist"
Write-Output "[1/5] Cleaning previous web dist and building workspace..."
if (Test-Path $WebDistSrc) { Remove-Item -Recurse -Force $WebDistSrc }
& pnpm build
if ($LASTEXITCODE -ne 0) { throw "pnpm build failed with code $LASTEXITCODE" }

Write-Output "[2/5] Preparing portable staging folder..."
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
New-Item -ItemType Directory -Force -Path $OutDir, $RuntimeDir, $WebOutDir, $ContentOutDir | Out-Null

Write-Output "[3/5] Bundling server sidecar with esbuild..."
$nodeInfoJson = node -e "console.log(JSON.stringify({ major: Number(process.versions.node.split('.')[0]), arch: process.arch, execPath: process.execPath }))"
if ($LASTEXITCODE -ne 0) { throw "Failed to inspect Node.js runtime" }
$nodeInfo = $nodeInfoJson | ConvertFrom-Json
if ($nodeInfo.major -lt 24 -or $nodeInfo.arch -ne 'x64') {
  throw "Node.js >= 24 (x64) is required for portable packaging, got v$($nodeInfo.major) ($($nodeInfo.arch))"
}

$esbuildEntry = node -e "try { console.log(require.resolve('esbuild', { paths: [process.cwd(), 'apps/web'] })); } catch {}"
if (-not $esbuildEntry -or -not (Test-Path $esbuildEntry)) {
  $esbuildEntry = Get-ChildItem -Path (Join-Path $Root "node_modules\.pnpm") -Filter "esbuild@*" -Directory |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName "node_modules\esbuild\lib\main.js" } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
}

if (-not $esbuildEntry) {
  throw "Could not locate esbuild inside node_modules"
}

$serverEntry = Join-Path $Root "apps\server\src\index.ts"
$bundleOut = Join-Path $RuntimeDir "server.cjs"
$env:ATLAS_ESBUILD = $esbuildEntry
$env:ATLAS_ENTRY = $serverEntry
$env:ATLAS_OUT = $bundleOut
$esbuildRunner = @'
const esbuild = require(process.env.ATLAS_ESBUILD);
esbuild.build({
  entryPoints: [process.env.ATLAS_ENTRY],
  outfile: process.env.ATLAS_OUT,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  minify: true,
  external: ['node:sqlite'],
  define: { 'import.meta.url': 'undefined' },
}).then(() => {
  console.log('Bundled server sidecar:', process.env.ATLAS_OUT);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
'@
$esbuildRunner | node -
if ($LASTEXITCODE -ne 0) { throw "esbuild sidecar bundle failed" }

Copy-Item -Path $nodeInfo.execPath -Destination (Join-Path $RuntimeDir "node.exe") -Force
Copy-Item -Path (Join-Path $WebDistSrc "*") -Destination $WebOutDir -Recurse -Force
$indexBundles = @(Get-ChildItem -Path (Join-Path $WebOutDir "assets") -Filter "index-*.js" -File)
if ($indexBundles.Count -ne 1) {
  throw "Expected exactly 1 index-*.js bundle in $WebOutDir\assets, found $($indexBundles.Count)"
}
Copy-Item -Path (Join-Path $Root "content\*") -Destination $ContentOutDir -Recurse -Force

Write-Output "[4/5] Compiling Tauri 2 native desktop binary (release)..."
& cargo build --release --manifest-path (Join-Path $Root "src-tauri\Cargo.toml")
if ($LASTEXITCODE -ne 0) { throw "cargo build failed with code $LASTEXITCODE" }

$exeBuilt = Join-Path $Root "src-tauri\target\release\agent-atlas-desktop.exe"
if (-not (Test-Path $exeBuilt)) {
  throw "Expected Tauri binary not found: $exeBuilt"
}
Copy-Item -Path $exeBuilt -Destination (Join-Path $OutDir "AgentAtlas.exe") -Force

Write-Output "[5/5] Creating portable ZIP archive..."
Compress-Archive -Path (Join-Path $OutDir "*") -DestinationPath $ZipPath -Force

Write-Output ""
Write-Output "=== Portable Build Summary ==="
Get-ChildItem $OutDir | Select-Object Name, Length
Get-ChildItem $RuntimeDir | Select-Object Name, Length
Get-Item $ZipPath | Select-Object Name, Length
