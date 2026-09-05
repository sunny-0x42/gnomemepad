# Prepare padv23: seamless graduate LP (curve-spot sized) + sorted CreatePool
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\sapphire-v23"
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

  # Production-style raise (10k GNOT); seamless LP sizing is in graduate()
  $c = Set-Const $c "GraduationThreshold" "10_000_000_000"
  $c = Set-Const $c "VirtualUgnot0" "3_500_000_000"
  $c = Set-Const $c "VirtualToken0" "1_073_000_191"
  $c = Set-Const $c "CreateBondUgnot" "2_000_000"
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
  $c = $c -creplace "\u226A", "<<"

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
  "module = `"$ammImport`"`ngno = `"0.9`"`n",
  $utf8
)

$list = Get-Content (Join-Path $rPad "gnoswap_list.gno") -Raw
if ($list -notmatch 'CreatePool\(cross\(cur\), t0, t1') {
  throw "prepare failed: CreatePool sorted fix missing"
}
if ($list -notmatch 'LeftoverTokens') {
  throw "prepare failed: LeftoverTokens mint path missing in list template"
}
$memepad = Get-Content (Join-Path $rPad "memepad.gno") -Raw
if ($memepad -notmatch 'LeftoverTokens') {
  throw "prepare failed: LeftoverTokens field missing"
}
if ($memepad -notmatch 'poolU \* l\.VirtualToken / l\.VirtualUgnot') {
  throw "prepare failed: seamless LP sizing missing in graduate()"
}

Write-Host "Prepared Sapphire v23 (seamless graduate LP):"
Write-Host "  pad: gno.land/r/$Address/gnomemepad/padv23"
Write-Host "  GraduationThreshold = 10_000 GNOT"
Write-Host "Dir: $OUT"
