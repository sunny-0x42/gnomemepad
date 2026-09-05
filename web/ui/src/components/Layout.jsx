import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { usePrefs } from "../context/PrefsContext";
import { shortAddr } from "../lib/format";
import NavIcon from "./NavIcon";
import Toast from "./Toast";
import TxModal from "./TxModal";
import CommandPalette from "./CommandPalette";
import StatusBanners from "./StatusBanners";
import Confetti from "./Confetti";
import SettingsModal from "./SettingsModal";
import WatchAlerts from "./WatchAlerts";

const PRIMARY_NAV = [
  { to: "/", key: "markets", end: true, icon: "markets" },
  { to: "/create", key: "create", icon: "create" },
  { to: "/leaderboard", key: "leaderboard", icon: "leaderboard" },
  { to: "/portfolio", key: "portfolio", icon: "portfolio" },
];

const MORE_NAV = [
  { to: "/creator", key: "creator" },
  { to: "/profile", key: "profile" },
  { to: "/rewards", key: "rewards" },
  { to: "/ops", key: "ops" },
  { to: "/docs", key: "guide" },
];

const ALL_NAV = [...PRIMARY_NAV, ...MORE_NAV];

const MOBILE_DOCK = [
  { to: "/", key: "markets", end: true, icon: "markets" },
  { to: "/create", key: "create", icon: "create" },
  { to: "/leaderboard", key: "leaderboard", icon: "leaderboard" },
  { to: "/portfolio", key: "portfolio", icon: "portfolio" },
];

function NavItems({ items, onNavigate, isAdmin, showAdmin, t }) {
  return (
    <>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `nav-btn${isActive ? " active" : ""}`}
          onClick={onNavigate}
        >
          {item.icon ? (
            <span className="nav-btn-icon">
              <NavIcon name={item.icon} size={16} />
            </span>
          ) : null}
          {t(item.key)}
        </NavLink>
      ))}
      {showAdmin && isAdmin && (
        <NavLink
          to="/admin"
          className={({ isActive }) => `nav-btn nav-admin${isActive ? " active" : ""}`}
          onClick={onNavigate}
        >
          <span className="nav-btn-icon">
            <NavIcon name="admin" size={16} />
          </span>
          {t("admin")}
        </NavLink>
      )}
    </>
  );
}

