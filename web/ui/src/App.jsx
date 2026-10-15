import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AppProvider, useApp } from "./context/AppContext";
import { PrefsProvider } from "./context/PrefsContext";
import Layout from "./components/Layout";
import Markets from "./pages/Markets";
import Create from "./pages/Create";
import Token from "./pages/Token";
import Portfolio from "./pages/Portfolio";
import Creator from "./pages/Creator";
import Profile from "./pages/Profile";
import Leaderboard from "./pages/Leaderboard";
import Admin from "./pages/Admin";
import Docs from "./pages/Docs";
import LaunchCountdown, { GNOMI_LAUNCH_MS } from "./components/LaunchCountdown";
import RaiseNotice, { useRaiseNoticeLive } from "./components/RaiseNotice";

const GA_MEASUREMENT_ID = "G-1W967FFSVL";
/** Build flag: show countdown gate until GNOMI_LAUNCH_AT (auto-opens after). */
const SITE_UPGRADE =
  String(import.meta.env.VITE_SITE_UPGRADE || "").trim() === "1";
/** Local/prod flag. Off unless VITE_RAISE_NOTICE=1. Visitors can dismiss the dialog. */
const RAISE_NOTICE =
  String(import.meta.env.VITE_RAISE_NOTICE || "").trim() === "1";

/** SPA pageviews for Google Analytics (gtag in index.html). */
function AnalyticsRouteTracker() {
  const location = useLocation();
  useEffect(() => {
    if (typeof window.gtag !== "function") return;
    const pagePath = `${location.pathname}${location.search}`;
    window.gtag("config", GA_MEASUREMENT_ID, {
      page_path: pagePath,
      page_title: document.title,
    });
  }, [location.pathname, location.search]);
  return null;
}

function RaiseNoticeGate() {
  const live = useRaiseNoticeLive();
  if (!RAISE_NOTICE || !live) return null;
  return <RaiseNotice />;
}

function AdminGate({ children }) {
  const { isAdmin } = useApp();
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

/**
 * Launch countdown for public users until GNOMI_LAUNCH_AT (07:00 UTC 21 Sep 2026).
 * After that instant the gate unmounts and the platform runs normally.
 * Protocol/admin wallet can bypass early via Connect.
 */
function MaintenanceGate() {
  const { isAdmin, wallet } = useApp();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!SITE_UPGRADE) return undefined;
    if (Date.now() >= GNOMI_LAUNCH_MS) return undefined;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= GNOMI_LAUNCH_MS) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  if (!SITE_UPGRADE) return null;
  // Auto-open at/after launch time — no redeploy required.
  if (now >= GNOMI_LAUNCH_MS) return null;
  if (isAdmin && wallet?.address) return null;
  return <LaunchCountdown />;
}

export default function App() {
  return (
    <PrefsProvider>
      <AppProvider>
        <BrowserRouter>
          <AnalyticsRouteTracker />
          <MaintenanceGate />
          <RaiseNoticeGate />
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Markets />} />
              <Route path="create" element={<Create />} />
              <Route path="token/:id" element={<Token />} />
              <Route path="portfolio" element={<Portfolio />} />
              <Route path="creator" element={<Creator />} />
              <Route path="profile" element={<Profile />} />
              <Route path="leaderboard" element={<Leaderboard />} />
              <Route
                path="admin"
                element={
                  <AdminGate>
                    <Admin />
                  </AdminGate>
                }
              />
              <Route path="docs" element={<Docs />} />
              {/* Retired Season0 / Ops surfaces → home */}
              <Route path="rewards" element={<Navigate to="/" replace />} />
              <Route path="ambassadors" element={<Navigate to="/" replace />} />
              <Route path="ops" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </PrefsProvider>
  );
}
