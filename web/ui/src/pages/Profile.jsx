import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { usePrefs } from "../context/PrefsContext";
import TokenAvatar from "../components/TokenAvatar";
import { Badge, EmptyState, PageHeader, ProgressBar, SkeletonPanel, Stat } from "../components/ui";
import { api } from "../lib/api";
import { copyText, fmtGnot, shortAddr } from "../lib/format";
import { safeImageUrl } from "../lib/avatar";
import { isRetiredPad } from "../lib/marketHeat";

export default function Profile() {
  const { wallet, connect, broadcast, showToast, health } = useApp();
  const { t } = usePrefs();
  const [sp] = useSearchParams();
  const viewAddr = (sp.get("addr") || "").trim();
  const isOther =
    viewAddr && wallet?.address && viewAddr.toLowerCase() !== wallet.address.toLowerCase();
  const isViewOnly = !!viewAddr && (!wallet || isOther);

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [uri, setUri] = useState("");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedAddr, setLoadedAddr] = useState("");
  const [launches, setLaunches] = useState([]);
  const [loadingLaunches, setLoadingLaunches] = useState(false);
  const profilePkg = health?.profile || health?.modules?.profile;

  const target = viewAddr || wallet?.address || "";

  useEffect(() => {
    if (!target) return;
    api(`/api/profile?address=${encodeURIComponent(target)}`)
      .then((p) => {
        const pr = p?.profile || p;
        setName(pr?.name || "");
        setBio(pr?.bio || "");
        setUri(pr?.uri || "");
        setLoadedAddr(target);
      })
      .catch(() => {
        setName("");
        setBio("");
        setUri("");
        setLoadedAddr(target);
      });
  }, [target]);

  useEffect(() => {
    if (!target) return;
    setLoadingLaunches(true);
    api(`/api/creator?address=${encodeURIComponent(target)}`)
      .then((d) => {
        const rows = Array.isArray(d?.launches) ? d.launches : [];
        setLaunches(
          rows.filter((m) => !isRetiredPad(m.pkg) && !isRetiredPad(m.padLabel)),
        );
      })
      .catch(() => setLaunches([]))
      .finally(() => setLoadingLaunches(false));
  }, [target]);

  const stats = useMemo(() => {
    let raised = 0;
    let graduated = 0;
    for (const m of launches) {
      raised += Number(m.raisedGnot ?? (m.raised || 0) / 1e6) || 0;
      if (m.status === 1) graduated += 1;
    }
    return { count: launches.length, raised, graduated };
  }, [launches]);

  const avatarUri = safeImageUrl(uri);

  async function save(e) {
    e.preventDefault();
    if (!wallet?.canSign) return connect();
    if (isViewOnly) return;
    if (!profilePkg) return showToast("Profile realm not configured", false);
    setBusy(true);
    setLog("Signing SetProfile...");
    try {
      const r = await broadcast("SetProfile", [name, bio, uri], "", profilePkg);
      setLog(`OK ${r.hash || ""}`);
      showToast("Profile saved");
    } catch (err) {
      try {
        const r = await broadcast("Upsert", [name, bio, uri], "", profilePkg);
        setLog(`OK ${r.hash || ""}`);
        showToast("Profile saved");
      } catch (e2) {
        setLog(String(err.message || e2.message || e2));
        showToast(err.message || e2, false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyProfileLink() {
    try {
      const url = `${window.location.origin}/profile?addr=${encodeURIComponent(target)}`;
      await copyText(url);
      showToast("Profile link copied");
    } catch {
      showToast("Copy failed", false);
    }
  }

  if (!wallet && !viewAddr) {
    return (
      <section className="view">
        <EmptyState
          icon="◉"
          title={t("profile")}
          action={
            <button type="button" className="btn primary" onClick={connect}>
              {t("connect")}
            </button>
          }
        >
          Connect to edit your on-chain profile.
        </EmptyState>
      </section>
    );
  }

  return (
    <section className="view">
      <div className="profile-layout">
        <PageHeader
          kicker={isViewOnly ? t("creator") : t("profile")}
          title={isViewOnly ? name || t("profile") : t("profile")}
          lede={<span className="mono">{shortAddr(target)}</span>}
          actions={
            <button type="button" className="btn sm ghost" onClick={copyProfileLink}>
              {t("copyLink")}
            </button>
          }
        />

        {/* Public card */}
        <div className="panel profile-card">
          <div className="profile-card-top">
            <TokenAvatar
              name={name || "?"}
              symbol={name || target}
              uri={avatarUri}
              seed={target}
              size="xl"
            />
            <div className="profile-card-meta">
              <h2 className="profile-card-name">{name || "Unnamed"}</h2>
              <div className="mono faint">{shortAddr(target)}</div>
              {bio ? (
                <p className="profile-card-bio muted">{bio}</p>
              ) : (
                <p className="faint" style={{ margin: "0.4rem 0 0" }}>
                  No bio
                </p>
              )}
            </div>
          </div>
          <div className="stat-row" style={{ marginTop: "1rem", marginBottom: 0 }}>
            <Stat label={t("creator")} value={stats.count} hint="launches" />
            <Stat
              label={t("targetRaise")}
              value={fmtGnot(stats.raised, { alreadyGnot: true })}
              hint="total raised (GNOT)"
            />
            <Stat label={t("graduated")} value={stats.graduated} />
          </div>
        </div>

        {!isViewOnly && (
          <div className="panel" style={{ marginTop: "1rem" }}>
            {!profilePkg && (
              <div className="callout warn" style={{ marginBottom: "1rem" }}>
                Profile realm is not configured on this deployment.
              </div>
            )}
            <h2 className="panel-title">Edit profile</h2>
            <form onSubmit={save} className="create-form">
              <label>
                Display name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={32}
                  placeholder="Your name"
                />
              </label>
              <label>
                Bio
                <input
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={160}
                  placeholder="Short bio"
                />
              </label>
              <label>
                Avatar / URI
                <input
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder="https://... or ipfs://..."
                />
              </label>
              <button type="submit" className="btn primary lg block" disabled={busy || !profilePkg}>
                {busy ? t("signing") : "Save on-chain"}
              </button>
            </form>
            {log && (
              <pre className="log" style={{ marginTop: "1rem" }}>
                {log}
              </pre>
            )}
          </div>
        )}

        <h2 className="panel-title" style={{ marginTop: "1.25rem" }}>
          Launches
        </h2>
        {loadingLaunches && <SkeletonPanel height={100} />}
        {!loadingLaunches && launches.length === 0 && (
          <EmptyState
            icon="◎"
            title="No launches"
            action={
              !isViewOnly ? (
                <Link className="btn primary" to="/create">
                  {t("create")}
                </Link>
              ) : null
            }
          >
            {isViewOnly ? "This address has not launched coins yet." : "Create your first coin."}
          </EmptyState>
        )}
        <div className="market-grid">
          {launches.map((m) => {
            const pct = Math.min(100, Number(m.progressPct) || 0);
            const isGrad = m.status === 1;
            return (
              <Link
                key={`${m.pkg}:${m.id}`}
                to={`/token/${encodeURIComponent(m.id)}?pkg=${encodeURIComponent(m.pkg || "")}`}
                className="card market-card"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div className="card-top">
                  <div className="token-title-row">
                    <TokenAvatar
                      name={m.name}
                      symbol={m.symbol}
                      seed={`${m.pkg}:${m.id}`}
                      size="md"
                    />
                    <div>
                      <div className="card-title">
                        {m.name}
                        <span className="card-symbol">${m.symbol}</span>
                      </div>
                      <div className="card-meta mono">
                        {fmtGnot(m.raisedGnot ?? (m.raised || 0) / 1e6, { alreadyGnot: true })} GNOT
                      </div>
                    </div>
                  </div>
                  <Badge kind={isGrad ? "graduated" : "curve"}>
                    {isGrad ? t("graduated") : t("raising")}
                  </Badge>
                </div>
                {!isGrad && (
                  <div style={{ marginTop: "0.65rem" }}>
                    <ProgressBar pct={pct} />
                    <div className="muted" style={{ fontSize: "0.72rem", marginTop: "0.25rem" }}>
                      {pct}%
                    </div>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
