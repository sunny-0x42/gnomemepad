# Hướng dẫn Connect X API (OAuth 2.0) — Ambassador Apply

Mục tiêu: khi user bấm **Connect X account** trên `/ambassadors`, họ đăng nhập X thật → app nhận `@username` + `user id` đã xác minh (không tự gõ handle giả).

**Flow khuyến nghị:** OAuth 2.0 Authorization Code + **PKCE**  
Docs X: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code

---

## 1. Tạo app trên X Developer Portal

1. Vào https://developer.x.com/en/portal/dashboard (đăng nhập bằng tài khoản X của Gnomi).
2. **Apply for a developer account** nếu chưa có (Free / Basic đều dùng được cho Sign-in; Free đủ cho verify user).
3. Tạo **Project** → tạo **App** (ví dụ: `gnomi-fun-ambassadors`).
4. Trong App → **User authentication settings** → **Set up**:
   - **App permissions:** Read (đủ để lấy profile).
   - **Type of App:** Web App.
   - **App info**
     - **Callback URI / Redirect URL** (thêm cả hai):
       - Production: `https://gnomi.fun/api/auth/x/callback`
       - Local (nếu dev): `http://localhost:8888/api/auth/x/callback` (hoặc port Netlify Dev của bạn)
     - **Website URL:** `https://gnomi.fun`
   - Bật **OAuth 2.0**.
5. Save → mở **Keys and tokens**:
   - Copy **Client ID**
   - Copy **Client Secret** (giữ bí mật — chỉ đưa vào Netlify env, không commit git)

**Scopes tối thiểu (Ambassador verify):**
```
users.read offline.access
```
(`tweet.read` không bắt buộc nếu chỉ cần xác nhận tài khoản.)

---

## 2. Biến môi trường (Netlify)

Site `gnomemepad-sapphire` → **Site configuration → Environment variables** (Production + Deploy previews nếu cần):

| Key | Value | Ghi chú |
|---|---|---|
| `X_CLIENT_ID` | Client ID từ portal | Public-ish; vẫn không hardcode trong repo nếu không cần |
| `X_CLIENT_SECRET` | Client Secret | **Secret** — chỉ server |
| `X_REDIRECT_URI` | `https://gnomi.fun/api/auth/x/callback` | Khớp **exact** với portal |
| `X_OAUTH_SCOPES` | `users.read offline.access` | Optional default |

Sau khi set env → **trigger redeploy** (env mới không vào function đang chạy).

Local (optional) trong `.env` / Netlify Dev — **không commit**:
```
X_CLIENT_ID=...
X_CLIENT_SECRET=...
X_REDIRECT_URI=http://localhost:8888/api/auth/x/callback
```

---

## 3. Flow kỹ thuật (sau khi có keys — code sẽ wire)

```
User bấm Connect X
    → GET /api/auth/x/start
       (tạo state + code_verifier, lưu cookie/session ngắn)
    → Redirect trình duyệt tới:
       https://x.com/i/oauth2/authorize?...&scope=users.read%20offline.access&code_challenge=...
User đồng ý trên X
    → X redirect về /api/auth/x/callback?code=...&state=...
    → Server đổi code lấy access_token (kèm code_verifier + client_secret)
    → GET https://api.x.com/2/users/me
    → Lấy { id, username, name }
    → Redirect về /ambassadors?tab=apply&x=USERNAME&xid=ID
UI Apply: khóa field X = @USERNAME (đã verified), không cho sửa tùy tiện
Submit apply: gửi kèm xUserId + xVerified=true
```

**Authorize URL mẫu:**
```
https://x.com/i/oauth2/authorize
  ?response_type=code
  &client_id=YOUR_CLIENT_ID
  &redirect_uri=https%3A%2F%2Fgnomi.fun%2Fapi%2Fauth%2Fx%2Fcallback
  &scope=users.read%20offline.access
  &state=RANDOM
  &code_challenge=S256_HASH
  &code_challenge_method=S256
```

**Token exchange:** `POST https://api.x.com/2/oauth2/token`  
**User lookup:** `GET https://api.x.com/2/users/me`

---

## 4. Checklist trước khi bảo “code giúp”

- [ ] Developer account + App đã tạo  
- [ ] OAuth 2.0 bật, Callback = `https://gnomi.fun/api/auth/x/callback`  
- [ ] Có **Client ID** + **Client Secret**  
- [ ] Đã gắn env trên Netlify (`X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`)  
- [ ] Redeploy xong  

**Không** paste Client Secret vào chat công khai — chỉ set trên Netlify (hoặc nói “đã set xong” rồi nhờ wire code).

---

## 5. Lưu ý

| Chủ đề | Chi tiết |
|---|---|
| Free tier | Đủ cho login + `users/me`; rate limit thấp — ổn cho apply form |
| Không cần đăng tweet | Chỉ `users.read` |
| Hiện tại trên site | Nút Connect X mới mở profile + tự confirm handle — **chưa** OAuth thật |
| Privacy | Chỉ lưu `xUserId` + `@username` đã verify; không lưu access token lâu dài trừ khi cần |

---

## 6. Sau khi bạn xong bước 1–2

Nhắn: **“đã set X_CLIENT_* trên Netlify — wire OAuth”**  
Agents sẽ thêm:

- `GET /api/auth/x/start`
- `GET /api/auth/x/callback`
- Sửa nút Apply → redirect OAuth thay vì mở `x.com/@handle`
