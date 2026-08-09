# Rebuild deploy/topaz tree for the user's personal-address namespace.
param(
  [string]$Address = "g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\topaz"
$pMath = Join-Path $OUT "p\$Address\gnomemepad\ammmath"
$rPad = Join-Path $OUT "r\$Address\gnomemepad\pad"

Remove-Item $OUT -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $pMath, $rPad | Out-Null

Copy-Item "$ROOT\gno.land\p\gnomemepad\ammmath\*.gno" $pMath
Get-ChildItem $pMath -Filter "*_test.gno" | Remove-Item -Force

Copy-Item "$ROOT\gno.land\r\gnomemepad\pad\*.gno" $rPad
Get-ChildItem $rPad -Filter "*_test.gno" | Remove-Item -Force

Get-ChildItem $rPad -Filter "*.gno" | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  $c = $c -replace 'gno\.land/p/gnomemepad/ammmath', "gno.land/p/$Address/gnomemepad/ammmath"
  [System.IO.File]::WriteAllText($_.FullName, $c)
}

@"
module = "gno.land/p/$Address/gnomemepad/ammmath"
gno = "0.9"
"@ | Set-Content (Join-Path $pMath "gnomod.toml") -Encoding utf8

@"
module = "gno.land/r/$Address/gnomemepad/pad"
gno = "0.9"
"@ | Set-Content (Join-Path $rPad "gnomod.toml") -Encoding utf8

Write-Host "Prepared:"
Write-Host "  gno.land/p/$Address/gnomemepad/ammmath"
Write-Host "  gno.land/r/$Address/gnomemepad/pad"
Write-Host "Dir: $OUT"
