# Prepare create-bond policy realm (separate from pad — upgrade-safe).
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\sapphire-bond"
$rBond = Join-Path $OUT "r\$Address\gnomemepad\bond"

Remove-Item $OUT -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $rBond | Out-Null

Copy-Item "$ROOT\gno.land\r\gnomemepad\bond\*.gno" $rBond
Get-ChildItem $rBond -Filter "*_test.gno" -ErrorAction SilentlyContinue | Remove-Item -Force

# package name stays "bond" under personal path
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText(
  (Join-Path $rBond "gnomod.toml"),
  "module = `"gno.land/r/$Address/gnomemepad/bond`"`ngno = `"0.9`"`n",
  $utf8
)

Write-Host "Prepared bond policy:"
Write-Host "  gno.land/r/$Address/gnomemepad/bond"
Write-Host "  Init → StartPromo(20000000, 864000) for ~20 GNOT / 10 days"
Write-Host "  EndPromo() → back to 2 GNOT"
Write-Host "Dir: $OUT"