export default function Layout() {
  const {
    wallet,
    isConnecting,
    connect,
    disconnect,
    isAdmin,
    networkId,
    setNetworkId,
    networks,
    network,
  } = useApp();
  const { t } = usePrefs();
  const nav = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [netBusy, setNetBusy] = useState(false);
  const moreRef = useRef(null);
  const mobileMenuRef = useRef(null);

  async function onNetworkChange(e) {
    const next = e.target.value;
    if (!next || next === networkId) return;
    setNetBusy(true);
    try {
      const okSwitch = await setNetworkId(next);
      if (okSwitch) {
        // Reload markets/home for the new chain
        if (location.pathname.startsWith("/token/")) nav("/");
        else nav(0);
      } else {
        e.target.value = networkId;
      }
    } finally {
      setNetBusy(false);
    }
  }

  useEffect(() => {
    setMenuOpen(false);
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen && !moreOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setMoreOpen(false);
      }
    };
    const onPointer = (e) => {
      const t = e.target;
      if (moreOpen && moreRef.current && !moreRef.current.contains(t)) {
        setMoreOpen(false);
      }
      // Mobile full menu: close when tapping outside header/dock "more"
      if (
        menuOpen &&
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(t) &&
        !t.closest?.(".nav-toggle") &&
        !t.closest?.(".dock-more")
      ) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    // capture phase so we close before other handlers steal the event
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [menuOpen, moreOpen]);

  useEffect(() => {
    function onKey(e) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
      if (meta && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const moreActive =
    MORE_NAV.some(
      (i) => location.pathname === i.to || (i.to !== "/" && location.pathname.startsWith(i.to)),
    ) || (isAdmin && location.pathname.startsWith("/admin"));

  return (
    <div className="app-shell has-mobile-dock">
      <header className={`top ${scrolled ? "scrolled" : ""}`}>
        <div
          className="brand"
          onClick={() => nav("/")}
          onKeyDown={(e) => e.key === "Enter" && nav("/")}
          role="button"
          tabIndex={0}
          aria-label="Gnomi.fun home"
        >
          <div className="brand-logo-wrap">
            <img src="/gnomi-logo-light.svg" alt="Gnomi.fun" className="brand-logo logo-light" />
            <img src="/gnomi-logo-dark.svg" alt="Gnomi.fun" className="brand-logo logo-dark" />
            <span className="brand-tag">Gnomi.fun</span>
          </div>
        </div>

        <nav className="nav nav-desktop" aria-label="Main">
          <NavItems items={PRIMARY_NAV} isAdmin={isAdmin} showAdmin={false} t={t} />
          <div className="nav-more-wrap" ref={moreRef}>
            <button
              type="button"
              className={`nav-btn${moreOpen || moreActive ? " active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setMoreOpen((v) => !v);
              }}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
            >
              {t("more")} ▾
            </button>
            {moreOpen && (
              <div className="nav-more-menu" role="menu">
                <NavItems
                  items={MORE_NAV}
                  isAdmin={isAdmin}
                  showAdmin
                  t={t}
                  onNavigate={() => setMoreOpen(false)}
                />
              </div>
            )}
          </div>
        </nav>

        <div className="header-right">
          <button
            type="button"
            className="btn sm ghost cmd-trigger"
            onClick={() => setCmdOpen(true)}
            title={`${t("search")} (Ctrl+K)`}
          >
            <span className="cmd-trigger-label">{t("search")}</span>
            <kbd className="kbd">⌘K</kbd>
          </button>
          <label className="net-select-wrap" title={`RPC ${network?.rpcUrl || ""}`}>
            <span className="sr-only">Network</span>
            <select
              className="net-select"
              value={networkId}
              disabled={netBusy}
              onChange={onNetworkChange}
              aria-label="Select Gno network"
            >
              {(networks || []).map((n) => (
                <option key={n.id} value={n.id} disabled={!n.enabled && n.comingSoon}>
                  {n.label}
                  {n.comingSoon ? " (soon)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`btn wallet-btn${wallet ? " connected" : ""}`}
            onClick={() => (wallet ? disconnect() : connect())}
            title={wallet?.address || "Connect Adena wallet"}
            disabled={isConnecting}
          >
            <svg
              className="wallet-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
              <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
            </svg>
            <span>
              {isConnecting
                ? t("connecting")
                : wallet
                ? shortAddr(wallet.address)
                : t("connect")}
            </span>
          </button>
          <button
            type="button"
            className="nav-toggle"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span />
          </button>
        </div>

        <nav
          ref={mobileMenuRef}
          className={`nav-mobile${menuOpen ? " open" : ""}`}
          aria-label="Mobile full"
          aria-hidden={!menuOpen}
        >
          <NavItems
            items={ALL_NAV}
            isAdmin={isAdmin}
            showAdmin
            t={t}
            onNavigate={() => setMenuOpen(false)}
          />
          <button
            type="button"
            className="nav-btn"
            onClick={() => {
              setMenuOpen(false);
              setCmdOpen(true);
            }}
          >
            <span className="nav-btn-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            {t("search")} (⌘K)
          </button>
          <button
            type="button"
            className="nav-btn"
            onClick={() => {
              setMenuOpen(false);
              setSettingsOpen(true);
            }}
          >
            {t("settings")}
          </button>
        </nav>
      </header>

      <main className="app-main">
        <StatusBanners />
        <Outlet />
      </main>

      <footer className="app-footer">
        <span>
          gnomi · Gno Sapphire ·{" "}
          <a href="https://adena.app/" target="_blank" rel="noreferrer">
            Adena
          </a>
          {" · "}
          <NavLink to="/docs">{t("guide")}</NavLink>
          {" · "}
          <button type="button" className="linkish" onClick={() => setCmdOpen(true)}>
            {t("search")} ⌘K
          </button>
          {" · "}
          <button type="button" className="linkish" onClick={() => setSettingsOpen(true)}>
            {t("settings")}
          </button>
        </span>
      </footer>

      <nav className="mobile-dock" aria-label="Primary mobile">
        {MOBILE_DOCK.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `dock-item${isActive ? " active" : ""}${item.to === "/create" ? " dock-create" : ""}`
            }
          >
            <span className="dock-icon" aria-hidden>
              <NavIcon name={item.icon} size={20} />
            </span>
            <span className="dock-label">{t(item.key)}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={`dock-item dock-more${menuOpen || moreActive ? " active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          aria-expanded={menuOpen}
        >
          <span className="dock-icon" aria-hidden>
            <NavIcon name="more" size={20} />
          </span>
          <span className="dock-label">{t("more")}</span>
        </button>
      </nav>

      <Toast />
      <TxModal />
      <Confetti />
      <WatchAlerts />
      <button
        type="button"
        className="settings-fab"
        onClick={() => setSettingsOpen(true)}
        title={t("settings")}
        aria-label={t("settings")}
      >
        <span className="icon-spin">⚙</span>
      </button>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
