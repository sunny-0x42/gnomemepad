# Phase 3C / 3D / 3F deploy notes

## 3C — Activity & history (UI only, no new realm)

- `/api/activity` — recent trades across active + legacy pads  
- Home **Recent activity** strip  
- Token page: more trade rows + **Export CSV**

## 3D — padv5 (stricter economics)

| Param | padv4 | padv5 |
|-------|-------|-------|
| Create bond | 1 GNOT | **2 GNOT** |
| Graduation | 50 GNOT | **100 GNOT** |
| Bond refund min raised | 5 GNOT | **10 GNOT** |
| Anti-snipe | 5% / 20h | **3% / 30h** |
| Trade history | 128 | **256** |

```powershell
cd C:\Users\Hi\gnomemepad
.\scripts\deploy-sapphire-v5.ps1
```

Registers `pad=padv5` and `legacy_padv4` on current hub.  
UI will show both via multi-pad once hub is updated.

## 3F — hubv2 multi-admin + ops

**hubv2** adds `AddAdmin` / `RemoveAdmin` / `ListAdmins` / `IsAdmin`.

```powershell
.\scripts\deploy-sapphire-hubv2.ps1
```

Then set Netlify env `HUB` to:

```text
gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/hubv2
```

Ops:

```powershell
.\scripts\ops-health.ps1
# or
Invoke-RestMethod https://gnomemepad-sapphire.netlify.app/api/ops
```

`/api/ops` probes hub, pads, profile, meta, points counts.

## Suggested order

1. Deploy **padv5** (markets keep working; switch active pad)  
2. Deploy **hubv2** (copy modules) + point Netlify `HUB`  
3. Refresh UI — activity already live after this Netlify deploy  
