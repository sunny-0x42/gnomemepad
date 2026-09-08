import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { usePrefs } from "../context/PrefsContext";
import { EmptyState, PageHeader, Stat } from "../components/ui";
import { api } from "../lib/api";
import {
  AMBASSADOR_RUBRIC,
  AMBASSADOR_S1,
  AMBASSADOR_SPLIT,
  G1_RE,
  ambassadorRulesBlocks,
  isSubmitOpen,
} from "../lib/ambassador";

const emptyApply = {
  displayName: "",
  email: "",
  xHandle: "",
  xConnected: false,
  g1: "",
  g1Confirm: "",
  lang: "en",
  sample1: "",
  sample2: "",
  sample3: "",
  why: "",
  agreeOk: false,
};

const emptyContent = {
  displayName: "",
  g1: "",
  xHandle: "",
  title: "",
  url: "",
  lang: "en",
  notes: "",
};

const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

function normalizeXHandle(raw) {
  return String(raw || "")
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "")
    .split(/[/?#]/)[0]
    .trim();
}

export default function Ambassadors() {
  const { wallet, connect, showToast } = useApp();
  const { lang } = usePrefs();
  const vi = lang === "vi";
  const t = (en, vn) => (vi ? vn : en);

  const [tab, setTab] = useState("rules"); // rules | apply | submit
  const [apply, setApply] = useState(emptyApply);
  const [content, setContent] = useState(emptyContent);
  const [busy, setBusy] = useState(false);
  const [applyId, setApplyId] = useState("");
  const [contentId, setContentId] = useState("");

  const open = isSubmitOpen();
  const rules = useMemo(() => ambassadorRulesBlocks(vi), [vi]);

  function fillG1FromWallet(target) {
    if (!wallet?.address) return connect();
    if (target === "apply") {
      setApply((s) => ({ ...s, g1: wallet.address, g1Confirm: wallet.address }));
    } else {
      setContent((s) => ({ ...s, g1: wallet.address }));
    }
  }

  function connectXAccount() {
    const handle = normalizeXHandle(apply.xHandle);
    if (!X_HANDLE_RE.test(handle)) {
      return showToast(
        t("Enter a valid X username first", "Nhập username X hợp lệ trước"),
        false,
      );
    }
    window.open(`https://x.com/${handle}`, "_blank", "noopener,noreferrer");
    setApply((s) => ({ ...s, xHandle: handle, xConnected: true }));
    showToast(t(`X connected: @${handle}`, `Đã kết nối X: @${handle}`));
  }

  function disconnectX() {
    setApply((s) => ({ ...s, xConnected: false }));
  }

  async function onApply(e) {
    e.preventDefault();
    if (!open) return showToast(t("Submissions not open yet", "Chưa mở nộp"), false);
    if (!apply.agreeOk) {
      return showToast(t("Please confirm the agreement", "Cần xác nhận đồng ý"), false);
    }
    const xHandle = normalizeXHandle(apply.xHandle);
    if (!apply.xConnected || !X_HANDLE_RE.test(xHandle)) {
      return showToast(
        t("Connect your X account to continue", "Kết nối tài khoản X để tiếp tục"),
        false,
      );
    }
    if (!G1_RE.test(apply.g1.trim()) || apply.g1.trim() !== apply.g1Confirm.trim()) {
      return showToast(
        t("Invalid or mismatched Gno wallet address", "Địa chỉ ví Gno không hợp lệ / không khớp"),
        false,
      );
    }
    if (!apply.sample1.trim() || !apply.sample2.trim() || !apply.sample3.trim()) {
      return showToast(t("Three sample links required", "Cần 3 link mẫu"), false);
    }
    setBusy(true);
    try {
      const out = await api("/api/ambassadors/apply", {
        method: "POST",
        body: {
          displayName: apply.displayName.trim(),
          email: apply.email.trim(),
          xHandle,
          g1: apply.g1.trim(),
          lang: apply.lang,
          samples: [apply.sample1, apply.sample2, apply.sample3].map((u) => u.trim()),
          why: apply.why.trim(),
          ageOk: true,
          rulesOk: true,
          notInsider: true,
        },
      });
      setApplyId(out.id || "ok");
      showToast(t("Application submitted", "Đã gửi đơn"));
      setTab("submit");
    } catch (err) {
      showToast(err.message || String(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitContent(e) {
    e.preventDefault();
    if (!open) return showToast(t("Submissions not open yet", "Chưa mở nộp"), false);
    if (!G1_RE.test(content.g1.trim())) {
      return showToast(t("Invalid Gno wallet address", "Địa chỉ ví Gno không hợp lệ"), false);
    }
    const xHandle = normalizeXHandle(content.xHandle);
    if (!X_HANDLE_RE.test(xHandle)) {
      return showToast(t("X account required", "Cần tài khoản X"), false);
    }
    try {
      // eslint-disable-next-line no-new
      new URL(content.url.trim());
    } catch {
      return showToast(t("Invalid content URL", "URL nội dung không hợp lệ"), false);
    }
    setBusy(true);
    try {
      const out = await api("/api/ambassadors/submit", {
        method: "POST",
        body: {
          displayName: content.displayName.trim(),
          g1: content.g1.trim(),
          xHandle,
          title: content.title.trim(),
          url: content.url.trim(),
          lang: content.lang,
          notes: content.notes.trim(),
        },
      });
      setContentId(out.id || "ok");
      showToast(t("Content submitted", "Đã gửi bài"));
      setContent((s) => ({ ...s, title: "", url: "", notes: "" }));
    } catch (err) {
      showToast(err.message || String(err), false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="view season0-page">
      <PageHeader
        kicker="Ambassadors"
        title={vi ? AMBASSADOR_S1.nameVi : AMBASSADOR_S1.nameEn}
        lede={vi ? AMBASSADOR_S1.taglineVi : AMBASSADOR_S1.taglineEn}
        actions={
          <button type="button" className="btn primary" onClick={() => setTab("submit")}>
            {t("Submit content", "Nộp bài")}
          </button>
        }
      />

      <div className="season0-meta-bar" aria-live="polite">
        <span className="season0-chip">
          <strong>S1</strong> Signal Builders
        </span>
        <span className="season0-chip">
          {open
            ? t("Submit open from today", "Mở nộp từ hôm nay")
            : t("Submit opens soon", "Sắp mở nộp")}
        </span>
        <span className="season0-chip season0-chip-warn">
          {t("Prizes after mainnet", "Thưởng sau mainnet")}
        </span>
      </div>

      <aside className="docs-callout docs-callout-warn" style={{ marginBottom: "1rem" }}>
        <strong>{t("Before you apply", "Trước khi apply")}</strong>
        <p style={{ margin: "0.35rem 0 0" }}>
          {vi ? AMBASSADOR_S1.prizeTimingVi : AMBASSADOR_S1.prizeTimingEn}{" "}
          {vi ? AMBASSADOR_S1.metricVi : AMBASSADOR_S1.metricEn}{" "}
          {t(
            "Not APR · not an investment · pool may be zero. Season 0 Points ≠ cash.",
            "Không APR · không đầu tư · pool có thể = 0. Season 0 Points ≠ tiền.",
          )}
        </p>
      </aside>

      <nav className="season0-toc" aria-label={t("Sections", "Mục")}>
        <button type="button" className={`filter-btn${tab === "rules" ? " active" : ""}`} onClick={() => setTab("rules")}>
          {t("Rules", "Luật")}
        </button>
        <button type="button" className={`filter-btn${tab === "apply" ? " active" : ""}`} onClick={() => setTab("apply")}>
          {t("Apply", "Đăng ký")}
        </button>
        <button type="button" className={`filter-btn${tab === "submit" ? " active" : ""}`} onClick={() => setTab("submit")}>
          {t("Submit content", "Nộp bài")}
        </button>
      </nav>

      {tab === "rules" && (
        <section className="season0-section" id="amb-rules">
          <h2>{t("Season rules", "Luật Season")}</h2>
          <div className="season0-rules-grid">
            {Object.values(rules).map((block) => (
              <div key={block.title} className="panel season0-rule-card">
                <h3>{block.title}</h3>
                <ul className="season0-rule-list">
                  {block.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <h3 className="season0-subh">{t("Prize split (of the 10% pool)", "Chia giải (trong pool 10%)")}</h3>
          <div className="stat-row">
            {AMBASSADOR_SPLIT.map((r) => (
              <Stat key={r.rank} label={`#${r.rank}`} value={`${r.pct}%`} hint={t("of pool", "của pool")} />
            ))}
          </div>

          <h3 className="season0-subh">{t("Scoring weights", "Trọng số điểm")}</h3>
          <div className="docs-table-wrap">
            <table className="docs-table docs-table-compact">
              <thead>
                <tr>
                  <th>{t("Pillar", "Hạng mục")}</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {AMBASSADOR_RUBRIC.map((row) => (
                  <tr key={row.id}>
                    <td>{vi ? row.vi : row.en}</td>
                    <td className="mono">
                      <strong>{row.pct}%</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="muted season0-hint">
            {t("Full Guide:", "Guide đầy đủ:")}{" "}
            <Link to="/docs">{t("Open Guide", "Mở Hướng dẫn")}</Link>
            {" · "}
            <Link to="/rewards">{t("Season 0 Rewards", "Season 0 Rewards")}</Link>
          </p>
        </section>
      )}

      {tab === "apply" && (
        <section className="season0-section" id="amb-apply">
          <h2>{t("Apply as Ambassador", "Đăng ký Ambassador")}</h2>
          {!open ? (
            <EmptyState icon="⏳" title={t("Not open yet", "Chưa mở")} />
          ) : (
            <form className="panel rewards-panel" onSubmit={onApply}>
              {applyId ? (
                <p className="muted season0-hint">
                  {t("Submitted. Ref:", "Đã gửi. Mã:")}{" "}
                  <span className="mono">{applyId}</span>
                </p>
              ) : null}
              <label>
                {t("Display name", "Tên hiển thị")}
                <input
                  required
                  value={apply.displayName}
                  onChange={(e) => setApply((s) => ({ ...s, displayName: e.target.value }))}
                />
              </label>
              <label>
                Email
                <input
                  required
                  type="email"
                  value={apply.email}
                  onChange={(e) => setApply((s) => ({ ...s, email: e.target.value }))}
                />
              </label>

              <div className="panel" style={{ margin: "0.75rem 0", padding: "0.85rem" }}>
                <strong style={{ display: "block", marginBottom: "0.5rem" }}>
                  {t("X account", "Tài khoản X")}
                </strong>
                {apply.xConnected ? (
                  <div className="admin-actions" style={{ alignItems: "center", gap: "0.75rem" }}>
                    <span className="mono">@{normalizeXHandle(apply.xHandle)}</span>
                    <a
                      className="btn sm ghost"
                      href={`https://x.com/${normalizeXHandle(apply.xHandle)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("Open profile", "Mở profile")}
                    </a>
                    <button type="button" className="btn sm ghost" onClick={disconnectX}>
                      {t("Disconnect", "Ngắt kết nối")}
                    </button>
                  </div>
                ) : (
                  <>
                    <label style={{ marginBottom: "0.5rem" }}>
                      {t("X username", "Username X")}
                      <input
                        required
                        value={apply.xHandle}
                        onChange={(e) =>
                          setApply((s) => ({
                            ...s,
                            xHandle: e.target.value,
                            xConnected: false,
                          }))
                        }
                        placeholder="@username"
                      />
                    </label>
                    <button type="button" className="btn sm primary" onClick={connectXAccount}>
                      {t("Connect X account", "Kết nối tài khoản X")}
                    </button>
                  </>
                )}
              </div>

              <label>
                Gno wallet address
                <input
                  required
                  className="mono"
                  value={apply.g1}
                  onChange={(e) => setApply((s) => ({ ...s, g1: e.target.value }))}
                  placeholder="g1..."
                />
              </label>
              <label>
                Confirm Gno wallet address
                <input
                  required
                  className="mono"
                  value={apply.g1Confirm}
                  onChange={(e) => setApply((s) => ({ ...s, g1Confirm: e.target.value }))}
                  placeholder="g1..."
                />
              </label>
              <div className="admin-actions" style={{ marginBottom: "0.75rem" }}>
                <button type="button" className="btn sm ghost" onClick={() => fillG1FromWallet("apply")}>
                  {wallet?.address
                    ? t("Use connected wallet", "Dùng ví đang kết nối")
                    : t("Connect wallet", "Kết nối ví")}
                </button>
              </div>
              <label>
                {t("Content language", "Ngôn ngữ nội dung")}
                <select
                  value={apply.lang}
                  onChange={(e) => setApply((s) => ({ ...s, lang: e.target.value }))}
                >
                  <option value="en">EN</option>
                  <option value="vi">VI</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                {t("Sample link 1", "Link mẫu 1")}
                <input
                  required
                  type="url"
                  value={apply.sample1}
                  onChange={(e) => setApply((s) => ({ ...s, sample1: e.target.value }))}
                />
              </label>
              <label>
                {t("Sample link 2", "Link mẫu 2")}
                <input
                  required
                  type="url"
                  value={apply.sample2}
                  onChange={(e) => setApply((s) => ({ ...s, sample2: e.target.value }))}
                />
              </label>
              <label>
                {t("Sample link 3", "Link mẫu 3")}
                <input
                  required
                  type="url"
                  value={apply.sample3}
                  onChange={(e) => setApply((s) => ({ ...s, sample3: e.target.value }))}
                />
              </label>
              <label>
                {t("Why fair launch / Gnomi?", "Vì sao fair launch / Gnomi?")}
                <textarea
                  required
                  rows={4}
                  maxLength={500}
                  value={apply.why}
                  onChange={(e) => setApply((s) => ({ ...s, why: e.target.value }))}
                />
              </label>
              <label
                className="season0-hint"
                style={{ display: "flex", gap: "0.55rem", alignItems: "flex-start", marginTop: "0.75rem" }}
              >
                <input
                  type="checkbox"
                  checked={apply.agreeOk}
                  onChange={(e) => setApply((s) => ({ ...s, agreeOk: e.target.checked }))}
                />
                <span>
                  {t(
                    "I am 18+, agree to the Ambassador Rules (prizes after mainnet · discretionary · not APR/investment · Season 0 Points ≠ cash), and I am not a Gnomi team member applying for a prize.",
                    "Tôi đủ 18 tuổi, đồng ý Rules Ambassador (thưởng sau mainnet · discretionary · không APR/đầu tư · Season 0 Points ≠ tiền), và không phải thành viên team Gnomi nhận giải.",
                  )}
                </span>
              </label>
              <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: "1rem" }}>
                {busy ? t("Sending…", "Đang gửi…") : t("Submit application", "Gửi đơn")}
              </button>
            </form>
          )}
        </section>
      )}

      {tab === "submit" && (
        <section className="season0-section" id="amb-submit">
          <h2>{t("Submit content", "Nộp bài viết / nội dung")}</h2>
          <p className="muted season0-hint">
            {t(
              "Open from today. Post a Guide / thread / video that teaches the fair-launch loop. Include gnomi.fun when possible. Judging continues; prizes settle after mainnet Month-1.",
              "Mở từ hôm nay. Đăng Guide / thread / video dạy loop fair-launch. Nên có link gnomi.fun. Chấm điểm chạy trước; phân thưởng sau mainnet Month-1.",
            )}
          </p>
          {!open ? (
            <EmptyState icon="⏳" title={t("Not open yet", "Chưa mở")} />
          ) : (
            <form className="panel rewards-panel" onSubmit={onSubmitContent}>
              {contentId ? (
                <p className="muted season0-hint">
                  {t("Last submission ref:", "Mã bài vừa gửi:")}{" "}
                  <span className="mono">{contentId}</span>
                </p>
              ) : null}
              <label>
                {t("Display name", "Tên hiển thị")}
                <input
                  required
                  value={content.displayName}
                  onChange={(e) => setContent((s) => ({ ...s, displayName: e.target.value }))}
                />
              </label>
              <label>
                Gno wallet address
                <input
                  required
                  className="mono"
                  value={content.g1}
                  onChange={(e) => setContent((s) => ({ ...s, g1: e.target.value }))}
                  placeholder="g1..."
                />
              </label>
              <div className="admin-actions" style={{ marginBottom: "0.75rem" }}>
                <button type="button" className="btn sm ghost" onClick={() => fillG1FromWallet("content")}>
                  {wallet?.address
                    ? t("Use connected wallet", "Dùng ví đang kết nối")
                    : t("Connect wallet", "Kết nối ví")}
                </button>
              </div>
              <label>
                X account
                <input
                  required
                  value={content.xHandle}
                  onChange={(e) => setContent((s) => ({ ...s, xHandle: e.target.value }))}
                  placeholder="@username"
                />
              </label>
              <label>
                {t("Title", "Tiêu đề")}
                <input
                  required
                  value={content.title}
                  onChange={(e) => setContent((s) => ({ ...s, title: e.target.value }))}
                />
              </label>
              <label>
                {t("Content URL", "URL bài viết")}
                <input
                  required
                  type="url"
                  value={content.url}
                  onChange={(e) => setContent((s) => ({ ...s, url: e.target.value }))}
                  placeholder="https://"
                />
              </label>
              <label>
                {t("Language", "Ngôn ngữ")}
                <select
                  value={content.lang}
                  onChange={(e) => setContent((s) => ({ ...s, lang: e.target.value }))}
                >
                  <option value="en">EN</option>
                  <option value="vi">VI</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                {t("Notes for judges (optional)", "Ghi chú cho ban giám khảo (tuỳ chọn)")}
                <textarea
                  rows={3}
                  maxLength={400}
                  value={content.notes}
                  onChange={(e) => setContent((s) => ({ ...s, notes: e.target.value }))}
                />
              </label>
              <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: "1rem" }}>
                {busy ? t("Sending…", "Đang gửi…") : t("Submit content", "Gửi bài")}
              </button>
            </form>
          )}
        </section>
      )}
    </section>
  );
}
