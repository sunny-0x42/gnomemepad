import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../lib/api";
import {
  connectAdena,
  doContractCall,
  doContractCalls,
  hasAdena,
  onAccountChange,
  openInstallAdena,
  DEFAULT_NETWORK,
} from "../lib/adena";
import { loadWatchlist, toggleWatch as toggleWatchList } from "../lib/watchlist";

const LS_WALLET = "gnomemepad.wallet.v1";
const AppContext = createContext(null);

function loadWallet() {
  try {
    const raw = localStorage.getItem(LS_WALLET);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AppProvider({ children }) {
  const [wallet, setWalletState] = useState(() => loadWallet());
  const [isConnecting, setIsConnecting] = useState(false);
  const [health, setHealth] = useState(null);
  const [walletsMeta, setWalletsMeta] = useState(null);
  const [toast, setToast] = useState(null);
  const [tx, setTx] = useState(null); // { phase, label, hash, height, error }
  const [watchlist, setWatchlist] = useState(() => loadWatchlist());

  const setWallet = useCallback((w) => {
    setWalletState(w);
    if (w) localStorage.setItem(LS_WALLET, JSON.stringify(w));
    else localStorage.removeItem(LS_WALLET);
  }, []);

  const showToast = useCallback((msg, ok = true) => {
    setToast({ msg: String(msg), ok });
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const clearTx = useCallback(() => setTx(null), []);

  const network = useMemo(
    () => ({
      chainId: health?.chainId || DEFAULT_NETWORK.chainId,
      chainName: "Gno Sapphire",
      rpcUrl: health?.rpc || DEFAULT_NETWORK.rpcUrl,
    }),
    [health],
  );

  const pkg = health?.pkg || health?.modules?.pad || null;
  const signerAddr = walletsMeta?.signerAddr || null;

  const isAdmin = useMemo(() => {
    const w = (wallet?.address || "").toLowerCase();
    const s = (signerAddr || "").toLowerCase();
    return !!(w && s && w === s);
  }, [wallet, signerAddr]);

  const refreshHealth = useCallback(async () => {
    try {
      const h = await api("/api/health");
      setHealth(h);
    } catch {
      setHealth((prev) => (prev ? { ...prev, ok: false } : { ok: false }));
    }
  }, []);

  const refreshWalletsMeta = useCallback(async () => {
    try {
      setWalletsMeta(await api("/api/wallets"));
    } catch {
      setWalletsMeta({ demos: [], signerAddr: null });
    }
  }, []);

  useEffect(() => {
    refreshHealth();
    refreshWalletsMeta();
    const t = setInterval(refreshHealth, 12000);
    return () => clearInterval(t);
  }, [refreshHealth, refreshWalletsMeta]);

  useEffect(() => {
    return onAccountChange((address) => {
      if (wallet?.type === "adena" && address) {
        setWallet({ ...wallet, address });
        showToast(`Adena: ${address.slice(0, 8)}…`);
      }
    });
  }, [wallet, setWallet, showToast]);

  const connect = useCallback(async () => {
    if (!hasAdena()) {
      openInstallAdena();
      showToast("Install Adena, then try again", false);
      return;
    }
    try {
      setIsConnecting(true);
      showToast("Opening Adena…");
      const w = await connectAdena(network);
      setWallet(w);
      showToast(`Connected ${w.address.slice(0, 8)}…`);
    } catch (e) {
      showToast(e.message || e, false);
    } finally {
      setIsConnecting(false);
    }
  }, [network, setWallet, showToast]);

  const disconnect = useCallback(() => {
    setWallet(null);
    showToast("Disconnected");
  }, [setWallet, showToast]);

  /**
   * Sign + broadcast via Adena.
   * opts.label — shown in TxModal
   * opts.silent — skip modal (rare)
   */
  const broadcast = useCallback(
    async (func, args = [], send = "", pkgPath = null, opts = {}) => {
      if (!wallet?.address || !wallet?.canSign) {
        throw new Error("Connect Adena to sign");
      }
      const path = pkgPath || pkg;
      if (!path) throw new Error("Pad package path unknown — wait for health");
      const label = opts.label || func;
      if (!opts.silent) {
        setTx({ phase: "signing", label, hash: null, height: null, error: null });
      }
      try {
        const r = await doContractCall({
          caller: wallet.address,
          pkgPath: path,
          func,
          args,
          send,
          gasWanted: opts.gasWanted || 150_000_000,
          gasFee: opts.gasFee || 2_000_000,
          network,
        });
        if (!opts.silent) {
          const celebrate =
            !!opts.celebrate ||
            /^graduate/i.test(String(func)) ||
            /^graduate/i.test(String(label)) ||
            /list.*gnoswap/i.test(String(label));
          setTx({
            phase: "success",
            label,
            hash: r.hash || "",
            height: r.height || "",
            error: null,
            celebrate,
          });
        }
        return r;
      } catch (e) {
        if (!opts.silent) {
          setTx({
            phase: "error",
            label,
            hash: null,
            height: null,
            error: String(e.message || e),
          });
        }
        throw e;
      }
    },
    [wallet, pkg, network],
  );

  /** Multi-msg atomic broadcast (e.g. Deposit+Approve+RetryListGnoswap). */
  const broadcastBundle = useCallback(
    async (messages, opts = {}) => {
      if (!wallet?.address || !wallet?.canSign) {
        throw new Error("Connect Adena to sign");
      }
      if (!messages?.length) throw new Error("No messages");
      const label = opts.label || "Bundle tx";
      if (!opts.silent) {
        setTx({ phase: "signing", label, hash: null, height: null, error: null });
      }
      try {
        const r = await doContractCalls({
          caller: wallet.address,
          messages,
          // Multi-msg WUGNOT Deposit+Approve+Buy needs more headroom than single Buy
          gasWanted: opts.gasWanted || 300_000_000,
          gasFee: opts.gasFee || 2_000_000,
          network,
          memo: opts.memo || "gnomemepad",
        });
        if (!opts.silent) {
          setTx({
            phase: "success",
            label,
            hash: r.hash || "",
            height: r.height || "",
            error: null,
            celebrate: !!opts.celebrate,
          });
        }
        return r;
      } catch (e) {
        if (!opts.silent) {
          setTx({
            phase: "error",
            label,
            hash: null,
            height: null,
            error: String(e.message || e),
          });
        }
        throw e;
      }
    },
    [wallet, network],
  );

  const toggleWatch = useCallback((item) => {
    setWatchlist((prev) => toggleWatchList(prev, item));
  }, []);

  const value = {
    wallet,
    isConnecting,
    setWallet,
    health,
    walletsMeta,
    signerAddr,
    isAdmin,
    pkg,
    network,
    toast,
    showToast,
    tx,
    clearTx,
    connect,
    disconnect,
    broadcast,
    broadcastBundle,
    refreshHealth,
    hasAdena: hasAdena(),
    watchlist,
    toggleWatch,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}
