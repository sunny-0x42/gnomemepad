import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { usePrefs } from "../context/PrefsContext";
import TokenAvatar from "../components/TokenAvatar";
import { Badge, EmptyState, PageHeader, SkeletonCards } from "../components/ui";
import { api } from "../lib/api";
import {
  copyText,
  fmtGnot,
  fmtMcapUsd,
  fmtNum,
  fmtPnl,
  fmtPriceUsd,
  shortAddr,
  toUsd,
} from "../lib/format";
import { isRetiredPad } from "../lib/marketHeat";
import { resolveTokenImage } from "../lib/meta";

function holdingValueGnot(h) {
  if (h?.valueGnotApprox != null) return Number(h.valueGnotApprox) || 0;
  return (Number(h?.valueUgnotApprox) || 0) / 1e6;
}

function holdingBalance(h) {
  return Number(h?.balance ?? h?.tokens ?? 0) || 0;
}

export default function Portfolio() {
  const { wallet, connect, watchlist, toggleWatch, showToast } = useApp();
  const { t, lang } = usePrefs();
  const vi = lang === "vi";
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all"); // all | raising | graduated | watch

  const load = useCallback(async () => {
    if (!wallet?.address) return;
    setLoading(true);
    setErr("");
    try {
      const p = await api(`/api/portfolio?address=${encodeURIComponent(wallet.address)}`);
      setData(p);
    } catch (e) {
      setData(null);
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const holdings = useMemo(() => {
    const rows = Array.isArray(data?.holdings) ? data.holdings : [];
    return [...rows]
      .filter((h) => !isRetiredPad(h.pkg) && !isRetiredPad(h.padLabel))
      .sort((a, b) => holdingValueGnot(b) - holdingValueGnot(a));
  }, [data]);

  const totalMemeGnot = useMemo(
    () => holdings.reduce((s, h) => s + holdingValueGnot(h), 0),
    [holdings],
  );

  const gnotBal = Number(data?.gnot ?? (data?.ugnot || 0) / 1e6) || 0;
  const wugnotBal = Number(data?.wugnotGnot ?? (data?.wugnot || 0) / 1e6) || 0;
  const gnotUsd = Number(data?.gnotUsd) || 0;
  const gnotUsdVal = Number(data?.gnotUsdValue) || (gnotUsd > 0 ? gnotBal * gnotUsd : 0);
  const wugnotUsdVal =
    Number(data?.wugnotUsdValue) || (gnotUsd > 0 ? wugnotBal * gnotUsd : 0);
  const memeUsdVal = gnotUsd > 0 ? totalMemeGnot * gnotUsd : 0;
  const totalUsd = gnotUsdVal + wugnotUsdVal + memeUsdVal;
  const totalGnot = gnotBal + wugnotBal + totalMemeGnot;

  const raisingCount = holdings.filter((h) => h.status !== 1 && h.statusLabel !== "graduated").length;
  const gradCount = holdings.filter((h) => h.status === 1 || h.statusLabel === "graduated").length;

  const filtered = useMemo(() => {
    if (filter === "watch") return [];
    let list = [...holdings];
    if (filter === "raising") {
      list = list.filter((h) => h.status !== 1 && h.statusLabel !== "graduated");
    } else if (filter === "graduated") {
      list = list.filter((h) => h.status === 1 || h.statusLabel === "graduated");
    }
    return list;
  }, [holdings, filter]);

  async function onCopy() {
    try {
      await copyText(wallet.address);
      showToast(vi ? "Đã copy địa chỉ" : "Address copied");
    } catch {
      showToast(vi ? "Copy thất bại" : "Copy failed", false);
    }
  }

  if (!wallet) {
    return (
      <section className="view portfolio-hub">
        <EmptyState
          icon="◈"
          title={t("portfolio")}
          action={
            <button type="button" className="btn primary" onClick={connect}>
              {t("connect")}
            </button>
          }
        >
          {t("connectPortfolio")}
        </EmptyState>
      </section>
    );
  }

  return (
    <section className="view portfolio-hub">
      <PageHeader
        kicker={t("wallet")}
        title={t("portfolio")}
        lede={
          vi
            ? "Số dư GNOT / WUGNOT và vị thế meme trên Sapphire."
            : "GNOT / WUGNOT balances and meme positions on Sapphire."
        }
        actions={
          <>
            <Link className="btn sm primary" to="/">
              {t("browseMarkets")}
            </Link>
            <button type="button" className="btn sm ghost" onClick={load} disabled={loading}>
              {loading ? t("loading") : t("refresh")}
            </button>
          </>
        }
      />

      <div className="portfolio-identity panel">
        <div className="portfolio-identity-main">
          <div className="portfolio-avatar-ring" aria-hidden>
            {wallet.address.slice(2, 4).toUpperCase()}
          </div>
          <div>
            <div className="portfolio-identity-label muted">
              {vi ? "Ví của bạn" : "Your wallet"}
            </div>
            <button
              type="button"
              className="portfolio-addr mono"
              onClick={onCopy}
              title={wallet.address}
            >
              {shortAddr(wallet.address, 6)}
              <span className="faint"> · {vi ? "sao chép" : "copy"}</span>
            </button>
          </div>
        </div>
        <div className="portfolio-identity-meta">
          <span className="portfolio-pill">
            <strong>{holdings.length}</strong> {t("holdings").toLowerCase()}
          </span>
          {watchlist.length > 0 && (
            <span className="portfolio-pill">
              <strong>{watchlist.length}</strong> {t("watchlist").toLowerCase()}
            </span>
          )}
          {totalUsd > 0 && (
            <span className="portfolio-pill total">
              <strong>{fmtMcapUsd(totalUsd)}</strong> {vi ? "ước tính" : "est. total"}
            </span>
          )}
        </div>
      </div>

      {err && (
        <div className="callout warn" style={{ marginBottom: "1rem" }}>
          {err}
          <button type="button" className="btn sm ghost" style={{ marginLeft: 8 }} onClick={load}>
            {t("retry")}
          </button>
        </div>
      )}

      {loading && !data && <SkeletonCards n={4} />}

      {data && (
        <>
          {/* Total net worth strip */}
          <div className="portfolio-net panel">
            <div>
              <span className="portfolio-net-k muted">
                {vi ? "Tổng ước tính" : "Estimated total"}
              </span>
              <div className="portfolio-net-v mono">
                {totalUsd > 0
                  ? fmtMcapUsd(totalUsd)
                  : `${fmtGnot(totalGnot, { alreadyGnot: true })} GNOT`}
              </div>
              <p className="portfolio-net-s muted">
                {vi
                  ? `${fmtGnot(totalGnot, { alreadyGnot: true })} GNOT · GNOT + WUGNOT + meme (spot)`
                  : `${fmtGnot(totalGnot, { alreadyGnot: true })} GNOT · cash + wrapped + meme (spot)`}
                {gnotUsd > 0 ? ` · $${Number(gnotUsd).toFixed(4)}/GNOT` : ""}
              </p>
            </div>
            <div className="portfolio-net-bars" aria-hidden>
              {(() => {
                const parts = [
                  { k: "GNOT", v: gnotUsdVal || gnotBal, c: "var(--accent, #6ee7b7)" },
                  { k: "WUGNOT", v: wugnotUsdVal || wugnotBal, c: "var(--cyan, #22d3ee)" },
                  { k: "Meme", v: memeUsdVal || totalMemeGnot, c: "var(--good, #34d399)" },
                ];
                const sum = parts.reduce((s, p) => s + Math.max(0, p.v), 0) || 1;
                return (
                  <div className="portfolio-alloc">
                    {parts.map((p) => (
                      <i
                        key={p.k}
                        title={p.k}
                        style={{
                          width: `${Math.max(2, (Math.max(0, p.v) / sum) * 100)}%`,
                          background: p.c,
                        }}
                      />
                    ))}
                  </div>
                );
              })()}
              <div className="portfolio-alloc-legend">
                <span>
                  <i className="dot gnot" /> GNOT
                </span>
                <span>
                  <i className="dot wugnot" /> WUGNOT
                </span>
                <span>
                  <i className="dot meme" /> Meme
                </span>
              </div>
            </div>
          </div>

          <div className="portfolio-stats" role="group" aria-label="Balances">
            <div className="portfolio-stat">
              <span className="portfolio-stat-k">{t("gnotBalance")}</span>
              <strong className="portfolio-stat-v mono">
                {gnotUsdVal > 0
                  ? fmtMcapUsd(gnotUsdVal)
                  : fmtGnot(gnotBal, { alreadyGnot: true })}
              </strong>
              <span className="portfolio-stat-s faint">
                {fmtGnot(gnotBal, { alreadyGnot: true })} GNOT
              </span>
            </div>
            <div className="portfolio-stat">
              <span className="portfolio-stat-k">{t("wugnotBalance")}</span>
              <strong className="portfolio-stat-v mono">
                {wugnotUsdVal > 0
                  ? fmtMcapUsd(wugnotUsdVal)
                  : fmtGnot(wugnotBal, { alreadyGnot: true })}
              </strong>
              <span className="portfolio-stat-s faint">
                {fmtGnot(wugnotBal, { alreadyGnot: true })} WUGNOT
              </span>
            </div>
            <div className="portfolio-stat">
              <span className="portfolio-stat-k">{t("memePositions")}</span>
              <strong className="portfolio-stat-v mono">
                {fmtNum(
                  typeof data.memePositions === "number" ? data.memePositions : holdings.length,
                )}
              </strong>
              <span className="portfolio-stat-s faint">
                {fmtNum(raisingCount)} {vi ? "raise" : "raising"} · {fmtNum(gradCount)}{" "}
                {t("graduated").toLowerCase()}
              </span>
            </div>
            <div className={`portfolio-stat${totalMemeGnot > 0 ? " glow" : ""}`}>
              <span className="portfolio-stat-k">{t("estMemeValue")}</span>
              <strong className="portfolio-stat-v mono">
                {memeUsdVal > 0
                  ? fmtMcapUsd(memeUsdVal)
                  : fmtGnot(totalMemeGnot, { alreadyGnot: true })}
              </strong>
              <span className="portfolio-stat-s faint">
                {fmtGnot(totalMemeGnot, { alreadyGnot: true })} GNOT ·{" "}
                {vi ? "spot curve/pool" : "curve / pool spot"}
              </span>
            </div>
          </div>

          {/* Filters */}
          <div className="portfolio-toolbar">
            <div className="filter-tabs portfolio-filters" role="tablist">
              {[
                ["all", vi ? "Tất cả" : "All", holdings.length],
                ["raising", t("raising"), raisingCount],
                ["graduated", t("graduated"), gradCount],
                ["watch", t("watchlist"), watchlist.length],
              ].map(([id, lab, n]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={filter === id}
                  className={`filter-btn${filter === id ? " active" : ""}`}
                  onClick={() => setFilter(id)}
                >
                  {lab}
                  {n > 0 ? <span className="tab-count">{n}</span> : null}
                </button>
              ))}
            </div>
          </div>

          {filter === "watch" ? (
            watchlist.length === 0 ? (
              <EmptyState
                icon="☆"
                title={t("watchlist")}
                action={
                  <Link className="btn primary" to="/">
                    {t("browseMarkets")}
                  </Link>
                }
              >
                {vi
                  ? "Sao token trên Markets để theo dõi nhanh tại đây."
                  : "Star tokens on Markets to track them here."}
              </EmptyState>
            ) : (
              <div className="portfolio-grid">
                {watchlist.map((w) => {
                  const path = `/token/${encodeURIComponent(w.id)}?pkg=${encodeURIComponent(w.pkg || "")}`;
                  return (
                    <article key={`wl-${w.pkg}:${w.id}`} className="portfolio-card panel is-watch">
                      <div className="portfolio-card-top">
                        <Link to={path} className="portfolio-card-id">
                          <TokenAvatar
                            name={w.name}
                            symbol={w.symbol}
                            seed={`${w.pkg}:${w.id}`}
                            size="lg"
                          />
                          <div>
                            <div className="portfolio-card-title">
                              {w.name || w.symbol || w.id}
                              {w.symbol ? (
                                <span className="card-symbol">${w.symbol}</span>
                              ) : null}
                            </div>
                            <div className="portfolio-card-meta muted mono">#{w.id}</div>
                          </div>
                        </Link>
                        <button
                          type="button"
                          className="btn sm ghost watch-btn on"
                          onClick={() => toggleWatch(w)}
                          title={vi ? "Bỏ watch" : "Unwatch"}
                        >
                          ★
                        </button>
                      </div>
                      <div className="portfolio-card-actions">
                        <Link className="btn sm primary" to={path}>
                          {t("trade")}
                        </Link>
                        <Link className="btn sm ghost" to={path}>
                          {vi ? "Mở" : "Open"}
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )
          ) : holdings.length === 0 ? (
            <EmptyState
              icon="◎"
              title={vi ? "Chưa có vị thế" : "No positions yet"}
              action={
                <Link className="btn primary" to="/">
                  {t("browseMarkets")}
                </Link>
              }
            >
              {vi
                ? "Mua trên bonding curve hoặc pool — số dư hiện ở đây."
                : "Buy on a bonding curve or pool — balances show up here."}
            </EmptyState>
          ) : filtered.length === 0 ? (
            <div className="muted" style={{ padding: "1.25rem 0" }}>
              {vi ? "Không có vị thế trong bộ lọc này." : "No positions in this filter."}
            </div>
          ) : (
            <div className="portfolio-grid">
              {filtered.map((h) => {
                const bal = holdingBalance(h);
                const val = holdingValueGnot(h);
                const valUsd =
                  h.valueUsdApprox != null && h.valueUsdApprox > 0
                    ? h.valueUsdApprox
                    : toUsd(val, h.gnotUsd || gnotUsd, null);
                const isGrad = h.status === 1 || h.statusLabel === "graduated";
                const path = `/token/${encodeURIComponent(h.id)}?pkg=${encodeURIComponent(h.pkg || "")}`;
                const img = resolveTokenImage(h, null);
                const priceUsd = toUsd(h.priceGnot, h.gnotUsd || gnotUsd, h.priceUsd);
                const mcapUsd = toUsd(h.mcapGnot, h.gnotUsd || gnotUsd, h.mcapUsd);
                const sharePct =
                  totalMemeGnot > 0 ? Math.min(100, (val / totalMemeGnot) * 100) : 0;
                const watched = watchlist.some(
                  (w) => String(w.id) === String(h.id) && String(w.pkg || "") === String(h.pkg || ""),
                );

                return (
                  <article
                    key={`${h.pkg || ""}:${h.id}`}
                    className={`portfolio-card panel${isGrad ? " is-grad" : ""}${val > 0 ? " has-value" : ""}`}
                  >
                    <div className="portfolio-card-top">
                      <Link to={path} className="portfolio-card-id">
                        <TokenAvatar
                          name={h.name}
                          symbol={h.symbol}
                          uri={img || h.uri}
                          seed={`${h.pkg}:${h.id}`}
                          size="lg"
                        />
                        <div>
                          <div className="portfolio-card-title">
                            {h.name || h.symbol}
                            <span className="card-symbol">${h.symbol}</span>
                          </div>
                          <div className="portfolio-card-meta muted">
                            <span className="mono">#{h.id}</span>
                            {h.padLabel ? <span>· {h.padLabel}</span> : null}
                          </div>
                        </div>
                      </Link>
                      <div className="portfolio-card-badges">
                        {h.gnoswapListed ? (
                          <Badge kind="gnoswap">{t("gnoswapBadge")}</Badge>
                        ) : (
                          <Badge kind={isGrad ? "graduated" : "curve"}>
                            {isGrad ? t("graduated") : t("onCurve")}
                          </Badge>
                        )}
                        <button
                          type="button"
                          className={`btn sm ghost watch-btn${watched ? " on" : ""}`}
                          onClick={() =>
                            toggleWatch({
                              id: h.id,
                              pkg: h.pkg,
                              name: h.name,
                              symbol: h.symbol,
                            })
                          }
                          title={watched ? "Unwatch" : "Watch"}
                        >
                          {watched ? "★" : "☆"}
                        </button>
                      </div>
                    </div>

                    <div className="portfolio-card-value">
                      <div>
                        <span className="k muted">{vi ? "Ước giá" : "Est. value"}</span>
                        <strong className="v mono">
                          {valUsd > 0
                            ? fmtMcapUsd(valUsd)
                            : `${fmtGnot(val, { alreadyGnot: true })} GNOT`}
                        </strong>
                        {h.pnlGnot != null && Number.isFinite(Number(h.pnlGnot)) && (
                          <span
                            className={`s mono ${Number(h.pnlGnot) >= 0 ? "up" : "down"}`}
                            title={
                              h.entryGnot > 0
                                ? `Entry ${h.entryGnot} · Spot ${h.spotGnot || h.priceGnot}`
                                : undefined
                            }
                          >
                            PnL {fmtPnl(h.pnlGnot)}
                            {h.pnlPct != null && Number.isFinite(Number(h.pnlPct))
                              ? ` (${Number(h.pnlPct) >= 0 ? "+" : ""}${Number(h.pnlPct).toFixed(1)}%)`
                              : ""}
                          </span>
                        )}
                        <span className="s faint">
                          {fmtGnot(val, { alreadyGnot: true })} GNOT
                          {sharePct >= 1 ? ` · ${sharePct.toFixed(0)}% bag` : ""}
                        </span>
                      </div>
                      {sharePct > 0 && (
                        <div className="portfolio-share-bar" title={`${sharePct.toFixed(1)}% of meme bag`}>
                          <i style={{ width: `${sharePct}%` }} />
                        </div>
                      )}
                    </div>

                    <div className="portfolio-card-metrics">
                      <div>
                        <span className="k">{vi ? "Số dư" : "Balance"}</span>
                        <strong className="v mono">{fmtNum(bal)}</strong>
                      </div>
                      <div>
                        <span className="k">{t("price")}</span>
                        <strong className="v mono">
                          {priceUsd > 0 ? fmtPriceUsd(priceUsd) : "—"}
                        </strong>
                      </div>
                      <div>
                        <span className="k">{t("mcap")}</span>
                        <strong className="v mono">
                          {mcapUsd > 0 ? fmtMcapUsd(mcapUsd) : "—"}
                        </strong>
                      </div>
                    </div>

                    <div className="portfolio-card-actions">
                      <Link className="btn sm primary" to={path}>
                        {t("trade")}
                      </Link>
                      <Link className="btn sm ghost" to={path}>
                        {isGrad ? t("sell") : t("buy")}
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
