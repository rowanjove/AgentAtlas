param(
  [string]$OutputPath = (Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "assets\agent-atlas.ico"),
  [string]$SourcePng = ""
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$outDir = Split-Path -Parent $OutputPath
if (-not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

if (-not $SourcePng) {
  $brandCandidate = Join-Path $RootDir "assets\brand-icon.png"
  $rootZhName = ([char]0x56FE) + ([char]0x6807) + ".png"
  $rootCandidate = Join-Path $RootDir $rootZhName
  if (Test-Path $brandCandidate) {
    $SourcePng = $brandCandidate
  } elseif (Test-Path $rootCandidate) {
    $SourcePng = $rootCandidate
  }
}

function Resize-PngBytes([System.Drawing.Image]$srcImg, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($srcImg, 0, 0, $size, $size)

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  [byte[]]$bytes = $ms.ToArray()
  $ms.Dispose()
  $g.Dispose()
  $bmp.Dispose()
  return ,$bytes
}

function New-FallbackIconPngBytes([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = [math]::Max(1, [int]([math]::Round($size * 0.04)))
  $rectSize = $size - ($pad * 2)
  $radius = [math]::Max(4, [int]([math]::Round($size * 0.22)))
  $diam = $radius * 2

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($pad, $pad, $diam, $diam, 180, 90)
  $path.AddArc($pad + $rectSize - $diam, $pad, $diam, $diam, 270, 90)
  $path.AddArc($pad + $rectSize - $diam, $pad + $rectSize - $diam, $diam, $diam, 0, 90)
  $path.AddArc($pad, $pad + $rectSize - $diam, $diam, $diam, 90, 90)
  $path.CloseFigure()

  $bgColor = [System.Drawing.Color]::FromArgb(255, 49, 93, 181) # #315DB5
  $bgBrush = New-Object System.Drawing.SolidBrush($bgColor)
  $g.FillPath($bgBrush, $path)

  $fontSize = [float]($size * 0.40)
  $font = New-Object System.Drawing.Font("Consolas", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rectF = New-Object System.Drawing.RectangleF(0, ($size * 0.03), $size, $size)
  $g.DrawString("AA", $font, [System.Drawing.Brushes]::White, $rectF, $sf)

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  [byte[]]$bytes = $ms.ToArray()

  $ms.Dispose()
  $sf.Dispose()
  $font.Dispose()
  $bgBrush.Dispose()
  $path.Dispose()
  $g.Dispose()
  $bmp.Dispose()
  return ,$bytes
}

$sizes = @(16, 32, 48, 64, 128, 256)
$frames = @()
if ($SourcePng -and (Test-Path $SourcePng)) {
  $srcImg = [System.Drawing.Bitmap]::FromFile($SourcePng)
  try {
    foreach ($s in $sizes) {
      [byte[]]$png = Resize-PngBytes $srcImg $s
      if ($png.Length -lt 50) { throw "Invalid PNG frame size for $s" }
      $frames += ,@{ Size = $s; Data = $png }
    }
  } finally {
    $srcImg.Dispose()
  }
} else {
  foreach ($s in $sizes) {
    [byte[]]$png = New-FallbackIconPngBytes $s
    if ($png.Length -lt 50) { throw "Invalid PNG frame size for $s" }
    $frames += ,@{ Size = $s; Data = $png }
  }
}

$fs = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICONDIR header (6 bytes)
$bw.Write([UInt16]0)             # Reserved
$bw.Write([UInt16]1)             # Type = 1 (ICO)
$bw.Write([UInt16]$frames.Count) # Count

$offset = 6 + (16 * $frames.Count)
foreach ($f in $frames) {
  $dim = if ($f.Size -ge 256) { [byte]0 } else { [byte]$f.Size }
  $bw.Write($dim)                # Width
  $bw.Write($dim)                # Height
  $bw.Write([byte]0)             # ColorCount
  $bw.Write([byte]0)             # Reserved
  $bw.Write([UInt16]1)           # Planes
  $bw.Write([UInt16]32)          # BitCount
  $bw.Write([UInt32]$f.Data.Length)
  $bw.Write([UInt32]$offset)
  $offset += $f.Data.Length
}

$bw.Flush()
foreach ($f in $frames) {
  [byte[]]$buf = $f.Data
  $fs.Write($buf, 0, $buf.Length)
}
$fs.Flush()
$bw.Dispose()
$fs.Dispose()

Write-Output "Generated icon: $OutputPath ($((Get-Item $OutputPath).Length) bytes)"
