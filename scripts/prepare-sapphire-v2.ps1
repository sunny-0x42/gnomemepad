# Prepare deploy/sapphire-v2: GRC20 pad as package padv2 (name = last path element).
# ammmath already on-chain from v1.
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\sapphire-v2"
$rPad = Join-Path $OUT "r\$Address\gnomemepad\padv2"

Remove-Item $OUT -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $rPad | Out-Null

Copy-Item "$ROOT\gno.land\r\gnomemepad\pad\*.gno" $rPad
Get-ChildItem $rPad -Filter "*_test.gno" -ErrorAction SilentlyContinue | Remove-Item -Force

Get-ChildItem $rPad -Filter "*.gno" | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  # Personal ammmath
  $c = $c -replace 'gno\.land/p/gnomemepad/ammmath', "gno.land/p/$Address/gnomemepad/ammmath"
  # Package name must equal last path segment (padv2)
  $c = $c -replace '(?m)^package pad\b', 'package padv2'
  [System.IO.File]::WriteAllText($_.FullName, $c)
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$pkgPath = "gno.land/r/$Address/gnomemepad/padv2"
[System.IO.File]::WriteAllText(
  (Join-Path $rPad "gnomod.toml"),
  "module = `"$pkgPath`"`ngno = `"0.9`"`n",
  $utf8
)

Write-Host "Prepared Sapphire V2 (GRC20):"
Write-Host "  $pkgPath"
Write-Host "  package padv2"
Write-Host "  ammmath: gno.land/p/$Address/gnomemepad/ammmath"
Write-Host "  grc20:   gno.land/p/demo/tokens/grc20"
Write-Host "Dir: $OUT"
