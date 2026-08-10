# Prepare padv7: padv6 economics + points hooks + ListBuyers for holder UI.
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\sapphire-v7"
$rPad = Join-Path $OUT "r\$Address\gnomemepad\padv7"

Remove-Item $OUT -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $rPad | Out-Null

Copy-Item "$ROOT\gno.land\r\gnomemepad\pad\*.gno" $rPad
Get-ChildItem $rPad -Filter "*_test.gno" -ErrorAction SilentlyContinue | Remove-Item -Force

$ptsImport = "gno.land/r/$Address/gnomemepad/pointsv2"

Get-ChildItem $rPad -Filter "*.gno" | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  $c = $c -replace 'gno\.land/p/gnomemepad/ammmath', "gno.land/p/$Address/gnomemepad/ammmath"
  $c = $c -replace 'gno\.land/r/gnomemepad/pointsv2', $ptsImport
  $c = $c -replace '(?m)^package pad\b', 'package padv7'
  $c = $c -replace 'GraduationThreshold int64 = 50_000_000', 'GraduationThreshold int64 = 100_000_000'
  $c = $c -replace 'CreateBondUgnot\s+int64 = 1_000_000', 'CreateBondUgnot      int64 = 2_000_000'
  $c = $c -replace 'BondRefundMinRaised\s+int64 = 5_000_000', 'BondRefundMinRaised  int64 = 10_000_000'
  $c = $c -replace 'AntiSnipeHeights\s+int64 = 20', 'AntiSnipeHeights   int64 = 30'
  $c = $c -replace 'AntiSnipeMaxBuyBPS int64 = 500', 'AntiSnipeMaxBuyBPS int64 = 300'
  $c = $c -replace 'MaxTradeHistory = 128', 'MaxTradeHistory = 256'
  [System.IO.File]::WriteAllText($_.FullName, $c)
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$pkgPath = "gno.land/r/$Address/gnomemepad/padv7"
[System.IO.File]::WriteAllText(
  (Join-Path $rPad "gnomod.toml"),
  "module = `"$pkgPath`"`ngno = `"0.9`"`n",
  $utf8
)

Write-Host "Prepared Sapphire V7 (ListBuyers + points hooks):"
Write-Host "  $pkgPath"
Write-Host "Dir: $OUT"
