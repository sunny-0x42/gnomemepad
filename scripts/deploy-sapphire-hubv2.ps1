# Deploy hubv2 (multi-admin) and copy modules from existing hub ListModules.
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$MaxDeposit = "25000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [string]$OldHub = "gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/hub"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Users\Hi\tools;$env:PATH"
Set-Location $ROOT

$hubPath = "gno.land/r/$Address/gnomemepad/hubv2"
$OUT = Join-Path $ROOT "deploy\sapphire-hubv2\r\$Address\gnomemepad\hubv2"
Remove-Item (Split-Path $OUT -Parent) -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $OUT | Out-Null
Copy-Item "$ROOT\gno.land\r\gnomemepad\hubv2\*.gno" $OUT
Get-ChildItem $OUT -Filter "*_test.gno" | Remove-Item -Force
Get-ChildItem $OUT -Filter "*.gno" | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  $c = $c -replace '(?m)^package hubv2\b', 'package hubv2'
  [System.IO.File]::WriteAllText($_.FullName, $c)
}
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $OUT "gnomod.toml"), "module = `"$hubPath`"`ngno = `"0.9`"`n", $utf8)

Write-Host "=== Deploy hubv2 $hubPath ==="

function Assert-Ok([string]$S) { if ($LASTEXITCODE -ne 0) { throw "Failed: $S" } }
function Run-G([string[]]$Cmd, [string]$Label) {
  Write-Host "=== $Label ==="
  if ($env:GNOKEY_PASS) { $env:GNOKEY_PASS | & gnokey @Cmd -insecure-password-stdin }
  else { Write-Host "Enter password..."; & gnokey @Cmd }
  Assert-Ok $Label
}

$ex = gnokey query vm/qpaths --data $hubPath -remote $Remote 2>&1 | Out-String
if ($ex -notmatch [regex]::Escape($hubPath)) {
  Run-G @(
    "maketx","addpkg",$KeyName,"-pkgpath",$hubPath,"-pkgdir",$OUT,
    "-max-deposit",$MaxDeposit,"-gas-fee",$GasFee,"-gas-wanted","80000000",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  ) "addpkg hubv2"
} else { Write-Host "hubv2 already on chain" }

try {
  Run-G @(
    "maketx","call",$KeyName,"-pkgpath",$hubPath,"-func","Init",
    "-gas-fee",$GasFee,"-gas-wanted","30000000",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  ) "Init hubv2"
} catch { Write-Host "Init: $($_.Exception.Message)" }

# Copy modules from old hub
$list = gnokey query vm/qeval --data "${OldHub}.ListModules()" -remote $Remote 2>&1 | Out-String
# Parse lines like name|path from data field — raw may wrap
$raw = (gnokey query vm/qeval --data "${OldHub}.ListModules()" -remote $Remote 2>&1 | Out-String)
# Extract between quotes if present
if ($raw -match '\("([\s\S]*?)"\s+string\)') {
  $body = $Matches[1] -replace '\\n', "`n"
} else {
  $body = $raw
}
$lines = $body -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '\|' }
foreach ($line in $lines) {
  $i = $line.IndexOf("|")
  if ($i -le 0) { continue }
  $name = $line.Substring(0, $i).Trim()
  $path = $line.Substring($i + 1).Trim() -replace '\\"', '"'
  if ($name -notmatch '^[a-zA-Z0-9_-]+$') { continue }
  if (-not $path.StartsWith("gno.land/")) { continue }
  Write-Host "Copy module $name -> $path"
  $cmd = [System.Collections.Generic.List[string]]::new()
  $cmd.AddRange([string[]]@(
    "maketx","call",$KeyName,"-pkgpath",$hubPath,"-func","SetModule",
    "-gas-fee",$GasFee,"-gas-wanted","30000000",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote,
    "-args",$name,"-args",$path
  ))
  Run-G $cmd.ToArray() "SetModule $name"
}

Write-Host ""
Write-Host "OK hubv2 ListModules:"
gnokey query vm/qeval --data "${hubPath}.ListModules()" -remote $Remote
Write-Host "Set Netlify HUB=$hubPath"
