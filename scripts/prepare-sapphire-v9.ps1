# Prepare padv9: remaining+raised liquid, Gnoswap auto-list, bond import, ammmathv2.
# Testnet: legacy pads not required.
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\sapphire-v9"
$rPad = Join-Path $OUT "r\$Address\gnomemepad\padv9"
# New pure path: on-chain ammmath is immutable and missing MaxNetInForTokenOut
$rAmm = Join-Path $OUT "p\$Address\gnomemepad\ammmathv2"

Remove-Item $OUT -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $rPad | Out-Null
New-Item -ItemType Directory -Force -Path $rAmm | Out-Null

Copy-Item "$ROOT\gno.land\p\gnomemepad\ammmath\*.gno" $rAmm
Get-ChildItem $rAmm -Filter "*_test.gno" -ErrorAction SilentlyContinue | Remove-Item -Force

Copy-Item "$ROOT\gno.land\r\gnomemepad\pad\*.gno" $rPad
Get-ChildItem $rPad -Filter "*_test.gno" -ErrorAction SilentlyContinue | Remove-Item -Force

# Full Gnoswap listing (CreatePool + GNS fee swap + Mint)
$fullList = Join-Path $ROOT "deploy\templates\gnoswap_list_full.gno"
if (-not (Test-Path $fullList)) { throw "missing $fullList" }
Copy-Item $fullList (Join-Path $rPad "gnoswap_list.gno") -Force

$ptsImport = "gno.land/r/$Address/gnomemepad/pointsv2"
$bondImport = "gno.land/r/$Address/gnomemepad/bond"
$ammImport = "gno.land/p/$Address/gnomemepad/ammmathv2"

Get-ChildItem $rPad -Filter "*.gno" | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  # Alias keeps ammmath.Foo in source while path/package is ammmathv2
  $c = $c -replace '"gno\.land/p/gnomemepad/ammmath"', "ammmath `"$ammImport`""
  $c = $c -replace 'gno\.land/p/gnomemepad/ammmath', $ammImport
  $c = $c -replace 'gno\.land/r/gnomemepad/pointsv2', $ptsImport
  $c = $c -replace 'gno\.land/r/gnomemepad/bond', $bondImport
  $c = $c -replace '(?m)^package pad\b', 'package padv9'
  $c = $c -replace 'GraduationThreshold int64 = 50_000_000', 'GraduationThreshold int64 = 100_000_000'
  $c = $c -replace 'CreateBondUgnot\s+int64 = 1_000_000', 'CreateBondUgnot      int64 = 2_000_000'
  $c = $c -replace 'BondRefundMinRaised\s+int64 = 5_000_000', 'BondRefundMinRaised  int64 = 10_000_000'
  $c = $c -replace 'AntiSnipeHeights\s+int64 = 20', 'AntiSnipeHeights   int64 = 30'
  $c = $c -replace 'AntiSnipeMaxBuyBPS int64 = 500', 'AntiSnipeMaxBuyBPS int64 = 300'
  $c = $c -replace 'MaxTradeHistory = 128', 'MaxTradeHistory = 256'
  [System.IO.File]::WriteAllText($_.FullName, $c)
}

# Path last element must match package clause: ammmathv2 (Gno rejects name/path mismatch).
Get-ChildItem $rAmm -Filter "*.gno" | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  $c = $c -replace '(?m)^package ammmath\b', 'package ammmathv2'
  [System.IO.File]::WriteAllText($_.FullName, $c)
}

$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText(
  (Join-Path $rPad "gnomod.toml"),
  "module = `"gno.land/r/$Address/gnomemepad/padv9`"`ngno = `"0.9`"`n",
  $utf8
)
[System.IO.File]::WriteAllText(
  (Join-Path $rAmm "gnomod.toml"),
  "module = `"$ammImport`"`ngno = `"0.9`"`n",
  $utf8
)

Write-Host "Prepared Sapphire V9:"
Write-Host "  pure: $ammImport  (includes MaxNetInForTokenOut)"
Write-Host "  pad:  gno.land/r/$Address/gnomemepad/padv9"
Write-Host "  bond: $bondImport (deploy bond first)"
Write-Host "Dir: $OUT"
