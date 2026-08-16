# Hướng dẫn cài đặt GitHub — auto logo Gnoswap

Hướng dẫn này bật **đồng bộ logo tự động**: token tạo trên gnomemepad → GitHub Action mở PR → Onbloc merge → icon hiện trên Gnoswap/Adena.

**Không** làm public backend pad. Chỉ cần:

- Repo app: `sunny-0x42/gnomemepad` (workflow)
- Fork registry: `sunny-0x42/gno-token-resource`
- PAT (token cá nhân) với quyền push fork + mở PR

---

## Tổng quan 5 phút

| Bước | Việc làm | Kết quả |
|------|----------|---------|
| 1 | Tạo Personal Access Token (PAT) | Có chuỗi `ghp_…` |
| 2 | Đảm bảo đã fork `gno-token-resource` | Repo `sunny-0x42/gno-token-resource` |
| 3 | Thêm 2 Secrets trên `gnomemepad` | Action đọc được token + fork |
| 4 | (Khuyến nghị) Push workflow lên `master` nếu chưa có | File `.github/workflows/sync-token-resource.yml` trên GitHub |
| 5 | Chạy workflow thủ công lần đầu | Dry-run / PR thật |
| 6 | (Tuỳ chọn) Biến `API_BASE` | Trỏ production Netlify |

Sau đó: mỗi **6 giờ** Action tự chạy; token mới có icon trên pad sẽ được xếp vào PR (khi còn missing).

---

## Bước 1 — Tạo Personal Access Token (PAT)

### 1.1 Mở trang token

Trình duyệt (đăng nhập GitHub **sunny-0x42**):

**Classic PAT (đơn giản, khuyến nghị cho fork + PR):**  
https://github.com/settings/tokens/new

Hoặc menu:  
**GitHub avatar → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)**

### 1.2 Điền form

| Field | Giá trị gợi ý |
|--------|----------------|
| **Note** | `gnomemepad token-resource sync` |
| **Expiration** | `90 days` hoặc `No expiration` (nếu máy riêng, nhớ rotate) |
| **Scopes** | Bật **`repo`** (Full control of private repositories) |

`repo` cần để:

- Push branch lên fork `sunny-0x42/gno-token-resource`
- Tạo PR sang `onbloc/gno-token-resource`

Nếu fork của bạn **public**, một số case chỉ cần `public_repo`; dùng full `repo` cho chắc.

### 1.3 Generate & copy

1. **Generate token**
2. **Copy ngay** chuỗi `ghp_…` (GitHub **không** hiện lại)
3. Cất tạm (password manager) — sẽ dán vào Secret ở Bước 3

> **Fine-grained PAT (tuỳ chọn):**  
> Resource owner = `sunny-0x42`  
> Repository access = chỉ `gno-token-resource`  
> Permissions: **Contents** Read and write, **Pull requests** Read and write  
> **Và** quyền tạo PR trên `onbloc/gno-token-resource` (thường classic `repo` dễ hơn).

---

## Bước 2 — Fork `gno-token-resource` (một lần)

