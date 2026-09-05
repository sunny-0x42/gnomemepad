# Prepare padv23 for Pearl testnet: mutable graduation + 10_000 GNOT default raise
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\pearl-v23"
$rPad = Join-Path $OUT "r\$Address\gnomemepad\padv23"
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
  $c = $c -replace '(?m)^package pad\b', 'package padv23'

  # Pearl defaults: 10_000 GNOT raise (live-adjustable after Init)
  $c = Set-Const $c "GraduationThreshold" "10_000_000_000"
  $c = Set-Const $c "VirtualUgnot0" "3_500_000_000"
  $c = Set-Const $c "VirtualToken0" "1_073_000_191"
  $c = Set-Const $c "CreateBondUgnot" "100_000_000"
  $c = Set-Const $c "BondRefundMinRaised" "50_000_000"
  $c = Set-Const $c "AntiSnipeHeights" "30"
  $c = Set-Const $c "AntiSnipeMaxBuyBPS" "300"
  $c = Set-Const $c "MaxTradeHistory" "256"
  $c = Set-Const $c "GnoswapMaxFeeWugnot" "1_500_000_000"
  $c = Set-Const $c "ListFeeGns" "100_000_000"

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
  "module = `"gno.land/r/$Address/gnomemepad/padv23`"`ngno = `"0.9`"`n",
  $utf8
)
[System.IO.File]::WriteAllText(
  (Join-Path $rAmm "gnomod.toml"),
  "module = `"gno.land/p/$Address/gnomemepad/ammmathv2`"`ngno = `"0.9`"`n",
  $utf8
)

Write-Host "Prepared $OUT"
Write-Host "  pad:  gno.land/r/$Address/gnomemepad/padv23"
Write-Host "  amm:  gno.land/p/$Address/gnomemepad/ammmathv2"
Write-Host "  default raise: 10_000 GNOT (SetGraduationThreshold after Init)"
Write-Host "  bond default:  set via bond Init + SetNormalBond 100 GNOT"
