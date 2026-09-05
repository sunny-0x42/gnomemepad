import { useEffect, useState } from "react";
import { PageHeader, SkeletonPanel, Stat } from "../components/ui";
import { usePrefs } from "../context/PrefsContext";
import { api } from "../lib/api";
import { copyText, fmtGnot, fmtNum, shortAddr } from "../lib/format";

export default function Ops() {
  const { t } = usePrefs();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setErr("");
      setLoading(true);
      setData(await api("/api/ops?refresh=1"));
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const inv = data?.inventory;

  async function copyPad() {
    if (!inv?.padAddr) return;
    try {
      await copyText(inv.padAddr);
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="view">
      <PageHeader
        kicker="Public"
        title={t("ops")}
        lede={t("opsLede")}
        actions={
          <button type="button" className="btn sm ghost" onClick={load} disabled={loading}>
            {loading ? t("loading") : t("refresh")}
          </button>
        }
      />

      {err && (
        <div className="callout err" style={{ marginBottom: "1rem" }}>
          {err}
        </div>
      )}

      {loading && !data && <SkeletonPanel height={160} />}

      {data && (
        <>
          <div className={`callout ${data.ok ? "ok" : "err"}`} style={{ marginBottom: "1.1rem" }}>
            <strong>{data.ok ? t("stackHealthy") : t("issuesDetected")}</strong>
            <div className="muted" style={{ fontSize: "0.78rem", marginTop: "0.35rem" }}>
              Height <code className="mono">{data.height || "-"}</code>
              {" · "}
              chain <code className="mono">{data.chainId || "-"}</code>
            </div>
          </div>

          {/* Gnoswap inventory strip */}
          {inv && (
            <div
              className={`panel ops-inventory ${inv.listReady ? "ready" : "warn"}`}
              style={{ marginBottom: "1.15rem" }}
            >
              <div className="ops-inv-head">
                <div>
                  <h2 className="panel-title" style={{ margin: 0 }}>
                    Gnoswap inventory
                  </h2>
                  <p className="muted" style={{ margin: "0.3rem 0 0", fontSize: "0.8rem" }}>
                    Active pad <code className="mono">{inv.padLabel || "pad"}</code>
                    {" · "}
                    raise need{" "}
                    <strong>{fmtGnot(inv.raiseNeedGnot, { alreadyGnot: true })} GNOT</strong>
                  </p>
                </div>
                <span className={`badge ${inv.listReady ? "graduated" : "promo"}`}>
                  {inv.listReady ? "list ready" : "needs fund"}
                </span>
              </div>

              <div className="stat-row" style={{ marginTop: "0.85rem", marginBottom: 0 }}>
                <Stat
                  label="WUGNOT (LP)"
                  value={fmtGnot(inv.wugnotGnot, { alreadyGnot: true })}
                  hint={
                    inv.lpReady
                      ? t("inventoryOk")
                      : `need ${fmtGnot(inv.raiseNeedGnot, { alreadyGnot: true })}`
                  }
                />
                <Stat
                  label="GNS (fee)"
                  value={(inv.gnsUnits ?? 0).toFixed(0)}
                  hint={inv.feeReady ? t("feeOk") : "need ~100 GNS"}
                />
                <Stat
                  label="Pad bank"
                  value={fmtGnot(inv.bankGnot, { alreadyGnot: true })}
                  hint="ugnot on pad"
                />
              </div>

              <ul className="list-checklist" style={{ marginTop: "0.85rem" }}>
                <li className={inv.lpReady ? "ok" : "need"}>
                  <span className="lc-mark">{inv.lpReady ? "OK" : "!"}</span>
                  <span>
                    WUGNOT &gt;= raise ({fmtGnot(inv.raiseNeedGnot, { alreadyGnot: true })} GNOT)
                  </span>
                </li>
                <li className={inv.feeReady ? "ok" : "need"}>
                  <span className="lc-mark">{inv.feeReady ? "OK" : "!"}</span>
                  <span>GNS &gt;= 100 (CreatePool fee)</span>
                </li>
              </ul>

              {inv.padAddr && (
                <div className="ops-inv-addr">
                  <code className="mono">{shortAddr(inv.padAddr)}</code>
                  <button type="button" className="btn sm ghost" onClick={copyPad}>
                    Copy padAddr
                  </button>
                  <span className="faint mono" style={{ fontSize: "0.68rem", wordBreak: "break-all" }}>
                    {inv.padAddr}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="ops-grid">
            {Object.entries(data.modules || {}).map(([name, m]) => (
              <div key={name} className={`ops-card ${m?.ok ? "ok" : "err"}`}>
                <div className="ops-card-top">
                  <strong style={{ textTransform: "capitalize" }}>{name}</strong>
                  <span className={`badge ${m?.ok ? "graduated" : "curve"}`}>
                    {m?.ok ? "ok" : "err"}
                  </span>
                </div>
                <div className="mono faint" style={{ fontSize: "0.7rem", margin: "0.35rem 0 0.5rem" }}>
                  {(m?.path || "").split("/").pop() || "-"}
                </div>
                {m?.kind === "pad" && (
                  <div style={{ fontSize: "0.84rem" }}>
                    Launches: <strong>{fmtNum(m.launchCount)}</strong>
                    {m.params?.graduationGnot != null && (
                      <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
                        raise {m.params.graduationGnot} GNOT
                      </div>
                    )}
                  </div>
                )}
                {m?.error && (
                  <div style={{ fontSize: "0.72rem", color: "var(--bad)", marginTop: "0.35rem" }}>
                    {m.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
