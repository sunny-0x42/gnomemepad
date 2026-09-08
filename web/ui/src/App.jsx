import { useEffect } from "react";
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
import Rewards from "./pages/Rewards";
import Ambassadors from "./pages/Ambassadors";
import Leaderboard from "./pages/Leaderboard";
import Ops from "./pages/Ops";
import Admin from "./pages/Admin";
import Docs from "./pages/Docs";

const GA_MEASUREMENT_ID = "G-1W967FFSVL";

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

function AdminGate({ children }) {
  const { isAdmin } = useApp();
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <PrefsProvider>
      <AppProvider>
        <BrowserRouter>
          <AnalyticsRouteTracker />
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Markets />} />
              <Route path="create" element={<Create />} />
              <Route path="token/:id" element={<Token />} />
              <Route path="portfolio" element={<Portfolio />} />
              <Route path="creator" element={<Creator />} />
              <Route path="profile" element={<Profile />} />
              <Route path="rewards" element={<Rewards />} />
              <Route path="ambassadors" element={<Ambassadors />} />
              <Route path="leaderboard" element={<Leaderboard />} />
              <Route path="ops" element={<Ops />} />
              <Route
                path="admin"
                element={
                  <AdminGate>
                    <Admin />
                  </AdminGate>
                }
              />
              <Route path="docs" element={<Docs />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </PrefsProvider>
  );
}
