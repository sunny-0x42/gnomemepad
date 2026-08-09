# Start gnomemepad under gnodev for local review.
# Prefer C:\dev\gnomemepad if present (avoids Windows profile junction walk bugs under %USERPROFILE%).
#
# Usage:
#   pwsh -File scripts/local-review.ps1
#
# Then open: http://127.0.0.1:8888/r/gnomemepad/pad
# RPC:       tcp://127.0.0.1:26657

$ErrorActionPreference = "Stop"
$env:PATH = "$env:USERPROFILE\go\bin;C:\Users\Hi\tools;$env:PATH"

if (-not (Get-Command gnodev -ErrorAction SilentlyContinue)) {
    Write-Host "Installing gnodev..."
    Push-Location C:\Users\Hi\tools\gno\contribs\gnodev
    go install .
    Pop-Location
}

$root = if (Test-Path "C:\dev\gnomemepad\gnowork.toml") {
    "C:\dev\gnomemepad"
} else {
    # Fall back to repo path; may fail on Windows if workspace is under a profile with junctions
    Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    if (Test-Path (Join-Path (Split-Path $PSScriptRoot -Parent) "gnowork.toml")) {
        Split-Path $PSScriptRoot -Parent
    } else {
        "C:\Users\Hi\gnomemepad"
    }
}

Write-Host "Root: $root"
Set-Location $root

gnodev local `
    -no-examples `
    -no-watch `
    -web-listener 127.0.0.1:8888 `
    -node-rpc-listener 127.0.0.1:26657 `
    -web-home /r/gnomemepad/pad `
    -v `
    ./gno.land/p/gnomemepad/ammmath `
    ./gno.land/r/gnomemepad/pad `
    ./gno.land/p/nt/avl/v0 `
    ./gno.land/p/nt/seqid/v0 `
    ./gno.land/p/nt/ufmt/v0 `
    ./gno.land/p/nt/cford32/v0
