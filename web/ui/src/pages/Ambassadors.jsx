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
  discord: "",
  xHandle: "",
  g1: "",
  g1Confirm: "",
  lang: "en",
  sample1: "",
  sample2: "",
  sample3: "",
  why: "",
  ageOk: false,
  rulesOk: false,
  notInsider: false,
};

const emptyContent = {
  displayName: "",
  g1: "",
  discord: "",
  xHandle: "",
  title: "",
  url: "",
  lang: "en",
  notes: "",
};

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

  async function onApply(e) {
    e.preventDefault();
    if (!open) return showToast(t("Submissions not open yet", "Chưa mở nộp"), false);
    if (!apply.ageOk || !apply.rulesOk || !apply.notInsider) {
      return showToast(t("Accept all required checkboxes", "Cần tick đủ checkbox"), false);
    }
    if (!G1_RE.test(apply.g1.trim()) || apply.g1.trim() !== apply.g1Confirm.trim()) {
      return showToast(t("Invalid or mismatched g1", "g1 không hợp lệ / không khớp"), false);
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
          discord: apply.discord.trim(),
          xHandle: apply.xHandle.trim().replace(/^@/, ""),
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
      return showToast(t("Invalid g1", "g1 không hợp lệ"), false);
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
          discord: content.discord.trim(),
          xHandle: content.xHandle.trim().replace(/^@/, ""),
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
              <label>
                Discord
                <input
                  required
                  value={apply.discord}
                  onChange={(e) => setApply((s) => ({ ...s, discord: e.target.value }))}
                  placeholder="username"
                />
              </label>
              <label>
                X handle
                <input
                  required
                  value={apply.xHandle}
                  onChange={(e) => setApply((s) => ({ ...s, xHandle: e.target.value }))}
                  placeholder="@..."
                />
              </label>
              <label>
                {t("Adena g1", "Adena g1")}
                <input
                  required
                  className="mono"
                  value={apply.g1}
                  onChange={(e) => setApply((s) => ({ ...s, g1: e.target.value }))}
                  placeholder="g1..."
                />
              </label>
              <label>
                {t("Confirm g1", "Xác nhận g1")}
                <input
                  required
                  className="mono"
                  value={apply.g1Confirm}
                  onChange={(e) => setApply((s) => ({ ...s, g1Confirm: e.target.value }))}
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
              <label className="season0-hint" style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={apply.ageOk}
                  onChange={(e) => setApply((s) => ({ ...s, ageOk: e.target.checked }))}
                />
                <span>{t("I confirm I am 18+", "Tôi xác nhận đủ 18 tuổi")}</span>
              </label>
              <label className="season0-hint" style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={apply.rulesOk}
                  onChange={(e) => setApply((s) => ({ ...s, rulesOk: e.target.checked }))}
                />
                <span>
                  {t(
                    "I agree to Option A Rules — discretionary pool after mainnet; not APR/investment; Points ≠ cash",
                    "Tôi đồng ý Rules Option A — pool discretionary sau mainnet; không APR/đầu tư; Points ≠ tiền",
                  )}
                </span>
              </label>
              <label className="season0-hint" style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={apply.notInsider}
                  onChange={(e) => setApply((s) => ({ ...s, notInsider: e.target.checked }))}
                />
                <span>
                  {t(
                    "I am not a Gnomi team / protocol admin seeking prize",
                    "Tôi không phải team Gnomi / protocol admin nhận giải",
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
                {t("Adena g1 (same as apply)", "Adena g1 (cùng đơn apply)")}
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
                Discord
                <input
                  value={content.discord}
                  onChange={(e) => setContent((s) => ({ ...s, discord: e.target.value }))}
                />
              </label>
              <label>
                X handle
                <input
                  value={content.xHandle}
                  onChange={(e) => setContent((s) => ({ ...s, xHandle: e.target.value }))}
                  placeholder="@..."
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
