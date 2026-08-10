# Prepare deploy/sapphire-pointsv2 from gno.land/r/gnomemepad/pointsv2
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\sapphire-pointsv2"
$dst = Join-Path $OUT "r\$Address\gnomemepad\pointsv2"

Remove-Item $OUT -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $dst | Out-Null

Copy-Item "$ROOT\gno.land\r\gnomemepad\pointsv2\*.gno" $dst
Get-ChildItem $dst -Filter "*_test.gno" -ErrorAction SilentlyContinue | Remove-Item -Force

$utf8 = New-Object System.Text.UTF8Encoding $false
$pkgPath = "gno.land/r/$Address/gnomemepad/pointsv2"
[System.IO.File]::WriteAllText(
  (Join-Path $dst "gnomod.toml"),
  "module = `"$pkgPath`"`ngno = `"0.9`"`n",
  $utf8
)

Write-Host "Prepared Sapphire pointsv2:"
Write-Host "  $pkgPath"
Write-Host "Dir: $OUT"
