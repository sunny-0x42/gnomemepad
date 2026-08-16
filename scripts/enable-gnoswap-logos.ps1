#Requires -Version 5.1
<#
.SYNOPSIS
  One-shot: deploy Netlify + fork gno-token-resource + open logo PR for live tokens.

.DESCRIPTION
  Run from gnomemepad repo root after approving external actions:

    powershell -ExecutionPolicy Bypass -File scripts\enable-gnoswap-logos.ps1

  Needs: gh auth, netlify auth (npx), node 18+
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "== 1) Build + Netlify deploy ==" -ForegroundColor Cyan
npm run build --prefix web/ui
npx netlify deploy --prod --dir=web/ui/dist

Write-Host "== 2) Fork onbloc/gno-token-resource (if needed) ==" -ForegroundColor Cyan
$forkCheck = gh repo view sunny-0x42/gno-token-resource 2>$null
if (-not $?) {
  gh repo fork onbloc/gno-token-resource --clone=false --default-branch-only
  Start-Sleep -Seconds 5
}

$Work = Join-Path $env:TEMP "gno-token-resource-gnomemepad"
if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
gh repo clone sunny-0x42/gno-token-resource $Work
Set-Location $Work
gh repo sync sunny-0x42/gno-token-resource --source onbloc/gno-token-resource --force 2>$null
git fetch origin
git checkout main 2>$null; if (-not $?) { git checkout master }
git pull origin HEAD

$Branch = "gnomemepad-padv22-logos-$(Get-Date -Format 'yyyyMMddHHmm')"
git checkout -b $Branch

Write-Host "== 3) Copy SVG logos + merge sapphire-1.json ==" -ForegroundColor Cyan
$Src = Join-Path $Root "docs\token-resource"
$ImgDir = Join-Path $Work "grc20\images"
New-Item -ItemType Directory -Force -Path $ImgDir | Out-Null
Copy-Item (Join-Path $Src "images\r_g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr_gnomemepad_padv22_*.svg") $ImgDir -Force

node -e @"
const fs=require('fs');
const path=require('path');
const chainPath='grc20/sapphire-1.json';
const base=JSON.parse(fs.readFileSync(chainPath,'utf8'));
const add=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const paths=new Set(base.map(x=>x.token_path));
let n=0;
for (const e of add) {
  if (!paths.has(e.token_path)) { base.push(e); n++; paths.add(e.token_path); }
  else {
    const i=base.findIndex(x=>x.token_path===e.token_path);
    base[i]={...base[i],...e};
    n++;
  }
}
fs.writeFileSync(chainPath, JSON.stringify(base,null,2)+'\n');
console.log('updated entries', n, 'total', base.length);
"@ (Join-Path $Src "entries-only.json")

git add grc20/images grc20/sapphire-1.json
git status
git commit -m "feat(grc20): register gnomemepad padv22 tokens (JAE, GNOMIES, TARDI)

decimals=0, Adena paths packagePath.SYMBOL, SVG logos for Gnoswap/Adena.
Source: gnomemepad Sapphire launches."

git push -u origin $Branch

Write-Host "== 4) Open PR to onbloc/gno-token-resource ==" -ForegroundColor Cyan
gh pr create --repo onbloc/gno-token-resource `
  --head "sunny-0x42:$Branch" `
  --base main `
  --title "feat(grc20): register gnomemepad padv22 tokens (JAE, GNOMIES, TARDI)" `
  --body @"
## gnomemepad Sapphire tokens

Registers three GRC20 launches so **Gnoswap / Adena** can show logos.

| Symbol | token_path |
|--------|------------|
| JAE | ``gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/padv22.JAE`` |
| GNOMIES | ``…/padv22.GNOMIES`` |
| TARDI | ``…/padv22.TARDI`` |

### Spec
- ``decimals: 0`` (pad whole-token GRC20)
- ``token_path`` = Adena key (no ``.seq``)
- SVG under ``grc20/images/``

App: https://gnomemepad-sapphire.netlify.app  
Pipeline: gnomemepad ``/api/token-resource`` + GitHub Action for future tokens.
"@

Write-Host "== Done ==" -ForegroundColor Green
Write-Host "Optional: add repo secrets TOKEN_RESOURCE_GITHUB_TOKEN + TOKEN_RESOURCE_FORK for auto-sync of future tokens."
Set-Location $Root
