import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { SkeletonPanel } from "../components/ui";
import { api } from "../lib/api";
import { copyText, fmtGnot, shortAddr } from "../lib/format";

/**
 * Deploy-wallet only. Route is also gated; this is a second line of defense.
 */
export default function Admin() {
  const { isAdmin, wallet, connect, broadcast, showToast, pkg } = useApp();
  const [d, setD] = useState(null);
  const [bond, setBond] = useState(null);
  const [ops, setOps] = useState(null);
  const [log, setLog] = useState("");
  const [withdraw, setWithdraw] = useState("");
  const [newTreasury, setNewTreasury] = useState("");
  const [promoUgnot, setPromoUgnot] = useState("20000000");
  const [claimBusy, setClaimBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, b, o] = await Promise.all([
        api("/api/admin?refresh=1"),
        api("/api/bond").catch(() => null),
        api("/api/ops?refresh=1").catch(() => null),
      ]);
      setD(data);
      setBond(b);
      setOps(o);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    load().catch((e) => setLog(e.message || String(e)));
  }, [isAdmin, load]);

  if (!wallet) {
    return (
      <section className="view">
        <div className="empty">
          <button type="button" className="btn primary" onClick={connect}>
            Connect deploy wallet
          </button>
        </div>
      </section>
    );
  }

  // Hard gate: non-deploy wallets never see admin UI
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  const f = d?.fees || {};
  const c = d?.capital || {};
  const m = d?.markets || {};
  const p = d?.params || {};
  const pendingUgnot = Number(f.pending) || 0;
  const paidUgnot = Number(f.paid) || 0;
  const pendingAllUgnot = Number(f.pendingAll ?? f.pending) || 0;
  const paidAllUgnot = Number(f.paidAll ?? f.paid) || 0;
  const earnedAllUgnot = pendingAllUgnot + paidAllUgnot;
  const feeBps = Number(f.tradeFeeBps ?? p.feeBps) || 120;
  const protoShareBps = Number(f.protocolShareBps) || 4000;
  const byPad = Array.isArray(f.byPad) ? f.byPad : [];
  const claimablePads = byPad.filter((row) => Number(row.pending) > 0);
  const inv = ops?.inventory;
  const raiseGnot = Number(p.graduationGnot) || inv?.raiseNeedGnot || 10000;

  async function run(label, fn, args = [], send = "", pkgPath = null) {
    setLog(`${label}...`);
    try {
      const r = await broadcast(fn, args, send, pkgPath || d?.pkg || pkg);
      setLog(`OK ${r.hash || ""}\nheight ${r.height || ""}`);
      showToast(`${label} ok`);
      await load();
    } catch (e) {
      setLog(String(e.message || e));
      showToast(e.message || e, false);
    }
  }

  async function claimAllPending() {
    if (!claimablePads.length) {
      showToast("No claimable fees", false);
      return;
    }
    if (
      !window.confirm(
        `Claim protocol fees on ${claimablePads.length} pad(s)?\nTotal pending ~${fmtGnot(
          pendingAllUgnot / 1e6,
          { alreadyGnot: true },
        )} GNOT`,
      )
    ) {
      return;
    }
    setClaimBusy(true);
    let ok = 0;
    for (const row of claimablePads) {
      try {
        setLog(`Claiming ${row.label}...`);
        await broadcast("ClaimProtocolFees", [], "", row.pkg);
        ok += 1;
      } catch (e) {
        showToast(`${row.label}: ${e.message || e}`, false);
        break;
      }
    }
    if (ok) showToast(`Claimed ${ok} pad(s)`);
    await load().catch(() => {});
    setClaimBusy(false);
  }

  async function copyPadAddr() {
    const addr = d?.padAddr || inv?.padAddr;
    if (!addr) return;
    try {
      await copyText(addr);
      showToast("Pad address copied");
    } catch {
      showToast("Copy failed", false);
    }
  }

  const bondPkg = bond?.pkg;

  return (
    <section className="view">
      <div className="admin-shell panel create-panel">
        <div className="admin-head">
          <div>
            <div className="admin-badge">PROTOCOL</div>
            <h1 style={{ margin: "0.35rem 0 0" }}>Platform admin</h1>
            <p className="lede" style={{ margin: "0.35rem 0 0" }}>
              Deploy wallet only ·{" "}
              <code className="mono">{(d?.pkg || pkg || "").split("/").pop()}</code>
            </p>
          </div>
          <button type="button" className="btn sm" onClick={() => load()} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {loading && !d && <SkeletonPanel height={200} />}

        {d && (
          <>
            {/* Claimable fees - primary CTA */}
            <article
              className={`admin-claimable-hero${pendingAllUgnot > 0 ? " has-claim" : ""}`}
            >
              <div className="admin-claimable-main">
                <span className="admin-claimable-label">Protocol fees claimable</span>
                <div className="admin-claimable-value">
                  {fmtGnot(f.pendingAllGnot ?? pendingAllUgnot / 1e6, { alreadyGnot: true })}
                  <span className="admin-claimable-unit">GNOT</span>
                </div>
                <p className="muted admin-hint" style={{ margin: "0.35rem 0 0" }}>
                  {pendingAllUgnot > 0
                    ? `${claimablePads.length} pad package(s) with pending fees · active pad ${(
                        f.pendingGnot ?? pendingUgnot / 1e6
                      ).toFixed(4)} GNOT`
                    : "No pending protocol fees right now. Fees accrue as users trade (1.2% x 40% protocol)."}
                </p>
                <div className="mono faint" style={{ fontSize: "0.75rem", marginTop: "0.35rem" }}>
                  {pendingAllUgnot.toLocaleString()} ugnot total pending
                  {" · "}
                  lifetime paid{" "}
                  {fmtGnot(f.paidAllGnot ?? paidAllUgnot / 1e6, { alreadyGnot: true })} GNOT
                </div>
              </div>
              <div className="admin-claimable-actions">
                <button
                  type="button"
                  className="btn primary lg"
                  disabled={pendingUgnot <= 0 || claimBusy}
                  onClick={() => run("ClaimProtocolFees", "ClaimProtocolFees")}
                  title="Claim active pad fees to treasury wallet"
                >
                  Claim active pad
                </button>
                <button
                  type="button"
                  className="btn lg"
                  disabled={claimablePads.length === 0 || claimBusy}
                  onClick={claimAllPending}
                  title="Claim pending fees on every pad with balance"
                >
                  Claim all pads ({claimablePads.length})
                </button>
                <button
                  type="button"
                  className="btn lg ghost"
                  disabled={pendingUgnot <= 0 || claimBusy}
                  onClick={() => run("PushProtocolFees", "PushProtocolFees")}
                >
                  Push to treasury
                </button>
              </div>
            </article>

            {/* Protocol fees breakdown */}
            <article className="admin-card admin-card-wide admin-fees-hero">
              <div className="admin-fees-head">
                <div>
                  <h3 style={{ margin: 0 }}>Fee breakdown</h3>
                  <p className="muted admin-hint" style={{ margin: "0.35rem 0 0" }}>
                    Trade fee {(feeBps / 100).toFixed(2)}% · protocol{" "}
                    {(protoShareBps / 100).toFixed(0)}% of fee (
                    {((feeBps * protoShareBps) / 1_000_000).toFixed(3)}% of volume) · stays on each
                    pad until Claim/Push
                  </p>
                </div>
              </div>

              <div className="admin-stat-row" style={{ marginTop: "0.85rem" }}>
                <div className="admin-stat accent">
                  <span className="admin-stat-k">Pending (active pad)</span>
                  <span className="admin-stat-v">
                    {fmtGnot(f.pendingGnot ?? pendingUgnot / 1e6, { alreadyGnot: true })}
                  </span>
                  <span className="admin-stat-s mono">
                    {pendingUgnot.toLocaleString()} ugnot
                  </span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-k">Paid lifetime (active)</span>
                  <span className="admin-stat-v">
                    {fmtGnot(f.paidGnot ?? paidUgnot / 1e6, { alreadyGnot: true })}
                  </span>
                  <span className="admin-stat-s mono">
                    {paidUgnot.toLocaleString()} ugnot
                  </span>
                </div>
                <div className="admin-stat good">
                  <span className="admin-stat-k">All pads pending</span>
                  <span className="admin-stat-v">
                    {fmtGnot(f.pendingAllGnot ?? pendingAllUgnot / 1e6, {
                      alreadyGnot: true,
                    })}
                  </span>
                  <span className="admin-stat-s mono">
                    {pendingAllUgnot.toLocaleString()} ugnot
                  </span>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-k">All pads earned</span>
                  <span className="admin-stat-v">
                    {fmtGnot(f.totalEarnedAllGnot ?? earnedAllUgnot / 1e6, {
                      alreadyGnot: true,
                    })}
                  </span>
                  <span className="admin-stat-s mono">
                    {earnedAllUgnot.toLocaleString()} ugnot
                  </span>
                </div>
              </div>

              <div className="admin-kv" style={{ marginTop: "0.75rem" }}>
                <span>Treasury</span>
                <code className="mono">{d.protocolAddr || "-"}</code>
                {wallet?.address &&
                  d.protocolAddr &&
                  wallet.address.toLowerCase() === d.protocolAddr.toLowerCase() && (
                    <span className="badge graduated">you</span>
                  )}
              </div>
              <div className="admin-kv">
                <span>Claim target pkg</span>
                <code className="mono">{(d.pkg || "").split("/").pop()}</code>
              </div>

              {byPad.length > 0 && (
                <div className="admin-fee-table-wrap">
                  <table className="admin-fee-table">
                    <thead>
                      <tr>
                        <th>Pad</th>
                        <th>Claimable</th>
                        <th>Paid</th>
                        <th>Total earned</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {byPad.map((row) => {
                        const pend = Number(row.pending) || 0;
                        return (
                          <tr
                            key={row.pkg}
                            className={`${row.active ? "active" : ""}${pend > 0 ? " claimable-row" : ""}`}
                          >
                            <td>
                              <code className="mono">{row.label}</code>
                              {row.active && (
                                <span className="badge graduated" style={{ marginLeft: 6 }}>
                                  active
                                </span>
                              )}
                            </td>
                            <td className="mono">
                              <strong>
                                {fmtGnot(row.pendingGnot, { alreadyGnot: true })}
                              </strong>
                              {pend > 0 && (
                                <span className="badge heat-hot" style={{ marginLeft: 6 }}>
                                  claim
                                </span>
                              )}
                            </td>
                            <td className="mono">
                              {fmtGnot(row.paidGnot, { alreadyGnot: true })}
                            </td>
                            <td className="mono">
                              {fmtGnot(row.totalGnot, { alreadyGnot: true })}
                            </td>
                            <td>
                              {pend > 0 && (
                                <button
                                  type="button"
                                  className="btn sm primary"
                                  disabled={claimBusy}
                                  onClick={() =>
                                    run(
                                      `Claim ${row.label}`,
                                      "ClaimProtocolFees",
                                      [],
                                      "",
                                      row.pkg,
                                    )
                                  }
                                >
                                  Claim
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="muted admin-hint" style={{ marginTop: "0.5rem" }}>
                    Each pad version holds its own fees. Claim active pad first, then older pads
                    (padv11, padv12...) if pending &gt; 0.
                  </p>
                </div>
              )}
            </article>

            {/* Fund wizard for Gnoswap auto-list */}
            <article className="admin-card admin-card-wide admin-fund-wizard">
              <h3 style={{ marginTop: 0 }}>Gnoswap fund wizard (auto-list)</h3>
              <p className="muted admin-hint" style={{ marginTop: 0 }}>
                Before markets hit raise target ({raiseGnot} GNOT), fund pad with WUGNOT + GNS so
                graduate can CreatePool automatically.
              </p>
              {inv ? (
                <>
                  <div className="admin-stat-row">
                    <div className={`admin-stat ${inv.lpReady ? "good" : "accent"}`}>
                      <span className="admin-stat-k">WUGNOT on pad</span>
                      <span className="admin-stat-v">
                        {fmtGnot(inv.wugnotGnot, { alreadyGnot: true })}
                      </span>
                      <span className="admin-stat-s">
                        need {fmtGnot(inv.raiseNeedGnot ?? raiseGnot, { alreadyGnot: true })} for LP
                      </span>
                    </div>
                    <div className={`admin-stat ${inv.feeReady ? "good" : ""}`}>
                      <span className="admin-stat-k">GNS on pad</span>
                      <span className="admin-stat-v">{(inv.gnsUnits ?? 0).toFixed(0)}</span>
                      <span className="admin-stat-s">need ~100 for CreatePool</span>
                    </div>
                    <div className="admin-stat">
                      <span className="admin-stat-k">List ready</span>
                      <span className="admin-stat-v">{inv.listReady ? "Yes" : "No"}</span>
                      <span className="admin-stat-s mono">{inv.padLabel}</span>
                    </div>
                  </div>
                  <ol className="admin-steps fund-steps">
                    <li className={inv.lpReady ? "done" : ""}>
                      Wrap GNOT -&gt; WUGNOT (EOA Deposit on wugnot)
                    </li>
                    <li className={inv.lpReady ? "done" : ""}>
                      Transfer WUGNOT &gt;= <strong>{raiseGnot} GNOT</strong> to pad address
                    </li>
                    <li className={inv.feeReady ? "done" : ""}>
                      Transfer &gt;= <strong>100 GNS</strong> to pad (preferred over ExactOut)
                    </li>
                    <li>Graduate auto-lists when inventory OK; else Token &quot;List on Gnoswap&quot;</li>
                  </ol>
                  <div className="admin-kv">
                    <span>Pad addr</span>
                    <code className="mono admin-addr">{inv.padAddr || d.padAddr || "-"}</code>
                    <button type="button" className="btn sm ghost" onClick={copyPadAddr}>
                      Copy
                    </button>
                  </div>
                </>
              ) : (
                <ol className="admin-steps">
                  <li>Wrap GNOT -&gt; WUGNOT (EOA Deposit)</li>
                  <li>
                    Transfer WUGNOT &gt;= <strong>{raiseGnot} GNOT</strong> (LP) to pad
                  </li>
                  <li>
                    <strong>Preferred:</strong> send &gt;=100 GNS to pad
                  </li>
                </ol>
              )}
            </article>

            <div className="admin-stat-row">
              <div className="admin-stat good">
                <span className="admin-stat-k">Free ugnot</span>
                <span className="admin-stat-v">
                  {fmtGnot(c.freeGnot ?? c.freeUgnot, { alreadyGnot: c.freeGnot != null })}
                </span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat-k">Pad bank</span>
                <span className="admin-stat-v">
                  {fmtGnot(c.padBankGnot ?? c.padBankUgnot, {
                    alreadyGnot: c.padBankGnot != null,
                  })}
                </span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat-k">Reserved</span>
                <span className="admin-stat-v">
                  {fmtGnot(c.reservedGnot ?? c.reservedUgnot, {
                    alreadyGnot: c.reservedGnot != null,
                  })}
                </span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat-k">Creator fees (markets)</span>
                <span className="admin-stat-v">
                  {fmtGnot(m.totalCreatorFeesGnot ?? m.totalCreatorFees, {
                    alreadyGnot: m.totalCreatorFeesGnot != null,
                  })}
                </span>
              </div>
            </div>

            <div className="admin-grid">
              <article className="admin-card">
                <h3>Treasury</h3>
                <div className="admin-kv">
                  <span>Protocol</span>
                  <code className="mono">{shortAddr(d.protocolAddr)}</code>
                </div>
                <div className="admin-kv">
                  <span>You</span>
                  <code className="mono">{shortAddr(wallet.address)}</code>
                  <span className="badge graduated">deploy</span>
                </div>
                <div className="admin-actions">
                  <button
                    type="button"
                    className="btn sm primary"
                    disabled={pendingUgnot <= 0}
                    onClick={() => run("ClaimProtocolFees", "ClaimProtocolFees")}
                  >
                    Claim fees
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={pendingUgnot <= 0}
                    onClick={() => run("PushProtocolFees", "PushProtocolFees")}
                  >
                    Push fees
                  </button>
                </div>
              </article>

              <article className="admin-card">
                <h3>Withdraw free ugnot</h3>
                <p className="muted admin-hint" style={{ marginTop: 0 }}>
                  Only free balance above reserved markets/fees. See fund wizard for WUGNOT/GNS.
                </p>
                <div className="admin-withdraw">
                  <label className="muted">Amount (ugnot)</label>
                  <div className="admin-withdraw-row">
                    <input
                      className="admin-input"
                      value={withdraw}
                      onChange={(e) => setWithdraw(e.target.value)}
                      placeholder="ugnot"
                    />
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() =>
                        run("Withdraw", "WithdrawProtocolUgnot", [
                          String(Math.floor(Number(withdraw) || 0)),
                        ])
                      }
                    >
                      Withdraw
                    </button>
                    <button
                      type="button"
                      className="btn sm ghost"
                      onClick={() => setWithdraw(String(c.freeUgnot || 0))}
                    >
                      Max
                    </button>
                  </div>
                </div>
              </article>

              <article className="admin-card">
                <h3>Markets</h3>
                <div className="admin-mini-stats">
                  <div>
                    <span className="muted">Total</span>
                    <strong>{m.total ?? "—"}</strong>
                  </div>
                  <div>
                    <span className="muted">Curve</span>
                    <strong>{m.curve ?? "—"}</strong>
                  </div>
                  <div>
                    <span className="muted">Graduated</span>
                    <strong>{m.graduated ?? "—"}</strong>
                  </div>
                  <div>
                    <span className="muted">Gnoswap</span>
                    <strong>{m.gnoswapListed ?? "—"}</strong>
                  </div>
                </div>
                <div className="admin-actions">
                  <button
                    type="button"
                    className="btn sm"
                    disabled={d.pointsEnabled}
                    onClick={() => run("Points on", "SetPointsEnabled", ["true"])}
                  >
                    Enable points
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={!d.pointsEnabled}
                    onClick={() => run("Points off", "SetPointsEnabled", ["false"])}
                  >
                    Disable points
                  </button>
                </div>
              </article>

              <article className="admin-card">
                <h3>Params</h3>
                <div className="admin-kv">
                  <span>Bond (live)</span>
                  <strong>
                    {bond?.currentGnot != null
                      ? `${bond.currentGnot} GNOT`
                      : p.createBondGnot != null
                        ? `${p.createBondGnot} GNOT`
                        : "—"}
                  </strong>
                  {bond?.statusLabel === "promo" && (
                    <span className="badge heat-hot">promo</span>
                  )}
                </div>
                <div className="admin-kv">
                  <span>Graduate</span>
                  <strong>{p.graduationGnot ?? "—"} GNOT</strong>
                </div>
                <div className="admin-kv">
                  <span>Fee</span>
                  <strong>
                    {p.feeBps != null ? `${(p.feeBps / 100).toFixed(2)}%` : "—"}
                  </strong>
                </div>
              </article>

              <article className="admin-card admin-card-wide">
                <h3>Create bond policy</h3>
                <p className="muted admin-hint">
                  Separate realm <code className="mono">{bondPkg || "…/bond"}</code> — pad upgrades
                  do not replace this. Promo ≈ $20 in GNOT (set ugnot); 10 days or EndPromo → 2 GNOT.
                </p>
                {bond && !bond.error && (
                  <div className="admin-mini-stats" style={{ marginBottom: "0.75rem" }}>
                    <div>
                      <span className="muted">Mode</span>
                      <strong>{bond.statusLabel || "—"}</strong>
                    </div>
                    <div>
                      <span className="muted">Current</span>
                      <strong>{bond.currentGnot ?? "—"} GNOT</strong>
                    </div>
                    <div>
                      <span className="muted">Normal</span>
                      <strong>{bond.normalGnot ?? 2} GNOT</strong>
                    </div>
                    <div>
                      <span className="muted">Promo left</span>
                      <strong>
                        {bond.secondsLeft
                          ? `${Math.floor(bond.secondsLeft / 86400)}d ${Math.floor((bond.secondsLeft % 86400) / 3600)}h`
                          : "—"}
                      </strong>
                    </div>
                  </div>
                )}
                {bond?.error && (
                  <p className="muted admin-hint">Bond realm: {bond.error}</p>
                )}
                <div className="admin-withdraw-row">
                  <input
                    className="admin-input"
                    value={promoUgnot}
                    onChange={(e) => setPromoUgnot(e.target.value)}
                    placeholder="promo ugnot (20e6 ≈ 20 GNOT)"
                  />
                  <button
                    type="button"
                    className="btn sm primary"
                    disabled={!bondPkg}
                    onClick={() =>
                      run(
                        "StartPromo",
                        "StartPromo",
                        [String(Math.floor(Number(promoUgnot) || 20_000_000)), "864000"],
                        "",
                        bondPkg,
                      )
                    }
                  >
                    StartPromo 10d
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={!bondPkg}
                    onClick={() => run("EndPromo", "EndPromo", [], "", bondPkg)}
                  >
                    EndPromo → 2 GNOT
                  </button>
                </div>
              </article>

              <article className="admin-card admin-card-wide admin-danger-zone">
                <h3>Transfer treasury</h3>
                <div className="admin-withdraw-row">
                  <input
                    className="admin-input mono"
                    placeholder="g1…"
                    value={newTreasury}
                    onChange={(e) => setNewTreasury(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      if (!/^g1[a-z0-9]{38,}$/i.test(newTreasury.trim())) {
                        showToast("Invalid address", false);
                        return;
                      }
                      if (!window.confirm(`Transfer treasury to ${newTreasury}?`)) return;
                      run("TransferProtocol", "TransferProtocol", [newTreasury.trim()]);
                    }}
                  >
                    TransferProtocol
                  </button>
                </div>
              </article>
            </div>

            {log && (
              <pre className="log" style={{ marginTop: "1rem" }}>
                {log}
              </pre>
            )}
          </>
        )}
      </div>
    </section>
  );
}
