# Prepare padv5: same GRC20 pad as v4 with stricter "mainnet-ready testnet" params.
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\sapphire-v5"
$rPad = Join-Path $OUT "r\$Address\gnomemepad\padv5"

Remove-Item $OUT -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $rPad | Out-Null

Copy-Item "$ROOT\gno.land\r\gnomemepad\pad\*.gno" $rPad
Get-ChildItem $rPad -Filter "*_test.gno" -ErrorAction SilentlyContinue | Remove-Item -Force

Get-ChildItem $rPad -Filter "*.gno" | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  $c = $c -replace 'gno\.land/p/gnomemepad/ammmath', "gno.land/p/$Address/gnomemepad/ammmath"
  $c = $c -replace '(?m)^package pad\b', 'package padv5'
  # padv5 economic params
  $c = $c -replace 'GraduationThreshold int64 = 50_000_000', 'GraduationThreshold int64 = 100_000_000'
  $c = $c -replace 'CreateBondUgnot\s+int64 = 1_000_000', 'CreateBondUgnot      int64 = 2_000_000'
  $c = $c -replace 'BondRefundMinRaised\s+int64 = 5_000_000', 'BondRefundMinRaised  int64 = 10_000_000'
  $c = $c -replace 'AntiSnipeHeights\s+int64 = 20', 'AntiSnipeHeights   int64 = 30'
  $c = $c -replace 'AntiSnipeMaxBuyBPS int64 = 500', 'AntiSnipeMaxBuyBPS int64 = 300'
  $c = $c -replace 'MaxTradeHistory = 128', 'MaxTradeHistory = 256'
  [System.IO.File]::WriteAllText($_.FullName, $c)
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$pkgPath = "gno.land/r/$Address/gnomemepad/padv5"
[System.IO.File]::WriteAllText(
  (Join-Path $rPad "gnomod.toml"),
  "module = `"$pkgPath`"`ngno = `"0.9`"`n",
  $utf8
)

Write-Host "Prepared Sapphire V5 (stricter params):"
Write-Host "  $pkgPath"
Write-Host "  bond=2 GNOT  graduate=100 GNOT  anti-snipe=3%/30h  history=256"
Write-Host "Dir: $OUT"
