import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { usePrefs } from "../context/PrefsContext";
import { Badge, ProgressBar, SkeletonPanel } from "../components/ui";
import PriceChart, { TradesList } from "../components/PriceChart";
import TokenAvatar from "../components/TokenAvatar";
import { api } from "../lib/api";
import {
  applyFee,
  feeBpsOf,
  maxGrossForNetIn,
  grossForRemainingRaise,
  quoteCurveBuy,
  quoteCurveBuyNet,
  quoteCurveSell,
  curveRemainingTokens,
} from "../lib/amm";
import {
  accountExplorerUrl,
  copyText,
  fmtCompact,
  fmtGnot,
  fmtMcapUsd,
  fmtNum,
  fmtPnl,
  fmtPrice,
  fmtPriceUsd,
  shortAddr,
  toUsd,
  UGNOT_PER_GNOT,
} from "../lib/format";
import {
  fetchMetaOne,
  normalizeImageUri,
  resolveTokenImage,
  resolveTokenImageRaw,
  telegramUrl,
  twitterUrl,
  websiteUrl,
} from "../lib/meta";
import { isWatched } from "../lib/watchlist";
import CreatorChip from "../components/CreatorChip";
import {
  adenaPath,
  appendLocalGnoswapTrade,
  buildGnoswapExactInMessages,
  GNO_TOKEN_RESOURCE_URL,
  gnoTokenResourceJson,
  gnoswapSwapUrl,
  gnoswapWugnotApproveKey,
  isGnoswapListed,
  loadLocalGnoswapTrades,
  mergeTradeRows,
  toTradeRow,
  tokenIdFull,
} from "../lib/gnoswap";

