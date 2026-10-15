import { useApp } from "../context/AppContext";

/**
 * Global status: only hard RPC/API failures.
 * Yellow warn banners (pad pending, Adena missing, wrong network) are suppressed.
 */
export default function StatusBanners() {
  const { health } = useApp();
  const rpcBad = health && health.ok === false;
  if (!rpcBad) return null;

  return (
    <div className="status-banners">
      <div className="callout err status-banner">
        <div>
          <strong>RPC / API offline</strong>
          <div className="muted" style={{ fontSize: "0.82rem", marginTop: "0.2rem" }}>
            Markets may be stale. Check connection or try again shortly.
          </div>
        </div>
      </div>
    </div>
  );
}