Nếu đã có (PR #54): https://github.com/sunny-0x42/gno-token-resource → **bỏ qua**.

### Cách A — Web

1. Mở https://github.com/onbloc/gno-token-resource  
2. **Fork** (góc trên phải)  
3. Owner: **sunny-0x42** → Create fork  
4. Kiểm tra: https://github.com/sunny-0x42/gno-token-resource

### Cách B — CLI

```bash
gh auth login
gh repo fork onbloc/gno-token-resource --clone=false --default-branch-only
```

Tên fork chuẩn dùng cho Secret:

```text
sunny-0x42/gno-token-resource
```

---

## Bước 3 — Thêm Secrets trên repo `gnomemepad`

### 3.1 Mở Secrets

https://github.com/sunny-0x42/gnomemepad/settings/secrets/actions

Hoặc: repo **gnomemepad** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

### 3.2 Secret 1 — `TOKEN_RESOURCE_GITHUB_TOKEN`

| Field | Value |
|--------|--------|
| **Name** | `TOKEN_RESOURCE_GITHUB_TOKEN` |
| **Secret** | dán PAT `ghp_…` từ Bước 1 |

**Add secret**

### 3.3 Secret 2 — `TOKEN_RESOURCE_FORK`

| Field | Value |
|--------|--------|
| **Name** | `TOKEN_RESOURCE_FORK` |
| **Secret** | `sunny-0x42/gno-token-resource` |

**Add secret**

### 3.4 Kiểm tra

Trang Secrets phải có đúng 2 dòng:

```text
TOKEN_RESOURCE_GITHUB_TOKEN
TOKEN_RESOURCE_FORK
```

Không cần (và **không nên**) đưa PAT vào monorepo public / commit code.

---

## Bước 4 — Workflow file có trên GitHub chưa?

Action chỉ chạy nếu file sau có trên branch mặc định (`master` / `main`):

```text
.github/workflows/sync-token-resource.yml
```

### Kiểm tra

https://github.com/sunny-0x42/gnomemepad/blob/master/.github/workflows/sync-token-resource.yml

- **404 / không thấy** → commit + push file từ máy local (file đã có trong workspace):

```powershell
cd C:\Users\Hi\gnomemepad
git add .github/workflows/sync-token-resource.yml scripts/sync-token-resource.mjs docs/token-resource
git commit -m "ci: Gnoswap token-resource logo sync workflow"
git push origin master
```

- **Thấy file** → sang Bước 5

> `web/lib/` vẫn **gitignore** (backend private). Workflow **không** cần source backend: nó gọi API production  
> `https://gnomemepad-sapphire.netlify.app/api/token-resource`.

---

## Bước 5 — Chạy workflow lần đầu

### 5.1 Mở Actions

https://github.com/sunny-0x42/gnomemepad/actions

Sidebar: **Sync token-resource (Gnoswap logos)**

Nếu không thấy workflow:

- File yml chưa push, hoặc  
- Tab Actions chưa enable (bấm **I understand my workflows, go ahead and enable them**)

### 5.2 Dry-run (an toàn — không mở PR)

1. **Run workflow**
2. Branch: `master` (hoặc default)
3. **Dry run** = `true`
4. **Run workflow**
5. Mở run mới nhất → xem log:
   - `total` / `missing` / `registered`
   - Không được báo `Missing TOKEN_RESOURCE_… secrets`

### 5.3 Chạy thật (mở PR nếu còn token missing)

1. **Run workflow** lại  
2. **Dry run** = `false`  
3. Log thành công thường có:
   - `prUrl`: `https://github.com/onbloc/gno-token-resource/pull/…`
   - hoặc `skipped`: all registered

### 5.4 Lịch tự động

Trong workflow:

```yaml
schedule:
  - cron: "20 */6 * * *"   # phút 20, mỗi 6 giờ (UTC)
```

Không cần bật thêm; miễn secrets còn hiệu lực và PAT chưa hết hạn.

---

## Bước 6 — (Tuỳ chọn) Variable `API_BASE`

Mặc định script dùng:

```text
https://gnomemepad-sapphire.netlify.app
```

Đổi domain (nếu có custom domain):

1. https://github.com/sunny-0x42/gnomemepad/settings/variables/actions  
2. **New repository variable**  
3. Name: `API_BASE`  
4. Value: `https://your-domain.com` (không slash cuối)

---

## Bước 7 — (Tuỳ chọn) Netlify env

Chỉ cần nếu muốn **API** tự mở PR khi `POST /api/token-resource/register` (không chỉ qua GitHub Action).

Netlify → site **gnomemepad-sapphire** → **Site configuration** → **Environment variables**:

| Key | Value |
|-----|--------|
| `TOKEN_RESOURCE_GITHUB_TOKEN` | cùng PAT |
| `TOKEN_RESOURCE_FORK` | `sunny-0x42/gno-token-resource` |
| `TOKEN_RESOURCE_SYNC_SECRET` | chuỗi ngẫu nhiên dài (bảo vệ endpoint sync) |

Redeploy site sau khi thêm env.

**Khuyến nghị production:** chỉ dùng **GitHub Action** (secrets trên repo); Netlify không bắt buộc có PAT.

---

## Kiểm tra sau khi cài

### A. Plan API

```text
https://gnomemepad-sapphire.netlify.app/api/token-resource
```

| Field | Ý nghĩa |
|--------|---------|
| `status: "missing"` | Chưa có trên upstream (cần PR) |
| `status: "registered"` | Đã có trong `sapphire-1.json` upstream |
| `imageUrl` | Icon memepad dùng gen SVG |

### B. Logo preview (gnomemepad CDN, không phải Gnoswap)

```text
https://gnomemepad-sapphire.netlify.app/api/token-resource/logo?pkg=...&id=0000001
```

### C. Gnoswap sau merge PR

1. Onbloc **merge** PR  
2. Đợi indexer (có thể vài giờ–vài ngày)  
3. Swap / token page trên https://beta.gnoswap.io → logo không còn trống

### D. CLI local (máy đã `gh auth` + env)

```powershell
cd C:\Users\Hi\gnomemepad
$env:TOKEN_RESOURCE_GITHUB_TOKEN = "ghp_..."
$env:TOKEN_RESOURCE_FORK = "sunny-0x42/gno-token-resource"
npm run token-resource:plan   # dry
npm run token-resource:sync   # mở PR nếu missing
```

---

## Luồng sau khi setup xong

```
User Create token (+ icon URL)
        │
        ▼
gnomemepad hiện icon ngay (meta/uri)
        │
        ▼
UI POST /api/token-resource/register  (queue / plan)
        │
        ▼
GitHub Action mỗi 6h (hoặc Run manual)
  - đọc plan từ API production
  - gen SVG
  - push branch lên FORK
  - mở PR → onbloc/gno-token-resource
        │
        ▼
Onbloc review + merge
        │
        ▼
Gnoswap/Adena logoURI có dữ liệu
```

---

## Bảo mật — checklist

| Nên | Không nên |
|-----|-----------|
| PAT chỉ trong **Actions secrets** | Commit `ghp_…` vào git |
| Scope tối thiểu (`repo` hoặc fine-grained) | Paste PAT vào issue/chat public |
| Rotate PAT khi hết hạn / nghi lộ | Đưa backend `web/lib` lên monorepo public |
| Fork chỉ chứa token-resource | Đưa private key / Netlify token vào Secret không cần thiết |

**Backend pad** (`web/lib`, Netlify functions source) vẫn private — workflow **không** publish source backend.

---

## Troubleshooting

| Lỗi / hiện tượng | Cách xử lý |
|------------------|------------|
| `Missing TOKEN_RESOURCE_GITHUB_TOKEN or TOKEN_RESOURCE_FORK` | Thêm đúng tên Secret (Bước 3), re-run |
| `Bad credentials` / `401` | PAT hết hạn / sai; tạo PAT mới, update secret |
| `403` push fork | PAT thiếu `repo`; account phải là owner fork |
| `Resource not accessible by integration` | Dùng PAT (secret), **không** dựa `GITHUB_TOKEN` mặc định của Actions (không đủ quyền PR cross-repo) |
| Workflow không hiện | Push file yml lên default branch; enable Actions |
| `missing` mãi sau PR | PR chưa merge, hoặc indexer Gnoswap chưa refresh |
| Plan rỗng / lỗi API | Netlify deploy API token-resource; mở `/api/token-resource` thử |
| Dry-run OK, run thật fail ở `open PR` | Fork outdated: sync fork với `onbloc` main rồi chạy lại |

Sync fork (web):  
`sunny-0x42/gno-token-resource` → **Sync fork**  
CLI:  
`gh repo sync sunny-0x42/gno-token-resource --source onbloc/gno-token-resource`

---

## Liên kết nhanh

| Mục | URL |
|-----|-----|
| Tạo PAT classic | https://github.com/settings/tokens/new |
| Secrets Actions | https://github.com/sunny-0x42/gnomemepad/settings/secrets/actions |
| Variables Actions | https://github.com/sunny-0x42/gnomemepad/settings/variables/actions |
| Actions runs | https://github.com/sunny-0x42/gnomemepad/actions |
| Fork registry | https://github.com/sunny-0x42/gno-token-resource |
| Upstream | https://github.com/onbloc/gno-token-resource |
| Plan API | https://gnomemepad-sapphire.netlify.app/api/token-resource |
| PR logo hiện tại | https://github.com/onbloc/gno-token-resource/pull/54 |

---

## Checklist tick nhanh

- [ ] PAT `ghp_…` tạo với scope `repo`
- [ ] Fork `sunny-0x42/gno-token-resource` tồn tại
- [ ] Secret `TOKEN_RESOURCE_GITHUB_TOKEN` = PAT
- [ ] Secret `TOKEN_RESOURCE_FORK` = `sunny-0x42/gno-token-resource`
- [ ] File `.github/workflows/sync-token-resource.yml` trên GitHub
- [ ] Dry-run workflow thành công
- [ ] Run thật (hoặc đợi cron 6h) khi có token `missing`
- [ ] Theo dõi PR trên `onbloc/gno-token-resource` đến khi merge
