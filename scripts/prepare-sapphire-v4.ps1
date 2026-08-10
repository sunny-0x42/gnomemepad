# Prepare deploy/sapphire-v4: security fixes (slippage, anti-snipe, TransferFrom, TransferProtocol).
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\sapphire-v4"
$rPad = Join-Path $OUT "r\$Address\gnomemepad\padv4"

Remove-Item $OUT -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $rPad | Out-Null

Copy-Item "$ROOT\gno.land\r\gnomemepad\pad\*.gno" $rPad
Get-ChildItem $rPad -Filter "*_test.gno" -ErrorAction SilentlyContinue | Remove-Item -Force

Get-ChildItem $rPad -Filter "*.gno" | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  $c = $c -replace 'gno\.land/p/gnomemepad/ammmath', "gno.land/p/$Address/gnomemepad/ammmath"
  $c = $c -replace '(?m)^package pad\b', 'package padv4'
  [System.IO.File]::WriteAllText($_.FullName, $c)
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$pkgPath = "gno.land/r/$Address/gnomemepad/padv4"
[System.IO.File]::WriteAllText(
  (Join-Path $rPad "gnomod.toml"),
  "module = `"$pkgPath`"`ngno = `"0.9`"`n",
  $utf8
)

Write-Host "Prepared Sapphire V4 (security fixes):"
Write-Host "  $pkgPath"
Write-Host "  package padv4"
Write-Host "Dir: $OUT"
