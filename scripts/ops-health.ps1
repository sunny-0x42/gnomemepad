# Ops health check for all gnomemepad modules (Phase 3F).
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$Hub = ""
)

$ErrorActionPreference = "Continue"
$env:PATH = "C:\Users\Hi\tools;$env:PATH"
if (-not $Hub) { $Hub = "gno.land/r/$Address/gnomemepad/hub" }

Write-Host "=== gnomemepad ops-health ==="
Write-Host "Hub: $Hub"
Write-Host "RPC: $Remote"
Write-Host ""

function QEval([string]$Expr) {
  $o = gnokey query vm/qeval --data $Expr -remote $Remote 2>&1 | Out-String
  return $o
}

$st = gnokey query "" -remote $Remote 2>&1 | Out-String
# status via abci
Write-Host "--- hub ListModules ---"
QEval "${Hub}.ListModules()"

$mods = @{}
$raw = QEval "${Hub}.ListModules()"
if ($raw -match '\("([\s\S]*?)"\s+string\)') {
  $body = $Matches[1] -replace '\\n', "`n"
  foreach ($line in ($body -split "`n")) {
    $t = $line.Trim()
    $i = $t.IndexOf("|")
    if ($i -gt 0) { $mods[$t.Substring(0, $i)] = $t.Substring($i + 1) }
  }
}

foreach ($kv in $mods.GetEnumerator() | Sort-Object Name) {
  $name = $kv.Key
  $pkg = $kv.Value
  Write-Host ""
  Write-Host "--- $name ($pkg) ---"
  $paths = gnokey query vm/qpaths --data $pkg -remote $Remote 2>&1 | Out-String
  if ($paths -notmatch [regex]::Escape($pkg)) {
    Write-Host "  MISSING on chain"
    continue
  }
  Write-Host "  path: OK"
  switch -Regex ($name) {
    '^pad' {
      Write-Host (QEval "${pkg}.LaunchCount()")
      Write-Host (QEval "${pkg}.ParamsInfo()")
    }
    'legacy' {
      Write-Host (QEval "${pkg}.LaunchCount()")
    }
    'profile' { Write-Host (QEval "${pkg}.ProfileCount()") }
    'meta' { Write-Host (QEval "${pkg}.MetaCount()") }
    'points' {
      Write-Host (QEval "${pkg}.UserCount()")
      Write-Host (QEval "${pkg}.ParamsInfo()")
    }
  }
}

Write-Host ""
Write-Host "Done. Also: Invoke-RestMethod https://gnomemepad-sapphire.netlify.app/api/ops"
