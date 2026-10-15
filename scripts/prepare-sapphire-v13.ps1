# Prepare padv13:
# - GraduationThreshold = 10_000 GNOT
# - VirtualUgnot0 = 3_500 GNOT so R_max ~10_255 > threshold, price continuous at grad
# - caller-funded Gnoswap list + ListNeed
# - auto-list when pad has WUGNOT >= raised + GNS fee
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\sapphire-v13"
$rPad = Join-Path $OUT "r\$Address\gnomemepad\padv13"
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

# Patch constants (flexible whitespace; PowerShell -replace is regex).
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
  $c = $c -replace '(?m)^package pad\b', 'package padv13'

  $c = Set-Const $c "GraduationThreshold" "10_000_000_000"
  $c = Set-Const $c "VirtualUgnot0" "3_500_000_000"
  $c = Set-Const $c "VirtualToken0" "1_073_000_191"
  $c = Set-Const $c "CreateBondUgnot" "2_000_000"
  $c = Set-Const $c "BondRefundMinRaised" "100_000_000"
  $c = Set-Const $c "AntiSnipeHeights" "30"
  $c = Set-Const $c "AntiSnipeMaxBuyBPS" "300"
  $c = Set-Const $c "MaxTradeHistory" "256"
  $c = Set-Const $c "GnoswapMaxFeeWugnot" "5_000_000_000"

  # Keep on-chain Render/notes ASCII-only (avoid mojibake on Windows prepare).
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
  "module = `"gno.land/r/$Address/gnomemepad/padv13`"`ngno = `"0.9`"`n",
  $utf8
)
[System.IO.File]::WriteAllText(
  (Join-Path $rAmm "gnomod.toml"),
  "module = `"$ammImport`"`ngno = `"0.9`"`n",
  $utf8
)

# Verify critical constants landed
$params = Get-Content (Join-Path $rPad "params.gno") -Raw
if ($params -notmatch 'GraduationThreshold int64 = 10_000_000_000') {
  throw "prepare failed: GraduationThreshold not 10_000_000_000"
}
if ($params -notmatch 'VirtualUgnot0 int64 = 3_500_000_000') {
  throw "prepare failed: VirtualUgnot0 not 3_500_000_000"
}
if ($params -notmatch 'VirtualToken0 int64 = 1_073_000_191') {
  throw "prepare failed: VirtualToken0 not 1_073_000_191"
}

Write-Host "Prepared Sapphire V13 (raise 10000 GNOT + auto-list ready):"
Write-Host "  pad:  gno.land/r/$Address/gnomemepad/padv13"
Write-Host "  GraduationThreshold = 10000 GNOT"
Write-Host "  VirtualUgnot0       = 3500 GNOT (R_max ~10255 GNOT)"
Write-Host "  VirtualToken0       = 1073000191"
Write-Host "  At grad ~795M sold / ~205M LP tokens; P_curve ~ P_pool"
Write-Host ""
Write-Host "AUTO-LIST inventory (fund BEFORE markets hit 10k):"
Write-Host "  WUGNOT on pad >= 10000 GNOT per concurrent graduation"
Write-Host "  GNS on pad    >= 100 GNS (CreatePool fee) preferred"
Write-Host "  Else: caller wrap + Approve + RetryListGnoswap (LP reimbursed)"
Write-Host "Dir: $OUT"
