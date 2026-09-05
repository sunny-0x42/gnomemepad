import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { usePrefs } from "../context/PrefsContext";
import TokenAvatar from "../components/TokenAvatar";
import { PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { copyText, formatCountdown, UGNOT_PER_GNOT } from "../lib/format";
import { normalizeImageUri, safeImageUrl } from "../lib/avatar";

const GNS_PKG = "gno.land/r/gnoswap/gns";
const DEFAULT_LIST_FEE_GNS = 100_000_000; // 100 GNS (6 decimals)

export default function Create() {
  const { wallet, isConnecting, connect, broadcast, broadcastBundle, pkg, showToast, health } = useApp();
  const { t } = usePrefs();
  const nav = useNavigate();
  const [step, setStep] = useState(1); // 1 identity · 2 confirm · 3 success
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [image, setImage] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [busy, setBusy] = useState(false);
  const [bond, setBond] = useState(null);
  const [createNeed, setCreateNeed] = useState(null);
  const [created, setCreated] = useState(null); // { id, pkg, symbol, name }

  const metaPkg = health?.modules?.meta || health?.meta || null;

  const loadCreateNeed = useCallback(() => {
    const q = pkg ? `?pkg=${encodeURIComponent(pkg)}` : "";
    return api(`/api/create-need${q}`)
      .then(setCreateNeed)
      .catch(() => setCreateNeed(null));
  }, [pkg]);

  useEffect(() => {
    api("/api/bond")
      .then(setBond)
      .catch(() => setBond(null));
  }, []);

  useEffect(() => {
    loadCreateNeed();
  }, [loadCreateNeed]);

  const bondUgnot =
    Number(createNeed?.bondUgnot) > 0
      ? Number(createNeed.bondUgnot)
      : Number(bond?.currentUgnot) > 0
        ? Number(bond.currentUgnot)
        : 2_000_000;
  const bondGnot = bondUgnot / UGNOT_PER_GNOT;
  // padv20+: ListFeeRequired from /api/create-need; fall back when health is padv20+
  const padLabel = String(pkg || health?.pkg || "");
  const isListFeePad = /padv2\d\b/i.test(padLabel);
  const effectiveListFee =
    Number(createNeed?.listFeeGns) > 0
      ? Number(createNeed.listFeeGns)
      : isListFeePad
        ? DEFAULT_LIST_FEE_GNS
        : 0;
  const listFeeUnits = effectiveListFee / 1e6;
  const isPromo = bond?.statusLabel === "promo";
  const daysLeft =
    bond?.secondsLeft != null ? formatCountdown(bond.secondsLeft) : null;
  const bondLabel = isPromo
    ? `${bondGnot} GNOT promo${daysLeft ? ` · ${daysLeft} left` : ""}`
    : `${bondGnot} GNOT`;

  const imgOk = useMemo(() => !!safeImageUrl(image), [image]);
  // Stored on launch.uri + SetMeta.imageURI (max 200 on-chain)
  const createUri = normalizeImageUri(image) || image.trim();

  function validateStep1() {
    if (!name.trim()) {
      showToast("Name required", false);
      return false;
    }
    if (!symbol.trim() || symbol.trim().length < 2) {
      showToast("Symbol at least 2 chars", false);
      return false;
    }
    if (image.trim()) {
      const n = normalizeImageUri(image);
      if (!n && !image.trim().startsWith("ipfs://")) {
        showToast("Image must be https:// or ipfs:// (short URL, max 200 chars)", false);
        return false;
      }
      if (n.length > 200 || image.trim().length > 200) {
        showToast("Image URL too long (max 200 chars for on-chain meta)", false);
        return false;
      }
    }
    return true;
  }

  function goConfirm(e) {
    e?.preventDefault();
    if (!validateStep1()) return;
    if (!wallet?.canSign) {
      connect();
      return;
    }
    setStep(2);
  }

  async function resolveLaunchId(sym) {
    try {
      const m = await api("/api/markets?refresh=1");
      const addr = (wallet?.address || "").toLowerCase();
      const list = (m?.markets || [])
        .filter(
          (x) =>
            !x.error &&
            (x.creator || "").toLowerCase() === addr &&
            (x.symbol || "").toUpperCase() === sym.toUpperCase() &&
            (x.pkg || "") === (pkg || x.pkg),
        )
        .sort((a, b) => (Number(b.created) || 0) - (Number(a.created) || 0));
      // fallback: any pad match by symbol+creator
      const any = list[0]
        ? list
        : (m?.markets || [])
          .filter(
            (x) =>
              !x.error &&
              (x.creator || "").toLowerCase() === addr &&
              (x.symbol || "").toUpperCase() === sym.toUpperCase(),
          )
          .sort((a, b) => (Number(b.created) || 0) - (Number(a.created) || 0));
      return any[0] || null;
    } catch {
      return null;
    }
  }

  async function onLaunch(e) {
    e.preventDefault();
    if (!wallet?.canSign) {
      connect();
      return;
    }
    if (!validateStep1()) return;
    if (!pkg) {
      showToast("Pad package unknown — wait for health / refresh", false);
      return;
    }
    const sym = symbol.trim().toUpperCase();
    const nm = name.trim();
    setBusy(true);
    try {
      // Fresh create-need (free GNS / padAddr / fee)
      let need = createNeed;
      try {
        const q = `?pkg=${encodeURIComponent(pkg)}`;
        need = await api(`/api/create-need${q}`);
        setCreateNeed(need);
      } catch {
        /* use cached */
      }

      const feeGns =
        Number(need?.listFeeGns) > 0
          ? Math.floor(Number(need.listFeeGns))
          : effectiveListFee > 0
            ? Math.floor(effectiveListFee)
            : 0;
      const freeGns = Math.floor(Number(need?.freeGns) || 0);
      const gnsShort = Math.max(0, feeGns - freeGns);
      let padAddr = String(need?.padAddr || "").trim();
      if (!padAddr || !/^g1[a-z0-9]+$/i.test(padAddr)) {
        throw new Error("Pad address unknown — cannot Transfer GNS. Refresh and retry.");
      }

      // padv20+: Transfer free GNS shortfall before Create (push-pay, no Approve)
      if (feeGns > 0 && gnsShort > 0) {
        showToast(
          `Step 1/2: Transfer ${feeGns / 1e6} GNS list fee to pad (short ${gnsShort / 1e6}) — sign Adena`,
        );
        await broadcastBundle(
          [
            {
              pkgPath: need?.gnsPkg || GNS_PKG,
              func: "Transfer",
              args: [padAddr, String(gnsShort)],
            },
          ],
          {
            label: `1/2 Transfer ${feeGns / 1e6} GNS → pad`,
            gasWanted: 120_000_000,
            gasFee: 2_000_000,
          },
        );
        // Wait until free GNS covers fee
        let okGns = false;
        for (let i = 0; i < 12; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const n2 = await api(`/api/create-need?pkg=${encodeURIComponent(pkg)}`);
            setCreateNeed(n2);
            if (n2?.gnsReady || Math.floor(Number(n2?.freeGns) || 0) >= feeGns) {
              okGns = true;
              break;
            }
          } catch {
            /* keep waiting */
          }
        }
        if (!okGns) {
          throw new Error(
            `Pad free GNS still short of ${feeGns / 1e6} after Transfer. Wait and retry Create, or Transfer remaining GNS to ${padAddr.slice(0, 12)}…`,
          );
        }
        showToast("GNS list fee on pad — Create next");
      } else if (feeGns > 0) {
        showToast(`Pad free GNS covers list fee (${feeGns / 1e6} GNS) — Create only`);
      }

      showToast(
        feeGns > 0 ? `Step 2/2: Create $${sym} (bond ${bondGnot} GNOT)` : `Create $${sym}`,
      );
      await broadcast(
        "Create",
        [nm, sym, createUri],
        `${bondUgnot}ugnot`,
        pkg,
        {
          label:
            feeGns > 0
              ? `Create $${sym} · ${bondGnot} GNOT + ${feeGns / 1e6} GNS`
              : `Create $${sym}`,
          gasWanted: 200_000_000,
          gasFee: 2_000_000,
        },
      );

      // Resolve new launch id (Create return value not always exposed by Adena)
      let found = null;
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 900 + i * 500));
        found = await resolveLaunchId(sym);
        if (found) break;
      }

      const launchId = found?.id || "";
      const launchPkg = found?.pkg || pkg;
      const imageUri = normalizeImageUri(image) || createUri;
      const websiteUri = normalizeImageUri(website) || website.trim();
      const hasMetaFields = !!(
        description.trim() ||
        imageUri ||
        websiteUri ||
        twitter.trim() ||
        telegram.trim()
      );

      // Always write SetMeta when image/socials provided — icon depends on this + launch.uri
      if (metaPkg && launchId && hasMetaFields) {
        try {
          await broadcast(
            "SetMeta",
            [
              launchPkg,
              launchId,
              description.trim().slice(0, 500),
              imageUri,
              websiteUri,
              twitter.trim().replace(/^@/, "").slice(0, 64),
              telegram.trim().replace(/^@/, "").slice(0, 64),
            ],
            "",
            metaPkg,
            { label: "Set token icon & links" },
          );
          showToast("Icon & links saved on-chain");
        } catch (metaErr) {
          showToast(
            `Launched · icon/meta skipped: ${metaErr.message || metaErr}. Open token page → Edit links to set image.`,
            false,
          );
        }
      } else if (imageUri && !launchId) {
        showToast(
          "Launched · could not resolve launch id for SetMeta. Open token page soon and set image under Edit links.",
          false,
        );
      } else if (imageUri && !metaPkg) {
        showToast(
          "Launched · image stored on launch.uri; meta module offline so socials may be missing.",
          false,
        );
      }

      setCreated({
        id: launchId,
        pkg: launchPkg,
        symbol: sym,
        name: nm,
        image: imageUri || image.trim(),
      });
      setStep(3);
      showToast(
        imageUri
          ? "Launch created · icon on gnomi. Gnoswap logo auto-queues via token-resource sync."
          : "Launch created · add an image on token page for icon + Gnoswap logo sync",
      );
      // Fire-and-forget: enqueue Gnoswap registry sync (PR when GH token configured)
      if (launchId) {
        const qs = new URLSearchParams({
          id: launchId,
          pkg: launchPkg,
          dry: "0",
        });
        fetch(`/api/token-resource/register?${qs}`, { method: "POST" }).catch(() => { });
      }
      loadCreateNeed();
    } catch (err) {
      const msg = String(err.message || err);
      if (/Transfer .* GNS to pad then Create/i.test(msg)) {
        showToast(
          `Need GNS list fee on pad first. ${msg.slice(0, 160)}`,
          false,
        );
      } else {
        showToast(msg, false);
      }
    } finally {
      setBusy(false);
    }
  }

  function tokenPath() {
    if (!created?.id) return "/";
    return `/token/${encodeURIComponent(created.id)}?pkg=${encodeURIComponent(created.pkg || "")}`;
  }

  function shareX() {
    const url = created?.id
      ? `${window.location.origin}${tokenPath()}`
      : window.location.origin;
    const text = `Just launched $${created?.symbol || symbol} on gnomi (Gno Sapphire) 🚀`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function copyLink() {
    try {
      const url = created?.id
        ? `${window.location.origin}${tokenPath()}`
        : window.location.href;
      await copyText(url);
      showToast("Link copied");
    } catch {
      showToast("Copy failed", false);
    }
  }

  if (step === 3) {
    return (
      <section className="view">
        <div className="create-shell success-mode">
          <div className="panel create-success">
            <div className="success-burst" aria-hidden>
              ✓
            </div>
            <h1 style={{ margin: "0.75rem 0 0.35rem" }}>
              {t("youLaunched")} ${created?.symbol}
            </h1>
            <p className="muted" style={{ marginTop: 0 }}>
              {created?.name} {t("createSuccess")}
              {!created?.id && ` ${t("browseMarkets")}`}
            </p>
            <div className="create-preview success-preview">
              <TokenAvatar
                name={created?.name}
                symbol={created?.symbol}
                uri={created?.image}
                seed={created?.symbol}
                size="xl"
              />
              <div>
                <strong style={{ fontSize: "1.1rem" }}>{created?.name}</strong>
                <div className="muted">${created?.symbol}</div>
                {created?.id && (
                  <div className="mono faint" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
                    id {created.id}
                  </div>
                )}
              </div>
            </div>
            <div className="admin-actions" style={{ marginTop: "1.25rem", justifyContent: "center" }}>
              {created?.id ? (
                <Link className="btn primary lg" to={tokenPath()}>
                  {t("openToken")}
                </Link>
              ) : (
                <Link className="btn primary lg" to="/">
                  {t("browseMarkets")}
                </Link>
              )}
              <button type="button" className="btn lg" onClick={shareX}>
                {t("shareX")}
              </button>
              <button type="button" className="btn lg ghost" onClick={copyLink}>
                {t("copyLink")}
              </button>
            </div>
            <button
              type="button"
              className="btn sm ghost"
              style={{ marginTop: "1rem" }}
              onClick={() => {
                setStep(1);
                setName("");
                setSymbol("");
                setImage("");
                setDescription("");
                setWebsite("");
                setTwitter("");
                setTelegram("");
                setCreated(null);
              }}
            >
              {t("launchAnother")}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="view">
      <div className="create-shell">
        <div className="create-main">
          <PageHeader kicker={t("createKicker")} title={t("createTitle")} lede={t("createLede")} />

          <div className="callout ok create-raise-note" style={{ marginBottom: "1rem" }}>
            <strong>
              {pkg ? String(pkg).split("/").pop() : "pad"} ·{" "}
              {createNeed?.graduationGnot != null
                ? `${Number(createNeed.graduationGnot).toLocaleString()} GNOT`
                : "… GNOT"}{" "}
              raise
              {effectiveListFee > 0 ? ` · ${listFeeUnits} GNS list fee` : ""}
            </strong>
            <div className="muted" style={{ fontSize: "0.82rem", marginTop: "0.35rem" }}>
              {effectiveListFee > 0
                ? `Create escrows ${listFeeUnits} GNS for Gnoswap CreatePool (Transfer GNS → pad, then bond). After raise, RetryList can list without hunting for GNS.`
                : t("createRaiseNote")}
            </div>
          </div>

          <div className="wizard-steps" aria-label="Steps">
            <button
              type="button"
              className={`wizard-step${step === 1 ? " active" : ""}${step > 1 ? " done" : ""}`}
              onClick={() => step > 1 && setStep(1)}
            >
              <span className="ws-n">1</span> {t("createIdentity")}
            </button>
            <span className="wizard-line" />
            <button
              type="button"
              className={`wizard-step${step === 2 ? " active" : ""}`}
              onClick={() => step === 1 && goConfirm()}
            >
              <span className="ws-n">2</span> {t("createConfirm")}
            </button>
          </div>

          <div className="panel">
            <div className={`callout ${isPromo ? "warn" : "ok"}`} style={{ marginBottom: "1.15rem" }}>
              <strong>
                {t("createBond")} · {bondLabel}
                {effectiveListFee > 0 ? ` + ${listFeeUnits} GNS list fee` : ""}
              </strong>
              <div className="muted" style={{ fontSize: "0.82rem", marginTop: "0.3rem" }}>
                GNOT bond
                {effectiveListFee > 0
                  ? ` · GNS escrow for DEX list (free on pad: ${createNeed?.freeGnsUnits != null
                    ? Number(createNeed.freeGnsUnits).toFixed(2)
                    : "…"
                  } / need ${listFeeUnits})`
                  : ""}{" "}
                · pad <code className="mono">{pkg ? pkg.split("/").pop() : "..."}</code>
              </div>
              {effectiveListFee > 0 && createNeed && !createNeed.gnsReady && (
                <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.4rem" }}>
                  Launch will Transfer ~{Number(createNeed.gnsShortUnits || listFeeUnits).toFixed(2)}{" "}
                  GNS to pad first, then Create.
                </div>
              )}
            </div>

            {!wallet && (
              <div className="callout warn" style={{ marginBottom: "1.15rem" }}>
                Connect <strong>Adena</strong> on Sapphire to create.{" "}
                <button type="button" className="btn sm primary" onClick={connect}>
                  Connect
                </button>
              </div>
            )}

            {step === 1 && (
              <form onSubmit={goConfirm} className="create-form">

                <label>
                  Name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={48}
                    placeholder="e.g. Sapphire Doge"
                    required
                    autoComplete="off"
                  />
                </label>
                <label>
                  Symbol
                  <input
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                    maxLength={12}
                    placeholder="SDOGE"
                    required
                    autoComplete="off"
                    className="mono"
                  />
                </label>
                <label>
                  Image URL <span className="opt">(https / ipfs — recommended)</span>
                  <input
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    placeholder="https://… or ipfs://…"
                  />
                </label>
                <label>
                  Description <span className="opt">(optional · meta realm)</span>
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={280}
                    placeholder="Short lore"
                  />
                </label>
                <div className="create-social-grid">
                  <label>
                    Website
                    <input
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://"
                    />
                  </label>
                  <label>
                    X / Twitter
                    <input
                      value={twitter}
                      onChange={(e) => setTwitter(e.target.value)}
                      placeholder="@handle"
                    />
                  </label>
                  <label>
                    Telegram
                    <input
                      value={telegram}
                      onChange={(e) => setTelegram(e.target.value)}
                      placeholder="@channel"
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  className="btn primary lg block"
                  disabled={(!wallet?.canSign && !!wallet) || isConnecting}
                >
                  {!wallet
                    ? isConnecting
                      ? t("connecting")
                      : t("createConnect")
                    : `${t("createContinue")}`}
                </button>
              </form>
            )}

            {step === 2 && (
              <form onSubmit={onLaunch} className="create-form">
                <h2 className="panel-title" style={{ marginBottom: "0.75rem" }}>
                  {t("createConfirm")}
                </h2>

                <div className="quote-box" style={{ marginBottom: "1rem" }}>
                  <div className="quote-row">
                    <span>Bond</span>
                    <strong>{bondGnot} GNOT</strong>
                  </div>
                  <div className="quote-row">
                    <span>Type</span>
                    <span>{isPromo ? "Promo rate" : "Standard"}</span>
                  </div>
                  <div className="quote-row">
                    <span>{t("preMint")}</span>
                    <span>{t("noneFair")}</span>
                  </div>
                  <div className="quote-row">
                    <span>{t("targetRaise")}</span>
                    <strong>
                      {createNeed?.graduationGnot != null
                        ? `${Number(createNeed.graduationGnot).toLocaleString()} GNOT`
                        : "— GNOT"}
                    </strong>
                  </div>
                  {effectiveListFee > 0 && (
                    <div className="quote-row">
                      <span>GNS list fee</span>
                      <strong>{listFeeUnits} GNS</strong>
                    </div>
                  )}
                  {metaPkg && (description || website || twitter || telegram || image) && (
                    <div className="quote-row">
                      <span>Metadata</span>
                      <span className="muted">Will call SetMeta after Create</span>
                    </div>
                  )}
                </div>

                <div className="admin-actions" style={{ marginBottom: "0.75rem" }}>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => setStep(1)}
                  >
                    ← Back
                  </button>
                  <button
                    type="submit"
                    className="btn primary lg"
                    style={{ flex: 1 }}
                    disabled={busy || !wallet?.canSign}
                  >
                    {busy ? "Signing…" : `Create · bond ${bondGnot} GNOT`}
                  </button>
                </div>
                <p className="faint" style={{ fontSize: "0.75rem", margin: 0 }}>
                  Approve Create in Adena. Bond is sent with the transaction.
                </p>
              </form>
            )}
          </div>
        </div>

        <div className="create-sidebar">
          <div className="create-preview-wrap">
            <div className="create-preview-header">Live Preview</div>

            <article className="card market-card market-card-v2" style={{ pointerEvents: "none", margin: 0, height: "auto" }}>
              <div className="mc-link" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <div className="mc-body">
                  <div className="mc-header-row">
                    <div className="mc-badges-left">
                      <div className="badge curve">Curve</div>
                    </div>
                    <div className="mc-avatar-wrap">
                      <TokenAvatar
                        name={name || "Coin"}
                        symbol={symbol || "?"}
                        uri={image}
                        seed={symbol || name || "new"}
                        size="lg"
                      />
                    </div>
                    <div className="mc-badges-right">
                    </div>
                  </div>

                  <div className="mc-title-sec">
                    <h3 className="mc-title">{name || "Your Coin"}</h3>
                    <div className="mc-subtitle">
                      Fair Launch - ${symbol || "TICKER"} · Creator
                    </div>
                    {(twitter || telegram || website) && (
                      <div className="mc-socials" style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem', marginTop: '0.5rem' }}>
                        {twitter && <span className="social-chip">X</span>}
                        {telegram && <span className="social-chip">Telegram</span>}
                        {website && <span className="social-chip">Website</span>}
                      </div>
                    )}
                  </div>

                  {description && (
                    <div style={{ fontSize: "0.82rem", color: "var(--muted)", textAlign: "center", marginBottom: "1rem" }}>
                      {description}
                    </div>
                  )}

                  <div className="mc-progress-sec">
                    <div className="mc-progress-head">
                      <span>Processing 0%</span>
                    </div>
                    <div className="mc-progress-track">
                      <div className="mc-progress-fill" style={{ width: `0%` }}>
                        <div className="mc-progress-thumb" />
                      </div>
                    </div>
                    <div className="mc-progress-foot">
                      <span>0 GNOT</span>
                      <span>— GNOT</span>
                    </div>
                  </div>

                  <div className="mc-stats-grid">
                    <div className="mc-stat-pill">
                      <span className="muted">Price:</span> <span>—</span>
                    </div>
                    <div className="mc-stat-pill">
                      <span className="muted">MCap:</span> <span>—</span>
                    </div>
                    <div className="mc-stat-pill">
                      <span className="muted">Vol:</span> <span>—</span>
                    </div>
                    <div className="mc-stat-pill">
                      <span className="muted">Buyers:</span> <span>—</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mc-footer">
                <div className="mc-footer-left">
                  <div className="muted" style={{ fontSize: '0.7rem', marginBottom: '0.1rem' }}>Age:</div>
                  <strong>New</strong>
                </div>
                <div className="mc-footer-right">
                  <button type="button" className="mc-btn-star">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg>
                  </button>
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>

    </section>
  );
}
