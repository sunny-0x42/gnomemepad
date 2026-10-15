# Prepare padv11:
# - sold-out graduation escape (Buy refunds + Graduate when RealSold >= CurveSupply)
# - VirtualToken0 retuned so GraduationThreshold 100 GNOT is reachable BEFORE sold-out
#   (padv10 stuck at ~87.9 GNOT raise with full 800M curve sold)
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\sapphire-v11"
$rPad = Join-Path $OUT "r\$Address\gnomemepad\padv11"
# Reuse on-chain ammmathv2 (has MaxNetInForTokenOut)
$rAmm = Join-Path $OUT "p\$Address\gnomemepad\ammmathv2"

Remove-Item $OUT -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $rPad | Out-Null
New-Item -ItemType Directory -Force -Path $rAmm | Out-Null

Copy-Item "$ROOT\gno.land\p\gnomemepad\ammmath\*.gno" $rAmm
Get-ChildItem $rAmm -Filter "*_test.gno" -ErrorAction SilentlyContinue | Remove-Item -Force

Copy-Item "$ROOT\gno.land\r\gnomemepad\pad\*.gno" $rPad
Get-ChildItem $rPad -Filter "*_test.gno" -ErrorAction SilentlyContinue | Remove-Item -Force

$fullList = Join-Path $ROOT "deploy\templates\gnoswap_list_full.gno"
if (-not (Test-Path $fullList)) { throw "missing $fullList" }
Copy-Item $fullList (Join-Path $rPad "gnoswap_list.gno") -Force

$ptsImport = "gno.land/r/$Address/gnomemepad/pointsv2"
$bondImport = "gno.land/r/$Address/gnomemepad/bond"
$ammImport = "gno.land/p/$Address/gnomemepad/ammmathv2"

Get-ChildItem $rPad -Filter "*.gno" | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  $c = $c -replace '"gno\.land/p/gnomemepad/ammmath"', "ammmath `"$ammImport`""
  $c = $c -replace 'gno\.land/p/gnomemepad/ammmath', $ammImport
  $c = $c -replace 'gno\.land/r/gnomemepad/pointsv2', $ptsImport
  $c = $c -replace 'gno\.land/r/gnomemepad/bond', $bondImport
  $c = $c -replace '(?m)^package pad\b', 'package padv11'
  $c = $c -replace 'GraduationThreshold int64 = 50_000_000', 'GraduationThreshold int64 = 100_000_000'
  # Max raise at full CurveSupply with VU0=30e6, VT0=1.02e9:
  #   R = 30e6 * 800e6 / (1.02e9 - 800e6) ≈ 109.09e6 > 100e6 threshold.
  # padv10 used VT0=1.073e9 → R≈87.9e6 < 100e6 (stuck sold-out).
  $c = $c -replace 'VirtualToken0 int64 = 1_073_000_191', 'VirtualToken0 int64 = 1_020_000_000'
  $c = $c -replace 'CreateBondUgnot\s+int64 = 1_000_000', 'CreateBondUgnot      int64 = 2_000_000'
  $c = $c -replace 'CreateBondUgnot\s+int64 = 2_000_000', 'CreateBondUgnot      int64 = 2_000_000'
  $c = $c -replace 'BondRefundMinRaised\s+int64 = 5_000_000', 'BondRefundMinRaised  int64 = 10_000_000'
  $c = $c -replace 'AntiSnipeHeights\s+int64 = 20', 'AntiSnipeHeights   int64 = 30'
  $c = $c -replace 'AntiSnipeMaxBuyBPS int64 = 500', 'AntiSnipeMaxBuyBPS int64 = 300'
  $c = $c -replace 'MaxTradeHistory = 128', 'MaxTradeHistory = 256'
  [System.IO.File]::WriteAllText($_.FullName, $c)
}

Get-ChildItem $rAmm -Filter "*.gno" | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  $c = $c -replace '(?m)^package ammmath\b', 'package ammmathv2'
  [System.IO.File]::WriteAllText($_.FullName, $c)
}

$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText(
  (Join-Path $rPad "gnomod.toml"),
  "module = `"gno.land/r/$Address/gnomemepad/padv11`"`ngno = `"0.9`"`n",
  $utf8
)
[System.IO.File]::WriteAllText(
  (Join-Path $rAmm "gnomod.toml"),
  "module = `"$ammImport`"`ngno = `"0.9`"`n",
  $utf8
)

Write-Host "Prepared Sapphire V11 (sold-out graduate + reachable 100 GNOT raise):"
Write-Host "  pure: $ammImport"
Write-Host "  pad:  gno.land/r/$Address/gnomemepad/padv11"
Write-Host "  VirtualToken0 = 1_020_000_000 (max raise ~109 GNOT > threshold 100)"
Write-Host "Dir: $OUT"