export default function Token() {
  const { id: rawId } = useParams();
  const id = decodeURIComponent(rawId || "");
  const [sp] = useSearchParams();
  const pkgQ = sp.get("pkg") || "";
  const forceSkeleton = sp.get("skeleton") === "1";
  const {
    wallet,
    isConnecting,
    connect,
    broadcast,
    broadcastBundle,
    showToast,
    watchlist,
    toggleWatch,
    health,
  } = useApp();
  const { t } = usePrefs();

  const [m, setM] = useState(null);
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState("");
  const [side, setSide] = useState("buy");
  const [amountGnot, setAmountGnot] = useState("1");
  const [sellTokens, setSellTokens] = useState("");
  const [busy, setBusy] = useState(false);
  const [bal, setBal] = useState({ tokens: 0, gnot: 0, ugnot: 0, wugnot: 0 });
  const [slipBps, setSlipBps] = useState(100); // 1%
  const [infoTab, setInfoTab] = useState("trades"); // trades | holders | about
  const [poolQuote, setPoolQuote] = useState(null);
  const [listNeed, setListNeed] = useState(null);
  /** Local Gnoswap swaps (on-page) merged into Trades tab */
  const [dexTrades, setDexTrades] = useState([]);
  /** Mobile terminal pane: raise | chart | trade */
  const [mobilePane, setMobilePane] = useState("raise");
  const listAutoBusyRef = useRef(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaBusy, setMetaBusy] = useState(false);
  const [metaForm, setMetaForm] = useState({
    description: "",
    imageURI: "",
    website: "",
    twitter: "",
    telegram: "",
  });

  const metaPkg = health?.modules?.meta || health?.meta || null;

  const loadBalance = useCallback(async (market) => {
    if (!wallet?.address || !market?.id) return;
    const pkg = market.pkg || pkgQ;
    const padA = market.padAddr || "";
    try {
      const b = await api(
        `/api/balance?address=${encodeURIComponent(wallet.address)}&id=${encodeURIComponent(market.id)}&pkg=${encodeURIComponent(pkg)}${
          padA ? `&padAddr=${encodeURIComponent(padA)}` : ""
        }`,
      );
      setBal(b);
      // Keep pad address fresh for Approve spender
      if (b?.padAddr && /^g1[a-z0-9]+$/i.test(b.padAddr) && !market.padAddr) {
        setM((prev) => (prev ? { ...prev, padAddr: b.padAddr } : prev));
      }
    } catch {
      /* ignore */
    }
  }, [wallet, pkgQ]);

  const load = useCallback(async () => {
    try {
      setErr("");
      const path = `/api/market/${encodeURIComponent(id)}${pkgQ ? `?pkg=${encodeURIComponent(pkgQ)}` : ""}`;
      const data = await api(path);
      setM(data);
      // Meta for image/socials
      if (data?.pkg && data?.id) {
        fetchMetaOne(data.pkg, data.id).then(setMeta).catch(() => setMeta(null));
      }
      return data;
    } catch (e) {
      setErr(e.message || String(e));
      return null;
    }
  }, [id, pkgQ]);

  useEffect(() => {
    load();
    let timer = null;
    let cancelled = false;

    function scheduleNext() {
      if (cancelled) return;
      // Fast 3s polling on visible tab for realtime Sapphire block updates (~2s), 15s when hidden
      const delay = typeof document !== "undefined" && document.visibilityState === "visible" ? 3000 : 15000;
      timer = setTimeout(async () => {
        if (cancelled) return;
        await load();
        scheduleNext();
      }, delay);
    }

    scheduleNext();

    function onVisibilityChange() {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        load();
        scheduleNext();
      }
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [load]);

  useEffect(() => {
    loadBalance(m);
  }, [wallet, m, loadBalance]);

  // Prefill edit form when meta loads / opens (fallback launch.uri for icon)
  useEffect(() => {
    if (!editingMeta) return;
    setMetaForm({
      description: meta?.description || "",
      imageURI: meta?.imageURI || meta?.image || m?.uri || m?.imageURI || "",
      website: meta?.website || "",
      twitter: meta?.twitter || "",
      telegram: meta?.telegram || "",
    });
  }, [editingMeta, meta, m?.uri, m?.imageURI]);

  // ListNeed checklist for graduated internal-CPMM markets (padv13+)
  useEffect(() => {
    if (!m?.id || m.status !== 1 || m.gnoswapListed) {
      setListNeed(null);
      return;
    }
    let cancelled = false;
    api(
      `/api/list-need?id=${encodeURIComponent(m.id)}&pkg=${encodeURIComponent(m.pkg || "")}&refresh=1`,
    )
      .then((n) => {
        if (!cancelled) setListNeed(n);
      })
      .catch(() => {
        if (!cancelled) setListNeed(null);
      });
    return () => {
      cancelled = true;
    };
  }, [m?.id, m?.pkg, m?.status, m?.gnoswapListed]);

  // Document title + basic share meta for SPA
  useEffect(() => {
    if (!m) return;
    const pct = m.progressPct || 0;
    const title = `$${m.symbol} · ${pct}% · gnomi`;
    document.title = title;
    const desc =
      meta?.description ||
      `${m.name} ($${m.symbol}) — ${pct}% to graduate on Gno Sapphire. Fair bonding curve.`;
    let el = document.querySelector('meta[name="description"]');
    if (el) el.setAttribute("content", desc);
    let og = document.querySelector('meta[property="og:title"]');
    if (!og) {
      og = document.createElement("meta");
      og.setAttribute("property", "og:title");
      document.head.appendChild(og);
    }
    og.setAttribute("content", title);
    const img = resolveTokenImage(m, meta) || "/thumbnail.jpg";
    let ogImg = document.querySelector('meta[property="og:image"]');
    if (ogImg) ogImg.setAttribute("content", img);
    return () => {
      document.title = "gnomi · Sapphire";
      let oImg = document.querySelector('meta[property="og:image"]');
      if (oImg) oImg.setAttribute("content", "/thumbnail.jpg");
    };
  }, [m, meta]);

  async function afterTrade() {
    // Show trades list so FOMO flash is visible on the new fill
    setInfoTab("trades");
    setMobilePane((p) => (p === "trade" || p === "raise" ? "chart" : p));
    // Chain may lag — retry market + balance a few times
    let latest = null;
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 600 + i * 500));
      const data = await load();
      if (data) {
        latest = data;
        await loadBalance(data);
      }
    }
    // Auto Gnoswap list: pad cannot self-wrap ugnot (wugnot.Deposit = EOA-only).
    // System wraps from wallet (temp loan), pulls fee GNS or WUGNOT→GNS, lists, reimburses LP.
    if (latest?.status === 1 && !latest?.gnoswapListed && wallet?.canSign) {
      await ensureGnoswapListed(latest, { silent: false });
    }
  }

  /**
   * Auto-list after graduate.
   *
   * NEVER multi-msg Approve + RetryListGnoswap (Adena simulates RetryList with
   * allowance=0 → insufficient allowance). Same class of bug as Buy on padv14.
   *
   * Push-pay style (padv15+):
   *   Deposit? → Transfer WUGNOT to pad → Transfer GNS to pad? → RetryList alone
   * Prefer holding ~100 GNS on pad so fee path does not need large WUGNOT budget.
   */
  async function ensureGnoswapListed(market, { silent = false } = {}) {
    if (!market?.id || market.status !== 1 || market.gnoswapListed) return false;
    if (!wallet?.canSign) {
      if (!silent) showToast("Connect wallet to finish Gnoswap list", false);
      return false;
    }
    if (listAutoBusyRef.current) return false;
    listAutoBusyRef.current = true;
    setBusy(true);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const addrQ = wallet.address
        ? `&address=${encodeURIComponent(wallet.address)}`
        : "";
      const need = await api(
        `/api/list-need?id=${encodeURIComponent(market.id)}&pkg=${encodeURIComponent(market.pkg || "")}&refresh=1${addrQ}`,
      ).catch(() => null);

      if (!need?.ok) {
        await broadcast("RetryListGnoswap", [market.id], "", market.pkg, {
          label: `List $${market.symbol} on Gnoswap`,
          celebrate: true,
          gasWanted: 280_000_000,
          gasFee: 2_000_000,
        });
        showToast("List submitted");
        await load();
        return true;
      }
      if (need.ready) {
        await broadcast("RetryListGnoswap", [market.id], "", market.pkg, {
          label: `List $${market.symbol} on Gnoswap`,
          celebrate: true,
          gasWanted: 280_000_000,
          gasFee: 2_000_000,
        });
        showToast("Pad inventory ready — list submitted");
        await load();
        return true;
      }

      const padAddr = String(need.padAddr || market.padAddr || "").trim();
      if (!padAddr || !/^g1[a-z0-9]+$/i.test(padAddr)) {
        throw new Error("Pad address unknown for list funding");
      }

      const wNeedLp = Math.max(0, Math.floor(Number(need.wNeedLp) || 0));
      const gNeed = Math.max(0, Math.floor(Number(need.gnsNeed) || 0));
      const feeBudRaw = Math.max(0, Math.floor(Number(need.feeWugnotBudget) || 0));
      const FEE_WRAP_CAP = 1_500_000_000;
      const walletGns = Number(need.walletGns);
      const hasGnsFee =
        need.walletHasGnsFee === true ||
        (Number.isFinite(walletGns) && gNeed > 0 && walletGns >= gNeed);
      // Prefer GNS fee: only wrap LP shortfall. Else wrap LP + fee budget.
      const feeBud =
        gNeed > 0 && !hasGnsFee
          ? Math.min(feeBudRaw > 0 ? feeBudRaw : FEE_WRAP_CAP, FEE_WRAP_CAP)
          : 0;
      const wugnotPkg = need.wugnotPkg || "gno.land/r/gnoland/wugnot";
      const gnsPkg = need.gnsPkg || "gno.land/r/gnoswap/gns";
      const wrapFinal = wNeedLp + feeBud;
      const gasBufferUgnot = 2_000_000;
      const walletUgnot =
        need.walletUgnot != null
          ? Math.floor(Number(need.walletUgnot) || 0)
          : Math.floor((Number(bal?.gnot) || 0) * UGNOT_PER_GNOT);

      if (wrapFinal > 0 && walletUgnot < wrapFinal + gasBufferUgnot) {
        const needG = (wrapFinal + gasBufferUgnot) / 1e6;
        const haveG = walletUgnot / 1e6;
        throw new Error(
          `InsufficientCoins: need ~${needG.toFixed(2)} GNOT (LP ${ (wNeedLp / 1e6).toFixed(2) }` +
            (feeBud > 0 ? ` + fee budget ${(feeBud / 1e6).toFixed(0)}` : "") +
            ` + gas), have ${haveG.toFixed(2)}. Prefer ~${(gNeed / 1e6).toFixed(0)} GNS in wallet to skip fee wrap.`,
        );
      }

      // Step A: wrap ugnot → WUGNOT (EOA only)
      if (wrapFinal > 0) {
        if (!silent) {
          showToast(
            `List step 1: wrap ${(wrapFinal / 1e6).toFixed(2)} GNOT → WUGNOT…`,
          );
        }
        await broadcastBundle(
          [
            {
              pkgPath: wugnotPkg,
              func: "Deposit",
              args: [],
              send: `${wrapFinal}ugnot`,
            },
          ],
          {
            label: `List: Deposit WUGNOT`,
            gasWanted: 150_000_000,
            gasFee: 2_000_000,
          },
        );
        await sleep(3500);
      }

      // Step B: PUSH WUGNOT to pad (no Approve — avoids TransferFrom spender bug)
      if (wrapFinal > 0) {
        if (!silent) showToast("List step 2: Transfer WUGNOT → pad…");
        await broadcastBundle(
          [
            {
              pkgPath: wugnotPkg,
              func: "Transfer",
              args: [padAddr, String(wrapFinal)],
            },
          ],
          {
            label: `List: Transfer WUGNOT → pad`,
            gasWanted: 120_000_000,
            gasFee: 2_000_000,
          },
        );
        await sleep(3500);
      }

      // Step C: PUSH GNS fee to pad when wallet has GNS (no Approve/TransferFrom)
      if (gNeed > 0 && hasGnsFee) {
        if (!silent) showToast("List step 3: Transfer GNS fee → pad…");
        await broadcastBundle(
          [
            {
              pkgPath: gnsPkg,
              func: "Transfer",
              args: [padAddr, String(gNeed)],
            },
          ],
          {
            label: `List: Transfer GNS → pad`,
            gasWanted: 120_000_000,
            gasFee: 2_000_000,
          },
        );
        await sleep(3500);
      }

      // Step D: RetryList alone — pad should already hold LP WUGNOT (+ GNS if pushed)
      if (!silent) showToast("List step final: RetryListGnoswap…");
      await broadcast("RetryListGnoswap", [market.id], "", market.pkg, {
        label: `List $${market.symbol} on Gnoswap`,
        celebrate: true,
        gasWanted: 320_000_000,
        gasFee: 2_000_000,
      });
      showToast("Gnoswap list submitted 🎉");
      queueTokenResourceSync(market);
      await load();
      return true;
    } catch (err) {
      const msg = String(err.message || err);
      if (!silent) {
        if (/InsufficientCoins/i.test(msg)) {
          showToast(
            "Insufficient GNOT for wrap+gas. Prefer ~100 GNS in wallet so list only needs LP wrap (reimbursed).",
            false,
          );
        } else if (/insufficient allowance/i.test(msg)) {
          showToast(
            "List hit allowance (old multi-msg). Hard-refresh, retry List — funding is now Transfer→pad then RetryList alone.",
            false,
          );
        } else {
          showToast(msg || "List failed", false);
        }
      }
      return false;
    } finally {
      listAutoBusyRef.current = false;
      setBusy(false);
    }
  }

  const feeBps = feeBpsOf(m);
  const isPool = m?.status === 1;
  const slipFactor = 1 - slipBps / 10000;

  // Graduated markets: default mobile pane to trade (no raise tab)
  useEffect(() => {
    if (isPool && mobilePane === "raise") setMobilePane("trade");
  }, [isPool, mobilePane]);

  // Local trades for Trades tab (both bonding curve and Gnoswap swaps)
  useEffect(() => {
    if (!m) {
      setDexTrades([]);
      return;
    }
    const poolKey = m.gnoswapPoolPath || adenaPath(m) || m.id;
    setDexTrades(loadLocalGnoswapTrades(poolKey));
  }, [m?.id, m?.pkg, m?.gnoswapListed, m?.gnoswapPoolPath, m?.tokenId, m?.symbol]);

  // Sync trades across open tabs in real-time
  useEffect(() => {
    function onStorage(e) {
      if (!e.key || e.key.includes("trades")) {
        if (m) {
          const poolKey = m.gnoswapPoolPath || adenaPath(m) || m.id;
          setDexTrades(loadLocalGnoswapTrades(poolKey));
        }
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [m]);

  // DrySwap quote for graduated / listed markets (Gnoswap router)
  useEffect(() => {
    if (!m || !isPool) {
      setPoolQuote(null);
      return;
    }
    // Registry key for Gnoswap routes (…/pad.SYMBOL) — not Token.ID.seq
    const tokenPath = adenaPath(m);
    if (!tokenPath) {
      setPoolQuote({ ok: false, error: "No token path" });
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        if (side === "buy") {
          const ug = Math.floor(Number(amountGnot) * UGNOT_PER_GNOT);
          if (!Number.isFinite(ug) || ug <= 0) {
            if (!cancelled) setPoolQuote(null);
            return;
          }
          const r = await api(
            `/api/gnoswap?token=${encodeURIComponent(tokenPath)}&side=buy&amount=${ug}`,
          );
          if (!cancelled) setPoolQuote(r?.drySwap || { ok: false });
        } else {
          const tok = Math.floor(Number(sellTokens));
          if (!Number.isFinite(tok) || tok <= 0) {
            if (!cancelled) setPoolQuote(null);
            return;
          }
          const r = await api(
            `/api/gnoswap?token=${encodeURIComponent(tokenPath)}&side=sell&amount=${tok}`,
          );
          if (!cancelled) setPoolQuote(r?.drySwap || { ok: false });
        }
      } catch (e) {
        if (!cancelled) setPoolQuote({ ok: false, error: e.message || String(e) });
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [m, isPool, side, amountGnot, sellTokens]);

  const buyQuote = useMemo(() => {
    if (!m || side !== "buy") return null;
    let ug = Math.floor(Number(amountGnot) * UGNOT_PER_GNOT);
    if (!Number.isFinite(ug) || ug <= 0) return null;
    if (isPool) {
      const fee = applyFee(ug, feeBps);
      const tokensOut = poolQuote?.ok && poolQuote.amountOut != null ? Number(poolQuote.amountOut) : null;
      const minOut =
        tokensOut != null ? Math.max(1, Math.floor(tokensOut * slipFactor)) : 0;
      return {
        ok: poolQuote?.ok !== false,
        pool: true,
        fee,
        ugIn: ug,
        tokensOut,
        minOut,
        poolError: poolQuote?.error,
        loading: poolQuote == null,
      };
    }
    // Raise last-fill (padv10+): net into curve cannot exceed remaining raise.
    const thr = Number(m.params?.graduation) || 0;
    const remRaise =
      m.remainingRaiseUgnot != null
        ? Number(m.remainingRaiseUgnot)
        : thr > 0
          ? Math.max(0, thr - (Number(m.raised) || 0))
          : 0;
    const feeProbe = applyFee(ug, feeBps);
    const netProbe = feeProbe.net + feeProbe.remainder;
    const raiseCapped = remRaise > 0 && netProbe > remRaise;
    // Effective net into curve (matches on-chain cap)
    const netIn = raiseCapped ? remRaise : netProbe;
    const usedGross = raiseCapped ? maxGrossForNetIn(netIn, ug, feeBps) : ug;
    const fee = raiseCapped ? applyFee(usedGross, feeBps) : feeProbe;
    const vu = Number(m.virtualUgnot) || 0;
    const vt = Number(m.virtualToken) || 0;
    const q = quoteCurveBuyNet(vu, vt, netIn);
    // Last-fill: minOut=0 so raise-cap never fails slippage (refund handles size).
    let minOut = 0;
    if (q.ok && q.tokensOut > 0 && !raiseCapped) {
      minOut = Math.max(1, Math.floor(q.tokensOut * slipFactor));
    }
    const raisedUg = Number(m.raised) || 0;
    const raiseContribUg = Math.max(0, Math.min(netIn, remRaise > 0 ? remRaise : netIn));
    const raiseContribGnot = raiseContribUg / UGNOT_PER_GNOT;
    const raiseContribPct =
      thr > 0 ? Math.min(100, (raiseContribUg * 100) / thr) : 0;
    const progressAfter =
      thr > 0
        ? Math.min(100, Math.floor(((raisedUg + raiseContribUg) * 100) / thr))
        : Number(m.progressPct) || 0;
    return {
      ...q,
      ok: q.ok,
      pool: false,
      fee,
      ugIn: usedGross,
      sendUgnot: ug,
      netIn,
      minOut,
      remaining: curveRemainingTokens(m),
      raiseCapped,
      remainingRaiseGnot: remRaise / UGNOT_PER_GNOT,
      refundUgnot: Math.max(0, ug - usedGross),
      raiseContribGnot,
      raiseContribPct,
      progressAfter,
    };
  }, [m, side, amountGnot, isPool, feeBps, slipFactor, poolQuote]);

  // Merge curve + Gnoswap swaps without double rows
  const mergedTrades = useMemo(() => {
    const curve = (m?.chart || [])
      .filter((t) => Number(t.side) !== 2 || (Number(t.ugnot) || 0) > 0)
      .map((t) => ({ ...t, source: t.source || "curve" }));
    const dex = (dexTrades || []).map((t) => ({
      ...t,
      source: t.source || (m?.gnoswapListed ? "gnoswap" : "curve"),
    }));

    return mergeTradeRows(curve, dex);
  }, [m?.chart, dexTrades, m?.gnoswapListed]);

  const sellQuote = useMemo(() => {
    if (!m || side !== "sell") return null;
    const t = Math.floor(Number(sellTokens));
    if (!Number.isFinite(t) || t <= 0) return null;
    if (isPool) {
      const ugOut = poolQuote?.ok && poolQuote.amountOut != null ? Number(poolQuote.amountOut) : null;
      const minOut = ugOut != null ? Math.max(0, Math.floor(ugOut * slipFactor)) : 0;
      return {
        ok: poolQuote?.ok !== false,
        pool: true,
        tokensIn: t,
        ugnotOut: ugOut,
        minOut,
        poolError: poolQuote?.error,
        loading: poolQuote == null,
      };
    }
    const q = quoteCurveSell(
      Number(m.virtualUgnot) || 0,
      Number(m.virtualToken) || 0,
      t,
      feeBps,
    );
    const minOut = q.ugnotOut != null ? Math.max(0, Math.floor(q.ugnotOut * slipFactor)) : 0;
    return { ...q, pool: false, tokensIn: t, minOut };
  }, [m, side, sellTokens, isPool, feeBps, slipFactor, poolQuote]);

  const perfStats = useMemo(() => {
    const rawTrades = (mergedTrades || []).filter((t) => Number(t.side) === 0 || Number(t.side) === 1);
    if (!rawTrades.length) {
      return { p5m: 0, p1h: 0, p6h: 0, p24h: 0, netGnot: 0, buys: 0, sells: 0, volGnot: 0 };
    }

    const now = Date.now();
    const tipH = Number(health?.blockHeight) || 0;
    const maxH = rawTrades.reduce((mx, t) => Math.max(mx, Number(t.height) || 0), 0);
    const refH = tipH > 0 ? Math.max(tipH, maxH) : maxH;

    // Normalize each trade with a reliable timestamp (derived from block height if timeMs is missing)
    const chrono = [...rawTrades]
      .map((t, idx) => {
        let tMs = Number(t.timeMs) || 0;
        const h = Number(t.height) || 0;
        if (!tMs && h > 0 && refH > 0) {
          // Gno Sapphire block interval is ~2.0s
          tMs = Math.max(0, now - (refH - h) * 2000);
        } else if (!tMs) {
          tMs = now - (rawTrades.length - idx) * 30_000;
        }
        return {
          ...t,
          _timeMs: tMs,
          _price: Number(t.priceGnot) || 0,
        };
      })
      .filter((t) => t._price > 0)
      .sort((a, b) => {
        if (a._timeMs !== b._timeMs) return a._timeMs - b._timeMs;
        return (Number(a.height) || 0) - (Number(b.height) || 0);
      });

    if (!chrono.length) {
      return { p5m: 0, p1h: 0, p6h: 0, p24h: 0, netGnot: 0, buys: 0, sells: 0, volGnot: 0 };
    }

    const latestTrade = chrono[chrono.length - 1];
    const earliestTrade = chrono[0];
    const currentPrice = Number(m?.priceGnot) || latestTrade._price;
    const initialPrice = Number(m?.openPriceGnot) || earliestTrade._price;

    function calcChange(windowMs) {
      if (!currentPrice || chrono.length < 1) return 0;
      if (chrono.length === 1) {
        if (initialPrice > 0 && currentPrice !== initialPrice) {
          return ((currentPrice - initialPrice) / initialPrice) * 100;
        }
        return 0;
      }
      const cutoff = now - windowMs;

      // Trades that occurred before or at cutoff establish the starting price of this window
      const beforeCutoff = chrono.filter((t) => t._timeMs <= cutoff);
      let basePrice = 0;
      if (beforeCutoff.length > 0) {
        // Price just before this window started
        basePrice = beforeCutoff[beforeCutoff.length - 1]._price;
      } else {
        // All trades occurred within this window: compare with the token's initial price!
        basePrice = initialPrice > 0 ? initialPrice : earliestTrade._price;
      }

      if (!basePrice || basePrice <= 0) return 0;
      return ((currentPrice - basePrice) / basePrice) * 100;
    }

    const p5m = calcChange(5 * 60 * 1000);
    const p1h = calcChange(60 * 60 * 1000);
    const p6h = calcChange(6 * 60 * 60 * 1000);
    const p24h = calcChange(24 * 60 * 60 * 1000);

    let buys = 0;
    let sells = 0;
    let buyVol = 0;
    let sellVol = 0;
    for (const t of rawTrades) {
      const v = Number(t.volumeGnot != null ? t.volumeGnot : (Number(t.ugnot) || 0) / 1e6) || 0;
      if (Number(t.side) === 0) {
        buys += 1;
        buyVol += v;
      } else if (Number(t.side) === 1) {
        sells += 1;
        sellVol += v;
      }
    }
    const netGnot = buyVol - sellVol;
    const volGnot = buyVol + sellVol;

    return { p5m, p1h, p6h, p24h, buys, sells, buyVol, sellVol, netGnot, volGnot };
  }, [mergedTrades, m?.priceGnot, m?.openPriceGnot, health?.blockHeight]);

  const userPos = useMemo(() => {
    const addr = wallet?.address || "";
    if (!addr || !m) return null;

    const poolKey = m?.gnoswapPoolPath || adenaPath(m) || m?.id;
    const localGnoswap = loadLocalGnoswapTrades(poolKey);
    const chartTrades = (mergedTrades || []).filter(
      (t) => t.address && t.address.toLowerCase() === addr.toLowerCase()
    );

    const seen = new Set();
    const myTrades = [];
    for (const t of [...localGnoswap, ...chartTrades]) {
      if (!t) continue;
      if (t.address && t.address.toLowerCase() !== addr.toLowerCase()) continue;
      const key = t.hash ? `h:${t.hash}` : `t:${t.timeMs}:${t.side}:${t.ugnot}`;
      if (!seen.has(key)) {
        seen.add(key);
        myTrades.push(t);
      }
    }

    const curTokBal = Math.max(0, Math.floor(Number(bal?.tokens) || 0));
    const latestTradePx = (mergedTrades && mergedTrades.length > 0)
      ? Number(mergedTrades[0].priceGnot) || 0
      : 0;
    const curPx = Number(m?.spotGnot) || Number(m?.priceGnot) || latestTradePx || 0;
    const curValGnot = curTokBal * curPx;

    let recordedBoughtGnot = 0;
    let recordedBoughtTokens = 0;
    let recordedSoldGnot = 0;
    let recordedSoldTokens = 0;

    for (const t of myTrades) {
      const v = Number(t.volumeGnot != null ? t.volumeGnot : (Number(t.ugnot) || 0) / 1e6) || 0;
      let tok = Math.floor(Number(t.tokens != null ? t.tokens : t.volumeTokens) || 0);
      if (tok <= 0 && v > 0) {
        const px = Number(t.priceGnot) || curPx;
        if (px > 0) tok = Math.floor(v / px);
      }
      if (Number(t.side) === 0) {
        recordedBoughtGnot += v;
        recordedBoughtTokens += tok;
      } else if (Number(t.side) === 1) {
        recordedSoldGnot += v;
        recordedSoldTokens += tok;
      }
    }

    const avgBuyPx =
      recordedBoughtTokens > 0 ? recordedBoughtGnot / recordedBoughtTokens : curPx;

    let bought = 0;
    let pnlPct = 0;
    let pnlGnot = 0;

    if (curTokBal > 0) {
      if (recordedBoughtTokens > 0 && avgBuyPx > 0) {
        if (curTokBal <= recordedBoughtTokens) {
          bought = curTokBal * avgBuyPx;
        } else {
          const extraTokens = curTokBal - recordedBoughtTokens;
          bought = recordedBoughtGnot + extraTokens * curPx;
        }
        pnlGnot = curValGnot + recordedSoldGnot - (bought + recordedSoldTokens * avgBuyPx);
        const costBasis = bought + recordedSoldTokens * avgBuyPx;
        pnlPct = costBasis > 0 ? (pnlGnot / costBasis) * 100 : 0;
      } else {
        // Tokens held without local buy history: evaluate cost basis at current market value
        bought = curValGnot;
        pnlPct = 0;
        pnlGnot = 0;
      }
    } else {
      // 0 tokens currently held
      bought = recordedBoughtGnot;
      if (recordedSoldTokens > 0 && recordedBoughtGnot > 0) {
        pnlGnot = recordedSoldGnot - recordedBoughtGnot;
        pnlPct = (pnlGnot / recordedBoughtGnot) * 100;
      } else {
        pnlPct = 0;
        pnlGnot = 0;
      }
    }

    const sold = recordedSoldGnot;

    return {
      bought,
      sold,
      tokenBal: curTokBal,
      curValGnot,
      pnlGnot,
      pnlPct,
    };
  }, [
    wallet?.address,
    mergedTrades,
    bal?.tokens,
    m?.priceGnot,
    m?.spotGnot,
    m?.id,
    m?.symbol,
    m?.tokenId,
    m?.gnoswapPoolPath,
    id,
    rawId,
  ]);

  // Keyboard: 1/2/3/4 = quick amounts (when not focused in inputs)
  useEffect(() => {
    function onKey(e) {
      if (e.target?.closest?.("input, textarea, select, button")) return;
      const map = { "1": 25, "2": 50, "3": 75, "4": 100 };
      const pct = map[e.key];
      if (pct == null) return;
      e.preventDefault();
      if (side === "buy") {
        const g = Number(bal.gnot) || 0;
        if (g <= 0) return setAmountGnot("0");
        const v = (g * pct) / 100;
        setAmountGnot(
          v >= 1 ? v.toFixed(4).replace(/\.?0+$/, "") : v.toFixed(6).replace(/\.?0+$/, ""),
        );
      } else {
        const t = Math.floor(Number(bal.tokens) || 0);
        setSellTokens(String(Math.floor((t * pct) / 100)));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [side, bal]);

  /**
   * padv14+: curve/pool collateral is WUGNOT.
   * Buy/SwapBuy(id, amountWugnot, minOut) — 3 user args (cur is injected by VM).
   * Legacy padv13 was Buy(id, minOut) + -send ugnot — 2 user args.
   * "want 4 got 3" = VM saw cur+2 args for a 4-param Buy → used legacy 2-arg call.
   */
  function padPkgCandidates(pkgPath) {
    return [
      pkgPath,
      m?.pkg,
      m?.padLabel,
      pkgQ,
      health?.pkg,
      health?.modules?.pad,
      health?.pads?.find?.((p) => p?.active)?.pkg,
    ]
      .map((c) => String(c || "").trim())
      .filter(Boolean);
  }

  function isWugnotCollateralPad(pkgPath) {
    for (const p of padPkgCandidates(pkgPath)) {
      if (p === "wugnot" || /padv1[4-9]\b|padv[2-9]\d\b|wugnot/i.test(p)) return true;
    }
    return m?.collateral === "wugnot";
  }

  /**
   * WUGNOT buy spend size:
   * - User types GNOT amount → ug units (supports 100+ GNOT like padv13)
   * - Last-fill: net would exceed remaining raise → only spend maxGross needed
   * Approve amount MUST equal Buy amountWugnot (pad pulls full amount first).
   */
  function computeBuySpendUg(userUg) {
    if (!m || isPool || userUg <= 0) return userUg;
    const thr = Number(m.params?.graduation) || 0;
    const remRaise =
      m.remainingRaiseUgnot != null
        ? Number(m.remainingRaiseUgnot)
        : thr > 0
          ? Math.max(0, thr - (Number(m.raised) || 0))
          : 0;
    if (remRaise <= 0) return userUg;
    const feeProbe = applyFee(userUg, feeBps);
    const netProbe = feeProbe.net + feeProbe.remainder;
    if (netProbe <= remRaise) return userUg;
    const exact = maxGrossForNetIn(remRaise, userUg, feeBps);
    return exact > 0 ? exact : userUg;
  }

  /** On-page Gnoswap router swap (listed tokens only) — prefer 1 Adena popup. */
  async function onGnoswapSwap(side, amountIn) {
    if (!wallet?.canSign) return connect();
    if (!m || !isGnoswapListed(m)) throw new Error("Token not listed on Gnoswap");
    const padPkg = m.pkg || pkgQ || health?.pkg || "";
    const tokenKey = adenaPath(m);
    if (!tokenKey) throw new Error("Token path unknown");

    // Fresh dry quote → minOut
    let minOut = 0;
    let quotedOut = 0;
    try {
      const r = await api(
        `/api/gnoswap?token=${encodeURIComponent(tokenKey)}&side=${side}&amount=${amountIn}`,
      );
      if (r?.drySwap?.ok && r.drySwap.amountOut != null) {
        quotedOut = Math.floor(Number(r.drySwap.amountOut) || 0);
        if (slipBps > 0 && quotedOut > 0) {
          minOut = Math.max(0, Math.floor((quotedOut * (10000 - slipBps)) / 10000));
        } else {
          minOut = 0;
        }
      }
    } catch {
      /* allow swap with minOut=0 */
    }

    // Buy FOMO path: skip Deposit if wallet already has WUGNOT; skip Approve if we
    // already set max allowance for this wallet (local flag after successful max approve).
    let skipDeposit = false;
    let skipApprove = false;
    if (side === "buy") {
      const need = Math.trunc(Number(amountIn) || 0);
      let wHave = Math.floor(Number(bal?.wugnot) || 0);
      try {
        const b = await api(
          `/api/balance?address=${encodeURIComponent(wallet.address)}&id=${encodeURIComponent(m.id)}&pkg=${encodeURIComponent(padPkg)}`,
        );
        if (b?.wugnot != null) wHave = Math.floor(Number(b.wugnot) || 0);
        setBal((prev) => ({ ...prev, ...b }));
      } catch {
        /* cached */
      }
      skipDeposit = wHave >= need && need > 0;
      try {
        skipApprove = localStorage.getItem(gnoswapWugnotApproveKey(wallet.address)) === "1";
      } catch {
        skipApprove = false;
      }
    }

    const { messages, approveMax } = buildGnoswapExactInMessages(m, {
      side,
      amountIn,
      minOut,
      padPkg,
      launchId: m.id,
      skipDeposit,
      skipApprove,
      approveMax: true,
    });

    const parts = [];
    if (side === "buy") {
      if (!skipDeposit) parts.push("wrap");
      if (!skipApprove) parts.push("approve");
      parts.push("swap");
    } else {
      parts.push("approve token", "swap");
    }
    showToast(`1-click Gnoswap ${parts.join(" → ")} — sign once`);

    const res = await broadcastBundle(messages, {
      label:
        side === "buy"
          ? `Gnoswap buy $${m.symbol}`
          : `Gnoswap sell $${m.symbol}`,
      gasWanted: 350_000_000,
      gasFee: 2_000_000,
      silent: true,
    });

    // Remember max WUGNOT approve so next buys can skip Approve msg
    if (side === "buy" && !skipApprove && approveMax && wallet?.address) {
      try {
        localStorage.setItem(gnoswapWugnotApproveKey(wallet.address), "1");
      } catch {
        /* ignore */
      }
    }

    const ug =
      side === "buy" ? amountIn : quotedOut > 0 ? quotedOut : 0;
    const tok =
      side === "buy" ? (quotedOut > 0 ? quotedOut : 0) : amountIn;
    const row = toTradeRow({
      side,
      ugnot: ug,
      tokens: tok,
      height: Number(res?.height) || 0,
      timeMs: Date.now(),
      source: "gnoswap",
      hash: res?.hash || "",
      address: wallet?.address || "",
    });
    const poolKey = m.gnoswapPoolPath || tokenKey || String(m.id);
    appendLocalGnoswapTrade(poolKey, row);
    setDexTrades((prev) => mergeTradeRows([row], prev).slice(0, 80));

    // Optimistic balance update immediately
    if (side === "buy" && tok > 0) {
      setBal((prev) => ({
        ...prev,
        tokens: (Number(prev?.tokens) || 0) + tok,
        gnot: Math.max(0, (Number(prev?.gnot) || 0) - ug / 1e6),
      }));
    } else if (side === "sell" && tok > 0) {
      setBal((prev) => ({
        ...prev,
        tokens: Math.max(0, (Number(prev?.tokens) || 0) - tok),
        gnot: (Number(prev?.gnot) || 0) + ug / 1e6,
      }));
    }

    showToast(
      side === "buy"
        ? "Gnoswap buy submitted"
        : "Gnoswap sell submitted (output is WUGNOT — Withdraw to GNOT if needed)",
    );
    // Reload chart (includes indexer row). Keep local until refresh so FOMO stays;
    // mergeTradeRows drops the duplicate when hash/fingerprint match.
    await afterTrade();
  }

  async function onBuy(e) {
    e.preventDefault();
    if (!wallet?.canSign) return connect();
    // Parse GNOT → ugnot without float drift for large sizes
    const raw = String(amountGnot || "").trim().replace(/,/g, "");
    const userUg = Math.floor(Number(raw) * UGNOT_PER_GNOT);
    if (!Number.isFinite(userUg) || userUg <= 0) return showToast("Enter amount", false);
    setBusy(true);
    try {
      // Listed → Gnoswap router ExactIn (not pad Buy/SwapBuy)
      if (isGnoswapListed(m)) {
        await onGnoswapSwap("buy", userUg);
        return;
      }
      const func = isPool ? "SwapBuy" : "Buy";
      const padPkg = m.pkg || pkgQ || health?.pkg || health?.modules?.pad || "";
      const useWugnot = isWugnotCollateralPad(padPkg);
      const spendUg = useWugnot && !isPool ? computeBuySpendUg(userUg) : userUg;
      const raiseCapped = spendUg < userUg;

      // Slippage: last-fill / high impact / large size → minOut=0 (chain refunds excess).
      // padv13 felt "unlimited" because -send + loose minOut; padv14 must not fail
      // on quote float error for 50–100+ GNOT.
      let minOut = 0;
      if (!isPool && !raiseCapped && !buyQuote?.raiseCapped) {
        const impact = Number(buyQuote?.priceImpactPct) || 0;
        const large = spendUg >= 10 * UGNOT_PER_GNOT; // ≥10 GNOT
        if (slipBps > 0 && impact < 8 && !large && buyQuote?.minOut != null) {
          minOut = buyQuote.minOut;
        }
        // else minOut=0 — safer for WUGNOT multi-msg + big curve moves
      }

      if (useWugnot) {
        /*
         * One-click push-pay (padv15+): single Adena multi-msg, no Approve.
         *   [Deposit?] + [Transfer(pad)?] + Buy(id, amount, minOut)
         * Msgs run in order in one tx — pad free/prepaid updates before Buy.
         * Prepaid credit + free float on pad reduce how much we push.
         */
        let padAddr = m.padAddr || listNeed?.padAddr || bal?.padAddr || "";
        if (!padAddr || !/^g1[a-z0-9]+$/i.test(String(padAddr))) {
          const ln = await api(
            `/api/list-need?id=${encodeURIComponent(m.id)}&pkg=${encodeURIComponent(padPkg)}`,
          ).catch(() => null);
          padAddr = ln?.padAddr || "";
        }
        if (!padPkg) throw new Error("Pad package path unknown");

        let wHave = Math.floor(Number(bal?.wugnot) || 0);
        let bankUg = Math.floor(
          Number(bal?.ugnot != null ? bal.ugnot : (Number(bal?.gnot) || 0) * UGNOT_PER_GNOT) || 0,
        );
        let prepaid = Math.floor(Number(bal?.prepaidWugnot) || 0);
        try {
          const b = await api(
            `/api/balance?address=${encodeURIComponent(wallet.address)}&id=${encodeURIComponent(m.id)}&pkg=${encodeURIComponent(padPkg)}${
              padAddr ? `&padAddr=${encodeURIComponent(padAddr)}` : ""
            }`,
          );
          if (b?.wugnot != null) wHave = Math.floor(Number(b.wugnot) || 0);
          if (b?.ugnot != null) bankUg = Math.floor(Number(b.ugnot) || 0);
          else if (b?.gnot != null) bankUg = Math.floor(Number(b.gnot) * UGNOT_PER_GNOT) || 0;
          if (b?.prepaidWugnot != null) prepaid = Math.floor(Number(b.prepaidWugnot) || 0);
          if (b?.padAddr && /^g1[a-z0-9]+$/i.test(b.padAddr)) padAddr = b.padAddr;
          setBal((prev) => ({ ...prev, ...b }));
        } catch {
          /* use cached */
        }

        if (!padAddr || !/^g1[a-z0-9]+$/i.test(String(padAddr).trim())) {
          throw new Error("Pad address unknown — refresh the page and retry Buy.");
        }
        padAddr = String(padAddr).trim();

        const wugnotPkg = "gno.land/r/gnoland/wugnot";
        const spendStr = String(Math.trunc(spendUg));
        const minStr = String(Math.trunc(minOut ?? 0));

        if (raiseCapped && spendUg < userUg) {
          showToast(
            `Last fill: spend ${fmtGnot(spendUg / UGNOT_PER_GNOT, { alreadyGnot: true })} WUGNOT ` +
              `(typed ${fmtGnot(userUg / UGNOT_PER_GNOT, { alreadyGnot: true })})`,
          );
        }

        /**
         * Pad free float = have - reserved (can be NEGATIVE when pad is short).
         * On-chain freeWugnotOnPad clamps to 0, so Transfer(spend) alone does NOT unlock
         * Buy when reserved > have — must push (deficit + spend - prepaid).
         */
        async function readPadWugnotState() {
          try {
            const pw = await api(`/api/pad-wugnot?pkg=${encodeURIComponent(padPkg)}`);
            const have = Math.floor(Number(pw?.have) || 0);
            let reserved = Number(pw?.reserved);
            if (!Number.isFinite(reserved)) reserved = null;
            else reserved = Math.floor(reserved);
            // Prefer true free (unclamped). API free is clamped ≥0.
            let trueFree =
              reserved != null ? have - reserved : null;
            if (trueFree == null && pw?.free != null && Number.isFinite(Number(pw.free))) {
              trueFree = Math.floor(Number(pw.free));
            }
            if (trueFree == null && have > 0) {
              // Last resort estimate — do NOT treat full bank as free (over-skips Transfer).
              trueFree = 0;
            }
            return {
              have,
              reserved: reserved != null ? reserved : 0,
              trueFree: trueFree != null ? trueFree : 0,
              freeClamped: Math.max(0, trueFree != null ? trueFree : 0),
            };
          } catch {
            return { have: 0, reserved: 0, trueFree: 0, freeClamped: 0 };
          }
        }

        const padWu = await readPadWugnotState();
        const trueFree = padWu.trueFree; // may be negative
        const freeClamped = padWu.freeClamped;
        const padDeficit = Math.max(0, -trueFree); // ugnot short of reserved
        // On-chain: spend prepaid first; remainder must come from free after Transfer.
        // free_after = trueFree + needPush  ≥  needFromFree = spend - prepaid
        // ⇒ needPush ≥ needFromFree - trueFree
        const needFromFree = Math.max(0, spendUg - prepaid);
        const needPush = Math.max(0, needFromFree - trueFree);
        const walletForPush = Math.max(wHave, Math.floor(Number(bal?.wugnot) || 0));
        const depositForPush = Math.max(0, needPush - walletForPush);

        if (padDeficit > 0 && needPush > spendUg) {
          showToast(
            `Pad WUGNOT short ~${fmtGnot(padDeficit / UGNOT_PER_GNOT, { alreadyGnot: true })} ` +
              `— this buy will Transfer ${fmtGnot(needPush / UGNOT_PER_GNOT, { alreadyGnot: true })} ` +
              `(fill shortfall + buy).`,
            true,
          );
        } else if (needPush === 0) {
          showToast(
            prepaid > 0 || freeClamped > 0
              ? `1-click Buy (prepaid/free covers · no wrap)`
              : `1-click Buy`,
          );
        } else if (depositForPush > 0 && bankUg < depositForPush) {
          throw new Error(
            `Need ~${fmtGnot(depositForPush / UGNOT_PER_GNOT, { alreadyGnot: true })} more GNOT to wrap ` +
              `(buy ${fmtGnot(spendUg / UGNOT_PER_GNOT, { alreadyGnot: true })}, ` +
              `pad short ${fmtGnot(padDeficit / UGNOT_PER_GNOT, { alreadyGnot: true })}, ` +
              `prepaid ${fmtGnot(prepaid / UGNOT_PER_GNOT, { alreadyGnot: true })}, ` +
              `wallet WUGNOT ${fmtGnot(walletForPush / UGNOT_PER_GNOT, { alreadyGnot: true })}).`,
          );
        } else if (needPush > walletForPush + bankUg) {
          throw new Error(
            `Not enough WUGNOT/GNOT. Need to fund pad ~${fmtGnot(needPush / UGNOT_PER_GNOT, { alreadyGnot: true })} ` +
              `(buy ${fmtGnot(spendUg / UGNOT_PER_GNOT, { alreadyGnot: true })}` +
              (padDeficit > 0
                ? ` + pad shortfall ${fmtGnot(padDeficit / UGNOT_PER_GNOT, { alreadyGnot: true })}`
                : "") +
              `). Wallet WUGNOT ${fmtGnot(walletForPush / UGNOT_PER_GNOT, { alreadyGnot: true })}.`,
          );
        }

        // Atomic multi-msg — one Adena popup (wrap + fund + buy)
        const msgs = [];
        if (depositForPush > 0) {
          msgs.push({
            pkgPath: wugnotPkg,
            func: "Deposit",
            args: [],
            send: `${depositForPush}ugnot`,
          });
        }
        if (needPush > 0) {
          msgs.push({
            pkgPath: wugnotPkg,
            func: "Transfer",
            args: [padAddr, String(needPush)],
          });
        }
        msgs.push({
          pkgPath: padPkg,
          func,
          args: [String(m.id), spendStr, minStr],
        });

        const parts = [];
        if (depositForPush > 0) parts.push("wrap");
        if (needPush > 0) parts.push("fund pad");
        parts.push("buy");
        showToast(`1-click ${parts.join(" → ")} — sign once in Adena`);

        let buyRes = null;
        try {
          buyRes = await broadcastBundle(msgs, {
            label: raiseCapped
              ? `Buy fill $${m.symbol}`
              : `Buy $${m.symbol}`,
            // Deposit+Transfer+Buy needs headroom (esp. last-fill / graduate)
            gasWanted: msgs.length >= 3 ? 320_000_000 : msgs.length === 2 ? 280_000_000 : 220_000_000,
            gasFee: 2_000_000,
            silent: true,
          });
        } catch (buyErr) {
          const bm = String(buyErr.message || buyErr);
          if (/Transfer .* WUGNOT to pad|free=|prepaid=/i.test(bm)) {
            const short =
              padDeficit > 0
                ? `Pad free float is short ~${fmtGnot(padDeficit / UGNOT_PER_GNOT, { alreadyGnot: true })} WUGNOT (reserved > bank). `
                : "";
            throw new Error(
              `${short}Buy needs WUGNOT transferred to pad before Buy. ` +
                `Retry 1-click Buy (will Transfer shortfall + amount). ` +
                `${bm.slice(0, 140)}`,
            );
          }
          if (/insufficient allowance/i.test(bm)) {
            throw new Error(
              `Unexpected allowance error (Buy is push-pay, no Approve). ` +
                `Hard-refresh (Ctrl+Shift+R). Pkg=${String(padPkg).split("/").pop()}.`,
            );
          }
          throw buyErr;
        }
      } else {
        // Legacy padv13 only: Buy(id, minOut) with -send ugnot
        buyRes = await broadcast(func, [String(m.id), String(minOut ?? 0)], `${userUg}ugnot`, padPkg, {
          label: raiseCapped
            ? `Buy $${m.symbol} (fill to graduate)`
            : `Buy $${m.symbol}`,
          gasWanted: 150_000_000,
          silent: true,
        });
      }
      showToast(
        raiseCapped
          ? "Fill submitted — raise should hit 100%"
          : useWugnot
            ? "Buy submitted (WUGNOT)"
            : "Buy submitted",
      );

      await afterTrade();
    } catch (err) {
      const msg = String(err.message || err);
      if (/wrong number of arguments.*Buy/i.test(msg)) {
        showToast(
          "Buy args mismatch (padv14 needs id, amountWugnot, minOut). Hard-refresh (Ctrl+Shift+R) and retry.",
          false,
        );
      } else if (/insufficient allowance|approve pad for WUGNOT/i.test(msg)) {
        showToast(
          "Stale UI / wrong path (Buy never Approves on padv18). Ctrl+Shift+R, clear site data for this site, retry. If Adena still shows Approve WUGNOT — cache not cleared.",
          false,
        );
      } else if (/below minOut|slippage/i.test(msg)) {
        showToast(
          "Slippage too tight for this size. Set max slip higher or retry (large buys use minOut=0).",
          false,
        );
      } else {
        showToast(msg, false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSell(e) {
    e.preventDefault();
    if (!wallet?.canSign) return connect();
    const t = Math.floor(Number(sellTokens));
    if (t <= 0) return showToast("Enter tokens", false);
    setBusy(true);
    try {
      if (isGnoswapListed(m)) {
        await onGnoswapSwap("sell", t);
        return;
      }
      const func = isPool ? "SwapSell" : "Sell";
      const minOut = sellQuote?.minOut != null ? String(sellQuote.minOut) : "0";
      const sellRes = await broadcast(func, [m.id, String(t), minOut], "", m.pkg, {
        label: `Sell $${m.symbol}`,
        silent: true,
      });
      showToast("Sell submitted");

      await afterTrade();
    } catch (err) {
      showToast(err.message || err, false);
    } finally {
      setBusy(false);
    }
  }

  async function onGraduate() {
    if (!wallet?.canSign) return connect();
    setBusy(true);
    try {
      // Graduate first (may soft-skip list if no WUGNOT). Then auto wrap+list.
      await broadcast("Graduate", [m.id], "", m.pkg, {
        label: `Graduate $${m.symbol}`,
        celebrate: true,
      });
      showToast("Graduate submitted — finishing Gnoswap list…");
      await afterTrade();
    } catch (err) {
      showToast(err.message || err, false);
    } finally {
      setBusy(false);
    }
  }

  /** Manual / checklist button — same auto pipeline as post-graduate. */
  async function onRetryListGnoswap() {
    if (!wallet?.canSign) return connect();
    await ensureGnoswapListed(m, { silent: false });
    // After list: queue logo registration for Gnoswap/Adena (token-resource PR)
    queueTokenResourceSync(m);
  }

  /** Fire-and-forget: standardize logo into gno-token-resource pipeline. */
  function queueTokenResourceSync(market) {
    if (!market?.id) return;
    const qs = new URLSearchParams({
      id: market.id,
      pkg: market.pkg || "",
    });
    fetch(`/api/token-resource/register?${qs}`, { method: "POST" }).catch(() => {});
  }

  async function copy(pathOrId, label) {
    try {
      await copyText(pathOrId);
      showToast(`${label} copied`);
    } catch {
      showToast("Copy failed", false);
    }
  }

  function shareX() {
    const og = `${window.location.origin}/.netlify/functions/og?id=${encodeURIComponent(m?.id || id)}${m?.pkg ? `&pkg=${encodeURIComponent(m.pkg)}` : ""}`;
    const url = m?.id ? og : window.location.href;
    const text = m
      ? `$${m.symbol} on gnomi — ${m.progressPct || 0}% to graduate on Gno Sapphire`
      : "gnomi";
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  function normalizeMetaUri(raw) {
    return normalizeImageUri(raw) || String(raw || "").trim();
  }

  async function onSaveMeta(e) {
    e?.preventDefault?.();
    if (!wallet?.canSign) return connect();
    if (!metaPkg) return showToast(t("metaUnavailable"), false);
    if (!m?.pkg || !m?.id) return showToast("Missing launch id", false);

    const description = String(metaForm.description || "").trim().slice(0, 500);
    let imageURI = normalizeImageUri(metaForm.imageURI);
    if (metaForm.imageURI?.trim() && !imageURI) {
      showToast(`${t("imageUrl")}: http(s) or ipfs only`, false);
      return;
    }
    if (imageURI.length > 200) {
      showToast(t("imageUrlTooLong"), false);
      return;
    }
    const website = normalizeImageUri(metaForm.website) || String(metaForm.website || "").trim();
    const twitter = String(metaForm.twitter || "")
      .trim()
      .replace(/^@/, "")
      .slice(0, 64);
    const telegram = String(metaForm.telegram || "")
      .trim()
      .replace(/^@/, "")
      .slice(0, 64);

    if (website && !/^(https?:\/\/|ipfs:\/\/)/i.test(website)) {
      showToast(`${t("website")}: http(s) or ipfs only`, false);
      return;
    }

    setMetaBusy(true);
    try {
      await broadcast(
        "SetMeta",
        [m.pkg, m.id, description, imageURI, website, twitter, telegram],
        "",
        metaPkg,
        { label: `Update meta $${m.symbol}` },
      );
      showToast(t("metaSaved"));
      const next = await fetchMetaOne(m.pkg, m.id);
      setMeta(next);
      setEditingMeta(false);
      // Icon change → re-queue Gnoswap token-resource logo sync
      queueTokenResourceSync(m);
    } catch (err) {
      showToast(err.message || err, false);
    } finally {
      setMetaBusy(false);
    }
  }

  async function copyIconKit() {
    const path = adenaTokenPath || adenaPath(m);
    const imageUrl = resolveTokenImageRaw(m, meta) || img;
    const entry = (() => {
      try {
        return JSON.parse(
          gnoTokenResourceJson({ ...m, description: meta?.description }, { imageUrl }),
        );
      } catch {
        return null;
      }
    })();
    // Strip private helper fields for onbloc schema paste
    if (entry && entry._gnomemepad_image != null) delete entry._gnomemepad_image;
    const json = entry ? JSON.stringify(entry, null, 2) : gnoTokenResourceJson(m, { imageUrl });
    const body = [
      `Adena / Gnoswap path: ${path}`,
      `Image on memepad: ${imageUrl || "(set Image URL on this page)"}`,
      `Live SVG preview: ${typeof window !== "undefined" ? window.location.origin : ""}/api/token-resource/logo?pkg=${encodeURIComponent(m.pkg || "")}&id=${encodeURIComponent(m.id || "")}`,
      "",
      "Standard (auto): gnomemepad queues /api/token-resource/register on create, list, and meta save.",
      "GitHub Action sync-token-resource opens PR → onbloc/gno-token-resource (SVG + sapphire-1.json).",
      "After merge + Gnoswap indexer refresh, logoURI appears on beta.gnoswap.io.",
      GNO_TOKEN_RESOURCE_URL,
      "",
      "Canonical grc20 entry (decimals=0, relative SVG path):",
      json,
    ].join("\n");
    try {
      await copyText(body);
      showToast(t("iconKitCopied"));
    } catch {
      showToast("Copy failed", false);
    }
  }

  if (err) {
    return (
      <section className="view">
        <Link to="/" className="back-link">
          ← {t("backMarkets")}
        </Link>
        <div className="empty-panel">
          <div className="empty-icon">!</div>
          <h2>Could not load market</h2>
          <p className="muted">{err}</p>
          <div className="admin-actions" style={{ justifyContent: "center" }}>
            <button type="button" className="btn primary" onClick={load}>
              Retry
            </button>
            <Link to="/" className="btn ghost">
              {t("backMarkets")}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (!m || forceSkeleton) {
    return <TokenSkeleton t={t} />;
  }

  const canGrad = !isPool && (m.progressPct || 0) >= 100;
  const pct = Math.min(100, m.progressPct || 0);
  const watched = isWatched(watchlist, m.id, m.pkg);
  // Adena / Gnoswap: packagePath.SYMBOL — NEVER Token.ID with .seq (…SYMBOL.0000001)
  const adenaTokenPath = adenaPath(m);
  const fullTokenId = tokenIdFull(m);
  const gnotBal = Number(bal.gnot) || 0;
  const wugnotBal =
    bal.wugnot != null
      ? Number(bal.wugnot) / UGNOT_PER_GNOT
      : bal.wugnotGnot != null
        ? Number(bal.wugnotGnot)
        : 0;
  const tokenBal = Math.floor(Number(bal.tokens) || 0);
  const wugnotCurve = isWugnotCollateralPad(m.pkg || pkgQ || health?.pkg);
  /** Display unit for raise / price on WUGNOT pads (1 WUGNOT = 1 GNOT). */
  const raiseUnit = wugnotCurve ? "WUGNOT" : "GNOT";
  const gradGnot =
    Number(m.params?.graduationGnot) ||
    (Number(m.params?.graduation) || 0) / UGNOT_PER_GNOT ||
    500;
  const raisedG = Number(m.raisedGnot != null ? m.raisedGnot : (m.raised || 0) / UGNOT_PER_GNOT) || 0;
  const leftGnot =
    m.remainingRaiseGnot != null
      ? Number(m.remainingRaiseGnot)
      : isPool
        ? 0
        : Math.max(0, gradGnot - raisedG);
  const trades = mergedTrades;
  const holders = m.holders || [];
  const vol = m.tradeStats?.volumeGnot || 0;
  const img = resolveTokenImage(m, meta);
  const tw = twitterUrl(meta?.twitter);
  const tg = telegramUrl(meta?.telegram);
  const web = websiteUrl(meta?.website);
  // Price Δ% from full chart series (curve + post-list Gnoswap + local swaps)
  const chartPrices = [...(trades || [])]
    .filter((p) => Number(p.side) === 0 || Number(p.side) === 1)
    .sort((a, b) => (Number(a.timeMs) || Number(a.height) || 0) - (Number(b.timeMs) || Number(b.height) || 0))
    .map((p) => Number(p.priceGnot) || 0)
    .filter((x) => x > 0);
  let priceDelta = perfStats?.p24h != null && perfStats.p24h !== 0 ? perfStats.p24h : null;
  if (priceDelta == null && chartPrices.length >= 2 && chartPrices[0] > 0) {
    priceDelta =
      ((chartPrices[chartPrices.length - 1] - chartPrices[0]) / chartPrices[0]) * 100;
  }
  const volUsd =
    toUsd(vol, m.gnotUsd, m.tradeStats?.volumeUsd) ||
    (vol > 0 && m.gnotUsd > 0 ? vol * m.gnotUsd : vol > 0 ? vol * 235 : 0);
  const txCount = Number(m.tradeStats?.trades != null ? m.tradeStats.trades : trades?.length || 0);
  const mcapGnotNum = Number(m.mcapGnot || 0);
  const volGnotNum = Number(vol || 0);
  const milestones = [25, 50, 75, 100];
  const totalSupply = Number(m.params?.totalSupply) || 1e9;
  const curveSupply = Number(m.params?.curveSupply) || 8e8;
  const lpShare = Math.max(0, totalSupply - curveSupply);

  function setBuyPct(p) {
    if (gnotBal <= 0) return setAmountGnot("0");
    const v = (gnotBal * p) / 100;
    setAmountGnot(v >= 1 ? v.toFixed(4).replace(/\.?0+$/, "") : v.toFixed(6).replace(/\.?0+$/, ""));
  }

  function setBuyFixed(g) {
    setAmountGnot(String(g));
  }

  /** Gross GNOT needed to fill remaining raise (after fee), for one-click last fill. */
  function remainingFillGrossGnot() {
    if (!m || isPool) return 0;
    const thr = Number(m.params?.graduation) || 0;
    const remRaise =
      m.remainingRaiseUgnot != null
        ? Number(m.remainingRaiseUgnot)
        : thr > 0
          ? Math.max(0, thr - (Number(m.raised) || 0))
          : 0;
    if (remRaise <= 0) return 0;
    const gross = grossForRemainingRaise(remRaise, feeBps);
    return gross > 0 ? gross / UGNOT_PER_GNOT : 0;
  }

  function setBuyFillRemaining() {
    const g = remainingFillGrossGnot();
    if (g <= 0) return;
    // 6 decimals is enough for ugnot precision in input
    setAmountGnot(g >= 1 ? g.toFixed(6).replace(/\.?0+$/, "") : g.toFixed(6));
  }

  function setSellPct(p) {
    if (tokenBal <= 0) return setSellTokens("0");
    setSellTokens(String(Math.floor((tokenBal * p) / 100)));
  }

  function RaiseRibbon({ compact = false }) {
    return (
      <div className={`grad-fomo${pct >= 70 ? " hot" : ""}${canGrad ? " ready" : ""}${compact ? " compact" : ""}`}>
        <div className="grad-fomo-top">
          <span>
            {canGrad ? (
              <strong>{t("readyGraduate")}</strong>
            ) : (
              <>
                <strong>
                  {fmtGnot(leftGnot, { alreadyGnot: true })} {raiseUnit}
                </strong>
                <span className="muted"> {t("leftToGraduate")}</span>
              </>
            )}
          </span>
          <span className="mono">
            {fmtGnot(raisedG, { alreadyGnot: true })} / {fmtGnot(gradGnot, { alreadyGnot: true })}{" "}
            {raiseUnit}
          </span>
        </div>
        {wugnotCurve && !compact && (
          <div className="collateral-chip" title={t("wugnotBuyHint")}>
            <span className="badge curve">{t("wugnotBadge")}</span>
            <span className="muted">1 WUGNOT = 1 GNOT · pay GNOT, curve holds WUGNOT</span>
          </div>
        )}
        <div className="raise-track" aria-hidden>
          <ProgressBar pct={pct} />
          <div className="raise-milestones">
            {milestones.map((ms) => (
              <span
                key={ms}
                className={`raise-ms${pct >= ms ? " hit" : ""}${pct >= ms - 0.01 && pct < ms + 5 ? " near" : ""}`}
                style={{ left: `${ms}%` }}
                title={`${ms}%`}
              >
                <i />
                <em>{ms}%</em>
              </span>
            ))}
          </div>
        </div>
        <div className="grad-fomo-foot muted">
          <span>
            <strong className="raise-pct-num">{pct}%</strong> {t("filled")}
          </span>
          <span>
            {t("targetRaise")} {fmtGnot(gradGnot, { alreadyGnot: true })} {raiseUnit} → {t("poolGnoswap")}
          </span>
        </div>
        {canGrad && (
          <button
            type="button"
            className="btn primary"
            style={{ marginTop: "0.75rem" }}
            disabled={busy}
            onClick={onGraduate}
          >
            {t("graduateNow")}
          </button>
        )}
      </div>
    );
  }

  const listWNeed = Number(listNeed?.wNeedLp) || 0;
  const listGNeed = Number(listNeed?.gnsNeed) || 0;
  const listWrap = Number(listNeed?.wrapUgnot) || 0;

  const walletAddr = wallet?.address || "";
  const metaOwner = meta?.owner || "";
  const isMetaOwner = !!(walletAddr && metaOwner && walletAddr === metaOwner);
  const isCreator = !!(walletAddr && m.creator && walletAddr === m.creator);
  const noMetaYet = !metaOwner;
  // Creator claims first write; only meta owner may update after
  const canEditMeta = !!(metaPkg && walletAddr && (isMetaOwner || (noMetaYet && isCreator)));
  // Show for connected creator/owner (owner may update; creator claims first write)
  const showEditMetaBtn = !!(metaPkg && walletAddr && (canEditMeta || isCreator || isMetaOwner));

  return (
    <section className="view token-view terminal-view">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">{t("backMarkets")}</Link>
        <span className="breadcrumb-sep" aria-hidden>
          /
        </span>
        <span className="breadcrumb-current">
          ${m.symbol}
          {m.padLabel ? (
            <span className="faint"> · {m.padLabel}</span>
          ) : null}
        </span>
      </nav>

      {/* 1. TOP TERMINAL HEADER STRIP (Photon / BullX style) */}
      <div className="terminal-header-strip">
        <div className="ths-left">
          <TokenAvatar
            name={m.name}
            symbol={m.symbol}
            uri={img}
            seed={`${m.pkg}:${m.id}`}
            size="lg"
          />
          <div className="ths-identity">
            <div className="ths-title-row">
              <span className="ths-name">{m.name}</span>
              <span className="ths-symbol">${m.symbol}</span>
              <button
                type="button"
                className="ths-chip-copy"
                onClick={() => copy(m.id, "Launch ID")}
                title={`Copy ID: ${m.id}`}
              >
                <code>{m.id.length > 12 ? `${m.id.slice(0, 6)}…${m.id.slice(-4)}` : m.id}</code>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
              {isGnoswapListed(m) ? (
                <span className="ths-badge listed">{t("gnoswapBadge")}</span>
              ) : isPool ? (
                <span className="ths-badge graduated">{t("graduated")}</span>
              ) : (
                <span className={`ths-badge curve${pct >= 100 ? " ready" : ""}`}>
                  {pct >= 100 ? t("readyToList") : t("onCurve")}
                </span>
              )}
            </div>
            <div className="ths-sub-row">
              {(tw || tg || web) && (
                <div className="ths-socials">
                  {web && (
                    <a className="ths-icon-link" href={web} target="_blank" rel="noreferrer" title="Website">
                      🌐
                    </a>
                  )}
                  {tw && (
                    <a className="ths-icon-link" href={tw} target="_blank" rel="noreferrer" title="X / Twitter">
                      𝕏
                    </a>
                  )}
                  {tg && (
                    <a className="ths-icon-link" href={tg} target="_blank" rel="noreferrer" title="Telegram">
                      ✈
                    </a>
                  )}
                </div>
              )}
              <span className="ths-tag muted">
                PAD <code className="mono">{m.padLabel || m.pkg?.split("/").pop()}</code>
              </span>
              {m.created ? (
                <span className="ths-tag muted">BLOCK #{fmtNum(m.created)}</span>
              ) : null}
              <button
                type="button"
                className={`ths-watch-btn${watched ? " on" : ""}`}
                onClick={() => toggleWatch({ id: m.id, pkg: m.pkg, name: m.name, symbol: m.symbol })}
              >
                {watched ? `★ ${t("watch")}` : `☆ ${t("watch")}`}
              </button>
              <button type="button" className="ths-share-btn" onClick={shareX} title="Share on X">
                {t("share")}
              </button>
              {showEditMetaBtn && (
                <button
                  type="button"
                  className={`ths-edit-btn${editingMeta ? " on" : ""}`}
                  onClick={() => setEditingMeta((v) => !v)}
                >
                  {editingMeta ? t("cancel") : meta ? t("editLinks") : t("addLinks")}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right metrics row */}
        <div className="ths-metrics">
          <div className="ths-metric-item">
            <span className="ths-metric-label">{(t("price") || "PRICE").toUpperCase()}</span>
            <strong className="ths-metric-val mono">
              {fmtPriceUsd(toUsd(m.priceGnot, m.gnotUsd, m.priceUsd))}
            </strong>
            <span className={`ths-metric-sub ${priceDelta != null && priceDelta >= 0 ? "up" : priceDelta != null ? "down" : "faint mono"}`}>
              {priceDelta != null
                ? `${priceDelta >= 0 ? "▲ +" : "▼ "}${Math.abs(priceDelta).toFixed(1)}%`
                : Number(m.priceGnot) > 0
                  ? `${fmtPrice(m.priceGnot)} GNOT`
                  : "—"}
            </span>
          </div>

          <div className="ths-metric-item">
            <span className="ths-metric-label">{(t("mcap") || "MCAP").toUpperCase()}</span>
            <strong className="ths-metric-val mono">
              {fmtMcapUsd(toUsd(m.mcapGnot, m.gnotUsd, m.mcapUsd))}
            </strong>
            <span className="ths-metric-sub faint mono">
              {mcapGnotNum > 0
                ? `${mcapGnotNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GNOT FDV`
                : "FDV"}
            </span>
          </div>

          <div className="ths-metric-item">
            <span className="ths-metric-label">{(t("volume") || "VOLUME").toUpperCase()}</span>
            <strong className="ths-metric-val mono ths-vol-val">
              {volUsd > 0 ? fmtMcapUsd(volUsd) : "$0"}
            </strong>
            <span className="ths-metric-sub faint mono">
              {`${fmtNum(txCount)} tx · ${volGnotNum > 0 ? volGnotNum.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : "0.0000"} GNOT`}
              {m.volumeScope === "curve_only" ? " · curve only" : ""}
            </span>
          </div>

          <div className="ths-metric-item">
            <span className="ths-metric-label">{(isPool ? t("liquidity") : (t("targetRaise") || "TARGET RAISE")).toUpperCase()}</span>
            <strong className="ths-metric-val mono">
              {(() => {
                const liqG = Number(m.poolGnot) || (Number(m.poolUgnot) || 0) / UGNOT_PER_GNOT || 0;
                if (isPool || liqG > 0) {
                  if (liqG <= 0) return "—";
                  return m.gnotUsd > 0 ? fmtMcapUsd(liqG * m.gnotUsd) : `${fmtGnot(liqG, { alreadyGnot: true })} GNOT`;
                }
                return `${fmtGnot(gradGnot, { alreadyGnot: true })} ${raiseUnit}`;
              })()}
            </strong>
            <span className="ths-metric-sub faint mono">
              {isPool
                ? (Number(m.poolGnot) > 0 ? `${Number(m.poolGnot).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GNOT` : (t("poolReserves") || "Pool reserves"))
                : `${pct}% ${t("filled") || "filled"}`}
            </span>
          </div>

          <div className="ths-metric-item">
            <span className="ths-metric-label">{(t("totalSupply") || "TOTAL SUPPLY").toUpperCase()}</span>
            <strong className="ths-metric-val mono">{fmtNum(totalSupply)}</strong>
            <span className="ths-metric-sub faint mono">{m?.symbol || "FIXED"}</span>
          </div>
        </div>

        {/* Copy kit sub-bar */}
        {(adenaTokenPath || fullTokenId || m.pkg || m.id) && (
          <div className="ths-copy-bar">
            <div className="copy-row">
              {m.id && (
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => copy(m.id, "Token ID")}
                  title={`Token ID: ${m.id}`}
                >
                  {t("copyId") || "Copy id"}
                </button>
              )}
              {adenaTokenPath && (
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => copy(adenaTokenPath, "Adena / Gnoswap path")}
                  title={`Add custom token in Adena with this path:\n${adenaTokenPath}`}
                >
                  {t("copyAdenaPath") || "Copy Adena path"}
                </button>
              )}
              {fullTokenId && fullTokenId !== adenaTokenPath && (
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => copy(fullTokenId, "Token.ID (not for Adena)")}
                  title={`Token.ID (includes .seq) — do NOT paste into Adena:\n${fullTokenId}`}
                >
                  {t("copyTokenId") || "Copy Token.ID"}
                </button>
              )}
              {m.pkg && (
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => copy(m.pkg, "Pad package")}
                  title={m.pkg}
                >
                  {t("copyPad") || "Copy pad"}
                </button>
              )}
              {adenaTokenPath && (
                <a
                  className="btn sm primary gnoswap-swap-btn"
                  href={gnoswapSwapUrl(m)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Swap $${m?.symbol || ""} on Gnoswap DEX`}
                >
                  {t("gnoswapSwap") || "Swap on Gnoswap"} ↗
                </a>
              )}
            </div>
            {adenaTokenPath && (
              <div className="mono faint ths-adena-path">
                <span className="muted">Adena / Gnoswap: </span>
                {adenaTokenPath}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. MAIN 2-COLUMN TERMINAL LAYOUT */}
      <div className="token-layout terminal-layout">
        {/* Left Column: Chart + Lower Tabs */}
        <div className="token-main terminal-left-col">
          {/* Mobile tabs */}
          <div className="token-mobile-tabs" role="tablist" aria-label="Terminal">
            {!isPool && (
              <button
                type="button"
                role="tab"
                aria-selected={mobilePane === "raise"}
                className={`filter-btn${mobilePane === "raise" ? " active" : ""}`}
                onClick={() => setMobilePane("raise")}
              >
                {t("raiseTab")}
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={mobilePane === "chart"}
              className={`filter-btn${mobilePane === "chart" ? " active" : ""}`}
              onClick={() => setMobilePane("chart")}
            >
              {t("chart")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobilePane === "trade"}
              className={`filter-btn${mobilePane === "trade" ? " active" : ""}`}
              onClick={() => setMobilePane("trade")}
            >
              {t("trade")}
            </button>
          </div>

          {/* Chart container */}
          <div className="terminal-chart-box">
            <PriceChart
              points={trades}
              symbol={m.symbol}
              height={500}
              gnotUsd={m.gnotUsd}
              priceUsd={m.priceUsd}
            />
          </div>

          {/* Tabs bar & table */}
          <div className="terminal-tabs-box">
            <div className="terminal-tabs-bar">
              <div className="terminal-tabs-left">
                <button
                  type="button"
                  className={`tt-tab-btn${infoTab === "trades" ? " active" : ""}`}
                  onClick={() => setInfoTab("trades")}
                >
                  {t("trades")} <span className="tt-count">{trades.length}</span>
                </button>
                <button
                  type="button"
                  className={`tt-tab-btn${infoTab === "holders" ? " active" : ""}`}
                  onClick={() => setInfoTab("holders")}
                >
                  {m.holdersLabel || t("holders")}{" "}
                  <span className="tt-count">{holders.length}</span>
                </button>
                <button
                  type="button"
                  className={`tt-tab-btn${infoTab === "about" ? " active" : ""}`}
                  onClick={() => setInfoTab("about")}
                >
                  {t("about")}
                </button>
              </div>
              <div className="terminal-tabs-right">
                <span className="live-status-pill">
                  <i className="live-dot" /> LIVE
                </span>
              </div>
            </div>

            <div className="terminal-tab-content">
              {infoTab === "trades" ? (
                <TradesList trades={trades} limit={60} showSource gnotUsd={m.gnotUsd} />
              ) : infoTab === "holders" ? (
                <HoldersList
                  holders={holders}
                  symbol={m.symbol}
                  note={m.holdersNote}
                  totalSupply={totalSupply}
                  priceGnot={m.spotGnot ?? m.priceGnot}
                  openPriceGnot={m.openPriceGnot}
                  avgEntryGnot={m.avgEntryGnot}
                  pnlBasis={m.pnlBasis}
                  capped={m.holdersCapped}
                />
              ) : (
                <AboutPanel
                  m={m}
                  meta={meta}
                  totalSupply={totalSupply}
                  curveSupply={curveSupply}
                  lpShare={lpShare}
                  gradGnot={gradGnot}
                  feeBps={feeBps}
                  wugnotCurve={wugnotCurve}
                  raiseUnit={raiseUnit}
                  adenaTokenPath={adenaTokenPath}
                  fullTokenId={fullTokenId}
                  copy={copy}
                  t={t}
                />
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Performance Matrix + Swap Terminal + Your Position */}
        <div className="token-sidebar terminal-right-col">
          {/* Quick Performance Matrix */}
          <div className="panel perf-matrix-card">
            <div className="perf-matrix-grid">
              <div className="perf-time-cell">
                <span className="perf-k">5M</span>
                <b className={`mono ${perfStats.p5m >= 0 ? "up" : "down"}`}>
                  {perfStats.p5m >= 0 ? "+" : ""}{perfStats.p5m.toFixed(1)}%
                </b>
              </div>
              <div className="perf-time-cell">
                <span className="perf-k">1H</span>
                <b className={`mono ${perfStats.p1h >= 0 ? "up" : "down"}`}>
                  {perfStats.p1h >= 0 ? "+" : ""}{perfStats.p1h.toFixed(1)}%
                </b>
              </div>
              <div className="perf-time-cell">
                <span className="perf-k">6H</span>
                <b className={`mono ${perfStats.p6h >= 0 ? "up" : "down"}`}>
                  {perfStats.p6h >= 0 ? "+" : ""}{perfStats.p6h.toFixed(1)}%
                </b>
              </div>
              <div className="perf-time-cell">
                <span className="perf-k">24H</span>
                <b className={`mono ${perfStats.p24h >= 0 ? "up" : "down"}`}>
                  {perfStats.p24h >= 0 ? "+" : ""}{perfStats.p24h.toFixed(1)}%
                </b>
              </div>
            </div>
            <div className="perf-vol-row">
              <div className="perf-vol-item">
                <span className="perf-vol-k">{(t("vol24h") || "24H VOL").toUpperCase()}</span>
                <strong className="mono">
                  {m.gnotUsd > 0
                    ? fmtMcapUsd(perfStats.volGnot * m.gnotUsd)
                    : `${fmtGnot(perfStats.volGnot, { alreadyGnot: true })} GNOT`}
                </strong>
              </div>
              <div className="perf-vol-item">
                <span className="perf-vol-k">{(t("buys") || "BUYS").toUpperCase()}</span>
                <strong className="mono up">{perfStats.buys}</strong>
              </div>
              <div className="perf-vol-item">
                <span className="perf-vol-k">{(t("sells") || "SELLS").toUpperCase()}</span>
                <strong className="mono down">{perfStats.sells}</strong>
              </div>
              <div className="perf-vol-item">
                <span className="perf-vol-k">{(t("net24h") || "24H NET").toUpperCase()}</span>
                <strong className={`mono ${perfStats.netGnot >= 0 ? "up" : "down"}`}>
                  {perfStats.netGnot >= 0 ? "+" : ""}
                  {m.gnotUsd > 0
                    ? fmtMcapUsd(perfStats.netGnot * m.gnotUsd)
                    : `${fmtGnot(perfStats.netGnot, { alreadyGnot: true })} GNOT`}
                </strong>
              </div>
            </div>
          </div>

          {/* Edit Meta Form (if opened) */}
          {editingMeta && canEditMeta && (
            <form className="meta-edit-form panel" onSubmit={onSaveMeta} style={{ marginBottom: "0.85rem" }}>
              <div className="meta-edit-head">
                <strong>{meta ? t("editLinks") : t("addLinks")}</strong>
                <span className="muted faint">{t("metaEditHint")}</span>
              </div>
              <div className="token-icon-kit compact">
                <div className="token-icon-kit-preview">
                  <TokenAvatar
                    name={m.name}
                    symbol={m.symbol}
                    uri={metaForm.imageURI || img}
                    seed={`${m.pkg}:${m.id}`}
                    size="md"
                  />
                  <div className="token-icon-kit-copy">
                    <strong>{t("tokenIcon")}</strong>
                    <p className="muted faint" style={{ fontSize: "0.78rem", margin: 0 }}>
                      {t("metaEditHint")}
                    </p>
                  </div>
                </div>
                <div className="token-icon-kit-actions">
                  <button type="button" className="btn sm ghost" onClick={copyIconKit}>
                    {t("copyIconKit")}
                  </button>
                  <a
                    className="btn sm ghost"
                    href={GNO_TOKEN_RESOURCE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("gnoswapLogoPr")} ↗
                  </a>
                </div>
              </div>
              <label>
                {t("description")}
                <input
                  value={metaForm.description}
                  onChange={(e) =>
                    setMetaForm((f) => ({ ...f, description: e.target.value }))
                  }
                  maxLength={500}
                  placeholder={t("descriptionPh")}
                />
              </label>
              <label>
                {t("imageUrl")}
                <input
                  value={metaForm.imageURI}
                  onChange={(e) =>
                    setMetaForm((f) => ({ ...f, imageURI: e.target.value }))
                  }
                  placeholder="https://… or ipfs://…"
                />
              </label>
              <div className="create-social-grid meta-edit-grid">
                <label>
                  Website
                  <input
                    value={metaForm.website}
                    onChange={(e) =>
                      setMetaForm((f) => ({ ...f, website: e.target.value }))
                    }
                    placeholder="https://"
                  />
                </label>
                <label>
                  X / Twitter
                  <input
                    value={metaForm.twitter}
                    onChange={(e) =>
                      setMetaForm((f) => ({ ...f, twitter: e.target.value }))
                    }
                    placeholder="@handle"
                  />
                </label>
                <label>
                  Telegram
                  <input
                    value={metaForm.telegram}
                    onChange={(e) =>
                      setMetaForm((f) => ({ ...f, telegram: e.target.value }))
                    }
                    placeholder="@channel"
                  />
                </label>
              </div>
              <div className="meta-edit-actions">
                <button
                  type="submit"
                  className="btn primary sm"
                  disabled={metaBusy || !wallet?.canSign}
                >
                  {metaBusy ? t("signing") : t("saveMeta")}
                </button>
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={metaBusy}
                  onClick={() => setEditingMeta(false)}
                >
                  {t("cancel")}
                </button>
              </div>
            </form>
          )}

          {/* Swap / Order Execution Box */}
          <div className={`panel trade-panel trade-panel-terminal side-${side}${wugnotCurve ? " wugnot-curve" : ""}${isGnoswapListed(m) ? " gnoswap-live" : ""}`}>
            {/* Big Buy / Sell switcher */}
            <div className="terminal-trade-tabs">
              <button
                type="button"
                className={`tt-switch-btn buy${side === "buy" ? " active" : ""}`}
                onClick={() => setSide("buy")}
              >
                {t("buy")}
              </button>
              <button
                type="button"
                className={`tt-switch-btn sell${side === "sell" ? " active" : ""}`}
                onClick={() => setSide("sell")}
              >
                {t("sell")}
              </button>
            </div>

            {/* Sub-modes: Market, Limit, DCA */}
            <div className="terminal-order-types">
              <button type="button" className="tot-btn active">{t("market") || "Market"}</button>
              <button type="button" className="tot-btn disabled" title="Coming soon">{t("limit") || "Limit"} <span className="tot-soon">{t("soon") || "SOON"}</span></button>
              <button type="button" className="tot-btn disabled" title="Coming soon">{t("dca") || "DCA"} <span className="tot-soon">{t("soon") || "SOON"}</span></button>
            </div>

            {/* Wallet balances summary */}
            {wallet?.address && (
              <div className="wallet-bals-terminal">
                <span className="wbt-item">
                  <i className="muted">Bal:</i> <b className="mono">{fmtGnot(gnotBal, { alreadyGnot: true })} GNOT</b>
                </span>
                {(wugnotCurve || wugnotBal > 0) && (
                  <span className="wbt-item">
                    <b className="mono muted">{fmtGnot(wugnotBal, { alreadyGnot: true })} WUGNOT</b>
                  </span>
                )}
                {tokenBal > 0 && (
                  <span className="wbt-item">
                    <b className="mono muted">{fmtNum(tokenBal)} ${m.symbol}</b>
                  </span>
                )}
              </div>
            )}

            {side === "buy" ? (
              <form onSubmit={onBuy} className="trade-form terminal-trade-form">
                <div className="trade-field terminal-field">
                  <div className="trade-field-top">
                    <label htmlFor="buy-amount" className="terminal-label">
                      {wugnotCurve ? (t("amountPayGnot") || "YOU PAY (GNOT → WUGNOT)").toUpperCase() : (t("amountGnot") || "YOU PAY (GNOT)").toUpperCase()}
                    </label>
                    <div className="trade-bal-stack">
                      <button
                        type="button"
                        className="trade-bal-link mono"
                        onClick={() => setBuyPct(100)}
                        title="Use max GNOT balance"
                      >
                        {fmtGnot(gnotBal, { alreadyGnot: true })} GNOT
                      </button>
                      {wugnotCurve && (
                        <span className="trade-bal-sub mono muted" title={t("wugnotBalance")}>
                          {fmtGnot(wugnotBal, { alreadyGnot: true })} WUGNOT
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="trade-input-wrap terminal-input-wrap">
                    <input
                      id="buy-amount"
                      type="text"
                      inputMode="decimal"
                      value={amountGnot}
                      onChange={(e) => setAmountGnot(e.target.value)}
                      placeholder="0.0"
                      autoComplete="off"
                    />
                    <span className={`trade-input-suffix mono${wugnotCurve ? " wugnot-suffix" : ""}`}>
                      {wugnotCurve ? "GNOT → WUGNOT" : "GNOT"}
                    </span>
                  </div>
                  {Number(amountGnot) > 0 && m.gnotUsd > 0 && (
                    <div className="trade-sub-value muted mono">
                      ≈ ${((Number(amountGnot) || 0) * m.gnotUsd).toFixed(2)} USD
                    </div>
                  )}
                </div>

                {/* Quick Fixed Amounts */}
                <div className="quick-chips-grid">
                  {[0.1, 1, 10].map((g) => (
                    <button
                      key={g}
                      type="button"
                      className={`quick-chip${String(amountGnot) === String(g) ? " active" : ""}`}
                      onClick={() => setBuyFixed(g)}
                    >
                      {g}
                    </button>
                  ))}
                  <button type="button" className="quick-chip" onClick={() => setBuyPct(100)}>
                    {t("max") || "Max"}
                  </button>
                </div>

                {/* Percentage Row */}
                <div className="quick-chips-grid pct-row">
                  {[25, 50, 75, 100].map((p) => (
                    <button key={p} type="button" className="quick-chip pct" onClick={() => setBuyPct(p)}>
                      {p === 100 ? (t("max") || "Max") : `${p}%`}
                    </button>
                  ))}
                </div>

                {wugnotCurve && !isPool && remainingFillGrossGnot() > 0 && leftGnot > 0 && (
                  <button
                    type="button"
                    className="btn sm primary fill-remaining-btn block"
                    onClick={() => setBuyFillRemaining()}
                  >
                    {t("fillRemaining") || "Fill Remaining"}: ~{fmtCompact(remainingFillGrossGnot())} GNOT
                  </button>
                )}

                <div className="terminal-settings-row">
                  <SlippageSelect value={slipBps} onChange={setSlipBps} label={(t("maxSlip") || "SLIPPAGE").toUpperCase()} />
                  <div className="terminal-fee-pill">
                    <span className="muted">{(t("fee") || "FEE").toUpperCase()}:</span> <b>{(feeBps / 100).toFixed(1)}%</b>
                  </div>
                </div>

                <QuoteBox
                  side="buy"
                  isPool={isPool}
                  feeBps={feeBps}
                  buyQuote={buyQuote}
                  symbol={m.symbol}
                  wugnotCurve={wugnotCurve}
                  t={t}
                />

                <button
                  type={!wallet ? "button" : "submit"}
                  onClick={!wallet ? connect : undefined}
                  className={`btn trade-submit ${!wallet ? "primary connect-btn" : "buy"} lg block terminal-action-btn`}
                  disabled={busy || isConnecting}
                >
                  {busy ? (
                    t("signing")
                  ) : isConnecting ? (
                    <>
                      <svg
                        className="spin-icon"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ animation: "spin 1s linear infinite" }}
                        aria-hidden="true"
                      >
                        <line x1="12" y1="2" x2="12" y2="6" />
                        <line x1="12" y1="18" x2="12" y2="22" />
                        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                        <line x1="2" y1="12" x2="6" y2="12" />
                        <line x1="18" y1="12" x2="22" y2="12" />
                        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                      </svg>
                      <span>{t("connecting") || "Connecting..."}</span>
                    </>
                  ) : !wallet ? (
                    <>
                      <svg
                        className="wallet-icon"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
                        <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
                      </svg>
                      <span>{t("connect") || "Connect Wallet"}</span>
                    </>
                  ) : isGnoswapListed(m) ? (
                    `${t("buy")} $${m.symbol} ${t("onGnoswap") || "on Gnoswap"}`
                  ) : (
                    `${t("buy")} $${m.symbol}`
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={onSell} className="trade-form terminal-trade-form">
                <div className="trade-field terminal-field">
                  <div className="trade-field-top">
                    <label htmlFor="sell-amount" className="terminal-label">
                      {(t("tokensToSell") || "TOKENS TO SELL").toUpperCase()}
                    </label>
                    <div className="trade-bal-stack">
                      <button
                        type="button"
                        className="trade-bal-link mono"
                        onClick={() => setSellPct(100)}
                        title="Use max token balance"
                      >
                        {fmtNum(tokenBal)} ${m.symbol}
                      </button>
                    </div>
                  </div>
                  <div className="trade-input-wrap terminal-input-wrap">
                    <input
                      id="sell-amount"
                      type="text"
                      inputMode="numeric"
                      value={sellTokens}
                      onChange={(e) => setSellTokens(e.target.value)}
                      placeholder="0"
                      autoComplete="off"
                    />
                    <span className="trade-input-suffix mono">${m.symbol}</span>
                  </div>
                </div>

                {/* Percentage Row */}
                <div className="quick-chips-grid pct-row">
                  {[25, 50, 75, 100].map((p) => (
                    <button key={p} type="button" className="quick-chip pct" onClick={() => setSellPct(p)}>
                      {p === 100 ? (t("max") || "Max") : `${p}%`}
                    </button>
                  ))}
                </div>

                <div className="terminal-settings-row">
                  <SlippageSelect value={slipBps} onChange={setSlipBps} label={(t("maxSlip") || "SLIPPAGE").toUpperCase()} />
                  <div className="terminal-fee-pill">
                    <span className="muted">{(t("fee") || "FEE").toUpperCase()}:</span> <b>{(feeBps / 100).toFixed(1)}%</b>
                  </div>
                </div>

                <QuoteBox
                  side="sell"
                  isPool={isPool}
                  feeBps={feeBps}
                  sellQuote={sellQuote}
                  symbol={m.symbol}
                  wugnotCurve={wugnotCurve}
                  t={t}
                />

                <button
                  type={!wallet ? "button" : "submit"}
                  onClick={!wallet ? connect : undefined}
                  className={`btn trade-submit ${!wallet ? "primary connect-btn" : "sell"} lg block terminal-action-btn`}
                  disabled={busy || isConnecting}
                >
                  {busy ? (
                    t("signing")
                  ) : isConnecting ? (
                    <>
                      <svg
                        className="spin-icon"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ animation: "spin 1s linear infinite" }}
                        aria-hidden="true"
                      >
                        <line x1="12" y1="2" x2="12" y2="6" />
                        <line x1="12" y1="18" x2="12" y2="22" />
                        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                        <line x1="2" y1="12" x2="6" y2="12" />
                        <line x1="18" y1="12" x2="22" y2="12" />
                        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                      </svg>
                      <span>{t("connecting") || "Connecting..."}</span>
                    </>
                  ) : !wallet ? (
                    <>
                      <svg
                        className="wallet-icon"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
                        <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
                      </svg>
                      <span>{t("connect") || "Connect Wallet"}</span>
                    </>
                  ) : isGnoswapListed(m) ? (
                    `${t("sell")} $${m.symbol} ${t("onGnoswap") || "on Gnoswap"}`
                  ) : (
                    `${t("sell")} $${m.symbol}`
                  )}
                </button>
              </form>
            )}

            <div className="terminal-route-foot faint mono">
              <span>{(t("estGas") || "EST. GAS").toUpperCase()}: ~0.002 GNOT</span>
              <span>{(t("route") || "ROUTE").toUpperCase()}: {isGnoswapListed(m) ? "GNOSWAP" : "CURVE"}</span>
            </div>
          </div>

          {/* User Position Card hidden as requested */}
          {false && (
            <div className="panel position-card">
              <div className="position-card-head">
                <span className="pos-title">{(t("yourPosition") || "YOUR POSITION").toUpperCase()}</span>
                <span className="pos-status mono faint">
                  {walletAddr ? `${walletAddr.slice(0, 6)}…${walletAddr.slice(-4)}` : (t("notConnected") || "NOT CONNECTED").toUpperCase()}
                </span>
              </div>
              <div className="position-grid">
                <div className="pos-item">
                  <span className="pos-k">{(t("bought") || "BOUGHT").toUpperCase()}</span>
                  <strong className="mono">
                    {userPos && userPos.bought > 0 ? `${fmtGnot(userPos.bought, { alreadyGnot: true })} GNOT` : "0 GNOT"}
                  </strong>
                </div>
                <div className="pos-item">
                  <span className="pos-k">{(t("sold") || "SOLD").toUpperCase()}</span>
                  <strong className="mono">
                    {userPos && userPos.sold > 0 ? `${fmtGnot(userPos.sold, { alreadyGnot: true })} GNOT` : "0 GNOT"}
                  </strong>
                </div>
                <div className="pos-item">
                  <span className="pos-k">{(t("holding") || "HOLDING").toUpperCase()}</span>
                  <strong className="mono">
                    {fmtNum(tokenBal)} ${m.symbol}
                  </strong>
                </div>
                <div className="pos-item">
                  <span className="pos-k">{(t("pnl") || "PNL").toUpperCase()}</span>
                  <strong className={`mono ${userPos && userPos.pnlPct >= 0 ? "up" : "down"}`}>
                    {userPos && (userPos.bought > 0 || userPos.sold > 0 || tokenBal > 0)
                      ? `${userPos.pnlPct >= 0 ? "+" : ""}${userPos.pnlPct.toFixed(1)}%`
                      : "+0%"}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* Bonding curve status / graduate action if on curve */}
          {!isPool && (
            <div className="panel raise-panel" style={{ marginTop: "0.85rem" }}>
              <h2 className="panel-title">{t("raiseProgress")}</h2>
              <RaiseRibbon />
            </div>
          )}

          {/* Internal CPMM checklist if needed */}
          {isPool && !m.gnoswapListed && (
            <div className="grad-fomo ready list-checklist-panel" style={{ marginTop: "0.85rem" }}>
              <div className="grad-fomo-top">
                <span>
                  <strong>{t("internalCpmm")}</strong>
                  <span className="muted"> - {t("notOnGnoswap")}</span>
                </span>
              </div>
              <p className="list-checklist-title">{t("listChecklist")}</p>
              <button
                type="button"
                className="btn primary block"
                style={{ marginTop: "0.65rem" }}
                disabled={busy}
                onClick={onRetryListGnoswap}
              >
                {t("listGnoswap")}
              </button>
            </div>
          )}

          {/* Copy Adena / Token path kit
          {(adenaTokenPath || fullTokenId || m.pkg || m.id) && (
            <div className="copy-kit-panel" style={{ marginTop: "0.85rem" }}>
              <div className="copy-row">
                {m.id && (
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => copy(m.id, "Token ID")}
                    title={`Token ID: ${m.id}`}
                  >
                    Copy id
                  </button>
                )}
                {adenaTokenPath && (
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => copy(adenaTokenPath, "Adena / Gnoswap path")}
                    title={`Add custom token in Adena with this path:\n${adenaTokenPath}`}
                  >
                    Copy Adena path
                  </button>
                )}
                {fullTokenId && fullTokenId !== adenaTokenPath && (
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => copy(fullTokenId, "Token.ID (not for Adena)")}
                    title={`Token.ID (includes .seq) — do NOT paste into Adena:\n${fullTokenId}`}
                  >
                    Copy Token.ID
                  </button>
                )}
                {m.pkg && (
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => copy(m.pkg, "Pad package")}
                    title={m.pkg}
                  >
                    Copy pad
                  </button>
                )}
                {adenaTokenPath && (
                  <a
                    className="btn sm primary gnoswap-swap-btn"
                    href={gnoswapSwapUrl(m)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Swap $${m?.symbol || ""} on Gnoswap DEX`}
                  >
                    Swap on Gnoswap ↗
                  </a>
                )}
              </div>
              {adenaTokenPath && (
                <div
                  className="mono faint"
                  style={{
                    fontSize: "0.68rem",
                    marginTop: "0.45rem",
                    wordBreak: "break-all",
                    lineHeight: 1.35,
                  }}
                >
                  <span className="muted">Adena / Gnoswap: </span>
                  {adenaTokenPath}
                </div>
              )}
            </div>
          )}
             */}
        </div>
      </div>
    </section>
  );
}

function SlippageSelect({ value, onChange, label = "Max slippage" }) {
  return (
    <label className="slip-label">
      {label}
      <select
        className="sort-select"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ marginTop: "0.35rem", width: "100%" }}
      >
        <option value={50}>0.5%</option>
        <option value={100}>1%</option>
        <option value={200}>2%</option>
        <option value={500}>5%</option>
      </select>
    </label>
  );
}

function HoldersList({
  holders,
  symbol,
  note,
  totalSupply = 1e9,
  priceGnot = 0,
  openPriceGnot = null,
  avgEntryGnot = null,
  pnlBasis = null,
  capped = false,
}) {
  const { showToast } = useApp();
  if (!holders?.length) {
    return (
      <div className="trades-empty muted">
        {note || "No holders listed (or pad does not expose ListBuyers)"}
      </div>
    );
  }

  const supply = Number(totalSupply) || 1e9;
  const px = Number(priceGnot) || 0;
  // Prefer market VWAP entry from API; fallback open price
  const entryPx =
    avgEntryGnot != null && Number(avgEntryGnot) > 0
      ? Number(avgEntryGnot)
      : openPriceGnot != null && Number(openPriceGnot) > 0
        ? Number(openPriceGnot)
        : null;

  async function copyAddr(addr) {
    try {
      await copyText(addr);
      showToast("Address copied");
    } catch {
      showToast("Copy failed", false);
    }
  }

  return (
    <div className="holders-panel">
      {note ? (
        <p className="holders-note muted" style={{ fontSize: "0.78rem", marginBottom: "0.55rem" }}>
          {note}
        </p>
      ) : null}
      {entryPx != null && px > 0 && (
        <div className="holders-basis muted" style={{ fontSize: "0.78rem", marginBottom: "0.55rem" }}>
          Spot <strong className="mono">{fmtPrice(px)}</strong> GNOT/token · Entry (VWAP buys){" "}
          <strong className="mono">{fmtPrice(entryPx)}</strong>
          {pnlBasis ? ` · basis=${pnlBasis}` : ""}
        </div>
      )}
      <div className="trades-list holders-list holders-list-pro holders-with-tx">
        <div className="holders-head" aria-hidden>
          <span>User</span>
          <span>Position</span>
          <span>Value</span>
          <span>PnL</span>
          <span>% Supply</span>
          <span>Onchain</span>
        </div>
        {holders.map((h) => {
          const bal = Number(h.balance) || 0;
          const spot = h.spotGnot != null ? Number(h.spotGnot) : px;
          const value =
            h.valueGnot != null
              ? Number(h.valueGnot)
              : spot > 0
                ? bal * spot
                : 0;
          const pct =
            h.pctSupply != null
              ? Number(h.pctSupply)
              : supply > 0
                ? (bal / supply) * 100
                : 0;
          const entry = h.entryGnot != null ? Number(h.entryGnot) : entryPx;
          let pnl = h.pnlGnot;
          let pnlPct = h.pnlPct;
          if ((pnl == null || !Number.isFinite(Number(pnl))) && entry != null && entry > 0 && spot > 0) {
            const cost = bal * entry;
            pnl = value - cost;
            pnlPct = ((spot - entry) / entry) * 100;
          }
          const pnlUp = pnl != null && pnl >= 0;
          const acctUrl = accountExplorerUrl(h.address);
          return (
            <div key={h.address} className="holder-row-pro">
              <div className="holder-user">
                <CreatorChip address={h.address} className="holder-name" />
                <button
                  type="button"
                  className="mono holder-addr-sub"
                  title={`${h.address} · click to copy`}
                  onClick={() => copyAddr(h.address)}
                >
                  {shortAddr(h.address, 5)}
                </button>
              </div>
              <div className="holder-pos mono">
                <strong>{fmtNum(bal)}</strong>
                <span className="muted"> ${symbol}</span>
              </div>
              <div className="holder-val mono">
                {fmtGnot(value, { alreadyGnot: true })}
                <span className="trade-unit"> GNOT</span>
              </div>
              <div className={`holder-pnl mono ${pnl == null ? "" : pnlUp ? "up" : "down"}`}>
                {pnl == null || !Number.isFinite(Number(pnl)) ? (
                  "—"
                ) : (
                  <>
                    <strong>{fmtPnl(pnl)}</strong>
                    {pnlPct != null && Number.isFinite(pnlPct) && (
                      <span className="holder-pnl-pct">
                        {pnlPct >= 0 ? "+" : ""}
                        {pnlPct.toFixed(1)}%
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="holder-supply mono">
                <strong>{pct >= 0.01 ? `${pct.toFixed(2)}%` : "<0.01%"}</strong>
                <span className="holder-supply-bar" aria-hidden>
                  <i style={{ width: `${Math.min(100, Math.max(0.5, pct))}%` }} />
                </span>
              </div>
              <div className="holder-tx">
                {acctUrl ? (
                  <a
                    className="tx-link mono is-account"
                    href={acctUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${h.address} · open on Gnoscan`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="tx-link-label">{shortAddr(h.address, 4)}</span>
                    <span className="tx-link-ext" aria-hidden>
                      ↗
                    </span>
                  </a>
                ) : (
                  <span className="faint">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="holders-note muted">
        PnL = value − balance × market VWAP of curve buys (shared entry; not personal cost basis)
        {capped ? " · list may be capped" : ""}
        {" · "}Onchain opens the wallet on Gnoscan
      </p>
    </div>
  );
}

function AboutPanel({
  m,
  meta,
  totalSupply,
  curveSupply,
  lpShare,
  gradGnot,
  feeBps,
  wugnotCurve = false,
  raiseUnit = "GNOT",
  adenaTokenPath = "",
  fullTokenId = "",
  copy = () => {},
  t,
}) {
  const curvePct = totalSupply > 0 ? Math.round((curveSupply / totalSupply) * 100) : 80;
  const lpPct = totalSupply > 0 ? Math.round((lpShare / totalSupply) * 100) : 20;
  return (
    <div className="about-panel">
      {meta?.description ? (
        <p className="about-desc">{meta.description}</p>
      ) : (
        <p className="muted about-desc">
          {t("aboutFallback")}
        </p>
      )}
      {wugnotCurve && (
        <div className="callout wugnot-callout" style={{ marginBottom: "0.85rem" }}>
          <div className="wugnot-callout-top">
            <span className="badge curve">{t("wugnotBadge")}</span>
          </div>
          <p className="wugnot-callout-body">{t("wugnotBuyHint")}</p>
        </div>
      )}
      <h3 className="about-h">{t("tokenomics")}</h3>
      <div className="tokenomics-grid">
        <div className="tok-row">
          <span>{t("totalSupply")}</span>
          <strong className="mono">{fmtNum(totalSupply)}</strong>
        </div>
        <div className="tok-row">
          <span>{t("curveSupply")}</span>
          <strong className="mono">
            {fmtNum(curveSupply)} · {curvePct}%
          </strong>
        </div>
        <div className="tok-row">
          <span>{t("lpSeed")}</span>
          <strong className="mono">
            {fmtNum(lpShare)} · {lpPct}%
          </strong>
        </div>
        <div className="tok-row">
          <span>{t("collateral")}</span>
          <strong className="mono">
            {wugnotCurve ? t("collateralWugnot") : t("collateralUgnot")}
          </strong>
        </div>
        <div className="tok-row">
          <span>{t("targetRaise")}</span>
          <strong className="mono">
            {fmtGnot(gradGnot, { alreadyGnot: true })} {raiseUnit}
          </strong>
        </div>
        <div className="tok-row">
          <span>{t("tradeFee")}</span>
          <strong className="mono">{(feeBps / 100).toFixed(2)}%</strong>
        </div>
        <div className="tok-row">
          <span>{t("status")}</span>
          <strong>
            {m.status === 1
              ? m.gnoswapListed
                ? t("gnoswapListed")
                : t("graduated")
              : t("onCurve")}
          </strong>
        </div>
      </div>
      <div className="tokenomics-bar" aria-hidden>
        <i className="curve" style={{ width: `${curvePct}%` }} title={`Curve ${curvePct}%`} />
        <i className="lp" style={{ width: `${lpPct}%` }} title={`LP ${lpPct}%`} />
      </div>
      <div className="tokenomics-legend muted">
        <span>
          <i className="dot curve" /> {t("curveSupply")} {curvePct}%
        </span>
        <span>
          <i className="dot lp" /> {t("lpSeed")} {lpPct}%
        </span>
      </div>
    </div>
  );
}

function QuoteBox({
  side,
  isPool,
  feeBps,
  buyQuote,
  sellQuote,
  symbol,
  wugnotCurve = false,
  t = (k) => k,
}) {
  const payUnit = wugnotCurve ? "GNOT → WUGNOT" : "GNOT";
  const raiseUnit = wugnotCurve ? "WUGNOT" : "GNOT";
  const outUnit = wugnotCurve ? "WUGNOT" : "GNOT";
  if (side === "buy") {
    if (!buyQuote) {
      return <div className="quote-box muted">{t("enterAmount")}</div>;
    }
    if (isPool || buyQuote.pool) {
      const feeG = (buyQuote.fee?.fee || 0) / UGNOT_PER_GNOT;
      return (
        <div className="quote-box">
          <div className="quote-row">
            <span>{t("youPay")}</span>
            <strong>
              {fmtGnot(buyQuote.ugIn / UGNOT_PER_GNOT, { alreadyGnot: true })} {payUnit}
            </strong>
          </div>
          <div className="quote-row">
            <span>
              {t("fee")} ({(feeBps / 100).toFixed(2)}%)
            </span>
            <span>
              {fmtGnot(feeG, { alreadyGnot: true })} {raiseUnit}
            </span>
          </div>
          <div className="quote-row accent">
            <span>{t("youReceive")}</span>
            <strong>
              {buyQuote.loading
                ? t("quoting")
                : buyQuote.tokensOut != null
                  ? `${fmtNum(buyQuote.tokensOut)} $${symbol}`
                  : buyQuote.poolError
                    ? t("quoteFailed")
                    : "—"}
            </strong>
          </div>
          {buyQuote.minOut > 0 && (
            <div className="quote-row">
              <span>{t("minOut")}</span>
              <span className="mono">{fmtNum(buyQuote.minOut)}</span>
            </div>
          )}
          {buyQuote.poolError && (
            <div className="quote-row">
              <span className="warn-text" style={{ fontSize: "0.75rem" }}>
                {String(buyQuote.poolError).slice(0, 80)}
              </span>
            </div>
          )}
          <div className="quote-row">
            <span className="faint" style={{ fontSize: "0.72rem" }}>
              Gnoswap DrySwap · EXACT_IN
            </span>
          </div>
        </div>
      );
    }
    if (!buyQuote.ok) {
      return <div className="quote-box err">{t("cannotQuote")}</div>;
    }
    const feeG = (buyQuote.fee?.fee || 0) / UGNOT_PER_GNOT;
    return (
      <div className="quote-box">
        <div className="quote-row">
          <span>{t("youPay")}</span>
          <strong>
            {fmtGnot(buyQuote.ugIn / UGNOT_PER_GNOT, { alreadyGnot: true })} {payUnit}
          </strong>
        </div>
        {wugnotCurve && (
          <div className="quote-row">
            <span className="faint" style={{ fontSize: "0.72rem" }}>
              {t("payAsWugnot")}
            </span>
          </div>
        )}
        <div className="quote-row">
          <span>
            {t("fee")} ({(feeBps / 100).toFixed(2)}%)
          </span>
          <span>
            {fmtGnot(feeG, { alreadyGnot: true })} {raiseUnit}
          </span>
        </div>
        <div className="quote-row accent">
          <span>{t("youReceive")}</span>
          <strong>
            {fmtNum(buyQuote.tokensOut)} ${symbol}
          </strong>
        </div>
        {buyQuote.raiseContribGnot > 0 && (
          <div className="quote-row raise-contrib">
            <span>{t("raiseContrib")}</span>
            <strong className="mono">
              +{fmtGnot(buyQuote.raiseContribGnot, { alreadyGnot: true })} {raiseUnit}
              {buyQuote.raiseContribPct > 0
                ? ` · +${buyQuote.raiseContribPct < 0.1 ? "<0.1" : buyQuote.raiseContribPct.toFixed(1)}%`
                : ""}
            </strong>
          </div>
        )}
        {buyQuote.progressAfter != null && (
          <div className="quote-row">
            <span>{t("progressAfter")}</span>
            <span className="mono">{buyQuote.progressAfter}%</span>
          </div>
        )}
        <div className="quote-row">
          <span>{t("minOut")}</span>
          <span className="mono">{fmtNum(buyQuote.minOut)}</span>
        </div>
        <div className="quote-row">
          <span>{t("priceImpact")}</span>
          <span className={buyQuote.priceImpactPct > 5 ? "warn-text" : ""}>
            {buyQuote.priceImpactPct != null ? `${buyQuote.priceImpactPct.toFixed(2)}%` : "—"}
          </span>
        </div>
        {buyQuote.raiseCapped && (
          <div className="quote-row">
            <span className="warn-text" style={{ fontSize: "0.75rem" }}>
              {t("lastFillNote")} ~
              {fmtGnot(buyQuote.remainingRaiseGnot, { alreadyGnot: true })} {raiseUnit}.
              {buyQuote.refundUgnot > 0
                ? ` ${t("estRefund")} ~${fmtGnot(buyQuote.refundUgnot / 1e6, { alreadyGnot: true })} ${raiseUnit}.`
                : ""}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (!sellQuote) {
    return <div className="quote-box muted">Enter tokens to see quote</div>;
  }
  if (isPool || sellQuote.pool) {
    const outG =
      sellQuote.ugnotOut != null ? Number(sellQuote.ugnotOut) / UGNOT_PER_GNOT : null;
    return (
      <div className="quote-box">
        <div className="quote-row">
          <span>You sell</span>
          <strong>
            {fmtNum(sellQuote.tokensIn)} ${symbol}
          </strong>
        </div>
        <div className="quote-row accent">
          <span>You receive</span>
          <strong>
            {sellQuote.loading
              ? "Quoting…"
              : outG != null
                ? `${fmtGnot(outG, { alreadyGnot: true })} ${outUnit}`
                : sellQuote.poolError
                  ? "Quote failed"
                  : "—"}
          </strong>
        </div>
        {sellQuote.poolError && (
          <div className="quote-row">
            <span className="warn-text" style={{ fontSize: "0.75rem" }}>
              {String(sellQuote.poolError).slice(0, 80)}
            </span>
          </div>
        )}
      </div>
    );
  }
  if (!sellQuote.ok) {
    return <div className="quote-box err">Cannot quote this size</div>;
  }
  const outG = (sellQuote.ugnotOut || 0) / UGNOT_PER_GNOT;
  const feeG = (sellQuote.fee?.fee || 0) / UGNOT_PER_GNOT;
  return (
    <div className="quote-box">
      <div className="quote-row">
        <span>You sell</span>
        <strong>
          {fmtNum(sellQuote.tokensIn)} ${symbol}
        </strong>
      </div>
      <div className="quote-row">
        <span>Fee ({(feeBps / 100).toFixed(2)}%)</span>
        <span>
          {fmtGnot(feeG, { alreadyGnot: true })} {outUnit}
        </span>
      </div>
      <div className="quote-row accent">
        <span>You receive</span>
        <strong>
          {fmtGnot(outG, { alreadyGnot: true })} {outUnit}
        </strong>
      </div>
      <div className="quote-row">
        <span>Price impact</span>
        <span className={sellQuote.priceImpactPct > 5 ? "warn-text" : ""}>
          {sellQuote.priceImpactPct != null ? `${sellQuote.priceImpactPct.toFixed(2)}%` : "—"}
        </span>
      </div>
    </div>
  );
}

export function TokenSkeleton({ t = (k) => k }) {
  return (
    <section className="view token-view terminal-view token-view-skeleton" aria-busy="true" aria-label="Loading token details">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">{t("backMarkets")}</Link>
        <span className="breadcrumb-sep" aria-hidden>/</span>
        <span className="breadcrumb-current">
          <span className="token-skel-shimmer" style={{ width: 72, height: 14 }} />
        </span>
      </nav>

      {/* 1. TOP TERMINAL HEADER STRIP */}
      <div className="terminal-header-strip">
        <div className="ths-left">
          <div
            className="token-skel-shimmer"
            style={{ width: 48, height: 48, borderRadius: "50%", flexShrink: 0 }}
          />
          <div className="ths-identity">
            <div className="ths-title-row">
              <span className="token-skel-shimmer" style={{ width: 140, height: 22 }} />
              <span className="token-skel-shimmer" style={{ width: 60, height: 18 }} />
              <span className="token-skel-shimmer" style={{ width: 90, height: 22, borderRadius: 6 }} />
              <span className="token-skel-shimmer" style={{ width: 72, height: 22, borderRadius: 6 }} />
            </div>
            <div className="ths-sub-row">
              <span className="token-skel-shimmer" style={{ width: 95, height: 20, borderRadius: 4 }} />
              <span className="token-skel-shimmer" style={{ width: 85, height: 20, borderRadius: 4 }} />
              <span className="token-skel-shimmer" style={{ width: 68, height: 22, borderRadius: 4 }} />
              <span className="token-skel-shimmer" style={{ width: 55, height: 22, borderRadius: 4 }} />
            </div>
          </div>
        </div>

        {/* Right metrics row */}
        <div className="ths-metrics">
          <div className="ths-metric-item">
            <span className="ths-metric-label">{(t("price") || "PRICE").toUpperCase()}</span>
            <span className="token-skel-shimmer" style={{ width: 90, height: 24, marginTop: 2 }} />
            <span className="token-skel-shimmer" style={{ width: 60, height: 12, marginTop: 4 }} />
          </div>

          <div className="ths-metric-item">
            <span className="ths-metric-label">{(t("mcap") || "MCAP").toUpperCase()}</span>
            <span className="token-skel-shimmer" style={{ width: 85, height: 24, marginTop: 2 }} />
            <span className="token-skel-shimmer" style={{ width: 75, height: 12, marginTop: 4 }} />
          </div>

          <div className="ths-metric-item">
            <span className="ths-metric-label">{(t("volume") || "VOLUME").toUpperCase()}</span>
            <span className="token-skel-shimmer" style={{ width: 80, height: 24, marginTop: 2 }} />
            <span className="token-skel-shimmer" style={{ width: 100, height: 12, marginTop: 4 }} />
          </div>

          <div className="ths-metric-item">
            <span className="ths-metric-label">{(t("targetRaise") || "TARGET RAISE").toUpperCase()}</span>
            <span className="token-skel-shimmer" style={{ width: 95, height: 24, marginTop: 2 }} />
            <span className="token-skel-shimmer" style={{ width: 65, height: 12, marginTop: 4 }} />
          </div>

          <div className="ths-metric-item">
            <span className="ths-metric-label">{(t("totalSupply") || "TOTAL SUPPLY").toUpperCase()}</span>
            <span className="token-skel-shimmer" style={{ width: 90, height: 24, marginTop: 2 }} />
            <span className="token-skel-shimmer" style={{ width: 50, height: 12, marginTop: 4 }} />
          </div>
        </div>

        {/* Copy kit sub-bar */}
        <div className="ths-copy-bar">
          <div className="copy-row">
            <span className="token-skel-shimmer" style={{ width: 65, height: 26, borderRadius: 4 }} />
            <span className="token-skel-shimmer" style={{ width: 110, height: 26, borderRadius: 4 }} />
            <span className="token-skel-shimmer" style={{ width: 90, height: 26, borderRadius: 4 }} />
            <span className="token-skel-shimmer" style={{ width: 75, height: 26, borderRadius: 4 }} />
            <span className="token-skel-shimmer" style={{ width: 135, height: 26, borderRadius: 999, marginLeft: "auto" }} />
          </div>
        </div>
      </div>

      {/* 2. MAIN 2-COLUMN TERMINAL LAYOUT */}
      <div className="token-layout terminal-layout">
        {/* Left Column: Chart + Lower Tabs */}
        <div className="token-main terminal-left-col">
          {/* Mobile tabs */}
          <div className="token-mobile-tabs" role="tablist" aria-label="Terminal">
            <button type="button" role="tab" className="filter-btn active" tabIndex={-1}>{t("chart")}</button>
            <button type="button" role="tab" className="filter-btn" tabIndex={-1}>{t("trade")}</button>
            <button type="button" role="tab" className="filter-btn" tabIndex={-1}>{t("raiseTab")}</button>
          </div>

          {/* Chart container */}
          <div className="terminal-chart-box">
            <div className="terminal-chart-header">
              <div className="tch-left">
                <span className="token-skel-shimmer" style={{ width: 85, height: 20, borderRadius: 4 }} />
                <span className="token-skel-shimmer" style={{ width: 65, height: 20, borderRadius: 4 }} />
                <span className="token-skel-shimmer" style={{ width: 135, height: 22, borderRadius: 6 }} />
              </div>
              <div className="tch-right">
                <span className="token-skel-shimmer" style={{ width: 75, height: 24, borderRadius: 6 }} />
              </div>
            </div>

            <div className="terminal-chart-skel">
              <svg className="chart-skel-svg" viewBox="0 0 800 300" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="chartSkelGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path
                  d="M0,220 Q120,260 200,190 T400,160 T600,90 T800,120 L800,300 L0,300 Z"
                  fill="url(#chartSkelGrad)"
                />
                <path
                  d="M0,220 Q120,260 200,190 T400,160 T600,90 T800,120"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeDasharray="6 6"
                  strokeOpacity="0.35"
                />
              </svg>
            </div>
          </div>

          {/* Lower Tabs bar & table */}
          <div className="terminal-tabs-box">
            <div className="terminal-tabs-bar">
              <div className="terminal-tabs-left">
                <button type="button" className="tt-tab-btn active" tabIndex={-1}>
                  {t("trades")}
                </button>
                <button type="button" className="tt-tab-btn" tabIndex={-1}>
                  {t("holders")}
                </button>
                <button type="button" className="tt-tab-btn" tabIndex={-1}>
                  {t("about")}
                </button>
              </div>
              <div className="terminal-tabs-right">
                <span className="live-status-pill" style={{ opacity: 0.6 }}>
                  <i className="live-dot" /> LIVE
                </span>
              </div>
            </div>

            <div className="terminal-tab-content">
              <div className="trades-list trades-list-pro trades-list-terminal trades-with-tx">
                <div className="trades-head trades-head-terminal" aria-hidden>
                  <span>AGE</span>
                  <span>TYPE</span>
                  <span>PRICE</span>
                  <span>AMOUNT</span>
                  <span>TOTAL</span>
                  <span>VIA</span>
                  <span>TX</span>
                </div>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="trade-row trade-row-terminal">
                    <span><span className="token-skel-shimmer" style={{ width: 34, height: 12 }} /></span>
                    <span><span className="token-skel-shimmer" style={{ width: 42, height: 18, borderRadius: 4 }} /></span>
                    <span><span className="token-skel-shimmer" style={{ width: 62, height: 13 }} /></span>
                    <span><span className="token-skel-shimmer" style={{ width: 54, height: 13 }} /></span>
                    <span><span className="token-skel-shimmer" style={{ width: 58, height: 13 }} /></span>
                    <span><span className="token-skel-shimmer" style={{ width: 56, height: 13 }} /></span>
                    <span className="trade-tx"><span className="token-skel-shimmer" style={{ width: 78, height: 20, borderRadius: 6 }} /></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Performance Matrix + Swap Terminal + Your Position */}
        <div className="token-sidebar terminal-right-col">
          {/* Quick Performance Matrix */}
          <div className="panel perf-matrix-card">
            <div className="perf-matrix-grid">
              {["5M", "1H", "6H", "24H"].map((tf) => (
                <div key={tf} className="perf-time-cell">
                  <span className="perf-k">{tf}</span>
                  <span className="token-skel-shimmer" style={{ width: 42, height: 15, marginTop: 3 }} />
                </div>
              ))}
            </div>
            <div className="perf-vol-row">
              {[
                (t("vol24h") || "24H VOL").toUpperCase(),
                (t("buys") || "BUYS").toUpperCase(),
                (t("sells") || "SELLS").toUpperCase(),
                (t("net24h") || "24H NET").toUpperCase(),
              ].map((label, idx) => (
                <div key={idx} className="perf-vol-item">
                  <span className="perf-vol-k">{label}</span>
                  <span className="token-skel-shimmer" style={{ width: 48, height: 15, marginTop: 3 }} />
                </div>
              ))}
            </div>
          </div>

          {/* Swap / Order Execution Box */}
          <div className="panel trade-panel trade-panel-terminal side-buy">
            <div className="terminal-trade-tabs">
              <button type="button" className="tt-switch-btn buy active" tabIndex={-1}>
                {t("buy")}
              </button>
              <button type="button" className="tt-switch-btn sell" tabIndex={-1}>
                {t("sell")}
              </button>
            </div>

            <div className="terminal-order-types">
              <button type="button" className="tot-btn active" tabIndex={-1}>{t("market") || "Market"}</button>
              <button type="button" className="tot-btn disabled" tabIndex={-1}>{t("limit") || "Limit"} <span className="tot-soon">{t("soon") || "SOON"}</span></button>
              <button type="button" className="tot-btn disabled" tabIndex={-1}>{t("dca") || "DCA"} <span className="tot-soon">{t("soon") || "SOON"}</span></button>
            </div>

            <div className="trade-form terminal-trade-form">
              <div className="trade-field terminal-field">
                <div className="trade-field-top">
                  <span className="terminal-label" style={{ fontSize: "0.72rem", fontWeight: 750, color: "var(--muted)" }}>
                    {(t("amountGnot") || "YOU PAY (GNOT)").toUpperCase()}
                  </span>
                  <span className="token-skel-shimmer" style={{ width: 75, height: 14 }} />
                </div>
                <div className="trade-input-wrap terminal-input-wrap">
                  <div className="token-skel-shimmer" style={{ width: "100%", height: 38, borderRadius: 6 }} />
                </div>
              </div>

              <div className="quick-chips-grid pct-row">
                {["25%", "50%", "75%", t("max") || "Max"].map((p, i) => (
                  <button key={i} type="button" className="quick-chip pct" tabIndex={-1}>{p}</button>
                ))}
              </div>

              <div className="terminal-settings-row">
                <span className="token-skel-shimmer" style={{ width: 110, height: 26, borderRadius: 4 }} />
                <span className="token-skel-shimmer" style={{ width: 70, height: 26, borderRadius: 4 }} />
              </div>

              <div className="quote-box" style={{ minHeight: 68, display: "flex", flexDirection: "column", gap: "0.4rem", justifyContent: "center" }}>
                <div className="quote-row">
                  <span className="token-skel-shimmer" style={{ width: 60, height: 12 }} />
                  <span className="token-skel-shimmer" style={{ width: 80, height: 12 }} />
                </div>
                <div className="quote-row">
                  <span className="token-skel-shimmer" style={{ width: 70, height: 12 }} />
                  <span className="token-skel-shimmer" style={{ width: 90, height: 12 }} />
                </div>
              </div>

              <div className="token-skel-shimmer" style={{ width: "100%", height: 44, borderRadius: 8, marginTop: "0.5rem" }} />
            </div>

            <div className="terminal-route-foot faint mono">
              <span>{(t("estGas") || "EST. GAS").toUpperCase()}: ~0.002 GNOT</span>
              <span>{(t("route") || "ROUTE").toUpperCase()}: CURVE</span>
            </div>
          </div>

          {/* User Position Card Skeleton hidden as requested */}
          {false && (
            <div className="panel position-card">
              <div className="position-card-head">
                <span className="pos-title">{(t("yourPosition") || "YOUR POSITION").toUpperCase()}</span>
                <span className="token-skel-shimmer" style={{ width: 85, height: 14 }} />
              </div>
              <div className="position-grid">
                {[
                  (t("bought") || "BOUGHT").toUpperCase(),
                  (t("sold") || "SOLD").toUpperCase(),
                  (t("holding") || "HOLDING").toUpperCase(),
                  (t("pnl") || "PNL").toUpperCase(),
                ].map((lbl, idx) => (
                  <div key={idx} className="pos-item">
                    <span className="pos-k">{lbl}</span>
                    <span className="token-skel-shimmer" style={{ width: 45, height: 16, marginTop: 2 }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Raise Ribbon Skeleton */}
          <div className="panel raise-panel" style={{ marginTop: "0.85rem" }}>
            <h2 className="panel-title">{t("raiseProgress")}</h2>
            <div className="grad-fomo">
              <div className="grad-fomo-top">
                <span className="token-skel-shimmer" style={{ width: 130, height: 14 }} />
                <span className="token-skel-shimmer" style={{ width: 90, height: 14 }} />
              </div>
              <div className="raise-track" aria-hidden style={{ marginTop: "0.5rem", marginBottom: "0.5rem" }}>
                <span className="token-skel-shimmer" style={{ width: "100%", height: 8, borderRadius: 4, display: "block" }} />
              </div>
              <div className="grad-fomo-foot muted">
                <span className="token-skel-shimmer" style={{ width: 80, height: 12 }} />
                <span className="token-skel-shimmer" style={{ width: 140, height: 12 }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

