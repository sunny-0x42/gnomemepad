# Sapphire V2 (GRC20)

## Path
`gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/padv2`

## Deploy (you sign)
```powershell
cd C:\Users\Hi\gnomemepad
powershell -ExecutionPolicy Bypass -File scripts\deploy-sapphire-v2.ps1
```

Requires: deploykey password, ~40+ GNOT free, ammmath already on chain.

## After deploy
- Netlify PKG already set to padv2 in netlify.toml
- Redeploy site: `npx netlify-cli deploy --prod`
- Init sets protocol treasury = deploykey address
