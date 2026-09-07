# Season 0: Curve Camp

Discretionary points / quests on gnomi.fun. **Not cash. Not APR. Not an investment product.**

## Architecture

- **On-chain:** existing `pointsv2` (CheckIn, SetReferrer, OnTrade, OnCreate, Leaderboard).
- **Overlay:** `GET /api/season0` + UI `/rewards` (`web/ui/src/lib/season0.js`).
- **No new pad / pointsv3** for Season 0.

## Enable on Sapphire (needs human yes)

1. `pointsv2.AllowPad("<padv22 path>")`
2. Pad `SetPointsEnabled(true)`
3. Set `startHeight` / `endHeight` in `season0.js` + API season object when announcing
4. Do **not** treat testnet Points as mainnet entitlement

## Scoring (summary)

| Source | Counts for Season? |
|---|---|
| Curve Buy/Sell, Create, CheckIn, Referral | Yes (pointsv2) |
| Gnoswap ExactIn post-list | **No** |
| Unique markets / streak quest bonuses | Best-effort via API (`partial: true` until full indexer) |

## Files

- `web/ui/src/lib/season0.js` — catalog + rules copy
- `web/ui/src/pages/Rewards.jsx` — Season 0 hub
- `web/lib/chain-api.mjs` — `/api/season0`
- Guide: `/docs#season0`
