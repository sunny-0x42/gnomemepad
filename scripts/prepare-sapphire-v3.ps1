# Prepare deploy/sapphire-v3: GRC20 + grc20reg.Register as package padv3.
# ammmath already on-chain from v1.
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\sapphire-v3"
$rPad = Join-Path $OUT "r\$Address\gnomemepad\padv3"

Remove-Item $OUT -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $rPad | Out-Null

Copy-Item "$ROOT\gno.land\r\gnomemepad\pad\*.gno" $rPad
Get-ChildItem $rPad -Filter "*_test.gno" -ErrorAction SilentlyContinue | Remove-Item -Force

Get-ChildItem $rPad -Filter "*.gno" | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  # Personal ammmath
  $c = $c -replace 'gno\.land/p/gnomemepad/ammmath', "gno.land/p/$Address/gnomemepad/ammmath"
  # Package name must equal last path segment (padv3)
  $c = $c -replace '(?m)^package pad\b', 'package padv3'
  [System.IO.File]::WriteAllText($_.FullName, $c)
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$pkgPath = "gno.land/r/$Address/gnomemepad/padv3"
[System.IO.File]::WriteAllText(
  (Join-Path $rPad "gnomod.toml"),
  "module = `"$pkgPath`"`ngno = `"0.9`"`n",
  $utf8
)

Write-Host "Prepared Sapphire V3 (GRC20 + grc20reg):"
Write-Host "  $pkgPath"
Write-Host "  package padv3"
Write-Host "  ammmath: gno.land/p/$Address/gnomemepad/ammmath"
Write-Host "  grc20:   gno.land/p/demo/tokens/grc20"
Write-Host "  reg:     gno.land/r/demo/defi/grc20reg"
Write-Host "Dir: $OUT"
