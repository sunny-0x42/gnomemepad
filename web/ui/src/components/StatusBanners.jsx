import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { hasAdena, openInstallAdena, ensureNetwork, getAdenaChainId } from "../lib/adena";

/**
 * Global status: RPC offline, missing Adena, wrong network.
 */
export default function StatusBanners() {
  const { health, wallet, network, connect, showToast, setWallet } = useApp();
  const [adena, setAdena] = useState(true); // assume true to avoid flash

  useEffect(() => {
    if (hasAdena()) {
      setAdena(true);
      return;
    }
    let checks = 0;
    const interval = setInterval(() => {
      checks++;
      if (hasAdena()) {
        setAdena(true);
        clearInterval(interval);
      } else if (checks >= 15) { // Check up to 3 seconds
        setAdena(false);
        clearInterval(interval);
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const rpcBad = health && health.ok === false;
  const wrongNet =
    wallet?.type === "adena" &&
    wallet?.chainId &&
    network?.chainId &&
    wallet.chainId !== network.chainId;
  const netWarn = wallet?.networkWarning;

  async function switchNetwork() {
    try {
      await ensureNetwork(network);
      const cid = await getAdenaChainId();
      if (cid && cid === network.chainId) {
        setWallet({
          ...wallet,
          chainId: cid,
          canSign: true,
          networkWarning: undefined,
        });
        showToast(`Switched to ${cid}`);
      } else {
        showToast(
          `Still on ${cid || "unknown"}. Open Adena → Networks → ${network.chainId}`,
          false,
        );
      }
    } catch (e) {
      showToast(e.message || e, false);
    }
  }

  if (!rpcBad && adena && !wrongNet && !netWarn) return null;

  return (
    <div className="status-banners">
      {rpcBad && (
        <div className="callout err status-banner">
          <div>
            <strong>RPC / API offline</strong>
            <div className="muted" style={{ fontSize: "0.82rem", marginTop: "0.2rem" }}>
              Markets may be stale. Check connection or try again shortly.
            </div>
          </div>
        </div>
      )}
      {!adena && (
        <div className="callout warn status-banner">
          <div>
            <strong>Adena not detected</strong>
            <div className="muted" style={{ fontSize: "0.82rem", marginTop: "0.2rem" }}>
              Install the wallet extension to create and trade on Sapphire.
            </div>
          </div>
          <button type="button" className="btn sm primary" onClick={openInstallAdena}>
            Install Adena
          </button>
        </div>
      )}
      {adena && (wrongNet || netWarn) && (
        <div className="callout warn status-banner">
          <div>
            <strong>Wrong network</strong>
            <div className="muted" style={{ fontSize: "0.82rem", marginTop: "0.2rem" }}>
              {netWarn ||
                `Adena is on ${wallet.chainId}. This app uses ${network.chainId} (Sapphire).`}
            </div>
          </div>
          <div className="admin-actions">
            <button type="button" className="btn sm primary" onClick={switchNetwork}>
              Switch to Sapphire
            </button>
            <button type="button" className="btn sm ghost" onClick={connect}>
              Reconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
