# Prepare padv19: same as padv18 push-pay + ClaimWugnot, BUT graduate never
# auto-lists (Gnoswap Mint panic "insufficient allowance" was reverting last-fill Buy).
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\sapphire-v19"
$rPad = Join-Path $OUT "r\$Address\gnomemepad\padv19"
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

function Set-Const([string]$Text, [string]$Name, [string]$NewVal) {
  $pat = "(?m)^(\s*)$([regex]::Escape($Name))\s+int64\s*=\s*[0-9_]+"
  return [regex]::Replace($Text, $pat, "`${1}$Name int64 = $NewVal")
}

$utf8 = New-Object System.Text.UTF8Encoding $false

Get-ChildItem $rPad -Filter "*.gno" | ForEach-Object {
  $c = [System.IO.File]::ReadAllText($_.FullName, $utf8)
  $c = $c -replace '"gno\.land/p/gnomemepad/ammmath"', "ammmath `"$ammImport`""
  $c = $c -replace 'gno\.land/p/gnomemepad/ammmath', $ammImport
  $c = $c -replace 'gno\.land/r/gnomemepad/pointsv2', $ptsImport
  $c = $c -replace 'gno\.land/r/gnomemepad/bond', $bondImport
  $c = $c -replace '(?m)^package pad\b', 'package padv19'

  $c = Set-Const $c "GraduationThreshold" "10_000_000_000"
  $c = Set-Const $c "VirtualUgnot0" "3_500_000_000"
  $c = Set-Const $c "VirtualToken0" "1_073_000_191"
  $c = Set-Const $c "CreateBondUgnot" "2_000_000"
  $c = Set-Const $c "BondRefundMinRaised" "100_000_000"
  $c = Set-Const $c "AntiSnipeHeights" "30"
  $c = Set-Const $c "AntiSnipeMaxBuyBPS" "300"
  $c = Set-Const $c "MaxTradeHistory" "256"
  $c = Set-Const $c "GnoswapMaxFeeWugnot" "1_500_000_000"

  $c = $c -creplace "[\u2014\u2013]", "-"
  $c = $c -creplace "\u2192", "->"
  $c = $c -creplace "\u2190", "<-"
  $c = $c -creplace "\u00B7", " | "
  $c = $c -creplace "\u2265", ">="
  $c = $c -creplace "\u2264", "<="
  $c = $c -creplace "\u2248", "~"
  $c = $c -creplace "\u00D7", "x"

  [System.IO.File]::WriteAllText($_.FullName, $c, $utf8)
}

Get-ChildItem $rAmm -Filter "*.gno" | ForEach-Object {
  $c = [System.IO.File]::ReadAllText($_.FullName, $utf8)
  $c = $c -replace '(?m)^package ammmath\b', 'package ammmathv2'
  [System.IO.File]::WriteAllText($_.FullName, $c, $utf8)
}

[System.IO.File]::WriteAllText(
  (Join-Path $rPad "gnomod.toml"),
  "module = `"gno.land/r/$Address/gnomemepad/padv19`"`ngno = `"0.9`"`n",
  $utf8
)
[System.IO.File]::WriteAllText(
  (Join-Path $rAmm "gnomod.toml"),
  "module = `"$ammImport`"`ngno = `"0.9`"`n",
  $utf8
)

$params = Get-Content (Join-Path $rPad "params.gno") -Raw
if ($params -notmatch 'GraduationThreshold int64 = 10_000_000_000') {
  throw "prepare failed: GraduationThreshold"
}
$mem = Get-Content (Join-Path $rPad "memepad.gno") -Raw
if ($mem -notmatch 'takeWugnotIn' -or $mem -notmatch 'gno\.land/r/gnoland/wugnot') {
  throw "prepare failed: WUGNOT buy path missing"
}
if ($mem -notmatch 'NEVER auto-list inside Buy/Graduate') {
  throw "prepare failed: graduate must skip auto-list (padv19 fix)"
}
if ($mem -match 'if !testSkipBanker \|\| testForceGnoswapList') {
  throw "prepare failed: old auto-list condition still present"
}

Write-Host "Prepared Sapphire v19 (push-pay + no auto-list on graduate):"
Write-Host "  pad:  gno.land/r/$Address/gnomemepad/padv19"
Write-Host "  Buy:  Transfer to pad then Buy; overpay -> ClaimWugnot"
Write-Host "  Grad: internal CPMM only (list via RetryListGnoswap after)"
Write-Host "Dir: $OUT"
