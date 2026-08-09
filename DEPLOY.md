# Deploy gnomemepad to Gno.land testnet (**Sapphire**)

## Network note

| Name | What it is |
|---|---|
| **Sapphire** (`sapphire-1`) | Current **Gno.land** public testnet target for this project |
| **Topaz** (`topaz-1`) | Previous Gno testnet (still online; separate state) |
| Oasis Sapphire | **Unrelated** EVM network — not used here |

This guide deploys to **Gno Sapphire**.

| | |
|---|---|
| RPC | `https://rpc.sapphire.testnets.gno.land:443` |
| chain-id | `sapphire-1` |
| gnoweb | https://sapphire.testnets.gno.land |
| Faucet | https://faucet.gno.land (select **Sapphire** / current testnet) |

## Target packages (your address)

| Package | Path |
|---|---|
| Math (pure) | `gno.land/p/g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl/gnomemepad/ammmath` |
| Launchpad realm | `gno.land/r/g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl/gnomemepad/pad` |

- Wallet (deployer / protocol treasury after `Init`): **`g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl`**
- Local key name: **`mykey`** (`gnokey list`)

## Prerequisites

1. Funded account on **Sapphire** (not Topaz — balances do not carry over):

   ```powershell
   gnokey query bank/balances/g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl `
     -remote "https://rpc.sapphire.testnets.gno.land:443"
   ```

   Example healthy balance: tens–hundreds of GNOT (`1 GNOT = 1_000_000 ugnot`).

2. Prepared sources:

   ```powershell
   pwsh -File scripts/prepare-sapphire-deploy.ps1
   ```

   Output tree:

   ```text
   deploy/sapphire/p/g16p08x…/gnomemepad/ammmath/
   deploy/sapphire/r/g16p08x…/gnomemepad/pad/
   ```

3. Dependencies already on Sapphire genesis (no need to re-deploy):
   - `gno.land/p/nt/avl/v0`
   - `gno.land/p/nt/seqid/v0`

## One-shot deploy (recommended)

```powershell
cd C:\Users\Hi\gnomemepad
pwsh -File scripts/deploy-sapphire.ps1
```

`gnokey` will prompt for the **mykey** password three times (ammmath → pad → Init).  
Password stays on your machine — never paste it into chat or git.

## Manual steps (same as the script)

### 1) Pure package first

```powershell
cd C:\Users\Hi\gnomemepad

gnokey maketx addpkg mykey `
  -pkgpath "gno.land/p/g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl/gnomemepad/ammmath" `
  -pkgdir ".\deploy\sapphire\p\g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl\gnomemepad\ammmath" `
  -max-deposit "50000000ugnot" `
  -gas-fee "1000000ugnot" `
  -gas-wanted 50000000 `
  -broadcast `
  -chainid sapphire-1 `
  -remote "https://rpc.sapphire.testnets.gno.land:443"
```

### 2) Realm

```powershell
gnokey maketx addpkg mykey `
  -pkgpath "gno.land/r/g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl/gnomemepad/pad" `
  -pkgdir ".\deploy\sapphire\r\g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl\gnomemepad\pad" `
  -max-deposit "100000000ugnot" `
  -gas-fee "1000000ugnot" `
  -gas-wanted 100000000 `
  -broadcast `
  -chainid sapphire-1 `
  -remote "https://rpc.sapphire.testnets.gno.land:443"
```

### 3) Init protocol (caller = treasury / fee recipient)

```powershell
gnokey maketx call mykey `
  -pkgpath "gno.land/r/g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl/gnomemepad/pad" `
  -func Init `
  -gas-fee "1000000ugnot" `
  -gas-wanted 30000000 `
  -broadcast `
  -chainid sapphire-1 `
  -remote "https://rpc.sapphire.testnets.gno.land:443"
```

### 4) Verify

- Render:  
  https://sapphire.testnets.gno.land/r/g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl/gnomemepad/pad
- CLI:

  ```powershell
  gnokey query vm/qrender `
    -data "gno.land/r/g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl/gnomemepad/pad:" `
    -remote "https://rpc.sapphire.testnets.gno.land:443"
  ```

## Point the local web UI at Sapphire

```powershell
cd C:\Users\Hi\gnomemepad\web
$env:RPC_URL = "https://rpc.sapphire.testnets.gno.land:443"
$env:CHAIN_ID = "sapphire-1"
$env:PKG = "gno.land/r/g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl/gnomemepad/pad"
$env:GNOKEY_NAME = "mykey"
$env:SIGNER_ADDR = "g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl"
# Optional private shell only — never commit:
# $env:GNOKEY_PASS = "..."
node server.mjs
```

Open http://127.0.0.1:5173

## Flags note (`-max-deposit` vs old `-deposit`)

Current `gnokey` uses **`-max-deposit`**: a **cap** on storage deposit the chain may lock.  
It does **not** force-spend the full amount. If the cap is too low, the tx fails — raise it and retry.

## Security

- **Never** put the seed phrase or password in git, `.env` committed files, or chat.
- Deploy with `gnokey` on **your** machine only under **your** address.
- Agent MCP tools can only deploy under **agent** keys; personal-namespace deploys require **your** `gnokey`.

## Optional: Topaz (legacy)

If you still need Topaz, use `scripts/prepare-topaz-deploy.ps1` + `scripts/deploy-topaz.ps1`  
with RPC `https://rpc.topaz.testnets.gno.land:443` and `chainid topaz-1`.  
Prefer Sapphire for new work.
